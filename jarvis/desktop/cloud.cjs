'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createClient: defaultCreateClient } = require('@supabase/supabase-js');

const PROFILE_TABLE = 'jarvis_profiles';
const PENDING_FILE = 'cloud-settings-pending.json';
const VOICE_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const ALLOWED_SETTINGS = Object.freeze(['voice', 'weatherCity', 'alwaysOnTop', 'wakeEnabled', 'brainProvider', 'localModel', 'groqModel']);

function makeError(message, code = 'CLOUD_ERROR', cause) {
  const error = new Error(message);
  error.code = code;
  if (cause) error.cause = cause;
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
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw makeError('Settings must be an object', 'INVALID_SETTINGS');
  for (const key of Object.keys(input)) if (!ALLOWED_SETTINGS.includes(key)) throw makeError(`Unknown setting: ${key}`, 'INVALID_SETTINGS');
  const output = {};
  if (input.voice !== undefined) {
    if (typeof input.voice !== 'string' || !VOICE_RE.test(input.voice)) throw makeError('voice must be a valid neural voice name', 'INVALID_SETTINGS');
    output.voice = input.voice;
  }
  if (input.weatherCity !== undefined) {
    if (typeof input.weatherCity !== 'string' || !input.weatherCity.trim() || input.weatherCity.length > 200) throw makeError('weatherCity must be a non-empty string of at most 200 characters', 'INVALID_SETTINGS');
    output.weatherCity = input.weatherCity;
  }
  for (const key of ['alwaysOnTop', 'wakeEnabled']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'boolean') throw makeError(`${key} must be boolean`, 'INVALID_SETTINGS');
      output[key] = input[key];
    }
  }
  if (input.brainProvider !== undefined) {
    if (input.brainProvider !== 'local' && input.brainProvider !== 'groq') throw makeError('brainProvider must be local or groq', 'INVALID_SETTINGS');
    output.brainProvider = input.brainProvider;
  }
  for (const key of ['localModel', 'groqModel']) {
    if (input[key] !== undefined) {
      if (typeof input[key] !== 'string' || !input[key].trim() || input[key].length > 200) throw makeError(`${key} must be a non-empty string of at most 200 characters`, 'INVALID_SETTINGS');
      output[key] = input[key];
    }
  }
  return output;
}

function errorMessage(error) { return error && error.message ? error.message : String(error || 'Unknown error'); }
function sameValue(a, b) { return Object.is(a, b); }

/**
 * Create the desktop cloud bridge. It returns an async invoke(action, payload)
 * function. The optional createClient injection is intentionally supported for
 * deterministic tests; production defaults to @supabase/supabase-js.
 */
