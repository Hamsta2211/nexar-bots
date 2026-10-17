# Jarvis Cloud Auth and Settings Sync

The desktop bridge uses Supabase email/password authentication and synchronizes only the owning user's Jarvis settings profile. Apply [`schema.sql`](./schema.sql) in the **NexarBots** Supabase project. The anon/public key may be shipped in `resources/cloud.json`; never ship a service-role key.

`createCloud({ dataDir, config, onSettings, onEvent })` is synchronous and returns an async `invoke(action, payload)` function. Production injects Electron `safeStorage` through `encrypt` and `decrypt`; the auth session is encrypted at `dataDir/cloud-session.json` and never exposed by an invoke result. Non-secret unsynced settings are persisted with mode `0600` in `cloud-settings-pending.json`.

## Invoke contract

| Action | Payload | Result |
|---|---|---|
| `auth:status` | none | `{ configured, signedIn, email?, message? }` |
| `auth:signup` | `{ email, password }` | sign-up status; an email-confirmation signup returns `signedIn:false` |
| `auth:signin` | `{ email, password }` | `{ signedIn:true, email }` |
| `auth:signout` | none | `{ signedIn:false }` |
| `cloud:push` | a patch containing allowed settings | merged validated settings |
| `cloud:pull` | none | merged validated settings and calls `onSettings(settings)` |

Allowed settings are `voice`, `weatherCity`, `alwaysOnTop`, and `wakeEnabled`. Unknown keys, malformed values, and malformed remote JSON are rejected. `id` is always taken from the current Supabase session; it is never accepted from a payload, and `deviceId` is not synchronized.

## Sync guarantees

- Pushes and pulls are serialized.
- A local change is written to the per-user pending file before its network operation. Network/auth/database failures leave that dirty patch intact for retry after restart.
- Push and pull read the latest remote profile, merge the dirty patch, and upsert the merged allowlisted settings. Thus `cloud:pull` also flushes pending local edits. A successful operation clears only the exact patch values it sent; a later local value is retained.
- Pull merges remote settings with pending local changes, so an offline/dirty local change is never silently overwritten.
- Pending settings are tagged by Supabase user ID. Signing out clears the active in-memory pending state, and another user cannot receive the previous user's pending settings.
- Cloud failures reject with `code: CLOUD_SYNC_ERROR` and emit `{ type: 'cloud-error', code, message }`; validation failures use `INVALID_SETTINGS`.

## Parent IPC coordination

The parent should call `cloud:pull` after a successful sign-in and on an intentional refresh. When `onSettings` applies a cloud-originated result to the local service, it must mark that operation as **cloud-originated** (or suppress the next settings push). Do not immediately call `cloud:push` for that application, otherwise the parent creates an echo loop. Local user edits should call `cloud:push` with only the four allowed settings fields. Do not include or sync `deviceId`.

No GitHub OAuth, OAuth callback URL, loopback HTTP server, provider setup, or GitHub configuration is part of this module.
