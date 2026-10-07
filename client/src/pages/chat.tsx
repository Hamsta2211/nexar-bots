import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useLocation, useParams, Link } from "wouter";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { ArrowUp, ChevronRight, Loader2, Plus, Trash2, Wrench, Copy, Square, Repeat } from "lucide-react";
import type { Bot, Conversation, Message, ToolStep } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { BotAvatar, ProviderBadge, ago } from "@/lib/ui";

function Steps({ steps }: { steps: ToolStep[] }) {
  const [open, setOpen] = useState(false);
  if (!steps.length) return null;
  const toolSteps = steps.filter((s) => s.tool !== "nexar");
  const notes = steps.filter((s) => s.tool === "nexar");
  return (
    <div className="mb-2">
      {notes.length > 0 && (
        <div className="mb-1.5 flex flex-wrap gap-1.5">
          {Array.from(new Set(notes.map((n) => n.result))).map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground" data-testid="chip-nexar-note">
              <Repeat className="h-2.5 w-2.5" />{n}{notes.filter((x) => x.result === n).length > 1 ? ` (${notes.filter((x) => x.result === n).length}×)` : ""}
            </span>
          ))}
        </div>
      )}
      {toolSteps.length > 0 && <>
      <button onClick={() => setOpen((o) => !o)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 font-mono text-[11px] text-muted-foreground hover-elevate" data-testid="button-toggle-steps">
        <Wrench className="h-3 w-3" />
        {toolSteps.length} Werkzeug-Aufruf{toolSteps.length > 1 ? "e" : ""}: {Array.from(new Set(toolSteps.map((s) => s.tool))).join(", ")}
        <ChevronRight className={`h-3 w-3 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="mt-2 space-y-2">
          {toolSteps.map((s, i) => (
            <div key={i} className="rounded-md border border-border bg-muted/40 p-2.5 font-mono text-[11px]">
              <div className="text-primary">{s.tool}({JSON.stringify(s.args)})</div>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap text-muted-foreground">{s.result}</pre>
            </div>
          ))}
        </div>
      )}
      </>}
    </div>
  );
}

function Bubble({ m, bot }: { m: Pick<Message, "role" | "content" | "steps">; bot: Bot }) {
  const { toast } = useToast();
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] whitespace-pre-wrap rounded-lg bg-primary/12 px-3.5 py-2.5 text-sm ring-1 ring-primary/20">{m.content}</div>
      </div>
    );
  }
  const steps: ToolStep[] = JSON.parse(m.steps || "[]");
  const isErr = m.content.startsWith("Fehler:");
  return (
    <div className="group flex gap-3">
      <BotAvatar bot={bot} size="sm" />
      <div className="min-w-0 flex-1">
        <Steps steps={steps} />
        <div className={`prose-chat text-sm ${isErr ? "text-destructive" : ""}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content}</ReactMarkdown>
        </div>
        <button
          onClick={() => { navigator.clipboard?.writeText(m.content); toast({ title: "Kopiert" }); }}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100"
          data-testid="button-copy-message"
        >
          <Copy className="h-3 w-3" />Kopieren
        </button>
      </div>
    </div>
  );
}

