import type { Bot, Provider, ToolId, ToolStep } from "@shared/schema";
import { storage } from "./storage";
import { sshExec } from "./ssh";
import { withKey, firstKey, classify, ProviderError } from "./keys";
import { getCatalog } from "./models";

export const PROVIDER_BASE: Record<Provider, string> = {
  groq: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
  google: "https://generativelanguage.googleapis.com/v1beta/openai",
};

export function getKey(provider: Provider): string | undefined {
  return firstKey(provider);
}

function parseRetryAfter(res: Response, msg: string): number {
  const h = res.headers.get("retry-after");
  if (h && !isNaN(Number(h))) return Number(h) * 1000;
  const m = msg.match(/try again in (?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?/i) || msg.match(/retry in ([\d.]+)s/i);
  if (!m) return 0;
  if (m.length === 2) return Number(m[1]) * 1000;
  return ((Number(m[1] || 0) * 3600) + (Number(m[2] || 0) * 60) + Number(m[3] || 0)) * 1000;
}

/** Ein einzelner Request mit genau einem Key. Wirft ProviderError mit Einordnung. */
async function rawFetch(provider: Provider, key: string, path: string, init: RequestInit = {}, signal?: AbortSignal) {
  let res: Response;
  try {
    const timeout = AbortSignal.timeout(120_000);
    res = await fetch(`${PROVIDER_BASE[provider]}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json", ...(init.headers || {}) },
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
  } catch (e: any) {
    if (signal?.aborted) throw new Error("Abgebrochen");
    throw new ProviderError(`${provider}: Netzwerkfehler (${e?.cause?.message || e?.message || e})`, 0, 0, "network");
  }
  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j?.error?.message || j?.[0]?.error?.message || text;
    } catch {}
    msg = String(msg).slice(0, 500);
    throw new ProviderError(`${provider} ${res.status}: ${msg}`, res.status, parseRetryAfter(res, msg), classify(res.status, msg));
  }
  return JSON.parse(text);
}

async function providerFetch(provider: Provider, path: string, init: RequestInit = {}, keyOverride?: string, opts: { signal?: AbortSignal; onSwitch?: (s: string) => void } = {}) {
  if (keyOverride) return rawFetch(provider, keyOverride, path, init, opts.signal);
  return withKey(provider, (key) => rawFetch(provider, key, path, init, opts.signal), opts);
}

export async function listModels(provider: Provider, keyOverride?: string): Promise<string[]> {
  const data = await providerFetch(provider, "/models", { method: "GET" }, keyOverride);
  let ids: string[] = (data?.data || []).map((m: any) => String(m.id).replace(/^models\//, ""));
  if (provider === "google") ids = ids.filter((id) => id.startsWith("gemini") && !/embedding|tts|image|live|audio/.test(id));
  if (provider === "groq") ids = ids.filter((id) => !/whisper|tts|guard|orpheus|playai/.test(id));
  return ids.sort();
}

// ---------- Tools ----------
type ToolDef = { name: string; description: string; parameters: any; run: (args: any, bot: Bot) => Promise<string> };

const stripHtml = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/\s+/g, " ")
    .trim();

function assertPublicUrl(raw: string) {
  const u = new URL(raw);
  if (!/^https?:$/.test(u.protocol)) throw new Error("Nur http/https erlaubt");
  const h = u.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) {
    throw new Error("Interne Adressen sind gesperrt");
  }
  return u.toString();
}

const MATH_LIST = Object.getOwnPropertyNames(Math);
const MATH_WORDS = new Set(MATH_LIST);

const TOOLBOX: Record<ToolId, ToolDef[]> = {
  datetime: [{
    name: "get_current_time",
    description: "Liefert aktuelles Datum und Uhrzeit. Optional mit IANA-Zeitzone, z.B. Europe/Vienna.",
    parameters: { type: "object", properties: { timezone: { type: "string" } } },
    run: async ({ timezone }) => {
      const tz = timezone || process.env.TZ || "Europe/Vienna";
      return new Date().toLocaleString("de-AT", { timeZone: tz, dateStyle: "full", timeStyle: "long" }) + ` (${tz})`;
    },
  }],
  calculator: [{
    name: "calculate",
    description: "Rechnet einen mathematischen Ausdruck exakt aus. Erlaubt: + - * / % ** ( ) und Math-Funktionen wie sqrt, pow, sin, log, PI.",
    parameters: { type: "object", properties: { expression: { type: "string" } }, required: ["expression"] },
    run: async ({ expression }) => {
      const expr = String(expression).replace(/\^/g, "**");
      const words = expr.match(/[a-zA-Z_]+/g) || [];
      for (const w of words) if (!MATH_WORDS.has(w)) throw new Error(`Nicht erlaubt: ${w}`);
      if (!/^[\d\s+\-*/%().,a-zA-Z_]*$/.test(expr)) throw new Error("Ungültige Zeichen");
      const fn = new Function(...MATH_LIST, `return (${expr});`);
      const val = fn(...MATH_LIST.map((k) => (Math as any)[k]));
      return String(val);
    },
  }],
  fetch_url: [{
    name: "fetch_url",
    description: "Lädt eine Webseite und gibt den lesbaren Text zurück (gekürzt).",
    parameters: { type: "object", properties: { url: { type: "string" } }, required: ["url"] },
    run: async ({ url }) => {
      const res = await fetch(assertPublicUrl(url), {
        headers: { "User-Agent": "Mozilla/5.0 (NexarBots)" },
        signal: AbortSignal.timeout(20_000),
      });
      const ct = res.headers.get("content-type") || "";
      const body = await res.text();
      const text = ct.includes("html") ? stripHtml(body) : body;
      return `Status ${res.status}\n${text.slice(0, 8000)}`;
    },
  }],
  web_search: [{
    name: "web_search",
    description: "Sucht im Web (DuckDuckGo) und liefert Titel, Link und Snippet der Top-Treffer.",
    parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
    run: async ({ query }) => {
      const res = await fetch("https://html.duckduckgo.com/html/", {
        method: "POST",
        body: new URLSearchParams({ q: String(query) }),
        headers: { "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/124 Safari/537.36" },
        signal: AbortSignal.timeout(15_000),
      });
      const html = await res.text();
      const out: string[] = [];
      const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(html)) && out.length < 6) {
        let link = m[1];
        const uddg = /uddg=([^&]+)/.exec(link);
        if (uddg) link = decodeURIComponent(uddg[1]);
        out.push(`- ${stripHtml(m[2])}\n  ${link}\n  ${stripHtml(m[3])}`);
      }
      if (out.length) return out.join("\n");
      // Fallback: Wikipedia (DE + EN), falls DuckDuckGo die Server-IP blockiert
      for (const lang of ["de", "en"]) {
        try {
          const w = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=query&list=search&format=json&srlimit=5&srsearch=${encodeURIComponent(query)}`, {
            headers: { "User-Agent": "NexarBots/1.0" }, signal: AbortSignal.timeout(10_000),
          }).then((r) => r.json());
          for (const r of w?.query?.search || []) {
            out.push(`- ${r.title} (Wikipedia ${lang})\n  https://${lang}.wikipedia.org/wiki/${encodeURIComponent(r.title.replace(/ /g, "_"))}\n  ${stripHtml(r.snippet)}`);
          }
        } catch {}
        if (out.length) break;
      }
      return out.length ? out.join("\n") : "Keine Treffer. Versuche fetch_url mit einer konkreten Seite.";
    },
  }],
  linux_pc: [{
    name: "run_on_my_pc",
    description: "Führt einen Shell-Befehl per SSH auf dem Ubuntu-PC des Nutzers aus und liefert stdout, stderr und Exit-Code. Nutze nicht-interaktive Befehle (z.B. 'apt list --upgradable', 'ls -la ~', 'df -h', 'systemctl status nginx --no-pager'). Kein sudo mit Passwortabfrage. Erkläre vor riskanten Änderungen kurz, was du tust.",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "Bash-Befehl" },
        timeout_seconds: { type: "number", description: "Optional, Standard 60, max 600" },
      },
      required: ["command"],
    },
    run: async ({ command, timeout_seconds }) => {
      const t = Math.min(Math.max(Number(timeout_seconds) || 60, 5), 600) * 1000;
      const r = await sshExec(String(command), { timeoutMs: t });
      const out = [`exit=${r.code}`, r.stdout && `stdout:\n${r.stdout.slice(-6000)}`, r.stderr && `stderr:\n${r.stderr.slice(-2000)}`].filter(Boolean).join("\n");
      return out;
    },
  }],
  memory: [
    {
      name: "save_memory",
      description: "Speichert eine dauerhafte Notiz über den Nutzer oder die Aufgabe, die du später wieder brauchst.",
      parameters: { type: "object", properties: { content: { type: "string" } }, required: ["content"] },
      run: async ({ content }, bot) => {
        await storage.addMemory(bot.id, String(content).slice(0, 1000));
        return "Gespeichert.";
      },
    },
    {
      name: "recall_memories",
      description: "Listet alle gespeicherten Notizen dieses Bots.",
      parameters: { type: "object", properties: {} },
      run: async (_a, bot) => (await storage.listMemories(bot.id)).map((m) => `- ${m.content}`).join("\n") || "Keine Notizen.",
    },
  ],
};

