'use strict';
const $=id=>document.getElementById(id),api=window.jarvis;
let settings={voice:'de-DE-ConradNeural',weatherCity:'Wien',alwaysOnTop:true,wakeEnabled:true,inputDeviceId:''};
let active=null,voices=[],mic=null,context=null,capture=null,source=null,pump=null;
let micGeneration=0,micStarting=null,speechGeneration=0,playing=null,speaking=false;
let lastCommand='',lastAt=0,toastTimer,pollBusy=false,lastWeatherCity='',lastCloudError=0;
const invoke=(action,payload)=>api.invoke(action,payload);
function toast(message,error=false){$('toast').textContent=message;$('toast').classList.toggle('error',error);$('toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').classList.add('hidden'),error?10000:5500);}
function bind(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>toast(e.message,true)));}
async function save(patch){settings=await invoke('settings:set',patch);renderSettings();return settings;}
function renderSettings(){
  document.querySelectorAll('[data-provider]').forEach(el=>el.classList.toggle('active',el.dataset.provider===active));
  $('alwaysOnTop').checked=settings.alwaysOnTop;
  if(document.activeElement!==$('weatherCity'))$('weatherCity').value=settings.weatherCity;
  if(mic&&!active)$('topStatus').textContent='Bereit';
}
async function stopPreview(){
  speechGeneration++;speaking=false;pump?.reset();audioResult.wakeEvidence=false;
  if(playing){const old=playing;playing=null;old.audio.pause();old.audio.src='';old.finish();URL.revokeObjectURL(old.url);}
  if(mic)await invoke('recognizer:reset').catch(()=>{});
}
async function say(text,voice){
  await stopPreview();const generation=++speechGeneration;
  const result=await invoke('speak',{text,voice:voice||settings.voice});
  if(generation!==speechGeneration)return;
  const bytes=Uint8Array.from(atob(result.audio),x=>x.charCodeAt(0));
  const url=URL.createObjectURL(new Blob([bytes],{type:result.mime})),audio=new Audio(url);
  speaking=true;
  try{await new Promise((resolve,reject)=>{playing={audio,url,finish:resolve};audio.onended=resolve;audio.onerror=()=>reject(Error('Lautsprecher-Ausgabe fehlgeschlagen'));audio.play().catch(reject);});}
  finally{URL.revokeObjectURL(url);if(generation===speechGeneration){playing=null;pump?.reset();audioResult.wakeEvidence=false;await invoke('recognizer:reset').catch(()=>{});if(generation===speechGeneration)speaking=false;}}
}
function weatherLabel(code){if(code===0)return'Klarer Himmel';if([1,2,3].includes(code))return'Teilweise bis stark bewölkt';if([45,48].includes(code))return'Nebel';if([51,53,55,56,57].includes(code))return'Nieselregen';if([61,63,65,66,67,80,81,82].includes(code))return'Regen';if([71,73,75,77,85,86].includes(code))return'Schnee';if([95,96,99].includes(code))return'Gewitter';return'Wettercode '+code;}
async function weather(city,read=false){
  $('weatherSummary').textContent='Aktuelle Wetterdaten werden abgerufen …';let data;
  try{data=await invoke('weather',{city:city||settings.weatherCity});const c=data.current;
    $('temperature').textContent=Math.round(c.temperature_2m)+'°';lastWeatherCity=city||settings.weatherCity;
    $('weatherSummary').textContent=`${data.city} · ${weatherLabel(c.weather_code)} · Wind ${c.wind_speed_10m} ${data.units.wind_speed_10m||'km/h'} · Stand ${String(c.time).replace('T',' ')} (${data.timezone})`;
  }catch(e){$('temperature').textContent='–°';$('weatherSummary').textContent='Wetter nicht verfügbar: '+e.message;throw e;}
  if(read&&!active)try{await say(`In ${data.city} sind es aktuell ${Math.round(data.current.temperature_2m)} Grad. ${weatherLabel(data.current.weather_code)}.`);}catch(e){toast('Wetter geladen. Sprachausgabe: '+e.message,true);}
  return data;
}
async function provider(id){
  JarvisBrain.onProvider();await stopPreview();
  if(!mic)await startMic().catch(e=>toast(e.message+' Der Abbruch ist weiterhin per Schaltfläche möglich.',true));
  return invoke('provider:start',{id});
}
async function media(action){const result=await invoke('media',{action});toast('Mediensteuerung: '+({playpause:'Wiedergabe / Pause',next:'Nächster Titel',previous:'Vorheriger Titel',volumeup:'Lauter',volumedown:'Leiser',mute:'Stumm',stop:'Stopp'}[action]||action));return result;}
function handleTranscript(text,partial){
  if(!text)return false;
  let cmd=JarvisCommands.parse(text,active,true);
  if(!cmd&&!active&&JarvisBrain.isListening()&&/^(abbrechen|beenden|stop|stopp)[.!?]*$/i.test(text.trim()))cmd={type:'brain-cancel'};
  if(!cmd&&!partial&&!active&&JarvisBrain.isListening())cmd={type:'brain',text};
  if(!cmd||speaking&&!['brain-cancel','stop'].includes(cmd.type))return !!speaking;
  $('heard').textContent=(partial?'Erkenne: ':'Gehört: ')+text;
  if(partial&&!['stop','brain-cancel'].includes(cmd.type))return true;
  if(cmd.type==='stop'&&active!==cmd.id)return true;
  const key=JSON.stringify(cmd);if(lastCommand===key&&Date.now()-lastAt<1800)return true;
  lastCommand=key;lastAt=Date.now();
  // Dispatch independently: browser loading/TTS must never stall PCM transport.
  Promise.resolve().then(async()=>{
    if(cmd.type==='brain-cancel')await JarvisBrain.cancel();
    else if(cmd.type==='brain-start')await JarvisBrain.show();
    else if(cmd.type==='brain'){if(!JarvisBrain.isBusy())await JarvisBrain.ask(cmd.text);}
    else if(cmd.type==='stop')await invoke('provider:stop');
    else if(cmd.type==='start')await provider(cmd.id);
    else if(cmd.type==='media')await media(cmd.action);
    else if(cmd.type==='weather'){if(cmd.city)await save({weatherCity:cmd.city});await weather(cmd.city,true);}
  }).catch(e=>toast(e.message,true));return true;
}
function audioResult(result){
  const wake=JarvisCommands.corroborateWake(result,audioResult.wakeEvidence);audioResult.wakeEvidence=wake.evidence;result=wake.result;
  const free=JarvisCommands.parse(result.text,active,true);
  const recognized=handleTranscript(result.text,result.partial);
  const fallback=JarvisCommands.parse(result.command,active,true);
  const confirmedStart=result.partial&&free?.type==='start'&&fallback?.type==='start'&&free.id===fallback.id;
  if((!recognized||confirmedStart||fallback?.type==='brain-cancel')&&result.command&&!result.command.includes('[unk]')&&fallback&&['start','stop','brain-cancel'].includes(fallback.type))handleTranscript(result.command,result.commandPartial);
}
async function startMic(persist=true){
  if(mic)return;if(micStarting)return micStarting;
  const generation=++micGeneration;audioResult.wakeEvidence=false;$('micButton').disabled=true;
  micStarting=(async()=>{
    let ownedStream,ownedContext,ownedSource,ownedCapture,ownedPump,committed=false;
    const stale=()=>generation!==micGeneration;
    const dispose=async()=>{ownedPump?.close();try{ownedCapture?.disconnect();ownedSource?.disconnect();}catch{}ownedStream?.getTracks().forEach(t=>{t.onended=null;t.stop();});if(ownedContext&&ownedContext.state!=='closed')await ownedContext.close().catch(()=>{});};
    try{
      ownedStream=await navigator.mediaDevices.getUserMedia({audio:{deviceId:settings.inputDeviceId?{exact:settings.inputDeviceId}:undefined,echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(stale())return;
      ownedContext=new AudioContext({sampleRate:16000});await ownedContext.resume();if(stale())return;
      ownedSource=ownedContext.createMediaStreamSource(ownedStream);const resampler=new JarvisAudio.Resampler(ownedContext.sampleRate);
      await invoke('recognizer:reset');if(stale())return;
      ownedPump=new JarvisAudio.PcmPump({send:audio=>invoke('recognizer:pcm',{audio}),onResult:audioResult,onError:e=>{toast('Lokale Spracherkennung: '+e.message,true);void stopMic(false);},onOverflow:()=>{audioResult.wakeEvidence=false;void invoke('recognizer:reset').catch(()=>{});toast('Audioverarbeitung war ausgelastet; die Erkennung wurde neu gestartet.',true);}});
      let firstFrameResolve;const firstFrame=new Promise(resolve=>{firstFrameResolve=resolve;});
      const receive=samples=>{firstFrameResolve?.();firstFrameResolve=null;if(stale()||!mic)return;let rms=0;for(const n of samples)rms+=n*n;$('orb').style.transform=`scale(${1+Math.min(Math.sqrt(rms/samples.length),0.15)})`;ownedPump.push(resampler.process(samples));};
      try{await ownedContext.audioWorklet.addModule('microphone-worklet.js');if(stale())return;ownedCapture=new AudioWorkletNode(ownedContext,'jarvis-capture');ownedCapture.port.onmessage=e=>receive(e.data);}
      catch(e){if(stale())return;ownedCapture=ownedContext.createScriptProcessor(4096,1,1);ownedCapture.onaudioprocess=e=>receive(e.inputBuffer.getChannelData(0));}
      if(stale())return;
      const silence=ownedContext.createGain();silence.gain.value=0;ownedSource.connect(ownedCapture);ownedCapture.connect(silence);silence.connect(ownedContext.destination);
      mic=ownedStream;context=ownedContext;source=ownedSource;capture=ownedCapture;pump=ownedPump;committed=true;
      for(const track of ownedStream.getAudioTracks())track.onended=()=>{if(!stale()){void stopMic(false);toast('Das Mikrofon wurde getrennt. Bitte in den Einstellungen ein verfügbares Gerät wählen.',true);}};
      let readyTimeout;try{await Promise.race([firstFrame,new Promise((_,reject)=>{readyTimeout=setTimeout(()=>reject(Error('Das Mikrofon liefert keine Audiodaten')),4000);})]);}finally{clearTimeout(readyTimeout);}if(stale())return;
      $('heard').textContent='Mikrofon an';$('micButton').textContent='Mikrofon ausschalten';$('micDot').classList.add('on');$('orb').classList.add('listening');
      $('micDetail').textContent=ownedStream.getAudioTracks()[0]?.label||'Systemmikrofon';
      if(persist)await save({wakeEnabled:true});renderSettings();await loadInputs();
    }finally{if(!committed)await dispose();}
  })().catch(async e=>{if(generation===micGeneration)await stopMic(false);throw Error('Mikrofon konnte nicht aktiviert werden: '+e.message);}).finally(()=>{micStarting=null;$('micButton').disabled=false;});
  return micStarting;
}
async function stopMic(persist=true){
  micGeneration++;audioResult.wakeEvidence=false;pump?.close();pump=null;
  if(capture){if(capture.port)capture.port.onmessage=null;capture.onaudioprocess=null;try{capture.disconnect();}catch{}capture=null;}
  if(source){try{source.disconnect();}catch{}source=null;}
  if(mic){const old=mic;mic=null;old.getTracks().forEach(t=>{t.onended=null;t.stop();});}
  if(context){const old=context;context=null;await old.close().catch(()=>{});}
  $('micButton').textContent='Mikrofon aktivieren';$('micDot').classList.remove('on');$('orb').classList.remove('listening');$('orb').style.transform='';$('topStatus').textContent='Mikrofon ausgeschaltet';$('micDetail').textContent='Mikrofon ausgeschaltet.';
  if(persist)await save({wakeEnabled:false});
}
async function loadInputs(){const devices=await navigator.mediaDevices.enumerateDevices();$('inputDevice').replaceChildren();const op=document.createElement('option');op.value='';op.textContent='Systemstandard';$('inputDevice').append(op);for(const d of devices.filter(x=>x.kind==='audioinput')){const option=document.createElement('option');option.value=d.deviceId;option.textContent=d.label||'Mikrofon '+$('inputDevice').options.length;$('inputDevice').append(option);}$('inputDevice').value=settings.inputDeviceId||'';}
function renderVoices(){
  const clean=s=>String(s).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'');const filter=clean($('voiceSearch').value),selected=$('voiceList').value||settings.voice;
  const title=v=>{let language=v.Locale;try{language=new Intl.DisplayNames(['de'],{type:'language'}).of(v.Locale);}catch{}const name=v.ShortName.replace(/^.*-([^-]+)Neural$/,'$1');return `${name} · ${language} · ${{Male:'männlich',Female:'weiblich'}[v.Gender]||v.Gender}`;};
  const list=voices.filter(v=>clean([v.ShortName,v.Locale,v.Gender,v.FriendlyName,title(v)].join(' ')).includes(filter));$('voiceList').replaceChildren();
  for(const v of list){const option=document.createElement('option');option.value=v.ShortName;option.textContent=title(v);$('voiceList').append(option);}
  if(list.some(v=>v.ShortName===selected))$('voiceList').value=selected;
  $('voiceCount').textContent=`${list.length} von ${voices.length} Stimmen`;$('previewVoice').disabled=!list.length;$('saveVoice').disabled=!list.length;
}
async function authStatus(){const s=await invoke('auth:status');$('authStatus').textContent=s.signedIn?'Angemeldet als '+s.email:(s.message||'Noch nicht angemeldet. Für Jarvis auf diesem PC ist kein Konto nötig.');$('authForm').classList.toggle('hidden',s.signedIn);$('signout').classList.toggle('hidden',!s.signedIn);$('syncCloud').classList.toggle('hidden',!s.signedIn);$('accountButton').textContent=s.signedIn?'Konto verbunden':'Konto & Geräte';return s;}
async function sync(){const auth=await authStatus();if(!auth.signedIn)return;const remote=await invoke('cloud:pull');if(!Object.keys(remote).length)await invoke('cloud:push',Object.fromEntries(Object.entries(settings).filter(([k])=>['voice','weatherCity','alwaysOnTop','wakeEnabled'].includes(k))));settings=await invoke('settings:get');renderSettings();if(settings.weatherCity!==lastWeatherCity)await weather();}
async function devices(){const data=await invoke('devices'),list=$('devices');list.replaceChildren();for(const d of data.devices||data){if(d.revoked)continue;const line=document.createElement('div');line.textContent=d.name||'Gekoppeltes Gerät';const button=document.createElement('button');button.textContent='Trennen';button.onclick=()=>invoke('device:revoke',{id:d.id}).then(devices).catch(e=>toast(e.message,true));line.append(button);list.append(line);}}
api.onEvent(event=>{
  JarvisBrain.onEvent(event);
  if(event.type==='settings'){settings=event.settings;renderSettings();}
  if(event.type==='provider'){if(event.provider&&event.provider!==active){JarvisBrain.onProvider();void stopPreview();}active=event.provider;renderSettings();$('callBox').classList.toggle('hidden',!active);$('callName').textContent=active||'';$('callStatus').textContent=event.message||'Voice-Fenster geöffnet';$('topStatus').textContent=active?(event.status==='active'?'Anbieter-Voice erkannt':'Anbieterfenster · '+event.status):(mic?'Bereit':'Mikrofon ausgeschaltet');}
  if(event.type==='auth'){void authStatus().catch(()=>{});if(event.signedIn)void sync().catch(e=>toast(e.message,true));}
  if(event.type==='auth:error')toast(event.message,true);
  if(event.type==='cloud-error'&&Date.now()-lastCloudError>15000){lastCloudError=Date.now();toast('Lokal gespeichert. Synchronisation noch ausstehend: '+event.message,true);}
});
document.querySelectorAll('[data-provider]').forEach(button=>button.onclick=()=>provider(button.dataset.provider).catch(e=>toast(e.message,true)));
document.querySelectorAll('[data-media]').forEach(button=>button.onclick=()=>media(button.dataset.media).catch(e=>toast(e.message,true)));
document.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$(button.dataset.close).close());
bind('micButton',()=>mic?stopMic():startMic());bind('endCall',()=>invoke('provider:stop'));bind('retryVoice',()=>invoke('provider:reload'));
$('alwaysOnTop').onchange=()=>save({alwaysOnTop:$('alwaysOnTop').checked}).catch(e=>toast(e.message,true));
bind('refreshWeather',()=>weather());bind('saveCity',async()=>{await save({weatherCity:$('weatherCity').value.trim()});await weather();});
bind('settingsButton',async()=>{await invoke('provider:visibility',{visible:false});$('settingsDialog').showModal();await loadInputs();if(!voices.length)$('loadVoices').click();const status=await invoke('status');$('runtimeStatus').textContent=[!status.voiceReady?'Sprachausgabe nicht bereit':'',!status.recognizerReady?'Spracherkennung nicht bereit':''].filter(Boolean).join(' · ');});
$('inputDevice').onchange=async()=>{try{const running=!!mic;await save({inputDeviceId:$('inputDevice').value});if(running){await stopMic(false);await startMic(false);}}catch(e){toast(e.message,true);}};
bind('loadVoices',async()=>{$('loadVoices').disabled=true;try{voices=await invoke('voices');voices.sort((a,b)=>a.ShortName.localeCompare(b.ShortName));renderVoices();toast(`${voices.length} Microsoft-Stimmen geladen`);}finally{$('loadVoices').disabled=false;}});
$('voiceSearch').oninput=renderVoices;bind('previewVoice',()=>say('Guten Tag. Ich bin Jarvis. Wie kann ich dir helfen?',$('voiceList').value||settings.voice));bind('stopPreview',stopPreview);bind('saveVoice',async()=>{await save({voice:$('voiceList').value||settings.voice});toast('Stimme gespeichert');});
bind('accountButton',async()=>{await invoke('provider:visibility',{visible:false});$('accountDialog').showModal();await authStatus();await devices();});
$('authForm').onsubmit=async event=>{event.preventDefault();const button=$('authForm').querySelector('[type=submit]');button.disabled=true;try{await invoke('auth:signin',{email:$('email').value.trim(),password:$('password').value});$('password').value='';await sync();toast('Angemeldet');}catch(e){toast(e.message,true);}finally{button.disabled=false;}};
bind('signup',async()=>{if(!$('authForm').reportValidity())return;$('signup').disabled=true;try{const r=await invoke('auth:signup',{email:$('email').value.trim(),password:$('password').value});$('password').value='';toast(r.signedIn?'Konto erstellt':'Bitte bestätige die Registrierungs-E-Mail und melde dich danach an.');await authStatus();}finally{$('signup').disabled=false;}});
bind('signout',async()=>{await invoke('auth:signout');await authStatus();toast('Abgemeldet');});bind('syncCloud',async()=>{await sync();toast('Einstellungen synchronisiert');});
bind('createInvite',async()=>{const host=$('pairHost').value.trim()||undefined;await invoke('pairing:enable',{host});$('invite').value=await invoke('pairing:invite',{host});toast('Einladung gilt fünf Minuten und genau einmal');});
bind('disablePair',async()=>{await invoke('pairing:disable');$('invite').value='';toast('Direkte Kopplung ausgeschaltet');});bind('copyInvite',async()=>{if(!$('invite').value)throw Error('Zuerst eine Einladung erzeugen');await navigator.clipboard.writeText($('invite').value);toast('Einladung kopiert');});
for(const id of ['settingsDialog','accountDialog'])$(id).addEventListener('close',()=>{if(id==='settingsDialog')void stopPreview();void invoke('provider:visibility',{visible:true});});
navigator.mediaDevices.addEventListener('devicechange',()=>{void loadInputs().catch(()=>{});});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&active&&!document.querySelector('dialog[open]'))void invoke('provider:stop');});
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!active&&!document.querySelector('dialog[open]'))void JarvisBrain.cancel().catch(()=>{});});
window.addEventListener('beforeunload',()=>{pump?.close();mic?.getTracks().forEach(t=>t.stop());playing?.audio.pause();});
(async()=>{settings=await invoke('settings:get');renderSettings();await JarvisBrain.init({invoke,say,stopSpeech:stopPreview,startMic,toast});const info=await invoke('app:info');$('version').textContent='v'+info.version;await authStatus();void weather().catch(e=>toast(e.message,true));if(settings.wakeEnabled)await startMic(false);})().catch(e=>toast(e.message,true));
setInterval(async()=>{if(pollBusy)return;pollBusy=true;try{const s=await invoke('auth:status');if(s.signedIn)await sync();}catch{}finally{pollBusy=false;}},15000);
