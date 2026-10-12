import { createHash, randomBytes } from "node:crypto";
import { pool } from "./storage";
import type { AutomationNotification, ExistingWidget, WidgetOperation } from "./notification-format";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const id = (prefix: string) => `${prefix}_${randomBytes(18).toString("base64url")}`;
const now = () => Date.now();

async function one<T = any>(text: string, values: unknown[] = []) {
  return (await pool.query(text, values)).rows[0] as T | undefined;
}
async function many<T = any>(text: string, values: unknown[] = []) {
  return (await pool.query(text, values)).rows as T[];
}

export type NotificationDevice = {
  id: string; userId: number; installationId: string; displayName: string; platform: string;
  fcmPushToken: string | null; createdAt: number; updatedAt: number; lastSeenAt: number | null;
};
export type StoredWidget = ExistingWidget & { id: string; taskId: number; deviceId: string; createdAt: number; updatedAt: number };
export type NotificationEvent = {
  id: string; deviceId: string; taskId: number | null; botId: number | null; title: string;
  payload: Record<string, unknown>; createdAt: number; pushSentAt: number | null; seenAt: number | null; dismissedAt: number | null;
};

const mapDevice = (r: any): NotificationDevice => ({
  id: r.id, userId: Number(r.user_id), installationId: r.installation_id, displayName: r.display_name,
  platform: r.platform, fcmPushToken: r.fcm_push_token, createdAt: Number(r.created_at),
  updatedAt: Number(r.updated_at), lastSeenAt: r.last_seen_at == null ? null : Number(r.last_seen_at),
});
const mapWidget = (r: any): StoredWidget => ({
  id: r.id, taskId: Number(r.task_id), deviceId: r.device_id, key: r.widget_key, kind: r.kind,
  title: r.title, data: r.data || {}, createdAt: Number(r.created_at), updatedAt: Number(r.updated_at),
});
const mapEvent = (r: any): NotificationEvent => ({
  id: r.id, deviceId: r.device_id, taskId: r.task_id == null ? null : Number(r.task_id), botId: r.bot_id == null ? null : Number(r.bot_id),
  title: r.title, payload: r.payload || {}, createdAt: Number(r.created_at), pushSentAt: r.push_sent_at == null ? null : Number(r.push_sent_at),
  seenAt: r.seen_at == null ? null : Number(r.seen_at), dismissedAt: r.dismissed_at == null ? null : Number(r.dismissed_at),
});

function pairingCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(8);
  const chars = Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
  return `NB-${chars.slice(0, 4)}-${chars.slice(4)}`;
}

