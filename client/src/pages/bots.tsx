import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { AlertTriangle, Brain, MessagesSquare, Pencil, Plus, Trash2, X } from "lucide-react";
import { SiGooglegemini } from "react-icons/si";
import type { Bot, Memory, ToolId } from "@shared/schema";
import { TOOL_IDS } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, BotAvatar, ProviderBadge, BOT_COLORS, GroqMark } from "@/lib/ui";
import { ModelPicker, useModelCatalog } from "@/components/model-picker";

type Draft = {
  name: string; description: string; color: string; provider: "groq" | "google";
  model: string; systemPrompt: string; temperature: number; tools: ToolId[];
};

const EMPTY: Draft = {
  name: "", description: "", color: "lime", provider: "groq", model: "",
  systemPrompt: "", temperature: 0.7, tools: ["datetime", "calculator"],
};

const TEMPLATES: { label: string; draft: Partial<Draft> }[] = [
  { label: "Recherche", draft: { name: "Scout", color: "sky", tools: ["web_search", "fetch_url", "datetime"], temperature: 0.3, systemPrompt: "Du bist Scout, ein Recherche-Agent. Suche im Web, lies 2–3 Quellen und fasse präzise mit Links zusammen." } },
  { label: "News-Briefing", draft: { name: "Herold", color: "amber", tools: ["web_search", "fetch_url", "datetime"], temperature: 0.4, systemPrompt: "Du erstellst kompakte News-Briefings: 5 Stichpunkte, jeweils mit Quelle. Sachlich, auf Deutsch." } },
  { label: "Coding", draft: { name: "Forge", color: "violet", tools: ["fetch_url", "calculator"], temperature: 0.2, systemPrompt: "Du bist Forge, ein Senior Software Engineer. Antworte mit lauffähigem, kommentiertem Code und kurzen Erklärungen." } },
  { label: "Persönlich", draft: { name: "Echo", color: "rose", tools: ["memory", "datetime"], temperature: 0.8, systemPrompt: "Du bist Echo, ein persönlicher Assistent. Merke dir wichtige Fakten über den Nutzer mit save_memory." } },
];

