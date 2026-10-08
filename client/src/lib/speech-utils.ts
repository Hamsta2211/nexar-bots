// Reine Hilfsfunktionen für den Sprachchat (ohne Browser-APIs, daher leicht testbar).

/** Markdown/Links/Emojis entfernen, damit die Stimme sauber vorliest. */
export function speakable(src: string): string {
  return src
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " Link ")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/^\s*[-*•]\s+/gm, "")
    .replace(/^\s*\d+\.\s+/gm, "")
    .replace(/[*_~>|]+/g, " ")
    .replace(/\p{Extended_Pictographic}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Schneidet aus einem wachsenden Textpuffer den nächsten sprechbaren Satz ab.
 * Der erste Satz darf kürzer sein, damit die Stimme schneller losgelegt.
 */
export function takeSpeakable(buf: string, final: boolean, first: boolean): { chunk: string; rest: string } | null {
  const min = first ? 14 : 40;
  const re = /[.!?…]+["”')\]]*\s|\n+/g;
  let cut = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(buf))) {
    const end = m.index + m[0].length;
    if (end >= min) { cut = end; break; }
  }
  if (cut < 0) {
    if (final && buf.trim()) return { chunk: buf, rest: "" };
    if (buf.length > 240) {
      const k = Math.max(buf.lastIndexOf(", ", 220), buf.lastIndexOf(" ", 220));
      if (k > 60) return { chunk: buf.slice(0, k + 1), rest: buf.slice(k + 1) };
    }
    return null;
  }
  return { chunk: buf.slice(0, cut), rest: buf.slice(cut) };
}

const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ß/g, "ss");
const letters = (s: string) => fold(s).replace(/[^a-z0-9]/g, "");

function lev(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

/**
 * Sucht den Namen eines Agenten im gesprochenen Text (tolerant gegenüber Erkennungsfehlern
 * bei längeren Namen). Gibt den Agenten und den Rest des Satzes ohne den Namen zurück.
 */
export function findAgent(text: string, agents: { id: number; name: string }[]): { id: number; rest: string } | null {
  const words = text.split(/\s+/).filter(Boolean);
  const clean = words.map(letters);
  let best: { idx: number; id: number; d: number } | null = null;
  for (const a of agents) {
    const name = letters(a.name.split(/\s+/)[0] || "");
    if (name.length < 2) continue;
    const tol = name.length >= 8 ? 2 : name.length >= 5 ? 1 : 0;
    for (let i = 0; i < clean.length; i++) {
      const w = clean[i];
      if (!w) continue;
      const d = w === name || (w.startsWith(name) && w.length <= name.length + 1) ? 0 : lev(w, name);
      if (d <= tol) {
        if (!best || i < best.idx || (i === best.idx && d < best.d)) best = { idx: i, id: a.id, d };
        break;
      }
    }
  }
  if (!best) return null;
  const rest = words.filter((_, i) => i !== best!.idx).join(" ").replace(/^[\s,.:;!?-]+/, "").trim();
  return { id: best.id, rest };
}
