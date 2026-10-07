import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, ChevronsUpDown, Loader2, RefreshCw } from "lucide-react";
import type { ModelCatalog, ModelInfo, Provider } from "@shared/schema";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ago } from "@/lib/ui";

export function fmtContext(n?: number) {
  if (!n) return "";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n % 1_000_000 ? 1 : 0)}M`;
  return `${Math.round(n / 1024)}k`;
}

export function useModelCatalog(provider: Provider, enabled = true) {
  return useQuery<ModelCatalog>({
    queryKey: ["/api/models", provider],
    enabled,
    staleTime: 0,
    refetchInterval: 2 * 60_000, // alle 2 Minuten nachladen (Server cacht 10 Min., aktualisiert selbst alle 30 Min.)
    refetchOnWindowFocus: true,
  });
}

function ModelRow({ m, selected }: { m: ModelInfo; selected: boolean }) {
  return (
    <div className="flex w-full items-center gap-2.5">
      <Check className={`h-4 w-4 shrink-0 ${selected ? "text-primary opacity-100" : "opacity-0"}`} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{m.name}</span>
          {m.isNew && <span className="rounded bg-primary/15 px-1 py-px font-mono text-[10px] uppercase text-primary">neu</span>}
        </div>
        <div className="truncate font-mono text-[11px] text-muted-foreground">{m.id}</div>
      </div>
      <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
        {m.context ? <div>{fmtContext(m.context)} ctx</div> : null}
        {m.owner && <div className="max-w-[7rem] truncate">{m.owner}</div>}
      </div>
    </div>
  );
}

export function ModelPicker({ provider, value, onChange }: { provider: Provider; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const { data, isLoading, isFetching } = useModelCatalog(provider);

  const refresh = useMutation({
    mutationFn: async () => (await apiRequest("POST", `/api/models/${provider}/refresh`)).json(),
    onSuccess: (cat: ModelCatalog) => queryClient.setQueryData(["/api/models", provider], cat),
  });

  const models = data?.models || [];
  const selected = models.find((m) => m.id === value);
  const stable = useMemo(() => models.filter((m) => m.stage === "stable"), [models]);
  const preview = useMemo(() => models.filter((m) => m.stage === "preview"), [models]);
  const newCount = models.filter((m) => m.isNew).length;

  // Beim Anbieterwechsel automatisch das erste stabile Modell wählen
  useEffect(() => {
    if (!value && stable[0]) onChange(stable[0].id);
  }, [value, stable[0]?.id]);

  const unavailable = !!value && !!data?.live && !selected;
  const custom = search.trim();
  const showCustom = custom && !models.some((m) => m.id === custom);

  const pick = (id: string) => {
    onChange(id);
    setOpen(false);
    setSearch("");
  };

  return (
    <div className="space-y-1.5">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            role="combobox"
            aria-expanded={open}
            className={`flex w-full items-center gap-2 rounded-md border bg-background px-3 py-2 text-left hover-elevate ${unavailable ? "border-amber-500/60" : "border-input"}`}
            data-testid="button-model-picker"
          >
            <div className="min-w-0 flex-1">
              {isLoading && !value ? (
                <span className="text-sm text-muted-foreground">Lade Modelle …</span>
              ) : (
                <>
                  <div className="truncate text-sm font-medium">{selected?.name || value || "Modell wählen"}</div>
                  {value && <div className="truncate font-mono text-[11px] text-muted-foreground">{value}{selected?.context ? ` · ${fmtContext(selected.context)} Kontext` : ""}</div>}
                </>
              )}
            </div>
            <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] min-w-[22rem] p-0" align="start">
          <Command>
            <CommandInput placeholder="Modell suchen …" value={search} onValueChange={setSearch} data-testid="input-model-search" />
            <CommandList className="max-h-80">
              <CommandEmpty>Kein Modell gefunden.</CommandEmpty>
              {showCustom && (
                <CommandGroup heading="Eigene ID">
                  <CommandItem value={`custom ${custom}`} onSelect={() => pick(custom)} data-testid="item-model-custom">
                    <span className="text-sm">Verwenden: <code className="font-mono">{custom}</code></span>
                  </CommandItem>
                </CommandGroup>
              )}
              {!!stable.length && (
                <CommandGroup heading={`Stabil (${stable.length})`}>
                  {stable.map((m) => (
                    <CommandItem key={m.id} value={`${m.name} ${m.id} ${m.owner || ""}`} onSelect={() => pick(m.id)} data-testid={`item-model-${m.id}`}>
                      <ModelRow m={m} selected={m.id === value} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {!!preview.length && (
                <CommandGroup heading={`Vorschau (${preview.length})`}>
                  {preview.map((m) => (
                    <CommandItem key={m.id} value={`${m.name} ${m.id} ${m.owner || ""}`} onSelect={() => pick(m.id)} data-testid={`item-model-${m.id}`}>
                      <ModelRow m={m} selected={m.id === value} />
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
            </CommandList>
            <div className="flex items-center justify-between border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
              <span>{data?.live ? `Live · ${models.length} Modelle` : "Standardliste · Key hinterlegen für Live-Liste"}</span>
              <button type="button" onClick={() => refresh.mutate()} className="inline-flex items-center gap-1 hover:text-foreground" data-testid="button-refresh-models">
                <RefreshCw className={`h-3 w-3 ${refresh.isPending || isFetching ? "animate-spin" : ""}`} />Aktualisieren
              </button>
            </div>
          </Command>
        </PopoverContent>
      </Popover>

      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5" data-testid="text-model-status">
          <span className={`h-1.5 w-1.5 rounded-full ${data?.live ? "bg-primary" : "bg-muted-foreground/50"}`} />
          {data?.live ? "Live von deinem Key" : "Standardliste"}
          {data && ` · aktualisiert ${ago(data.fetchedAt)}`}
          {newCount > 0 && <span className="text-primary">· {newCount} neu</span>}
        </span>
        {(refresh.isPending || isFetching) && <Loader2 className="h-3 w-3 animate-spin" />}
      </div>
      {data?.error && (
        <p className="text-[11px] text-amber-600 dark:text-amber-400">Live-Abruf fehlgeschlagen: {data.error}</p>
      )}
      {unavailable && (
        <p className="flex items-start gap-1.5 text-[11px] text-amber-600 dark:text-amber-400" data-testid="warning-model-unavailable">
          <AlertTriangle className="mt-px h-3 w-3 shrink-0" />
          „{value}“ ist bei {provider === "groq" ? "Groq" : "Google"} nicht mehr gelistet. Bitte ein aktuelles Modell wählen.
        </p>
      )}
    </div>
  );
}
