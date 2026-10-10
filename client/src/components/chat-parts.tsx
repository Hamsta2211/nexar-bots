import { memo, useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Brain, ChevronRight, Copy, Download, Eye, FileCode2, Repeat, Wrench, Loader2 } from "lucide-react";
import type { ToolStep } from "@shared/schema";
import { extractArtifacts, type PcArtifact } from "@shared/artifacts";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

export type LiveItem =
  | { kind: "think"; text: string; done: boolean }
  | { kind: "tool"; step: { tool: string; args: any; result: string } };

const short = (s: string, n: number) => { const t = s.replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };

function ThinkBlock({ text, live, index }: { text: string; live?: boolean; index: number }) {
  const [open, setOpen] = useState(!!live);
  useEffect(() => { if (live) setOpen(true); }, [live]);
  return (
    <div className="rounded-md border border-border/70 bg-muted/30" data-testid="block-think">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] text-muted-foreground" aria-expanded={open}>
        {live ? <Loader2 className="h-3 w-3 shrink-0 animate-spin" /> : <Brain className="h-3 w-3 shrink-0" />}
        <span className="shrink-0 font-medium">{live ? "Denkt nach …" : `Gedanke ${index}`}</span>
        {!open && <span className="min-w-0 flex-1 truncate italic opacity-80">{short(text, 90)}</span>}
        <ChevronRight className={`ml-auto h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && <div className="border-t border-border/60 px-3 py-2 text-xs italic leading-relaxed text-muted-foreground whitespace-pre-wrap">{text}</div>}
    </div>
  );
}

function ToolRow({ s }: { s: { tool: string; args: any; result: string } }) {
  const [open, setOpen] = useState(false);
  const isWrite = s.tool === "write_file_on_my_pc";
  const args = isWrite ? { path: s.args?.path, bytes: String(s.args?.content ?? "").length } : s.args;
  const label = s.tool === "run_on_my_pc" ? short(String(s.args?.command || ""), 70) : isWrite ? String(s.args?.path || "") : short(JSON.stringify(s.args ?? {}), 70);
  return (
    <div className="rounded-md border border-border/70 bg-muted/20">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left font-mono text-[11px] text-muted-foreground" aria-expanded={open}>
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="shrink-0 text-primary">{s.tool}</span>
        {!open && <span className="min-w-0 flex-1 truncate opacity-80">{label}</span>}
        <ChevronRight className={`ml-auto h-3 w-3 shrink-0 transition-transform ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <div className="border-t border-border/60 px-2.5 py-2 font-mono text-[11px]">
          <div className="text-primary break-all">{s.tool}({JSON.stringify(args)})</div>
          <pre className="mt-1 max-h-44 overflow-auto whitespace-pre-wrap text-muted-foreground">{s.result}</pre>
        </div>
      )}
    </div>
  );
}

/** Gedanken und Werkzeugaufrufe in der Reihenfolge, in der sie passiert sind. */
export const Timeline = memo(function Timeline({ steps, live }: { steps: (ToolStep | LiveItem)[]; live?: boolean }) {
  const items = useMemo(() => {
    const out: ({ kind: "think"; text: string; done: boolean } | { kind: "tool"; step: any } | { kind: "note"; text: string })[] = [];
    for (const s of steps as any[]) {
      if (s.kind) out.push(s);
      else if (s.tool === "denken") out.push({ kind: "think", text: String(s.result || ""), done: true });
      else if (s.tool === "nexar") out.push({ kind: "note", text: String(s.result || "") });
      else out.push({ kind: "tool", step: s });
    }
    return out;
  }, [steps]);
  const [all, setAll] = useState(false);
  if (!items.length) return null;
  const notes = Array.from(new Set(items.filter((i) => i.kind === "note").map((i: any) => i.text)));
  const rest = items.filter((i) => i.kind !== "note");
  const nThink = rest.filter((i) => i.kind === "think").length, nTool = rest.length - nThink;
  let ti = 0;
  return (
    <div className="mb-2 space-y-1.5" data-testid="timeline">
      {notes.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {notes.map((n) => (
            <span key={n} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 font-mono text-[10px] text-muted-foreground" data-testid="chip-nexar-note"><Repeat className="h-2.5 w-2.5" />{n}</span>
          ))}
        </div>
      )}
      {rest.length > 0 && !live && (
        <button type="button" onClick={() => setAll((o) => !o)} className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover-elevate" data-testid="button-toggle-steps" aria-expanded={all}>
          <Brain className="h-3 w-3" />
          {nThink > 0 && `${nThink} Gedanke${nThink > 1 ? "n" : ""}`}{nThink > 0 && nTool > 0 && " · "}{nTool > 0 && `${nTool} Werkzeug-Aufruf${nTool > 1 ? "e" : ""}`}
          <ChevronRight className={`h-3 w-3 transition-transform ${all ? "rotate-90" : ""}`} />
        </button>
      )}
      {(live || all) && (
        <div className="space-y-1.5">
          {rest.map((it: any, i) => it.kind === "think"
            ? <ThinkBlock key={i} text={it.text} index={++ti} live={live && !it.done} />
            : <ToolRow key={i} s={it.step} />)}
        </div>
      )}
    </div>
  );
});

