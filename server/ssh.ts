import ssh2 from "ssh2";
const { Client, utils: sshUtils } = ssh2;
import { createHash } from "node:crypto";
import { storage } from "./storage";

export type SshConfig = {
  host: string;
  port: number;
  username: string;
  authType: "key" | "password";
  privateKey: string;
  passphrase: string;
  password: string;
  safeMode: boolean;
};

const DEFAULTS: SshConfig = {
  host: "", port: 22, username: "", authType: "key", privateKey: "", passphrase: "", password: "", safeMode: true,
};

export function getSshConfig(): SshConfig {
  try {
    return { ...DEFAULTS, ...JSON.parse(storage.getSetting("ssh_config") || "{}") };
  } catch {
    return DEFAULTS;
  }
}

export function saveSshConfig(patch: Partial<SshConfig>) {
  const cur = getSshConfig();
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    // leere Geheimnisse = unverändert lassen
    if (["privateKey", "passphrase", "password"].includes(k) && v === "") continue;
    (next as any)[k] = v;
  }
  if (next.host !== cur.host || next.port !== cur.port) storage.setSetting("ssh_hostkey", "");
  storage.setSetting("ssh_config", JSON.stringify(next));
  return next;
}

export function clearSshSecrets() {
  const cur = getSshConfig();
  storage.setSetting("ssh_config", JSON.stringify({ ...cur, privateKey: "", passphrase: "", password: "" }));
}

export function publicSshConfig() {
  const c = getSshConfig();
  return {
    host: c.host, port: c.port, username: c.username, authType: c.authType, safeMode: c.safeMode,
    hasKey: !!c.privateKey, hasPassword: !!c.password, hasPassphrase: !!c.passphrase,
    configured: !!(c.host && c.username && (c.privateKey || c.password)),
    hostKey: storage.getSetting("ssh_hostkey") || "",
    publicKey: storage.getSetting("ssh_pubkey") || "",
  };
}

const DANGEROUS: RegExp[] = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\s+(\/|~|\$HOME|\*)(\s|$)/,
  /\bmkfs(\.\w+)?\b/,
  /\bdd\b[^|]*\bof=\/dev\//,
  /:\(\)\s*\{\s*:\|:&\s*\};:/,
  /\b(shutdown|poweroff|reboot|halt)\b/,
  /\bchmod\s+-R\s+0?777\s+\//,
  />\s*\/dev\/sd[a-z]/,
  /\b(curl|wget)\b[^|]*\|\s*(sudo\s+)?(ba|z)?sh\b/,
];

export function checkCommand(cmd: string, safeMode: boolean) {
  if (!safeMode) return;
  for (const re of DANGEROUS) {
    if (re.test(cmd)) throw new Error(`Durch den Sicherheitsmodus blockiert: "${cmd.slice(0, 80)}". Deaktiviere den Sicherheitsmodus unter "Mein PC", falls das gewollt ist.`);
  }
}

export type ExecResult = { stdout: string; stderr: string; code: number | null; durationMs: number };

export function sshExec(command: string, opts: { timeoutMs?: number; bypassSafe?: boolean } = {}): Promise<ExecResult> {
  const c = getSshConfig();
  if (!c.host || !c.username) return Promise.reject(new Error("Kein PC verbunden. Richte die SSH-Verbindung unter \"Mein PC\" ein."));
  if (!opts.bypassSafe) checkCommand(command, c.safeMode);
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const t0 = Date.now();

  return new Promise((resolve, reject) => {
    const conn = new Client();
    let stdout = "", stderr = "", done = false;
    const finish = (err: Error | null, code: number | null = null) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      conn.end();
      if (err) reject(err);
      else resolve({ stdout, stderr, code, durationMs: Date.now() - t0 });
    };
    const timer = setTimeout(() => finish(new Error(`Zeitüberschreitung nach ${timeoutMs / 1000}s`)), timeoutMs);

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return finish(err);
          stream
            .on("close", (code: number) => finish(null, code ?? null))
            .on("data", (d: Buffer) => { stdout += d.toString(); if (stdout.length > 200_000) stdout = stdout.slice(-200_000); })
            .stderr.on("data", (d: Buffer) => { stderr += d.toString(); if (stderr.length > 50_000) stderr = stderr.slice(-50_000); });
        });
      })
      .on("error", (e) => finish(new Error(`SSH-Fehler: ${e.message}`)))
      .connect({
        host: c.host,
        port: c.port || 22,
        username: c.username,
        readyTimeout: 15_000,
        keepaliveInterval: 10_000,
        ...(c.authType === "key"
          ? { privateKey: c.privateKey, passphrase: c.passphrase || undefined }
          : { password: c.password }),
        // Trust-on-first-use: Fingerabdruck beim ersten Verbinden merken, danach prüfen
        hostVerifier: (key: Buffer) => {
          const fp = "SHA256:" + createHash("sha256").update(key).digest("base64").replace(/=+$/, "");
          const known = storage.getSetting("ssh_hostkey");
          if (!known) {
            storage.setSetting("ssh_hostkey", fp);
            return true;
          }
          if (known !== fp) {
            setTimeout(() => finish(new Error(`Host-Key hat sich geändert (erwartet ${known}, erhalten ${fp}). Falls du den PC neu aufgesetzt hast, setze den Fingerabdruck unter "Mein PC" zurück.`)), 0);
            return false;
          }
          return true;
        },
      } as any);
  });
}

export async function systemInfo() {
  const script = [
    "echo HOST=$(hostname)",
    "echo OS=$(. /etc/os-release 2>/dev/null && echo $PRETTY_NAME)",
    "echo KERNEL=$(uname -r)",
    "echo UPTIME=$(uptime -p 2>/dev/null)",
    "echo LOAD=$(cut -d' ' -f1-3 /proc/loadavg)",
    "echo CPUS=$(nproc)",
    "free -b | awk '/Mem:/ {print \"MEM=\"$3\"/\"$2}'",
    "df -B1 / | awk 'NR==2 {print \"DISK=\"$3\"/\"$2}'",
    "echo IP=$(hostname -I 2>/dev/null | awk '{print $1}')",
  ].join("; ");
  const r = await sshExec(script, { bypassSafe: true, timeoutMs: 20_000 });
  const info: Record<string, string> = {};
  for (const line of r.stdout.split("\n")) {
    const i = line.indexOf("=");
    if (i > 0) info[line.slice(0, i)] = line.slice(i + 1).trim();
  }
  return info;
}

export function generateKey() {
  const k = sshUtils.generateKeyPairSync("ed25519", { comment: "nexar-bots" });
  saveSshConfig({ authType: "key", privateKey: k.private, passphrase: "" });
  // Passphrase explizit leeren (saveSshConfig ignoriert leere Geheimnisse)
  const cur = getSshConfig();
  storage.setSetting("ssh_config", JSON.stringify({ ...cur, passphrase: "" }));
  storage.setSetting("ssh_pubkey", k.public);
  return k.public;
}
