import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Mic, MicOff, Phone, PhoneOff, Send, Settings2, Users, Volume2, Smile, Radio } from "lucide-react";
import type { Bot } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { streamChat } from "@/lib/stream";
import { TtsPlayer } from "@/lib/voice";
import { Mic as MicIn } from "@/lib/mic";
import { Conductor, DEFAULT_CFG, type Snapshot } from "@/lib/conductor";
import { WakeFeeder, getWakeStatus, transcribe, type WakeStatus } from "@/lib/wake-client";
import { FaceEditor, useFaces } from "@/components/face-editor";
import { WakeTrainer } from "@/components/wake-trainer";
import { findAgent, speakable, takeSpeakable } from "@/lib/speech-utils";
import { AgentFace, FaceStyles, faceFor, type FaceCfg } from "@/components/agent-face";

type VoiceInfo = {
  engine: "edge-tts" | "offline";
  voices: { id: string; name: string; lang: string; gender: string }[];
  assignments: Record<string, string>;
};
type TileState = "idle" | "listening" | "thinking" | "speaking";

function Waves({ active }: { active: boolean }) {
  return (
    <div className="mt-3 flex h-7 items-center justify-center gap-1" aria-hidden>
      {Array.from({ length: 9 }).map((_, i) => (
        <span
          key={i}
          className="w-1 origin-center rounded-full bg-[#7b9bc2]"
          style={{
            height: "100%",
            opacity: active ? 0.85 : 0.25,
            transform: active ? undefined : "scaleY(.2)",
            animation: active ? `nexar-bar ${0.7 + (i % 4) * 0.12}s ease-in-out ${i * 0.07}s infinite` : undefined,
          }}
        />
      ))}
    </div>
  );
}