export const TOOL_META: Record<ToolId, { label: string; description: string }> = {
  datetime: { label: "Datum & Zeit", description: "Kennt die aktuelle Uhrzeit in jeder Zeitzone" },
  calculator: { label: "Rechner", description: "Exakte Berechnungen statt Schätzungen" },
  fetch_url: { label: "Webseiten lesen", description: "Lädt und liest beliebige öffentliche URLs" },
  web_search: { label: "Websuche", description: "Sucht aktuelle Infos über DuckDuckGo" },
  memory: { label: "Gedächtnis", description: "Merkt sich Fakten dauerhaft pro Bot" },
  linux_pc: { label: "Mein Linux-PC", description: "Führt Befehle per SSH auf deinem Ubuntu-PC aus" },
};

// ---------- Agent loop ----------
export type ChatMsg = { role: "system" | "user" | "assistant" | "tool"; content: string | null; tool_calls?: any[]; tool_call_id?: string; _h?: number };

const CHARS_PER_TOKEN = 3.2;
const tok = (m: ChatMsg) => Math.ceil(((m.content?.length || 0) + (m.tool_calls ? JSON.stringify(m.tool_calls).length : 0)) / CHARS_PER_TOKEN) + 6;
const totalTok = (ms: ChatMsg[]) => ms.reduce((a, m) => a + tok(m), 0);
const clean = (ms: ChatMsg[]) => ms.map(({ _h, ...m }) => m);

