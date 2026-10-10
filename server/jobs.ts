import type { Express } from "express";
import { pool, storage } from "./storage";
import { runAgent } from "./agent";

// Aufgaben: Anfragen an Agenten laufen auf dem Server im Hintergrund weiter (auch wenn der Browser zu ist),
// jede Aufgabe kann mehrere Agenten haben, und jeder Agent hat darin eigene Chats.

type LiveItem =
  | { kind: "think"; text: string; done: boolean }
  | { kind: "tool"; step: { tool: string; args: unknown; result: string } };

type Run = {
  convId: number; jobId: number; botId: number;
  text: string; items: LiveItem[]; state: "running" | "done" | "error" | "stopped";
  error?: string; startedAt: number; endedAt?: number; ctrl: AbortController;
};
const runs = new Map<number, Run>(); // conversationId -> Lauf (fertige bleiben 15 Minuten abrufbar)

const q = async (text: string, params: any[] = []) => (await pool.query(text, params)).rows as any[];
const num = (v: unknown) => { const n = Number(v); return Number.isInteger(n) && n > 0 ? n : 0; };

function gc() {
  for (const [k, r] of runs) if (r.state !== "running" && Date.now() - (r.endedAt || 0) > 15 * 60_000) runs.delete(k);
}

const mapJob = (r: any) => ({ id: Number(r.id), title: r.title, description: r.description, status: r.status, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at) });

async function agentIds(jobId: number): Promise<number[]> {
  return (await q("select bot_id from nb_job_agents where job_id = $1 order by bot_id", [jobId])).map((r) => Number(r.bot_id));
}
const runningFor = (jobId: number) => [...runs.values()].filter((r) => r.jobId === jobId && r.state === "running");

type ConvSummary = { upto: number; text: string };
const getSummary = (convId: number): ConvSummary | null => {
  try { return JSON.parse(storage.getSetting(`convsum_${convId}`) || "null"); } catch { return null; }
};

async function startRun(job: { id: number; title: string; description: string }, botId: number, convId: number, text: string) {
  const bot = await storage.getBot(botId);
  if (!bot) throw new Error("Agent nicht gefunden");
  const run: Run = { convId, jobId: job.id, botId, text: "", items: [], state: "running", startedAt: Date.now(), ctrl: new AbortController() };
  runs.set(convId, run);

  const others = (await Promise.all((await agentIds(job.id)).filter((id) => id !== botId).map((id) => storage.getBot(id)))).filter(Boolean).map((b) => b!.name);
  const ctx = [
    `## Aufgabe: ${job.title}`,
    job.description ? job.description : "",
    others.length ? `Weitere Agenten an dieser Aufgabe: ${others.join(", ")}. Jeder hat seinen eigenen Chat.` : "",
    "Du arbeitest im Hintergrund an dieser Aufgabe. Erledige sie vollständig und melde am Ende kurz das Ergebnis.",
  ].filter(Boolean).join("\n");
  const effBot = { ...bot, systemPrompt: `${bot.systemPrompt || `Du bist ${bot.name}, ein hilfreicher KI-Agent.`}\n\n${ctx}` };

  void (async () => {
    const t0 = Date.now();
    try {
      const sum = getSummary(convId);
      const all = (await storage.listMessages(convId)).filter((m) => !sum || m.id > sum.upto);
      const history = all.map((m) => ({ role: m.role, content: m.content }));
      let summaryWrite: Promise<void> = Promise.resolve();
      const r = await runAgent(effBot, history, {
        summary: sum?.text,
        signal: run.ctrl.signal,
        onCompact: (t, covered) => {
          const upto = covered > 0 ? all[covered - 1].id : sum?.upto || 0;
          summaryWrite = storage.setSetting(`convsum_${convId}`, JSON.stringify({ upto, text: t }));
        },
        onToken: (t) => { run.text += t; },
        onThink: (t) => {
          const last = run.items[run.items.length - 1];
          if (last && last.kind === "think" && !last.done) last.text += t; else run.items.push({ kind: "think", text: t, done: false });
        },
        onThinkEnd: () => { const last = run.items[run.items.length - 1]; if (last && last.kind === "think") last.done = true; },
        onStep: (s) => { run.items.push({ kind: "tool", step: { tool: s.tool, args: s.args, result: s.result } }); },
        onEvent: (t) => { run.items.push({ kind: "tool", step: { tool: "nexar", args: {}, result: t } }); },
        onStreamReset: () => { run.text = ""; },
      });
      await summaryWrite;
      await storage.addMessage(convId, "assistant", r.content || "(keine Antwort)", JSON.stringify(r.steps));
      await storage.addRun({ taskId: null, botId, source: "chat", status: "ok", output: (r.content || "").slice(0, 500), tokens: r.tokens, durationMs: Date.now() - t0, startedAt: t0 });
      run.state = "done";
    } catch (e: any) {
      const aborted = run.ctrl.signal.aborted;
      const msg = aborted ? (run.text.trim() ? `${run.text.trim()}\n\n_(gestoppt)_` : "Gestoppt.") : `Fehler: ${e?.message || e}`;
      try {
        await storage.addMessage(convId, "assistant", msg);
        await storage.addRun({ taskId: null, botId, source: "chat", status: aborted ? "ok" : "error", output: msg.slice(0, 500), tokens: 0, durationMs: Date.now() - t0, startedAt: t0 });
      } catch {}
      run.state = aborted ? "stopped" : "error";
      run.error = aborted ? undefined : String(e?.message || e);
    } finally {
      run.endedAt = Date.now();
      try { await storage.touchConversation(convId); await q("update nb_jobs set updated_at = $1 where id = $2", [Date.now(), job.id]); } catch {}
      gc();
    }
  })();
}

