import { createSign } from "node:crypto";
import type { Express, Request, Response } from "express";
import { z } from "zod";
import {
  notificationStore,
  type NotificationDevice,
  type NotificationEvent,
} from "./notification-store";

const pairSchema = z.object({
  code: z.string().trim().min(7).max(40),
  installationId: z.string().trim().min(16).max(120),
  displayName: z.string().trim().min(1).max(80),
  platform: z.enum(["android", "android_expo"]).default("android"),
  fcmPushToken: z.string().trim().max(255).optional(),
});
const heartbeatSchema = z.object({
  fcmPushToken: z.string().trim().max(255).nullable().optional(),
});
const mobileReminderSchema = z.object({
  taskId: z.number().int().positive(),
  content: z.string().trim().min(1).max(2_000),
});
const pairingAttempts = new Map<string, { until: number; count: number }>();

type FirebaseServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
};
let fcmAccess: { token: string; expiresAt: number } | null = null;

function bearer(req: Request) {
  const raw = String(req.headers.authorization || "");
  return raw.startsWith("Bearer ") ? raw.slice(7).trim() : "";
}

function allowPairing(req: Request) {
  const key = String(req.ip || req.socket.remoteAddress || "unknown").slice(
    0,
    120,
  );
  const t = Date.now();
  const current = pairingAttempts.get(key);
  if (!current || current.until <= t) {
    pairingAttempts.set(key, { until: t + 10 * 60_000, count: 1 });
    return true;
  }
  if (current.count >= 12) return false;
  current.count += 1;
  return true;
}

async function requireMobileDevice(
  req: Request,
  res: Response,
): Promise<NotificationDevice | null> {
  const token = bearer(req);
  const deviceId = String(
    req.headers["x-nexar-device-id"] || req.params.deviceId || "",
  ).trim();
  if (!token || !deviceId) {
    res.status(401).json({ message: "Gerätezugang fehlt" });
    return null;
  }
  const device = await notificationStore.deviceByToken(deviceId, token);
  if (!device) {
    res.status(401).json({ message: "Gerätezugang ungültig" });
    return null;
  }
  return device;
}

function publicEvent(event: NotificationEvent) {
  return {
    id: event.id,
    title: event.title,
    payload: event.payload,
    createdAt: event.createdAt,
    seenAt: event.seenAt,
    dismissedAt: event.dismissedAt,
  };
}

function readFirebaseAccount(): FirebaseServiceAccount | null {
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) return null;
  try {
    const account = JSON.parse(raw) as FirebaseServiceAccount;
    return account.project_id && account.client_email && account.private_key
      ? account
      : null;
  } catch {
    return null;
  }
}

function base64url(value: object | string) {
  const source = typeof value === "string" ? value : JSON.stringify(value);
  return Buffer.from(source).toString("base64url");
}

async function firebaseAccessToken(account: FirebaseServiceAccount) {
  if (fcmAccess && fcmAccess.expiresAt > Date.now() + 60_000)
    return fcmAccess.token;
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${base64url({ alg: "RS256", typ: "JWT" })}.${base64url({
    iss: account.client_email,
    scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: account.token_uri || "https://oauth2.googleapis.com/token",
    iat: issuedAt,
    exp: issuedAt + 3_500,
  })}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  const assertion = `${unsigned}.${signer.sign(account.private_key.replace(/\\n/g, "\n")).toString("base64url")}`;
  const response = await fetch(
    account.token_uri || "https://oauth2.googleapis.com/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion,
      }),
      signal: AbortSignal.timeout(15_000),
    },
  );
  const body = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
  };
  if (!response.ok || !body.access_token)
    throw new Error(`FCM OAuth fehlgeschlagen (${response.status})`);
  fcmAccess = {
    token: body.access_token,
    expiresAt: Date.now() + Math.max(60, body.expires_in || 3_000) * 1_000,
  };
  return fcmAccess.token;
}