// Gelernte Grenzen pro Modell (z.B. Groq-Minutenbudget kleiner als das Kontextfenster)
const learnedLimit = new Map<string, number>();

async function contextBudget(provider: Provider, model: string) {
  let ctx = provider === "google" ? 1_000_000 : 32_768;
  try {
    const cat = await getCatalog(provider);
    const m = cat.models.find((x) => x.id === model);
    if (m?.context) ctx = m.context;
  } catch {}
  // Reserve für Antwort + Werkzeugdefinitionen; Gemini-Fenster nicht voll ausreizen (Kosten/Latenz)
  let budget = Math.min(Math.floor(ctx * 0.75) - 4096, provider === "google" ? 200_000 : ctx);
  const learned = learnedLimit.get(`${provider}:${model}`);
  if (learned) budget = Math.min(budget, learned);
  return Math.max(2_000, budget);
}

export type RunOpts = {
  summary?: string;                                        // gespeicherte Zusammenfassung älterer Nachrichten
  onCompact?: (summary: string, coveredHistory: number) => void; // wie viele History-Nachrichten jetzt in der Zusammenfassung stecken
  signal?: AbortSignal;
  onEvent?: (text: string) => void;
};

/**
 * Kontext automatisch verkürzen: erst alte Werkzeug-Ergebnisse kürzen, dann ältere
 * Nachrichten vom Modell selbst zusammenfassen lassen. System-Prompt und die letzten
 * Schritte bleiben vollständig erhalten.
 */
