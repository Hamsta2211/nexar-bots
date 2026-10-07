import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import {
  AlertTriangle, Check, Copy, Cpu, HardDrive, KeyRound, Loader2, MemoryStick, Plug, RefreshCw, ShieldCheck,
  Terminal as TerminalIcon, Trash2, Wifi,
} from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { PageHeader } from "@/lib/ui";

type SshPublic = {
  host: string; port: number; username: string; authType: "key" | "password"; safeMode: boolean;
  hasKey: boolean; hasPassword: boolean; hasPassphrase: boolean; configured: boolean;
  hostKey: string; publicKey: string;
};
type Info = Record<string, string>;
type Line = { id: number; cmd: string; stdout: string; stderr: string; code: number | null; ms: number };

const QUICK = [
  { l: "Systemstatus", c: "uptime && free -h && df -h /" },
  { l: "Updates", c: "apt list --upgradable 2>/dev/null | tail -n +2" },
  { l: "Top-Prozesse", c: "ps aux --sort=-%cpu | head -8" },
  { l: "Dienste (fehlerhaft)", c: "systemctl --failed --no-pager" },
  { l: "Home-Ordner", c: "ls -la ~" },
  { l: "Docker", c: "docker ps --format 'table {{.Names}}\\t{{.Status}}' 2>&1" },
];

const SETUP_CMD = "sudo apt update && sudo apt install -y openssh-server && sudo systemctl enable --now ssh";
const TAILSCALE_CMD = "curl -fsSL https://tailscale.com/install.sh | sh && sudo tailscale up";

function fmtBytes(pair?: string) {
  if (!pair) return { used: "—", total: "—", pct: 0 };
  const [u, t] = pair.split("/").map(Number);
  const g = (n: number) => (n / 1024 ** 3).toFixed(n > 100 * 1024 ** 3 ? 0 : 1) + " GB";
  return { used: g(u), total: g(t), pct: t ? Math.round((u / t) * 100) : 0 };
}