export async function sendNotificationPush(
  device: NotificationDevice,
  event: NotificationEvent,
) {
  if (!device.fcmPushToken) return false;
  const account = readFirebaseAccount();
  if (!account) return false;
  try {
    const accessToken = await firebaseAccessToken(account);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: device.fcmPushToken,
            data: { eventId: event.id },
            ...(device.platform === "android_expo"
              ? {
                  notification: {
                    title: event.title,
                    body: String(
                      event.payload.summary ||
                        "Öffne Nexar-Bots für die vollständige Meldung.",
                    ).slice(0, 160),
                  },
                  android: {
                    priority: "high",
                    notification: { channel_id: "nexar" },
                  },
                }
              : { android: { priority: "high" } }),
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      name?: string;
      error?: { message?: string };
    };
    if (!response.ok || !body.name)
      throw new Error(body.error?.message || `FCM ${response.status}`);
    await notificationStore.markPushSent(event.id);
    return true;
  } catch (error: any) {
    console.error(
      "Nexar-Bots-FCM-Push fehlgeschlagen:",
      error?.message || error,
    );
    return false;
  }
}

/** Sends no reminder text, only a signal for the paired app to reload its protected reminder list. */
export async function sendReminderSyncPush(device: NotificationDevice) {
  if (device.platform !== "android_expo" || !device.fcmPushToken) return false;
  const account = readFirebaseAccount();
  if (!account) return false;
  try {
    const accessToken = await firebaseAccessToken(account);
    const response = await fetch(
      `https://fcm.googleapis.com/v1/projects/${encodeURIComponent(account.project_id)}/messages:send`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          message: {
            token: device.fcmPushToken,
            data: {
              kind: "reminders_updated",
              sentAt: String(Date.now()),
            },
            android: { priority: "HIGH", ttl: "300s" },
          },
        }),
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      name?: string;
      error?: { message?: string };
    };
    if (!response.ok || !body.name)
      throw new Error(body.error?.message || `FCM ${response.status}`);
    return true;
  } catch (error: any) {
    console.error(
      "Nexar-Bots-Reminder-Push fehlgeschlagen:",
      error?.message || error,
    );
    return false;
  }
}

export function queueReminderSync(userId: number) {
  void notificationStore
    .listDevices(userId)
    .then((devices) =>
      Promise.all(
        devices
          .filter((device) => device.platform === "android_expo")
          .map(sendReminderSyncPush),
      ),
    )
    .catch((error: any) =>
      console.error(
        "Nexar-Bots-Reminder-Sync konnte nicht gestartet werden:",
        error?.message || error,
      ),
    );
}

