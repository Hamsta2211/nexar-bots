// Gedanken-Blöcke trennen: <denken>…</denken> (unser Prompt) sowie <think>/<thinking> (viele Modelle von selbst).
// Reine Funktionen ohne Abhängigkeiten – wird von Server und Client benutzt.

const OPEN = ["<denken>", "<think>", "<thinking>"];
const CLOSE: Record<string, string> = { "<denken>": "</denken>", "<think>": "</think>", "<thinking>": "</thinking>" };

export type ThinkPart = { kind: "think" | "text"; text: string; open?: boolean };

/** Länge des Endstücks von s, das ein echtes Präfix eines der Tags ist (muss zurückgehalten werden). */
function partialTail(s: string, tags: string[]): number {
  const max = Math.min(s.length, 12);
  for (let n = max; n > 0; n--) {
    const tail = s.slice(-n).toLowerCase();
    if (tags.some((t) => t.length > n && t.startsWith(tail))) return n;
  }
  return 0;
}

export class ThinkFilter {
  private buf = "";
  private mode: "text" | "think" = "text";
  private closeTag = "";
  constructor(private cb: { onText: (t: string) => void; onThink: (t: string) => void; onThinkEnd: () => void }) {}

  push(chunk: string) {
    this.buf += chunk;
    for (;;) {
      if (this.mode === "text") {
        const low = this.buf.toLowerCase();
        let at = -1, tag = "";
        for (const t of OPEN) {
          const i = low.indexOf(t);
          if (i >= 0 && (at < 0 || i < at)) { at = i; tag = t; }
        }
        if (at >= 0) {
          if (at > 0) this.cb.onText(this.buf.slice(0, at));
          this.buf = this.buf.slice(at + tag.length);
          this.mode = "think";
          this.closeTag = CLOSE[tag];
          continue;
        }
        const keep = partialTail(this.buf, OPEN);
        const emit = this.buf.slice(0, this.buf.length - keep);
        if (emit) this.cb.onText(emit);
        this.buf = this.buf.slice(this.buf.length - keep);
        return;
      }
      const low = this.buf.toLowerCase();
      const i = low.indexOf(this.closeTag);
      if (i >= 0) {
        if (i > 0) this.cb.onThink(this.buf.slice(0, i));
        this.buf = this.buf.slice(i + this.closeTag.length).replace(/^\s*\n/, "");
        this.mode = "text";
        this.cb.onThinkEnd();
        continue;
      }
      const keep = partialTail(this.buf, [this.closeTag]);
      const emit = this.buf.slice(0, this.buf.length - keep);
      if (emit) this.cb.onThink(emit);
      this.buf = this.buf.slice(this.buf.length - keep);
      return;
    }
  }

  /** Stream zu Ende: Rest ausgeben. Gibt true zurück, falls ein Gedankenblock nie geschlossen wurde. */
  end(): boolean {
    const wasThink = this.mode === "think";
    if (this.buf) (wasThink ? this.cb.onThink : this.cb.onText)(this.buf);
    this.buf = "";
    if (wasThink) this.cb.onThinkEnd();
    this.mode = "text";
    return wasThink;
  }
}

/** Kompletten Text in Gedanken- und Antwortteile zerlegen. */
export function splitThinking(content: string): { parts: ThinkPart[]; answer: string; thoughts: string[] } {
  const parts: ThinkPart[] = [];
  let cur: ThinkPart | null = null;
  const add = (kind: "think" | "text", t: string) => {
    if (!cur || cur.kind !== kind) { cur = { kind, text: "" }; parts.push(cur); }
    cur.text += t;
  };
  const f = new ThinkFilter({
    onText: (t) => add("text", t),
    onThink: (t) => add("think", t),
    onThinkEnd: () => { cur = null; },
  });
  f.push(content);
  const unclosed = f.end();
  if (unclosed) { const last = parts[parts.length - 1]; if (last?.kind === "think") last.open = true; }
  for (const p of parts) p.text = p.text.trim();
  let clean = parts.filter((p) => p.text);
  // Modell hat ein Tag nicht geschlossen und sonst nichts geschrieben: der "Gedanke" ist die Antwort.
  if (!clean.some((p) => p.kind === "text")) {
    const last = clean[clean.length - 1];
    if (last?.kind === "think" && last.open) { last.kind = "text"; last.open = false; }
  }
  const answer = clean.filter((p) => p.kind === "text").map((p) => p.text).join("\n\n").trim();
  const thoughts = clean.filter((p) => p.kind === "think").map((p) => p.text);
  return { parts: clean, answer, thoughts };
}

// ---- Marker „Antwort erwartet“ ----
export const EXPECT_MARK = "[[ANTWORT]]";
const MARK_RE = /\s*\[\[\s*ANTWORT\s*\]\]\s*/gi;

export const hasExpectMark = (s: string) => /\[\[\s*ANTWORT\s*\]\]/i.test(s);
export const stripExpectMark = (s: string) => s.replace(MARK_RE, " ").trim();

/** Streaming-Filter, der den Marker nie sichtbar durchlässt. */
export class MarkFilter {
  private buf = "";
  seen = false;
  constructor(private out: (t: string) => void) {}
  push(t: string) {
    this.buf += t;
    if (hasExpectMark(this.buf)) { this.seen = true; this.buf = this.buf.replace(MARK_RE, " "); }
    const PRE = /^\[\[?\s*A?N?T?W?O?R?T?\s*\]?\]?$/i;
    for (let i = Math.max(0, this.buf.length - 14); i < this.buf.length; i++) {
      if (this.buf[i] === "[" && PRE.test(this.buf.slice(i))) {
        const emit = this.buf.slice(0, i);
        this.buf = this.buf.slice(i);
        if (emit) this.out(emit);
        return;
      }
    }
    if (this.buf) this.out(this.buf);
    this.buf = "";
  }
  end() { if (this.buf && !/^\[\[?\s*A?N?T?W?O?R?T?\s*\]?\]?$/i.test(this.buf)) this.out(this.buf); this.buf = ""; }
}
