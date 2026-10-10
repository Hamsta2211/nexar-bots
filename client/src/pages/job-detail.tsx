import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation, useParams } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowLeft, ArrowUp, CheckCircle2, Loader2, Plus, RotateCcw, Square, Trash2, Users } from "lucide-react";
import type { Bot, Message } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { BotAvatar, ago } from "@/lib/ui";
import { Timeline, Artifacts, type LiveItem } from "@/components/chat-parts";
import { Bubble } from "@/pages/chat";
import { AgentPicker } from "@/pages/jobs";

type JobDetail = {
  id: number; title: string; description: string; status: "open" | "done"; botIds: number[];
  conversations: { id: number; botId: number; title: string; updatedAt: number; running: boolean }[];
};
type RunState = { state: "none" | "running" | "done" | "error" | "stopped"; text?: string; items?: LiveItem[]; error?: string };

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  const jobId = Number(params.id);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: bots } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: job, isLoading } = useQuery<JobDetail>({ queryKey: ["/api/jobs", jobId], refetchInterval: 4000, staleTime: 0 });
  const [botId, setBotId] = useState<number | null>(null);
  const [convId, setConvId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const [pick, setPick] = useState<number[]>([]);
  const endRef = useRef<HTMLDivElement>(null);

  const agents = (job?.botIds || []).map((id) => (bots || []).find((b) => b.id === id)).filter(Boolean) as Bot[];
  const curBotId = botId && job?.botIds.includes(botId) ? botId : job?.botIds[0] ?? null;
  const bot = agents.find((b) => b.id === curBotId);
  const chats = (job?.conversations || []).filter((c) => c.botId === curBotId);

  const { data: msgs } = useQuery<Message[]>({ queryKey: ["/api/conversations", convId ?? 0, "messages"], enabled: !!convId });
  const { data: run } = useQuery<RunState>({
    queryKey: ["/api/jobs/runs", convId ?? 0],
    enabled: !!convId,
    refetchInterval: (q) => (q.state.data?.state === "running" ? 1200 : false),
    staleTime: 0,
  });
  const running = run?.state === "running";

  // Lauf beendet -> gespeicherte Antwort laden
  const prev = useRef<string>("");
  useEffect(() => {
    const s = run?.state || "";
    if (prev.current === "running" && s && s !== "running") {
      void qc.invalidateQueries({ queryKey: ["/api/conversations", convId ?? 0, "messages"] });
      void qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    }
    prev.current = s;
  }, [run?.state]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setConvId(null); }, [curBotId]);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs?.length, run?.text, run?.items?.length]);

  const send = async () => {
    const text = input.trim();
    if (!text || !curBotId || sending || running) return;
    setSending(true);
    try {
      const r = await (await apiRequest("POST", `/api/jobs/${jobId}/chat`, { botId: curBotId, message: text, conversationId: convId })).json();
      setInput("");
      setConvId(r.conversationId);
      await qc.invalidateQueries({ queryKey: ["/api/conversations", r.conversationId, "messages"] });
      await qc.invalidateQueries({ queryKey: ["/api/jobs/runs", r.conversationId] });
      void qc.invalidateQueries({ queryKey: ["/api/jobs", jobId] });
    } catch (e: any) { toast({ title: "Fehler", description: e?.message, variant: "destructive" }); }
    finally { setSending(false); }
  };

  const patch = async (body: any) => { await apiRequest("PATCH", `/api/jobs/${jobId}`, body); await qc.invalidateQueries({ queryKey: ["/api/jobs"] }); };
  const remove = async () => {
    if (!confirm("Aufgabe mit allen Chats löschen?")) return;
    await apiRequest("DELETE", `/api/jobs/${jobId}`);
    await qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    navigate("/jobs");
  };
  const saveAgents = async () => {
    await apiRequest("PUT", `/api/jobs/${jobId}/agents`, { botIds: pick });
    await qc.invalidateQueries({ queryKey: ["/api/jobs"] });
    setAgentsOpen(false);
  };

  if (isLoading) return <div className="p-6"><Skeleton className="h-64 w-full" /></div>;
  if (!job) return <div className="p-6 text-sm text-muted-foreground">Aufgabe nicht gefunden. <Link href="/jobs" className="underline">Zurück</Link></div>;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
        <Link href="/jobs"><Button variant="ghost" size="icon" aria-label="Zurück"><ArrowLeft className="h-4 w-4" /></Button></Link>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-base font-semibold" data-testid="text-job-title">{job.title}</h1>
          {job.description && <p className="line-clamp-1 text-xs text-muted-foreground">{job.description}</p>}
        </div>
        <Button size="sm" variant="outline" onClick={() => { setPick(job.botIds); setAgentsOpen(true); }}><Users className="mr-1.5 h-4 w-4" />Agenten</Button>
        <Button size="sm" variant="outline" onClick={() => patch({ status: job.status === "done" ? "open" : "done" })}>
          {job.status === "done" ? <><RotateCcw className="mr-1.5 h-4 w-4" />Wieder öffnen</> : <><CheckCircle2 className="mr-1.5 h-4 w-4" />Erledigt</>}
        </Button>
        <Button size="icon" variant="ghost" onClick={remove} aria-label="Aufgabe löschen"><Trash2 className="h-4 w-4" /></Button>
      </div>

      {!agents.length ? (
        <div className="grid flex-1 place-items-center p-6 text-center text-sm text-muted-foreground">
          <div>Dieser Aufgabe ist noch kein Agent zugeordnet.<div className="mt-3"><Button size="sm" onClick={() => { setPick([]); setAgentsOpen(true); }}>Agenten hinzufügen</Button></div></div>
        </div>
      ) : (
        <>
          <div className="flex gap-1.5 overflow-x-auto border-b border-border px-4 py-2 sm:px-6">
            {agents.map((b) => {
              const live = job.conversations.some((c) => c.botId === b.id && c.running);
              return (
                <button key={b.id} onClick={() => setBotId(b.id)} className={`flex shrink-0 items-center gap-2 rounded-md border px-2.5 py-1 text-sm ${b.id === curBotId ? "border-primary/50 bg-primary/5" : "border-border text-muted-foreground"}`} data-testid={`tab-agent-${b.id}`}>
                  <BotAvatar bot={b} size="sm" />{b.name}{live && <Loader2 className="h-3 w-3 animate-spin text-primary" />}
                </button>
              );
            })}
          </div>

          <div className="flex min-h-0 flex-1">
            <aside className="hidden w-56 shrink-0 flex-col border-r border-border md:flex">
              <div className="p-3"><Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setConvId(null)}><Plus className="mr-1.5 h-4 w-4" />Neuer Chat</Button></div>
              <div className="flex-1 overflow-y-auto px-2 pb-3">
                {!chats.length && <p className="px-2 py-3 text-xs text-muted-foreground">Noch keine Chats mit {bot?.name}.</p>}
                {chats.map((c) => (
                  <button key={c.id} onClick={() => setConvId(c.id)} className={`flex w-full items-start gap-1.5 rounded-md px-2.5 py-2 text-left hover-elevate ${c.id === convId ? "bg-accent" : ""}`}>
                    <div className="min-w-0 flex-1"><div className="truncate text-sm">{c.title}</div><div className="text-[11px] text-muted-foreground">{c.running ? "arbeitet …" : ago(c.updatedAt)}</div></div>
                    {c.running && <Loader2 className="mt-0.5 h-3.5 w-3.5 animate-spin text-primary" />}
                  </button>
                ))}
              </div>
            </aside>

            <section className="flex min-w-0 flex-1 flex-col">
              <div className="flex-1 overflow-y-auto">
                <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
                  {chats.length > 0 && (
                    <div className="flex gap-1.5 overflow-x-auto md:hidden">
                      {chats.map((c) => <button key={c.id} onClick={() => setConvId(c.id)} className={`shrink-0 rounded-md border px-2 py-1 text-xs ${c.id === convId ? "border-primary/50" : "border-border text-muted-foreground"}`}>{c.title.slice(0, 24)}</button>)}
                    </div>
                  )}
                  {!convId && bot && (
                    <div className="py-10 text-center">
                      <div className="flex justify-center"><BotAvatar bot={bot} size="lg" /></div>
                      <h2 className="mt-3 font-semibold">{bot.name} · {job.title}</h2>
                      <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">Schreibe einen Auftrag. {bot.name} arbeitet auf dem Server im Hintergrund weiter, auch wenn du die Seite verlässt.</p>
                    </div>
                  )}
                  {convId && bot && (msgs || []).map((m) => <Bubble key={m.id} m={m} bot={bot} />)}
                  {convId && bot && running && (
                    <div className="flex gap-3" data-testid="status-job-running">
                      <BotAvatar bot={bot} size="sm" />
                      <div className="min-w-0 flex-1">
                        <Timeline steps={run?.items || []} live />
                        {run?.text ? (
                          <div className="prose-chat text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{run.text}</ReactMarkdown></div>
                        ) : !(run?.items || []).length ? (
                          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{bot.name} arbeitet …</div>
                        ) : null}
                        <Artifacts steps={run?.items || []} />
                      </div>
                    </div>
                  )}
                  <div ref={endRef} />
                </div>
              </div>
              <div className="border-t border-border p-4">
                <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-input bg-card p-2 focus-within:ring-1 focus-within:ring-ring">
                  <Textarea
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }}
                    placeholder={`Auftrag an ${bot?.name ?? "Agent"} …`}
                    rows={1}
                    className="max-h-40 min-h-[2.25rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                    data-testid="input-job-chat"
                  />
                  {running ? (
                    <Button size="icon" variant="outline" onClick={() => apiRequest("POST", `/api/jobs/runs/${convId}/stop`)} aria-label="Stoppen"><Square className="h-3.5 w-3.5 fill-current" /></Button>
                  ) : (
                    <Button size="icon" onClick={send} disabled={!input.trim() || sending} aria-label="Senden" data-testid="button-job-send"><ArrowUp className="h-4 w-4" /></Button>
                  )}
                </div>
                <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-muted-foreground">Läuft im Hintergrund auf dem Server. Der Kontext wird bei Bedarf automatisch zusammengefasst.</p>
              </div>
            </section>
          </div>
        </>
      )}

      <Dialog open={agentsOpen} onOpenChange={setAgentsOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Agenten dieser Aufgabe</DialogTitle></DialogHeader>
          <AgentPicker bots={bots || []} value={pick} onChange={setPick} />
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setAgentsOpen(false)}>Abbrechen</Button><Button onClick={saveAgents}>Speichern</Button></div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
