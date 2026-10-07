import pg from "pg";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { Bot, InsertBot, Conversation, Message, Memory, Task, InsertTask, Run } from "@shared/schema";

/**
 * Persistenz in Supabase (Postgres). Verbindung über eine eigene, eingeschränkte DB-Rolle
 * (nexar_app) via Supabase-Pooler. Geheimnisse (API-Keys, SSH-Schlüssel, 2FA) werden vor dem
 * Speichern mit AES-256-GCM verschlüsselt; der Schlüssel (APP_SECRET) liegt nur auf dem Server.
 */

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL fehlt. Trage die Supabase-Verbindung in .env ein (siehe README).");
}
if (!process.env.APP_SECRET || process.env.APP_SECRET.length < 32) {
  throw new Error("APP_SECRET fehlt oder ist zu kurz (min. 32 Zeichen). Erzeuge einen mit: openssl rand -hex 32");
}

// bigint als number zurückgeben (IDs und ms-Zeitstempel passen in JS-Number)
pg.types.setTypeParser(20, (v) => Number(v));

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 5,
  idleTimeoutMillis: 30_000,
});
pool.on("error", (e) => console.error("DB-Pool-Fehler:", e.message));

async function q<T = any>(text: string, params: any[] = []): Promise<T[]> {
  const r = await pool.query(text, params);
  return r.rows as T[];
}
async function one<T = any>(text: string, params: any[] = []): Promise<T | undefined> {
  return (await q<T>(text, params))[0];
}

// ---------- Verschlüsselung ----------
const ENC_KEY = createHash("sha256").update(process.env.APP_SECRET).digest();
export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", ENC_KEY, iv);
  const enc = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return `enc:v1:${iv.toString("base64")}:${c.getAuthTag().toString("base64")}:${enc.toString("base64")}`;
}
export function decrypt(value: string): string {
  if (!value.startsWith("enc:v1:")) return value;
  const [, , iv, tag, data] = value.split(":");
  const d = createDecipheriv("aes-256-gcm", ENC_KEY, Buffer.from(iv, "base64"));
  d.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
}
const SECRET_SETTING = /^(key_|keys_|ssh_config$)/;

// ---------- Mapping ----------
const mapBot = (r: any): Bot => ({
  id: r.id, name: r.name, description: r.description, color: r.color, provider: r.provider, model: r.model,
  systemPrompt: r.system_prompt, temperature: r.temperature, tools: r.tools, createdAt: r.created_at,
});
const mapConv = (r: any): Conversation => ({ id: r.id, botId: r.bot_id, title: r.title, updatedAt: r.updated_at });
const mapMsg = (r: any): Message => ({
  id: r.id, conversationId: r.conversation_id, role: r.role, content: r.content, steps: r.steps, createdAt: r.created_at,
});
const mapMem = (r: any): Memory => ({ id: r.id, botId: r.bot_id, content: r.content, createdAt: r.created_at });
const mapTask = (r: any): Task => ({
  id: r.id, botId: r.bot_id, name: r.name, prompt: r.prompt, intervalMinutes: r.interval_minutes, enabled: r.enabled,
  webhookUrl: r.webhook_url, lastRunAt: r.last_run_at, nextRunAt: r.next_run_at,
});
const mapRun = (r: any): Run => ({
  id: r.id, taskId: r.task_id, botId: r.bot_id, source: r.source, status: r.status, output: r.output,
  tokens: r.tokens, durationMs: r.duration_ms, startedAt: r.started_at,
});

export class SupabaseStorage {
  private settingsCache = new Map<string, string>();

  /** Beim Start einmal alle Einstellungen laden (danach synchron lesbar, Schreiben write-through). */
  async init() {
    const rows = await q<{ key: string; value: string }>("select key, value from nb_settings");
    this.settingsCache.clear();
    for (const r of rows) {
      try {
        this.settingsCache.set(r.key, SECRET_SETTING.test(r.key) ? decrypt(r.value) : r.value);
      } catch {
        console.error(`Einstellung ${r.key} konnte nicht entschlüsselt werden (falscher APP_SECRET?)`);
      }
    }
  }

  // ---- Einstellungen ----
  getSetting(key: string): string | undefined {
    return this.settingsCache.get(key);
  }
  setSetting(key: string, value: string): Promise<void> {
    if (!value) {
      this.settingsCache.delete(key);
      return q("delete from nb_settings where key = $1", [key]).then(() => {});
    }
    this.settingsCache.set(key, value);
    const stored = SECRET_SETTING.test(key) ? encrypt(value) : value;
    return q("insert into nb_settings(key, value) values ($1, $2) on conflict (key) do update set value = excluded.value", [key, stored])
      .then(() => {})
      .catch((e) => console.error("Einstellung speichern fehlgeschlagen:", e.message));
  }

