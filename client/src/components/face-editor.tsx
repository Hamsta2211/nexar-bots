import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Bot } from "@shared/schema";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { apiRequest } from "@/lib/queryClient";
import { AgentFace, FACE_LOOKS, faceFor, type FaceCfg } from "./agent-face";

export function useFaces() {
  const { data } = useQuery<Record<string, FaceCfg>>({ queryKey: ["/api/faces"], staleTime: 30_000 });
  return data || {};
}

const SKINS = ["#8f969f", "#4f7cac", "#6b9a6e", "#8570a8", "#c9814a", "#b5574f", "#4f9a9a", "#cfa94a", "#9c8f80", "#5f6b7a"];
const ACCENTS = ["#2c333d", "#2f4f78", "#4c7a4f", "#4f4070", "#8d5530", "#3a2a2a", "#7fbab6", "#1d222b", "#6f4326", "#8a6d2f"];

const EYES: [NonNullable<FaceCfg["eyes"]>, string][] = [["round", "Rund"], ["wide", "Groß"], ["happy", "Fröhlich"], ["sleepy", "Müde"]];
const MOUTHS: [NonNullable<FaceCfg["mouth"]>, string][] = [["open", "Standard"], ["smile", "Lächeln"], ["grin", "Grinsen"], ["neutral", "Neutral"]];
const BROWS: [NonNullable<FaceCfg["brows"]>, string][] = [["strong", "Streng"], ["soft", "Sanft"], ["raised", "Erstaunt"], ["none", "Keine"]];

function Choice<T extends string>({ value, onChange, options, label }: { value: T | undefined; onChange: (v: T) => void; options: [T, string][]; label: string }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1.5">
        {options.map(([v, t]) => (
          <button
            key={v}
            type="button"
            onClick={() => onChange(v)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${value === v ? "border-[#6e92bd] bg-[#6e92bd]/15 text-foreground" : "border-border text-muted-foreground hover:bg-muted"}`}
          >{t}</button>
        ))}
      </div>
    </div>
  );
}

function Swatches({ colors, value, onChange, label }: { colors: string[]; value?: string; onChange: (c: string) => void; label: string }) {
  return (
    <div>
      <div className="mb-1 text-xs text-muted-foreground">{label}</div>
      <div className="flex flex-wrap items-center gap-1.5">
        {colors.map((c) => (
          <button
            key={c}
            type="button"
            aria-label={c}
            onClick={() => onChange(c)}
            className={`h-6 w-6 rounded-full border ${value?.toLowerCase() === c ? "ring-2 ring-[#6e92bd] ring-offset-2 ring-offset-background" : "border-border"}`}
            style={{ background: c }}
          />
        ))}
        <input type="color" value={value || "#8f969f"} onChange={(e) => onChange(e.target.value)} className="h-6 w-8 cursor-pointer rounded border border-border bg-transparent p-0" aria-label="Eigene Farbe" />
      </div>
    </div>
  );
}

export function FaceEditor({ bot, open, onClose }: { bot: Bot | null; open: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const faces = useFaces();
  const [cfg, setCfg] = useState<FaceCfg>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => { if (open && bot) { setCfg({ ...(faces[String(bot.id)] || {}) }); setErr(""); } }, [open, bot?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!bot) return null;
  const set = (p: Partial<FaceCfg>) => setCfg((c) => ({ ...c, ...p }));
  const save = async (reset = false) => {
    setBusy(true); setErr("");
    try {
      await apiRequest("PUT", `/api/bots/${bot.id}/face`, reset ? { reset: true } : cfg);
      await qc.invalidateQueries({ queryKey: ["/api/faces"] });
      onClose();
    } catch (e: any) { setErr(e?.message || "Speichern fehlgeschlagen"); } finally { setBusy(false); }
  };
  const look = faceFor(bot.name, bot.id, cfg);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Gesicht von {bot.name}</DialogTitle>
          <DialogDescription>So sieht der Agent im Voice-Chat und in der Übersicht aus.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 sm:grid-cols-[150px_1fr]">
          <div className="mx-auto w-[130px] sm:w-full"><AgentFace look={look} laptop title={bot.name} /></div>
          <div className="space-y-3">
            <div>
              <div className="mb-1 text-xs text-muted-foreground">Stil</div>
              <div className="grid grid-cols-4 gap-1.5">
                {FACE_LOOKS.map((l) => (
                  <button
                    key={l.kind}
                    type="button"
                    onClick={() => set({ kind: l.kind, skin: undefined, accent: undefined })}
                    className={`rounded-md border p-1 ${(cfg.kind ?? faceFor(bot.name, bot.id).kind) === l.kind ? "border-[#6e92bd] bg-[#6e92bd]/10" : "border-border hover:bg-muted"}`}
                    aria-label={`Stil ${l.kind + 1}`}
                  >
                    <AgentFace look={l} laptop={false} />
                  </button>
                ))}
              </div>
            </div>
            <Swatches colors={SKINS} value={cfg.skin || look.body} onChange={(c) => set({ skin: c })} label="Körperfarbe" />
            <Swatches colors={ACCENTS} value={cfg.accent || look.accent} onChange={(c) => set({ accent: c })} label="Akzentfarbe (Kopfbedeckung/Brille)" />
            <Choice label="Augen" value={cfg.eyes || "round"} options={EYES} onChange={(v) => set({ eyes: v })} />
            <Choice label="Augenbrauen" value={cfg.brows || "strong"} options={BROWS} onChange={(v) => set({ brows: v })} />
            <Choice label="Mund (im Ruhezustand)" value={cfg.mouth || "open"} options={MOUTHS} onChange={(v) => set({ mouth: v })} />
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={!!cfg.blush} onChange={(e) => set({ blush: e.target.checked })} /> Rosige Wangen
            </label>
          </div>
        </div>
        {err && <p className="text-xs text-destructive">{err}</p>}
        <div className="flex justify-between gap-2 pt-1">
          <Button variant="ghost" disabled={busy} onClick={() => save(true)}>Zurücksetzen</Button>
          <div className="flex gap-2">
            <Button variant="outline" onClick={onClose}>Abbrechen</Button>
            <Button disabled={busy} onClick={() => save(false)}>Speichern</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
