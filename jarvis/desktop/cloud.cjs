'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const http = require('node:http');
const { createClient } = require('@supabase/supabase-js');

const DEFAULT_CALLBACK = 'http://127.0.0.1:47832/auth/callback';
const PROFILE_TABLE = 'jarvis_profiles';
const VOICE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

function makeError(message, code = 'CLOUD_ERROR') {
  const error = new Error(message);
  error.code = code;
  return error;
}

function configValues(config) {
  if (!config) return {};
  if (typeof config === 'string') {
    try { return JSON.parse(config); } catch (_) { return {}; }
  }
  return config;
}

function sanitizeSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw makeError('Settings must be an object', 'INVALID_SETTINGS');
  }
  const allowed = ['voice', 'weatherCity', 'alwaysOnTop', 'wakeEnabled'];
  for (const key of Object.keys(input)) {
    if (!allowed.includes(key)) throw makeError(`Unknown setting: ${key}`, 'INVALID_SETTINGS');
  }
  const output = {};
  if (input.voice !== undefined) {
    if (typeof input.voice !== 'string' || !VOICE_RE.test(input.voice)) {
      throw makeError('voice must be a valid neural voice name', 'INVALID_SETTINGS');
    }
    output.voice = input.voice;
  }
  if (input.weatherCity !== undefined) {
    if (typeof input.weatherCity !== 'string' || input.weatherCity.length > 100) {
      throw makeError('weatherCity must be a string of at most 100 characters', 'INVALID_SETTINGS');
    }
    output.weatherCity = input.weatherCity;
  }
  for (const key of ['alwaysOnTop', 'wakeEnabled']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw makeError(`${key} must be boolean`, 'INVALID_SETTINGS');
      output[key] = input[key];
    }
  }
  return output;
}

function errorMessage(error) {
  return error && error.message ? error.message : String(error || 'Unknown error');
}

/**
 * Create the desktop cloud bridge. The returned function is async and accepts
 * invoke(action, payload), suitable for an IPC handler.
 */