  // ---- Bots ----
  async listBots() { return (await q("select * from nb_bots order by id")).map(mapBot); }
  async getBot(id: number) { const r = await one("select * from nb_bots where id = $1", [id]); return r ? mapBot(r) : undefined; }
  async createBot(b: InsertBot) {
    return mapBot(await one(
      `insert into nb_bots(name, description, color, provider, model, system_prompt, temperature, tools, created_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
      [b.name, b.description ?? "", b.color ?? "lime", b.provider, b.model, b.systemPrompt ?? "", b.temperature, b.tools ?? "[]", Date.now()],
    ));
  }
  async updateBot(id: number, b: Partial<InsertBot>) {
    const cols: Record<string, string> = {
      name: "name", description: "description", color: "color", provider: "provider", model: "model",
      systemPrompt: "system_prompt", temperature: "temperature", tools: "tools",
    };
    const sets: string[] = [], vals: any[] = [];
    for (const [k, v] of Object.entries(b)) if (cols[k] && v !== undefined) { vals.push(v); sets.push(`${cols[k]} = $${vals.length}`); }
    if (!sets.length) return this.getBot(id);
    vals.push(id);
    const r = await one(`update nb_bots set ${sets.join(", ")} where id = $${vals.length} returning *`, vals);
    return r ? mapBot(r) : undefined;
  }
  async deleteBot(id: number) { await q("delete from nb_bots where id = $1", [id]); } // Cascade löscht Chats, Gedächtnis, Tasks

  // ---- Chats ----
  async listConversations(botId: number) {
    return (await q("select * from nb_conversations where bot_id = $1 order by updated_at desc", [botId])).map(mapConv);
  }
  async getConversation(id: number) { const r = await one("select * from nb_conversations where id = $1", [id]); return r ? mapConv(r) : undefined; }
  async createConversation(botId: number, title: string) {
    return mapConv(await one("insert into nb_conversations(bot_id, title, updated_at) values ($1,$2,$3) returning *", [botId, title, Date.now()]));
  }
  async touchConversation(id: number) { await q("update nb_conversations set updated_at = $1 where id = $2", [Date.now(), id]); }
  async deleteConversation(id: number) { await q("delete from nb_conversations where id = $1", [id]); }
  async countConversations() { return Number((await one("select count(*)::int as c from nb_conversations"))?.c ?? 0); }

  // ---- Nachrichten ----
  async listMessages(conversationId: number) {
    return (await q("select * from nb_messages where conversation_id = $1 order by id", [conversationId])).map(mapMsg);
  }
  async addMessage(conversationId: number, role: string, content: string, steps = "[]") {
    return mapMsg(await one(
      "insert into nb_messages(conversation_id, role, content, steps, created_at) values ($1,$2,$3,$4,$5) returning *",
      [conversationId, role, content, steps, Date.now()],
    ));
  }

  // ---- Gedächtnis ----
  async listMemories(botId: number) { return (await q("select * from nb_memories where bot_id = $1 order by id desc", [botId])).map(mapMem); }
  async addMemory(botId: number, content: string) {
    return mapMem(await one("insert into nb_memories(bot_id, content, created_at) values ($1,$2,$3) returning *", [botId, content, Date.now()]));
  }
  async deleteMemory(id: number) { await q("delete from nb_memories where id = $1", [id]); }

  // ---- Automationen ----
  async listTasks() { return (await q("select * from nb_tasks order by id")).map(mapTask); }
  async getTask(id: number) { const r = await one("select * from nb_tasks where id = $1", [id]); return r ? mapTask(r) : undefined; }
  async createTask(t: InsertTask) {
    return mapTask(await one(
      `insert into nb_tasks(bot_id, name, prompt, interval_minutes, enabled, webhook_url, next_run_at)
       values ($1,$2,$3,$4,$5,$6,$7) returning *`,
      [t.botId, t.name, t.prompt, t.intervalMinutes, t.enabled ?? true, t.webhookUrl ?? "", Date.now() + t.intervalMinutes * 60_000],
    ));
  }
  async updateTask(id: number, t: Partial<Task>) {
    const cols: Record<string, string> = {
      botId: "bot_id", name: "name", prompt: "prompt", intervalMinutes: "interval_minutes", enabled: "enabled",
      webhookUrl: "webhook_url", lastRunAt: "last_run_at", nextRunAt: "next_run_at",
    };
    const sets: string[] = [], vals: any[] = [];
    for (const [k, v] of Object.entries(t)) if (cols[k] && v !== undefined) { vals.push(v); sets.push(`${cols[k]} = $${vals.length}`); }
    if (!sets.length) return this.getTask(id);
    vals.push(id);
    const r = await one(`update nb_tasks set ${sets.join(", ")} where id = $${vals.length} returning *`, vals);
    return r ? mapTask(r) : undefined;
  }
  async deleteTask(id: number) { await q("delete from nb_tasks where id = $1", [id]); }
  async dueTasks(now: number) {
    return (await q("select * from nb_tasks where enabled = true and next_run_at <= $1", [now])).map(mapTask);
  }

  // ---- Läufe ----
  async addRun(r: Omit<Run, "id">) {
    return mapRun(await one(
      `insert into nb_runs(task_id, bot_id, source, status, output, tokens, duration_ms, started_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
      [r.taskId, r.botId, r.source, r.status, r.output, r.tokens, r.durationMs, r.startedAt],
    ));
  }
  async listRuns(limit = 50, taskId?: number) {
    const rows = taskId
      ? await q("select * from nb_runs where task_id = $1 order by id desc limit $2", [taskId, limit])
      : await q("select * from nb_runs order by id desc limit $1", [limit]);
    return rows.map(mapRun);
  }
  async runsSince(ts: number) { return (await q("select * from nb_runs where started_at >= $1", [ts])).map(mapRun); }
  async pruneRuns(olderThan: number) { await q("delete from nb_runs where started_at < $1", [olderThan]); }

  // ---- Anmeldung ----
  async getUserByEmail(email: string) {
    return one<any>("select * from nb_users where lower(email) = lower($1)", [email]);
  }
  async getUser(id: number) { return one<any>("select * from nb_users where id = $1", [id]); }
  async updateUser(id: number, patch: { password_hash?: string; totp_secret?: string | null; totp_enabled?: boolean; email?: string }) {
    const sets: string[] = [], vals: any[] = [];
    for (const [k, v] of Object.entries(patch)) if (v !== undefined) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    if (!sets.length) return;
    vals.push(id);
    await q(`update nb_users set ${sets.join(", ")} where id = $${vals.length}`, vals);
  }
  async createSession(s: { userId: number; tokenHash: string; deviceName: string; userAgent: string; ip: string; expiresAt: number }) {
    const now = Date.now();
    return one<any>(
      `insert into nb_sessions(user_id, token_hash, device_name, user_agent, ip, created_at, last_seen_at, expires_at)
       values ($1,$2,$3,$4,$5,$6,$6,$7) returning *`,
      [s.userId, s.tokenHash, s.deviceName, s.userAgent, s.ip, now, s.expiresAt],
    );
  }
  async getSessionByHash(hash: string) {
    return one<any>("select * from nb_sessions where token_hash = $1 and expires_at > $2", [hash, Date.now()]);
  }
  async touchSession(id: number, ip: string) { await q("update nb_sessions set last_seen_at = $1, ip = $2 where id = $3", [Date.now(), ip, id]); }
  async listSessions(userId: number) {
    return q<any>("select id, device_name, user_agent, ip, created_at, last_seen_at, expires_at from nb_sessions where user_id = $1 and expires_at > $2 order by last_seen_at desc", [userId, Date.now()]);
  }
  async deleteSession(id: number, userId: number) { await q("delete from nb_sessions where id = $1 and user_id = $2", [id, userId]); }
  async deleteOtherSessions(userId: number, keepId: number) { await q("delete from nb_sessions where user_id = $1 and id <> $2", [userId, keepId]); }
  async purgeExpiredSessions() { await q("delete from nb_sessions where expires_at < $1", [Date.now()]); }

  async addLoginAttempt(email: string, ip: string, success: boolean) {
    await q("insert into nb_login_attempts(email, ip, success, at) values ($1,$2,$3,$4)", [email.toLowerCase(), ip, success, Date.now()]);
  }
  async failedAttempts(since: number, by: { ip?: string; email?: string }) {
    const r = by.ip
      ? await one("select count(*)::int as c from nb_login_attempts where success = false and at > $1 and ip = $2", [since, by.ip])
      : await one("select count(*)::int as c from nb_login_attempts where success = false and at > $1 and email = $2", [since, (by.email || "").toLowerCase()]);
    return Number(r?.c ?? 0);
  }
  async pruneLoginAttempts(olderThan: number) { await q("delete from nb_login_attempts where at < $1", [olderThan]); }
}

export const storage = new SupabaseStorage();
