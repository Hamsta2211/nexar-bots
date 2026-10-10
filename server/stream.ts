import type { Express } from "express";
import { storage } from "./storage";
import { runAgent } from "./agent";
import { MarkFilter, hasExpectMark, stripExpectMark, EXPECT_MARK } from "@shared/think";

// Streaming-Chat (SSE) und Sprachausgabe (Python-Dienst mit edge-tts) 

const TTS_URL = process.env.TTS_URL || `http://127.0.0.1:${process.env.TTS_PORT || "8765"}`;

const VOICE_HINT = [
  "## Sprachmodus",
  "Deine Antwort wird laut vorgelesen. Antworte natürlich gesprochen, in kurzen, klaren Sätzen und ohne Markdown, Listen, Tabellen, Emojis oder Links.",
  "Fasse dich kurz (meist 1 bis 3 Sätze), außer der Nutzer will ausdrücklich mehr.",
  `Wenn du vom Nutzer als Nächstes eine Antwort erwartest (du hast eine Frage gestellt oder brauchst eine Auswahl/Bestätigung), hänge ganz am Ende deiner Antwort exakt ${EXPECT_MARK} an. Der Marker wird nicht vorgelesen; das System hört dann automatisch weiter zu und schickt die nächste Äußerung wieder an dich. Ohne Rückfrage hängst du nichts an.`,
].join("\n");

type ConvSummary = { upto: number; text: string };
const getSummary = (convId: number): ConvSummary | null => {
  try { return JSON.parse(storage.getSetting(`convsum_${convId}`) || "null"); } catch { return null; }
};

// Standardstimmen, reihum an Bots verteilt (jede Stimme kann pro Agent überschrieben werden)
const DEFAULT_ROTATION = [
  "de-DE-KatjaNeural", "de-DE-ConradNeural", "de-AT-JonasNeural", "de-DE-AmalaNeural",
  "de-DE-KillianNeural", "de-AT-IngridNeural", "de-CH-JanNeural", "de-CH-LeniNeural",
];
const FALLBACK_VOICES = [
  ...DEFAULT_ROTATION.map((id) => ({ id, name: id.split("-")[2].replace("Neural", ""), lang: id.slice(0, 5), gender: "" })),
  { id: "de-DE-SeraphinaMultilingualNeural", name: "SeraphinaMultilingual", lang: "de-DE", gender: "Female" },
  { id: "de-DE-FlorianMultilingualNeural", name: "FlorianMultilingual", lang: "de-DE", gender: "Male" },
  { id: "en-US-GuyNeural", name: "Guy", lang: "en-US", gender: "Male" },
  { id: "en-US-JennyNeural", name: "Jenny", lang: "en-US", gender: "Female" },
  { id: "en-GB-RyanNeural", name: "Ryan", lang: "en-GB", gender: "Male" },
  { id: "en-GB-SoniaNeural", name: "Sonia", lang: "en-GB", gender: "Female" },
];
const VOICE_RE = /^[A-Za-z]{2,3}-[A-Za-z0-9]{2,4}(-[A-Za-z0-9]+)+$/;

let voiceCache: { at: number; list: any[] } | null = null;
let aliveCache = { at: 0, ok: false };

async function ttsAlive(): Promise<boolean> {
  if (Date.now() - aliveCache.at < 10_000) return aliveCache.ok;
  let ok = false;
  try {
    const r = await fetch(`${TTS_URL}/health`, { signal: AbortSignal.timeout(1500) });
    ok = r.ok;
  } catch {}
  aliveCache = { at: Date.now(), ok };
  return ok;
}