function createCloud(options = {}) {
  const { dataDir, onSettings, onEvent } = options;
  const cfg = configValues(options.config);
  const url = cfg.url || cfg.supabaseUrl;
  const anonKey = cfg.anonKey || cfg.anon_key || cfg.publishableKey;
  const configured = Boolean(url && anonKey);
  const callbackUrl = DEFAULT_CALLBACK;
  const sessionPath = dataDir ? path.join(dataDir, 'cloud-session.json') : null;
  const memoryStore = new Map();
  const encrypt = options.encrypt || cfg.encrypt;
  const decrypt = options.decrypt || cfg.decrypt;
  const openExternal = options.openExternal || cfg.openExternal || (options.shell && options.shell.openExternal);
  let session = null;
  let supabase = null;
  let callbackServer = null;
  let expectedState = null;
  let authSubscription = null;

  const storage = {
    async getItem(key) {
      if (memoryStore.has(key)) return memoryStore.get(key);
      if (key !== 'supabase.auth.token' || !sessionPath || typeof decrypt !== 'function') return null;
      try {
        const raw = await fs.readFile(sessionPath, 'utf8');
        const value = await decrypt(raw);
        memoryStore.set(key, value);
        return value;
      } catch (_) { return null; }
    },
    async setItem(key, value) {
      memoryStore.set(key, value);
      if (key !== 'supabase.auth.token' || !sessionPath || typeof encrypt !== 'function') return;
      await fs.mkdir(path.dirname(sessionPath), { recursive: true });
      const encrypted = await encrypt(value);
      if (!encrypted) return;
      await fs.writeFile(sessionPath, String(encrypted), { mode: 0o600 });
    },
    async removeItem(key) {
      memoryStore.delete(key);
      if (key === 'supabase.auth.token' && sessionPath) {
        try { await fs.unlink(sessionPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    },
  };

  if (configured) {
    supabase = createClient(url, anonKey, {
      auth: { storageKey: 'supabase.auth.token', flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storage },
    });
    const subscription = supabase.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession;
      try { onEvent && onEvent({ type: 'auth', event, signedIn: Boolean(nextSession), email: nextSession?.user?.email || null }); } catch (_) {}
    });
    authSubscription = subscription.data?.subscription;
  }

  async function currentSession() {
    if (!supabase) return null;
    const result = await supabase.auth.getSession();
    if (result.error) throw result.error;
    session = result.data.session;
    return session;
  }
  function requireClient() { if (!supabase) throw makeError('Cloud is not configured', 'NOT_CONFIGURED'); }
  function requireSignedIn() { if (!session) throw makeError('Not signed in', 'NOT_SIGNED_IN'); }

  async function pull() {
    requireClient();
    await currentSession();
    requireSignedIn();
    const { data, error } = await supabase.from(PROFILE_TABLE).select('settings').eq('id', session.user.id).maybeSingle();
    if (error) throw error;
    const settings = sanitizeSettings(data?.settings || {});
    if (onSettings) await onSettings(settings);
    return settings;
  }

  async function stopCallbackServer() {
    if (!callbackServer) return;
    const server = callbackServer;
    callbackServer = null;
    server.close();
  }

  async function callback(rawUrl) {
    requireClient();
    const parsed = new URL(rawUrl);
    const state = parsed.searchParams.get('state');
    if (!expectedState || state !== expectedState || !parsed.searchParams.get('code')) throw makeError('OAuth state mismatch', 'OAUTH_STATE_MISMATCH');
    const { data, error } = await supabase.auth.exchangeCodeForSession(parsed.searchParams.get('code'));
    expectedState = null;
    await stopCallbackServer();
    if (error) throw error;
    session = data.session;
    return { signedIn: Boolean(session), email: session?.user?.email || null };
  }

  async function startOAuthServer() {
    if (callbackServer) return;
    await new Promise((resolve, reject) => {
      const server = http.createServer(async (request, response) => {
        const requestUrl = new URL(request.url, `http://${request.headers.host || '127.0.0.1:47832'}`);
        if (requestUrl.pathname !== '/auth/callback') { response.writeHead(404); response.end('Not found'); return; }
        try {
          const result = await callback(requestUrl.toString());
          response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
          response.end('<!doctype html><title>Nexar Bots</title><p>Sign-in complete. You can close this window.</p>');
          void result;
        } catch (error) {
          response.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' });
          response.end('Sign-in failed. You can close this window.');
          try { onEvent && onEvent({ type: 'auth:error', message: errorMessage(error) }); } catch (_) {}
        }
      });
      server.once('error', reject);
      server.listen(47832, '127.0.0.1', () => { callbackServer = server; resolve(); });
    });
  }

  async function invoke(action, payload = {}) {
    if (action === 'auth:status') {
      if (!configured) return { configured: false, signedIn: false, message: 'Cloud credentials are missing' };
      try { await currentSession(); } catch (error) { return { configured: true, signedIn: false, message: errorMessage(error) }; }
      return { configured: true, signedIn: Boolean(session), ...(session?.user?.email ? { email: session.user.email } : {}) };
    }
    requireClient();
    if (action === 'auth:signup') {
      if (typeof payload.email !== 'string' || typeof payload.password !== 'string') throw makeError('email and password are required', 'INVALID_AUTH');
      const { data, error } = await supabase.auth.signUp({ email: payload.email, password: payload.password });
      if (error) throw error;
      session = data.session;
      return { signedIn: Boolean(session), ...(session ? { email: session.user.email } : {}), ...(session ? {} : { message: 'Check your email to confirm your account.' }) };
    }
    if (action === 'auth:signin') {
      const { data, error } = await supabase.auth.signInWithPassword({ email: payload.email, password: payload.password });
      if (error) throw error;
      session = data.session;
      return { signedIn: true, email: session.user.email };
    }
    if (action === 'auth:signout') {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      session = null;
      return { signedIn: false };
    }
    if (action === 'auth:github') {
      const response = await fetch(`${url}/auth/v1/settings`, { headers: { apikey: anonKey }, signal: AbortSignal.timeout(10000) });
      if (!response.ok || !(await response.json()).external?.github) throw makeError('GitHub-Anmeldung ist im Supabase-Projekt noch nicht aktiviert. Die GitHub-App muss zuerst eingerichtet werden.', 'GITHUB_NOT_CONFIGURED');
      expectedState = crypto.randomBytes(24).toString('base64url');
      await startOAuthServer();
      const redirectTo = `${callbackUrl}?state=${encodeURIComponent(expectedState)}`;
      const { data, error } = await supabase.auth.signInWithOAuth({ provider: 'github', options: { redirectTo, skipBrowserRedirect: true } });
      if (error) throw error;
      const target = data?.url;
      if (!target) throw makeError('Supabase did not return an OAuth URL', 'OAUTH_URL_MISSING');
      if (typeof openExternal !== 'function') return { url: target };
      await openExternal(target);
      return { url: target };
    }
    if (action === 'auth:callback') return callback(payload.url);
    if (action === 'cloud:push') {
      await currentSession(); requireSignedIn();
      const settings = sanitizeSettings(payload);
      const { error } = await supabase.from(PROFILE_TABLE).upsert({ id: session.user.id, settings, updated_at: new Date().toISOString() }, { onConflict: 'id' });
      if (error) throw error;
      return settings;
    }
    if (action === 'cloud:pull') return pull();
    throw makeError(`Unknown action: ${action}`, 'UNKNOWN_ACTION');
  }

  // Deliberately no polling timer: the parent can call cloud:pull on its own cadence.
  invoke.close = async () => { if (authSubscription) authSubscription.unsubscribe(); await stopCallbackServer(); };
  return invoke;
}

module.exports = { createCloud, sanitizeSettings, DEFAULT_CALLBACK };
