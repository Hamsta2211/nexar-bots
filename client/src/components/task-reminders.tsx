import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { BellRing, Loader2, Plus, Trash2 } from "lucide-react";
import type { Task } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { ago } from "@/lib/ui";

export type TaskReminder = { id: string; taskId: number; taskName: string; content: string; createdAt: number; updatedAt: number };

function useReminders(taskId?: number) {
  return useQuery<TaskReminder[]>({
    queryKey: [taskId ? `/api/reminders?taskId=${taskId}` : "/api/reminders"],
    staleTime: 0,
  });
}

function useReminderMutations() {
  const { toast } = useToast();
  const invalidate = () => {
    queryClient.invalidateQueries({ predicate: (query) => String(query.queryKey[0]).startsWith("/api/reminders") });
    queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
  };
  const add = useMutation({
    mutationFn: async ({ taskId, content }: { taskId: number; content: string }) => (await apiRequest("POST", `/api/tasks/${taskId}/reminders`, { content })).json(),
    onSuccess: invalidate,
    onError: (error: Error) => toast({ title: "Erinnerung konnte nicht gespeichert werden", description: error.message, variant: "destructive" }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/reminders/${encodeURIComponent(id)}`),
    onSuccess: () => { invalidate(); toast({ title: "Erinnerung gelöscht" }); },
    onError: (error: Error) => toast({ title: "Erinnerung konnte nicht gelöscht werden", description: error.message, variant: "destructive" }),
  });
  return { add, remove };
}

export function RemindersPanel({ tasks }: { tasks: Task[] }) {
  const [taskId, setTaskId] = useState("");
  const [content, setContent] = useState("");
  const { data: reminders = [], isLoading } = useReminders();
  const { add, remove } = useReminderMutations();
  const selectedTask = tasks.find((task) => String(task.id) === taskId);

  const submit = () => {
    if (!selectedTask || !content.trim()) return;
    add.mutate({ taskId: selectedTask.id, content: content.trim() }, { onSuccess: () => setContent("") });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <section className="overflow-hidden rounded-lg border border-card-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold"><BellRing className="h-4 w-4 text-primary" />Erinnerungen</div>
        {isLoading ? <p className="p-6 text-sm text-muted-foreground">Erinnerungen werden geladen …</p> : !reminders.length ? (
          <div className="px-6 py-14 text-center"><BellRing className="mx-auto h-8 w-8 text-muted-foreground/50" /><p className="mt-3 text-sm font-medium">Noch keine Erinnerungen</p><p className="mt-1 text-xs text-muted-foreground">Lege eine Erinnerung an und ordne sie einer Automation zu.</p></div>
        ) : (
          <ul className="divide-y divide-border">
            {reminders.map((reminder) => (
              <li key={reminder.id} className="flex items-start gap-3 px-4 py-4" data-testid={`row-reminder-${reminder.id}`}>
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" />
                <div className="min-w-0 flex-1"><p className="whitespace-pre-wrap break-words text-sm">{reminder.content}</p><p className="mt-2 text-xs text-muted-foreground">{reminder.taskName} · erstellt {ago(reminder.createdAt)}</p></div>
                <Button size="icon" variant="ghost" aria-label="Erinnerung löschen" onClick={() => remove.mutate(reminder.id)} disabled={remove.isPending}><Trash2 className="h-4 w-4" /></Button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="h-fit rounded-lg border border-card-border bg-card p-4">
        <h2 className="text-sm font-semibold">Neue Erinnerung</h2>
        <p className="mt-1 text-xs text-muted-foreground">Die Erinnerung erscheint bei dieser Automation und in der gekoppelten Nexar-Bots-App.</p>
        <div className="mt-4 space-y-3">
          <div className="space-y-1.5"><Label>Automation</Label><Select value={taskId} onValueChange={setTaskId}><SelectTrigger><SelectValue placeholder="Automation wählen" /></SelectTrigger><SelectContent>{tasks.map((task) => <SelectItem key={task.id} value={String(task.id)}>{task.name}</SelectItem>)}</SelectContent></Select></div>
          <div className="space-y-1.5"><Label htmlFor="reminder-content">Erinnerung</Label><Input id="reminder-content" value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} maxLength={2_000} placeholder="z. B. Ergebnisse vor dem Meeting prüfen" /></div>
          <Button className="w-full" onClick={submit} disabled={!selectedTask || !content.trim() || add.isPending}>{add.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}Erinnerung hinzufügen</Button>
          {!tasks.length && <p className="text-xs text-muted-foreground">Lege zuerst eine Automation an.</p>}
        </div>
      </section>
    </div>
  );
}

export function TaskRemindersDialog({ task, open, onOpenChange }: { task: Task | null; open: boolean; onOpenChange: (open: boolean) => void }) {
  const [content, setContent] = useState("");
  const { toast } = useToast();
  const { data: reminders = [], isLoading } = useReminders(task?.id);
  const { add, remove } = useReminderMutations();
  const submit = () => {
    if (!task || !content.trim()) return;
    add.mutate({ taskId: task.id, content: content.trim() }, { onSuccess: () => { setContent(""); toast({ title: "Erinnerung hinzugefügt" }); } });
  };
  if (!open || !task) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" role="dialog" aria-modal="true" aria-labelledby="task-reminders-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onOpenChange(false); }}>
      <section className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-border bg-card p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4"><div><h2 id="task-reminders-title" className="text-lg font-semibold">Erinnerungen</h2><p className="mt-1 text-sm text-muted-foreground">{task.name}</p></div><Button size="sm" variant="ghost" onClick={() => onOpenChange(false)}>Schließen</Button></div>
        <div className="mt-5 flex gap-2"><Input autoFocus value={content} onChange={(event) => setContent(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submit(); }} maxLength={2_000} placeholder="Erinnerung eingeben …" /><Button onClick={submit} disabled={!content.trim() || add.isPending} aria-label="Erinnerung hinzufügen"><Plus className="h-4 w-4" /></Button></div>
        {isLoading ? <p className="py-6 text-sm text-muted-foreground">Wird geladen …</p> : !reminders.length ? <p className="py-8 text-center text-sm text-muted-foreground">Noch keine Erinnerungen für diese Automation.</p> : <ul className="mt-4 divide-y divide-border">{reminders.map((reminder) => <li key={reminder.id} className="flex items-start gap-3 py-3"><p className="flex-1 whitespace-pre-wrap text-sm">{reminder.content}</p><Button size="icon" variant="ghost" aria-label="Erinnerung löschen" onClick={() => remove.mutate(reminder.id)} disabled={remove.isPending}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>}
      </section>
    </div>
  );
}
