import express from "express";
import type { Express } from "express";
import { storage } from "./storage";
import { PROVIDER_BASE } from "./agent";
import { withKey, ProviderError, classify } from "./keys";

const raw = (limit: string) => express.raw({ type: () => true, limit });
const HALLU = /^(untertitel[a-z\s]*|vielen dank( fürs zuschauen| für['’]s zuschauen)?|danke( fürs zuschauen)?|tschüss|bis zum nächsten mal|amara\.org.*|thanks for watching|thank you)\W*$/i;

async function transcribe(audio: Buffer, lang: string, hint: string) {
  const text = await withKey("groq", async (key) => {
    const fd = new FormData();
    fd.append("file", new Blob([audio], { type: "audio/wav" }), "audio.wav");
    fd.append("model", process.env.GROQ_STT_MODEL || "whisper-large-v3");
    fd.append("response_format", "verbose_json");
    fd.append("temperature", "0");
    if (lang) fd.append("language", lang);
    const prompt = `Transkribiere auf Deutsch. Schreibe Agentennamen exakt: ${hint}`.slice(0, 220);
    fd.append("prompt", prompt);

    let res: globalThis.Response;
    try {
      res = await fetch(`${PROVIDER_BASE.groq}/audio/transcriptions`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: fd,
        signal: AbortSignal.timeout(30_000),
      });
    } catch (e: any) {
      throw new ProviderError(`groq: Netzwerkfehler (${e?.message || e})`, 0, 0, "network");
    }

    const body = await res.text();
    if (!res.ok) {
      let message = body;
      try { message = JSON.parse(body)?.error?.message || body; } catch {}
      throw new ProviderError(`groq ${res.status}: ${String(message).slice(0, 300)}`, res.status, 0, classify(res.status, String(message)));
    }

    const result = JSON.parse(body);
    const segments: any[] = result.segments || [];
    if (segments.length && segments.every((segment) => segment.no_speech_prob > 0.6 && segment.avg_logprob < -0.8)) return "";
    return String(result.text || "").trim();
  });

  return HALLU.test(text) && text.length < 40 ? "" : text;
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const pick = <T extends string>(value: any, list: readonly T[]) => list.includes(value) ? value : undefined;

export function sanitizeFace(body: any) {
  const out: Record<string, any> = {};
  if (Number.isInteger(body?.kind) && body.kind >= 0 && body.kind <= 7) out.kind = body.kind;
  if (HEX.test(body?.skin)) out.skin = body.skin;
  if (HEX.test(body?.accent)) out.accent = body.accent;
  const eyes = pick(body?.eyes, ["round", "wide", "happy", "calm", "sleepy"] as const); if (eyes) out.eyes = eyes;
  const mouth = pick(body?.mouth, ["smile", "grin", "neutral", "open"] as const); if (mouth) out.mouth = mouth;
  const brows = pick(body?.brows, ["none", "soft", "strong", "raised"] as const); if (brows) out.brows = brows;
  if (typeof body?.blush === "boolean") out.blush = body.blush;
  return out;
}

export function registerVoiceRoutes(app: Express) {
  app.post("/api/stt", raw("6mb"), async (req, res) => {
    const audio = req.body as Buffer;
    if (!Buffer.isBuffer(audio) || audio.length < 2000) return res.status(400).json({ message: "Audio fehlt" });
    try {
      const text = await transcribe(audio, String(req.query.lang || "de").slice(0, 5), String(req.query.hint || ""));
      res.json({ text });
    } catch (e: any) {
      res.status(502).json({ message: String(e?.message || e) });
    }
  });

  app.get("/api/faces", async (_req, res) => {
    const faces: Record<string, any> = {};
    for (const bot of await storage.listBots()) {
      try { const value = JSON.parse(storage.getSetting(`face_${bot.id}`) || "null"); if (value) faces[String(bot.id)] = value; } catch {}
    }
    res.json(faces);
  });

  app.put("/api/bots/:id/face", async (req, res) => {
    const id = Number(req.params.id);
    if (!(await storage.getBot(id))) return res.status(404).json({ message: "Bot nicht gefunden" });
    const face = req.body?.reset ? null : sanitizeFace(req.body);
    await storage.setSetting(`face_${id}`, face && Object.keys(face).length ? JSON.stringify(face) : "");
    res.json({ ok: true, face });
  });
}
