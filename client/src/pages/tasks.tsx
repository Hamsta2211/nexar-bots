import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { History, Loader2, Play, Plus, Trash2, Webhook } from "lucide-react";
import type { Bot, Task, Run } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, BotAvatar, ago, untilText, intervalLabel } from "@/lib/ui";

const INTERVALS = [
  { v: 15, l: "Alle 15 Minuten" }, { v: 30, l: "Alle 30 Minuten" }, { v: 60, l: "Stündlich" },
  { v: 180, l: "Alle 3 Stunden" }, { v: 360, l: "Alle 6 Stunden" }, { v: 720, l: "Alle 12 Stunden" },
  { v: 1440, l: "Täglich" }, { v: 10080, l: "Wöchentlich" },
];

function TaskDialog({ open, onOpenChange, bots }: { open: boolean; onOpenChange: (o: boolean) => void; bots: Bot[] }) {
  const { toast } = useToast();
  const [botId, setBotId] = useState<string>("");
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [interval, setIntervalV] = useState("1440");
  const [webhook, setWebhook] = useState("");

  const create = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/tasks", {
      botId: Number(botId || bots[0]?.id), name, prompt, intervalMinutes: Number(interval), enabled: true, webhookUrl: webhook.trim(),
    })).json(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: "Automation angelegt" });
      setName(""); setPrompt(""); setWebhook("");
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Fehler", description: e.message, variant: "destructive" }),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Neue Automation</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Bot</Label>
              <Select value={botId || String(bots[0]?.id ?? "")} onValueChange={setBotId}>
                <SelectTrigger data-testid="select-task-bot"><SelectValue placeholder="Bot wählen" /></SelectTrigger>
                <SelectContent>{bots.map((b) => <SelectItem key={b.id} value={String(b.id)}>{b.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rhythmus</Label>
              <Select value={interval} onValueChange={setIntervalV}>
                <SelectTrigger data-testid="select-task-interval"><SelectValue /></SelectTrigger>
                <SelectContent>{INTERVALS.map((i) => <SelectItem key={i.v} value={String(i.v)}>{i.l}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-name">Name</Label>
            <Input id="task-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="z.B. Morgen-Briefing" data-testid="input-task-name" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-prompt">Auftrag</Label>
            <Textarea id="task-prompt" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Suche die 5 wichtigsten KI-News von heute und fasse sie mit Links zusammen." data-testid="input-task-prompt" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="task-webhook" className="flex items-center gap-1.5"><Webhook className="h-3.5 w-3.5" />Webhook (optional)</Label>
            <Input id="task-webhook" value={webhook} onChange={(e) => setWebhook(e.target.value)} placeholder="https://discord.com/api/webhooks/…" className="font-mono text-xs" data-testid="input-task-webhook" />
            <p className="text-xs text-muted-foreground">Discord- und Slack-Webhooks werden automatisch formatiert, sonst wird JSON gesendet.</p>
          </div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
          <Button onClick={() => create.mutate()} disabled={!name.trim() || !prompt.trim() || !bots.length || create.isPending} data-testid="button-save-task">Anlegen</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default function Tasks() {
  const { toast } = useToast();
  const { data: bots = [] } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: tasks, isLoading } = useQuery<Task[]>({ queryKey: ["/api/tasks"], refetchInterval: 30_000, staleTime: 0 });
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<number | null>(null);
  const { data: runs } = useQuery<Run[]>({
    queryKey: [selected ? `/api/runs?taskId=${selected}` : "/api/runs"],
    refetchInterval: 30_000, staleTime: 0,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
    queryClient.invalidateQueries({ predicate: (q) => String(q.queryKey[0]).startsWith("/api/runs") });
    queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
  };
  const toggle = useMutation({ mutationFn: ({ id, enabled }: { id: number; enabled: boolean }) => apiRequest("PATCH", `/api/tasks/${id}`, { enabled }), onSuccess: invalidate });
  const del = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/tasks/${id}`), onSuccess: () => { setSelected(null); invalidate(); } });
  const run = useMutation({
    mutationFn: async (id: number) => (await apiRequest("POST", `/api/tasks/${id}/run`)).json(),
    onSuccess: (d: any) => {
      invalidate();
      toast(d.run?.status === "ok" ? { title: "Lauf erfolgreich" } : { title: "Lauf fehlgeschlagen", description: d.run?.output, variant: "destructive" });
    },
  });

  return (
    <div>
      <PageHeader title="Automationen" sub="Bots arbeiten nach Zeitplan, auch wenn du offline bist. Ergebnisse optional per Webhook.">
        <Button size="sm" onClick={() => setOpen(true)} disabled={!bots.length} data-testid="button-create-task"><Plus className="mr-1 h-4 w-4" />Neue Automation</Button>
      </PageHeader>

      <div className="grid gap-6 p-6 xl:grid-cols-[1fr_26rem]">
        <section className="overflow-hidden rounded-lg border border-card-border bg-card">
          {isLoading ? (
            <div className="space-y-2 p-4">{[0, 1].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : !tasks?.length ? (
            <div className="px-6 py-16 text-center">
              <p className="text-sm font-medium">Noch keine Automationen</p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Beispiel: Jeden Morgen um die gleiche Zeit ein News-Briefing in deinen Discord-Kanal.</p>
              <Button size="sm" className="mt-4" onClick={() => setOpen(true)} disabled={!bots.length}>Automation anlegen</Button>
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {tasks.map((t) => {
                const b = bots.find((x) => x.id === t.botId);
                return (
                  <li key={t.id} className={`flex items-center gap-3 px-4 py-3 ${selected === t.id ? "bg-accent/60" : ""}`} data-testid={`row-task-${t.id}`}>
                    {b && <BotAvatar bot={b} size="sm" />}
                    <button className="min-w-0 flex-1 text-left" onClick={() => setSelected(selected === t.id ? null : t.id)} data-testid={`button-select-task-${t.id}`}>
                      <div className="flex items-center gap-2 text-sm font-medium">
                        {t.name}
                        {t.webhookUrl && <Webhook className="h-3.5 w-3.5 text-muted-foreground" />}
                      </div>
                      <div className="line-clamp-1 text-xs text-muted-foreground">{t.prompt}</div>
                      <div className="mt-0.5 font-mono text-[11px] text-muted-foreground">
                        {intervalLabel(t.intervalMinutes)} · zuletzt {ago(t.lastRunAt)} · nächster {t.enabled ? untilText(t.nextRunAt) : "pausiert"}
                      </div>
                    </button>
                    <Button size="icon" variant="ghost" onClick={() => run.mutate(t.id)} disabled={run.isPending && run.variables === t.id} aria-label="Jetzt ausführen" data-testid={`button-run-${t.id}`}>
                      {run.isPending && run.variables === t.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                    </Button>
                    <Switch checked={t.enabled} onCheckedChange={(enabled) => toggle.mutate({ id: t.id, enabled })} aria-label="Aktiv" data-testid={`switch-task-${t.id}`} />
                    <Button size="icon" variant="ghost" onClick={() => del.mutate(t.id)} aria-label="Löschen" data-testid={`button-del-task-${t.id}`}><Trash2 className="h-4 w-4" /></Button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section className="rounded-lg border border-card-border bg-card">
          <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold">
            <History className="h-4 w-4" />{selected ? "Läufe dieser Automation" : "Alle Läufe"}
          </h2>
          {!runs?.length ? (
            <p className="px-4 py-10 text-center text-sm text-muted-foreground">Noch keine Läufe.</p>
          ) : (
            <ul className="max-h-[36rem] divide-y divide-border overflow-y-auto">
              {runs.map((r) => (
                <li key={r.id} className="px-4 py-3" data-testid={`row-run-${r.id}`}>
                  <div className="flex items-center justify-between font-mono text-[11px] text-muted-foreground">
                    <span className={r.status === "ok" ? "text-primary" : "text-destructive"}>{r.status === "ok" ? "OK" : "FEHLER"} · {r.source}</span>
                    <span>{ago(r.startedAt)} · {(r.durationMs / 1000).toFixed(1)}s</span>
                  </div>
                  <p className="mt-1 line-clamp-4 whitespace-pre-wrap text-xs">{r.output}</p>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <TaskDialog open={open} onOpenChange={setOpen} bots={bots} />
    </div>
  );
}
