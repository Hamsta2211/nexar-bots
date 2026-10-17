# Jarvis Cloud Auth

This is the additive Supabase cloud contract for the desktop module. Apply [`schema.sql`](./schema.sql) in the **NexarBots** project (`tilhtpkrgvixaifxbmse`). It creates only `public.jarvis_profiles`; it does not alter unrelated resources.

## Configuration and security

Desktop reads `resources/cloud.json` (`{ "url": "https://...supabase.co", "anonKey": "..." }`). The anon/public key is safe to ship; never put a service-role key in this file. `createCloud({ dataDir, config, onSettings, onEvent })` is synchronous and returns an async `invoke(action, payload)` function. For encrypted session persistence, the parent should inject `encrypt` and `decrypt` functions backed by Electron `safeStorage` (these are options/config hooks, not exported secrets). Without them, the session remains memory-only and is never written to disk.

The module never returns access or refresh tokens. `auth:status` returns only `{ configured, signedIn, email? }` (and a human-readable message when useful). `onSettings` receives only the four allowlisted fields.

## Invoke contract

| Action | Payload | Result |
|---|---|---|
| `auth:status` | none | `{ configured, signedIn, email?, message? }` |
| `auth:signup` | `{ email, password }` | sign-up status; if email confirmation is enabled, `signedIn:false` and a confirmation message |
| `auth:signin` | `{ email, password }` | `{ signedIn:true, email }` |
| `auth:signout` | none | `{ signedIn:false }` |
| `auth:github` | none | `{ url }`; opens externally through the parent-provided `openExternal` hook |
| `auth:callback` | `{ url }` | exchanges the OAuth code using PKCE |
| `cloud:push` | `{ voice, weatherCity, alwaysOnTop, wakeEnabled }` | validated settings |
| `cloud:pull` | none | validated settings and calls `onSettings(settings)` |

`voice` is a non-empty neural voice name (letters first, then letters/numbers/`_`/`-`, max 64 characters); `weatherCity` is a string of at most 100 characters; the other two values are booleans. Unknown keys are rejected. Push uses a single-row upsert and therefore has **last-write-wins** conflict semantics based on the complete submitted settings object; it does not merge arbitrary keys. Pull validates the server JSON before applying it.

The local OAuth callback is `http://127.0.0.1:47832/auth/callback`. The loopback HTTP server starts only for the GitHub flow, uses a random state value, and closes after callback. The module uses Supabase PKCE and its own storage adapter; if encrypted hooks are present, that adapter persists the session encrypted under `dataDir/cloud-session.json`.

## Required Supabase / GitHub setup

1. In Supabase Auth, enable **GitHub** and configure its GitHub OAuth client ID and secret. The module cannot enable or verify this provider for you.
2. In Supabase Auth URL configuration, add these redirect URLs:
   - `http://127.0.0.1:47832/auth/callback`
   - `im.nexar.jarvis://auth/callback` (Android deep link)
3. In the GitHub OAuth App, set the authorization callback URL to Supabase's provider callback, **not** the desktop loopback URL:
   `https://tilhtpkrgvixaifxbmse.supabase.co/auth/v1/callback`
4. GitHub OAuth app manifest/setup values to use when creating the app:
   - Application name: `NexarBots Jarvis`
   - Homepage URL: the project's published product/homepage URL
   - Authorization callback URL: the Supabase URL above
   - Scopes: `read:user user:email`

Supabase may still reject `auth:github` until the provider is enabled and the GitHub client credentials are entered. No provider configuration is claimed by this repository.

## Integration notes

Call `invoke('cloud:pull')` on startup after sign-in and optionally from a parent-owned 15-second poll. Call `invoke('cloud:push', currentSettings)` after local settings changes. `onEvent` receives coarse auth events only; tokens and provider payloads are not exposed. The callback can be handled by the module's temporary server or explicitly passed to `auth:callback` by the parent.
