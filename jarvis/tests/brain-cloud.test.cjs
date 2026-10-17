'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { createCloud, sanitizeSettings } = require('../desktop/cloud.cjs');

async function tempDir() { return fs.mkdtemp(path.join(os.tmpdir(), 'jarvis-brain-cloud-')); }

function mockFactory(settings = {}) {
  const state = { settings: { ...settings }, calls: [] };
  function factory() {
    return {
      auth: {
        onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; },
        async getSession() { return { data: { session: { user: { id: 'user-a', email: 'a@example.com' } } }, error: null }; },
      },
      from() {
        return {
          select() { return this; },
          eq() { return this; },
          async maybeSingle() { return { data: { settings: state.settings }, error: null }; },
        };
      },
      async rpc(name, args) {
        state.calls.push({ name, args });
        state.settings = { ...state.settings, ...args.p_patch };
        return { data: state.settings, error: null };
      },
    };
  }
  factory.state = state;
  return factory;
}

function makeCloud(factory, dataDir) {
  return createCloud({ dataDir, config: { url: 'https://example.supabase.co', anonKey: 'public' }, createClient: factory });
}

test('sanitizeSettings accepts optional brain settings and retains the four existing settings', () => {
  assert.deepEqual(sanitizeSettings({
    voice: 'nova', weatherCity: 'Berlin', alwaysOnTop: true, wakeEnabled: false,
    brainProvider: 'groq', localModel: 'llama3.2:3b', groqModel: 'llama-3.1-8b-instant',
  }), {
    voice: 'nova', weatherCity: 'Berlin', alwaysOnTop: true, wakeEnabled: false,
    brainProvider: 'groq', localModel: 'llama3.2:3b', groqModel: 'llama-3.1-8b-instant',
  });
});

test('sanitizeSettings rejects invalid brain values and secrets or URLs', () => {
  for (const patch of [
    { brainProvider: 'openai' }, { brainProvider: '' }, { localModel: '' },
    { groqModel: 'x'.repeat(201) }, { localModel: 42 },
    { apiKey: 'secret', brainProvider: 'local' }, { groqApiKey: 'secret' },
    { localUrl: 'http://127.0.0.1:11434', brainProvider: 'local' },
    { groqUrl: 'https://api.groq.com', brainProvider: 'groq' },
  ]) assert.throws(() => sanitizeSettings(patch), { code: 'INVALID_SETTINGS' });
  assert.throws(() => sanitizeSettings({ unexpected: true }), { code: 'INVALID_SETTINGS' });
});

test('cloud partial brain merge preserves existing remote fields', async () => {
  const factory = mockFactory({ voice: 'nova', weatherCity: 'Paris', brainProvider: 'local', localModel: 'old-model', groqModel: 'old-groq' });
  const cloud = makeCloud(factory, await tempDir());
  const merged = await cloud('cloud:push', { brainProvider: 'groq', groqModel: 'new-groq' });
  assert.deepEqual(merged, {
    voice: 'nova', weatherCity: 'Paris', brainProvider: 'groq', localModel: 'old-model', groqModel: 'new-groq',
  });
  assert.deepEqual(factory.state.settings, merged);
  assert.deepEqual(factory.state.calls[0].args.p_patch, { brainProvider: 'groq', groqModel: 'new-groq' });
  await cloud.close();
});