export default function Chat() {
  const params = useParams<{ id?: string }>();
  const [, navigate] = useLocation();
  const { data: bots, isLoading: botsLoading } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const botId = params.id ? Number(params.id) : bots?.[0]?.id;
  const bot = bots?.find((b) => b.id === botId);
  const [convId, setConvId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!params.id && bots?.[0]) navigate(`/chat/${bots[0].id}`, { replace: true });
  }, [params.id, bots]);
  useEffect(() => { setConvId(null); }, [botId]);

  const { data: convs } = useQuery<Conversation[]>({ queryKey: ["/api/bots", botId ?? 0, "conversations"], enabled: !!botId });
  const { data: msgs, isLoading: msgsLoading } = useQuery<Message[]>({ queryKey: ["/api/conversations", convId ?? 0, "messages"], enabled: !!convId });

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [msgs, pending]);

  const send = useMutation({
    mutationFn: async (text: string) => (await apiRequest("POST", `/api/bots/${botId}/chat`, { message: text, conversationId: convId })).json(),
    onMutate: (text) => { setPending(text); setInput(""); },
    onSuccess: async (d: { conversationId: number }) => {
      setConvId(d.conversationId);
      await queryClient.invalidateQueries({ queryKey: ["/api/conversations", d.conversationId, "messages"] });
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId ?? 0, "conversations"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
    },
    onSettled: () => setPending(null),
  });

  const delConv = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/conversations/${id}`),
    onSuccess: (_d, id) => {
      if (id === convId) setConvId(null);
      queryClient.invalidateQueries({ queryKey: ["/api/bots", botId ?? 0, "conversations"] });
    },
  });

  const submit = () => {
    const t = input.trim();
    if (t && !send.isPending) send.mutate(t);
  };

  if (botsLoading) return <div className="p-6"><Skeleton className="h-96 w-full" /></div>;
  if (!bots?.length || !bot) {
    return (
      <div className="grid h-full place-items-center p-6 text-center">
        <div>
          <p className="text-sm text-muted-foreground">Kein Bot vorhanden.</p>
          <Link href="/bots"><Button className="mt-3" size="sm">Bot erstellen</Button></Link>
        </div>
      </div>
    );
  }

  const shown = convId ? msgs || [] : [];
  const suggestions = ["Was kannst du alles?", "Was sind die wichtigsten Tech-News heute?", "Rechne 17,5 % von 2.340 €", "Merke dir: Ich wohne in Linz."];

  return (
    <div className="flex h-full">
      <aside className="hidden w-64 shrink-0 flex-col border-r border-border lg:flex">
        <div className="p-3">
          <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => setConvId(null)} data-testid="button-new-chat">
            <Plus className="mr-1.5 h-4 w-4" />Neuer Chat
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-2 pb-3">
          {!convs?.length && <p className="px-2 py-4 text-xs text-muted-foreground">Noch keine Verläufe.</p>}
          {convs?.map((c) => (
            <div key={c.id} className={`group flex items-center rounded-md hover-elevate ${c.id === convId ? "bg-accent" : ""}`}>
              <button onClick={() => setConvId(c.id)} className="min-w-0 flex-1 px-2.5 py-2 text-left" data-testid={`button-conv-${c.id}`}>
                <div className="truncate text-sm">{c.title}</div>
                <div className="text-[11px] text-muted-foreground">{ago(c.updatedAt)}</div>
              </button>
              <button onClick={() => delConv.mutate(c.id)} className="px-2 opacity-0 group-hover:opacity-100" aria-label="Chat löschen" data-testid={`button-del-conv-${c.id}`}>
                <Trash2 className="h-3.5 w-3.5 text-muted-foreground" />
              </button>
            </div>
          ))}
        </div>
      </aside>

      <section className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-3 border-b border-border px-5 py-3">
          <BotAvatar bot={bot} />
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold" data-testid="text-chat-bot">{bot.name}</div>
            <ProviderBadge provider={bot.provider} model={bot.model} />
          </div>
          <Button variant="ghost" size="sm" className="lg:hidden" onClick={() => setConvId(null)}><Plus className="h-4 w-4" /></Button>
        </div>

        <div className="flex-1 overflow-y-auto">
          <div className="mx-auto max-w-3xl space-y-6 px-5 py-6">
            {!shown.length && !pending && (
              <div className="py-10 text-center">
                <div className="flex justify-center"><BotAvatar bot={bot} size="lg" /></div>
                <h2 className="mt-3 font-semibold">Chat mit {bot.name}</h2>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{bot.description}</p>
                <div className="mx-auto mt-5 grid max-w-lg gap-2 sm:grid-cols-2">
                  {suggestions.map((s) => (
                    <button key={s} onClick={() => send.mutate(s)} className="rounded-md border border-border px-3 py-2 text-left text-sm text-muted-foreground hover-elevate" data-testid="button-suggestion">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {convId && msgsLoading && <Skeleton className="h-20 w-full" />}
            {shown.map((m) => <Bubble key={m.id} m={m} bot={bot} />)}
            {pending && (
              <>
                {!shown.some((m) => m.content === pending && m.role === "user") && <Bubble m={{ role: "user", content: pending, steps: "[]" }} bot={bot} />}
                <div className="flex items-center gap-3 text-sm text-muted-foreground" data-testid="status-thinking">
                  <BotAvatar bot={bot} size="sm" />
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {bot.name} denkt nach und nutzt Werkzeuge …
                </div>
              </>
            )}
            <div ref={endRef} />
          </div>
        </div>

        <div className="border-t border-border p-4">
          <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-lg border border-input bg-card p-2 focus-within:ring-1 focus-within:ring-ring">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={`Nachricht an ${bot.name} …`}
              rows={1}
              className="max-h-40 min-h-[2.25rem] resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              data-testid="input-chat"
            />
            {send.isPending ? (
              <Button size="icon" variant="outline" onClick={() => apiRequest("POST", `/api/bots/${botId}/stop`).catch(() => {})} aria-label="Stoppen" title="Agent stoppen" data-testid="button-stop">
                <Square className="h-3.5 w-3.5 fill-current" />
              </Button>
            ) : (
              <Button size="icon" onClick={submit} disabled={!input.trim()} aria-label="Senden" data-testid="button-send">
                <ArrowUp className="h-4 w-4" />
              </Button>
            )}
          </div>
          <p className="mx-auto mt-1.5 max-w-3xl text-[11px] text-muted-foreground">Enter senden · Shift+Enter neue Zeile</p>
        </div>
      </section>
    </div>
  );
}
