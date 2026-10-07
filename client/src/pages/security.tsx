import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Check, Laptop, Loader2, LogOut, ShieldCheck, Smartphone, X } from "lucide-react";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/components/auth";
import { PageHeader, ago } from "@/lib/ui";
import { format } from "date-fns";
import { de } from "date-fns/locale";

type Sess = { id: number; deviceName: string; ip: string; createdAt: number; lastSeenAt: number; expiresAt: number; current: boolean };

function Sessions() {
  const { toast } = useToast();
  const { data, isLoading } = useQuery<Sess[]>({ queryKey: ["/api/auth/sessions"], staleTime: 0 });
  const inv = () => queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
  const revoke = useMutation({ mutationFn: (id: number) => apiRequest("DELETE", `/api/auth/sessions/${id}`), onSuccess: () => { inv(); toast({ title: "Gerät abgemeldet" }); } });
  const others = useMutation({ mutationFn: () => apiRequest("POST", "/api/auth/sessions/revoke-others"), onSuccess: () => { inv(); toast({ title: "Alle anderen Geräte abgemeldet" }); } });

  return (
    <section className="rounded-lg border border-card-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
        <div>
          <h2 className="text-sm font-semibold">Angemeldete Geräte</h2>
          <p className="text-xs text-muted-foreground">Jedes Gerät bleibt 7 Tage angemeldet, danach ist das Passwort erneut nötig.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => others.mutate()} disabled={others.isPending || (data?.length ?? 0) < 2} data-testid="button-revoke-others">
          Alle anderen abmelden
        </Button>
      </div>
      {isLoading ? (
        <div className="p-4 text-sm text-muted-foreground">Lade …</div>
      ) : (
        <ul className="divide-y divide-border">
          {data?.map((s) => {
            const mobile = /iPhone|iPad|Android/.test(s.deviceName);
            const Icon = mobile ? Smartphone : Laptop;
            return (
              <li key={s.id} className="flex items-center gap-3 px-4 py-3" data-testid={`row-session-${s.id}`}>
                <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    {s.deviceName}
                    {s.current && <span className="rounded bg-primary/15 px-1.5 py-px font-mono text-[10px] text-primary">dieses Gerät</span>}
                  </div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {s.ip || "—"} · aktiv {ago(s.lastSeenAt)} · läuft ab {format(s.expiresAt, "d. MMM, HH:mm", { locale: de })}
                  </div>
                </div>
                {!s.current && (
                  <Button variant="ghost" size="sm" onClick={() => revoke.mutate(s.id)} data-testid={`button-revoke-${s.id}`}>
                    <X className="mr-1 h-3.5 w-3.5" />Abmelden
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function TwoFactor() {
  const { toast } = useToast();
  const { me, refresh } = useAuth();
  const [setup, setSetup] = useState<{ secret: string; qr: string } | null>(null);
  const [code, setCode] = useState("");
  const [pw, setPw] = useState("");

  const start = useMutation({
    mutationFn: async () => (await apiRequest("POST", "/api/auth/2fa/setup")).json(),
    onSuccess: (d: any) => setSetup(d),
  });
  const enable = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/2fa/enable", { code }),
    onSuccess: async () => { setSetup(null); setCode(""); await refresh(); toast({ title: "Zwei-Faktor-Anmeldung aktiv" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const disable = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/2fa/disable", { password: pw, code }),
    onSuccess: async () => { setPw(""); setCode(""); await refresh(); toast({ title: "Zwei-Faktor-Anmeldung deaktiviert" }); },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });

  return (
    <section className="rounded-lg border border-card-border bg-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-primary" />Zwei-Faktor-Anmeldung (2FA)
            {me.totpEnabled && <span className="rounded bg-primary/15 px-1.5 py-px font-mono text-[10px] text-primary" data-testid="status-2fa">aktiv</span>}
          </h2>
          <p className="mt-1 max-w-xl text-xs text-muted-foreground">
            Zusätzlich zum Passwort ein 6-stelliger Code aus einer Authenticator-App (Google Authenticator, Aegis, 1Password, Microsoft Authenticator). Wird nur beim Anmelden eines neuen Geräts abgefragt. Dringend empfohlen, weil Nexar Zugriff auf deinen PC hat.
          </p>
        </div>
        {!me.totpEnabled && !setup && (
          <Button size="sm" onClick={() => start.mutate()} disabled={start.isPending} data-testid="button-2fa-setup">
            {start.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Einrichten
          </Button>
        )}
      </div>

      {setup && (
        <div className="mt-4 grid gap-4 border-t border-border pt-4 sm:grid-cols-[auto_1fr]">
          <img src={setup.qr} alt="QR-Code für die Authenticator-App" className="h-44 w-44 rounded-md bg-white p-1.5" data-testid="img-2fa-qr" />
          <div className="space-y-3">
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>QR-Code mit der Authenticator-App scannen</li>
              <li>Den angezeigten 6-stelligen Code eingeben</li>
            </ol>
            <div className="text-xs text-muted-foreground">
              Manuell: <code className="break-all font-mono text-foreground">{setup.secret.match(/.{1,4}/g)?.join(" ")}</code>
            </div>
            <div className="flex gap-2">
              <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="123456" className="w-32 text-center font-mono tracking-widest" data-testid="input-2fa-code" />
              <Button onClick={() => enable.mutate()} disabled={code.length !== 6 || enable.isPending} data-testid="button-2fa-enable">Aktivieren</Button>
              <Button variant="ghost" onClick={() => { setSetup(null); setCode(""); }}>Abbrechen</Button>
            </div>
          </div>
        </div>
      )}

      {me.totpEnabled && (
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-xs text-muted-foreground">2FA deaktivieren</summary>
          <div className="mt-3 flex flex-wrap gap-2">
            <Input type="password" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Passwort" className="w-48" data-testid="input-2fa-disable-password" />
            <Input inputMode="numeric" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} placeholder="Code" className="w-28 font-mono" data-testid="input-2fa-disable-code" />
            <Button variant="outline" onClick={() => disable.mutate()} disabled={!pw || code.length !== 6 || disable.isPending} data-testid="button-2fa-disable">Deaktivieren</Button>
          </div>
        </details>
      )}
    </section>
  );
}

function ChangePassword() {
  const { toast } = useToast();
  const [cur, setCur] = useState("");
  const [n1, setN1] = useState("");
  const [n2, setN2] = useState("");
  const change = useMutation({
    mutationFn: () => apiRequest("POST", "/api/auth/password", { current: cur, next: n1 }),
    onSuccess: () => {
      setCur(""); setN1(""); setN2("");
      queryClient.invalidateQueries({ queryKey: ["/api/auth/sessions"] });
      toast({ title: "Passwort geändert", description: "Alle anderen Geräte wurden abgemeldet." });
    },
    onError: (e: Error) => toast({ title: e.message, variant: "destructive" }),
  });
  const strong = n1.length >= 12;
  const match = n1 && n1 === n2;

  return (
    <section className="rounded-lg border border-card-border bg-card p-4">
      <h2 className="text-sm font-semibold">Passwort ändern</h2>
      <p className="mt-1 text-xs text-muted-foreground">Mindestens 12 Zeichen. Am besten eine Passphrase aus mehreren Wörtern oder ein Passwort-Manager.</p>
      <form className="mt-3 grid max-w-md gap-3" onSubmit={(e) => { e.preventDefault(); change.mutate(); }}>
        <input type="text" autoComplete="username" className="hidden" readOnly />
        <div className="space-y-1.5">
          <Label htmlFor="pw-cur">Aktuelles Passwort</Label>
          <Input id="pw-cur" type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} data-testid="input-pw-current" />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-new">Neues Passwort</Label>
          <Input id="pw-new" type="password" autoComplete="new-password" value={n1} onChange={(e) => setN1(e.target.value)} data-testid="input-pw-new" />
          {n1 && <p className={`flex items-center gap-1 text-[11px] ${strong ? "text-primary" : "text-muted-foreground"}`}>{strong ? <Check className="h-3 w-3" /> : null}{n1.length} / 12 Zeichen</p>}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="pw-new2">Neues Passwort wiederholen</Label>
          <Input id="pw-new2" type="password" autoComplete="new-password" value={n2} onChange={(e) => setN2(e.target.value)} data-testid="input-pw-repeat" />
        </div>
        <Button type="submit" className="w-fit" disabled={!cur || !strong || !match || change.isPending} data-testid="button-change-password">Passwort ändern</Button>
      </form>
    </section>
  );
}

export default function Security() {
  const { me, logout } = useAuth();
  return (
    <div>
      <PageHeader title="Sicherheit" sub={`Angemeldet als ${me.email}`}>
        <Button variant="outline" size="sm" onClick={logout} data-testid="button-logout-page"><LogOut className="mr-1.5 h-4 w-4" />Abmelden</Button>
      </PageHeader>
      <div className="max-w-4xl space-y-6 p-6">
        {me.https === false && (
          <div className="flex gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4 text-sm" data-testid="warning-no-https">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <p>
              <span className="font-medium">Verbindung ohne HTTPS.</span>{" "}
              <span className="text-muted-foreground">Passwort und Sitzung könnten unterwegs mitgelesen werden. Nutze HTTPS (Caddy aus der docker-compose.yml mit eigener Domain oder Tailscale Serve), bevor du dich aus fremden Netzen anmeldest.</span>
            </p>
          </div>
        )}
        <Sessions />
        <TwoFactor />
        <ChangePassword />
      </div>
    </div>
  );
}
