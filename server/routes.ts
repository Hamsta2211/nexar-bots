import type { Express, Request, Response, NextFunction } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import { runAgent, listModels, TOOL_META } from "./agent";
import { keyInfos, addKey, removeKey, moveKey, allKeys, resetKeyState } from "./keys";
import { getCatalog, invalidateCatalog, startCatalogRefresher, DEFAULT_MODEL } from "./models";
import { insertBotSchema, insertTaskSchema, PROVIDERS } from "@shared/schema";
import type { Provider, Task, Stats, KeyStatus } from "@shared/schema";
import { requireAuth, registerAuthRoutes } from "./auth";
import { getSshConfig, saveSshConfig, publicSshConfig, clearSshSecrets, sshExec, systemInfo, generateKey } from "./ssh";

const startedAt = Date.now();
const running = new Set<number>();

const activeChats = new Map<number, AbortController>(); // botId -> laufender Chat

type ConvSummary = { upto: number; text: string };
const getSummary = (convId: number): ConvSummary | null => {
  try { return JSON.parse(storage.getSetting(`convsum_${convId}`) || "null"); } catch { return null; }
};

async function postWebhook(url: string, botName: string, taskName: string, text: string) {
  if (!url) return;
  const isDiscord = /discord(app)?\.com\/api\/webhooks/.test(url);
  const isSlack = /hooks\.slack\.com/.test(url);
  const header = `**${botName} · ${taskName}**\n`;
  const payload = isDiscord
    ? { content: (header + text).slice(0, 1990) }
    : isSlack
      ? { text: header + text }
      : { bot: botName, task: taskName, text, at: new Date().toISOString() };
  try {
    await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload), signal: AbortSignal.timeout(15_000) });
  } catch (e) {
    console.error("Webhook fehlgeschlagen", e);
  }
}

export async function executeTask(task: Task) {
  if (running.has(task.id)) return;
  running.add(task.id);
  const t0 = Date.now();
  const bot = await storage.getBot(task.botId);
  await storage.updateTask(task.id, { lastRunAt: t0, nextRunAt: t0 + task.intervalMinutes * 60_000 });
  try {
    if (!bot) throw new Error("Bot existiert nicht mehr");
    const r = await runAgent(bot, [{ role: "user", content: task.prompt }]);
    await storage.addRun({ taskId: task.id, botId: bot.id, source: "task", status: "ok", output: r.content, tokens: r.tokens, durationMs: Date.now() - t0, startedAt: t0 });
    await postWebhook(task.webhookUrl, bot.name, task.name, r.content);
  } catch (e: any) {
    await storage.addRun({ taskId: task.id, botId: task.botId, source: "task", status: "error", output: String(e?.message || e), tokens: 0, durationMs: Date.now() - t0, startedAt: t0 });
  } finally {
    running.delete(task.id);
  }
}

function startScheduler() {
  setInterval(async () => {
    try {
      for (const t of await storage.dueTasks(Date.now())) executeTask(t);
    } catch (e: any) {
      console.error("Scheduler:", e.message);
    }
  }, 30_000);
  // Läufe älter als 90 Tage aufräumen
  setInterval(() => storage.pruneRuns(Date.now() - 90 * 86_400_000).catch(() => {}), 6 * 3600_000);
}

const idParam = (req: Request) => Number(req.params.id);

