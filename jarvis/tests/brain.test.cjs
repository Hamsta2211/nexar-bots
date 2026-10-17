'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const http = require('node:http');
const { createBrain } = require('../core/brain.cjs');

async function temp() { return fs.mkdtemp(`${os.tmpdir()}/jarvis-brain-`); }
function mockFetch(routes) {
  return async (url, options = {}) => {
    const u = new URL(url); const route = routes[`${options.method || 'GET'} ${u.pathname}`];
    if (!route) return new Response('{}', { status: 404 });
    return route(url, options);
  };
}

test('local status, models and chat contract', async () => {
  const dir = await temp(); const calls = [];
  const fetchImpl = mockFetch({
    'GET /api/tags': async () => new Response(JSON.stringify({ models: [{ name: 'tiny', model: 'tiny:latest' }] }), { status: 200 }),
    'POST /api/chat': async (_u, o) => { calls.push(JSON.parse(o.body)); return new Response(JSON.stringify({ message: { content: 'Hallo aus Ollama' } }), { status: 200 }); }
  });
  const brain = await createBrain({ dataDir: dir, fetchImpl });
  assert.deepEqual(await brain.invoke('brain:status'), { provider: 'local', localUrl: 'http://127.0.0.1:11434', localModel: 'llama3.2', groqModel: 'llama-3.1-8b-instant', hasGroqKey: false, keyStorage: 'empty', busy: false });
  assert.deepEqual(await brain.invoke('brain:models'), [{ id: 'tiny', name: 'tiny' }]);
  const answer = await brain.invoke('brain:ask', { text: 'Sag Hallo' });
  assert.equal(answer.text, 'Hallo aus Ollama'); assert.equal(answer.model, 'llama3.2'); assert.equal(calls[0].stream, false); assert.equal(calls[0].options.num_predict, 1000);
  await brain.close();
});

test('Groq key is encrypted and never exposed in persisted config/status', async () => {
  const dir = await temp(); const secret = 'test-key-123456';
  const encrypt = async value => Buffer.from(value).toString('base64'); const decrypt = async value => Buffer.from(String(value), 'base64').toString();
  const brain = await createBrain({ dataDir: dir, encrypt, decrypt, fetchImpl: mockFetch({}) });
  const status = await brain.invoke('brain:configure', { provider: 'groq', groqApiKey: secret, groqModel: 'm' });
  assert.equal(status.keyStorage, 'encrypted'); assert.equal(status.hasGroqKey, true); assert.equal(JSON.stringify(status).includes(secret), false);
  assert.equal((await fs.readFile(`${dir}/brain.json`, 'utf8')).includes(secret), false);
  assert.equal((await fs.readFile(`${dir}/brain-key.enc`, 'utf8')).includes(secret), false);
  await brain.close();
  const reopened = await createBrain({ dataDir: dir, encrypt, decrypt, fetchImpl: mockFetch({ 'GET /openai/v1/models': async (_u, o) => { assert.equal(o.headers.authorization, `Bearer ${secret}`); return new Response(JSON.stringify({ data: [{ id: 'm' }] }) ); } }) });
  assert.deepEqual(await reopened.invoke('brain:models'), [{ id: 'm', name: 'm' }]); await reopened.close();
});

test('memory key is explicitly marked, blank key ignored, and clear removes it', async () => {
  const dir = await temp(); const brain = await createBrain({ dataDir: dir, fetchImpl: mockFetch({}) });
  let s = await brain.invoke('brain:configure', { groqApiKey: 'short' }).catch(e => e);
  assert.match(s.message, /Länge/);
  s = await brain.invoke('brain:configure', { groqApiKey: 'memory-key-123' }); assert.equal(s.keyStorage, 'memory');
  s = await brain.invoke('brain:configure', { groqApiKey: '' }); assert.equal(s.hasGroqKey, true);
  s = await brain.invoke('brain:configure', { clearGroqKey: true }); assert.equal(s.keyStorage, 'empty'); await brain.close();
});

test('rejects unsafe URLs and handles a real local HTTP server', async () => {
  const unsafeDir = await temp();
  await assert.rejects(() => createBrain({ dataDir: unsafeDir, fetchImpl: fetch }).then(b => b.invoke('brain:configure', { localUrl: 'http://example.com' })), /öffentliches HTTP/);
  const server = http.createServer((req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(req.url === '/api/tags' ? { models: [] } : { message: { content: 'ok' } })); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); const port = server.address().port;
  const brain = await createBrain({ dataDir: await temp(), fetchImpl: fetch }); await brain.invoke('brain:configure', { localUrl: `http://127.0.0.1:${port}` }); assert.deepEqual(await brain.invoke('brain:models'), []); await brain.close(); await new Promise(resolve => server.close(resolve));
});

test('cancel does not add a cancelled answer to history', async () => {
  const dir = await temp(); let resolveFetch;
  const fetchImpl = async (_u, { signal }) => await new Promise((resolve, reject) => { resolveFetch = () => resolve(new Response(JSON.stringify({ message: { content: 'late' } }))); signal.addEventListener('abort', () => reject(Object.assign(new Error('abort'), { name: 'AbortError' }))); });
  const brain = await createBrain({ dataDir: dir, fetchImpl }); const pending = brain.invoke('brain:ask', { text: 'cancel me' }); await new Promise(r => setTimeout(r, 10)); await brain.invoke('brain:cancel'); await assert.rejects(pending, /abgebrochen/); resolveFetch?.(); assert.equal((await brain.invoke('brain:status')).busy, false); await brain.close();
});
