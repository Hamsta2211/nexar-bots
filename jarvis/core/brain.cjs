'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const dns = require('node:dns').promises;
const net = require('node:net');

const GROQ_BASE = 'https://api.groq.com/openai/v1';
const DEFAULT_LOCAL_URL = 'http://127.0.0.1:11434';
const DEFAULT_LOCAL_MODEL = 'llama3.2';
const DEFAULT_GROQ_MODEL = 'llama-3.1-8b-instant';
const MAX_REPLY = 20000;
const MAX_BODY = 2 * 1024 * 1024;
const SYSTEM = 'Du bist Jarvis. Antworte hilfreich auf Deutsch. Medien, Wetter und andere Aktionen führt die App aus; erfinde keine Ausführungen und erstelle keine Timer, Kalender oder Erinnerungen.';

async function atomicWrite(file, data) {
  await fs.mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`;
  await fs.writeFile(tmp, data, { mode: 0o600 }); await fs.chmod(tmp, 0o600).catch(() => {});
  await fs.rename(tmp, file); await fs.chmod(file, 0o600).catch(() => {});
}
function text(v) { return typeof v === 'string' ? v : ''; }
function fail(message) { const e = new Error(message); e.userMessage = message; return e; }
function publicError(err) {
  if (err && (err.code === 'ABORT_ERR' || err.name === 'AbortError')) return 'Anfrage abgebrochen.';
  if (err && (err.message === 'timeout' || err.code === 'TIMEOUT')) return 'Zeitüberschreitung bei der Anfrage.';
  return err && err.userMessage ? err.userMessage : 'Netzwerkfehler beim KI-Dienst.';
}
function privateIp(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === 'localhost' || h === 'localhost.localdomain') return true;
  if (net.isIPv4(h)) { const p = h.split('.').map(Number); return p[0] === 127 || p[0] === 10 || (p[0] === 172 && p[1] >= 16 && p[1] <= 31) || (p[0] === 192 && p[1] === 168) || (p[0] === 100 && p[1] >= 64 && p[1] <= 127); }
  if (net.isIPv6(h)) return h === '::1' || h.startsWith('fc') || h.startsWith('fd') || h.startsWith('fe80:') || h.startsWith('::ffff:127.');
  return false;
}
async function validateLocalUrl(raw) {
  let u; try { u = new URL(raw || DEFAULT_LOCAL_URL); } catch (_) { throw fail('Ungültige lokale URL.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw fail('Lokale URL muss eine HTTP(S)-Basis-URL ohne Zugangsdaten sein.');
  if (u.protocol === 'http:' && !privateIp(u.hostname)) { let addr; try { addr = (await dns.lookup(u.hostname)).address; } catch (_) { throw fail('Unsicheres öffentliches HTTP ist nicht erlaubt.'); } if (!privateIp(addr)) throw fail('Unsicheres öffentliches HTTP ist nicht erlaubt.'); }
  return u.origin;
}
function cleanConfig(c) {
  return { provider: c && c.provider === 'groq' ? 'groq' : 'local', localUrl: text(c && c.localUrl) || DEFAULT_LOCAL_URL, localModel: text(c && c.localModel) || DEFAULT_LOCAL_MODEL, groqModel: text(c && c.groqModel) || DEFAULT_GROQ_MODEL };
}

async function createBrain({ dataDir, encrypt, decrypt, fetchImpl = globalThis.fetch, onEvent, requestTimeoutMs, timeouts } = {}) {
  if (!dataDir || typeof fetchImpl !== 'function') throw new TypeError('dataDir und fetchImpl sind erforderlich');
  const configFile = path.join(dataDir, 'brain.json'); const keyFile = path.join(dataDir, 'brain-key.enc');
  let config = cleanConfig({}); let key = null; let memoryKey = false;
  try { config = cleanConfig(JSON.parse(await fs.readFile(configFile, 'utf8'))); } catch (_) {}
  if (encrypt && decrypt) { try { const raw = await fs.readFile(keyFile); key = text(await decrypt(raw.toString())); } catch (_) {} }
  else await fs.rm(keyFile, { force: true }).catch(() => {});
  let busy = false, generation = 0, active = null, history = [];
  const limits = { ask: 60000, models: 15000, ...(timeouts || {}) }; if (requestTimeoutMs != null) limits.ask = requestTimeoutMs;
  const emit = (status, extra = {}) => { if (typeof onEvent === 'function') { try { onEvent({ type: 'brain', status, ...extra }); } catch (_) {} } };
  const status = () => ({ provider: config.provider, localUrl: config.localUrl, localModel: config.localModel, groqModel: config.groqModel, hasGroqKey: !!key, keyStorage: key ? (memoryKey ? 'memory' : 'encrypted') : 'empty', busy });
  async function saveConfig() { await atomicWrite(configFile, JSON.stringify(config, null, 2) + '\n'); }
  async function saveKey(value) {
    if (!value) { key = null; memoryKey = false; await fs.rm(keyFile, { force: true }); return; }
    if (!(encrypt && decrypt)) { await fs.rm(keyFile, { force: true }); key = value; memoryKey = true; return; }
    let enc; try { enc = await encrypt(value); } catch (_) { enc = null; }
    if (enc == null) { await fs.rm(keyFile, { force: true }); key = value; memoryKey = true; return; }
    await atomicWrite(keyFile, Buffer.isBuffer(enc) ? enc : String(enc)); key = value; memoryKey = false;
  }
  async function readBody(res, signal) {
    if (res.body && typeof res.body.getReader === 'function') {
      const reader = res.body.getReader(); const chunks = []; let total = 0;
      try { while (true) { if (signal.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' }); const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > MAX_BODY) throw fail('Antwort vom KI-Dienst ist zu groß (maximal 2 MiB).'); chunks.push(Buffer.from(value)); } return Buffer.concat(chunks).toString('utf8'); } finally { if (signal.aborted) await reader.cancel().catch(() => {}); }
    }
    if (typeof res.arrayBuffer === 'function') { const b = Buffer.from(await res.arrayBuffer()); if (b.length > MAX_BODY) throw fail('Antwort vom KI-Dienst ist zu groß (maximal 2 MiB).'); return b.toString('utf8'); }
    if (typeof res.text === 'function') { const s = await res.text(); if (Buffer.byteLength(s) > MAX_BODY) throw fail('Antwort vom KI-Dienst ist zu groß (maximal 2 MiB).'); return s; }
    return null;
  }
  async function request(url, options, timeout) {
    const c = new AbortController(); const external = options && options.signal; const abort = r => { if (!c.signal.aborted) c.abort(r); };
    if (external) { if (external.aborted) abort(external.reason || 'aborted'); else external.addEventListener('abort', () => abort(external.reason || 'aborted'), { once: true }); }
    const timer = setTimeout(() => abort('timeout'), timeout); let res;
    const abortWait = new Promise((_, reject) => c.signal.addEventListener('abort', () => { const e = new Error(c.signal.reason === 'timeout' ? 'timeout' : 'aborted'); e.code = c.signal.reason === 'timeout' ? 'TIMEOUT' : 'ABORT_ERR'; reject(e); }, { once: true })); abortWait.catch(() => {});
    const untilAbort = promise => Promise.race([promise, abortWait]);
    try { res = await fetchImpl(url, { ...options, signal: c.signal, redirect: 'error', redirects: 'error' }); const body = await untilAbort(readBody(res, c.signal)); let data;
      if (body == null && res.status < 400 && typeof res.json === 'function') data = await untilAbort(res.json());
      return { response: res, body, data }; }
    catch (e) { if (c.signal.aborted) { const x = new Error(c.signal.reason === 'timeout' ? 'timeout' : 'aborted'); x.code = c.signal.reason === 'timeout' ? 'TIMEOUT' : 'ABORT_ERR'; throw x; } throw e; }
    finally { clearTimeout(timer); }
  }
  function jsonBody(result) { if (result.data !== undefined) return Promise.resolve(result.data); if (result.body == null) return result.response.json(); try { return Promise.resolve(JSON.parse(result.body)); } catch (_) { throw fail('Ungültige Antwort vom KI-Dienst.'); } }
  function httpError(kind, status) { if (status === 401 || status === 403) return fail(`${kind}-Authentifizierung fehlgeschlagen.`); if (status === 404) return fail(kind === 'Groq' ? 'Groq-Modell wurde nicht gefunden.' : 'Lokales Modell ist nicht installiert.'); if (status === 429) return fail(`${kind} ist derzeit überlastet (zu viele Anfragen).`); return fail(`${kind} antwortete mit HTTP ${status}.`); }
  async function models(provider) {
    if (provider !== undefined && !['local', 'groq'].includes(provider)) throw fail('Ungültiger Anbieter.'); provider = provider || config.provider;
    if (provider === 'local') { const base = await validateLocalUrl(config.localUrl); let x; try { x = await request(`${base}/api/tags`, { headers: { accept: 'application/json' } }, limits.models); } catch (e) { throw fail(publicError(e)); } if (!x.response.ok) throw httpError('Lokaler Dienst', x.response.status); const j = await jsonBody(x); return Array.isArray(j.models) ? j.models.filter(v => v && typeof v.name === 'string').map(v => ({ id: v.name, name: v.name })) : []; }
    if (!key) throw fail('Für Groq ist ein API-Schlüssel erforderlich.'); let x; try { x = await request(`${GROQ_BASE}/models`, { headers: { authorization: `Bearer ${key}`, accept: 'application/json' } }, limits.models); } catch (e) { throw fail(publicError(e)); } if (!x.response.ok) throw httpError('Groq', x.response.status); const j = await jsonBody(x); const audio = /whisper|tts|orpheus|playai/i; return Array.isArray(j.data) ? j.data.filter(v => v && typeof v.id === 'string' && !audio.test(v.id)).map(v => ({ id: v.id, name: v.id })) : [];
  }
  async function ask(payload) {
    const prompt = text(payload && payload.text); const bytes = Buffer.byteLength(prompt, 'utf8'); if (!prompt.trim() || bytes < 1 || bytes > 8000) throw fail('Text muss zwischen 1 und 8000 UTF-8-Bytes lang sein.');
    if (busy) throw fail('Eine Anfrage läuft bereits.'); const myGeneration = generation; const snapshot = { ...config, key }; const myController = new AbortController(); active = { controller: myController, generation: myGeneration }; busy = true; emit('thinking');
    try {
      const messages = [{ role: 'system', content: SYSTEM }, ...history, { role: 'user', content: prompt }]; let x, answer, model;
      if (snapshot.provider === 'local') { const base = await validateLocalUrl(snapshot.localUrl); model = snapshot.localModel; x = await request(`${base}/api/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model, messages, stream: false, options: { num_predict: 1000 } }), signal: myController.signal }, limits.ask); if (!x.response.ok) throw httpError('Lokaler Dienst', x.response.status); const j = await jsonBody(x); answer = j && j.message && j.message.content; }
      else { if (!snapshot.key) throw fail('Für Groq ist ein API-Schlüssel erforderlich.'); model = snapshot.groqModel; x = await request(`${GROQ_BASE}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${snapshot.key}` }, body: JSON.stringify({ model, messages, max_completion_tokens: 1000, temperature: 0.2 }), signal: myController.signal }, limits.ask); if (!x.response.ok) throw httpError('Groq', x.response.status); const j = await jsonBody(x); answer = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content; }
      if (myGeneration !== generation) throw fail('Anfrage abgebrochen.'); answer = text(answer); if (!answer) throw fail('Der KI-Dienst lieferte keine Antwort.'); answer = answer.slice(0, MAX_REPLY); history.push({ role: 'user', content: prompt }, { role: 'assistant', content: answer }); history = history.slice(-12); emit('idle'); return { text: answer, provider: snapshot.provider, model };
    } catch (e) { if (myGeneration === generation) { emit('error'); throw (e.userMessage ? e : fail(publicError(e))); } throw fail('Anfrage abgebrochen.'); }
    finally { if (active && active.controller === myController) { active = null; busy = false; } }
  }
  async function invoke(action, payload = {}) {
    if (action === 'brain:status') return status(); if (action === 'brain:models') return models(payload.provider); if (action === 'brain:ask') return ask(payload);
    if (action === 'brain:cancel' || action === 'brain:reset') { generation++; if (active) active.controller.abort(); busy = false; active = null; if (action === 'brain:reset') history = []; emit('idle'); return action === 'brain:reset' ? { reset: true } : { cancelled: true }; }
    if (action === 'brain:configure') {
      const p = payload || {}; const allowed = new Set(['provider', 'localUrl', 'localModel', 'groqModel', 'groqApiKey', 'clearGroqKey']); for (const k of Object.keys(p)) if (!allowed.has(k)) throw fail(`Unbekanntes Konfigurationsfeld: ${k}`);
      const next = { ...config }; if (p.provider !== undefined) { if (!['local', 'groq'].includes(p.provider)) throw fail('Ungültiger Anbieter.'); next.provider = p.provider; } if (p.localUrl !== undefined) next.localUrl = await validateLocalUrl(p.localUrl); if (p.localModel !== undefined) { if (!text(p.localModel) || p.localModel.length > 200) throw fail('Ungültiges lokales Modell.'); next.localModel = p.localModel; } if (p.groqModel !== undefined) { if (!text(p.groqModel) || p.groqModel.length > 200) throw fail('Ungültiges Groq-Modell.'); next.groqModel = p.groqModel; }
      if (p.groqApiKey !== undefined) { if (typeof p.groqApiKey !== 'string') throw fail('API-Schlüssel muss eine Zeichenkette sein.'); if (p.groqApiKey !== '' && (p.groqApiKey.length < 10 || p.groqApiKey.length > 1000)) throw fail('API-Schlüssel hat eine ungültige Länge.'); if (p.groqApiKey !== '') await saveKey(p.groqApiKey); }
      if (p.clearGroqKey === true) await saveKey(null); const changed = JSON.stringify(next) !== JSON.stringify(config); config = next; if (changed || p.groqApiKey !== undefined || p.clearGroqKey) { generation++; if (active) active.controller.abort(); busy = false; active = null; history = []; await saveConfig(); } emit('configured', status()); return status();
    }
    throw fail(`Unbekannte Brain-Aktion: ${action}`);
  }
  return { invoke, close: async () => { generation++; if (active) active.controller.abort(); busy = false; active = null; } };
}
module.exports = { createBrain, validateLocalUrl };
