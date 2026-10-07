import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, ExternalLink, Eye, EyeOff, Loader2, Plus, Repeat, ShieldCheck, Trash2 } from "lucide-react";
import { SiGooglegemini } from "react-icons/si";
import type { KeyStatus, KeyInfo, ProviderKeys } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, GroqMark } from "@/lib/ui";

const PROVIDERS = [
  {
    id: "groq" as const,
    name: "Groq",
    icon: <GroqMark className="h-5 w-5" />,
    url: "https://console.groq.com/keys",
    urlLabel: "console.groq.com/keys",
    prefix: "gsk_",
    note: "Sehr schnelle Inferenz für Llama, GPT-OSS & Co. Kostenloser Plan mit Rate-Limits.",
  },
  {
    id: "google" as const,
    name: "Google Gemini",
    icon: <SiGooglegemini className="h-5 w-5" />,
    url: "https://aistudio.google.com/apikey",
    urlLabel: "aistudio.google.com/apikey",
    prefix: "AIza",
    note: "Gemini-Modelle über Google AI Studio. Kostenlose Stufe mit Tageslimits.",
  },
];

function StatusChip({ k }: { k: KeyInfo }) {
  if (k.status === "invalid") return <span className="rounded bg-destructive/15 px-1.5 py-px font-mono text-[10px] text-destructive">ungültig</span>;
  if (k.status === "cooldown") {
    const sec = Math.max(0, Math.round((k.cooldownUntil - Date.now()) / 1000));
    return <span className="rounded bg-amber-500/15 px-1.5 py-px font-mono text-[10px] text-amber-500">Limit · frei in {sec >= 120 ? `${Math.round(sec / 60)} min` : `${sec} s`}</span>;
  }
  return <span className="rounded bg-primary/15 px-1.5 py-px font-mono text-[10px] text-primary">{k.active ? "in Benutzung" : "bereit"}</span>;
}

function KeyRow({ p, k, i, n }: { p: (typeof PROVIDERS)[number]; k: KeyInfo; i: number; n: number }) {
  const { toast } = useToast();
  const inv = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
    queryClient.invalidateQueries({ queryKey: ["/api/models", p.id] });
  };
  const del = useMutation({ mutationFn: () => apiRequest("DELETE", `/api/keys/${p.id}/${k.id}`), onSuccess: () => { inv(); toast({ title: "Key entfernt" }); } });
  const move = useMutation({ mutationFn: (dir: number) => apiRequest("POST", `/api/keys/${p.id}/${k.id}/move`, { dir }), onSuccess: inv });
  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/keys/test", { provider: p.id, id: k.id })).json(),
    onSuccess: (d: any) => {
      inv();
      toast(d.ok ? { title: `${k.label} funktioniert`, description: `${d.count} Modelle verfügbar.` } : { title: `${k.label} funktioniert nicht`, description: d.message, variant: "destructive" });
    },
  });
  return (
    <li className="flex items-center gap-3 px-4 py-2.5" data-testid={`row-key-${p.id}-${i}`}>
      <span className="w-5 text-right font-mono text-xs text-muted-foreground">{i + 1}</span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">{k.label}</span>
          <code className="font-mono text-xs text-muted-foreground">{k.hint}</code>
          <StatusChip k={k} />
          {k.source === "env" && <span className="font-mono text-[10px] text-muted-foreground">aus .env</span>}
        </div>
        {k.lastError && k.status !== "ok" && <p className="mt-0.5 truncate text-[11px] text-muted-foreground" title={k.lastError}>{k.lastError}</p>}
        {k.uses > 0 && k.status === "ok" && <p className="mt-0.5 text-[11px] text-muted-foreground">{k.uses} Anfragen seit Serverstart</p>}
      </div>
      <div className="flex items-center gap-0.5">
        {k.source === "app" && (
          <>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i === 0} onClick={() => move.mutate(-1)} aria-label="Nach oben"><ArrowUp className="h-3.5 w-3.5" /></Button>
            <Button variant="ghost" size="icon" className="h-7 w-7" disabled={i >= n - 1} onClick={() => move.mutate(1)} aria-label="Nach unten"><ArrowDown className="h-3.5 w-3.5" /></Button>
          </>
        )}
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={() => test.mutate()} disabled={test.isPending} data-testid={`button-test-${p.id}-${i}`}>
          {test.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Testen"}
        </Button>
        {k.source === "app" && (
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => del.mutate()} aria-label="Key entfernen" data-testid={`button-remove-${p.id}-${i}`}><Trash2 className="h-3.5 w-3.5" /></Button>
        )}
      </div>
    </li>
  );
}

