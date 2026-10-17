(function(root){
 function normalize(text){return String(text||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/ß/g,'ss').replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();}
 function parse(text,active){
  let t=normalize(text);t=t.replace(/\b(?:chat g p t|chat g pc|chat gpt|tschad gpt|tschat gpt|chatgpt|chat jeep iti)\b/g,'chatgpt').replace(/\b(?:claude|clod|cloud|klaud|klod|plot|klo)\b/g,'claude').replace(/\b(?:gemini|jemini|dschimini|geminie|geh mini|gehen in die)\b/g,'gemini');
  const stop=/^(?:jarvis )?(chatgpt|claude|gemini) (?:abbrechen|beenden|stop|stopp)$/ .exec(t);
  if(stop)return {type:'stop',id:stop[1]};
  if(active){if(/^(?:jarvis )?(?:abbrechen|beenden|stopp)$/.test(t))return {type:'stop',id:active};return null;}
  const start=/^(?:jarvis )?(?:(?:offne|starte|start|hallo) )?(chatgpt|claude|gemini)(?: (?:offnen|starten|bitte))?$/.exec(t);
  if(start)return {type:'start',id:start[1]};
  if(!/^(?:jarvis|ja wies|dschawis|dschavis|schawis|tschawis)\b/.test(t))return null;
  t=t.replace(/^(?:jarvis|ja wies|dschawis|dschavis|schawis|tschawis)\s*/, '');
  if(/\b(wetter|temperatur)\b/.test(t)){const match=/\b(?:in|fur) (.+)$/.exec(t);return {type:'weather',city:match?match[1].replace(/ bitte$/,''):null};}
  const rules=[['next',/nachst|weiter|skip/],['previous',/vorher|zuruck/],['volumedown',/leiser/],['volumeup',/lauter/],['mute',/stumm/],['stop',/^musik (?:stop|stopp|beenden)$/],['playpause',/pause|abspielen|wiedergabe|musik (?:an|aus|starten)|fortsetzen/]];
  for(const [action,re] of rules)if(re.test(t))return {type:'media',action};
  return null;
 }
 const api={normalize,parse};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JarvisCommands=api;
})(globalThis);
