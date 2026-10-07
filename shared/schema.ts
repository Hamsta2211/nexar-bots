import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { z } from "zod";

export const PROVIDERS = ["groq", "google"] as const;
export type Provider = (typeof PROVIDERS)[number];

export const TOOL_IDS = ["datetime", "calculator", "fetch_url", "web_search", "memory", "linux_pc"] as const;
export type ToolId = (typeof TOOL_IDS)[number];

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const bots = sqliteTable("bots", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("lime"),
  provider: text("provider").notNull().default("groq"),
  model: text("model").notNull(),
  systemPrompt: text("system_prompt").notNull().default(""),
  temperature: real("temperature").notNull().default(0.7),
  tools: text("tools").notNull().default("[]"), // JSON array of ToolId
  createdAt: integer("created_at").notNull(),
});

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  botId: integer("bot_id").notNull(),
  title: text("title").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id").notNull(),
  role: text("role").notNull(), // user | assistant
  content: text("content").notNull(),
  steps: text("steps").notNull().default("[]"), // JSON array of tool steps
  createdAt: integer("created_at").notNull(),
});

export const memories = sqliteTable("memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  botId: integer("bot_id").notNull(),
  content: text("content").notNull(),
  createdAt: integer("created_at").notNull(),
});

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  botId: integer("bot_id").notNull(),
  name: text("name").notNull(),
  prompt: text("prompt").notNull(),
  intervalMinutes: integer("interval_minutes").notNull().default(60),
  enabled: integer("enabled", { mode: "boolean" }).notNull().default(true),
  webhookUrl: text("webhook_url").notNull().default(""),
  lastRunAt: integer("last_run_at"),
  nextRunAt: integer("next_run_at"),
});

export const runs = sqliteTable("runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  taskId: integer("task_id"),
  botId: integer("bot_id").notNull(),
  source: text("source").notNull(), // chat | task
  status: text("status").notNull(), // ok | error
  output: text("output").notNull(),
  tokens: integer("tokens").notNull().default(0),
  durationMs: integer("duration_ms").notNull().default(0),
  startedAt: integer("started_at").notNull(),
});

export const insertBotSchema = z.object({
  name: z.string().min(1, "Name fehlt").max(60),
  description: z.string().max(200).default(""),
  color: z.string().default("lime"),
  provider: z.enum(PROVIDERS),
  model: z.string().min(1, "Modell wählen"),
  systemPrompt: z.string().default(""),
  temperature: z.number().min(0).max(2),
  tools: z.string().default("[]"),
});

export const insertTaskSchema = z.object({
  botId: z.number().int(),
  name: z.string().min(1, "Name fehlt"),
  prompt: z.string().min(1, "Auftrag fehlt"),
  intervalMinutes: z.number().int().min(1).max(60 * 24 * 7),
  enabled: z.boolean().default(true),
  webhookUrl: z.union([z.string().url(), z.literal("")]).default(""),
});

export type Bot = typeof bots.$inferSelect;
export type InsertBot = z.infer<typeof insertBotSchema>;
export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Memory = typeof memories.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type InsertTask = z.infer<typeof insertTaskSchema>;
export type Run = typeof runs.$inferSelect;

export type ToolStep = { tool: string; args: unknown; result: string };

export type KeyInfo = {
  id: string; label: string; hint: string; source: "app" | "env";
  status: "ok" | "cooldown" | "invalid"; active: boolean; cooldownUntil: number;
  lastError: string; lastErrorAt: number; lastUsedAt: number; uses: number;
};
export type ProviderKeys = { set: boolean; hint: string; keys: KeyInfo[] };
export type KeyStatus = { groq: ProviderKeys; google: ProviderKeys };

export type Stats = {
  bots: number;
  conversations: number;
  tasksActive: number;
  runs24h: number;
  errors24h: number;
  tokens24h: number;
  uptimeSec: number;
  recentRuns: (Run & { botName: string; taskName: string | null })[];
};

export type ModelInfo = {
  id: string;
  name: string;
  owner?: string;
  context?: number;
  created?: number;
  description?: string;
  stage: "stable" | "preview";
  isNew: boolean;
};

export type ModelCatalog = {
  provider: Provider;
  models: ModelInfo[];
  fetchedAt: number;
  live: boolean;
  error: string | null;
};
