import { API_BASE, authHeaders } from "./queryClient";

export type StreamHandlers = {
  onStart?: (conversationId: number) => void;
  onToken?: (text: string) => void;
  onReset?: () => void;
  onEvent?: (text: string) => void;
  onDone?: (message: any) => void;
  onError?: (message: string) => void;
};

/** Chat per Server-Sent Events: Antwort erscheint Wort für Wort. Abbrechen über den AbortSignal. */
export async function streamChat(
  botId: number,
  body: { message: string; conversationId?: number | null; voice?: boolean },
  h: StreamHandlers,
  signal?: AbortSignal,
) {
  const res = await fetch(`${API_BASE}/api/bots/${botId}/chat/stream`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
    credentials: "same-origin",
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) {
    let m = res.statusText || "Fehler";
    try { m = (await res.json()).message || m; } catch {}
    throw new Error(m);
  }
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n\n")) >= 0) {
      const block = buf.slice(0, i);
      buf = buf.slice(i + 2);
      const line = block.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      let ev: any;
      try { ev = JSON.parse(line.slice(5).trim()); } catch { continue; }
      switch (ev.type) {
        case "start": h.onStart?.(ev.conversationId); break;
        case "token": h.onToken?.(ev.t); break;
        case "reset": h.onReset?.(); break;
        case "event": h.onEvent?.(ev.text); break;
        case "done": h.onDone?.(ev.message); break;
        case "error": h.onError?.(String(ev.error || "Fehler")); break;
      }
    }
  }
}
