// Reine Audio-Helfer (ohne Browser-APIs, testbar): Resampling auf 16 kHz, Pegelerkennung, WAV.

export const FRAME = 320;       // 20 ms bei 16 kHz
export const FRAME_MS = 20;

/** Streaming-Resampler (Mittelwert über die Eingangsabtastwerte je Ausgabewert) -> Int16 mono 16 kHz. */
export class Resampler {
  private ratio: number;
  private pos = 0;          // Position (in Eingangssamples) des nächsten Ausgabewerts relativ zum Puffer
  private buf: Float32Array = new Float32Array(0);
  constructor(inRate: number, private outRate = 16000) { this.ratio = inRate / outRate; }

  push(x: Float32Array): Int16Array {
    const all = new Float32Array(this.buf.length + x.length);
    all.set(this.buf); all.set(x, this.buf.length);
    const out: number[] = [];
    let p = this.pos;
    const r = this.ratio;
    while (p + r <= all.length) {
      const a = Math.floor(p), b = Math.min(all.length, Math.ceil(p + r));
      let s = 0, n = 0;
      for (let i = a; i < b; i++) { s += all[i]; n++; }
      const v = n ? s / n : 0;
      out.push(Math.max(-1, Math.min(1, v)) * 32767);
      p += r;
    }
    const drop = Math.floor(p);
    this.buf = all.slice(drop);
    this.pos = p - drop;
    return Int16Array.from(out);
  }
}

/** Zerlegt einen Strom von Int16-Blöcken in feste Frames. */
export class Framer {
  private rest = new Int16Array(0);
  constructor(private size = FRAME) {}
  push(x: Int16Array, cb: (f: Int16Array) => void) {
    const all = new Int16Array(this.rest.length + x.length);
    all.set(this.rest); all.set(x, this.rest.length);
    let i = 0;
    for (; i + this.size <= all.length; i += this.size) cb(all.slice(i, i + this.size));
    this.rest = all.slice(i);
  }
}

export const rms = (f: Int16Array) => {
  let s = 0;
  for (let i = 0; i < f.length; i++) s += f[i] * f[i];
  return Math.sqrt(s / Math.max(1, f.length)) / 32768;
};

/** Einfache adaptive Sprach-Erkennung auf Basis des Pegels (Rauschboden folgt der Umgebung). */
export class Vad {
  floor = 0.004;
  inSpeech = false;
  speechRun = 0;     // aufeinanderfolgende Sprach-Frames
  hang = 0;          // Nachlauf in Frames
  level = 0;
  constructor(private hangFrames = 8, private minOn = 0.016) {}

  process(f: Int16Array): { speech: boolean; level: number } {
    const r = rms(f);
    this.level = r;
    const on = Math.max(this.minOn, this.floor * 3.2);
    const off = Math.max(this.minOn * 0.65, this.floor * 2.0);
    const loud = this.inSpeech ? r > off : r > on;
    if (loud) {
      this.speechRun++;
      this.hang = this.hangFrames;
    } else {
      this.speechRun = 0;
      if (this.hang > 0) this.hang--;
      // Rauschboden nur in Ruhe nachführen
      this.floor = Math.min(0.05, Math.max(0.002, r < this.floor * 1.6 ? this.floor * 0.9 + r * 0.1 : this.floor * 1.002));
    }
    this.inSpeech = loud || this.hang > 0;
    return { speech: this.inSpeech, level: r };
  }
  reset() { this.inSpeech = false; this.speechRun = 0; this.hang = 0; }
}

export function wavFromInt16(pcm: Int16Array, rate = 16000): Uint8Array {
  const out = new Uint8Array(44 + pcm.length * 2);
  const dv = new DataView(out.buffer);
  const w = (o: number, s: string) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  w(0, "RIFF"); dv.setUint32(4, 36 + pcm.length * 2, true); w(8, "WAVE"); w(12, "fmt ");
  dv.setUint32(16, 16, true); dv.setUint16(20, 1, true); dv.setUint16(22, 1, true);
  dv.setUint32(24, rate, true); dv.setUint32(28, rate * 2, true); dv.setUint16(32, 2, true); dv.setUint16(34, 16, true);
  w(36, "data"); dv.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) dv.setInt16(44 + i * 2, pcm[i], true);
  return out;
}

export function concatFrames(frames: Int16Array[]): Int16Array {
  const n = frames.reduce((a, f) => a + f.length, 0);
  const out = new Int16Array(n);
  let o = 0;
  for (const f of frames) { out.set(f, o); o += f.length; }
  return out;
}
