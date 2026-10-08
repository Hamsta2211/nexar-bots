import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useParams } from "wouter";
import { motion } from "framer-motion";
import { ArrowLeft, Mic, MicOff, Phone, PhoneOff, Send, Settings2, Users, Volume2 } from "lucide-react";
import type { Bot } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { streamChat } from "@/lib/stream";
import { TtsPlayer, Listener, speechSupported } from "@/lib/voice";
import { findAgent, speakable, takeSpeakable } from "@/lib/speech-utils";
import { AgentFace, FaceStyles, faceFor } from "@/components/agent-face";

type VoiceInfo = {
  engine: "edge-tts" | "offline";
  voices: { id: string; name: string; lang: string; gender: string }[];
  assignments: Record<string, string>;
};
type TileState = "idle" | "thinking" | "speaking";

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

function Tile({ bot, index, state, big, dim, compact, solo }: {
  bot: Bot; index: number; state: TileState; big: boolean; dim: boolean; compact: boolean; solo: boolean;
}) {
  const look = faceFor(bot.name, bot.id);
  const speaking = state === "speaking";
  const label = speaking ? `${bot.name} spricht …` : state === "thinking" ? `${bot.name} denkt nach …` : solo ? `${bot.name} hört zu …` : bot.name;
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
        <Waves active={speaking} />
      ) : null}
    </motion.div>
  );
}

