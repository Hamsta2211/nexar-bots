import express from "express";
import type { Express, Request, Response } from "express";
import { storage } from "./storage";
import { PROVIDER_BASE } from "./agent";
import { withKey, ProviderError, classify } from "./keys";

// Hotword-Erkennung (openWakeWord-Merkmale, Python-Dienst im selben Container), Spracherkennung (Groq Whisper)
// und Gesichts-Einstellungen der Agenten.

const WAKE_URL = process.env.WAKE_URL || `http://127.0.0.1:${process.env.WAKE_PORT || "8766"}`;
const raw = (limit: string) => express.raw({ type: () => true, limit });

type Trained = { model: any; posWin: number[][]; stats: any; at: number };
const wakeKey = (id: number | string) => `wake_${id}`;
const readTrained = (id: number | string): Trained | null => {
  try { const j = JSON.parse(storage.getSetting(wakeKey(id)) || "null"); return j?.model ? j : null; } catch { return null; }
};
const readNeg = (): number[][] => { try { return JSON.parse(storage.getSetting("wake_neg") || "[]"); } catch { return []; } };

async function py(path: string, init: RequestInit = {}, ms = 5000) {
  return fetch(`${WAKE_URL}${path}`, { ...init, signal: AbortSignal.timeout(ms) });
}

// ---- Verfügbarkeit + Abgleich der Modelle mit dem Python-Dienst ----
let health = { at: 0, ok: false, ready: false, models: [] as string[] };
let dirty = true;
let syncing: Promise<void> | null = null;

async function desiredModels() {
  const out: Record<string, any> = {};
  for (const b of await storage.listBots()) {
    const t = readTrained(b.id);
    if (t) out[String(b.id)] = t.model;
  }
  return out;
}

async function checkHealth(force = false) {
  if (!force && Date.now() - health.at < 8000) return health;
  try {
    const r = await py("/health", {}, 1500);
    const j: any = await r.json();
    health = { at: Date.now(), ok: !!j.ok, ready: !!j.ready, models: j.models || [] };
  } catch {
    health = { at: Date.now(), ok: false, ready: false, models: [] };
  }
  return health;
}

async function ensureSynced() {
  const h = await checkHealth();
  if (!h.ok) return false;
  const want = await desiredModels();
  const same = Object.keys(want).sort().join(",") === [...h.models].sort().join(",");
  if (same && !dirty) return true;
  if (!syncing) {
    syncing = (async () => {
      try {
        const r = await py("/models", { method: "PUT", body: JSON.stringify(want) }, 15_000);
        if (r.ok) { dirty = false; health = { ...health, models: Object.keys(want) }; }
      } catch {} finally { syncing = null; }
    })();
  }
  await syncing;
  return !dirty;
}

// ---- Aufnahmen für das Training (im Speicher, kurzlebig) ----
type Samples = { pos: Buffer[]; neg: Buffer[]; at: number };
const samples = new Map<string, Samples>();
const getSamples = (a: string) => {
  for (const [k, v] of samples) if (Date.now() - v.at > 30 * 60_000) samples.delete(k);
  let s = samples.get(a);
  if (!s) { s = { pos: [], neg: [], at: Date.now() }; samples.set(a, s); }
  s.at = Date.now();
  return s;
};

type Job = { state: "running" | "done" | "error"; stats?: any; error?: string; startedAt: number };
const jobs = new Map<string, Job>();

async function runTraining(agent: string, otherPos: number[][], oldNeg: number[][], s: Samples) {
  const job: Job = { state: "running", startedAt: Date.now() };
  jobs.set(agent, job);
  try {
    const body = JSON.stringify({
      agent, otherPos, oldNeg,
      pos: s.pos.map((b) => b.toString("base64")),
      neg: s.neg.map((b) => b.toString("base64")),
    });
    const r = await py("/train", { method: "POST", body }, 20_000);
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || `Dienst antwortet ${r.status}`);
    const deadline = Date.now() + 20 * 60_000;
    for (;;) {
      await new Promise((res) => setTimeout(res, 2500));
      if (Date.now() > deadline) throw new Error("Training dauert zu lange");
      const st = await py(`/train/status?agent=${encodeURIComponent(agent)}`, {}, 5000);
      if (!st.ok) throw new Error("Trainingsstatus nicht lesbar");
      const j: any = await st.json();
      if (j.state === "running") continue;
      if (j.state === "error") throw new Error(j.error || "Training fehlgeschlagen");
      const neg = [...oldNeg, ...(j.negWin || [])].slice(-120);
      await storage.setSetting("wake_neg", JSON.stringify(neg));
      await storage.setSetting(wakeKey(agent), JSON.stringify({ model: j.model, posWin: j.posWin, stats: j.stats, at: Date.now() }));
      dirty = true;
      await ensureSynced();
      job.state = "done"; job.stats = j.stats;
      samples.delete(agent);
      return;
    }
  } catch (e: any) {
    job.state = "error"; job.error = String(e?.message || e);
  }
}

