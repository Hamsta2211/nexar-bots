import { Framer, Resampler } from "./audio-utils";

const WORKLET = `
class NexarCap extends AudioWorkletProcessor {
  constructor(){ super(); this.b=new Float32Array(1024); this.n=0; }
  process(inputs){
    const c=inputs[0] && inputs[0][0];
    if(c){ for(let i=0;i<c.length;i++){ this.b[this.n++]=c[i]; if(this.n===1024){ this.port.postMessage(this.b.slice(0)); this.n=0; } } }
    return true;
  }
}
registerProcessor('nexar-cap', NexarCap);`;

/** Mikrofon als 16-kHz-Mono-Strom in 20-ms-Frames (Int16). Echo-/Rauschunterdrückung des Browsers aktiv. */
export class Mic {
  onFrame: (f: Int16Array) => void = () => {};
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private node: AudioNode | null = null;
  running = false;

  async start() {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Mikrofon wird von diesem Browser/Kontext nicht unterstützt (HTTPS nötig).");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 },
    });
    const AC: typeof AudioContext = (window as any).AudioContext || (window as any).webkitAudioContext;
    this.ctx = new AC();
    await this.ctx.resume().catch(() => {});
    const src = this.ctx.createMediaStreamSource(this.stream);
    const rs = new Resampler(this.ctx.sampleRate, 16000);
    const fr = new Framer();
    const feed = (x: Float32Array) => {
      const pcm = rs.push(x);
      if (pcm.length) fr.push(pcm, (f) => this.onFrame(f));
    };
    const mute = this.ctx.createGain();
    mute.gain.value = 0;
    let ok = false;
    if (this.ctx.audioWorklet) {
      try {
        const url = URL.createObjectURL(new Blob([WORKLET], { type: "application/javascript" }));
        await this.ctx.audioWorklet.addModule(url);
        URL.revokeObjectURL(url);
        const n = new AudioWorkletNode(this.ctx, "nexar-cap");
        n.port.onmessage = (e) => feed(e.data as Float32Array);
        src.connect(n); n.connect(mute); mute.connect(this.ctx.destination);
        this.node = n; ok = true;
      } catch {}
    }
    if (!ok) {
      const sp = this.ctx.createScriptProcessor(2048, 1, 1);
      sp.onaudioprocess = (e) => feed(new Float32Array(e.inputBuffer.getChannelData(0)));
      src.connect(sp); sp.connect(mute); mute.connect(this.ctx.destination);
      this.node = sp;
    }
    this.running = true;
  }

  stop() {
    this.running = false;
    try { this.node?.disconnect(); } catch {}
    this.stream?.getTracks().forEach((t) => t.stop());
    try { void this.ctx?.close(); } catch {}
    this.node = null; this.stream = null; this.ctx = null;
  }
}
