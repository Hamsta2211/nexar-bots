import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Bot as BotIcon, MessagesSquare, Mic, Timer, KeyRound, Server, Moon, Sun, Monitor, ShieldCheck, LogOut, Download } from "lucide-react";
import {
  Sidebar, SidebarContent, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarMenu,
  SidebarMenuButton, SidebarMenuItem, SidebarHeader, SidebarFooter,
} from "@/components/ui/sidebar";
import type { Bot, KeyStatus } from "@shared/schema";
import { BotAvatar } from "@/lib/ui";
import { useTheme } from "@/components/theme";
import { useAuth } from "@/components/auth";
import { NexarLogo } from "@/components/logo";
import { useInstall } from "@/lib/pwa";
import { useToast } from "@/hooks/use-toast";

export { NexarLogo };

const NAV = [
  { href: "/", label: "Übersicht", icon: LayoutDashboard },
  { href: "/bots", label: "Bots", icon: BotIcon },
  { href: "/chat", label: "Chat", icon: MessagesSquare },
  { href: "/voice", label: "Voice-Chat", icon: Mic },
  { href: "/tasks", label: "Automationen", icon: Timer },
  { href: "/pc", label: "Mein PC", icon: Monitor },
  { href: "/settings", label: "API-Keys", icon: KeyRound },
  { href: "/security", label: "Sicherheit", icon: ShieldCheck },
  { href: "/hosting", label: "24/7 Hosting", icon: Server },
];

export function AppSidebar() {
  const [loc] = useLocation();
  const { data: bots } = useQuery<Bot[]>({ queryKey: ["/api/bots"] });
  const { data: keys } = useQuery<KeyStatus>({ queryKey: ["/api/keys"] });
  const { theme, toggle } = useTheme();
  const { me, logout } = useAuth();
  const { installed, canPrompt, ios, install } = useInstall();
  const { toast } = useToast();
  const isActive = (href: string) => (href === "/" ? loc === "/" : loc.startsWith(href));

  return (
    <Sidebar>
      <SidebarHeader className="px-4 py-4">
        <Link href="/" className="flex items-center gap-2.5 text-foreground" data-testid="link-home">
          <NexarLogo />
          <div className="leading-tight">
            <div className="text-[15px] font-semibold tracking-tight">nexar<span className="text-primary">.</span>bots</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">agent runtime</div>
          </div>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {NAV.map((n) => (
                <SidebarMenuItem key={n.href}>
                  <SidebarMenuButton asChild isActive={isActive(n.href)}>
                    <Link href={n.href} data-testid={`link-nav-${n.href.slice(1) || "home"}`}>
                      <n.icon className="h-4 w-4" />
                      <span>{n.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {!!bots?.length && (
          <SidebarGroup>
            <SidebarGroupLabel>Deine Bots</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {bots.map((b) => (
                  <SidebarMenuItem key={b.id}>
                    <SidebarMenuButton asChild isActive={loc === `/chat/${b.id}`}>
                      <Link href={`/chat/${b.id}`} data-testid={`link-bot-${b.id}`}>
                        <BotAvatar bot={b} size="sm" />
                        <span className="truncate">{b.name}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter className="gap-2 p-3">
        <div className="rounded-md border border-sidebar-border px-3 py-2 text-xs">
          <KeyDot label="Groq" on={!!keys?.groq.set} />
          <KeyDot label="Google Gemini" on={!!keys?.google.set} />
        </div>
        {!installed && (canPrompt || ios) && (
          <button
            onClick={() => (canPrompt ? install() : toast({ title: "Als App installieren", description: "Tippe in Safari auf Teilen und dann auf „Zum Home-Bildschirm“." }))}
            className="flex items-center gap-2 rounded-md border border-sidebar-border px-3 py-2 text-xs hover-elevate"
            data-testid="button-install-app"
          >
            <Download className="h-3.5 w-3.5" />
            App installieren
          </button>
        )}
        <div className="flex items-center justify-between gap-2 px-1">
          <span className="truncate text-xs text-muted-foreground" data-testid="text-user-email">{me.email}</span>
          <button onClick={logout} className="rounded p-1.5 text-muted-foreground hover-elevate" aria-label="Abmelden" title="Abmelden" data-testid="button-logout">
            <LogOut className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={toggle}
          className="flex items-center gap-2 rounded-md px-3 py-2 text-xs text-muted-foreground hover-elevate"
          data-testid="button-theme"
        >
          {theme === "dark" ? <Sun className="h-3.5 w-3.5" /> : <Moon className="h-3.5 w-3.5" />}
          {theme === "dark" ? "Helles Design" : "Dunkles Design"}
        </button>
      </SidebarFooter>
    </Sidebar>
  );
}

function KeyDot({ label, on }: { label: string; on: boolean }) {
  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-muted-foreground">{label}</span>
      <span className={`flex items-center gap-1.5 font-mono text-[11px] ${on ? "text-primary" : "text-muted-foreground"}`}>
        <span className={`h-1.5 w-1.5 rounded-full ${on ? "bg-primary" : "bg-muted-foreground/40"}`} />
        {on ? "aktiv" : "fehlt"}
      </span>
    </div>
  );
}
