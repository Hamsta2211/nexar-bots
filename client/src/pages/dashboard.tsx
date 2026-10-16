import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { motion, AnimatePresence } from "framer-motion";
import { ArrowUp, Bot as BotIcon, Loader2, MessageSquare, NotebookPen, Plus, Sparkles } from "lucide-react";
import type { Bot, Task } from "@shared/schema";
import type { TaskReminder } from "@/components/task-reminders";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { queryClient } from "@/lib/queryClient";
import { streamChat } from "@/lib/stream";
import { ago } from "@/lib/ui";

export default function Dashboard() {
  const [, navigate] = useLocation();
  const { data: reminders = [], isLoading: remindersLoading } = useQuery<TaskReminder[]>({
    queryKey: ["/api/reminders"], staleTime: 0,
  });
  const { data: bots = [] } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: tasks = [] } = useQuery<Task[]>({ queryKey: ["/api/tasks"] });
  const [input, setInput] = useState("");
  const [botId, setBotId] = useState("");
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState("");
  const [conversationId, setConversationId] = useState<number | null>(null);

  const selectedBot = bots.find((bot) => bot.id === Number(botId)) || bots[0];
  const taskById = new Map(tasks.map((task) => [task.id, task]));

  const send = async () => {
    const text = input.trim();
    if (!text || !selectedBot || sending) return;
    setSending(true);
    setInput("");
    setAnswer("");
    let conversation: number | null = null;
    let draft = "";
    try {
      await streamChat(selectedBot.id, { message: text }, {
        onStart: (id) => { conversation = id; setConversationId(id); },
        onToken: (token) => { draft += token; setAnswer(draft); },
        onReset: () => { draft = ""; setAnswer(""); },
        onError: (message) => setAnswer(`Fehler: ${message}`),
      });
    } catch (error: any) {
      setAnswer(`Fehler: ${error?.message || "Der Chat konnte nicht gestartet werden."}`);
    } finally {
      setSending(false);
      if (conversation) {
        queryClient.invalidateQueries({ queryKey: ["/api/bots", selectedBot.id, "conversations"] });
        queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      }
    }
  };

  return (
    <div className="mx-auto min-h-full max-w-6xl px-3 py-4 sm:px-6 sm:py-7">
      <motion.header
        initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.32 }}
        className="mb-6 flex flex-wrap items-end justify-between gap-3"
      >
        <div>
          <div className="flex items-center gap-2 text-primary"><NotebookPen className="h-4 w-4" /><span className="text-xs font-semibold uppercase tracking-[0.16em]">Nexar Vault</span></div>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight">Erinnerungen</h1>
          <p className="mt-1 text-sm text-muted-foreground">Deine Notizen, klar wie in Obsidian – und direkt bereit für ein Gespräch.</p>
        </div>
        <Link href="/tasks"><Button variant="outline" size="sm"><Plus className="mr-1.5 h-4 w-4" />Erinnerung anlegen</Button></Link>
      </motion.header>

      <section aria-label="Gespeicherte Erinnerungen">
        {remindersLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{[0, 1, 2].map((item) => <div key={item} className="h-36 animate-pulse rounded-xl border border-border bg-muted/35" />)}</div>
        ) : !reminders.length ? (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="rounded-xl border border-dashed border-border bg-card/50 px-5 py-12 text-center">
            <NotebookPen className="mx-auto h-8 w-8 text-muted-foreground/50" />
            <p className="mt-3 text-sm font-medium">Dein Vault ist noch leer.</p>
            <p className="mt-1 text-sm text-muted-foreground">Lege unter Automationen eine Erinnerung an; sie erscheint anschließend hier als Notiz.</p>
          </motion.div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {reminders.map((reminder, index) => {
              const task = taskById.get(reminder.taskId);
              return (
                <motion.article
                  key={reminder.id}
                  initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.28, delay: Math.min(index * 0.045, 0.28) }}
                  whileHover={{ y: -3, transition: { duration: 0.16 } }}
                  className="group relative overflow-hidden rounded-xl border border-card-border bg-card p-4 shadow-sm"
                  data-testid={`home-reminder-${reminder.id}`}
                >
                  <span className="absolute inset-x-0 top-0 h-1 bg-primary/65" />
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><NotebookPen className="h-3.5 w-3.5" /></span>
                    <div className="min-w-0 flex-1">
                      <p className="whitespace-pre-wrap break-words text-sm leading-6">{reminder.content}</p>
                      <div className="mt-4 flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span className="truncate">#{reminder.taskName}</span>
                        <span className={task?.enabled === false ? "text-amber-600 dark:text-amber-400" : ""}>{task?.enabled === false ? "pausiert" : ago(reminder.updatedAt)}</span>
                      </div>
                    </div>
                  </div>
                </motion.article>
              );
            })}
          </div>
        )}
      </section>

      <motion.section
        initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, delay: 0.12 }}
        className="mt-6 rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.07] via-card to-card p-3 shadow-sm sm:p-4"
      >
        <div className="mb-3 flex items-center gap-2"><Sparkles className="h-4 w-4 text-primary" /><h2 className="text-sm font-semibold">Schnellchat</h2><span className="text-xs text-muted-foreground">wird dauerhaft gespeichert</span></div>
        {selectedBot ? (
          <>
            <div className="flex items-center gap-2 rounded-lg border border-input bg-background/80 p-2 focus-within:ring-1 focus-within:ring-ring">
              <Textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send(); } }}
                placeholder={`Frag ${selectedBot.name} etwas zu deinen Notizen …`}
                rows={1}
                className="min-h-[2.5rem] max-h-40 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
                data-testid="input-home-chat"
              />
              <Button size="icon" onClick={() => void send()} disabled={!input.trim() || sending} aria-label="Chat senden" data-testid="button-home-chat-send">
                {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" />}
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><BotIcon className="h-3.5 w-3.5" />
                <select value={botId || String(selectedBot.id)} onChange={(event) => setBotId(event.target.value)} className="bg-transparent text-foreground outline-none">
                  {bots.map((bot) => <option key={bot.id} value={bot.id}>{bot.name}</option>)}
                </select>
              </label>
              <span className="text-[11px] text-muted-foreground">Enter senden · Shift+Enter neue Zeile</span>
            </div>
          </>
        ) : <p className="py-4 text-sm text-muted-foreground">Lege zuerst einen Bot an, um den Schnellchat zu verwenden.</p>}

        <AnimatePresence>
          {answer && (
            <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
              <div className="mt-3 rounded-lg border border-border bg-background/75 p-3 text-sm whitespace-pre-wrap">
                {answer}{sending && <span className="ml-1 inline-block h-4 w-1 animate-pulse bg-primary/70 align-middle" />}
              </div>
              {conversationId && <button onClick={() => navigate(`/chat/${selectedBot?.id}`)} className="mt-2 inline-flex items-center gap-1.5 text-xs text-primary hover:underline"><MessageSquare className="h-3.5 w-3.5" />Vollständigen Chat öffnen</button>}
            </motion.div>
          )}
        </AnimatePresence>
      </motion.section>
    </div>
  );
}
