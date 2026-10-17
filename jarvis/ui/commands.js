(function(root){
  'use strict';
  const PREFIX=/^(?:jarvis|jarwis|jarwies|ja wies|ja wir|ja wie|ja vis|ja bis|ja wis|ja biss|dschawis|dschavis|schawis|tschawis)\b/;
  function normalize(text){return String(text||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
  function parse(text,active){
    let t=normalize(text);
    t=t.replace(/\b(?:chat g p t|chat g pc|chat gpt|tschad gpt|tschat gpt|chatgpt|chat jeep iti)\b/g,'chatgpt').replace(/\b(?:claude|clod|cloud|klaud|klod|plot|klo)\b/g,'claude').replace(/\b(?:gemini|jemini|dschimini|geminie|geh mini|gehen in die)\b/g,'gemini');
    const stop=/^(?:jarvis )?(chatgpt|claude|gemini) (?:abbrechen|beenden|stop|stopp)$/.exec(t);
    if(stop)return {type:'stop',id:stop[1]};
    if(active){if(/^(?:jarvis )?(?:abbrechen|beenden|stop|stopp)$/.test(t))return {type:'stop',id:active};if(!PREFIX.test(t))return null;}
    const start=/^(?:jarvis )?(?:(?:offne|starte|start|hallo) )?(chatgpt|claude|gemini)(?: (?:offnen|starten|bitte))?$/.exec(t);
    if(start)return {type:'start',id:start[1]};
    if(!PREFIX.test(t))return null;
    t=t.replace(PREFIX,'').trim();
    if(/\b(wetter|temperatur)\b/.test(t)){const match=/\b(?:in|fur) (.+)$/.exec(t);return {type:'weather',city:match?match[1].replace(/ bitte$/,''):null};}
    const rules=[
      ['next',/^(?:(?:das|den|zum) )?(?:nachst(?:e|es|er|en)?(?: (?:lied|titel|song))?|weiter|skip)(?: bitte)?$/],
      ['previous',/^(?:(?:das|den|zum) )?(?:vorherig(?:e|es|er|en)?(?: (?:lied|titel|song))?|letzt(?:e|es|er|en)(?: (?:lied|titel|song))?|zuruck|vorher)(?: bitte)?$/],
      ['volumedown',/^(?:(?:musik|ton|lautstarke) )?leiser(?: machen)?(?: bitte)?$/],
      ['volumeup',/^(?:(?:musik|ton|lautstarke) )?lauter(?: machen)?(?: bitte)?$/],
      ['mute',/^(?:(?:musik|ton|lautsprecher) )?(?:stumm|stummschalten|mute)(?: bitte)?$/],
      ['stop',/^(?:(?:musik|wiedergabe) )?(?:stop|stopp|beenden)(?: bitte)?$/],
      ['playpause',/^(?:(?:musik|wiedergabe) )?(?:pause|pausieren|abspielen|starten|fortsetzen|anhalten|an|aus)(?: bitte)?$|^(?:musik|wiedergabe)$/]
    ];
    for(const [action,re] of rules)if(re.test(t))return {type:'media',action};
    return null;
  }
  const api={normalize,parse};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JarvisCommands=api;
})(globalThis);
