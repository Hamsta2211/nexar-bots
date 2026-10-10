import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Mic, Loader2, Check, Trash2 } from "lucide-react";
import type { Bot } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Mic as MicIn } from "@/lib/mic";
import { Vad, concatFrames, FRAME_MS } from "@/lib/audio-utils";
import { apiRequest, API_BASE, authHeaders } from "@/lib/queryClient";
import { uploadSample } from "@/lib/wake-client";

type Rec = { stop: () => void };

/** Nimmt einen Clip auf: wartet auf Sprache, endet nach kurzer Stille oder nach maxMs. */
function recordClip(mic: MicIn, opts: { maxMs: number; endSilenceMs: number; tailMs: number; waitMs?: number }, onLevel: (l: number) => void): Promise<Int16Array | null> {
  return new Promise((resolve) => {
    const vad = new Vad();
    const ring: Int16Array[] = [];
    let frames: Int16Array[] = [];
    let began = false, startAt = 0, lastSpeech = 0, t = 0, speechMs = 0;
    mic.onFrame = (f) => {
      t += FRAME_MS;
      const v = vad.process(f);
      onLevel(v.level);
      ring.push(f); if (ring.length > 12) ring.shift();
      if (!began) {
        if (vad.speechRun >= 3) { began = true; frames = ring.slice(-10); startAt = t; lastSpeech = t; }
        else if (t > (opts.waitMs ?? 8000)) { mic.onFrame = () => {}; resolve(null); }
        return;
      }
      frames.push(f);
      if (v.speech) { lastSpeech = t; speechMs += FRAME_MS; }
      if (t - lastSpeech >= opts.endSilenceMs || t - startAt >= opts.maxMs) {
        mic.onFrame = () => {};
        const cut = Math.max(0, Math.floor((t - lastSpeech - opts.tailMs) / FRAME_MS));
        const used = cut > 0 ? frames.slice(0, frames.length - cut) : frames;
        resolve(speechMs >= 200 ? concatFrames(used) : null);
      }
    };
  });
}

