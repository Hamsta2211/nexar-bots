'use strict';
const { test, expect } = require('@playwright/test');
const { voiceActionScript } = require('./providers.cjs');

test('fixture: hidden/disabled controls do not start voice and dictation is ignored', async ({ page }) => {
  await page.setContent(`
    <button aria-label="Dictation">Dictate</button>
    <button aria-label="Start voice" disabled>Start voice</button>
    <button aria-label="Start voice" style="display:none">Start voice</button>
  `);
  const result = await page.evaluate(({ script }) => Function(`return ${script}`)(), { script: voiceActionScript('chatgpt') });
  expect(result.state).toBe('missing');
});

test('fixture: German voice start is clicked, but generic Stop is not active', async ({ page }) => {
  await page.setContent('<button aria-label="Sprachmodus starten">Sprachmodus starten</button>');
  const started = await page.evaluate(({ script }) => Function(`return ${script}`)(), { script: voiceActionScript('chatgpt') });
  expect(started.state).toBe('clicked');
  await page.setContent('<button aria-label="Stop">Stop</button>');
  const stopped = await page.evaluate(({ script }) => Function(`return ${script}`)(), { script: voiceActionScript('claude') });
  expect(stopped.state).not.toBe('active');
});

test('fixture: explicit localized end-call control is active', async ({ page }) => {
  await page.setContent('<button aria-label="Sprachchat beenden">Sprachchat beenden</button>');
  const result = await page.evaluate(({ script }) => Function(`return ${script}`)() , { script: voiceActionScript('chatgpt') });
  expect(result.state).toBe('active');
});

test('fixture: ending voice in the original UI does not auto-restart it',async({page})=>{await page.setContent('<button aria-label="Start voice mode" onclick="window.clicked=true">Voice</button>');const r=await page.evaluate(script=>Function(`return ${script}`)(),voiceActionScript('chatgpt',false));expect(r.state).toBe('ended');expect(await page.evaluate(()=>!!window.clicked)).toBe(false);});