function CopyLine({ text, testid }: { text: string; testid: string }) {
  const [ok, setOk] = useState(false);
  return (
    <div className="flex items-start gap-2 rounded-md border border-border bg-muted/50 p-2.5">
      <code className="min-w-0 flex-1 break-all font-mono text-xs">{text}</code>
      <button onClick={() => { navigator.clipboard?.writeText(text); setOk(true); setTimeout(() => setOk(false), 1500); }} aria-label="Kopieren" data-testid={testid}>
        {ok ? <Check className="h-3.5 w-3.5 text-primary" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
      </button>
    </div>
  );
}

function Meter({ icon: Icon, label, value, sub, pct }: { icon: any; label: string; value: string; sub?: string; pct?: number }) {
  return (
    <div className="bg-card px-4 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground"><Icon className="h-3.5 w-3.5" />{label}</div>
      <div className="mt-1 truncate font-mono text-sm font-semibold">{value}</div>
      {sub && <div className="truncate font-mono text-[11px] text-muted-foreground">{sub}</div>}
      {pct !== undefined && (
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-muted">
          <div className={`h-full ${pct > 85 ? "bg-destructive" : "bg-primary"}`} style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  );
}

export default function MyPc() {
  const { toast } = useToast();
  const { data: cfg } = useQuery<SshPublic>({ queryKey: ["/api/ssh"] });
  const { data: info, isFetching: infoLoading, refetch: refetchInfo } = useQuery<{ ok: boolean; info?: Info; message?: string }>({
    queryKey: ["/api/ssh/info"], enabled: !!cfg?.configured, staleTime: 0, refetchInterval: 60_000,
  });

  const [host, setHost] = useState("");
  const [port, setPort] = useState("22");
  const [user, setUser] = useState("");
  const [authType, setAuthType] = useState<"key" | "password">("key");
  const [privateKey, setPrivateKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [password, setPassword] = useState("");

  useEffect(() => {
    if (!cfg) return;
    setHost(cfg.host); setPort(String(cfg.port || 22)); setUser(cfg.username); setAuthType(cfg.authType);
  }, [cfg?.host, cfg?.port, cfg?.username, cfg?.authType]);

  const refreshAll = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/ssh"] });
    queryClient.invalidateQueries({ queryKey: ["/api/ssh/info"] });
  };

  const save = useMutation({
    mutationFn: async () => (await apiRequest("PUT", "/api/ssh", { host, port: Number(port), username: user, authType, privateKey, passphrase, password })).json(),
    onSuccess: () => { setPrivateKey(""); setPassphrase(""); setPassword(""); refreshAll(); toast({ title: "Verbindung gespeichert" }); },
  });
  const gen = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/ssh/generate-key")).json(),
    onSuccess: () => { setAuthType("key"); refreshAll(); toast({ title: "Neuer SSH-Key erzeugt", description: "Öffentlichen Schlüssel auf deinem PC eintragen." }); },
  });
  const test = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/ssh/test")).json(),
    onSuccess: (d: any) => {
      refreshAll();
      toast(d.ok ? { title: `Verbunden mit ${d.info?.HOST ?? "PC"}`, description: d.info?.OS } : { title: "Verbindung fehlgeschlagen", description: d.message, variant: "destructive" });
    },
  });
  const safe = useMutation({
    mutationFn: (safeMode: boolean) => apiRequest("PUT", "/api/ssh", { safeMode }),
    onSuccess: refreshAll,
  });
  const resetHost = useMutation({ mutationFn: () => apiRequest("DELETE", "/api/ssh/hostkey"), onSuccess: refreshAll });
  const forget = useMutation({ mutationFn: () => apiRequest("DELETE", "/api/ssh"), onSuccess: () => { refreshAll(); toast({ title: "Zugangsdaten gelöscht" }); } });

  // Terminal
  const [cmd, setCmd] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [hist, setHist] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [lines]);

  const exec = useMutation({
    mutationFn: async (c: string) => (await apiRequest("POST", "/api/ssh/exec", { command: c })).json(),
    onSuccess: (r: any, c) => setLines((l) => [...l, { id: Date.now(), cmd: c, stdout: r.stdout, stderr: r.stderr, code: r.code, ms: r.durationMs }]),
  });
  const run = (c: string) => {
    const t = c.trim();
    if (!t || exec.isPending) return;
    if (t === "clear") { setLines([]); setCmd(""); return; }
    setHist((h) => [t, ...h.filter((x) => x !== t)].slice(0, 50));
    setHIdx(-1); setCmd("");
    exec.mutate(t);
  };

  const i = info?.ok ? info.info : undefined;
  const mem = fmtBytes(i?.MEM), disk = fmtBytes(i?.DISK);
  const online = !!info?.ok;
  const authOk = authType === "key" ? !!(privateKey || cfg?.hasKey) : !!(password || cfg?.hasPassword);

  return (
    <div>
      <PageHeader title="Mein PC" sub="Verbinde deinen Ubuntu-PC per SSH. Bots mit dem Werkzeug „Mein Linux-PC“ können dann Befehle darauf ausführen.">
        {cfg?.configured && (
          <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-xs ${online ? "border-primary/40 text-primary" : "border-border text-muted-foreground"}`} data-testid="status-pc">
            <span className={`h-1.5 w-1.5 rounded-full ${online ? "bg-primary" : infoLoading ? "bg-amber-400" : "bg-destructive"}`} />
            {online ? `online · ${i?.HOST}` : infoLoading ? "prüfe …" : "nicht erreichbar"}
          </span>
        )}
      </PageHeader>

      <div className="space-y-6 p-6">
        <div className="grid gap-6 xl:grid-cols-[24rem_1fr]">
          {/* Verbindung */}
          <div className="space-y-6">
            <section className="rounded-lg border border-card-border bg-card">
              <h2 className="flex items-center gap-2 border-b border-border px-4 py-3 text-sm font-semibold"><Plug className="h-4 w-4" />Verbindung</h2>
              <div className="space-y-3 p-4">
                <div className="grid grid-cols-[1fr_5rem] gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-host">Host / IP</Label>
                    <Input id="ssh-host" value={host} onChange={(e) => setHost(e.target.value)} placeholder="100.64.0.12 oder mein-pc" className="font-mono text-sm" data-testid="input-ssh-host" />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-port">Port</Label>
                    <Input id="ssh-port" value={port} onChange={(e) => setPort(e.target.value.replace(/\D/g, ""))} className="font-mono text-sm" data-testid="input-ssh-port" />
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ssh-user">Benutzer</Label>
                  <Input id="ssh-user" value={user} onChange={(e) => setUser(e.target.value)} placeholder="david" className="font-mono text-sm" data-testid="input-ssh-user" />
                </div>

                <div className="space-y-1.5">
                  <Label>Anmeldung</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(["key", "password"] as const).map((t) => (
                      <button key={t} onClick={() => setAuthType(t)} data-testid={`button-auth-${t}`}
                        className={`rounded-md border px-3 py-1.5 text-sm hover-elevate ${authType === t ? "border-primary bg-primary/10" : "border-border"}`}>
                        {t === "key" ? "SSH-Key (empfohlen)" : "Passwort"}
                      </button>
                    ))}
                  </div>
                </div>

                {authType === "key" ? (
                  <div className="space-y-3">
                    {cfg?.publicKey ? (
                      <div className="space-y-1.5">
                        <Label>Öffentlicher Schlüssel von Nexar</Label>
                        <p className="text-xs text-muted-foreground">Auf dem PC in <code className="font-mono">~/.ssh/authorized_keys</code> eintragen:</p>
                        <CopyLine text={`echo '${cfg.publicKey.trim()}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`} testid="button-copy-pubkey" />
                      </div>
                    ) : (
                      <Button variant="secondary" size="sm" className="w-full" onClick={() => gen.mutate()} disabled={gen.isPending} data-testid="button-generate-key">
                        {gen.isPending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <KeyRound className="mr-1.5 h-4 w-4" />}Schlüsselpaar erzeugen
                      </Button>
                    )}
                    <details className="text-sm">
                      <summary className="cursor-pointer text-xs text-muted-foreground">{cfg?.publicKey ? "Neuen Schlüssel erzeugen oder eigenen einfügen" : "Oder eigenen privaten Schlüssel einfügen"}</summary>
                      <div className="mt-2 space-y-2">
                        {cfg?.publicKey && (
                          <Button variant="outline" size="sm" onClick={() => gen.mutate()} disabled={gen.isPending} data-testid="button-regenerate-key">Neues Schlüsselpaar</Button>
                        )}
                        <Textarea rows={4} value={privateKey} onChange={(e) => setPrivateKey(e.target.value)} placeholder={cfg?.hasKey ? "Gespeichert. Neu einfügen zum Ersetzen." : "-----BEGIN OPENSSH PRIVATE KEY-----"} className="font-mono text-[11px]" data-testid="input-ssh-key" />
                        <Input type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} placeholder="Passphrase (falls vorhanden)" data-testid="input-ssh-passphrase" />
                      </div>
                    </details>
                  </div>
                ) : (
                  <div className="space-y-1.5">
                    <Label htmlFor="ssh-pw">Passwort</Label>
                    <Input id="ssh-pw" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={cfg?.hasPassword ? "Gespeichert. Neu eingeben zum Ersetzen." : ""} data-testid="input-ssh-password" />
                  </div>
                )}

                <div className="flex gap-2 pt-1">
                  <Button className="flex-1" onClick={() => save.mutate()} disabled={!host || !user || save.isPending} data-testid="button-save-ssh">Speichern</Button>
                  <Button variant="outline" onClick={() => test.mutate()} disabled={!cfg?.configured || !authOk || test.isPending} data-testid="button-test-ssh">
                    {test.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Testen
                  </Button>
                </div>
              </div>
            </section>

            <section className="space-y-3 rounded-lg border border-card-border bg-card p-4">
              <label className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex items-center gap-1.5 text-sm font-medium"><ShieldCheck className="h-4 w-4 text-primary" />Sicherheitsmodus</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">Blockiert zerstörerische Befehle wie <code className="font-mono">rm -rf /</code>, <code className="font-mono">mkfs</code>, <code className="font-mono">dd of=/dev/…</code>, Neustart und <code className="font-mono">curl | sh</code>.</p>
                </div>
                <Switch checked={cfg?.safeMode ?? true} onCheckedChange={(v) => safe.mutate(v)} data-testid="switch-safe-mode" />
              </label>
              {cfg?.hostKey && (
                <div className="border-t border-border pt-3">
                  <div className="text-xs text-muted-foreground">Gemerkter Host-Fingerabdruck</div>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-[11px]" data-testid="text-hostkey">{cfg.hostKey}</code>
                    <button onClick={() => resetHost.mutate()} className="text-xs text-muted-foreground hover:text-foreground" data-testid="button-reset-hostkey">zurücksetzen</button>
                  </div>
                </div>
              )}
              {cfg?.configured && (
                <Button variant="ghost" size="sm" className="w-full text-muted-foreground" onClick={() => forget.mutate()} data-testid="button-forget-ssh">
                  <Trash2 className="mr-1.5 h-3.5 w-3.5" />Zugangsdaten löschen
                </Button>
              )}
            </section>
          </div>

          {/* Status + Terminal */}
          <div className="min-w-0 space-y-6">
            {cfg?.configured ? (
              <>
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">{i ? `${i.HOST} · ${i.OS}` : "Systemstatus"}</h2>
                  <Button variant="ghost" size="sm" onClick={() => refetchInfo()} disabled={infoLoading} data-testid="button-refresh-info">
                    <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${infoLoading ? "animate-spin" : ""}`} />Aktualisieren
                  </Button>
                </div>
                {info && !info.ok ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive" data-testid="text-ssh-error">
                    {info.message}
                    {/timed out|handshake|ENOTFOUND|EHOSTUNREACH|ECONNREFUSED|ETIMEDOUT|getaddrinfo/i.test(info.message || "") ? (
                      <div className="mt-2 space-y-1.5 text-xs text-muted-foreground">
                        <p><span className="font-medium text-foreground">Der Nexar-Server erreicht deinen PC nicht.</span> Die Verbindung geht immer vom Server aus, auf dem Nexar läuft, nicht von deinem Handy oder Browser.</p>
                        <p>Läuft Nexar in der Cloud (z.B. in der Vorschau oder auf einer VM ohne Tailscale), kann es Namen wie <code className="font-mono">{cfg?.host}</code> oder private Adressen (192.168.x.x, 100.x.x.x) nicht erreichen.</p>
                        <p>Lösung: Nexar direkt auf deinem PC starten (Host <code className="font-mono">127.0.0.1</code>) oder auf einem Server im selben Tailscale-Netz. Prüfe außerdem, ob der PC an ist und <code className="font-mono">sshd</code> läuft (<code className="font-mono">systemctl status ssh</code>).</p>
                      </div>
                    ) : (
                      <p className="mt-2 text-xs text-muted-foreground">Prüfe: Benutzername und Passwort bzw. Schlüssel richtig? Ist der öffentliche Schlüssel in <code className="font-mono">~/.ssh/authorized_keys</code>? Läuft <code className="font-mono">sshd</code> (<code className="font-mono">systemctl status ssh</code>)?</p>
                    )}
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-4">
                    <Meter icon={Cpu} label="CPU-Last" value={i?.LOAD ?? "—"} sub={i ? `${i.CPUS} Kerne` : undefined} />
                    <Meter icon={MemoryStick} label="RAM" value={`${mem.used} / ${mem.total}`} pct={i ? mem.pct : undefined} />
                    <Meter icon={HardDrive} label="Disk /" value={`${disk.used} / ${disk.total}`} pct={i ? disk.pct : undefined} />
                    <Meter icon={Wifi} label="Online seit" value={i?.UPTIME?.replace(/^up /, "") ?? "—"} sub={i?.KERNEL} />
                  </div>
                )}

                <section className="overflow-hidden rounded-lg border border-card-border bg-[hsl(222_20%_4%)] text-[hsl(60_9%_90%)]">
                  <div className="flex items-center justify-between border-b border-white/10 px-4 py-2.5">
                    <span className="flex items-center gap-2 font-mono text-xs"><TerminalIcon className="h-3.5 w-3.5 text-primary" />{cfg.username}@{i?.HOST ?? cfg.host}</span>
                    <button onClick={() => setLines([])} className="font-mono text-[11px] text-white/50 hover:text-white" data-testid="button-clear-terminal">clear</button>
                  </div>
                  <div className="flex flex-wrap gap-1.5 border-b border-white/10 px-4 py-2">
                    {QUICK.map((q) => (
                      <button key={q.l} onClick={() => run(q.c)} disabled={exec.isPending} className="rounded border border-white/15 px-2 py-0.5 font-mono text-[11px] text-white/70 hover:border-primary/60 hover:text-white" data-testid={`button-quick-${q.l}`}>
                        {q.l}
                      </button>
                    ))}
                  </div>
                  <div className="h-[24rem] overflow-y-auto px-4 py-3 font-mono text-xs leading-relaxed" data-testid="terminal-output">
                    {!lines.length && !exec.isPending && <div className="text-white/40">Befehl eingeben und Enter drücken. Jeder Befehl läuft in einer eigenen SSH-Sitzung (nicht interaktiv).</div>}
                    {lines.map((l) => (
                      <div key={l.id} className="mb-3">
                        <div><span className="text-primary">$</span> {l.cmd}</div>
                        {l.stdout && <pre className="whitespace-pre-wrap break-all text-white/85">{l.stdout}</pre>}
                        {l.stderr && <pre className="whitespace-pre-wrap break-all text-rose-300">{l.stderr}</pre>}
                        <div className="text-[10px] text-white/35">exit {l.code ?? "–"} · {(l.ms / 1000).toFixed(2)}s</div>
                      </div>
                    ))}
                    {exec.isPending && <div className="flex items-center gap-2 text-white/60"><Loader2 className="h-3 w-3 animate-spin" />{exec.variables}</div>}
                    <div ref={endRef} />
                  </div>
                  <div className="flex items-center gap-2 border-t border-white/10 px-4 py-2.5">
                    <span className="font-mono text-xs text-primary">$</span>
                    <input
                      value={cmd}
                      onChange={(e) => setCmd(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") run(cmd);
                        if (e.key === "ArrowUp" && hist.length) { e.preventDefault(); const n = Math.min(hIdx + 1, hist.length - 1); setHIdx(n); setCmd(hist[n]); }
                        if (e.key === "ArrowDown") { e.preventDefault(); const n = hIdx - 1; setHIdx(n); setCmd(n >= 0 ? hist[n] : ""); }
                      }}
                      placeholder="z.B. sudo -n apt update"
                      className="flex-1 bg-transparent font-mono text-xs text-white outline-none placeholder:text-white/30"
                      spellCheck={false}
                      autoCapitalize="off"
                      data-testid="input-terminal"
                    />
                  </div>
                </section>
                <p className="text-xs text-muted-foreground">
                  Tipp: Lege in <Link href="/bots" className="text-primary hover:underline">Bots</Link> den Admin-Bot „Tux“ an oder aktiviere bei einem Bot das Werkzeug „Mein Linux-PC“. Mit einer <Link href="/tasks" className="text-primary hover:underline">Automation</Link> kann Tux z.B. jeden Morgen Updates und Speicherplatz prüfen und dir das Ergebnis per Discord schicken.
                </p>
              </>
            ) : (
              <section className="rounded-lg border border-card-border bg-card p-5">
                <h2 className="font-semibold">So verbindest du deinen Ubuntu-PC</h2>
                <ol className="mt-4 space-y-5 text-sm">
                  <li>
                    <div className="font-medium">1. SSH-Server auf dem PC installieren</div>
                    <div className="mt-2"><CopyLine text={SETUP_CMD} testid="button-copy-setup" /></div>
                  </li>
                  <li>
                    <div className="font-medium">2. PC erreichbar machen mit Tailscale (gratis, empfohlen)</div>
                    <p className="mt-1 text-muted-foreground">
                      Dein PC hängt hinter dem Router. Tailscale baut ein privates Netz zwischen PC und Nexar-Server, ohne Portfreigabe. Auf beiden Geräten installieren und mit demselben Konto anmelden, dann die 100.x.x.x-Adresse des PCs als Host eintragen.
                    </p>
                    <div className="mt-2"><CopyLine text={TAILSCALE_CMD} testid="button-copy-tailscale" /></div>
                    <p className="mt-1 text-xs text-muted-foreground">Läuft Nexar direkt auf deinem PC, reicht als Host <code className="font-mono">127.0.0.1</code>.</p>
                  </li>
                  <li>
                    <div className="font-medium">3. Schlüssel erzeugen und eintragen</div>
                    <p className="mt-1 text-muted-foreground">Host und Benutzer links eintragen, „Schlüsselpaar erzeugen“ klicken, den angezeigten Befehl auf dem PC ausführen, speichern und testen.</p>
                  </li>
                  <li>
                    <div className="font-medium">4. Optional: sudo ohne Passwort für bestimmte Befehle</div>
                    <p className="mt-1 text-muted-foreground">Bots arbeiten nicht interaktiv. Wenn sie z.B. Updates einspielen sollen, erlaube gezielt einzelne Befehle mit <code className="font-mono">sudo visudo -f /etc/sudoers.d/nexar</code>:</p>
                    <div className="mt-2"><CopyLine text={`${user || "david"} ALL=(root) NOPASSWD: /usr/bin/apt update, /usr/bin/apt upgrade -y, /usr/bin/systemctl restart *`} testid="button-copy-sudoers" /></div>
                  </li>
                </ol>
              </section>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
