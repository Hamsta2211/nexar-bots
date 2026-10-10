import { API_BASE, authHeaders, apiRequest } from "./queryClient";
import { concatFrames, wavFromInt16 } from "./audio-utils";

export type WakeStatus = {
  available: boolean; serviceUp: boolean;
  agents: Record<string, { trained: boolean; at: number; stats: any; training: { state: string; error?: string } | null; samples: { pos: number; neg: number } }>;
};

export const getWakeStatus = async (): Promise<WakeStatus> => (await apiRequest("GET", "/api/wake/status")).json();

/** Schickt den Audiostrom in 320-ms-Paketen an den Hotword-Dienst (Render) und meldet Treffer. */
export class WakeFeeder {
  onHit: (agentId: number, scores: Record<string, number>) => void = () => {};
  onScores: (s: Record<string, number>) => void = () => {};
  onUnavailable: () => void = () => {};
  private sid = Math.random().toString(36).slice(2, 10);
  private pending: Int16Array[] = [];
  private queue: Int16Array[] = [];
  private busy = false;
  private active = false;
  private fails = 0;

  setActive(on: boolean) {
    if (on === this.active) return;
    this.active = on;
    this.pending = []; this.queue = [];
    if (on) void fetch(`${API_BASE}/api/wake/reset?sid=${this.sid}`, { method: "POST", headers: authHeaders(), credentials: "same-origin" }).catch(() => {});
  }

  push(f: Int16Array) {
    if (!this.active) return;
    this.pending.push(f);
    if (this.pending.length >= 16) {
      this.queue.push(concatFrames(this.pending));
      this.pending = [];
      if (this.queue.length > 8) this.queue.shift();
      void this.pump();
    }
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length && this.active) {
        const chunk = this.queue.shift()!;
        let res: Response;
        try {
          res = await fetch(`${API_BASE}/api/wake/feed?sid=${this.sid}`, {
            method: "POST", headers: { "Content-Type": "application/octet-stream", ...authHeaders() }, credentials: "same-origin",
            body: new Blob([chunk.buffer.slice(chunk.byteOffset, chunk.byteOffset + chunk.byteLength) as ArrayBuffer]),
          });
        } catch { if (++this.fails >= 4) { this.fails = 0; this.onUnavailable(); } continue; }
        if (!res.ok) { if (++this.fails >= 3) { this.fails = 0; this.onUnavailable(); } continue; }
        this.fails = 0;
        const j = await res.json().catch(() => null);
        if (!j) continue;
        this.onScores(j.scores || {});
        if (this.active && j.hits?.length) this.onHit(Number(j.hits[0]), j.scores || {});
      }
    } finally { this.busy = false; }
  }
}

/** Gesprochenes in Text umwandeln (Groq Whisper über den Server). */
export async function transcribe(pcm: Int16Array, hint: string): Promise<string> {
  const wav = wavFromInt16(pcm);
  const res = await fetch(`${API_BASE}/api/stt?lang=de&hint=${encodeURIComponent(hint)}`, {
    method: "POST", headers: { "Content-Type": "audio/wav", ...authHeaders() }, credentials: "same-origin",
    body: new Blob([wav.buffer as ArrayBuffer]),
  });
  if (!res.ok) {
    let m = res.statusText;
    try { m = (await res.json()).message || m; } catch {}
    throw new Error(m);
  }
  return String((await res.json()).text || "");
}

export async function uploadSample(agentId: number, kind: "pos" | "neg", pcm: Int16Array) {
  const res = await fetch(`${API_BASE}/api/wake/sample?agent=${agentId}&kind=${kind}`, {
    method: "POST", headers: { "Content-Type": "application/octet-stream", ...authHeaders() }, credentials: "same-origin",
    body: new Blob([pcm.buffer.slice(pcm.byteOffset, pcm.byteOffset + pcm.byteLength) as ArrayBuffer]),
  });
  if (!res.ok) { let m = res.statusText; try { m = (await res.json()).message || m; } catch {} throw new Error(m); }
  return res.json() as Promise<{ pos: number; neg: number }>;
}
