// Key-Pool: beliebig viele API-Keys pro Anbieter. Bei Limit/Fehler wird automatisch
// zum nächsten Key gewechselt, mitten im Agenten-Lauf, ohne Kontext oder Modell zu ändern.
import { randomUUID } from "node:crypto";
import type { Provider, KeyInfo } from "@shared/schema";
import { storage } from "./storage";

type StoredKey = { id: string; key: string; label: string; addedAt: number };
type KeyState = { cooldownUntil: number; lastError: string; lastErrorAt: number; lastUsedAt: number; uses: number; invalid: boolean };

const state = new Map<string, KeyState>();
const current: Record<Provider, string> = { groq: "", google: "" };

function st(id: string): KeyState {
  let s = state.get(id);
  if (!s) state.set(id, (s = { cooldownUntil: 0, lastError: "", lastErrorAt: 0, lastUsedAt: 0, uses: 0, invalid: false }));
  return s;
}

function stored(p: Provider): StoredKey[] {
  const raw = storage.getSetting(`keys_${p}`);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }
  // Migration vom alten Einzel-Key
  const legacy = storage.getSetting(`key_${p}`);
  return legacy ? [{ id: "legacy", key: legacy, label: "Key 1", addedAt: Date.now() }] : [];
}

async function save(p: Provider, list: StoredKey[]) {
  await storage.setSetting(`keys_${p}`, JSON.stringify(list));
  if (storage.getSetting(`key_${p}`)) await storage.setSetting(`key_${p}`, "");
}

/** Alle Keys inkl. Umgebungsvariable (GROQ_API_KEY / GOOGLE_API_KEY, auch kommagetrennt). */
export function allKeys(p: Provider): (StoredKey & { source: "app" | "env" })[] {
  const env = (process.env[p === "groq" ? "GROQ_API_KEY" : "GOOGLE_API_KEY"] || "")
    .split(",").map((k) => k.trim()).filter(Boolean)
    .map((k, i) => ({ id: `env-${i}`, key: k, label: `Umgebung ${i + 1}`, addedAt: 0, source: "env" as const }));
  return [...stored(p).map((k) => ({ ...k, source: "app" as const })), ...env];
}

export const hint = (k?: string) => (k ? `${k.slice(0, 4)}…${k.slice(-4)}` : "");

export function keyInfos(p: Provider): KeyInfo[] {
  const now = Date.now();
  return allKeys(p).map((k) => {
    const s = st(k.id);
    const status: KeyInfo["status"] = s.invalid ? "invalid" : s.cooldownUntil > now ? "cooldown" : "ok";
    return {
      id: k.id, label: k.label, hint: hint(k.key), source: k.source, status,
      active: current[p] === k.id, cooldownUntil: s.cooldownUntil > now ? s.cooldownUntil : 0,
      lastError: s.lastError, lastErrorAt: s.lastErrorAt, lastUsedAt: s.lastUsedAt, uses: s.uses,
    };
  });
}

export async function addKey(p: Provider, key: string, label?: string) {
  const list = stored(p);
  key = key.trim();
  if (list.some((k) => k.key === key)) throw new Error("Dieser Key ist schon gespeichert.");
  list.push({ id: randomUUID().slice(0, 8), key, label: label?.trim() || `Key ${list.length + 1}`, addedAt: Date.now() });
  await save(p, list);
}

export async function removeKey(p: Provider, id: string) {
  await save(p, stored(p).filter((k) => k.id !== id));
  state.delete(id);
  if (current[p] === id) current[p] = "";
}

export async function moveKey(p: Provider, id: string, dir: -1 | 1) {
  const list = stored(p);
  const i = list.findIndex((k) => k.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
  await save(p, list);
}

export function resetKeyState(id: string) {
  state.delete(id);
}

/** Erster nutzbarer Key (für Modellliste etc.). */
export function firstKey(p: Provider): string | undefined {
  const keys = allKeys(p);
  const now = Date.now();
  return (keys.find((k) => k.id === current[p] && !st(k.id).invalid) || keys.find((k) => !st(k.id).invalid && st(k.id).cooldownUntil <= now) || keys[0])?.key;
}

export class ProviderError extends Error {
  constructor(message: string, public status: number, public retryAfterMs = 0, public kind: "rotate" | "context" | "network" | "fatal" = "fatal") {
    super(message);
  }
}

/** Fehler einordnen: Key wechseln, Kontext kürzen oder abbrechen. */
export function classify(status: number, msg: string): ProviderError["kind"] {
  const m = msg.toLowerCase();
  const tpm = /tokens per minute|tpm|rate limit/.test(m);
  if (status === 413 && !tpm) return "context";
  if (/context.?length|context window|maximum context|too many tokens|reduce the length|prompt is too long|input token count|exceeds the maximum/.test(m)) return "context";
  if (status === 413 && tpm) return "context"; // Anfrage größer als das Minutenbudget: kürzen hilft
  if ([401, 402, 403, 408, 409, 425, 429, 500, 502, 503, 504, 529].includes(status) || status === 0) return "rotate";
  if (/api key|api_key|permission|quota|exhausted|billing|rate|overloaded|unavailable|try again/.test(m)) return "rotate";
  return "fatal";
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(t); reject(new Error("Abgebrochen")); }, { once: true });
  });

