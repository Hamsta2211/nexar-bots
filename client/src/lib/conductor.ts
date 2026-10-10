// Gesprächsablauf des Voice-Chats als reine Zustandsmaschine (frameweise getaktet, daher ohne Browser testbar).
import { FRAME_MS, Vad, concatFrames } from "./audio-utils";

export type Phase = "off" | "listening" | "armed" | "greeting" | "capturing" | "transcribing" | "thinking" | "speaking";

export type Fx = {
  greet: (agentId: number) => void;                                              // „Ja“ sprechen, danach greetDone()
  transcribe: (pcm: Int16Array, purpose: "command" | "name", req: number) => void;// danach transcribed(req, text)
  ask: (agentId: number, text: string) => void;                                  // Agent fragen, danach speaking()/agentDone()
  change: (s: Snapshot) => void;
  note: (msg: string) => void;
};

export type Snapshot = {
  phase: Phase; target: number | null;
  recording: boolean;        // es wird gerade eine Äußerung aufgenommen
  silenceMs: number;         // Stille seit dem letzten Sprachanteil (nur während der Aufnahme)
  endInMs: number | null;    // Restzeit bis zum Senden
  level: number;
  followup: boolean;
};

export type Cfg = {
  endSilenceMs: number;        // Stille, nach der gesendet wird (2000)
  followupMs: number;          // wie lange nach einer Rückfrage auf den Sprecher gewartet wird (2000)
  commandWaitMs: number;       // nach „Ja“: maximale Wartezeit auf den Befehl
  armMs: number;               // nach Hotword: so lange auf direkt weitersprechen warten, bevor „Ja“ kommt
  minSpeechMs: number;
  maxUtteranceMs: number;
  solo: boolean;               // fester Agent, Dauergespräch ohne Namen
  nameFallback: boolean;       // Namen per Spracherkennung suchen (für Agenten ohne Hotword-Modell)
};

export const DEFAULT_CFG: Cfg = {
  endSilenceMs: 1850, followupMs: 2000, commandWaitMs: 8000, armMs: 400, minSpeechMs: 350, maxUtteranceMs: 45_000,
  solo: false, nameFallback: false,
};

type Cap = {
  began: boolean; frames: Int16Array[]; speechMs: number; lastSpeechT: number; startT: number;
  waitMs: number | null; inline: boolean; purpose: "command" | "name";
};

export class Conductor {
  phase: Phase = "off";
  target: number | null = null;
  private t = 0;
  private vad = new Vad();
  private ring: Int16Array[] = [];
  private cap: Cap | null = null;
  private armedAt = 0;
  private req = 0;
  private followup = false;
  private lastSnap = "";

  constructor(private fx: Fx, public cfg: Cfg, private find: (text: string) => { id: number; rest: string; idx: number } | null) {}

  // ---------- Steuerung ----------
  start(soloTarget?: number) {
    this.t = 0; this.ring = []; this.cap = null; this.vad.reset();
    this.target = soloTarget ?? null;
    this.followup = false;
    if (this.cfg.solo && soloTarget != null) this.beginWaiting("command", null);
    else this.setPhase("listening");
  }
  stop() { this.phase = "off"; this.target = null; this.cap = null; this.followup = false; this.req++; this.emit(true); }

  /** Soll der Hotword-Dienst gerade Audio bekommen? */
  wantsWake() {
    return !this.cfg.solo && (this.phase === "listening" || this.phase === "armed" || this.phase === "capturing");
  }
  micActive() { return this.phase === "listening" || this.phase === "armed" || this.phase === "capturing"; }

  // ---------- Ereignisse von außen ----------
  onHit(agentId: number) {
    if (this.cfg.solo) return;
    if (!["listening", "armed", "capturing"].includes(this.phase)) return;
    if (this.phase === "capturing" && this.target === agentId && this.cap?.began && this.cap.purpose === "command") return;
    if (this.phase === "armed" && this.target === agentId) return;
    this.target = agentId;
    this.followup = false;
    this.cap = null;
    this.armedAt = this.t;
    this.setPhase("armed");
    if (this.vad.inSpeech) this.beginInline();
  }

  greetDone() {
    if (this.phase !== "greeting") return;
    this.vad.reset();
    this.beginWaiting("command", this.cfg.commandWaitMs);
  }

  transcribed(req: number, text: string) {
    if (req !== this.req || this.phase !== "transcribing") return;
    const purpose = this.cap?.purpose || "command";
    const inline = !!this.cap?.inline;
    this.cap = null;
    text = text.trim();
    if (!text) {
      this.fx.note("Nichts verstanden.");
      return this.backToIdle();
    }
    const f0 = this.cfg.solo ? null : this.find(text);
    const f = f0 && f0.idx <= (purpose === "name" ? 3 : 2) ? f0 : null;
    if (purpose === "name") {
      if (!f) { this.fx.note("Kein Agentenname erkannt."); return this.backToIdle(); }
      this.target = f.id;
      return f.rest ? this.askNow(f.rest) : this.greet();
    }
    // Befehl für den aktuellen Ziel-Agenten; ein genannter anderer Name ersetzt das Ziel
    if (f && (f.id !== this.target || inline)) { this.target = f.id; text = f.rest; }
    else if (f && f.id === this.target) text = f.rest || text;
    if (!text.trim()) return inline || !this.cfg.solo ? this.greet() : this.beginWaiting("command", null);
    this.askNow(text);
  }

