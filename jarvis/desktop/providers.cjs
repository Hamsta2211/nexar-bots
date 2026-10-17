'use strict';

const RETRY_MIN_MS = 750;
const RETRY_MAX_MS = 8000;

/**
 * ProviderStateController contains no Electron dependencies. It owns one
 * generation at a time, keeps retrying through SPA/auth transitions, and
 * never reports active until the provider DOM exposes an explicit end-call UI.
 */
class ProviderStateController {
  constructor({ emit, schedule = setTimeout, cancel = clearTimeout, now = Date.now } = {}) {
    this.emit = emit || (() => {});
    this.schedule = schedule;
    this.cancel = cancel;
    this.now = now;
    this.generation = 0;
    this.timer = null;
    this.id = null;
    this.running = false;
    this.status = 'idle'; this.hasBeenActive = false; this.clickedStart = false;
  }

  start(id, { load, probe, close } = {}) {
    if (this.running && this.id === id) return { provider: id, status: this.status, reused: true };
    this.stop({ silent: true });
    const generation = ++this.generation;
    this.id = id;
    this.running = true;
    let delay = RETRY_MIN_MS;
    let loading = false;
    const alive = () => this.running && this.id === id && this.generation === generation;
    const report = (status, message) => { if (!alive()) return; this.status = status; this.emit({ type: 'provider', provider: id, status, ...(message ? { message } : {}) }); };
    const retry = () => {
      if (!alive()) return;
      this.timer = this.schedule(() => { this.timer = null; void cycle(); }, delay);
      delay = Math.min(RETRY_MAX_MS, Math.round(delay * 1.5));
    };
    const cycle = async () => {
      if (!alive() || loading) return;
      loading = true;
      try {
        if (typeof load === 'function' && !this.loaded) {
          await load();
          if (!alive()) return;
          this.loaded = true;
        }
        const result = await probe();
        if (!alive()) return;
        if (result?.state === 'active') {
          this.hasBeenActive = true; delay = 2000;
          report('active', 'Voice-Oberfläche erkannt');
        } else if (result?.state === 'clicked') {
          this.clickedStart = true; delay = RETRY_MIN_MS;
          report('starting', 'Voice-Oberfläche wird geöffnet');
        } else if (result?.state === 'ended') {
          report('ended', 'Im Anbieter beendet. Zum Neustart erneut den Anbieternamen sagen.');
        } else if (result?.state === 'waiting') {
          report('waiting', 'Warte auf die Voice-Oberfläche');
        } else {
          if(this.clickedStart) this.hasBeenActive = true;
          report('waiting', 'Anmelden und Voice-Funktion in der Originaloberfläche öffnen');
        }
      } catch (error) {
        if (!alive()) return;
        // Keep an authenticated SPA navigation intact after a transient probe failure.
        report('error', error?.message || 'Originalseite konnte nicht geladen werden');
      } finally {
        loading = false;
        if (alive()) retry();
      }
    };
    this.loaded = false; this.hasBeenActive = false; this.clickedStart = false;
    this.retryNow = () => { if(loading || !alive())return; if(this.timer)this.cancel(this.timer);this.timer=null;void cycle(); };
    report('loading', 'Originalseite wird geöffnet');
    void cycle();
    return { provider: id, status: 'loading' };
  }

  rearm(){ if(this.status !== 'active'){this.hasBeenActive=false;this.clickedStart=false;this.retryNow?.();} }

  stop({ silent = false } = {}) {
    this.generation += 1;
    this.running = false;
    this.id = null;
    this.loaded = false;
    if (this.timer) this.cancel(this.timer);
    this.timer = null; this.retryNow = null; this.hasBeenActive=false; this.clickedStart=false;this.status='idle';
    if (!silent) this.emit({ type: 'provider', provider: null, status: 'idle' });
  }

  dispose() { this.stop({ silent: true }); }
}

function voiceActionScript(provider, allowStart = true) {
  return `(()=>{const provider=${JSON.stringify(provider)};const autoStart=${Boolean(allowStart)};
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&getComputedStyle(e).visibility!=='hidden'&&getComputedStyle(e).display!=='none';};
 const label=e=>[e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('data-testid'),e.innerText].filter(Boolean).join(' ').replace(/\\s+/g,' ').trim();
 const controls=[...document.querySelectorAll('button,[role="button"]')].filter(visible);
 // Generic Stop/Stop Claude buttons are not proof of a voice call. Only
 // provider-language end-call labels (or an explicit voice-mode test id) count.
 const active=/\\b(end voice|end call|end conversation|exit voice|stop voice|leave call|leave voice|hang up|voice-stop|close-voice|sprach(?:chat|modus|unterhaltung) beenden|gespräch beenden|anruf beenden|live beenden)\\b/i;
 if(controls.some(e=>active.test(label(e))||/voice[-_ ]?(mode|call|conversation)[-_ ]?(active|stop|end)/i.test(e.getAttribute('data-testid')||'')))return {state:'active'};
 const start=provider==='gemini'?/\\b(go live|start live|gemini live|live starten|live-modus)\\b/i:/\\b(start voice|voice mode|voice-mode|voice chat|voice conversation|talk to (?:chatgpt|claude)|sprachmodus|sprachchat|sprachunterhaltung|stimm(?:modus|chat)|starten.*sprach|advanced voice)\\b/i;
 const candidates=controls.filter(e=>start.test(label(e))&&!/dictat|diktier|upload|search|suchen|settings|einstellung/i.test(label(e)));
 const button=candidates[0];
 if(button){if(!autoStart)return {state:'ended'};if(window.__jarvisLastVoiceClick&&Date.now()-window.__jarvisLastVoiceClick<5000)return {state:'waiting'};window.__jarvisLastVoiceClick=Date.now();button.click();return {state:'clicked',label:label(button)};}
 return {state:'missing'};
 })()`;
}

module.exports = { ProviderStateController, voiceActionScript, RETRY_MIN_MS, RETRY_MAX_MS };