export function WakeTrainer({ bot, open, onClose, serviceUp }: { bot: Bot | null; open: boolean; onClose: () => void; serviceUp: boolean }) {
  const qc = useQueryClient();
  const mic = useRef<MicIn | null>(null);
  const [step, setStep] = useState<"intro" | "name" | "bg" | "train" | "done">("intro");
  const [posN, setPosN] = useState(0);
  const [negMs, setNegMs] = useState(0);
  const [level, setLevel] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [result, setResult] = useState<any>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; mic.current?.stop(); mic.current = null; };
  }, []);
  useEffect(() => {
    if (open && bot) {
      setStep("intro"); setPosN(0); setNegMs(0); setMsg(""); setResult(null);
      void fetch(`${API_BASE}/api/wake/sample?agent=${bot.id}`, { method: "DELETE", headers: authHeaders(), credentials: "same-origin" }).catch(() => {});
    } else { mic.current?.stop(); mic.current = null; }
  }, [open, bot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bot) return null;

  const ensureMic = async () => {
    if (!mic.current) mic.current = new MicIn();
    if (!mic.current.running) await mic.current.start();
    return mic.current;
  };

  const recName = async () => {
    setBusy(true); setMsg(`Sag jetzt „${bot.name}“ …`);
    try {
      const m = await ensureMic();
      const clip = await recordClip(m, { maxMs: 2500, endSilenceMs: 450, tailMs: 260 }, (l) => alive.current && setLevel(l));
      if (!clip) { setMsg("Nichts gehört – bitte noch einmal näher am Mikrofon."); return; }
      const r = await uploadSample(bot.id, "pos", clip);
      setPosN(r.pos);
      setMsg(r.pos >= 5 ? "Super, das reicht." : `Gut. Noch ${5 - r.pos} Mal.`);
      if (r.pos >= 5) setStep("bg");
    } catch (e: any) { setMsg(e?.message || "Aufnahme fehlgeschlagen"); }
    finally { setBusy(false); setLevel(0); }
  };

  const recBg = async () => {
    setBusy(true); setMsg("Sprich 10–15 Sekunden normal, ohne den Namen, z. B. aus einer Zeitung vorlesen oder frei erzählen …");
    try {
      const m = await ensureMic();
      let total = 0;
      while (total < 12_000 && alive.current) {
        const clip = await recordClip(m, { maxMs: 6000, endSilenceMs: 900, tailMs: 200, waitMs: 6000 }, (l) => alive.current && setLevel(l));
        if (!clip) break;
        await uploadSample(bot.id, "neg", clip);
        total += (clip.length / 16000) * 1000;
        setNegMs(total);
      }
      setMsg(total >= 4000 ? "Danke, das hilft gegen Fehlalarme." : "Etwas wenig gehört – das Training funktioniert trotzdem.");
    } catch (e: any) { setMsg(e?.message || "Aufnahme fehlgeschlagen"); }
    finally { setBusy(false); setLevel(0); }
  };

  const train = async () => {
    mic.current?.stop(); mic.current = null;
    setStep("train"); setBusy(true); setMsg("Training gestartet …");
    try {
      await apiRequest("POST", "/api/wake/train", { agent: String(bot.id) });
      for (let i = 0; i < 400 && alive.current; i++) {
        await new Promise((r) => setTimeout(r, 2500));
        const j = await (await apiRequest("GET", `/api/wake/train/status?agent=${bot.id}`)).json();
        if (j.state === "running") { setMsg(`Training läuft (${j.seconds}s) – auf dem kleinen Server kann das 1–2 Minuten dauern.`); continue; }
        if (j.state === "done") { setResult(j.stats); setStep("done"); await qc.invalidateQueries({ queryKey: ["/api/wake/status"] }); break; }
        throw new Error(j.error || "Training fehlgeschlagen");
      }
    } catch (e: any) { setMsg(e?.message || "Training fehlgeschlagen"); setStep("bg"); }
    finally { setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try { await apiRequest("DELETE", `/api/wake/agent/${bot.id}`); await qc.invalidateQueries({ queryKey: ["/api/wake/status"] }); onClose(); } catch {}
    setBusy(false);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Hotword für {bot.name}</DialogTitle>
          <DialogDescription>Ein kleines lokales KI-Modell (openWakeWord-Merkmale) lernt, wie du „{bot.name}“ sagst. Es läuft auf deinem Server.</DialogDescription>
        </DialogHeader>
        {!serviceUp && <p className="rounded-md border border-border bg-muted/40 p-2 text-xs text-muted-foreground">Der Hotword-Dienst ist gerade nicht erreichbar (er läuft nur auf dem Render-Server, nicht in der lokalen Vorschau).</p>}

        {step === "intro" && (
          <div className="space-y-3 text-sm">
            <p>Du sprichst den Namen 5× ein (je ca. 1 Sekunde), danach optional ein paar Sekunden normales Reden als Gegenbeispiel. Ruhige Umgebung, Abstand wie später im Gespräch.</p>
            <Button disabled={!serviceUp} onClick={() => setStep("name")}>Los geht’s</Button>
          </div>
        )}
        {step === "name" && (
          <div className="space-y-3 text-sm">
            <div className="flex items-center gap-2">{Array.from({ length: 5 }).map((_, i) => <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < posN ? "bg-[#6b9a6e]" : "bg-muted"}`} />)}<span className="text-xs text-muted-foreground">{posN}/5</span></div>
            <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-[#6e92bd] transition-all" style={{ width: `${Math.min(100, level * 600)}%` }} /></div>
            <Button disabled={busy} onClick={recName}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mic className="mr-1.5 h-4 w-4" />}Aufnehmen</Button>
          </div>
        )}
        {step === "bg" && (
          <div className="space-y-3 text-sm">
            <p>Optional, aber empfohlen: normales Sprechen ohne den Namen aufnehmen.</p>
            <div className="h-1.5 overflow-hidden rounded bg-muted"><div className="h-full bg-[#6e92bd] transition-all" style={{ width: `${Math.min(100, level * 600)}%` }} /></div>
            <div className="text-xs text-muted-foreground">{Math.round(negMs / 1000)} s aufgenommen</div>
            <div className="flex gap-2">
              <Button variant="outline" disabled={busy} onClick={recBg}>{busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Mic className="mr-1.5 h-4 w-4" />}Aufnehmen</Button>
              <Button disabled={busy} onClick={train}>Trainieren</Button>
            </div>
          </div>
        )}
        {step === "train" && <div className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{msg}</div>}
        {step === "done" && (
          <div className="space-y-2 text-sm">
            <p className="flex items-center gap-1.5"><Check className="h-4 w-4 text-[#6b9a6e]" />Fertig – „{bot.name}“ wird jetzt im Gruppen-Voice-Chat erkannt.</p>
            {result && <p className="text-xs text-muted-foreground">Trefferquote auf deinen Aufnahmen {Math.round((result.recall || 0) * 100)} %, Schwelle {result.thr}. Falls er zu oft oder zu selten reagiert: einfach neu trainieren.</p>}
            <Button onClick={onClose}>Schließen</Button>
          </div>
        )}
        {msg && step !== "train" && <p className="text-xs text-muted-foreground" aria-live="polite">{msg}</p>}
        <div className="flex justify-end"><Button variant="ghost" size="sm" disabled={busy} onClick={remove}><Trash2 className="mr-1.5 h-3.5 w-3.5" />Modell löschen</Button></div>
      </DialogContent>
    </Dialog>
  );
}