export const notificationStore = {
  async createPairing(userId: number) {
    const code = pairingCode();
    const createdAt = now();
    const expiresAt = createdAt + 10 * 60_000;
    await pool.query("delete from nb_notification_pairings where expires_at <= $1 or user_id = $2", [createdAt, userId]);
    await pool.query(
      "insert into nb_notification_pairings(id, user_id, code_hash, expires_at, created_at) values ($1,$2,$3,$4,$5)",
      [id("pair"), userId, hash(code), expiresAt, createdAt],
    );
    return { code, expiresAt };
  },

  async pairDevice(input: { code: string; installationId: string; displayName: string; platform?: string; fcmPushToken?: string }) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const paired = (await client.query<any>(
        "delete from nb_notification_pairings where code_hash = $1 and expires_at > $2 returning user_id",
        [hash(input.code.replace(/\s/g, "").toUpperCase()), now()],
      )).rows[0];
      if (!paired) { await client.query("rollback"); return null; }
      const deviceToken = randomBytes(32).toString("base64url");
      const t = now();
      const row = (await client.query<any>(
        `insert into nb_notification_devices(id, user_id, installation_id, display_name, platform, token_hash, fcm_push_token, created_at, updated_at, last_seen_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$8,$8)
         on conflict (installation_id) do update set user_id = excluded.user_id, display_name = excluded.display_name,
           platform = excluded.platform, token_hash = excluded.token_hash, fcm_push_token = excluded.fcm_push_token,
           updated_at = excluded.updated_at, last_seen_at = excluded.last_seen_at
         returning *`,
        [id("device"), Number(paired.user_id), input.installationId, input.displayName.slice(0, 80) || "Android-Gerät", input.platform || "android", hash(deviceToken), input.fcmPushToken || null, t],
      )).rows[0];
      await client.query("commit");
      return { device: mapDevice(row), deviceToken };
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async listDevices(userId: number) {
    return (await many<any>("select * from nb_notification_devices where user_id = $1 order by updated_at desc", [userId])).map(mapDevice);
  },

  async getDevice(deviceId: string) {
    const row = await one<any>("select * from nb_notification_devices where id = $1", [deviceId]);
    return row ? mapDevice(row) : null;
  },

  async deleteDevice(userId: number, deviceId: string) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const device = await client.query("select id from nb_notification_devices where id = $1 and user_id = $2 for update", [deviceId, userId]);
      if (!device.rowCount) { await client.query("rollback"); return false; }
      await client.query("update nb_tasks set enabled = false where notification_device_id = $1", [deviceId]);
      await client.query("delete from nb_notification_devices where id = $1", [deviceId]);
      await client.query("commit");
      return true;
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async deviceByToken(deviceId: string, token: string) {
    const row = await one<any>("select * from nb_notification_devices where id = $1 and token_hash = $2", [deviceId, hash(token)]);
    return row ? mapDevice(row) : null;
  },

  async touchDevice(deviceId: string, fcmPushToken?: string | null) {
    const t = now();
    const row = await one<any>(
      "update nb_notification_devices set fcm_push_token = coalesce($2, fcm_push_token), updated_at = $3, last_seen_at = $3 where id = $1 returning *",
      [deviceId, fcmPushToken || null, t],
    );
    return row ? mapDevice(row) : null;
  },

  async listWidgets(taskId: number, deviceId: string): Promise<StoredWidget[]> {
    return (await many<any>("select * from nb_notification_widgets where task_id = $1 and device_id = $2 order by updated_at, widget_key", [taskId, deviceId])).map(mapWidget);
  },

  async persistAutomationNotification(input: {
    deviceId: string; taskId: number; botId: number; title: string; formatted: AutomationNotification;
    occurredAt: string; timeZone: string; source: { taskName: string; botName: string };
  }) {
    const client = await pool.connect();
    try {
      await client.query("begin");
      const t = now();
      for (const operation of input.formatted.widgetOperations) {
        if (operation.op === "delete") {
          await client.query("delete from nb_notification_widgets where task_id = $1 and device_id = $2 and widget_key = $3", [input.taskId, input.deviceId, operation.key]);
        } else {
          await client.query(
            `insert into nb_notification_widgets(id, task_id, device_id, widget_key, kind, title, data, created_at, updated_at)
             values ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$8)
             on conflict (task_id, device_id, widget_key) do update set kind = excluded.kind, title = excluded.title, data = excluded.data, updated_at = excluded.updated_at`,
            [id("widget"), input.taskId, input.deviceId, operation.key, operation.kind, operation.title, JSON.stringify(operation.data), t],
          );
        }
      }
      const widgets = (await client.query<any>(
        "select * from nb_notification_widgets where task_id = $1 and device_id = $2 order by updated_at, widget_key",
        [input.taskId, input.deviceId],
      )).rows.map(mapWidget);
      const payload = {
        ...input.formatted,
        widgets: widgets.map(({ key, kind, title, data }) => ({ key, kind, title, data })),
        occurredAt: input.occurredAt,
        timeZone: input.timeZone,
        source: input.source,
      };
      const row = (await client.query<any>(
        `insert into nb_notification_events(id, device_id, task_id, bot_id, title, payload, created_at)
         values ($1,$2,$3,$4,$5,$6::jsonb,$7) returning *`,
        [id("event"), input.deviceId, input.taskId, input.botId, input.title, JSON.stringify(payload), t],
      )).rows[0];
      await client.query("commit");
      return mapEvent(row);
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  },

  async listPendingEvents(deviceId: string, limit = 20) {
    return (await many<any>(
      "select * from nb_notification_events where device_id = $1 and dismissed_at is null order by created_at desc limit $2",
      [deviceId, Math.min(Math.max(limit, 1), 50)],
    )).map(mapEvent);
  },

  async getEvent(deviceId: string, eventId: string) {
    const row = await one<any>("select * from nb_notification_events where id = $1 and device_id = $2 and dismissed_at is null", [eventId, deviceId]);
    return row ? mapEvent(row) : null;
  },

  async markSeen(deviceId: string, eventId: string) {
    const row = await one<any>(
      "update nb_notification_events set seen_at = coalesce(seen_at, $3) where id = $1 and device_id = $2 returning *",
      [eventId, deviceId, now()],
    );
    return row ? mapEvent(row) : null;
  },

  async dismissEvent(deviceId: string, eventId: string) {
    const row = await one<any>(
      "update nb_notification_events set dismissed_at = coalesce(dismissed_at, $3) where id = $1 and device_id = $2 returning *",
      [eventId, deviceId, now()],
    );
    return row ? mapEvent(row) : null;
  },

  async markPushSent(eventId: string) {
    await pool.query("update nb_notification_events set push_sent_at = $2 where id = $1", [eventId, now()]);
  },
};