export function registerStreamRoutes(app: Express) {
  // ---- Streaming-Chat ----
  app.post("/api/bots/:id/chat/stream", async (req, res) => {
    const bot = await storage.getBot(Number(req.params.id));
    if (!bot) return res.status(404).json({ message: "Bot nicht gefunden" });
    const text = String(req.body?.message || "").trim();
    if (!text) return res.status(400).json({ message: "Nachricht leer" });
    const voice = !!req.body?.voice;

    let convId = Number(req.body?.conversationId) || 0;
    if (!convId || !(await storage.getConversation(convId))) {
      convId = (await storage.createConversation(bot.id, text.slice(0, 60))).id;
    }
    await storage.addMessage(convId, "user", text);

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders();

    const ctrl = new AbortController();
    const send = (o: unknown) => { if (!res.writableEnded) res.write(`data: ${JSON.stringify(o)}\n\n`); };
    const ping = setInterval(() => { if (!res.writableEnded) res.write(": ping\n\n"); }, 15_000);
    // Client weg (Stop-Button, Seite zu): Agent abbrechen
    res.on("close", () => { clearInterval(ping); if (!res.writableEnded) ctrl.abort(); });

    send({ type: "start", conversationId: convId });

    const sum = getSummary(convId);
    const all = (await storage.listMessages(convId)).filter((m) => !sum || m.id > sum.upto);
    const history = all.map((m) => ({ role: m.role, content: m.content }));
    const effBot = voice
      ? { ...bot, systemPrompt: `${bot.systemPrompt || `Du bist ${bot.name}, ein hilfreicher KI-Agent.`}\n\n${VOICE_HINT}` }
      : bot;
    const t0 = Date.now();
    let streamed = "";
    const mark = new MarkFilter((t) => { streamed += t; send({ type: "token", t }); });
    let summaryWrite: Promise<void> = Promise.resolve();
    try {
      const r = await runAgent(effBot, history, {
        summary: sum?.text,
        signal: ctrl.signal,
        onCompact: (t, covered) => {
          const upto = covered > 0 ? all[covered - 1].id : sum?.upto || 0;
          summaryWrite = storage.setSetting(`convsum_${convId}`, JSON.stringify({ upto, text: t }));
        },
        onEvent: (t) => send({ type: "event", text: t }),
        onToken: (t) => mark.push(t),
        onThink: (t) => send({ type: "think", t }),
        onThinkEnd: () => send({ type: "think_end" }),
        onStep: (step) => send({ type: "step", step: { tool: step.tool, args: step.args, result: step.result } }),
        onStreamReset: () => { mark.end(); streamed = ""; send({ type: "reset" }); },
      });
      mark.end();
      const expect = voice && hasExpectMark(r.content);
      r.content = stripExpectMark(r.content) || "(keine Antwort)";
      await summaryWrite;
      const msg = await storage.addMessage(convId, "assistant", r.content, JSON.stringify(r.steps));
      await storage.touchConversation(convId);
      await storage.addRun({ taskId: null, botId: bot.id, source: "chat", status: "ok", output: r.content.slice(0, 500), tokens: r.tokens, durationMs: Date.now() - t0, startedAt: t0 });
      send({ type: "done", message: msg, expect });
    } catch (e: any) {
      const aborted = ctrl.signal.aborted;
      const errText = aborted
        ? (streamed.trim() ? `${streamed.trim()}\n\n_(gestoppt)_` : "Gestoppt.")
        : `Fehler: ${e?.message || e}`;
      try {
        const msg = await storage.addMessage(convId, "assistant", errText);
        await storage.touchConversation(convId);
        await storage.addRun({ taskId: null, botId: bot.id, source: "chat", status: "error", output: errText.slice(0, 500), tokens: 0, durationMs: Date.now() - t0, startedAt: t0 });
        send({ type: aborted ? "done" : "error", message: msg, error: errText });
      } catch {}
    } finally {
      clearInterval(ping);
      if (!res.writableEnded) res.end();
    }
  });

  // ---- Stimmen ----
  app.get("/api/tts/voices", async (_req, res) => {
    const alive = await ttsAlive();
    let list: any[] = FALLBACK_VOICES;
    if (alive) {
      if (voiceCache && Date.now() - voiceCache.at < 6 * 3600_000) list = voiceCache.list;
      else {
        try {
          const r = await fetch(`${TTS_URL}/voices`, { signal: AbortSignal.timeout(10_000) });
          if (r.ok) {
            const l = await r.json();
            if (Array.isArray(l) && l.length) { voiceCache = { at: Date.now(), list: l }; list = l; }
          }
        } catch {}
      }
    }
    const bots = await storage.listBots();
    const assignments: Record<string, string> = {};
    bots.forEach((b, i) => {
      assignments[String(b.id)] = storage.getSetting(`voice_${b.id}`) || DEFAULT_ROTATION[i % DEFAULT_ROTATION.length];
    });
    res.json({ engine: alive ? "edge-tts" : "offline", voices: list, assignments });
  });

  app.put("/api/bots/:id/voice", async (req, res) => {
    const id = Number(req.params.id);
    if (!(await storage.getBot(id))) return res.status(404).json({ message: "Bot nicht gefunden" });
    const v = String(req.body?.voice || "").trim();
    if (v && !VOICE_RE.test(v)) return res.status(400).json({ message: "Ungültige Stimme" });
    await storage.setSetting(`voice_${id}`, v);
    res.json({ ok: true });
  });

  // ---- Sprachausgabe ----
  app.post("/api/tts", async (req, res) => {
    const text = String(req.body?.text || "").trim().slice(0, 1200);
    const voice = String(req.body?.voice || "de-DE-KatjaNeural");
    if (!text) return res.status(400).json({ message: "Text fehlt" });
    if (!VOICE_RE.test(voice)) return res.status(400).json({ message: "Ungültige Stimme" });
    try {
      const r = await fetch(`${TTS_URL}/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, voice }),
        signal: AbortSignal.timeout(30_000),
      });
      if (!r.ok) {
        let m = "Sprachsynthese fehlgeschlagen";
        try { m = (await r.json()).message || m; } catch {}
        return res.status(502).json({ message: m });
      }
      const buf = Buffer.from(await r.arrayBuffer());
      res.setHeader("Content-Type", "audio/mpeg");
      res.setHeader("Cache-Control", "private, max-age=3600");
      res.send(buf);
    } catch {
      aliveCache = { at: 0, ok: false };
      res.status(503).json({ message: "TTS-Dienst nicht erreichbar" });
    }
  });
}