async function compact(
  provider: Provider, model: string, msgs: ChatMsg[], target: number, state: { summary: string; covered: number },
  opts: RunOpts, note: (s: string) => void,
): Promise<ChatMsg[]> {
  let out = msgs.map((m) => ({ ...m }));
  // 1) Große Werkzeug-Ergebnisse außerhalb der letzten 6 Nachrichten kürzen
  for (let i = 1; i < out.length - 6; i++) {
    const m = out[i];
    if (m.role === "tool" && (m.content?.length || 0) > 1500) m.content = m.content!.slice(0, 1500) + "\n[… gekürzt, um Kontext zu sparen]";
  }
  if (totalTok(out) <= target) return out;

  // 2) Ältere Nachrichten zusammenfassen. Schnittpunkt nie vor einer tool-Antwort.
  const sys = out[0];
  const rest = out.slice(1);
  let tailTok = 0, split = rest.length;
  for (let i = rest.length - 1; i >= 0; i--) {
    tailTok += tok(rest[i]);
    if (tailTok > target * 0.4 && i < rest.length - 1) break;
    split = i;
  }
  while (split > 0 && split < rest.length && rest[split].role === "tool") split--;
  let head = rest.slice(0, split);
  let tail = rest.slice(split);

  if (!head.length) {
    // Nur wenige, aber riesige Nachrichten: einzelne Inhalte hart kürzen
    const per = Math.floor((target * CHARS_PER_TOKEN * 0.8) / Math.max(1, tail.length));
    tail = tail.map((m) => (m.content && m.content.length > per ? { ...m, content: m.content.slice(0, Math.floor(per * 0.7)) + "\n[… gekürzt …]\n" + m.content.slice(-Math.floor(per * 0.3)) } : m));
    return [sys, ...tail];
  }

  const transcriptParts = head.map((m) => {
    const who = m.role === "tool" ? "Werkzeug-Ergebnis" : m.role === "assistant" ? "Assistent" : m.role === "user" ? "Nutzer" : "System";
    const calls = m.tool_calls?.length ? ` [ruft auf: ${m.tool_calls.map((c: any) => `${c.function?.name}(${String(c.function?.arguments || "").slice(0, 300)})`).join(", ")}]` : "";
    return `${who}:${calls} ${(m.content || "").slice(0, 4000)}`;
  });
  let transcript = transcriptParts.join("\n\n");
  const maxChars = Math.floor(target * CHARS_PER_TOKEN * 0.7);
  if (transcript.length > maxChars) transcript = transcript.slice(0, Math.floor(maxChars * 0.3)) + "\n\n[… Mitte ausgelassen …]\n\n" + transcript.slice(-Math.floor(maxChars * 0.7));

  let summary = "";
  try {
    const data = await providerFetch(provider, "/chat/completions", {
      method: "POST",
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          { role: "system", content: "Du fasst Gesprächsverläufe eines KI-Agenten verlustarm zusammen. Behalte: Ziele des Nutzers, Fakten, Entscheidungen, Zwischenergebnisse von Werkzeugen (Zahlen, Pfade, Befehle, URLs, Fehler), offene Aufgaben und den aktuellen Arbeitsstand. Stichpunkte, auf Deutsch, maximal etwa 600 Wörter." },
          { role: "user", content: `${state.summary ? `Bisherige Zusammenfassung:\n${state.summary}\n\n` : ""}Neuer Verlauf zum Einarbeiten:\n\n${transcript}` },
        ],
      }),
    }, undefined, { signal: opts.signal, onSwitch: note });
    summary = String(data?.choices?.[0]?.message?.content || "").trim();
  } catch (e: any) {
    if (opts.signal?.aborted) throw e;
  }
  if (!summary) summary = (state.summary ? state.summary + "\n" : "") + "(Ältere Nachrichten wurden aus Platzgründen entfernt.)";

  state.summary = summary;
  const coveredNow = head.reduce((mx, m) => (m._h !== undefined ? Math.max(mx, m._h + 1) : mx), 0);
  if (coveredNow > state.covered) state.covered = coveredNow;
  opts.onCompact?.(state.summary, state.covered);
  note(`Kontext verkürzt: ${head.length} ältere Nachrichten zusammengefasst`);

  const baseSys = String(sys.content || "").split("\n\n## Zusammenfassung früherer Gesprächsteile\n")[0];
  return [{ role: "system", content: `${baseSys}\n\n## Zusammenfassung früherer Gesprächsteile\n${summary}` }, ...tail];
}

