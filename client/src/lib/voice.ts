import { API_BASE, authHeaders } from "./queryClient";

const SILENT_WAV = "data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA=";

export function speechSupported(): boolean {
  const w = window as any;
  return !!(w.SpeechRecognition || w.webkitSpeechRecognition);
}

type Item = { text: string; blob: Promise<string | null>; slot: number };

/**
 * Spielt Sprachausgabe satzweise ab: Sätze werden sofort beim Server (Python/edge-tts) angefragt,
 * während der vorherige noch läuft. Fällt der Dienst aus, springt die Browser-Stimme ein.
 */
export class TtsPlayer {
  private audio = new Audio();
  private queue: Item[] = [];
  private busy = false;
  private gen = 0;
  private cancelPlay: (() => void) | null = null;
  speaking = false;
  usedFallback = false;
  onSpeaking: (on: boolean) => void = () => {};
  onIdle: () => void = () => {};

  /** Muss einmal in einem Klick/Tipp aufgerufen werden, sonst blockiert der Browser die Wiedergabe. */
  unlock() {
    try {
      this.audio.src = SILENT_WAV;
      void this.audio.play().catch(() => {});
    } catch {}
    try { window.speechSynthesis?.getVoices(); } catch {}
  }

  hasPending() {
    return this.busy || this.queue.length > 0;
  }

  enqueue(text: string, voice: string, slot = 0) {
    this.queue.push({ text, slot, blob: this.fetchAudio(text, voice) });
    void this.pump();
  }

  stop() {
    this.gen++;
    for (const it of this.queue) it.blob.then((u) => u && URL.revokeObjectURL(u)).catch(() => {});
    this.queue = [];
    try { this.audio.pause(); } catch {}
    this.cancelPlay?.();
    this.cancelPlay = null;
    try { window.speechSynthesis?.cancel(); } catch {}
    const was = this.speaking;
    this.busy = false;
    this.speaking = false;
    if (was) this.onSpeaking(false);
  }

  private async fetchAudio(text: string, voice: string): Promise<string | null> {
    try {
      const res = await fetch(`${API_BASE}/api/tts`, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        credentials: "same-origin",
        body: JSON.stringify({ text, voice }),
      });
      if (!res.ok) return null;
      const b = await res.blob();
      return b.size ? URL.createObjectURL(b) : null;
    } catch {
      return null;
    }
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    const gen = this.gen;
    while (this.queue.length && gen === this.gen) {
      const item = this.queue.shift()!;
      const url = await item.blob;
      if (gen !== this.gen) { if (url) URL.revokeObjectURL(url); return; }
      if (!this.speaking) { this.speaking = true; this.onSpeaking(true); }
      if (url) await this.playUrl(url);
      else await this.speakFallback(item.text, item.slot);
    }
    if (gen !== this.gen) return;
    this.busy = false;
    if (this.speaking) { this.speaking = false; this.onSpeaking(false); }
    this.onIdle();
  }

  private playUrl(url: string) {
    return new Promise<void>((resolve) => {
      const a = this.audio;
      const done = () => {
        a.onended = null; a.onerror = null;
        this.cancelPlay = null;
        URL.revokeObjectURL(url);
        resolve();
      };
      this.cancelPlay = done;
      a.onended = done;
      a.onerror = done;
      a.src = url;
      a.play().catch(done);
    });
  }

  private speakFallback(text: string, slot: number) {
    return new Promise<void>((resolve) => {
      const synth = window.speechSynthesis;
      if (!synth) return resolve();
      this.usedFallback = true;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = "de-DE";
      const de = synth.getVoices().filter((v) => v.lang.toLowerCase().startsWith("de"));
      if (de.length) u.voice = de[slot % de.length];
      const done = () => { this.cancelPlay = null; resolve(); };
      u.onend = done;
      u.onerror = done;
      this.cancelPlay = () => { try { synth.cancel(); } catch {} done(); };
      synth.speak(u);
    });
  }
}

type ListenerCb = {
  onInterim: (t: string) => void;
  onFinal: (t: string) => void;
  onState: (s: "on" | "off" | "error", msg?: string) => void;
};

/** Dauerhaftes Zuhören per Browser-Spracherkennung (Chrome, Edge, Safari). */
export class Listener {
  private rec: any = null;
  private want = false;
  private paused = false;
  constructor(private lang: string, private cb: ListenerCb) {}

  start() { this.want = true; this.paused = false; this.boot(); }
  pause() { this.paused = true; this.kill(); }
  resume() { if (!this.want) return; this.paused = false; this.boot(); }
  stop() { this.want = false; this.kill(); this.cb.onState("off"); }

  private kill() {
    const r = this.rec;
    this.rec = null;
    if (!r) return;
    try { r.onend = null; r.onresult = null; r.onerror = null; r.abort(); } catch {}
  }

  private boot() {
    const w = window as any;
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition;
    if (!SR || !this.want || this.paused) return;
    this.kill();
    const r = new SR();
    r.lang = this.lang;
    r.continuous = true;
    r.interimResults = true;
    r.maxAlternatives = 1;
    r.onresult = (e: any) => {
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const t = String(res[0]?.transcript || "");
        if (res.isFinal) { if (t.trim()) this.cb.onFinal(t.trim()); }
        else interim += t;
      }
      if (interim.trim()) this.cb.onInterim(interim.trim());
    };
    r.onerror = (e: any) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.want = false;
        this.cb.onState("error", "Mikrofon-Zugriff verweigert – bitte im Browser erlauben.");
      }
    };
    r.onend = () => {
      if (this.rec !== r) return;
      this.rec = null;
      if (this.want && !this.paused) setTimeout(() => this.boot(), 300);
    };
    try {
      r.start();
      this.rec = r;
      this.cb.onState("on");
    } catch {
      setTimeout(() => this.boot(), 600);
    }
  }
}