function cooldownFor(e: ProviderError) {
  if (e.retryAfterMs) return Math.min(e.retryAfterMs, 6 * 3600_000);
  if (e.status === 401 || e.status === 403) return 30 * 60_000;
  if (e.status === 429) return /day|daily|per day|rpd|tpd/i.test(e.message) ? 3600_000 : 60_000;
  return 20_000;
}

/**
 * Führt fn mit einem Key aus und wechselt bei Limit/Fehler automatisch zum nächsten.
 * Sind alle Keys gerade gesperrt, wird auf den frühesten wieder freien gewartet (max. ~2 Min. am Stück).
 */
export async function withKey<T>(p: Provider, fn: (key: string) => Promise<T>, opts: { signal?: AbortSignal; onSwitch?: (info: string) => void } = {}): Promise<T> {
  const name = p === "groq" ? "Groq" : "Google";
  let waitedMs = 0;
  let netFails = 0;
  let lastErr: ProviderError | null = null;
  for (let round = 0; round < 50; round++) {
    const keys = allKeys(p);
    if (!keys.length) throw new Error(`Kein ${name} API-Key hinterlegt. Bitte unter API-Keys eintragen.`);
    const now = Date.now();
    // aktueller Key zuerst, danach in Reihenfolge
    const ci = Math.max(0, keys.findIndex((k) => k.id === current[p]));
    const order = [...keys.slice(ci), ...keys.slice(0, ci)];
    const usable = order.filter((k) => !st(k.id).invalid && st(k.id).cooldownUntil <= now);

    if (!usable.length) {
      const waits = order.filter((k) => !st(k.id).invalid).map((k) => st(k.id).cooldownUntil - now);
      if (!waits.length) throw new Error(`Alle ${name}-Keys sind ungültig. Letzter Fehler: ${lastErr?.message || "-"}`);
      const wait = Math.max(1000, Math.min(...waits));
      if (waitedMs + wait > 150_000) throw new Error(`Alle ${name}-Keys sind gerade im Limit (nächster frei in ${Math.ceil(wait / 1000)} s). Letzter Fehler: ${lastErr?.message || "-"}`);
      opts.onSwitch?.(`Alle ${name}-Keys im Limit, warte ${Math.ceil(wait / 1000)} s`);
      await sleep(wait, opts.signal);
      waitedMs += wait;
      continue;
    }

    const k = usable[0];
    if (current[p] && current[p] !== k.id) opts.onSwitch?.(`Wechsel zu ${name}-Key „${k.label}“`);
    current[p] = k.id;
    const s = st(k.id);
    try {
      s.lastUsedAt = Date.now();
      s.uses++;
      const r = await fn(k.key);
      s.lastError = "";
      return r;
    } catch (err: any) {
      if (opts.signal?.aborted) throw new Error("Abgebrochen");
      const e = err instanceof ProviderError ? err : new ProviderError(String(err?.message || err), 0, 0, "network");
      if (e.kind === "network") {
        // Verbindungsproblem liegt am Netz, nicht am Key: gleich nochmal mit kurzer Pause
        if (++netFails > 4) throw e;
        await sleep(1500 * netFails, opts.signal);
        continue;
      }
      if (e.kind !== "rotate") throw e;
      lastErr = e;
      s.lastError = e.message.slice(0, 300);
      s.lastErrorAt = Date.now();
      // Ungültiger Key (Google meldet das mit 400) -> dauerhaft überspringen bis neu getestet
      if (/api key not valid|invalid api key|invalid_api_key|api_key_invalid/i.test(e.message)) s.invalid = true;
      else s.cooldownUntil = Date.now() + cooldownFor(e);
    }
  }
  throw new Error(`Kein ${name}-Key verfügbar. Letzter Fehler: ${lastErr?.message || "-"}`);
}
