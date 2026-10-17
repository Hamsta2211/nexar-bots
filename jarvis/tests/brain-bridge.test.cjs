'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { createService } = require('../core/service.cjs');

function request(method, pathname, body, token) {
  return new Promise((resolve, reject) => {
    const headers = { ...(token ? { authorization: `Bearer ${token}` } : {}), ...(body !== undefined ? { 'content-type': 'application/json' } : {}) };
    const req = https.request({ hostname: '127.0.0.1', port: 47831, path: pathname, method, rejectUnauthorized: false, headers }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', x => data += x);
      res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch (e) { reject(e); } });
    });
    req.on('error', reject); if (body !== undefined) req.write(JSON.stringify(body)); req.end();
  });
}

async function pairedService(t, brainInvoke) {
  const service = await createService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-brain-')), resourceDir: path.join(__dirname, '..'), brainInvoke });
  t.after(() => service.close());
  await service.invoke('pairing:enable', { host: '127.0.0.1' });
  const invite = JSON.parse(Buffer.from(await service.invoke('pairing:invite'), 'base64url'));
  const paired = await request('POST', '/pair', { secret: invite.secret, name: 'brain-test' });
  assert.equal(paired.status, 200);
  return { service, token: paired.body.token };
}

test('brain invoke actions delegate and absent injection has the documented error', async t => {
  const calls = [];
  const service = await createService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-brain-invoke-')), resourceDir: path.join(__dirname, '..'), brainInvoke: async (action, payload) => { calls.push([action, payload]); return { action, payload }; } });
  t.after(() => service.close());
  assert.deepEqual(await service.invoke('brain:ask', { text: 'Hallo' }), { action: 'brain:ask', payload: { text: 'Hallo' } });
  assert.deepEqual(await service.invoke('brain:cancel'), { action: 'brain:cancel', payload: {} });
  assert.deepEqual(calls, [['brain:ask', { text: 'Hallo' }], ['brain:cancel', {}]]);
  const missing = await createService({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-brain-missing-')), resourceDir: path.join(__dirname, '..') });
  t.after(() => missing.close());
  await assert.rejects(() => missing.invoke('brain:status'), /Jarvis-Modelle nicht eingerichtet/);
});

test('brain HTTPS routes require pairing auth, redact public status, and delegate ask/cancel', { concurrency: false }, async t => {
  const calls = [];
  const { token } = await pairedService(t, async (action, payload) => {
    calls.push([action, payload]);
    if (action === 'brain:status') return { ready: true, publicConfig: { provider: 'local', apiKey: 'must-not-leak' } };
    return { ok: true, action };
  });
  assert.equal((await request('POST', '/brain/ask', { text: 'secret' })).status, 401);
  assert.equal((await request('GET', '/brain')).status, 401);
  const status = await request('GET', '/brain', undefined, token);
  assert.equal(status.status, 200); assert.equal(status.body.publicConfig.apiKey, undefined);
  assert.deepEqual((await request('POST', '/brain/ask', { text: 'Hallo' }, token)).body, { ok: true, action: 'brain:ask' });
  assert.deepEqual((await request('POST', '/brain/cancel', {}, token)).body, { ok: true, action: 'brain:cancel' });
  assert.deepEqual(calls.slice(-2), [['brain:ask', { text: 'Hallo' }], ['brain:cancel', {}]]);
});

test('brain configure rejects API keys and unknown remote fields', { concurrency: false }, async t => {
  const { token } = await pairedService(t, async (action, payload) => ({ action, payload }));
  const key = await request('PUT', '/brain', { provider: 'groq', apiKey: 'do-not-accept' }, token);
  assert.equal(key.status, 400); assert.match(key.body.error, /unknown brain fields/);
  const endpoint = await request('PUT', '/brain', { endpoint: 'http://lan-host' }, token);
  assert.equal(endpoint.status, 400);
  const ok = await request('PUT', '/brain', { provider: 'local', localModel: 'tiny' }, token);
  assert.equal(ok.status, 200); assert.deepEqual(ok.body.payload, { provider: 'local', localModel: 'tiny' });
});