function createCloud(options = {}) {
  const { dataDir, onSettings, onEvent } = options;
  const cfg = configValues(options.config);
  const url = cfg.url || cfg.supabaseUrl;
  const anonKey = cfg.anonKey || cfg.anon_key || cfg.publishableKey;
  const configured = Boolean(url && anonKey);
  const sessionPath = dataDir ? path.join(dataDir, 'cloud-session.json') : null;
  const pendingPath = dataDir ? path.join(dataDir, PENDING_FILE) : null;
  const memoryStore = new Map();
  const encrypt = options.encrypt || cfg.encrypt;
  const decrypt = options.decrypt || cfg.decrypt;
  const makeClient = options.createClient || defaultCreateClient;
  let session = null;
  let supabase = null;
  let authSubscription = null;
  let pending = { userId: null, patch: {} };
  let pendingLoadedFor = null;
  let lastSessionUserId = null;
  let operation = Promise.resolve();

  const storage = {
    async getItem(key) {
      if (memoryStore.has(key)) return memoryStore.get(key);
      if (key !== 'supabase.auth.token' || !sessionPath || typeof decrypt !== 'function') return null;
      try {
        const value = await decrypt(await fs.readFile(sessionPath, 'utf8'));
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
      await fs.chmod(sessionPath, 0o600);
    },
    async removeItem(key) {
      memoryStore.delete(key);
      if (key === 'supabase.auth.token' && sessionPath) {
        try { await fs.unlink(sessionPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
    },
  };

  async function readPending() {
    if (!pendingPath) return { userId: null, patch: {} };
    try {
      const parsed = JSON.parse(await fs.readFile(pendingPath, 'utf8'));
      if (!parsed || typeof parsed !== 'object' || typeof parsed.userId !== 'string' || !parsed.patch || typeof parsed.patch !== 'object') return { userId: null, patch: {} };
      return { userId: parsed.userId, patch: sanitizeSettings(parsed.patch) };
    } catch (error) {
      if (error.code === 'ENOENT') return { userId: null, patch: {} };
      throw makeError('Pending settings are malformed', 'INVALID_SETTINGS', error);
    }
  }
  async function writePending() {
    if (!pendingPath) return;
    await fs.mkdir(path.dirname(pendingPath), { recursive: true });
    if (!pending.userId || !Object.keys(pending.patch).length) {
      try { await fs.unlink(pendingPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      return;
    }
    const temporary = `${pendingPath}.${process.pid}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(pending), { mode: 0o600 });
    await fs.chmod(temporary, 0o600);
    await fs.rename(temporary, pendingPath);
    await fs.chmod(pendingPath, 0o600);
  }
  async function loadPending(userId) {
    if (pendingLoadedFor === userId) return;
    const stored = await readPending();
    pending = stored.userId === userId ? stored : { userId, patch: {} };
    pendingLoadedFor = userId;
  }
  function queue(work) {
    const result = operation.then(work, work);
    operation = result.catch(() => {});
    return result;
  }
  function cloudFailure(error) {
    const wrapped = makeError(errorMessage(error), error?.code === 'INVALID_SETTINGS' ? 'INVALID_SETTINGS' : 'CLOUD_SYNC_ERROR', error);
    try { onEvent && onEvent({ type: 'cloud-error', code: wrapped.code, message: wrapped.message }); } catch (_) {}
    return wrapped;
  }

  if (configured) {
    supabase = makeClient(url, anonKey, { auth: { storageKey: 'supabase.auth.token', flowType: 'pkce', autoRefreshToken: true, persistSession: true, detectSessionInUrl: false, storage } });
    const subscription = supabase.auth.onAuthStateChange((event, nextSession) => {
      session = nextSession || null;
      if (session?.user?.id) lastSessionUserId = session.user.id;
      else if (event === 'SIGNED_OUT') lastSessionUserId = null;
      pendingLoadedFor = null;
      try { onEvent && onEvent({ type: 'auth', event, signedIn: Boolean(session), email: session?.user?.email || null }); } catch (_) {}
    });
    authSubscription = subscription.data?.subscription;
  }

  async function currentSession() {
    if (!supabase) return null;
    const result = await supabase.auth.getSession();
    if (result.error) throw result.error;
    session = result.data.session || null;
    if (session?.user?.id) lastSessionUserId = session.user.id;
    return session;
  }
  function requireClient() { if (!supabase) throw makeError('Cloud is not configured', 'NOT_CONFIGURED'); }
  function requireSignedIn() { if (!session?.user?.id) throw makeError('Not signed in', 'NOT_SIGNED_IN'); }
  async function remoteSettings() {
    const { data, error } = await supabase.from(PROFILE_TABLE).select('settings').eq('id', session.user.id).maybeSingle();
    if (error) throw error;
    return sanitizeSettings(data?.settings || {});
  }
  function rpcSettings(data) {
    const value = Array.isArray(data) ? data[0] : data;
    return sanitizeSettings(value && value.settings ? value.settings : value || {});
  }
  async function mergeRemote(patch) {
    const { data, error } = await supabase.rpc('jarvis_merge_settings', { p_patch: patch });
    if (error) throw error;
    return rpcSettings(data);
  }
  async function applyPull() {
    await currentSession(); requireSignedIn();
    await loadPending(session.user.id);
    const snapshot = { ...pending.patch };
    if (Object.keys(snapshot).length) {
      const merged = await mergeRemote(snapshot);
      for (const [key, value] of Object.entries(snapshot)) if (sameValue(pending.patch[key], value)) delete pending.patch[key];
      await writePending();
      if (onSettings) await onSettings(merged);
      return merged;
    }
    const merged = await remoteSettings();
    if (onSettings) await onSettings(merged);
    return merged;
  }
  async function push(payload) {
    const patch = sanitizeSettings(payload);
    try { await currentSession(); } catch (error) {
      if (lastSessionUserId && isRetryableSessionError(error)) {
        await loadPending(lastSessionUserId);
        pending.userId = lastSessionUserId;
        pending.patch = { ...pending.patch, ...patch };
        await writePending();
      }
      throw cloudFailure(error);
    }
    requireSignedIn();
    await loadPending(session.user.id);
    pending.patch = { ...pending.patch, ...patch };
    pending.userId = session.user.id;
    await writePending();
    const snapshot = { ...pending.patch };
    try {
      const merged = await mergeRemote(snapshot);
      for (const [key, value] of Object.entries(snapshot)) if (sameValue(pending.patch[key], value)) delete pending.patch[key];
      await writePending();
      return merged;
    } catch (error) { throw cloudFailure(error); }
  }
  function isRetryableSessionError(error) {
    if (!error) return false;
    const status = Number(error.status || error.statusCode || 0);
    const code = `${error.code || ''} ${error.name || ''} ${error.message || ''}`.toLowerCase();
    if (code.includes('invalid') || code.includes('jwt') || code.includes('signed out') || code.includes('session not found')) return false;
    return !status || status >= 500 || ['network', 'fetch', 'abort', 'timeout', 'retryable'].some((part) => code.includes(part));
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
      session = data.session || null;
      return { signedIn: Boolean(session), ...(session ? { email: session.user.email } : { message: 'Check your email to confirm your account.' }) };
    }
    if (action === 'auth:signin') {
      const { data, error } = await supabase.auth.signInWithPassword({ email: payload.email, password: payload.password });
      if (error) throw error;
      session = data.session || null;
      if (!session) throw makeError('Sign-in did not create a session', 'AUTH_NO_SESSION');
      return { signedIn: true, email: session.user.email };
    }
    if (action === 'auth:signout') {
      const { error } = await supabase.auth.signOut();
      if (error) throw error;
      session = null; lastSessionUserId = null; pendingLoadedFor = null; pending = { userId: null, patch: {} };
      return { signedIn: false };
    }
    if (action === 'cloud:push') return queue(() => push(payload));
    if (action === 'cloud:pull') return queue(() => applyPull().catch((error) => { throw cloudFailure(error); }));
    throw makeError(`Unknown action: ${action}`, 'UNKNOWN_ACTION');
  }

  invoke.close = async () => { if (authSubscription) authSubscription.unsubscribe(); await operation; };
  return invoke;
}

module.exports = { createCloud, sanitizeSettings, ALLOWED_SETTINGS, PENDING_FILE };
