function voiceActionScript(provider){
 return `(()=>{const provider=${JSON.stringify(provider)};
 const visible=e=>{const r=e.getBoundingClientRect();return r.width>0&&r.height>0&&!e.disabled&&getComputedStyle(e).visibility!=='hidden';};
 const buttons=[...document.querySelectorAll('button,[role="button"]')].filter(visible);
 const label=e=>[e.getAttribute('aria-label'),e.getAttribute('title'),e.getAttribute('data-testid'),e.innerText].filter(Boolean).join(' ').trim();
 const active=/\\b(end (?:voice|call|conversation)|exit voice|stop voice|leave (?:call|voice)|hang up|sprach(?:chat|modus|unterhaltung) beenden|gespräch beenden|anruf beenden|voice-stop|close-voice)\\b/i;
 if(buttons.some(e=>active.test(label(e))))return {state:'active'};
 const start=provider==='gemini'?/\\b(go live|start live|gemini live|live starten|live-modus)\\b/i:/\\b(start voice|voice mode|voice-mode|voice chat|voice conversation|talk to (?:chatgpt|claude)|sprachmodus|sprachchat|sprachunterhaltung|stimm(?:modus|chat)|starten.*sprach|advanced voice)\\b/i;
 const stopCandidate=buttons.find(e=>provider==='claude'&&/^stop$/i.test(label(e)));
 if(stopCandidate)return {state:'active'};
 const candidates=buttons.filter(e=>start.test(label(e))&&!/dictat|diktier|upload|search|suchen|settings|einstellung/i.test(label(e)));
 const button=candidates[0];if(button){if(window.__jarvisLastVoiceClick&&Date.now()-window.__jarvisLastVoiceClick<5000)return {state:'waiting'};window.__jarvisLastVoiceClick=Date.now();button.click();return {state:'clicked',label:label(button)};}return {state:'missing'};
 })()`;
}
module.exports={voiceActionScript};