function Tile({ bot, index, state, big, dim, compact, solo, cfg, countdown, thought }: {
  bot: Bot; index: number; state: TileState; big: boolean; dim: boolean; compact: boolean; solo: boolean; cfg?: FaceCfg;
  countdown: { ms: number; total: number; label: string } | null; thought: string;
}) {
  const look = faceFor(bot.name, bot.id, cfg);
  const speaking = state === "speaking";
  const label = speaking ? `${bot.name} spricht …` : state === "thinking" ? `${bot.name} denkt nach …` : state === "listening" || solo ? `${bot.name} hört zu …` : bot.name;
  return (
    <motion.div
      layout
      transition={{ type: "spring", stiffness: 280, damping: 32 }}
      className="flex flex-col items-center"
      style={{
        order: big ? -1 : index,
        width: big ? "100%" : compact ? "clamp(62px, 10vw, 100px)" : "clamp(84px, 15vw, 128px)",
        opacity: dim ? 0.6 : 1,
      }}
      data-testid={`tile-agent-${bot.id}`}
    >
      <div
        className={`mb-2 inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] ${
          big ? "border-[#6e92bd]/50 bg-card text-foreground" : "border-border bg-card/70 text-muted-foreground"
        }`}
      >
        {big ? <Mic className="h-3 w-3 shrink-0 text-[#7b9bc2]" /> : <MicOff className="h-3 w-3 shrink-0" />}
        <span className="truncate">{label}</span>
      </div>
      <div className="relative" style={{ width: big ? "min(72vw, 280px)" : "100%" }}>
        {speaking && (
          <>
            <span className="pointer-events-none absolute inset-[6%] rounded-full border border-[#6e92bd]/40" style={{ animation: "nexar-ring 1.8s ease-out infinite" }} />
            <span className="pointer-events-none absolute inset-[6%] rounded-full border border-[#6e92bd]/30" style={{ animation: "nexar-ring 1.8s ease-out .9s infinite" }} />
          </>
        )}
        <div style={speaking ? { filter: "drop-shadow(0 0 22px rgba(110,146,189,.45))" } : undefined}>
          <AgentFace look={look} speaking={speaking} thinking={state === "thinking"} title={bot.name} />
        </div>
      </div>
      {big && state === "thinking" ? (
        <div className="mt-3 flex h-7 items-center gap-1.5">
          {[0, 1, 2].map((i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-full bg-[#7b9bc2]" style={{ animation: `nexar-dot 1.2s ease-in-out ${i * 0.2}s infinite` }} />
          ))}
        </div>
      ) : big ? (
        <Waves active={speaking || (state === "listening" && !countdown)} />
      ) : null}
      {big && state === "thinking" && thought && (
        <p className="mt-1 max-w-[280px] text-center text-[11px] italic text-muted-foreground" data-testid="text-thought">{thought}</p>
      )}
      {big && countdown && (
        <div className="mt-2 w-[min(72vw,280px)]" data-testid="countdown">
          <div className="h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-[#7b9bc2]" style={{ width: `${Math.max(0, Math.min(100, (countdown.ms / countdown.total) * 100))}%`, transition: "width 120ms linear" }} />
          </div>
          <div className="mt-1 text-center text-[11px] text-muted-foreground">{countdown.label}</div>
        </div>
      )}
    </motion.div>
  );
}

const FOLLOW_KEY = "nexar_followup_ms";
const readFollow = () => { try { return Number(localStorage.getItem(FOLLOW_KEY)) || 2000; } catch { return 2000; } };

export default function VoicePage() {
  const params = useParams<{ id?: string }>();
  const soloId = params.id ? Number(params.id) : null;
  const qc = useQueryClient();
  const { data: allBots } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: vinfo, refetch: refetchVoices } = useQuery<VoiceInfo>({ queryKey: ["/api/tts/voices"], staleTime: 30_000 });
  const { data: wake, refetch: refetchWake } = useQuery<WakeStatus>({ queryKey: ["/api/wake/status"], queryFn: getWakeStatus, staleTime: 15_000, retry: false });
  const faces = useFaces();
  const agents = useMemo(() => (allBots || []).filter((b) => (soloId ? b.id === soloId : true)), [allBots, soloId]);

  const [live, setLive] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [speakerId, setSpeakerId] = useState<number | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [thought, setThought] = useState("");
  const [hint, setHint] = useState("");
  const [typed, setTyped] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [followMs, setFollowMs] = useState(readFollow);
  const [faceBot, setFaceBot] = useState<Bot | null>(null);
  const [wakeBot, setWakeBot] = useState<Bot | null>(null);

  const player = useRef<TtsPlayer | null>(null);
  const micRef = useRef<MicIn | null>(null);
  const feeder = useRef<WakeFeeder | null>(null);
  const cond = useRef<Conductor | null>(null);
  const convIds = useRef(new Map<number, number>());
  const abortRef = useRef<AbortController | null>(null);
  const idleCb = useRef<(() => void) | null>(null);
  const micOnRef = useRef(true);
  const agentsRef = useRef<Bot[]>([]);
  const voicesRef = useRef<Record<string, string>>({});
  const wakeRef = useRef<WakeStatus | undefined>(undefined);
  const liveRef = useRef(false);
  agentsRef.current = agents;
  voicesRef.current = vinfo?.assignments || {};
  wakeRef.current = wake;
  micOnRef.current = micOn;
  liveRef.current = live;

  const trainedIds = useMemo(() => new Set(Object.entries(wake?.agents || {}).filter(([, a]) => a.trained).map(([id]) => Number(id))), [wake]);
  const wakeAvail = !!wake?.available;

  const ensurePlayer = () => {
    if (!player.current) {
      const p = new TtsPlayer();
      p.onSpeaking = (on) => { if (on) { setSpeakerId(cond.current?.target ?? null); cond.current?.speaking(); } else setSpeakerId(null); };
      p.onIdle = () => { const cb = idleCb.current; idleCb.current = null; cb?.(); };
      player.current = p;
    }
    return player.current;
  };

  const voiceOf = (b: Bot) => voicesRef.current[String(b.id)] || "de-DE-KatjaNeural";
  const slotOf = (b: Bot) => Math.max(0, agentsRef.current.findIndex((x) => x.id === b.id));

  const greet = (id: number) => {
    const b = agentsRef.current.find((x) => x.id === id);
    const p = ensurePlayer();
    p.stop();
    if (!b) return cond.current?.greetDone();
    let done = false;
    const fin = () => { if (done) return; done = true; idleCb.current = null; setTimeout(() => cond.current?.greetDone(), 250); };
    idleCb.current = fin;
    setTimeout(fin, 7000);
    p.enqueue("Ja?", voiceOf(b), slotOf(b));
  };

  const ask = async (bot: Bot, msg: string) => {
    abortRef.current?.abort();
    const p = ensurePlayer();
    p.stop();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setSpeakerId(null);
    setCaption("");
    setThought("");
    setHint("");
    setHeard(msg);

    let buf = "", full = "", first = true, capTimer: any = 0, expect = false, thinkBuf = "";
    const showCaption = () => { capTimer = 0; setCaption(full); };
    const drain = (final: boolean) => {
      for (;;) {
        const part = takeSpeakable(buf, final, first);
        if (!part) break;
        buf = part.rest;
        const s = speakable(part.chunk);
        if (!s) continue;
        first = false;
        p.enqueue(s, voiceOf(bot), slotOf(bot));
      }
    };
    let failed = false;
    try {
      await streamChat(bot.id, { message: msg, conversationId: convIds.current.get(bot.id) ?? null, voice: true }, {
        onStart: (cid) => convIds.current.set(bot.id, cid),
        onToken: (t) => { buf += t; full += t; if (!capTimer) capTimer = setTimeout(showCaption, 80); drain(false); },
        onThink: (t) => { thinkBuf = (thinkBuf + t).slice(-160); setThought(thinkBuf.replace(/\s+/g, " ").trim()); },
        onThinkEnd: () => { thinkBuf = ""; },
        onReset: () => { buf = ""; full = ""; first = true; setCaption(""); },
        onDone: (_m, ex) => { expect = ex.expect; },
        onError: (m) => { failed = true; setHint(m); },
      }, ctrl.signal);
      drain(true);
    } catch (e: any) {
      failed = true;
      if (!ctrl.signal.aborted) setHint(e?.message || "Fehler");
    } finally {
      if (capTimer) clearTimeout(capTimer);
      setCaption(full);
      setThought("");
      if (abortRef.current === ctrl && !ctrl.signal.aborted) {
        const finish = () => setTimeout(() => { if (abortRef.current === ctrl) failed && !full ? cond.current?.agentFailed() : cond.current?.agentDone(expect); }, 320);
        if (p.hasPending()) idleCb.current = finish; else finish();
      }
    }
  };

  const hintNames = () => agentsRef.current.map((b) => b.name).join(", ");

  const buildConductor = () => {
    const cfg = {
      ...DEFAULT_CFG,
      solo: !!soloId,
      followupMs: followMs,
      nameFallback: !soloId && (!wakeRef.current?.available || agentsRef.current.some((b) => !wakeRef.current?.agents?.[String(b.id)]?.trained)),
    };
    const c = new Conductor({
      greet,
      transcribe: (pcm, _purpose, req) => {
        transcribe(pcm, hintNames()).then((t) => { if (t) setHeard(t); c.transcribed(req, t); })
          .catch((e) => { setHint(`Spracherkennung: ${e?.message || e}`); c.transcribed(req, ""); });
      },
      ask: (id, text) => { const b = agentsRef.current.find((x) => x.id === id); if (b) void ask(b, text); else c.agentFailed(); },
      change: (s) => { setSnap(s); feeder.current?.setActive(c.wantsWake() && micOnRef.current); },
      note: (m) => { if (m) setHint(m); else setHint(""); },
    }, cfg, (t) => findAgent(t, agentsRef.current.map((b) => ({ id: b.id, name: b.name }))));
    return c;
  };

  const start = async () => {
    if (!agents.length) return;
    ensurePlayer().unlock();
    void refetchVoices();
    const st = (await refetchWake().catch(() => null))?.data;
    wakeRef.current = st || wakeRef.current;
    setHint("");
    try {
      const mic = new MicIn();
      await mic.start();
      micRef.current = mic;
    } catch (e: any) {
      setHint(e?.name === "NotAllowedError" ? "Mikrofon-Zugriff verweigert – bitte im Browser erlauben. Du kannst unten tippen." : `Mikrofon nicht verfügbar: ${e?.message || e}. Du kannst unten tippen.`);
      micRef.current = null;
    }
    const c = buildConductor();
    cond.current = c;
    const f = new WakeFeeder();
    f.onHit = (id) => {
      if (!agentsRef.current.some((b) => b.id === id)) return;
      const b = agentsRef.current.find((x) => x.id === id)!;
      setHint(`„${b.name}“ erkannt`);
      c.onHit(id);
    };
    f.onUnavailable = () => { setHint("Hotword-Dienst nicht erreichbar – Namen werden per Spracherkennung gesucht."); c.cfg.nameFallback = true; };
    feeder.current = f;
    if (micRef.current) {
      micRef.current.onFrame = (fr) => {
        if (!micOnRef.current) return;
        c.frame(fr);
        f.push(fr);
      };
    }
    setLive(true);
    c.start(soloId ?? undefined);
  };

  const end = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    idleCb.current = null;
    player.current?.stop();
    feeder.current?.setActive(false);
    micRef.current?.stop();
    micRef.current = null;
    cond.current?.stop();
    cond.current = null;
    setLive(false);
    setSnap(null);
    setSpeakerId(null);
    setHeard("");
    setCaption("");
    setThought("");
  };

  const toggleMic = () => { const n = !micOn; setMicOn(n); micOnRef.current = n; if (!n) feeder.current?.setActive(false); else if (cond.current) feeder.current?.setActive(cond.current.wantsWake()); };

  const submitTyped = (raw: string) => {
    const text = raw.trim();
    const c = cond.current;
    if (!text || !c) return;
    const list = agentsRef.current;
    let target = soloId ? list[0] : list.find((b) => b.id === c.target);
    let msg = text;
    if (!soloId) {
      const f = findAgent(text, list.map((b) => ({ id: b.id, name: b.name })));
      if (f) { target = list.find((b) => b.id === f.id); msg = f.rest || text; }
    }
    if (!target) { setHint(`Sag oder tippe zuerst den Namen eines Agenten, z. B. „${list[0]?.name}, …“`); return; }
    c.external(target.id);
    void ask(target, msg);
  };

  const previewVoice = (b: Bot, i: number, voice: string) => {
    const p = ensurePlayer();
    p.unlock();
    p.stop();
    p.enqueue(`Hallo, ich bin ${b.name}. So klingt meine Stimme.`, voice, i);
  };

  const setVoice = async (b: Bot, voice: string) => {
    try {
      await apiRequest("PUT", `/api/bots/${b.id}/voice`, { voice });
      await qc.invalidateQueries({ queryKey: ["/api/tts/voices"] });
    } catch {}
  };

  const setFollow = (ms: number) => { setFollowMs(ms); try { localStorage.setItem(FOLLOW_KEY, String(ms)); } catch {} if (cond.current) cond.current.cfg.followupMs = ms; };

  useEffect(() => { end(); }, [soloId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => { abortRef.current?.abort(); player.current?.stop(); micRef.current?.stop(); }, []);

  const target = live ? snap?.target ?? null : null;
  const phase = snap?.phase;
  const activeId = soloId ? soloId : target;
  const stateOf = (id: number): TileState => {
    if (id !== activeId) return "idle";
    if (id === speakerId || phase === "speaking") return "speaking";
    if (phase === "thinking" || phase === "transcribing") return "thinking";
    return "listening";
  };
  const countdown = (() => {
    if (!live || !snap || snap.endInMs == null) return null;
    if (snap.recording) {
      if (snap.silenceMs < 250) return null;
      return { ms: snap.endInMs, total: DEFAULT_CFG.endSilenceMs, label: `Ich sende in ${(snap.endInMs / 1000).toFixed(1)} s, wenn du nichts mehr sagst` };
    }
    if (snap.followup) return { ms: snap.endInMs, total: followMs, label: "Antwort erwartet – sprich jetzt" };
    return null;
  })();
  const status = !live ? "nicht gestartet"
    : phase === "speaking" ? "1 spricht"
    : phase === "thinking" ? "1 denkt nach"
    : phase === "transcribing" ? "versteht …"
    : phase === "greeting" || phase === "armed" ? "Name erkannt"
    : phase === "capturing" ? (snap?.recording ? "nimmt auf" : "hört zu")
    : soloId ? "hört zu" : "wartet auf einen Namen";
  const voices = vinfo?.voices || [];
  const groups = useMemo(() => {
    const m = new Map<string, typeof voices>();
    for (const v of voices) m.set(v.lang, [...(m.get(v.lang) || []), v]);
    return Array.from(m.entries());
  }, [voices]);

  return (
    <div className="flex h-full flex-col">
      <FaceStyles />
      <FaceEditor bot={faceBot} open={!!faceBot} onClose={() => setFaceBot(null)} />
      <WakeTrainer bot={wakeBot} open={!!wakeBot} onClose={() => { setWakeBot(null); void refetchWake(); }} serviceUp={!!wake?.serviceUp} />
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Link href={soloId ? `/chat/${soloId}` : "/chat"}>
          <Button variant="ghost" size="icon" aria-label="Zurück" data-testid="button-voice-back"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight" data-testid="text-page-title">
            {soloId ? `Voice-Chat mit ${agents[0]?.name ?? "…"}` : "Gruppen-Voice-Chat"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {soloId ? "Sprich direkt mit diesem Agenten." : "Sag den Namen eines Agenten – er antwortet „Ja“ und hört dir zu."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen((o) => !o)} data-testid="button-voice-settings">
          <Settings2 className="mr-1.5 h-4 w-4" />Einstellungen
        </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-5 sm:px-6">
        <div className="mx-auto max-w-4xl">
          {vinfo && vinfo.engine !== "edge-tts" && (
            <div className="mb-3 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground" data-testid="banner-tts-offline">
              Der Microsoft-TTS-Dienst (Python) ist gerade nicht erreichbar. Es wird die Stimme deines Browsers genutzt.
            </div>
          )}

          {settingsOpen && (
            <div className="mb-4 rounded-xl border border-border bg-card p-3">
              <div className="mb-1 text-sm font-medium">Agenten</div>
              <p className="mb-2 text-xs text-muted-foreground">Stimme (Microsoft), Gesicht und – für den Gruppen-Chat – das Hotword jedes Agenten.</p>
              {agents.map((b, i) => {
                const cur = vinfo?.assignments?.[String(b.id)] || "";
                const trained = trainedIds.has(b.id);
                return (
                  <div key={b.id} className="flex flex-wrap items-center gap-2 py-1.5">
                    <div className="w-9 shrink-0"><AgentFace look={faceFor(b.name, b.id, faces[String(b.id)])} laptop={false} title={b.name} /></div>
                    <span className="w-20 shrink-0 truncate text-sm">{b.name}</span>
                    <select
                      value={cur}
                      onChange={(e) => setVoice(b, e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                      data-testid={`select-voice-${b.id}`}
                    >
                      {cur && !voices.some((v) => v.id === cur) && <option value={cur}>{cur}</option>}
                      {groups.map(([lang, list]) => (
                        <optgroup key={lang} label={lang}>
                          {list.map((v) => <option key={v.id} value={v.id}>{v.name}{v.gender ? ` (${v.gender === "Female" ? "weiblich" : "männlich"})` : ""}</option>)}
                        </optgroup>
                      ))}
                    </select>
                    <Button size="icon" variant="outline" onClick={() => previewVoice(b, i, cur || "de-DE-KatjaNeural")} aria-label={`Stimme von ${b.name} anhören`} data-testid={`button-voice-test-${b.id}`}>
                      <Volume2 className="h-4 w-4" />
                    </Button>
                    <Button size="icon" variant="outline" onClick={() => setFaceBot(b)} aria-label={`Gesicht von ${b.name} anpassen`} data-testid={`button-face-${b.id}`}>
                      <Smile className="h-4 w-4" />
                    </Button>
                    {!soloId && (
                      <Button size="sm" variant={trained ? "outline" : "default"} onClick={() => setWakeBot(b)} data-testid={`button-wake-${b.id}`}>
                        <Radio className="mr-1.5 h-3.5 w-3.5" />{trained ? "Hotword ✓" : "Hotword trainieren"}
                      </Button>
                    )}
                  </div>
                );
              })}
              {!soloId && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-border pt-2 text-xs text-muted-foreground">
                  <span>Wartezeit auf deine Antwort nach einer Rückfrage:</span>
                  {[2000, 4000, 8000].map((ms) => (
                    <button key={ms} type="button" onClick={() => setFollow(ms)} className={`rounded-md border px-2 py-0.5 ${followMs === ms ? "border-[#6e92bd] bg-[#6e92bd]/15 text-foreground" : "border-border"}`}>{ms / 1000} s</button>
                  ))}
                  <span className="basis-full">
                    Hotword-Dienst: {wake ? (wake.available ? "bereit" : wake.serviceUp ? "startet …" : "nicht erreichbar (läuft nur auf dem Server)") : "…"}. Agenten ohne Hotword-Training werden über die Spracherkennung am Namen erkannt.
                  </span>
                </div>
              )}
            </div>
          )}

          <div className="rounded-xl border border-border bg-gradient-to-b from-card to-background p-4 sm:p-6">
            {!agents.length ? (
              <p className="py-10 text-center text-sm text-muted-foreground">Noch keine Agenten vorhanden. Lege zuerst unter „Bots“ einen an.</p>
            ) : (
              <div className="flex flex-wrap items-end justify-center gap-x-3 gap-y-5">
                {agents.map((b, i) => (
                  <Tile
                    key={b.id}
                    bot={b}
                    index={i}
                    state={stateOf(b.id)}
                    big={!!soloId || (live && b.id === activeId)}
                    dim={live && !soloId && activeId !== null && b.id !== activeId}
                    compact={live && !soloId && activeId !== null}
                    solo={!!soloId}
                    cfg={faces[String(b.id)]}
                    countdown={b.id === activeId ? countdown : null}
                    thought={b.id === activeId ? thought : ""}
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 min-h-[3.5rem] space-y-1.5 text-center" aria-live="polite">
            {!live && agents.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {soloId ? "Starte den Anruf und sprich los. Gesendet wird, wenn du 2 Sekunden nichts mehr sagst." : `Starte den Anruf und sag zum Beispiel „${agents[0].name}“ – dann antwortet er mit „Ja“ und du sprichst deine Frage.`}
              </p>
            )}
            {hint && <p className="text-xs text-muted-foreground" data-testid="text-voice-hint">{hint}</p>}
            {live && heard && <p className="text-sm italic text-muted-foreground" data-testid="text-voice-heard">„{heard}“</p>}
            {live && caption && <p className="mx-auto max-w-2xl text-sm" data-testid="text-voice-caption">{caption.slice(-260)}</p>}
          </div>
        </div>
      </div>

      <div className="border-t border-border bg-card/60 px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-4xl flex-col gap-3">
          {live && (
            <form onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (t) { setTyped(""); submitTyped(t); } }} className="flex gap-2">
              <input
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={soloId ? "Oder tippen …" : `Oder tippen, z. B. „${agents[0]?.name ?? "Agent"}, …“`}
                className="min-w-0 flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-ring"
                data-testid="input-voice-text"
              />
              <Button type="submit" size="icon" disabled={!typed.trim()} aria-label="Senden" data-testid="button-voice-send"><Send className="h-4 w-4" /></Button>
            </form>
          )}
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="grid h-10 w-10 shrink-0 place-items-center rounded-lg border border-border bg-background"><Users className="h-4 w-4 text-muted-foreground" /></div>
              <div className="min-w-0 leading-tight">
                <div className="truncate text-sm font-medium">{soloId ? agents[0]?.name ?? "Voice-Chat" : "Gruppen-Voice-Chat"}</div>
                <div className="truncate text-xs text-muted-foreground" data-testid="text-voice-status">{agents.length} Agent{agents.length === 1 ? "" : "s"} · {status}</div>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {live ? (
                <>
                  <Button size="icon" variant={micOn ? "default" : "outline"} onClick={toggleMic} aria-label={micOn ? "Mikrofon ausschalten" : "Mikrofon einschalten"} className="h-11 w-11 rounded-full" data-testid="button-voice-mic">
                    {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                  </Button>
                  <Button size="icon" onClick={end} aria-label="Anruf beenden" className="h-11 w-11 rounded-full bg-[#a8443d] text-white hover:bg-[#933b35]" data-testid="button-voice-end">
                    <PhoneOff className="h-5 w-5" />
                  </Button>
                </>
              ) : (
                <Button onClick={start} disabled={!agents.length} data-testid="button-voice-start">
                  <Phone className="mr-1.5 h-4 w-4" />Starten
                </Button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
