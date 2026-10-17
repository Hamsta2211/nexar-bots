'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { encodePCM, Resampler, PcmPump } = require('../ui/audio.js');

function pcm16(base64) {
  const b = Buffer.from(base64, 'base64');
  const out = [];
  for (let i = 0; i < b.length; i += 2) out.push(b.readInt16LE(i));
  return out;
}
function approx(actual, expected, eps = 1e-6) {
  assert.equal(actual.length, expected.length, `length ${actual.length} !== ${expected.length}`);
  for (let i = 0; i < actual.length; i++) assert.ok(Math.abs(actual[i] - expected[i]) <= eps, `${i}: ${actual[i]} !== ${expected[i]}`);
}

// encodePCM: signed 16-bit little endian, with the conventional asymmetric endpoints.
test('encodePCM encodes positive, negative, zero and clipping in little endian', () => {
  const got = pcm16(encodePCM(new Float32Array([0, 1, -1, 0.5, -0.5, 2, -2])));
  assert.deepEqual(got, [0, 32767, -32768, 16384, -16384, 32767, -32768]);
});
test('encodePCM treats NaN and other falsy samples as silence', () => {
  assert.deepEqual(pcm16(encodePCM(new Float32Array([NaN, 0, -0]))), [0, 0, 0]);
});
test('encodePCM returns an empty base64 payload for empty chunks', () => assert.equal(encodePCM(new Float32Array(0)), ''));

test('Resampler preserves a 16 kHz passthrough, including chunk copies', () => {
  const r = new Resampler(16000);
  const input = new Float32Array([-.5, 0, .25, 1]);
  const output = r.process(input);
  assert.notEqual(output, input);
  approx(output, input);
  approx(r.process(new Float32Array(0)), []);
});
test('Resampler rejects non-finite and too-low input rates', () => {
  for (const rate of [NaN, Infinity, 7999]) assert.throws(() => new Resampler(rate), /Ungültige Abtastrate/);
});
test('Resampler 48k to 16k is continuous across arbitrary chunk boundaries', () => {
  const source = Float32Array.from({ length: 480 }, (_, i) => Math.sin(i / 13));
  const whole = new Resampler(48000).process(source);
  const r = new Resampler(48000), chunks = [];
  for (let i = 0; i < source.length; ) {
    const n = Math.min(source.length - i, [7, 31, 2, 89, 11][chunks.length % 5]);
    chunks.push(...r.process(source.subarray(i, i + n))); i += n;
  }
  approx(Float32Array.from(chunks), whole, 1e-5);
});
test('Resampler handles 44.1k to 16k chunking identically to whole-block processing', () => {
  const source = Float32Array.from({ length: 441 }, (_, i) => i / 440);
  const whole = new Resampler(44100).process(source);
  const r = new Resampler(44100), output = [];
  for (let i = 0; i < source.length; i += 17) output.push(...r.process(source.subarray(i, i + 17)));
  approx(Float32Array.from(output), whole, 1e-5);
});
test('Resampler accepts empty chunks without changing stream state', () => {
  const source = Float32Array.from({ length: 20 }, (_, i) => i);
  const r = new Resampler(48000);
  const first = r.process(source.subarray(0, 10));
  r.process(new Float32Array(0));
  const after = r.process(source.subarray(10));
  const expected = new Resampler(48000).process(source);
  approx(Float32Array.from([...first, ...after]), expected);
});