export function registerJobRoutes(app: Express) {
  // Chats von Aufgaben erscheinen nicht in der normalen Chat-Liste der Bots
  (storage as any).listConversations = async (botId: number) =>
    (await q("select * from nb_conversations where bot_id = $1 and job_id is null order by updated_at desc", [botId]))
      .map((r) => ({ id: Number(r.id), botId: Number(r.bot_id), title: r.title, updatedAt: Number(r.updated_at) }));

  // ---- Liste (für Aufgaben-Seite und Übersicht) ----
  app.get("/api/jobs", async (_req, res) => {
    const jobs = (await q("select * from nb_jobs order by updated_at desc")).map(mapJob);
    const links = await q("select job_id, bot_id from nb_job_agents");
    const convs = await q("select job_id, count(*)::int c from nb_conversations where job_id is not null group by job_id");
    res.json(jobs.map((j) => ({
      ...j,
      botIds: links.filter((l) => Number(l.job_id) === j.id).map((l) => Number(l.bot_id)),
      chats: Number(convs.find((c) => Number(c.job_id) === j.id)?.c ?? 0),
      running: runningFor(j.id).map((r) => ({ botId: r.botId, conversationId: r.convId, since: r.startedAt })),
    })));
  });

  app.post("/api/jobs", async (req, res) => {
    const title = String(req.body?.title || "").trim().slice(0, 120);
    if (!title) return res.status(400).json({ message: "Titel fehlt" });
    const description = String(req.body?.description || "").trim().slice(0, 4000);
    const now = Date.now();
    const j = mapJob((await q("insert into nb_jobs(title, description, status, created_at, updated_at) values ($1,$2,'open',$3,$3) returning *", [title, description, now]))[0]);
    const ids: number[] = Array.isArray(req.body?.botIds) ? req.body.botIds.map(num).filter(Boolean) : [];
    for (const id of new Set(ids)) if (await storage.getBot(id)) await q("insert into nb_job_agents(job_id, bot_id) values ($1,$2) on conflict do nothing", [j.id, id]);
    res.status(201).json(j);
  });

  app.get("/api/jobs/:id", async (req, res) => {
    const id = num(req.params.id);
    const r = (await q("select * from nb_jobs where id = $1", [id]))[0];
    if (!r) return res.status(404).json({ message: "Aufgabe nicht gefunden" });
    const convs = (await q("select * from nb_conversations where job_id = $1 order by updated_at desc", [id])).map((c) => ({
      id: Number(c.id), botId: Number(c.bot_id), title: c.title, updatedAt: Number(c.updated_at), running: runs.get(Number(c.id))?.state === "running",
    }));
    res.json({ ...mapJob(r), botIds: await agentIds(id), conversations: convs });
  });

  app.patch("/api/jobs/:id", async (req, res) => {
    const id = num(req.params.id);
    const sets: string[] = [], vals: any[] = [];
    if (typeof req.body?.title === "string" && req.body.title.trim()) { vals.push(req.body.title.trim().slice(0, 120)); sets.push(`title = $${vals.length}`); }
    if (typeof req.body?.description === "string") { vals.push(req.body.description.trim().slice(0, 4000)); sets.push(`description = $${vals.length}`); }
    if (req.body?.status === "open" || req.body?.status === "done") { vals.push(req.body.status); sets.push(`status = $${vals.length}`); }
    if (!sets.length) return res.status(400).json({ message: "Nichts zu ändern" });
    vals.push(Date.now()); sets.push(`updated_at = $${vals.length}`);
    vals.push(id);
    const r = (await q(`update nb_jobs set ${sets.join(", ")} where id = $${vals.length} returning *`, vals))[0];
    if (!r) return res.status(404).json({ message: "Aufgabe nicht gefunden" });
    res.json(mapJob(r));
  });

  app.delete("/api/jobs/:id", async (req, res) => {
    const id = num(req.params.id);
    for (const r of runningFor(id)) r.ctrl.abort();
    await q("delete from nb_jobs where id = $1", [id]); // Cascade löscht Agenten-Zuordnung und Chats
    res.json({ ok: true });
  });

  app.put("/api/jobs/:id/agents", async (req, res) => {
    const id = num(req.params.id);
    if (!(await q("select 1 from nb_jobs where id = $1", [id])).length) return res.status(404).json({ message: "Aufgabe nicht gefunden" });
    const ids = new Set<number>((Array.isArray(req.body?.botIds) ? req.body.botIds : []).map(num).filter(Boolean));
    const valid: number[] = [];
    for (const b of ids) if (await storage.getBot(b)) valid.push(b);
    await q("delete from nb_job_agents where job_id = $1 and not (bot_id = any($2::bigint[]))", [id, valid]);
    for (const b of valid) await q("insert into nb_job_agents(job_id, bot_id) values ($1,$2) on conflict do nothing", [id, b]);
    res.json({ botIds: await agentIds(id) });
  });

  // ---- Anfrage im Hintergrund starten ----
  app.post("/api/jobs/:id/chat", async (req, res) => {
    const id = num(req.params.id);
    const jr = (await q("select * from nb_jobs where id = $1", [id]))[0];
    if (!jr) return res.status(404).json({ message: "Aufgabe nicht gefunden" });
    const botId = num(req.body?.botId);
    const text = String(req.body?.message || "").trim();
    if (!text) return res.status(400).json({ message: "Nachricht leer" });
    if (!(await agentIds(id)).includes(botId)) return res.status(400).json({ message: "Dieser Agent gehört nicht zur Aufgabe" });

    let convId = num(req.body?.conversationId);
    if (convId) {
      const c = (await q("select bot_id, job_id from nb_conversations where id = $1", [convId]))[0];
      if (!c || Number(c.job_id) !== id || Number(c.bot_id) !== botId) return res.status(400).json({ message: "Chat gehört nicht zu dieser Aufgabe/diesem Agenten" });
    } else {
      convId = Number((await q("insert into nb_conversations(bot_id, title, updated_at, job_id) values ($1,$2,$3,$4) returning id", [botId, text.slice(0, 60), Date.now(), id]))[0].id);
    }
    if (runs.get(convId)?.state === "running") return res.status(409).json({ message: "In diesem Chat arbeitet der Agent noch." });
    await storage.addMessage(convId, "user", text);
    await q("update nb_jobs set updated_at = $1 where id = $2", [Date.now(), id]);
    try { await startRun(mapJob(jr), botId, convId, text); } catch (e: any) { return res.status(500).json({ message: String(e?.message || e) }); }
    res.status(202).json({ conversationId: convId });
  });

  // ---- Live-Stand eines Laufs (Polling) ----
  app.get("/api/jobs/runs/:convId", (req, res) => {
    const r = runs.get(num(req.params.convId));
    if (!r) return res.json({ state: "none" });
    res.json({ state: r.state, text: r.text, items: r.items, error: r.error, startedAt: r.startedAt, botId: r.botId });
  });

  app.post("/api/jobs/runs/:convId/stop", (req, res) => {
    const r = runs.get(num(req.params.convId));
    if (r?.state === "running") r.ctrl.abort();
    res.json({ ok: true });
  });
}
