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
    const req = https.request({ hostname: '127.0.0.1', port: 47831, path: pathname, method,
      rejectUnauthorized: false, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'content-type': 'application/json' } : {}) } }, res => {
      let data = ''; res.setEncoding('utf8'); res.on('data', x => data += x); res.on('end', () => { try { resolve({ status: res.statusCode, body: JSON.parse(data) }); } catch { reject(new Error(data)); } });
    });
    req.on('error', reject); if (body) req.write(JSON.stringify(body)); req.end();
  });
}

test('TLS pairing roundtrip is single-use, revocation works, and cert survives restart', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jarvis-core-'));
  const resourceDir = path.join(__dirname, '..');
  let service = await createService({ dataDir, resourceDir });
  t.after(async () => { await service.close(); });
  await service.invoke('pairing:enable', { host: '127.0.0.1' });
  const invite = JSON.parse(Buffer.from(await service.invoke('pairing:invite'), 'base64url'));
  assert.match(invite.fingerprint, /^[A-F0-9]{64}$/);
  assert.equal(fs.statSync(path.join(dataDir, 'tls-key.pem')).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dataDir, 'tls-cert.pem')).mode & 0o777, 0o600);
  const paired = await request('POST', '/pair', { secret: invite.secret, name: 'test' });
  assert.equal(paired.status, 200); assert.ok(paired.body.token);
  assert.equal((await request('POST', '/pair', { secret: invite.secret })).status, 401);
  assert.equal((await request('GET', '/devices', null, paired.body.token)).body.devices.length, 1);
  const listed = await service.invoke('devices'); assert.equal(listed.length, 1);
  assert.deepEqual(await service.invoke('device:revoke', { id: paired.body.deviceId }), { ok: true, id: paired.body.deviceId });
  assert.equal((await request('GET', '/devices', null, paired.body.token)).status, 401);
  await service.close();
  service = await createService({ dataDir, resourceDir });
  await service.invoke('pairing:enable', { host: '127.0.0.1' });
  const invite2 = JSON.parse(Buffer.from(await service.invoke('pairing:invite'), 'base64url'));
  assert.equal(invite2.fingerprint, invite.fingerprint);
});