// ---------------- Artefakte ----------------
const LANG_LABEL: Record<string, string> = { python: "Python", bash: "Shell", javascript: "JavaScript", typescript: "TypeScript", html: "HTML", markdown: "Markdown", json: "JSON", css: "CSS", text: "Text" };
const MIME: Record<string, string> = { html: "text/html", json: "application/json", markdown: "text/markdown", css: "text/css", python: "text/x-python", bash: "text/x-shellscript" };

function ArtifactView({ a }: { a: PcArtifact }) {
  const { toast } = useToast();
  const canPreview = a.lang === "html" || a.lang === "markdown";
  const [tab, setTab] = useState<"code" | "preview">(canPreview ? "preview" : "code");
  const download = () => {
    const url = URL.createObjectURL(new Blob([a.content], { type: `${MIME[a.lang] || "text/plain"};charset=utf-8` }));
    const l = document.createElement("a");
    l.href = url; l.download = a.name; document.body.appendChild(l); l.click(); l.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  };
  const lines = a.content.split("\n");
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5">
        {canPreview && (
          <>
            <Button size="sm" variant={tab === "preview" ? "default" : "outline"} onClick={() => setTab("preview")}><Eye className="mr-1.5 h-3.5 w-3.5" />Vorschau</Button>
            <Button size="sm" variant={tab === "code" ? "default" : "outline"} onClick={() => setTab("code")}>Code</Button>
          </>
        )}
        <div className="ml-auto flex gap-1.5">
          <Button size="sm" variant="outline" onClick={() => { navigator.clipboard?.writeText(a.content); toast({ title: "Kopiert" }); }}><Copy className="mr-1.5 h-3.5 w-3.5" />Kopieren</Button>
          <Button size="sm" variant="outline" onClick={download}><Download className="mr-1.5 h-3.5 w-3.5" />Herunterladen</Button>
        </div>
      </div>
      {tab === "preview" && a.lang === "html" ? (
        <iframe title={a.name} sandbox="allow-scripts" srcDoc={a.content} className="h-[55vh] w-full rounded-md border border-border bg-white" />
      ) : tab === "preview" ? (
        <div className="prose-chat max-h-[55vh] overflow-auto rounded-md border border-border p-3 text-sm"><ReactMarkdown remarkPlugins={[remarkGfm]}>{a.content}</ReactMarkdown></div>
      ) : (
        <div className="max-h-[55vh] overflow-auto rounded-md border border-border bg-muted/30">
          <table className="w-full border-collapse font-mono text-[12px] leading-5">
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="select-none border-r border-border/60 px-2 text-right align-top text-muted-foreground/70">{i + 1}</td>
                  <td className="whitespace-pre px-3">{l || " "}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-muted-foreground">Auf deinem PC: <code className="font-mono">{a.path}</code> · {a.bytes} Bytes · {lines.length} Zeilen</p>
    </div>
  );
}

export function Artifacts({ steps }: { steps: (ToolStep | LiveItem)[] }) {
  const flat = useMemo(() => (steps as any[]).map((s) => (s.kind === "tool" ? s.step : s.kind ? { tool: "denken", args: {}, result: "" } : s)), [steps]);
  const list = useMemo(() => extractArtifacts(flat as any), [flat]);
  const [openId, setOpenId] = useState<string | null>(null);
  if (!list.length) return null;
  const cur = list.find((a) => a.id === openId) || null;
  return (
    <>
      <div className="mt-2 flex flex-wrap gap-2" data-testid="artifacts">
        {list.map((a) => (
          <button key={a.id} type="button" onClick={() => setOpenId(a.id)} className="group flex max-w-full items-center gap-2.5 rounded-lg border border-border bg-card px-3 py-2 text-left hover-elevate" data-testid={`artifact-${a.name}`}>
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary"><FileCode2 className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-sm font-medium">{a.name}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{LANG_LABEL[a.lang] || a.lang} · {a.content.split("\n").length} Zeilen · öffnen</span>
            </span>
          </button>
        ))}
      </div>
      <Dialog open={!!cur} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{cur?.name}</DialogTitle>
            <DialogDescription>{cur ? `${LANG_LABEL[cur.lang] || cur.lang} · von deinem Agenten auf dem PC erstellt` : ""}</DialogDescription>
          </DialogHeader>
          {cur && <ArtifactView key={cur.id} a={cur} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