export async function runAgent(bot: Bot, history: { role: string; content: string }[], opts: RunOpts = {}) {
  const provider = bot.provider as Provider;
  const enabled: ToolId[] = JSON.parse(bot.tools || "[]");
  const defs = enabled.flatMap((t) => TOOLBOX[t] || []);
  const mem = enabled.includes("memory") ? (await storage.listMemories(bot.id)).slice(0, 20) : [];

  const sys = [
    bot.systemPrompt || `Du bist ${bot.name}, ein hilfreicher KI-Agent.`,
    `Aktuelles Datum: ${new Date().toISOString().slice(0, 10)}.`,
    defs.length ? "Nutze deine Werkzeuge aktiv und so oft wie nötig, bis die Aufgabe wirklich erledigt ist. Antworte danach klar und knapp." : "",
    mem.length ? `Bekannte Notizen:\n${mem.map((m) => `- ${m.content}`).join("\n")}` : "",
  ].filter(Boolean).join("\n\n");

  const state = { summary: opts.summary || "", covered: 0 };
  let msgs: ChatMsg[] = [
    { role: "system", content: state.summary ? `${sys}\n\n## Zusammenfassung früherer Gesprächsteile\n${state.summary}` : sys },
    ...history.map((h, i) => ({ role: h.role as any, content: h.content, _h: i })),
  ];
  const steps: ToolStep[] = [];
  const note = (text: string) => {
    steps.push({ tool: "nexar", args: {}, result: text });
    opts.onEvent?.(text);
  };
  let tokens = 0;
  const tools = defs.length
    ? defs.map((d) => ({ type: "function", function: { name: d.name, description: d.description, parameters: d.parameters } }))
    : undefined;
  const toolsTok = tools ? Math.ceil(JSON.stringify(tools).length / CHARS_PER_TOKEN) : 0;

  let lastSig = "", sameCount = 0, forceAnswer = false;

  // Kein Schrittlimit: der Agent arbeitet, bis er eine Antwort ohne Werkzeugaufruf liefert (oder abgebrochen wird).
  for (let step = 0; ; step++) {
    if (opts.signal?.aborted) throw new Error("Abgebrochen");

    let budget = (await contextBudget(provider, bot.model)) - toolsTok;
    if (totalTok(msgs) > budget) msgs = await compact(provider, bot.model, msgs, budget, state, opts, note);

    let data: any;
    for (let attempt = 0; ; attempt++) {
      const body: any = { model: bot.model, messages: clean(msgs), temperature: bot.temperature };
      if (tools && !forceAnswer) { body.tools = tools; body.tool_choice = "auto"; }
      try {
        data = await providerFetch(provider, "/chat/completions", { method: "POST", body: JSON.stringify(body) }, undefined, { signal: opts.signal, onSwitch: note });
        break;
      } catch (e: any) {
        if (!(e instanceof ProviderError) || e.kind !== "context" || attempt >= 5) throw e;
        // Zu groß für Modell oder Minutenbudget: Grenze merken, kürzen, gleicher Schritt nochmal
        const now = totalTok(msgs) + toolsTok;
        const limitMatch = e.message.match(/limit\s*(\d{3,7})/i) || e.message.match(/maximum context length is (\d+)/i);
        const lim = limitMatch ? Number(limitMatch[1]) : 0;
        const newBudget = Math.max(1_500, Math.floor((lim ? Math.min(lim * 0.8, now * 0.7) : now * 0.6)) - toolsTok);
        learnedLimit.set(`${provider}:${bot.model}`, newBudget + toolsTok);
        budget = newBudget;
        msgs = await compact(provider, bot.model, msgs, budget, state, opts, note);
      }
    }

    tokens += data?.usage?.total_tokens || 0;
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error("Leere Antwort vom Modell");
    const calls = msg.tool_calls || [];
    if (!calls.length) {
      return { content: String(msg.content || "").trim() || "(keine Antwort)", steps, tokens, summary: state.summary, covered: state.covered };
    }

    // Schutz gegen Endlosschleifen mit exakt gleichem Aufruf (kein Limit für unterschiedliche Schritte)
    const sig = JSON.stringify(calls.map((c: any) => [c.function?.name, c.function?.arguments]));
    sameCount = sig === lastSig ? sameCount + 1 : 1;
    lastSig = sig;

    msgs.push({ role: "assistant", content: msg.content ?? "", tool_calls: calls });
    for (const call of calls) {
      if (opts.signal?.aborted) throw new Error("Abgebrochen");
      const def = defs.find((d) => d.name === call.function?.name);
      let args: any = {};
      try { args = JSON.parse(call.function?.arguments || "{}"); } catch {}
      let result: string;
      try {
        result = def ? await def.run(args, bot) : `Unbekanntes Werkzeug ${call.function?.name}`;
      } catch (e: any) {
        result = `Fehler: ${e?.message || e}`;
      }
      steps.push({ tool: call.function?.name, args, result: result.slice(0, 1500) });
      opts.onEvent?.(`${call.function?.name}`);
      msgs.push({ role: "tool", tool_call_id: call.id, content: result.slice(0, 30_000) });
    }
    if (sameCount === 3) {
      msgs.push({ role: "user", content: "Hinweis vom System: Du hast denselben Werkzeugaufruf mehrmals hintereinander mit identischen Argumenten gemacht. Ändere den Ansatz oder antworte mit dem, was du hast." });
    }
    if (sameCount >= 6) forceAnswer = true;
    else forceAnswer = false;
  }
}
