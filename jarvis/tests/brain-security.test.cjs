'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { createBrain } = require('../core/brain.cjs');

const GROQ = 'https://api.groq.com/openai/v1';
async function temp() { return fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-brain-security-')); }
function routeFetch(routes) {
  return async (url, options = {}) => {
    const u = new URL(url);
    const route = routes[`${options.method || 'GET'} ${u.pathname}`];
    if (!route) return new Response('{}', { status: 404 });
    return route(url, options);
  };
}
function keyCrypto() {
  const key = crypto.createHash('sha256').update('synthetic-test-key').digest();
  return {
    encrypt: async value => {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
      const body = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
      return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64');
    },
    decrypt: async raw => {
      const b = Buffer.from(raw, 'base64'); const decipher = crypto.createDecipheriv('aes-256-gcm', key, b.subarray(0, 12));
      decipher.setAuthTag(b.subarray(12, 28));
      return Buffer.concat([decipher.update(b.subarray(28)), decipher.final()]).toString('utf8');
    },
  };
}

 test('Groq uses AbortSignal, aborts on brain:cancel, and sends only max_completion_tokens', async () => {
  const dir = await temp(); let observed; let resolveFetch;
  const fetchImpl = routeFetch({
    'POST /openai/v1/chat/completions': async (_url, options) => {
      observed = options;
      return new Promise((resolve, reject) => {
        resolveFetch = () => resolve(new Response(JSON.stringify({ choices: [{ message: { content: 'late' } }] })));
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
      });
    },
  });
  const events = []; const brain = await createBrain({ dataDir: dir, fetchImpl, onEvent: e => events.push(e) });
  await brain.invoke('brain:configure', { provider: 'groq', groqApiKey: 'synthetic-key-123' });
  const pending = brain.invoke('brain:ask', { text: '  UTF-8 ä  ' });
  for (let i = 0; i < 20 && !observed; i++) await new Promise(r => setTimeout(r, 2));
  assert.ok(observed && observed.signal instanceof AbortSignal);
  const body = JSON.parse(observed.body);
  assert.equal(body.max_completion_tokens, 1000); assert.equal('max_tokens' in body, false);
  await brain.invoke('brain:cancel');
  await assert.rejects(pending, /abgebrochen|aborted/i);
  assert.ok(events.some(e => e.status === 'thinking') && events.some(e => e.status === 'idle'));
  assert.equal(typeof resolveFetch, 'function');
  await brain.close();
});

test('prompt validation rejects whitespace-only and enforces UTF-8 byte limit', async () => {
  const brain = await createBrain({ dataDir: await temp(), fetchImpl: routeFetch({}) });
  await assert.rejects(brain.invoke('brain:ask', { text: ' \n\t ' }), /zwischen 1 und 8000/);
  await assert.rejects(brain.invoke('brain:ask', { text: 'ä'.repeat(4001) }), /zwischen 1 und 8000/);
  await brain.close();
});

test('configuration rejects non-string API keys, unknown fields, and unsupported providers', async () => {
  const brain = await createBrain({ dataDir: await temp(), fetchImpl: routeFetch({}) });
  await assert.rejects(brain.invoke('brain:configure', { groqApiKey: 123 }), /Zeichenkette/);
  await assert.rejects(brain.invoke('brain:configure', { unexpected: true }), /Unbekanntes Konfigurationsfeld/);
  await assert.rejects(brain.invoke('brain:configure', { provider: 'openai' }), /Ungültiger Anbieter/);
  await assert.rejects(brain.invoke('brain:models', { provider: 'openai' }), /Ungültiger Anbieter/);
  await brain.close();
});

test('Groq model catalog filters audio-only models while preserving chat IDs', async () => {
  const brain = await createBrain({ dataDir: await temp(), fetchImpl: routeFetch({
    'GET /openai/v1/models': async (_u, o) => {
      assert.equal(o.headers.authorization, 'Bearer synthetic-key-123');
      return new Response(JSON.stringify({ data: [{ id: 'llama-chat' }, { id: 'whisper-large' }, { id: 'orpheus-alpha' }, { id: 'tts-1' }, { id: 'playai-voice' }, { id: 'mixtral-chat' }] }));
    },
  }) });
  await brain.invoke('brain:configure', { provider: 'groq', groqApiKey: 'synthetic-key-123' });
  assert.deepEqual(await brain.invoke('brain:models'), [{ id: 'llama-chat', name: 'llama-chat' }, { id: 'mixtral-chat', name: 'mixtral-chat' }]);
  await brain.close();
});

test('encrypt null or throw keeps key memory-only, removes stale cipher, and reloads without key', async t => {
  for (const mode of ['null', 'throw']) await t.test(mode, async () => {
    const dir = await temp(); const keyFile = path.join(dir, 'brain-key.enc');
    await fs.writeFile(keyFile, 'old-ciphertext');
    const encrypt = mode === 'null' ? async () => null : async () => { throw new Error('keychain unavailable'); };
    const brain = await createBrain({ dataDir: dir, encrypt, decrypt: async () => null, fetchImpl: routeFetch({}) });
    const status = await brain.invoke('brain:configure', { groqApiKey: 'synthetic-key-123' });
    assert.equal(status.keyStorage, 'memory'); assert.equal(status.hasGroqKey, true);
    await assert.rejects(fs.access(keyFile));
    const config = await fs.readFile(path.join(dir, 'brain.json'), 'utf8');
    assert.equal(config.includes('synthetic-key-123'), false);
    await brain.close();
    const reopened = await createBrain({ dataDir: dir, encrypt, decrypt: async () => { throw new Error('no persisted key'); }, fetchImpl: routeFetch({}) });
    assert.equal((await reopened.invoke('brain:status')).hasGroqKey, false);
    await reopened.close();
  });
});

test('AES-GCM persistence contains no cleartext and reopens with the synthetic key', async () => {
  const dir = await temp(); const c = keyCrypto();
  const first = await createBrain({ dataDir: dir, ...c, fetchImpl: routeFetch({
    'GET /openai/v1/models': async (_u, o) => { assert.equal(o.headers.authorization, 'Bearer synthetic-key-123'); return new Response(JSON.stringify({ data: [{ id: 'chat-id' }] })); },
  }) });
  await first.invoke('brain:configure', { provider: 'groq', groqApiKey: 'synthetic-key-123' });
  const cipher = await fs.readFile(path.join(dir, 'brain-key.enc')); assert.equal(cipher.includes('synthetic-key-123'), false);
  await first.close();
  const second = await createBrain({ dataDir: dir, ...c, fetchImpl: routeFetch({ 'GET /openai/v1/models': async () => new Response(JSON.stringify({ data: [{ id: 'chat-id' }] })) }) });
  assert.deepEqual(await second.invoke('brain:models'), [{ id: 'chat-id', name: 'chat-id' }]);
  await second.close();
});

test('requests set redirect error options and reject response bodies over 2 MiB', async () => {
  const dir = await temp(); let opts;
  const brain = await createBrain({ dataDir: dir, fetchImpl: routeFetch({
    'GET /api/tags': async (_u, o) => { opts = o; return new Response('x'.repeat(2 * 1024 * 1024 + 1)); },
  }) });
  await assert.rejects(brain.invoke('brain:models'), /2 MiB/);
  assert.equal(opts.redirect, 'error'); assert.equal(opts.redirects, 'error');
  await brain.close();
});

test('injected request timeout aborts a chunked delayed JSON response end-to-end', async () => {
  const server = http.createServer((req, res) => {
    if (req.url !== '/api/chat') return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': 'application/json', connection: 'close' }); res.write('{"message":');
    setTimeout(() => res.end('{"content":"too late"}}'), 150);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const brain = await createBrain({ dataDir: await temp(), requestTimeoutMs: 35, fetchImpl: globalThis.fetch });
    await brain.invoke('brain:configure', { localUrl: base });
    await assert.rejects(brain.invoke('brain:ask', { text: 'timeout fixture' }), /Zeitüberschreitung/);
    await brain.close();
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('configured events are useful but never contain the API key', async () => {
  const events = []; const brain = await createBrain({ dataDir: await temp(), onEvent: e => events.push(e), fetchImpl: routeFetch({}) });
  await brain.invoke('brain:configure', { provider: 'groq', groqApiKey: 'synthetic-key-123' });
  assert.ok(events.some(e => e.status === 'configured'));
  assert.equal(JSON.stringify(events).includes('synthetic-key-123'), false);
  await brain.close();
});
