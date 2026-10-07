import type { Express, Request, Response, NextFunction } from "express";
import { createHash, createHmac, randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import QRCode from "qrcode";
import { storage, encrypt, decrypt } from "./storage";

const scrypt = promisify(scryptCb) as (pw: string, salt: Buffer, len: number, opts: any) => Promise<Buffer>;

export const SESSION_DAYS = 7;
const SESSION_MS = SESSION_DAYS * 86_400_000;
const COOKIE = "nexar_session";

// Brute-Force-Schutz
const IP_WINDOW_MS = 15 * 60_000, IP_MAX_FAILS = 8;
const ACCOUNT_WINDOW_MS = 60 * 60_000, ACCOUNT_MAX_FAILS = 10;

declare global {
  namespace Express {
    interface Request { user?: { id: number; email: string }; sessionId?: number }
  }
}

// ---------- Passwort ----------
export async function hashPassword(pw: string) {
  const salt = randomBytes(16);
  const h = await scrypt(pw, salt, 64, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  return `scrypt$16384$8$1$${salt.toString("base64")}$${h.toString("base64")}`;
}
export async function verifyPassword(pw: string, stored: string) {
  const [alg, N, r, p, salt, hash] = stored.split("$");
  if (alg !== "scrypt") return false;
  const expected = Buffer.from(hash, "base64");
  const h = await scrypt(pw, Buffer.from(salt, "base64"), expected.length, { N: +N, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
  return h.length === expected.length && timingSafeEqual(h, expected);
}
const DUMMY_HASH = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA==$" + Buffer.alloc(64).toString("base64");

// ---------- TOTP (RFC 6238, kompatibel mit Google Authenticator, Aegis, 1Password …) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const b of Array.from(buf)) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
function base32Decode(s: string) {
  const clean = s.replace(/=+$/, "").toUpperCase().replace(/\s/g, "");
  let bits = 0, value = 0; const out: number[] = [];
  for (const ch of clean.split("")) {
    const idx = B32.indexOf(ch); if (idx < 0) continue;
    value = (value << 5) | idx; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}
function totpAt(secret: string, counter: number) {
  const buf = Buffer.alloc(8); buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 15;
  const code = ((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  return code;
}
export function verifyTotp(secret: string, code: string) {
  const c = String(code || "").replace(/\s/g, "");
  if (!/^\d{6}$/.test(c)) return false;
  const now = Math.floor(Date.now() / 30_000);
  for (const d of [-1, 0, 1]) {
    const exp = totpAt(secret, now + d);
    if (timingSafeEqual(Buffer.from(exp), Buffer.from(c))) return true;
  }
  return false;
}

// ---------- Sessions ----------
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");
const clientIp = (req: Request) => (req.ip || req.socket.remoteAddress || "").replace(/^::ffff:/, "");
const isHttps = (req: Request) => req.secure || req.headers["x-forwarded-proto"] === "https";

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of String(req.headers.cookie || "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function deviceName(ua: string) {
  const os = /iPhone/.test(ua) ? "iPhone" : /iPad/.test(ua) ? "iPad" : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows" : /Mac OS X/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : "Gerät";
  const br = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} auf ${os}`;
}

function setSessionCookie(req: Request, res: Response, token: string, maxAgeMs: number) {
  const parts = [
    `${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
    "SameSite=Lax",
  ];
  if (isHttps(req)) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

async function resolveSession(req: Request) {
  const token = parseCookies(req)[COOKIE] || String(req.headers["x-nexar-session"] || "");
  if (!token || token.length < 32) return null;
  const s = await storage.getSessionByHash(sha256(token));
  if (!s) return null;
  const user = await storage.getUser(s.user_id);
  if (!user) return null;
  // last_seen höchstens einmal pro Minute schreiben
  if (Date.now() - s.last_seen_at > 60_000) storage.touchSession(s.id, clientIp(req)).catch(() => {});
  return { session: s, user };
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (req.path === "/health" || req.path.startsWith("/auth/login") || req.path === "/auth/me") return next();
  try {
    const r = await resolveSession(req);
    if (!r) return res.status(401).json({ message: "Nicht angemeldet" });
    req.user = { id: r.user.id, email: r.user.email };
    req.sessionId = r.session.id;
    next();
  } catch (e) {
    next(e);
  }
}

export function registerAuthRoutes(app: Express) {
  app.get("/api/auth/me", async (req, res) => {
    const r = await resolveSession(req);
    if (!r) return res.json({ authenticated: false });
    res.json({
      authenticated: true,
      email: r.user.email,
      totpEnabled: r.user.totp_enabled,
      sessionExpiresAt: r.session.expires_at,
      https: isHttps(req),
    });
  });

  app.post("/api/auth/login", async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    const code = String(req.body?.code || "");
    const ip = clientIp(req);

    const ipFails = await storage.failedAttempts(Date.now() - IP_WINDOW_MS, { ip });
    const accFails = email ? await storage.failedAttempts(Date.now() - ACCOUNT_WINDOW_MS, { email }) : 0;
    if (ipFails >= IP_MAX_FAILS || accFails >= ACCOUNT_MAX_FAILS) {
      return res.status(429).json({ message: "Zu viele Fehlversuche. Bitte später erneut versuchen." });
    }

    const user = email ? await storage.getUserByEmail(email) : undefined;
    // Immer hashen, damit die Antwortzeit nicht verrät, ob die E-Mail existiert
    const pwOk = await verifyPassword(password, user?.password_hash || DUMMY_HASH);
    if (!user || !pwOk) {
      await storage.addLoginAttempt(email || "-", ip, false);
      await new Promise((r) => setTimeout(r, 400 + Math.random() * 400));
      return res.status(401).json({ message: "E-Mail oder Passwort falsch." });
    }
    if (user.totp_enabled) {
      if (!code) return res.json({ ok: false, needsCode: true });
      if (!verifyTotp(decrypt(user.totp_secret), code)) {
        await storage.addLoginAttempt(email, ip, false);
        return res.status(401).json({ message: "Code aus der Authenticator-App ist falsch.", needsCode: true });
      }
    }
    await storage.addLoginAttempt(email, ip, true);

    const token = randomBytes(32).toString("base64url");
    const ua = String(req.headers["user-agent"] || "").slice(0, 300);
    const expiresAt = Date.now() + SESSION_MS;
    await storage.createSession({ userId: user.id, tokenHash: sha256(token), deviceName: deviceName(ua), userAgent: ua, ip, expiresAt });
    setSessionCookie(req, res, token, SESSION_MS);
    // Token zusätzlich zurückgeben: Fallback für eingebettete Vorschauen, in denen Cookies blockiert sind
    res.json({ ok: true, token, expiresAt });
  });

  app.post("/api/auth/logout", async (req, res) => {
    if (req.sessionId && req.user) await storage.deleteSession(req.sessionId, req.user.id);
    setSessionCookie(req, res, "", 0);
    res.json({ ok: true });
  });

  app.get("/api/auth/sessions", async (req, res) => {
    const rows = await storage.listSessions(req.user!.id);
    res.json(rows.map((s: any) => ({
      id: s.id, deviceName: s.device_name, ip: s.ip, createdAt: s.created_at, lastSeenAt: s.last_seen_at,
      expiresAt: s.expires_at, current: s.id === req.sessionId,
    })));
  });
  app.delete("/api/auth/sessions/:id", async (req, res) => {
    await storage.deleteSession(Number(req.params.id), req.user!.id);
    res.json({ ok: true });
  });
  app.post("/api/auth/sessions/revoke-others", async (req, res) => {
    await storage.deleteOtherSessions(req.user!.id, req.sessionId!);
    res.json({ ok: true });
  });

  app.post("/api/auth/password", async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    const { current, next: nextPw } = req.body || {};
    if (!(await verifyPassword(String(current || ""), user.password_hash))) return res.status(400).json({ message: "Aktuelles Passwort ist falsch." });
    const pw = String(nextPw || "");
    if (pw.length < 12) return res.status(400).json({ message: "Neues Passwort muss mindestens 12 Zeichen haben." });
    await storage.updateUser(user.id, { password_hash: await hashPassword(pw) });
    await storage.deleteOtherSessions(user.id, req.sessionId!); // andere Geräte abmelden
    res.json({ ok: true });
  });

  // 2FA einrichten: Geheimnis erzeugen (noch nicht aktiv), QR-Code liefern
  app.post("/api/auth/2fa/setup", async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    if (user.totp_enabled) return res.status(400).json({ message: "2FA ist bereits aktiv." });
    const secret = base32Encode(randomBytes(20));
    await storage.updateUser(user.id, { totp_secret: encrypt(secret) });
    const uri = `otpauth://totp/${encodeURIComponent(`Nexar Bots:${user.email}`)}?secret=${secret}&issuer=${encodeURIComponent("Nexar Bots")}&algorithm=SHA1&digits=6&period=30`;
    res.json({ secret, uri, qr: await QRCode.toDataURL(uri, { margin: 1, width: 220 }) });
  });
  app.post("/api/auth/2fa/enable", async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    if (!user.totp_secret) return res.status(400).json({ message: "Zuerst einrichten." });
    if (!verifyTotp(decrypt(user.totp_secret), String(req.body?.code || ""))) return res.status(400).json({ message: "Code stimmt nicht. Uhrzeit am Handy prüfen." });
    await storage.updateUser(user.id, { totp_enabled: true });
    res.json({ ok: true });
  });
  app.post("/api/auth/2fa/disable", async (req, res) => {
    const user = await storage.getUser(req.user!.id);
    if (!(await verifyPassword(String(req.body?.password || ""), user.password_hash))) return res.status(400).json({ message: "Passwort falsch." });
    if (user.totp_enabled && !verifyTotp(decrypt(user.totp_secret), String(req.body?.code || ""))) return res.status(400).json({ message: "Code falsch." });
    await storage.updateUser(user.id, { totp_enabled: false, totp_secret: null });
    res.json({ ok: true });
  });

  // Aufräumen: abgelaufene Sessions und alte Login-Versuche
  setInterval(() => {
    storage.purgeExpiredSessions().catch(() => {});
    storage.pruneLoginAttempts(Date.now() - 30 * 86_400_000).catch(() => {});
  }, 60 * 60_000);
}