/** Geschützte Web-API und tokengebundene Android-API. */
export function registerNotificationRoutes(app: Express) {
  app.get("/api/notification-devices", async (req, res) =>
    res.json(await notificationStore.listDevices(req.user!.id)),
  );
  app.post("/api/notification-devices/pairings", async (req, res) =>
    res.json(await notificationStore.createPairing(req.user!.id)),
  );
  app.delete("/api/notification-devices/:id", async (req, res) => {
    const deleted = await notificationStore.deleteDevice(
      req.user!.id,
      String(req.params.id),
    );
    res.status(deleted ? 200 : 404).json({ ok: deleted });
  });
  app.get("/api/reminders", async (req, res) => {
    const rawTaskId =
      req.query.taskId == null ? undefined : Number(req.query.taskId);
    if (
      rawTaskId !== undefined &&
      (!Number.isInteger(rawTaskId) || rawTaskId < 1)
    )
      return res.status(400).json({ message: "Ungültige Automation" });
    res.json(await notificationStore.listTaskReminders(rawTaskId));
  });
  app.post("/api/tasks/:id/reminders", async (req, res) => {
    const taskId = Number(req.params.id);
    const content =
      typeof req.body?.content === "string" ? req.body.content.trim() : "";
    if (!Number.isSafeInteger(taskId) || taskId < 1)
      return res.status(400).json({ message: "Ungültige Automation" });
    if (!content || content.length > 2_000)
      return res.status(400).json({
        message: "Eine Erinnerung muss 1 bis 2.000 Zeichen enthalten.",
      });
    if (!(await notificationStore.taskExists(taskId)))
      return res.status(404).json({ message: "Automation nicht gefunden" });
    const reminder = await notificationStore.addTaskReminder(taskId, content);
    res.status(201).json(reminder);
    queueReminderSync(req.user!.id);
  });
  app.delete("/api/reminders/:id", async (req, res) => {
    const deleted = await notificationStore.deleteTaskReminder(
      String(req.params.id),
    );
    res.status(deleted ? 200 : 404).json({ ok: deleted });
    if (deleted) queueReminderSync(req.user!.id);
  });

  app.post("/mobile/pair", async (req, res) => {
    if (!allowPairing(req))
      return res.status(429).json({
        message: "Zu viele Kopplungsversuche. Bitte später erneut versuchen.",
      });
    const parsed = pairSchema.safeParse(req.body);
    if (!parsed.success)
      return res.status(400).json({
        message: parsed.error.issues[0]?.message || "Ungültige Kopplungsdaten",
      });
    const paired = await notificationStore.pairDevice(parsed.data);
    if (!paired)
      return res
        .status(400)
        .json({ message: "Kopplungscode ungültig oder abgelaufen" });
    res.status(201).json({
      device: {
        id: paired.device.id,
        displayName: paired.device.displayName,
        platform: paired.device.platform,
      },
      deviceToken: paired.deviceToken,
    });
  });

  app.post("/mobile/devices/:deviceId/heartbeat", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    const parsed = heartbeatSchema.safeParse(req.body || {});
    if (!parsed.success)
      return res
        .status(400)
        .json({ message: "Ungültige Geräteaktualisierung" });
    res.json(
      await notificationStore.touchDevice(device.id, parsed.data.fcmPushToken),
    );
  });

  app.get("/mobile/events", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    await notificationStore.touchDevice(device.id);
    const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 50);
    res.json({
      events: (await notificationStore.listPendingEvents(device.id, limit)).map(
        publicEvent,
      ),
    });
  });
  app.get("/mobile/reminders", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    await notificationStore.touchDevice(device.id);
    res.json({
      reminders: await notificationStore.listDeviceReminders(device.id),
    });
  });
  app.get("/mobile/tasks", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    await notificationStore.touchDevice(device.id);
    res.json({ tasks: await notificationStore.listDeviceTasks(device.id) });
  });
  app.post("/mobile/reminders", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    const parsed = mobileReminderSchema.safeParse(req.body || {});
    if (!parsed.success)
      return res.status(400).json({
        message:
          "Gib eine Automation und einen Erinnerungstext mit 1 bis 2.000 Zeichen an.",
      });
    const reminder = await notificationStore.addDeviceReminder(
      device.id,
      parsed.data.taskId,
      parsed.data.content,
    );
    if (!reminder)
      return res.status(404).json({
        message: "Diese Automation ist diesem Android-Gerät nicht zugeordnet.",
      });
    res.status(201).json({ reminder });
    queueReminderSync(device.userId);
  });
  app.delete("/mobile/reminders/:id", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    const deleted = await notificationStore.deleteDeviceReminder(
      device.id,
      String(req.params.id),
    );
    res.status(deleted ? 200 : 404).json({
      ok: deleted,
      message: deleted ? undefined : "Erinnerung nicht gefunden",
    });
    if (deleted) queueReminderSync(device.userId);
  });
  app.get("/mobile/events/:id", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    const event = await notificationStore.getEvent(
      device.id,
      String(req.params.id),
    );
    event
      ? res.json({ event: publicEvent(event) })
      : res.status(404).json({
          message: "Benachrichtigung nicht gefunden oder bereits geschlossen",
        });
  });
  app.post("/mobile/events/:id/seen", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    const event = await notificationStore.markSeen(
      device.id,
      String(req.params.id),
    );
    event
      ? res.json({ event: publicEvent(event) })
      : res.status(404).json({ message: "Benachrichtigung nicht gefunden" });
  });
  app.post("/mobile/events/:id/dismiss", async (req, res) => {
    const device = await requireMobileDevice(req, res);
    if (!device) return;
    const event = await notificationStore.dismissEvent(
      device.id,
      String(req.params.id),
    );
    event
      ? res.json({ event: publicEvent(event) })
      : res.status(404).json({ message: "Benachrichtigung nicht gefunden" });
  });
}
