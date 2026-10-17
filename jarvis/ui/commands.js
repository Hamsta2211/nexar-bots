(function(root){
  'use strict';
  const PREFIX=/^(?:jarvis|jarwis|jarwies|ja wies|ja wir|ja wie|ja vis|ja bis|ja wis|ja biss|dschawis|dschavis|schawis|tschawis)\b/;
  function normalize(text){return String(text||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
  function parse(text,active,allowBrain=false){
    let t=normalize(text);
    t=t.replace(/\b(?:chat g p t|chat g pc|chat gpt|tschad gpt|tschat gpt|chatgpt|chat jeep iti)\b/g,'chatgpt').replace(/\b(?:claude|clod|cloud|klaud|klod|plot|klo)\b/g,'claude').replace(/\b(?:gemini|jemini|dschimini|geminie|geh mini|gehen in die)\b/g,'gemini');
    if(allowBrain&&PREFIX.test(t)&&/^(abbrechen|beenden|stop|stopp)$/.test(t.replace(PREFIX,'').trim()))return {type:'brain-cancel'};
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
    if(allowBrain){const prompt=String(text||'').trim().replace(/^(?:jarvis|jarwis|jarwies|ja wies|ja wir|ja wie|ja vis|ja bis|ja wis|ja biss|dschawis|dschavis|schawis|tschawis)\b[\s,:;.!?-]*/i,'').trim();return prompt?{type:'brain',text:prompt}:{type:'brain-start'};}
    return null;
  }
  function corroborateWake(result,evidence=false){
    const free=normalize(result.text),command=normalize(result.command);
    if(result.partial&&command==='jarvis'&&['jarvis','javascript','jahres'].includes(free))evidence=true;
    let text=result.text;
    if(!result.partial&&evidence){
      if(/^(?:ja|ich) was was\b/i.test(text))text=text.replace(/^(?:ja|ich) was /i,'Jarvis ');
      else if(/^(?:ja|ich) was ist\b/i.test(text))text=text.replace(/^(?:ja|ich) /i,'Jarvis ');
      else if(/^ja was\b/i.test(text))text=text.replace(/^ja was[\s,:;.!?-]*/i,'Jarvis ');
      else if(/^jahres\b/i.test(text))text=text.replace(/^jahres[\s,:;.!?-]*/i,'Jarvis ');
    }
    return {result:{...result,text},evidence:result.partial&&evidence};
  }
  const api={normalize,parse,corroborateWake};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JarvisCommands=api;
})(globalThis);
