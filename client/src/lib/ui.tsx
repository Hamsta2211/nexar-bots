import { SiGooglegemini } from "react-icons/si";
import { formatDistanceToNow } from "date-fns";
import { de } from "date-fns/locale";
import type { Bot } from "@shared/schema";

export const BOT_COLORS: Record<string, { bg: string; fg: string; ring: string }> = {
  lime: { bg: "bg-lime-400/15", fg: "text-lime-600 dark:text-lime-300", ring: "ring-lime-500/30" },
  sky: { bg: "bg-sky-400/15", fg: "text-sky-600 dark:text-sky-300", ring: "ring-sky-500/30" },
  violet: { bg: "bg-violet-400/15", fg: "text-violet-600 dark:text-violet-300", ring: "ring-violet-500/30" },
  amber: { bg: "bg-amber-400/15", fg: "text-amber-600 dark:text-amber-300", ring: "ring-amber-500/30" },
  rose: { bg: "bg-rose-400/15", fg: "text-rose-600 dark:text-rose-300", ring: "ring-rose-500/30" },
  slate: { bg: "bg-slate-400/15", fg: "text-slate-600 dark:text-slate-300", ring: "ring-slate-500/30" },
};

export function BotAvatar({ bot, size = "md" }: { bot: Pick<Bot, "name" | "color">; size?: "sm" | "md" | "lg" }) {
  const c = BOT_COLORS[bot.color] || BOT_COLORS.lime;
  const dims = size === "sm" ? "h-7 w-7 text-xs" : size === "lg" ? "h-11 w-11 text-base" : "h-9 w-9 text-sm";
  return (
    <div className={`${dims} ${c.bg} ${c.fg} ring-1 ${c.ring} grid shrink-0 place-items-center rounded-md font-mono font-semibold`}>
      {bot.name.slice(0, 2).toUpperCase()}
    </div>
  );
}

export function GroqMark({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-label="Groq" fill="none" stroke="currentColor" strokeWidth="2.4">
      <circle cx="12" cy="11" r="6" />
      <path d="M18 11v4a6 6 0 0 1-10.5 4" strokeLinecap="round" />
    </svg>
  );
}

export function ProviderBadge({ provider, model }: { provider: string; model?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {provider === "groq" ? <GroqMark className="h-3 w-3" /> : <SiGooglegemini className="h-3 w-3" />}
      {model || (provider === "groq" ? "Groq" : "Gemini")}
    </span>
  );
}

export function ago(ts?: number | null) {
  if (!ts) return "—";
  return formatDistanceToNow(ts, { addSuffix: true, locale: de });
}

export function untilText(ts?: number | null) {
  if (!ts) return "—";
  if (ts < Date.now()) return "gleich";
  return formatDistanceToNow(ts, { addSuffix: true, locale: de });
}

export function intervalLabel(min: number) {
  if (min % 1440 === 0) return min === 1440 ? "täglich" : `alle ${min / 1440} Tage`;
  if (min % 60 === 0) return min === 60 ? "stündlich" : `alle ${min / 60} Std.`;
  return `alle ${min} Min.`;
}

export function PageHeader({ title, sub, children }: { title: string; sub?: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border px-6 py-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight" data-testid="text-page-title">{title}</h1>
        {sub && <p className="mt-1 text-sm text-muted-foreground">{sub}</p>}
      </div>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}
