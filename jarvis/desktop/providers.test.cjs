'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ProviderStateController, voiceActionScript } = require('./providers.cjs');

function harness() {
  const events = []; const timers = []; let loads = 0;
  const controller = new ProviderStateController({ emit: e => events.push(e), schedule: fn => { timers.push(fn); return fn; }, cancel: () => {} });
  return { controller, events, timers, loads: () => loads, load: async () => { loads += 1; }, flush: async () => { const fn = timers.shift(); if (fn) await fn(); } };
}

test('start returns immediately and emits loading before asynchronous load', () => {
  const h = harness(); let resolve; const load = () => new Promise(r => { resolve = r; });
  const result = h.controller.start('chatgpt', { load, probe: async () => ({ state: 'missing' }) });
  assert.deepEqual(result, { provider: 'chatgpt', status: 'loading' });
  assert.equal(h.events[0].status, 'loading');
  assert.equal(h.loads(), 0);
  resolve(); h.controller.stop({ silent: true });
});

test('same provider is exactly-once and stale generation cannot emit', async () => {
  const h = harness(); let probes = 0;
  assert.equal(h.controller.start('claude', { load: h.load, probe: async () => { probes += 1; return { state: 'waiting' }; } }).status, 'loading');
  await Promise.resolve();
  const second = h.controller.start('claude', { load: h.load, probe: async () => ({ state: 'active' }) });
  assert.equal(second.reused, true);
  const count = h.events.length; h.controller.stop(); await h.flush(); assert.equal(h.events.length, count + 1); assert.equal(probes, 1);
});

test('active detection requires explicit end-call language and excludes generic Stop', () => {
  const script = voiceActionScript('claude');
  assert.match(script, /end call/);
  assert.doesNotMatch(script, /stopCandidate/);
  assert.doesNotMatch(script, /\\^stop\\$/);
});

test('voice labels include German and dictation is explicitly excluded', () => {
  const script = voiceActionScript('chatgpt');
  assert.match(script, /sprachmodus/);
  assert.match(script, /dictat\|diktier/);
});

test('load failures report error and remain retryable', async () => {
  const h = harness(); let failed = true; let loads = 0;
  h.controller.start('gemini', { load: async () => { loads += 1; if (failed) { failed = false; throw new Error('network'); } }, probe: async () => ({ state: 'missing' }) });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.events.some(e => e.status === 'error'), true);
  await h.flush(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(loads, 2);
  h.controller.stop({ silent: true });
});
