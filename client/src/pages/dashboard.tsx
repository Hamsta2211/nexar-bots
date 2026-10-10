import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { ArrowRight, CheckCircle2, Circle, AlertTriangle } from "lucide-react";
import type { Stats, KeyStatus, Bot } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useJobs, JobCard } from "@/pages/jobs";
import { PageHeader, ago, BotAvatar, ProviderBadge } from "@/lib/ui";

function fmtUptime(s: number) {
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<Stats>({ queryKey: ["/api/stats"], refetchInterval: 15_000, staleTime: 0 });
  const { data: keys } = useQuery<KeyStatus>({ queryKey: ["/api/keys"] });
  const { data: bots } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: jobs } = useJobs(5000);
  const openJobs = (jobs || []).filter((j) => j.status === "open").slice(0, 6);

  const steps = [
    { done: !!(keys?.groq.set || keys?.google.set), label: "API-Key für Groq oder Google hinterlegen", href: "/settings" },
    { done: (stats?.bots ?? 0) > 0, label: "Ersten Bot konfigurieren", href: "/bots" },
    { done: (stats?.conversations ?? 0) > 0, label: "Mit einem Bot chatten", href: "/chat" },
    { done: (stats?.tasksActive ?? 0) > 0, label: "Automation für 24/7-Betrieb anlegen", href: "/tasks" },
  ];
  const doneCount = steps.filter((s) => s.done).length;

  const kpis = [
    { label: "Bots", value: stats?.bots },
    { label: "Aktive Automationen", value: stats?.tasksActive },
    { label: "Läufe (24 h)", value: stats?.runs24h },
    { label: "Tokens (24 h)", value: stats?.tokens24h?.toLocaleString("de-AT") },
    { label: "Uptime", value: stats ? fmtUptime(stats.uptimeSec) : undefined },
  ];

  return (
    <div>
      <PageHeader title="Übersicht" sub="Status deiner Agenten-Runtime">
        <Link href="/bots"><Button size="sm" data-testid="button-new-bot">Neuer Bot</Button></Link>
      </PageHeader>

      <div className="space-y-6 p-6">
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-5">
          {kpis.map((k) => (
            <div key={k.label} className="bg-card px-4 py-4">
              <div className="text-xs text-muted-foreground">{k.label}</div>
              <div className="mt-1 font-mono text-xl font-semibold tabular-nums" data-testid={`text-kpi-${k.label}`}>
                {isLoading ? <Skeleton className="h-6 w-12" /> : k.value ?? 0}
              </div>
            </div>
          ))}
        </div>

        <section className="rounded-lg border border-card-border bg-card" data-testid="section-jobs">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="text-sm font-semibold">Aktuelle Aufgaben</h2>
            <Link href="/jobs" className="text-xs text-muted-foreground underline">Alle</Link>
          </div>
          {!openJobs.length ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">Keine offenen Aufgaben. <Link href="/jobs" className="underline">Aufgabe anlegen</Link></div>
          ) : (
            <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">{openJobs.map((j) => <JobCard key={j.id} job={j} bots={bots || []} />)}</div>
          )}
        </section>

        <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
          <section className="rounded-lg border border-card-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold">Letzte Aktivität</h2>
              {!!stats?.errors24h && (
                <span className="flex items-center gap-1 text-xs text-destructive"><AlertTriangle className="h-3.5 w-3.5" />{stats.errors24h} Fehler (24 h)</span>
              )}
            </div>
            {isLoading ? (
              <div className="space-y-2 p-4">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
            ) : !stats?.recentRuns.length ? (
              <div className="px-4 py-12 text-center text-sm text-muted-foreground">
                Noch keine Läufe. Starte einen Chat oder lege eine Automation an.
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {stats.recentRuns.map((r) => (
                  <li key={r.id} className="flex items-start gap-3 px-4 py-3" data-testid={`row-run-${r.id}`}>
                    <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.status === "ok" ? "bg-primary" : "bg-destructive"}`} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 text-sm">
                        <span className="font-medium">{r.botName}</span>
                        <span className="text-muted-foreground">{r.source === "task" ? `· ${r.taskName ?? "Automation"}` : "· Chat"}</span>
                      </div>
                      <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">{r.output}</p>
                    </div>
                    <div className="shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                      <div>{ago(r.startedAt)}</div>
                      <div>{(r.durationMs / 1000).toFixed(1)}s · {r.tokens} tok</div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <div className="space-y-6">
            <section className="rounded-lg border border-card-border bg-card p-4">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">Einrichtung</h2>
                <span className="font-mono text-xs text-muted-foreground">{doneCount}/4</span>
              </div>
              <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-primary transition-all" style={{ width: `${(doneCount / 4) * 100}%` }} />
              </div>
              <ul className="mt-3 space-y-1">
                {steps.map((s) => (
                  <li key={s.label}>
                    <Link href={s.href} className="flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover-elevate" data-testid={`link-step-${s.href.slice(1)}`}>
                      {s.done ? <CheckCircle2 className="h-4 w-4 text-primary" /> : <Circle className="h-4 w-4 text-muted-foreground" />}
                      <span className={s.done ? "text-muted-foreground line-through" : ""}>{s.label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>

            <section className="rounded-lg border border-card-border bg-card">
              <h2 className="border-b border-border px-4 py-3 text-sm font-semibold">Bots</h2>
              <ul className="divide-y divide-border">
                {(bots || []).map((b) => (
                  <li key={b.id}>
                    <Link href={`/chat/${b.id}`} className="flex items-center gap-3 px-4 py-3 hover-elevate" data-testid={`link-dash-bot-${b.id}`}>
                      <BotAvatar bot={b} />
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium">{b.name}</div>
                        <ProviderBadge provider={b.provider} model={b.model} />
                      </div>
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