function KeyCard({ p, status }: { p: (typeof PROVIDERS)[number]; status?: ProviderKeys }) {
  const { toast } = useToast();
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");
  const [show, setShow] = useState(false);
  const keys = status?.keys || [];

  const add = useMutation({
    mutationFn: async () => {
      const key = value.trim();
      const t = await (await apiRequest("POST", "/api/keys/test", { provider: p.id, key })).json();
      if (!t.ok) throw new Error(t.message || "Key funktioniert nicht");
      await apiRequest("POST", `/api/keys/${p.id}`, { key, label: label.trim() || undefined });
      return t;
    },
    onSuccess: (t: any) => {
      queryClient.invalidateQueries({ queryKey: ["/api/keys"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models", p.id] });
      setValue(""); setLabel("");
      toast({ title: `${p.name}-Key hinzugefügt`, description: `Getestet: ${t.count} Modelle verfügbar.` });
    },
    onError: (e: Error) => toast({ title: "Key nicht gespeichert", description: e.message, variant: "destructive" }),
  });

  return (
    <section className="rounded-lg border border-card-border bg-card" data-testid={`card-key-${p.id}`}>
      <div className="flex items-start gap-3 border-b border-border p-4">
        <div className="grid h-9 w-9 place-items-center rounded-md border border-border bg-muted/40">{p.icon}</div>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h2 className="font-semibold">{p.name}</h2>
            <span className={`rounded px-1.5 py-0.5 font-mono text-[11px] ${keys.length ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground"}`} data-testid={`status-key-${p.id}`}>
              {keys.length ? `${keys.length} Key${keys.length > 1 ? "s" : ""}` : "nicht gesetzt"}
            </span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{p.note}</p>
        </div>
      </div>

      {keys.length > 0 && <ul className="divide-y divide-border border-b border-border">{keys.map((k, i) => <KeyRow key={k.id} p={p} k={k} i={i} n={keys.filter((x) => x.source === "app").length} />)}</ul>}

      <form className="space-y-3 p-4" onSubmit={(e) => { e.preventDefault(); if (value.trim()) add.mutate(); }}>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={`Name (z.B. Konto ${keys.length + 1})`} className="sm:w-44" data-testid={`input-label-${p.id}`} />
          <div className="relative flex-1">
            <Input type={show ? "text" : "password"} value={value} onChange={(e) => setValue(e.target.value)} placeholder={`${p.prefix}…`} className="pr-9 font-mono text-sm" data-testid={`input-key-${p.id}`} autoComplete="off" />
            <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground" aria-label="Key anzeigen">
              {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
          <Button type="submit" disabled={!value.trim() || add.isPending} data-testid={`button-save-${p.id}`}>
            {add.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Plus className="mr-1.5 h-4 w-4" />}Hinzufügen
          </Button>
        </div>
        <a href={p.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-sm text-primary hover:underline" data-testid={`link-get-${p.id}`}>
          Key holen auf {p.urlLabel} <ExternalLink className="h-3.5 w-3.5" />
        </a>
      </form>
    </section>
  );
}

export default function Settings() {
  const { data } = useQuery<KeyStatus>({ queryKey: ["/api/keys"], refetchInterval: 10_000 });
  return (
    <div>
      <PageHeader title="API-Keys" sub="Bring your own key: Nexar nutzt ausschließlich deine eigenen Keys." />
      <div className="max-w-3xl space-y-4 p-6">
        <div className="flex gap-3 rounded-lg border border-border p-4 text-sm text-muted-foreground">
          <Repeat className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Du kannst beliebig viele Keys pro Anbieter hinterlegen, z.B. von mehreren Konten. Nexar nutzt sie der Reihe nach: Kommt ein Rate-Limit, ein Kontingent-Fehler oder ein Ausfall, wechselt es sofort zum nächsten Key, auch mitten in einem Agenten-Lauf. Modell, Kontext und bisherige Schritte bleiben dabei gleich. Ein Key im Limit wird automatisch wieder genutzt, sobald er frei ist.
          </p>
        </div>
        {PROVIDERS.map((p) => <KeyCard key={p.id} p={p} status={data?.[p.id]} />)}
        <div className="flex gap-3 rounded-lg border border-border p-4 text-sm text-muted-foreground">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <p>
            Keys werden verschlüsselt (AES-256-GCM) in deiner Supabase-Datenbank gespeichert. Der Schlüssel dazu liegt nur auf deinem Server, nicht in Supabase.
            Ins Frontend gelangen nur die letzten 4 Zeichen. Alternativ kannst du sie als Umgebungsvariablen <code className="font-mono text-foreground">GROQ_API_KEY</code> und{" "}
            <code className="font-mono text-foreground">GOOGLE_API_KEY</code> setzen (mehrere kommagetrennt).
          </p>
        </div>
      </div>
    </div>
  );
}
