import type { Provider } from "@shared/schema";
import type { ModelInfo, ModelCatalog } from "@shared/schema";
import { storage } from "./storage";
import { firstKey as getKey } from "./keys";

const TTL_MS = 10 * 60_000; // Cache 10 Minuten
const NEW_WINDOW_MS = 14 * 86_400_000; // 14 Tage "neu"

// Fallback, wenn kein Key hinterlegt ist (Stand Oktober 2026)
const FALLBACK: Record<Provider, Omit<ModelInfo, "isNew">[]> = {
  groq: [
    { id: "openai/gpt-oss-120b", name: "GPT OSS 120B", owner: "OpenAI", context: 131072, stage: "stable" },
    { id: "llama-3.3-70b-versatile", name: "Llama 3.3 70B", owner: "Meta", context: 131072, stage: "stable" },
    { id: "openai/gpt-oss-20b", name: "GPT OSS 20B", owner: "OpenAI", context: 131072, stage: "stable" },
    { id: "llama-3.1-8b-instant", name: "Llama 3.1 8B", owner: "Meta", context: 131072, stage: "stable" },
    { id: "minimaxai/minimax-m2.7", name: "MiniMax M2.7", owner: "MiniMax", context: 196608, stage: "preview" },
    { id: "qwen/qwen3.8-27b", name: "Qwen3.8 27B", owner: "Alibaba", context: 131072, stage: "preview" },
  ],
  google: [
    { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash", owner: "Google", stage: "stable" },
    { id: "gemini-3.7-flash", name: "Gemini 3.7 Flash", owner: "Google", stage: "stable" },
    { id: "gemini-3.6-flash", name: "Gemini 3.6 Flash", owner: "Google", stage: "stable" },
    { id: "gemini-3.5-flash", name: "Gemini 3.5 Flash", owner: "Google", stage: "stable" },
    { id: "gemini-3.5-flash-lite", name: "Gemini 3.5 Flash-Lite", owner: "Google", stage: "stable" },
    { id: "gemini-3.1-flash-lite", name: "Gemini 3.1 Flash-Lite", owner: "Google", stage: "stable" },
    { id: "gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", owner: "Google", stage: "preview" },
    { id: "gemini-3-flash-preview", name: "Gemini 3 Flash", owner: "Google", stage: "preview" },
    { id: "gemini-2.5-pro", name: "Gemini 2.5 Pro", owner: "Google", stage: "stable" },
    { id: "gemini-2.5-flash", name: "Gemini 2.5 Flash", owner: "Google", stage: "stable" },
  ],
};

export const DEFAULT_MODEL: Record<Provider, string> = { groq: "openai/gpt-oss-120b", google: "gemini-3.5-flash" };

const GROQ_PREVIEW_HINT = /minimax|qwen|kimi|deepseek|mistral|compound|llama-4|safeguard/;
const NON_CHAT = /whisper|tts|orpheus|playai|guard|embedding|image|imagen|veo|live|audio|robotics|computer-use|aqa|learnlm|nano-banana/;

const cache: Partial<Record<Provider, ModelCatalog>> = {};

function prettyGroqName(id: string) {
  const base = id.split("/").pop() || id;
  return base
    .replace(/-/g, " ")
    .replace(/\b(\d+)b\b/gi, "$1B")
    .replace(/\bgpt\b/gi, "GPT").replace(/\boss\b/gi, "OSS")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function markNew(provider: Provider, models: Omit<ModelInfo, "isNew">[]): ModelInfo[] {
  const key = `models_seen_${provider}`;
  let seen: Record<string, number> = {};
  try { seen = JSON.parse(storage.getSetting(key) || "{}"); } catch {}
  const firstRun = Object.keys(seen).length === 0;
  const now = Date.now();
  let changed = false;
  for (const m of models) {
    if (!(m.id in seen)) { seen[m.id] = firstRun ? 0 : now; changed = true; }
  }
  if (changed) storage.setSetting(key, JSON.stringify(seen));
  return models.map((m) => ({ ...m, isNew: seen[m.id] > 0 && now - seen[m.id] < NEW_WINDOW_MS }));
}

async function fetchGroq(key: string): Promise<Omit<ModelInfo, "isNew">[]> {
  const r = await fetch("https://api.groq.com/openai/v1/models", {
    headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000),
  });
  if (!r.ok) throw new Error(`Groq ${r.status}: ${(await r.text()).slice(0, 200)}`);
  const data = await r.json();
  return (data.data || [])
    .filter((m: any) => m.active !== false && !NON_CHAT.test(m.id))
    .map((m: any) => ({
      id: m.id,
      name: FALLBACK.groq.find((f) => f.id === m.id)?.name || prettyGroqName(m.id),
      owner: m.owned_by,
      context: m.context_window,
      created: m.created ? m.created * 1000 : undefined,
      stage: /preview|exp/.test(m.id) || (GROQ_PREVIEW_HINT.test(m.id) && !FALLBACK.groq.some((f) => f.id === m.id && f.stage === "stable"))
        ? "preview" : "stable",
    }));
}

async function fetchGoogle(key: string): Promise<Omit<ModelInfo, "isNew">[]> {
  const out: Omit<ModelInfo, "isNew">[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${pageToken ? `&pageToken=${pageToken}` : ""}`;
    const r = await fetch(url, { headers: { "x-goog-api-key": key }, signal: AbortSignal.timeout(15_000) });
    if (!r.ok) throw new Error(`Google ${r.status}: ${(await r.text()).slice(0, 200)}`);
    const data = await r.json();
    for (const m of data.models || []) {
      const id = String(m.name).replace(/^models\//, "");
      if (!id.startsWith("gemini") || NON_CHAT.test(id)) continue;
      if (!(m.supportedGenerationMethods || []).includes("generateContent")) continue;
      out.push({
        id,
        name: m.displayName || id,
        owner: "Google",
        context: m.inputTokenLimit,
        description: m.description,
        stage: /preview|exp/.test(id) ? "preview" : "stable",
      });
    }
    pageToken = data.nextPageToken || "";
    if (!pageToken) break;
  }
  return out;
}

function sortModels(list: ModelInfo[]) {
  // Neueste Versionen zuerst (Versionsnummer im Namen), stabile vor Vorschau
  const ver = (id: string) => {
    const m = id.match(/(\d+(?:\.\d+)?)/);
    return m ? parseFloat(m[1]) : 0;
  };
  return list.sort((a, b) =>
    (a.stage === b.stage ? 0 : a.stage === "stable" ? -1 : 1) ||
    (b.created || 0) - (a.created || 0) ||
    ver(b.id) - ver(a.id) ||
    a.id.localeCompare(b.id));
}

export async function getCatalog(provider: Provider, force = false): Promise<ModelCatalog> {
  const c = cache[provider];
  const key = getKey(provider);
  if (!force && c && Date.now() - c.fetchedAt < TTL_MS && c.live === !!key) return c;

  if (!key) {
    const cat: ModelCatalog = { provider, models: sortModels(markNew(provider, FALLBACK[provider])), fetchedAt: Date.now(), live: false, error: null };
    cache[provider] = cat;
    return cat;
  }
  try {
    const raw = provider === "groq" ? await fetchGroq(key) : await fetchGoogle(key);
    // Dubletten (z.B. "-latest"-Aliase) entfernen
    const uniq = Array.from(new Map(raw.map((m) => [m.id, m])).values());
    const cat: ModelCatalog = { provider, models: sortModels(markNew(provider, uniq)), fetchedAt: Date.now(), live: true, error: null };
    cache[provider] = cat;
    return cat;
  } catch (e: any) {
    const prev = cache[provider];
    const cat: ModelCatalog = prev?.live
      ? { ...prev, error: e.message }
      : { provider, models: sortModels(markNew(provider, FALLBACK[provider])), fetchedAt: Date.now(), live: false, error: e.message };
    cache[provider] = cat;
    return cat;
  }
}

export function invalidateCatalog(provider: Provider) {
  delete cache[provider];
}

// Im Hintergrund regelmäßig aktualisieren, damit neue Modelle ohne Zutun auftauchen
export function startCatalogRefresher() {
  const tick = () => {
    for (const p of ["groq", "google"] as Provider[]) if (getKey(p)) getCatalog(p, true).catch(() => {});
  };
  setTimeout(tick, 5_000);
  setInterval(tick, 30 * 60_000);
}