// ---- Whisper ----
const HALLU = /^(untertitel[a-z\s]*|vielen dank( fürs zuschauen| für['’]s zuschauen)?|danke( fürs zuschauen)?|tschüss|bis zum nächsten mal|amara\.org.*|thanks for watching|thank you)\W*$/i;

async function transcribe(audio: Buffer, lang: string, hint: string) {
  const text = await withKey("groq", async (key) => {
    const fd = new FormData();
    fd.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    fd.append("model", "whisper-large-v3-turbo");
    fd.append("response_format", "verbose_json");
    fd.append("temperature", "0");
    if (lang) fd.append("language", lang);
    if (hint) fd.append("prompt", hint.slice(0, 220));
    let res: globalThis.Response;
    try {
      res = await fetch(`${PROVIDER_BASE.groq}/audio/transcriptions`, {
        method: "POST", headers: { Authorization: `Bearer ${key}` }, body: fd, signal: AbortSignal.timeout(30_000),
      });
    } catch (e: any) {
      throw new ProviderError(`groq: Netzwerkfehler (${e?.message || e})`, 0, 0, "network");
    }
    const t = await res.text();
    if (!res.ok) {
      let msg = t;
      try { msg = JSON.parse(t)?.error?.message || t; } catch {}
      throw new ProviderError(`groq ${res.status}: ${String(msg).slice(0, 300)}`, res.status, 0, classify(res.status, String(msg)));
    }
    const j = JSON.parse(t);
    const segs: any[] = j.segments || [];
    if (segs.length && segs.every((g) => g.no_speech_prob > 0.6 && g.avg_logprob < -0.8)) return "";
    return String(j.text || "").trim();
  });
  return HALLU.test(text) && text.length < 40 ? "" : text;
}

// ---- Gesichter ----
const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = <T extends string>(v: any, list: readonly T[]) => (list.includes(v) ? (v as T) : undefined);
export function sanitizeFace(b: any) {
  const out: Record<string, any> = {};
  if (Number.isInteger(b?.kind) && b.kind >= 0 && b.kind <= 7) out.kind = b.kind;
  if (HEX.test(b?.skin)) out.skin = b.skin;
  if (HEX.test(b?.accent)) out.accent = b.accent;
  const eyes = pick(b?.eyes, ["round", "wide", "happy", "calm", "sleepy"] as const); if (eyes) out.eyes = eyes;
  const mouth = pick(b?.mouth, ["smile", "grin", "neutral", "open"] as const); if (mouth) out.mouth = mouth;
  const brows = pick(b?.brows, ["none", "soft", "strong", "raised"] as const); if (brows) out.brows = brows;
  if (typeof b?.blush === "boolean") out.blush = b.blush;
  return out;
}

export function registerWakeRoutes(app: Express) {
  app.get("/api/wake/status", async (_req, res) => {
    const h = await checkHealth(true);
    const bots = await storage.listBots();
    const agents: Record<string, any> = {};
    for (const b of bots) {
      const t = readTrained(b.id);
      const j = jobs.get(String(b.id));
      agents[String(b.id)] = {
        trained: !!t, at: t?.at || 0, stats: t?.stats || null,
        training: j ? { state: j.state, error: j.error } : null,
        samples: { pos: samples.get(String(b.id))?.pos.length || 0, neg: samples.get(String(b.id))?.neg.length || 0 },
      };
    }
    res.json({ available: h.ok && h.ready, serviceUp: h.ok, agents });
  });

  app.post("/api/wake/feed", raw("256kb"), async (req: Request, res: Response) => {
    if (!(await ensureSynced())) return res.status(503).json({ message: "Hotword-Dienst nicht erreichbar" });
    const sid = String(req.query.sid || "x").slice(0, 40);
    try {
      const r = await py(`/score?sid=${encodeURIComponent(sid)}`, { method: "POST", body: req.body as Buffer }, 8000);
      res.status(r.status).type("json").send(await r.text());
    } catch {
      health = { ...health, at: 0 };
      res.status(503).json({ message: "Hotword-Dienst antwortet nicht" });
    }
  });

  app.post("/api/wake/reset", async (req, res) => {
    try { await py(`/reset?sid=${encodeURIComponent(String(req.query.sid || "x"))}`, { method: "POST" }, 3000); } catch {}
    res.json({ ok: true });
  });

  app.post("/api/wake/sample", raw("512kb"), async (req, res) => {
    const agent = String(req.query.agent || "");
    const kind = req.query.kind === "neg" ? "neg" : "pos";
    if (!/^\d+$/.test(agent) || !(await storage.getBot(Number(agent)))) return res.status(404).json({ message: "Agent nicht gefunden" });
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length < 8000 || buf.length > 220_000) return res.status(400).json({ message: "Aufnahme ungültig (zu kurz oder zu lang)" });
    const s = getSamples(agent);
    if (kind === "pos") { if (s.pos.length >= 8) return res.status(400).json({ message: "Genug Aufnahmen" }); s.pos.push(Buffer.from(buf)); }
    else {
      const total = s.neg.reduce((a, b) => a + b.length, 0);
      if (total > 700_000) return res.status(400).json({ message: "Genug Hintergrund-Aufnahmen" });
      s.neg.push(Buffer.from(buf));
    }
    res.json({ pos: s.pos.length, neg: s.neg.length });
  });

  app.delete("/api/wake/sample", (req, res) => {
    samples.delete(String(req.query.agent || ""));
    jobs.delete(String(req.query.agent || ""));
    res.json({ ok: true });
  });

  app.post("/api/wake/train", async (req, res) => {
    const agent = String(req.body?.agent || "");
    if (!/^\d+$/.test(agent) || !(await storage.getBot(Number(agent)))) return res.status(404).json({ message: "Agent nicht gefunden" });
    const h = await checkHealth(true);
    if (!h.ok || !h.ready) return res.status(503).json({ message: "Hotword-Dienst läuft nicht (nur auf dem Server verfügbar)." });
    const s = getSamples(agent);
    if (s.pos.length < 3) return res.status(400).json({ message: "Mindestens 3 Aufnahmen des Namens nötig." });
    if (jobs.get(agent)?.state === "running") return res.status(409).json({ message: "Training läuft bereits." });
    const others: number[][] = [];
    for (const b of await storage.listBots()) {
      if (String(b.id) === agent) continue;
      const t = readTrained(b.id);
      if (t) others.push(...t.posWin.slice(0, 40));
    }
    void runTraining(agent, others.slice(0, 200), readNeg(), { pos: [...s.pos], neg: [...s.neg], at: Date.now() });
    res.status(202).json({ state: "running" });
  });

  app.get("/api/wake/train/status", (req, res) => {
    const j = jobs.get(String(req.query.agent || ""));
    res.json(j ? { state: j.state, stats: j.stats, error: j.error, seconds: Math.round((Date.now() - j.startedAt) / 1000) } : { state: "none" });
  });

  app.delete("/api/wake/agent/:id", async (req, res) => {
    await storage.setSetting(wakeKey(req.params.id), "");
    jobs.delete(req.params.id);
    dirty = true;
    await ensureSynced();
    res.json({ ok: true });
  });

  // ---- Spracherkennung ----
  app.post("/api/stt", raw("6mb"), async (req, res) => {
    const buf = req.body as Buffer;
    if (!Buffer.isBuffer(buf) || buf.length < 2000) return res.status(400).json({ message: "Audio fehlt" });
    try {
      const text = await transcribe(buf, String(req.query.lang || "de").slice(0, 5), String(req.query.hint || ""));
      res.json({ text });
    } catch (e: any) {
      res.status(502).json({ message: String(e?.message || e) });
    }
  });

  // ---- Gesichter ----
  app.get("/api/faces", async (_req, res) => {
    const out: Record<string, any> = {};
    for (const b of await storage.listBots()) {
      try { const j = JSON.parse(storage.getSetting(`face_${b.id}`) || "null"); if (j) out[String(b.id)] = j; } catch {}
    }
    res.json(out);
  });

  app.put("/api/bots/:id/face", async (req, res) => {
    const id = Number(req.params.id);
    if (!(await storage.getBot(id))) return res.status(404).json({ message: "Bot nicht gefunden" });
    const face = req.body?.reset ? null : sanitizeFace(req.body);
    await storage.setSetting(`face_${id}`, face && Object.keys(face).length ? JSON.stringify(face) : "");
    res.json({ ok: true, face });
  });
}
