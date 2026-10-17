'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCloud, PENDING_FILE } = require('../desktop/cloud.cjs');

function mockFactory({ userId = 'user-a', email = 'a@example.com', session = true, rows = {}, delay = 0 } = {}) {
  const state = { userId, email, session: session ? { user: { id: userId, email } } : null, rows, delay, authListeners: [], upserts: [], rpcs: [] };
  function client() {
    return {
      auth: {
        onAuthStateChange(event, next) { state.authListeners.push((event, next) => {}); return { data: { subscription: { unsubscribe() {} } } }; },
        async getSession() { return { data: { session: state.session }, error: null }; },
        async signUp() { return { data: { session: null }, error: null }; },
        async signInWithPassword() { return { data: { session: state.session }, error: null }; },
        async signOut() { state.session = null; return { error: null }; },
      },
      from() {
        let id;
        return {
          select() { return this; },
          eq(_key, value) { id = value; return this; },
          async maybeSingle() {
            if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
            return { data: state.rows[id] ? { settings: state.rows[id].settings } : null, error: null };
          },
          async upsert(row) {
            if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
            state.upserts.push(row);
            state.rows[row.id] = { settings: row.settings };
            return { data: null, error: null };
          },
        };
      },
      async rpc(name, args) {
        if (name !== 'jarvis_merge_settings') throw new Error('unexpected RPC');
        if (state.delay) await new Promise(resolve => setTimeout(resolve, state.delay));
        if (!state.rows) return { data: null, error: new Error('offline') };
        const id = state.userId;
        const current = state.rows[id]?.settings || {};
        const merged = { ...current, ...args.p_patch };
        state.rpcs.push({ name, args });
        state.rows[id] = { settings: merged };
        return { data: merged, error: null };
      },
    };
  }
  client.state = state;
  return client;
}
function makeCloud(factory, dataDir, extra = {}) {
  return createCloud({ dataDir, config: { url: 'https://example.supabase.co', anonKey: 'public' }, createClient: factory, ...extra });
}
async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-cloud-')); }

test('allowlist rejects deviceId and GitHub OAuth is absent', async () => {
  const dir = await tempDir();
  const cloud = makeCloud(mockFactory(), dir);
  await assert.rejects(cloud('cloud:push', { deviceId: 'secret', voice: 'alloy' }), { code: 'INVALID_SETTINGS' });
  await assert.rejects(cloud('auth:github'), { code: 'UNKNOWN_ACTION' });
  await assert.rejects(cloud('auth:callback', { url: 'http://localhost' }), { code: 'UNKNOWN_ACTION' });
  await cloud.close();
});

test('signup does not claim success without a Supabase session', async () => {
  const dir = await tempDir();
  const cloud = makeCloud(mockFactory({ session: false }), dir);
  assert.deepEqual(await cloud('auth:signup', { email: 'new@example.com', password: 'long-password' }), { signedIn: false, message: 'Check your email to confirm your account.' });
  await cloud.close();
});

test('offline dirty settings survive restart and are retried', async () => {
  const dir = await tempDir();
  const factory = mockFactory();
  const cloud = makeCloud(factory, dir);
  // A failed database operation still leaves the patch on disk.
  const original = factory.state.rows;
  factory.state.rows = null;
  await assert.rejects(cloud('cloud:push', { voice: 'nova', alwaysOnTop: true }), { code: 'CLOUD_SYNC_ERROR' });
  const pendingPath = path.join(dir, PENDING_FILE);
  const stat = await fs.stat(pendingPath);
  assert.equal(stat.mode & 0o777, 0o600);
  const saved = JSON.parse(await fs.readFile(pendingPath, 'utf8'));
  assert.deepEqual(saved.patch, { voice: 'nova', alwaysOnTop: true });
  await cloud.close();
  factory.state.rows = original;
  const restarted = makeCloud(factory, dir);
  assert.deepEqual(await restarted('cloud:push', {}), { voice: 'nova', alwaysOnTop: true });
  assert.equal(await fs.access(pendingPath).then(() => true, () => false), false);
  await restarted.close();
});

test('pull never overwrites a dirty local patch', async () => {
  const dir = await tempDir();
  const factory = mockFactory({ rows: { 'user-a': { settings: { voice: 'remote', weatherCity: 'Berlin' } } } });
  const applied = [];
  const cloud = makeCloud(factory, dir, { onSettings: value => applied.push(value) });
  // Make it dirty while remote is unavailable, then restore the remote.
  factory.state.rows = null;
  await assert.rejects(cloud('cloud:push', { voice: 'local' }), { code: 'CLOUD_SYNC_ERROR' });
  factory.state.rows = { 'user-a': { settings: { voice: 'remote', weatherCity: 'Berlin' } } };
  assert.deepEqual(await cloud('cloud:pull'), { voice: 'local', weatherCity: 'Berlin' });
  assert.deepEqual(applied.at(-1), { voice: 'local', weatherCity: 'Berlin' });
  await cloud.close();
});

test('pending settings are isolated by Supabase user id after signout', async () => {
  const dir = await tempDir();
  const factory = mockFactory({ rows: {} });
  const cloud = makeCloud(factory, dir);
  factory.state.rows = null;
  await assert.rejects(cloud('cloud:push', { voice: 'nova' }), { code: 'CLOUD_SYNC_ERROR' });
  await cloud('auth:signout');
  factory.state.session = { user: { id: 'user-b', email: 'b@example.com' } };
  factory.state.rows = { 'user-b': { settings: { voice: 'remote-b' } } };
  assert.deepEqual(await cloud('cloud:pull'), { voice: 'remote-b' });
  await cloud.close();
});

test('malformed remote settings are rejected and not applied', async () => {
  const dir = await tempDir();
  const applied = [];
  const factory = mockFactory({ rows: { 'user-a': { settings: { alwaysOnTop: 'yes' } } } });
  const cloud = makeCloud(factory, dir, { onSettings: value => applied.push(value) });
  await assert.rejects(cloud('cloud:pull'), { code: 'INVALID_SETTINGS' });
  assert.equal(applied.length, 0);
  await cloud.close();
});

test('serialized pushes merge the latest remote and retain concurrent edits', async () => {
  const dir = await tempDir();
  const factory = mockFactory({ rows: { 'user-a': { settings: { weatherCity: 'Paris' } } }, delay: 15 });
  const cloud = makeCloud(factory, dir);
  const first = cloud('cloud:push', { voice: 'nova' });
  const second = cloud('cloud:push', { alwaysOnTop: true });
  await Promise.all([first, second]);
  assert.deepEqual(factory.state.rows['user-a'].settings, { weatherCity: 'Paris', voice: 'nova', alwaysOnTop: true });
  assert.equal(factory.state.upserts.length, 0);
  assert.equal(factory.state.rpcs.length, 2);
  await cloud.close();
});

test('independent instances preserve different concurrent field edits through atomic RPC', async () => {
  const firstDir = await tempDir();
  const secondDir = await tempDir();
  const factory = mockFactory({ rows: { 'user-a': { settings: { weatherCity: 'Paris' } } }, delay: 10 });
  const first = makeCloud(factory, firstDir);
  const second = makeCloud(factory, secondDir);
  await Promise.all([first('cloud:push', { voice: 'nova' }), second('cloud:push', { alwaysOnTop: true })]);
  assert.deepEqual(factory.state.rows['user-a'].settings, { weatherCity: 'Paris', voice: 'nova', alwaysOnTop: true });
  assert.equal(factory.state.upserts.length, 0);
  assert.equal(factory.state.rpcs.length, 2);
  await Promise.all([first.close(), second.close()]);
});