export default function VoicePage() {
  const params = useParams<{ id?: string }>();
  const soloId = params.id ? Number(params.id) : null;
  const qc = useQueryClient();
  const { data: allBots } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: vinfo, refetch: refetchVoices } = useQuery<VoiceInfo>({ queryKey: ["/api/tts/voices"], staleTime: 30_000 });
  const agents = useMemo(() => (allBots || []).filter((b) => (soloId ? b.id === soloId : true)), [allBots, soloId]);

  const [live, setLive] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [listening, setListening] = useState(false);
  const [speakerId, setSpeakerId] = useState<number | null>(null);
  const [thinkingId, setThinkingId] = useState<number | null>(null);
  const [heard, setHeard] = useState("");
  const [caption, setCaption] = useState("");
  const [hint, setHint] = useState("");
  const [typed, setTyped] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  const player = useRef<TtsPlayer | null>(null);
  const listenerRef = useRef<Listener | null>(null);
  const convIds = useRef(new Map<number, number>());
  const abortRef = useRef<AbortController | null>(null);
  const pendingRef = useRef<{ id: number; until: number } | null>(null);
  const streamingRef = useRef(false);
  const curBotRef = useRef<number | null>(null);
  const micOnRef = useRef(true);
  const agentsRef = useRef<Bot[]>([]);
  const voicesRef = useRef<Record<string, string>>({});
  const handleHeardRef = useRef<(t: string) => void>(() => {});
  agentsRef.current = agents;
  voicesRef.current = vinfo?.assignments || {};
  micOnRef.current = micOn;

  const finishTurn = () => {
    setSpeakerId(null);
    setThinkingId(null);
    if (micOnRef.current) listenerRef.current?.resume();
  };

  const ensurePlayer = () => {
    if (!player.current) {
      const p = new TtsPlayer();
      p.onSpeaking = (on) => {
        if (on) { listenerRef.current?.pause(); setThinkingId(null); setSpeakerId(curBotRef.current); }
        else if (!streamingRef.current) setSpeakerId(null);
      };
      p.onIdle = () => { if (!streamingRef.current) finishTurn(); };
      player.current = p;
    }
    return player.current;
  };

  const ask = async (bot: Bot, msg: string) => {
    abortRef.current?.abort();
    const p = ensurePlayer();
    p.stop();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    curBotRef.current = bot.id;
    streamingRef.current = true;
    setThinkingId(bot.id);
    setSpeakerId(null);
    setCaption("");
    setHint("");

    let buf = "", full = "", first = true, capTimer: any = 0;
    const slot = Math.max(0, agentsRef.current.findIndex((b) => b.id === bot.id));
    const voice = voicesRef.current[String(bot.id)] || "de-DE-KatjaNeural";
    const showCaption = () => { capTimer = 0; setCaption(full); };
    const drain = (final: boolean) => {
      for (;;) {
        const part = takeSpeakable(buf, final, first);
        if (!part) break;
        buf = part.rest;
        const s = speakable(part.chunk);
        if (!s) continue;
        first = false;
        listenerRef.current?.pause(); // Echo vermeiden: nicht zuhören, während gesprochen wird
        p.enqueue(s, voice, slot);
      }
    };
    try {
      await streamChat(bot.id, { message: msg, conversationId: convIds.current.get(bot.id) ?? null, voice: true }, {
        onStart: (cid) => convIds.current.set(bot.id, cid),
        onToken: (t) => { buf += t; full += t; if (!capTimer) capTimer = setTimeout(showCaption, 80); drain(false); },
        onReset: () => { buf = ""; full = ""; setCaption(""); },
        onError: (m) => setHint(m),
      }, ctrl.signal);
      drain(true);
    } catch (e: any) {
      if (!ctrl.signal.aborted) setHint(e?.message || "Fehler");
    } finally {
      if (capTimer) clearTimeout(capTimer);
      setCaption(full);
      if (abortRef.current === ctrl) {
        streamingRef.current = false;
        if (!p.hasPending()) finishTurn();
      }
    }
  };

  const handleHeard = (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    setHeard(text);
    const list = agentsRef.current;
    if (!list.length) return;
    let target: Bot | undefined;
    let msg = text;
    if (soloId) {
      target = list[0];
    } else {
      const f = findAgent(text, list.map((b) => ({ id: b.id, name: b.name })));
      if (f) {
        target = list.find((b) => b.id === f.id);
        msg = f.rest;
      } else if (pendingRef.current && pendingRef.current.until > Date.now()) {
        target = list.find((b) => b.id === pendingRef.current!.id);
      }
      if (!target) { setHint(`Sag zuerst den Namen eines Agenten, z. B. „${list[0].name}, …“`); return; }
      if (!msg.trim()) {
        pendingRef.current = { id: target.id, until: Date.now() + 10_000 };
        setHint(`${target.name} hört zu …`);
        return;
      }
    }
    pendingRef.current = null;
    void ask(target, msg);
  };
  handleHeardRef.current = handleHeard;

  const start = () => {
    if (!agents.length) return;
    ensurePlayer().unlock();
    void refetchVoices();
    setLive(true);
    setHint("");
    if (speechSupported()) {
      if (!listenerRef.current) {
        listenerRef.current = new Listener("de-DE", {
          onInterim: (t) => setHeard(t),
          onFinal: (t) => handleHeardRef.current(t),
          onState: (s, msg) => { setListening(s === "on"); if (s === "error" && msg) setHint(msg); },
        });
      }
      if (micOnRef.current) listenerRef.current.start();
    } else {
      setHint("Dieser Browser hat keine Spracherkennung (nutze Chrome, Edge oder Safari). Du kannst unten tippen – die Agenten antworten trotzdem per Stimme.");
    }
  };

  const end = () => {
    abortRef.current?.abort();
    streamingRef.current = false;
    player.current?.stop();
    listenerRef.current?.stop();
    pendingRef.current = null;
    setLive(false);
    setSpeakerId(null);
    setThinkingId(null);
    setHeard("");
    setCaption("");
  };

  const toggleMic = () => {
    const next = !micOn;
    setMicOn(next);
    micOnRef.current = next;
    const l = listenerRef.current;
    if (!l) return;
    if (next) { l.start(); if (player.current?.speaking) l.pause(); }
    else l.stop();
  };

  const previewVoice = (b: Bot, i: number, voice: string) => {
    const p = ensurePlayer();
    p.unlock();
    p.stop();
    curBotRef.current = b.id;
    streamingRef.current = false;
    p.enqueue(`Hallo, ich bin ${b.name}. So klingt meine Stimme.`, voice, i);
  };

  const setVoice = async (b: Bot, voice: string) => {
    try {
      await apiRequest("PUT", `/api/bots/${b.id}/voice`, { voice });
      await qc.invalidateQueries({ queryKey: ["/api/tts/voices"] });
    } catch {}
  };

  useEffect(() => { end(); }, [soloId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => () => {
    abortRef.current?.abort();
    player.current?.stop();
    listenerRef.current?.stop();
  }, []);

  const activeId = speakerId ?? thinkingId;
  const stateOf = (id: number): TileState => (id === speakerId ? "speaking" : id === thinkingId ? "thinking" : "idle");
  const status = speakerId ? "1 spricht" : thinkingId ? "1 denkt nach" : live ? (listening ? "hört zu" : "bereit") : "nicht gestartet";
  const voices = vinfo?.voices || [];
  const groups = useMemo(() => {
    const m = new Map<string, typeof voices>();
    for (const v of voices) m.set(v.lang, [...(m.get(v.lang) || []), v]);
    return Array.from(m.entries());
  }, [voices]);

  return (
    <div className="flex h-full flex-col">
      <FaceStyles />
      <div className="flex items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Link href={soloId ? `/chat/${soloId}` : "/chat"}>
          <Button variant="ghost" size="icon" aria-label="Zurück" data-testid="button-voice-back"><ArrowLeft className="h-4 w-4" /></Button>
        </Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold tracking-tight" data-testid="text-page-title">
            {soloId ? `Voice-Chat mit ${agents[0]?.name ?? "…"}` : "Gruppen-Voice-Chat"}
          </h1>
          <p className="text-xs text-muted-foreground">
            {soloId ? "Sprich direkt mit diesem Agenten." : "Sag den Namen eines Agenten – dann antwortet nur er."}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => setSettingsOpen((o) => !o)} data-testid="button-voice-settings">
          <Settings2 className="mr-1.5 h-4 w-4" />Stimmen
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
              <div className="mb-1 text-sm font-medium">Stimmen der Agenten</div>
              <p className="mb-2 text-xs text-muted-foreground">Jeder Agent bekommt seine eigene Microsoft-Stimme. Mit dem Lautsprecher kannst du sie anhören.</p>
              {agents.map((b, i) => {
                const cur = vinfo?.assignments?.[String(b.id)] || "";
                return (
                  <div key={b.id} className="flex items-center gap-2 py-1.5">
                    <div className="w-9 shrink-0"><AgentFace look={faceFor(b.name, b.id)} laptop={false} title={b.name} /></div>
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
                  </div>
                );
              })}
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
                  />
                ))}
              </div>
            )}
          </div>

          <div className="mt-4 min-h-[3.5rem] space-y-1.5 text-center" aria-live="polite">
            {!live && agents.length > 0 && (
              <p className="text-sm text-muted-foreground">
                {soloId ? "Starte den Anruf und sprich los." : `Starte den Anruf und sprich zum Beispiel „${agents[0].name}, wie wird das Wetter?“`}
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
            <form
              onSubmit={(e) => { e.preventDefault(); const t = typed.trim(); if (t) { setTyped(""); handleHeard(t); } }}
              className="flex gap-2"
            >
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
                  <Button
                    size="icon"
                    variant={micOn ? "default" : "outline"}
                    onClick={toggleMic}
                    aria-label={micOn ? "Mikrofon ausschalten" : "Mikrofon einschalten"}
                    className="h-11 w-11 rounded-full"
                    data-testid="button-voice-mic"
                  >
                    {micOn ? <Mic className="h-5 w-5" /> : <MicOff className="h-5 w-5" />}
                  </Button>
                  <Button
                    size="icon"
                    onClick={end}
                    aria-label="Anruf beenden"
                    className="h-11 w-11 rounded-full bg-[#a8443d] text-white hover:bg-[#933b35]"
                    data-testid="button-voice-end"
                  >
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
