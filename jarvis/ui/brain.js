(function(root){
'use strict';
const $=id=>document.getElementById(id);
let api,config={},generation=0,busy=false,listening=false;
function label(){return config.provider==='groq'?'Groq · '+config.groqModel:'Lokal · '+config.localModel;}
function state(message){$('brainState').textContent=message;}
function controls(){ $('brainSend').disabled=busy;$('brainCancel').disabled=!busy&&!listening; }
function renderConfig(){
  $('brainProvider').value=config.provider||'local';$('brainLocalUrl').value=config.localUrl||'http://127.0.0.1:11434';
  $('brainModelId').value=(config.provider==='groq'?config.groqModel:config.localModel)||'';
  $('brainKeyStatus').textContent=config.hasGroqKey?(config.keyStorage==='memory'?'Schlüssel nur für diese Sitzung gespeichert: Der System-Schlüsselbund ist nicht verfügbar.':'Groq-Schlüssel verschlüsselt auf diesem Gerät gespeichert.'):'Kein Groq-Schlüssel hinterlegt.';
  $('brainModelLabel').textContent=label();toggleFields();
}
function toggleFields(){const groq=$('brainProvider').value==='groq';$('brainLocalFields').classList.toggle('hidden',groq);$('brainGroqFields').classList.toggle('hidden',!groq);}
async function refresh(){config=await api.invoke('brain:status');renderConfig();return config;}
async function show(){
  if(busy)return;
  const current=++generation;await api.invoke('provider:stop');if(current!==generation)return;listening=true;controls();state('Jarvis hört zu · „Jarvis abbrechen“ beendet die Unterhaltung.');
  $('brainQuestion').focus();await api.startMic().catch(e=>api.toast(e.message,true));
}
async function cancel(){generation++;busy=false;listening=false;controls();state('Unterhaltung beendet');await Promise.all([api.stopSpeech(),api.invoke('brain:cancel')]);}
async function ask(text){
  text=String(text||'').trim();if(!text)return show();if(busy)throw Error('Jarvis beantwortet gerade eine Frage. Du kannst die Antwort abbrechen.');
  const current=++generation;listening=true;busy=true;controls();
  try{
    await api.invoke('provider:stop');if(current!==generation)return;
    $('brainQuestion').value='';$('brainPrompt').textContent=text;$('brainAnswer').textContent='';state('Jarvis denkt nach …');
    const result=await api.invoke('brain:ask',{text});if(current!==generation)return;
    $('brainAnswer').textContent=result.text;$('brainModelLabel').textContent=(result.provider==='groq'?'Groq':'Lokal')+' · '+result.model;
    state('Jarvis antwortet …');
    try{await api.say(result.text);}catch(e){if(current===generation)api.toast('Antwort angezeigt. Sprachausgabe: '+e.message,true);}
    if(current===generation)state('Jarvis hört zu · Stelle die nächste Frage oder sage „Jarvis abbrechen“.');
    return result;
  }catch(e){if(current===generation){state('Anfrage fehlgeschlagen');$('brainAnswer').textContent=e.message;throw e;}}
  finally{if(current===generation){busy=false;controls();}}
}
async function saveConfig(loadModels=false){
  const provider=$('brainProvider').value,patch={provider};
  if(provider==='local')patch.localUrl=$('brainLocalUrl').value.trim();
  const model=$('brainModelId').value.trim();if(!loadModels&&model)patch[provider==='groq'?'groqModel':'localModel']=model;
  const key=$('brainGroqKey').value.trim();if(provider==='groq'&&key)patch.groqApiKey=key;
  try{config=await api.invoke('brain:configure',patch);$('brainGroqKey').value='';renderConfig();}
  finally{delete patch.groqApiKey;}
  if(loadModels){
    const models=await api.invoke('brain:models',{provider}),list=$('brainModels');list.replaceChildren();
    for(const item of models){const option=document.createElement('option');option.value=item.id;option.textContent=item.name;list.append(option);}
    if(models.length&&!models.some(m=>m.id===$('brainModelId').value))$('brainModelId').value=models[0].id;
    $('brainModelCount').textContent=models.length?`${models.length} verfügbare Textmodelle · Modell wählen und übernehmen.`:'Keine Modelle gefunden. Bei Ollama zuerst ein Modell installieren.';
  }else api.toast(config.keyStorage==='memory'?'Modell gespeichert. Groq-Schlüssel gilt nur für diese Sitzung.':'KI-Modell gespeichert');
}
function click(id,fn){$(id).addEventListener('click',()=>Promise.resolve().then(fn).catch(e=>api.toast(e.message,true)));}
async function init(options){
  api=options;click('jarvisButton',show);click('brainCancel',cancel);click('brainReset',async()=>{await cancel();await api.invoke('brain:reset');$('brainPrompt').textContent='';$('brainAnswer').textContent='';state('Neues Gespräch');});
  $('brainForm').addEventListener('submit',event=>{event.preventDefault();void ask($('brainQuestion').value).catch(e=>api.toast(e.message,true));});
  click('brainSettings',async()=>{await api.invoke('provider:visibility',{visible:false});await refresh();$('brainDialog').showModal();});
  $('brainProvider').addEventListener('change',()=>{toggleFields();$('brainModelId').value=($('brainProvider').value==='groq'?config.groqModel:config.localModel)||'';$('brainModels').replaceChildren();$('brainModelCount').textContent='';});
  click('brainSave',()=>saveConfig());click('brainLoadModels',async()=>{$('brainLoadModels').disabled=true;try{await saveConfig(true);}finally{$('brainLoadModels').disabled=false;}});
  click('brainDeleteKey',async()=>{config=await api.invoke('brain:configure',{clearGroqKey:true});$('brainGroqKey').value='';renderConfig();api.toast('Groq-Schlüssel gelöscht');});
  $('brainDialog').addEventListener('close',()=>{$('brainGroqKey').value='';void api.invoke('provider:visibility',{visible:true});});
  controls();await refresh();
}
root.JarvisBrain={init,show,ask,cancel,isListening:()=>listening,isBusy:()=>busy,onProvider:()=>{generation++;busy=false;listening=false;controls();state('Original-Anbieterfenster geöffnet');},onEvent:event=>{if(event.type==='brain'&&event.status==='configured'){if(busy&&!event.busy){generation++;busy=false;controls();void api.stopSpeech();state('KI-Modell geändert');}if(!$('brainDialog').open)void refresh().catch(()=>{});else void api.invoke('brain:status').then(c=>{config=c;$('brainModelLabel').textContent=label();}).catch(()=>{});}}};
})(globalThis);