export async function registerRoutes(httpServer: Server, app: Express): Promise<Server> {
  await storage.init();
  app.use("/api", requireAuth);
  registerAuthRoutes(app);

  app.get("/api/health", async (_req, res) => res.json({ ok: true, uptimeSec: Math.round((Date.now() - startedAt) / 1000) }));
  // ---- Keys ----
  app.get("/api/keys", async (_req, res) => {
    const mk = (p: Provider) => {
      const keys = keyInfos(p);
      const first = keys.find((k) => k.active) || keys[0];
      return { set: keys.length > 0, hint: first?.hint || "", keys };
    };
    const status: KeyStatus = { groq: mk("groq"), google: mk("google") };
    res.json(status);
  });
  app.post("/api/keys/test", async (req, res) => {
    const provider = req.body?.provider as Provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ message: "Unbekannter Anbieter" });
    try {
      let key: string | undefined = req.body?.key || undefined;
      if (req.body?.id) {
        key = allKeys(provider).find((k) => k.id === req.body.id)?.key;
        if (!key) return res.json({ ok: false, message: "Key nicht gefunden" });
        resetKeyState(req.body.id);
      }
      const models = await listModels(provider, key);
      res.json({ ok: true, count: models.length });
    } catch (e: any) {
      res.json({ ok: false, message: e.message });
    }
  });

  app.post("/api/keys/:provider", async (req, res) => {
    const p = req.params.provider as Provider;
    if (!PROVIDERS.includes(p)) return res.status(400).json({ message: "Unbekannter Anbieter" });
    const key = String(req.body?.key || "").trim();
    if (key.length < 10) return res.status(400).json({ message: "Key zu kurz" });
    try {
      await addKey(p, key, req.body?.label);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
    invalidateCatalog(p);
    res.json({ ok: true });
  });
  app.delete("/api/keys/:provider/:id", async (req, res) => {
    const p = req.params.provider as Provider;
    if (!PROVIDERS.includes(p)) return res.status(400).json({ message: "Unbekannter Anbieter" });
    await removeKey(p, String(req.params.id));
    invalidateCatalog(p);
    res.json({ ok: true });
  });
  app.post("/api/keys/:provider/:id/move", async (req, res) => {
    const p = req.params.provider as Provider;
    if (!PROVIDERS.includes(p)) return res.status(400).json({ message: "Unbekannter Anbieter" });
    await moveKey(p, String(req.params.id), req.body?.dir === -1 ? -1 : 1);
    res.json({ ok: true });
  });
  app.get("/api/models/:provider", async (req, res) => {
    const provider = req.params.provider as Provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ message: "Unbekannter Anbieter" });
    res.json(await getCatalog(provider, req.query.refresh === "1"));
  });
  app.post("/api/models/:provider/refresh", async (req, res) => {
    const provider = req.params.provider as Provider;
    if (!PROVIDERS.includes(provider)) return res.status(400).json({ message: "Unbekannter Anbieter" });
    res.json(await getCatalog(provider, true));
  });

  app.get("/api/tools", async (_req, res) => res.json(TOOL_META));

  // ---- Mein PC (SSH) ----
  app.get("/api/ssh", async (_req, res) => res.json(publicSshConfig()));
  app.put("/api/ssh", async (req, res) => {
    const b = req.body || {};
    const patch: any = {};
    if (typeof b.host === "string") patch.host = b.host.trim();
    if (b.port !== undefined) patch.port = Math.min(Math.max(Number(b.port) || 22, 1), 65535);
    if (typeof b.username === "string") patch.username = b.username.trim();
    if (b.authType === "key" || b.authType === "password") patch.authType = b.authType;
    if (typeof b.privateKey === "string") patch.privateKey = b.privateKey.trim() ? b.privateKey.trim() + "\n" : "";
    if (typeof b.passphrase === "string") patch.passphrase = b.passphrase;
    if (typeof b.password === "string") patch.password = b.password;
    if (typeof b.safeMode === "boolean") patch.safeMode = b.safeMode;
    if (patch.privateKey) await storage.setSetting("ssh_pubkey", "");
    saveSshConfig(patch);
    res.json(publicSshConfig());
  });
  app.delete("/api/ssh", async (_req, res) => {
    clearSshSecrets();
    await storage.setSetting("ssh_hostkey", "");
    await storage.setSetting("ssh_pubkey", "");
    res.json(publicSshConfig());
  });
  app.post("/api/ssh/generate-key", async (_req, res) => {
    generateKey();
    res.json(publicSshConfig());
  });
  app.delete("/api/ssh/hostkey", async (_req, res) => {
    await storage.setSetting("ssh_hostkey", "");
    res.json({ ok: true });
  });
  app.post("/api/ssh/test", async (_req, res) => {
    try {
      const info = await systemInfo();
      res.json({ ok: true, info, hostKey: storage.getSetting("ssh_hostkey") || "" });
    } catch (e: any) {
      res.json({ ok: false, message: e.message });
    }
  });
  app.get("/api/ssh/info", async (_req, res) => {
    if (!getSshConfig().host) return res.json({ ok: false, message: "Nicht eingerichtet" });
    try {
      res.json({ ok: true, info: await systemInfo() });
    } catch (e: any) {
      res.json({ ok: false, message: e.message });
    }
  });
  app.post("/api/ssh/exec", async (req, res) => {
    const command = String(req.body?.command || "").trim();
    if (!command) return res.status(400).json({ message: "Befehl fehlt" });
    try {
      const r = await sshExec(command, { timeoutMs: Math.min(Number(req.body?.timeoutSec) || 60, 600) * 1000 });
      res.json({ ok: true, ...r });
    } catch (e: any) {
      res.json({ ok: false, stdout: "", stderr: e.message, code: null, durationMs: 0 });
    }
  });

  // ---- Bots ----
  app.get("/api/bots", async (_req, res) => res.json(await storage.listBots()));
  app.get("/api/bots/:id", async (req, res) => {
    const b = await storage.getBot(idParam(req));
    b ? res.json(b) : res.status(404).json({ message: "Bot nicht gefunden" });
  });
  app.post("/api/bots", async (req, res) => {
    const p = insertBotSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message });
    res.json(await storage.createBot(p.data));
  });
  app.patch("/api/bots/:id", async (req, res) => {
    const p = insertBotSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message });
    res.json(await storage.updateBot(idParam(req), p.data));
  });
  app.delete("/api/bots/:id", async (req, res) => {
    await storage.deleteBot(idParam(req));
    res.json({ ok: true });
  });

  app.get("/api/bots/:id/memories", async (req, res) => res.json(await storage.listMemories(idParam(req))));
  app.delete("/api/memories/:id", async (req, res) => {
    await storage.deleteMemory(idParam(req));
    res.json({ ok: true });
  });

  // ---- Conversations ----
  app.get("/api/bots/:id/conversations", async (req, res) => res.json(await storage.listConversations(idParam(req))));
  app.get("/api/conversations/:id/messages", async (req, res) => res.json(await storage.listMessages(idParam(req))));
  app.delete("/api/conversations/:id", async (req, res) => {
    await storage.deleteConversation(idParam(req));
    if (storage.getSetting(`convsum_${idParam(req)}`)) await storage.setSetting(`convsum_${idParam(req)}`, "");
    res.json({ ok: true });
  });

  // Send a chat message (creates conversation if needed)
  app.post("/api/bots/:id/chat", async (req, res) => {
    const bot = await storage.getBot(idParam(req));
    if (!bot) return res.status(404).json({ message: "Bot nicht gefunden" });
    const text = String(req.body?.message || "").trim();
    if (!text) return res.status(400).json({ message: "Nachricht leer" });
    let convId = Number(req.body?.conversationId) || 0;
    if (!convId || !(await storage.getConversation(convId))) {
      convId = (await storage.createConversation(bot.id, text.slice(0, 60))).id;
    }
    await storage.addMessage(convId, "user", text);
    const sum = getSummary(convId);
    const all = (await storage.listMessages(convId)).filter((m) => !sum || m.id > sum.upto);
    const history = all.map((m) => ({ role: m.role, content: m.content }));
    const t0 = Date.now();
    activeChats.get(bot.id)?.abort();
    const ctrl = new AbortController();
    activeChats.set(bot.id, ctrl);
    let summaryWrite: Promise<void> = Promise.resolve();
    try {
      const r = await runAgent(bot, history, {
        summary: sum?.text,
        signal: ctrl.signal,
        onCompact: (text, covered) => {
          const upto = covered > 0 ? all[covered - 1].id : sum?.upto || 0;
          summaryWrite = storage.setSetting(`convsum_${convId}`, JSON.stringify({ upto, text }));
        },
      });
      await summaryWrite;
      const msg = await storage.addMessage(convId, "assistant", r.content, JSON.stringify(r.steps));
      await storage.touchConversation(convId);
      await storage.addRun({ taskId: null, botId: bot.id, source: "chat", status: "ok", output: r.content.slice(0, 500), tokens: r.tokens, durationMs: Date.now() - t0, startedAt: t0 });
      res.json({ conversationId: convId, message: msg });
    } catch (e: any) {
      const errText = ctrl.signal.aborted ? "Gestoppt." : `Fehler: ${e?.message || e}`;
      const msg = await storage.addMessage(convId, "assistant", errText);
      await storage.addRun({ taskId: null, botId: bot.id, source: "chat", status: "error", output: errText, tokens: 0, durationMs: Date.now() - t0, startedAt: t0 });
      res.json({ conversationId: convId, message: msg, error: true });
    } finally {
      if (activeChats.get(bot.id) === ctrl) activeChats.delete(bot.id);
    }
  });
  app.post("/api/bots/:id/stop", async (req, res) => {
    const c = activeChats.get(idParam(req));
    c?.abort();
    res.json({ ok: !!c });
  });

  // ---- Tasks ----
  app.get("/api/tasks", async (_req, res) => res.json(await storage.listTasks()));
  app.post("/api/tasks", async (req, res) => {
    const p = insertTaskSchema.safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message });
    res.json(await storage.createTask(p.data));
  });
  app.patch("/api/tasks/:id", async (req, res) => {
    const p = insertTaskSchema.partial().safeParse(req.body);
    if (!p.success) return res.status(400).json({ message: p.error.issues[0]?.message });
    const patch: any = { ...p.data };
    if (p.data.intervalMinutes || p.data.enabled) {
      const cur = await storage.getTask(idParam(req));
      patch.nextRunAt = Date.now() + (p.data.intervalMinutes ?? cur?.intervalMinutes ?? 60) * 60_000;
    }
    res.json(await storage.updateTask(idParam(req), patch));
  });
  app.delete("/api/tasks/:id", async (req, res) => {
    await storage.deleteTask(idParam(req));
    res.json({ ok: true });
  });
  app.post("/api/tasks/:id/run", async (req, res) => {
    const t = await storage.getTask(idParam(req));
    if (!t) return res.status(404).json({ message: "Task nicht gefunden" });
    await executeTask(t);
    res.json({ ok: true, run: (await storage.listRuns(1, t.id))[0] });
  });

  app.get("/api/runs", async (req, res) => {
    const taskId = req.query.taskId ? Number(req.query.taskId) : undefined;
    res.json(await storage.listRuns(100, taskId));
  });

  app.get("/api/stats", async (_req, res) => {
    const since = Date.now() - 86_400_000;
    const r24 = await storage.runsSince(since);
    const botsList = await storage.listBots();
    const taskList = await storage.listTasks();
    const stats: Stats = {
      bots: botsList.length,
      conversations: await storage.countConversations(),
      tasksActive: taskList.filter((t) => t.enabled).length,
      runs24h: r24.length,
      errors24h: r24.filter((r) => r.status === "error").length,
      tokens24h: r24.reduce((s, r) => s + r.tokens, 0),
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
      recentRuns: (await storage.listRuns(12)).map((r) => ({
        ...r,
        botName: botsList.find((b) => b.id === r.botId)?.name || "Gelöscht",
        taskName: r.taskId ? taskList.find((t) => t.id === r.taskId)?.name || null : null,
      })),
    };
    res.json(stats);
  });

  if ((await storage.listBots()).length === 0) {
    await storage.createBot({
      name: "Nova", description: "Recherche-Agent mit Websuche und Gedächtnis", color: "lime", provider: "groq",
      model: DEFAULT_MODEL.groq, temperature: 0.5, tools: JSON.stringify(["web_search", "fetch_url", "datetime", "memory"]),
      systemPrompt: "Du bist Nova, ein präziser Recherche-Agent. Suche bei Faktenfragen im Web, lies relevante Seiten und nenne die Quellen-Links. Antworte auf Deutsch.",
    });
    await storage.createBot({
      name: "Atlas", description: "Allrounder auf Gemini mit Rechner", color: "sky", provider: "google",
      model: DEFAULT_MODEL.google, temperature: 0.7, tools: JSON.stringify(["calculator", "datetime"]),
      systemPrompt: "Du bist Atlas, ein freundlicher Allround-Assistent. Rechne immer mit dem Rechner-Werkzeug. Antworte auf Deutsch.",
    });
  }

  if (!storage.getSetting("seed_pc_bot")) {
    await storage.setSetting("seed_pc_bot", "1");
    await storage.createBot({
      name: "Tux", description: "Admin-Agent für deinen Ubuntu-PC per SSH", color: "amber", provider: "groq",
      model: "openai/gpt-oss-120b", temperature: 0.2, tools: JSON.stringify(["linux_pc", "datetime", "calculator"]),
      systemPrompt: "Du bist Tux, ein erfahrener Linux-Admin mit SSH-Zugriff auf den Ubuntu-PC des Nutzers. Prüfe zuerst den Zustand mit lesenden Befehlen, bevor du etwas veränderst. Nutze nur nicht-interaktive Befehle. Fasse Ergebnisse knapp auf Deutsch zusammen und nenne die ausgeführten Befehle.",
    });
  }

  startScheduler();
  startCatalogRefresher();
  return httpServer;
}
