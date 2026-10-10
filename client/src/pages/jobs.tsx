import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Loader2, Plus, ListChecks } from "lucide-react";
import type { Bot } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { PageHeader, ago, BotAvatar } from "@/lib/ui";

export type JobSummary = {
  id: number; title: string; description: string; status: "open" | "done"; createdAt: number; updatedAt: number;
  botIds: number[]; chats: number; running: { botId: number; conversationId: number; since: number }[];
};

export function useJobs(refetchMs = 4000) {
  return useQuery<JobSummary[]>({ queryKey: ["/api/jobs"], refetchInterval: refetchMs, staleTime: 0 });
}

export function JobCard({ job, bots }: { job: JobSummary; bots: Bot[] }) {
  const agents = job.botIds.map((id) => bots.find((b) => b.id === id)).filter(Boolean) as Bot[];
  return (
    <Link href={`/jobs/${job.id}`} className="block rounded-lg border border-card-border bg-card p-4 hover-elevate" data-testid={`card-job-${job.id}`}>
      <div className="flex items-start gap-2">
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{job.title}</h3>
        {job.running.length > 0 ? (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"><Loader2 className="h-3 w-3 animate-spin" />{job.running.length} läuft</span>
        ) : job.status === "done" ? (
          <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">erledigt</span>
        ) : null}
      </div>
      {job.description && <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{job.description}</p>}
      <div className="mt-3 flex items-center gap-2">
        <div className="flex -space-x-1.5">{agents.slice(0, 5).map((b) => <BotAvatar key={b.id} bot={b} size="sm" />)}</div>
        <span className="text-[11px] text-muted-foreground">{agents.length} Agent{agents.length === 1 ? "" : "en"} · {job.chats} Chat{job.chats === 1 ? "" : "s"} · {ago(job.updatedAt)}</span>
      </div>
    </Link>
  );
}

export function AgentPicker({ bots, value, onChange }: { bots: Bot[]; value: number[]; onChange: (v: number[]) => void }) {
  return (
    <div className="grid gap-1.5 sm:grid-cols-2">
      {bots.map((b) => {
        const on = value.includes(b.id);
        return (
          <label key={b.id} className={`flex cursor-pointer items-center gap-2 rounded-md border px-2.5 py-1.5 text-sm ${on ? "border-primary/50 bg-primary/5" : "border-border"}`}>
            <input type="checkbox" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== b.id) : [...value, b.id])} />
            <BotAvatar bot={b} size="sm" /><span className="truncate">{b.name}</span>
          </label>
        );
      })}
    </div>
  );
}

export default function Jobs() {
  const { data: jobs, isLoading } = useJobs();
  const { data: bots } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const qc = useQueryClient();
  const { toast } = useToast();
  const [, navigate] = useLocation();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [desc, setDesc] = useState("");
  const [ids, setIds] = useState<number[]>([]);
  const [busy, setBusy] = useState(false);
  const [showDone, setShowDone] = useState(false);

  const create = async () => {
    if (!title.trim()) return;
    setBusy(true);
    try {
      const j = await (await apiRequest("POST", "/api/jobs", { title, description: desc, botIds: ids })).json();
      await qc.invalidateQueries({ queryKey: ["/api/jobs"] });
      setOpen(false); setTitle(""); setDesc(""); setIds([]);
      navigate(`/jobs/${j.id}`);
    } catch (e: any) { toast({ title: "Fehler", description: e?.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };

  const list = (jobs || []).filter((j) => (showDone ? j.status === "done" : j.status === "open"));
  return (
    <div>
      <PageHeader title="Aufgaben" sub="Aufträge laufen auf dem Server im Hintergrund. Mehrere Agenten pro Aufgabe, jeder mit eigenen Chats.">
        <Button size="sm" onClick={() => setOpen(true)} data-testid="button-new-job"><Plus className="mr-1.5 h-4 w-4" />Neue Aufgabe</Button>
      </PageHeader>
      <div className="space-y-4 p-6">
        <div className="flex gap-2 text-sm">
          <button className={`rounded-md border px-3 py-1 ${!showDone ? "border-primary/50 bg-primary/5" : "border-border text-muted-foreground"}`} onClick={() => setShowDone(false)}>Offen</button>
          <button className={`rounded-md border px-3 py-1 ${showDone ? "border-primary/50 bg-primary/5" : "border-border text-muted-foreground"}`} onClick={() => setShowDone(true)}>Erledigt</button>
        </div>
        {isLoading ? <Skeleton className="h-24 w-full" /> : !list.length ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-sm text-muted-foreground">
            <ListChecks className="mx-auto mb-2 h-6 w-6" />{showDone ? "Noch keine erledigten Aufgaben." : "Noch keine Aufgabe. Lege eine an und gib ihr einen oder mehrere Agenten."}
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{list.map((j) => <JobCard key={j.id} job={j} bots={bots || []} />)}</div>
        )}
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Neue Aufgabe</DialogTitle>
            <DialogDescription>Die Beschreibung sehen alle Agenten der Aufgabe als Kontext.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Titel, z. B. Website-Relaunch" className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm" data-testid="input-job-title" />
            <Textarea value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="Worum geht es? (optional)" rows={3} />
            <div><div className="mb-1 text-xs text-muted-foreground">Agenten</div><AgentPicker bots={bots || []} value={ids} onChange={setIds} /></div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setOpen(false)}>Abbrechen</Button>
              <Button disabled={busy || !title.trim()} onClick={create} data-testid="button-create-job">Anlegen</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