test('PcmPump serializes sends and preserves order under backpressure', async () => {
  const calls = [], results = []; let release;
  const gate = new Promise(r => { release = r; });
  const pump = new PcmPump({ send: async audio => { calls.push(pcm16(audio)[0]); await gate; return calls.at(-1); }, onResult: x => results.push(x) });
  pump.push(new Float32Array([.1])); pump.push(new Float32Array([.2]));
  await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, [3277]);
  release(); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  assert.deepEqual(calls, [3277, 6553]); assert.deepEqual(results, [3277, 6553]);
});
test('PcmPump close during an in-flight send ignores its result and queued audio', async () => {
  let release, calls = 0; const pending = new Promise(r => { release = r; }), results = [];
  const pump = new PcmPump({ send: async () => { calls++; await pending; return 'late'; }, onResult: x => results.push(x), onError: assert.fail });
  pump.push(new Float32Array([1])); pump.push(new Float32Array([1]));
  await new Promise(r => setImmediate(r)); pump.close(); release(); await new Promise(r => setImmediate(r));
  assert.equal(calls, 1); assert.deepEqual(results, []); assert.equal(pump.samples, 0);
});
test('PcmPump send error calls onError without throwing or retrying failed audio', async () => {
  const errors = [], sent = []; let fail = true;
  const pump = new PcmPump({ send: async audio => { sent.push(pcm16(audio)[0]); if (fail) { fail = false; throw new Error('transport'); } return 'ok'; }, onResult: () => {}, onError: e => errors.push(e) });
  pump.push(new Float32Array([.1])); await new Promise(r => setImmediate(r)); await new Promise(r => setImmediate(r));
  pump.push(new Float32Array([.2])); await new Promise(r => setImmediate(r));
  assert.deepEqual(sent, [3277, 6553]); assert.equal(errors.length, 1); assert.equal(errors[0].message, 'transport');
});
test('PcmPump overflow drops queued audio, reports once, then recovers', async () => {
  let release; const pending = new Promise(r => { release = r; }), overflow = [], sent = [];
  const pump = new PcmPump({ maxSamples: 3, send: async audio => { sent.push(pcm16(audio)[0]); await pending; }, onResult: () => {}, onOverflow: () => overflow.push(true), onError: e => { throw e; } });
  pump.push(new Float32Array([.1])); pump.push(new Float32Array([.2]));
  await new Promise(r => setImmediate(r));
  pump.push(new Float32Array([.2, .3, .4])); assert.deepEqual(overflow, [true]); release();
  await new Promise(r => setImmediate(r)); pump.push(new Float32Array([.5])); await new Promise(r => setImmediate(r));
  assert.deepEqual(sent, [3277, 16384]);
});
test('PcmPump ignores empty pushes and pushes after close', async () => {
  let calls = 0; const pump = new PcmPump({ send: async () => { calls++; } });
  pump.push(new Float32Array(0)); pump.close(); pump.push(new Float32Array([1]));
  await new Promise(r => setImmediate(r)); assert.equal(calls, 0);
});

function loadWorklet(rate = 48000) {
  const source = fs.readFileSync(require.resolve('../ui/microphone-worklet.js'), 'utf8');
  const messages = [], ports = [];
  class Base { constructor() { this.port = { postMessage(value, transfer) {
    // Model browser structured clone with transfer: the sender's ArrayBuffer is detached.
    const cloned = structuredClone(value, { transfer }); messages.push(cloned); }
  }; ports.push(this.port); } }
  const context = { AudioWorkletProcessor: Base, registerProcessor(name, C) { context.processor = C; context.name = name; }, sampleRate: rate };
  vm.runInNewContext(source, context, { filename: 'microphone-worklet.js' });
  return { ...context, messages, ports };
}
test('microphone worklet registers jarvis-capture and uses sampleRate-sized buffering', () => {
  const h = loadWorklet(16000);
  assert.equal(h.name, 'jarvis-capture'); const p = new h.processor();
  assert.equal(p.buffer.length, Math.max(1024, Math.round(16000 * .256)));
});
test('microphone worklet posts complete buffers with real transfer detachment and no zeroed samples', () => {
  const h = loadWorklet(48000), p = new h.processor();
  let oldBuffers = [];
  for (let call = 0; call < 100; call++) {
    const frame = Float32Array.from({ length: 128 }, (_, i) => call * 128 + i + 1);
    oldBuffers.push(p.buffer.buffer);
    oldBuffers.push(frame.buffer); assert.equal(p.process([[frame]]), true);
  }
  assert.equal(h.messages.length, 1);
  assert.equal(h.messages[0].length, Math.round(48000 * .256));
  assert.equal(h.messages[0][0], 1); assert.equal(h.messages[0].at(-1), h.messages[0].length);
  assert.ok(h.messages[0].every(Number.isFinite)); assert.ok(h.messages[0].every(x => x !== 0));
  assert.equal(p.offset, 12800 - h.messages[0].length);
  // The transferred source is detached by structuredClone; subsequent writes cannot reuse it.
  assert.ok(oldBuffers.some(b => b.byteLength === 0));
});
test('microphone worklet handles missing and empty input without posting', () => {
  const h = loadWorklet(48000), p = new h.processor();
  assert.equal(p.process([]), true); assert.equal(p.process([[new Float32Array(0)]]), true); assert.equal(h.messages.length, 0);
});