  /** Eingabe per Tastatur: direkt an den Agenten, ohne Aufnahme. */
  external(agentId: number) { this.target = agentId; this.cap = null; this.followup = false; this.req++; this.setPhase("thinking"); }

  speaking() { if (this.phase === "thinking") this.setPhase("speaking"); }

  agentDone(expect: boolean) {
    if (this.phase === "off") return;
    this.vad.reset();
    if (this.cfg.solo) return this.beginWaiting("command", null);
    if (expect && this.target != null) { this.followup = true; return this.beginWaiting("command", this.cfg.followupMs); }
    this.backToIdle();
  }

  agentFailed() { if (this.phase !== "off") { this.cfg.solo ? this.beginWaiting("command", null) : this.backToIdle(); } }

  // ---------- Frames ----------
  frame(f: Int16Array) {
    this.t += FRAME_MS;
    if (this.phase === "off") return;
    if (!this.micActive()) return;
    const v = this.vad.process(f);
    this.ring.push(f);
    if (this.ring.length > 150) this.ring.shift();

    if (this.phase === "armed") {
      if (v.speech) this.beginInline();
      else if (this.t - this.armedAt >= this.cfg.armMs) return this.greet();
      return this.emit();
    }
    if (this.phase === "listening" && !this.cfg.nameFallback) return this.emit();
    if (this.phase === "listening" && !this.cap) this.beginWaiting("name", null);
    const c = this.cap;
    if (!c) return;

    if (!c.began) {
      if (this.vad.speechRun >= 3) {
        c.began = true;
        c.frames = this.ring.slice(-Math.ceil((c.inline ? 2000 : 400) / FRAME_MS));
        c.startT = this.t; c.lastSpeechT = this.t; c.speechMs = 0;
      } else if (c.waitMs != null && this.t - c.startT >= c.waitMs) {
        this.fx.note(this.followup ? "" : "Keine Eingabe.");
        return this.backToIdle();
      }
      return this.emit();
    }
    c.frames.push(f);
    if (v.speech) { c.lastSpeechT = this.t; c.speechMs += FRAME_MS; }
    const silence = this.t - c.lastSpeechT;
    if (silence >= this.cfg.endSilenceMs || this.t - c.startT >= this.cfg.maxUtteranceMs) {
      if (c.speechMs < this.cfg.minSpeechMs) {            // nur ein Geräusch: weiter warten
        this.cap = null;
        if (this.cfg.solo || this.phase === "capturing") this.beginWaiting(c.purpose, c.waitMs == null ? null : Math.max(500, c.waitMs - (this.t - c.startT)));
        else this.setPhase("listening");
        return;
      }
      // Stille am Ende stutzen (300 ms Rest lassen)
      const keepTail = Math.ceil(300 / FRAME_MS);
      const cut = Math.max(0, Math.floor((this.t - c.lastSpeechT) / FRAME_MS) - keepTail);
      const used = cut > 0 ? c.frames.slice(0, c.frames.length - cut) : c.frames;
      this.setPhase("transcribing");
      this.fx.transcribe(concatFrames(used), c.purpose, ++this.req);
      return;
    }
    this.emit();
  }

  // ---------- intern ----------
  private beginWaiting(purpose: "command" | "name", waitMs: number | null) {
    this.cap = { began: false, frames: [], speechMs: 0, lastSpeechT: this.t, startT: this.t, waitMs, inline: false, purpose };
    this.setPhase(purpose === "name" ? "listening" : "capturing");
  }
  private beginInline() {
    this.cap = { began: true, frames: this.ring.slice(-Math.ceil(2000 / FRAME_MS)), speechMs: 0, lastSpeechT: this.t, startT: this.t, waitMs: null, inline: true, purpose: "command" };
    this.setPhase("capturing");
  }
  private greet() {
    this.cap = null;
    this.setPhase("greeting");
    if (this.target != null) this.fx.greet(this.target);
  }
  private askNow(text: string) {
    this.setPhase("thinking");
    this.followup = false;
    if (this.target != null) this.fx.ask(this.target, text);
  }
  private backToIdle() {
    this.cap = null;
    this.followup = false;
    if (this.cfg.solo) return this.beginWaiting("command", null);
    this.target = null;
    this.setPhase("listening");
  }
  private setPhase(p: Phase) { this.phase = p; this.emit(true); }

  private emit(force = false) {
    const c = this.cap;
    const recording = !!c?.began;
    const silenceMs = recording ? this.t - c!.lastSpeechT : 0;
    const waiting = !!c && !c.began && c.waitMs != null;
    const snap: Snapshot = {
      phase: this.phase, target: this.target, recording, silenceMs,
      endInMs: recording ? Math.max(0, this.cfg.endSilenceMs - silenceMs) : waiting ? Math.max(0, c!.waitMs! - (this.t - c!.startT)) : null,
      level: this.vad.level, followup: this.followup,
    };
    const key = `${snap.phase}|${snap.target}|${snap.recording}|${Math.round(snap.silenceMs / 100)}|${Math.round(snap.level * 40)}|${snap.followup}|${snap.endInMs == null ? "" : Math.round(snap.endInMs / 100)}`;
    if (!force && key === this.lastSnap) return;
    this.lastSnap = key;
    this.fx.change(snap);
  }
}