function BotEditor({ open, onOpenChange, bot }: { open: boolean; onOpenChange: (o: boolean) => void; bot?: Bot }) {
  const { toast } = useToast();
  const [d, setD] = useState<Draft>(EMPTY);
  const [ready, setReady] = useState(false);
  const { data: tools } = useQuery<Record<ToolId, { label: string; description: string }>>({ queryKey: ["/api/tools"] });
  const { data: mems } = useQuery<Memory[]>({ queryKey: ["/api/bots", bot?.id ?? 0, "memories"], enabled: !!bot && open });

  useEffect(() => {
    if (!open) { setReady(false); return; }
    setD(bot ? {
      name: bot.name, description: bot.description, color: bot.color, provider: bot.provider as any, model: bot.model,
      systemPrompt: bot.systemPrompt, temperature: bot.temperature, tools: JSON.parse(bot.tools || "[]"),
    } : EMPTY);
    setReady(true);
  }, [open, bot]);

  const save = useMutation({
    mutationFn: async () => {
      const body = { ...d, tools: JSON.stringify(d.tools) };
      return (await (bot ? apiRequest("PATCH", `/api/bots/${bot.id}`, body) : apiRequest("POST", "/api/bots", body))).json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/stats"] });
      toast({ title: bot ? "Bot aktualisiert" : "Bot erstellt" });
      onOpenChange(false);
    },
    onError: (e: Error) => toast({ title: "Speichern fehlgeschlagen", description: e.message, variant: "destructive" }),
  });

  const delMem = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/memories/${id}`),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/bots", bot?.id ?? 0, "memories"] }),
  });

  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((p) => ({ ...p, [k]: v }));

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{bot ? `${bot.name} bearbeiten` : "Neuer Bot"}</SheetTitle>
        </SheetHeader>

        <div className="mt-5 space-y-5">
          {!bot && (
            <div>
              <Label className="text-xs text-muted-foreground">Vorlage</Label>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {TEMPLATES.map((t) => (
                  <button key={t.label} onClick={() => setD((p) => ({ ...p, ...t.draft }))} className="rounded-md border border-border px-2.5 py-1 text-xs hover-elevate" data-testid={`button-template-${t.label}`}>
                    {t.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-[1fr_auto] gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="bot-name">Name</Label>
              <Input id="bot-name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="z.B. Nova" data-testid="input-bot-name" />
            </div>
            <div className="space-y-1.5">
              <Label>Farbe</Label>
              <div className="flex h-9 items-center gap-1">
                {Object.keys(BOT_COLORS).map((c) => (
                  <button key={c} aria-label={c} onClick={() => set("color", c)} data-testid={`button-color-${c}`}
                    className={`h-6 w-6 rounded-md ${BOT_COLORS[c].bg} ring-1 ${d.color === c ? "ring-2 ring-foreground" : BOT_COLORS[c].ring}`} />
                ))}
              </div>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bot-desc">Kurzbeschreibung</Label>
            <Input id="bot-desc" value={d.description} onChange={(e) => set("description", e.target.value)} placeholder="Wofür ist der Bot da?" data-testid="input-bot-description" />
          </div>

          <div className="space-y-1.5">
            <Label>Anbieter</Label>
            <div className="grid grid-cols-2 gap-2">
              {([["groq", "Groq", <GroqMark key="g" className="h-4 w-4" />], ["google", "Google Gemini", <SiGooglegemini key="s" className="h-4 w-4" />]] as const).map(([id, label, icon]) => (
                <button key={id} data-testid={`button-provider-${id}`}
                  onClick={() => setD((p) => ({ ...p, provider: id, model: p.provider === id ? p.model : "" }))}
                  className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm hover-elevate ${d.provider === id ? "border-primary bg-primary/10" : "border-border"}`}>
                  {icon}{label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Modell</Label>
            {ready && <ModelPicker provider={d.provider} value={d.model} onChange={(v) => set("model", v)} />}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="bot-prompt">System-Prompt</Label>
            <Textarea id="bot-prompt" rows={5} value={d.systemPrompt} onChange={(e) => set("systemPrompt", e.target.value)} placeholder="Persönlichkeit, Regeln, Ausgabeformat …" data-testid="input-bot-prompt" />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Kreativität (Temperatur)</Label>
              <span className="font-mono text-xs">{d.temperature.toFixed(1)}</span>
            </div>
            <Slider min={0} max={1.5} step={0.1} value={[d.temperature]} onValueChange={([v]) => set("temperature", v)} data-testid="slider-temperature" />
          </div>

          <div className="space-y-2">
            <Label>Werkzeuge</Label>
            <div className="divide-y divide-border rounded-md border border-border">
              {TOOL_IDS.map((t) => (
                <label key={t} className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5">
                  <div>
                    <div className="text-sm font-medium">{tools?.[t]?.label ?? t}</div>
                    <div className="text-xs text-muted-foreground">{tools?.[t]?.description}</div>
                  </div>
                  <Switch checked={d.tools.includes(t)} data-testid={`switch-tool-${t}`}
                    onCheckedChange={(on) => set("tools", on ? [...d.tools, t] : d.tools.filter((x) => x !== t))} />
                </label>
              ))}
            </div>
          </div>

          {bot && d.tools.includes("memory") && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" />Gedächtnis ({mems?.length ?? 0})</Label>
              {!mems?.length ? (
                <p className="text-xs text-muted-foreground">Noch keine Notizen gespeichert.</p>
              ) : (
                <ul className="max-h-40 space-y-1 overflow-y-auto">
                  {mems.map((m) => (
                    <li key={m.id} className="flex items-start justify-between gap-2 rounded-md bg-muted/50 px-2.5 py-1.5 text-xs">
                      <span>{m.content}</span>
                      <button onClick={() => delMem.mutate(m.id)} aria-label="Notiz löschen" data-testid={`button-del-memory-${m.id}`}><X className="h-3.5 w-3.5 text-muted-foreground" /></button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 border-t border-border pt-4">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>Abbrechen</Button>
            <Button onClick={() => save.mutate()} disabled={!d.name.trim() || !d.model.trim() || save.isPending} data-testid="button-save-bot">
              {bot ? "Speichern" : "Bot erstellen"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

export default function Bots() {
  const { data: bots, isLoading } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: tools } = useQuery<Record<string, { label: string }>>({ queryKey: ["/api/tools"] });
  const { data: groqCat } = useModelCatalog("groq");
  const { data: googleCat } = useModelCatalog("google");
  const isUnavailable = (b: Bot) => {
    const cat = b.provider === "groq" ? groqCat : googleCat;
    return !!cat?.live && !cat.models.some((m) => m.id === b.model);
  };
  const [editing, setEditing] = useState<Bot | undefined>();
  const [open, setOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Bot | null>(null);
  const { toast } = useToast();

  const del = useMutation({
    mutationFn: (id: number) => apiRequest("DELETE", `/api/bots/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/bots"] });
      queryClient.invalidateQueries({ queryKey: ["/api/tasks"] });
      toast({ title: "Bot gelöscht" });
    },
  });

  return (
    <div>
      <PageHeader title="Bots" sub="Jeder Bot hat eigenes Modell, Persönlichkeit, Werkzeuge und Gedächtnis.">
        <Button size="sm" onClick={() => { setEditing(undefined); setOpen(true); }} data-testid="button-create-bot">
          <Plus className="mr-1 h-4 w-4" />Neuer Bot
        </Button>
      </PageHeader>
      <div className="grid gap-4 p-6 md:grid-cols-2 xl:grid-cols-3">
        {isLoading && [0, 1, 2].map((i) => <Skeleton key={i} className="h-44" />)}
        {bots?.map((b) => {
          const t: string[] = JSON.parse(b.tools || "[]");
          return (
            <article key={b.id} className="flex flex-col rounded-lg border border-card-border bg-card p-4" data-testid={`card-bot-${b.id}`}>
              <div className="flex items-start gap-3">
                <BotAvatar bot={b} size="lg" />
                <div className="min-w-0 flex-1">
                  <h2 className="font-semibold">{b.name}</h2>
                  <p className="line-clamp-2 text-sm text-muted-foreground">{b.description || "Keine Beschreibung"}</p>
                </div>
              </div>
              <div className="mt-3 flex flex-wrap gap-1.5">
                <ProviderBadge provider={b.provider} model={b.model} />
                {t.map((x) => <span key={x} className="rounded-md bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{tools?.[x]?.label ?? x}</span>)}
              </div>
              {isUnavailable(b) && (
                <button onClick={() => { setEditing(b); setOpen(true); }} className="mt-3 flex items-center gap-1.5 text-left text-xs text-amber-600 dark:text-amber-400" data-testid={`warning-model-${b.id}`}>
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />Modell nicht mehr verfügbar, bitte neues wählen
                </button>
              )}
              <div className="mt-auto flex items-center gap-1 pt-4">
                <Link href={`/chat/${b.id}`} className="flex-1"><Button size="sm" variant="secondary" className="w-full" data-testid={`button-chat-${b.id}`}><MessagesSquare className="mr-1.5 h-4 w-4" />Chat</Button></Link>
                <Button size="icon" variant="ghost" onClick={() => { setEditing(b); setOpen(true); }} aria-label="Bearbeiten" data-testid={`button-edit-${b.id}`}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => setToDelete(b)} aria-label="Löschen" data-testid={`button-delete-${b.id}`}><Trash2 className="h-4 w-4" /></Button>
              </div>
            </article>
          );
        })}
        {!isLoading && !bots?.length && (
          <div className="col-span-full rounded-lg border border-dashed border-border py-16 text-center text-sm text-muted-foreground">
            Noch keine Bots. Erstelle deinen ersten Agenten.
          </div>
        )}
      </div>

      <BotEditor open={open} onOpenChange={setOpen} bot={editing} />

      <AlertDialog open={!!toDelete} onOpenChange={(o) => !o && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{toDelete?.name} löschen?</AlertDialogTitle>
            <AlertDialogDescription>Chats, Gedächtnis und Automationen dieses Bots werden ebenfalls entfernt.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Abbrechen</AlertDialogCancel>
            <AlertDialogAction onClick={() => toDelete && del.mutate(toDelete.id)} data-testid="button-confirm-delete">Löschen</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
