import { createContext, useContext, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2, Lock, ShieldCheck } from "lucide-react";
import { apiRequest, queryClient, setSessionToken, setUnauthorizedHandler } from "@/lib/queryClient";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { NexarLogo } from "@/components/logo";

type Me = { authenticated: boolean; email?: string; totpEnabled?: boolean; sessionExpiresAt?: number; https?: boolean };
const Ctx = createContext<{ me: Me; refresh: () => Promise<void>; logout: () => Promise<void> }>({
  me: { authenticated: false }, refresh: async () => {}, logout: async () => {},
});
export const useAuth = () => useContext(Ctx);

async function fetchMe(): Promise<Me> {
  try {
    return await (await apiRequest("GET", "/api/auth/me")).json();
  } catch {
    return { authenticated: false };
  }
}

function LoginScreen({ onDone }: { onDone: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [needsCode, setNeedsCode] = useState(false);
  const [show, setShow] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr("");
    try {
      const r = await apiRequest("POST", "/api/auth/login", { email: email.trim(), password: password.replace(/\s+$/, "").replace(/^\s+/, ""), code: needsCode ? code : undefined });
      const d = await r.json();
      if (d.needsCode && !d.ok) {
        setNeedsCode(true);
      } else if (d.ok) {
        setSessionToken(d.token);
        onDone();
      }
    } catch (e: any) {
      setErr(e.message || "Anmeldung fehlgeschlagen");
      if (/Authenticator/.test(e.message)) setCode("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-screen place-items-center bg-background px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-2.5">
          <NexarLogo className="h-9 w-9" />
          <div className="leading-tight">
            <div className="text-lg font-semibold tracking-tight">nexar<span className="text-primary">.</span>bots</div>
            <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">private instanz</div>
          </div>
        </div>
        <form onSubmit={submit} className="space-y-4 rounded-lg border border-card-border bg-card p-6" data-testid="form-login">
          <div className="flex items-center gap-2 text-sm font-medium">
            {needsCode ? <ShieldCheck className="h-4 w-4 text-primary" /> : <Lock className="h-4 w-4 text-primary" />}
            {needsCode ? "Bestätigungscode" : "Anmelden"}
          </div>

          {!needsCode ? (
            <>
              <div className="space-y-1.5">
                <Label htmlFor="login-email">E-Mail</Label>
                <Input id="login-email" type="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus data-testid="input-login-email" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="login-password">Passwort</Label>
                <div className="relative">
                  <Input id="login-password" type={show ? "text" : "password"} autoComplete="current-password" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" data-testid="input-login-password" />
                  <button type="button" onClick={() => setShow(!show)} className="absolute inset-y-0 right-0 grid w-10 place-items-center text-muted-foreground hover:text-foreground" aria-label={show ? "Passwort verbergen" : "Passwort anzeigen"} data-testid="button-toggle-password">
                    {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="login-code">6-stelliger Code aus deiner Authenticator-App</Label>
              <Input id="login-code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} value={code} onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ""))} className="text-center font-mono text-lg tracking-[0.4em]" autoFocus data-testid="input-login-code" />
            </div>
          )}

          {err && <p className="text-sm text-destructive" data-testid="text-login-error">{err}</p>}
          <Button type="submit" className="w-full" disabled={busy} data-testid="button-login">
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}{needsCode ? "Bestätigen" : "Anmelden"}
          </Button>
          {needsCode && (
            <button type="button" onClick={() => { setNeedsCode(false); setCode(""); setErr(""); }} className="w-full text-xs text-muted-foreground hover:text-foreground">
              Zurück
            </button>
          )}
        </form>
        <p className="mt-4 text-center text-xs text-muted-foreground">Dieses Gerät bleibt 7 Tage angemeldet.</p>
      </div>
    </div>
  );
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);

  const refresh = async () => setMe(await fetchMe());
  const logout = async () => {
    try { await apiRequest("POST", "/api/auth/logout"); } catch {}
    setSessionToken("");
    queryClient.clear();
    setMe({ authenticated: false });
  };

  useEffect(() => {
    refresh();
    setUnauthorizedHandler(() => {
      setSessionToken("");
      queryClient.clear();
      setMe({ authenticated: false });
    });
  }, []);

  if (!me) return <div className="grid h-screen place-items-center bg-background"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;
  if (!me.authenticated) return <LoginScreen onDone={async () => { queryClient.clear(); await refresh(); }} />;
  return <Ctx.Provider value={{ me, refresh, logout }}>{children}</Ctx.Provider>;
}
