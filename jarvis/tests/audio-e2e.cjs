'use strict';
// Real PulseAudio/PipeWire capture, real AudioWorklet + Vosk. Provider HTML is
// deliberately a fixture: this test does NOT certify authenticated cloud calls.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {spawn,spawnSync,execFileSync}=require('node:child_process');
const {promisify}=require('node:util'),execFile=promisify(require('node:child_process').execFile);
const {_electron:electron}=require('@playwright/test');
if(!process.env.JARVIS_AUDIO_DBUS){const r=spawnSync('dbus-run-session',['--',process.execPath,__filename],{stdio:'inherit',env:{...process.env,JARVIS_AUDIO_DBUS:'1'}});process.exit(r.status??1);}
const data=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-audio-e2e-'));
let app,player;const ownedModules=[];
(async()=>{
  if(!execFileSync('pactl',['list','short','sinks'],{encoding:'utf8'}).includes('jarvis_test'))ownedModules.push(execFileSync('pactl',['load-module','module-null-sink','sink_name=jarvis_test','sink_properties=device.description=Jarvis_Test_Audio'],{encoding:'utf8'}).trim());
  if(!execFileSync('pactl',['list','short','sources'],{encoding:'utf8'}).includes('jarvis_test_mic'))ownedModules.push(execFileSync('pactl',['load-module','module-virtual-source','source_name=jarvis_test_mic','master=jarvis_test.monitor','source_properties=device.description=Jarvis_Test_Microphone'],{encoding:'utf8'}).trim());
  if(!execFileSync('pactl',['list','short','sinks'],{encoding:'utf8'}).includes('jarvis_test_output'))ownedModules.push(execFileSync('pactl',['load-module','module-null-sink','sink_name=jarvis_test_output','sink_properties=device.description=Jarvis_Test_Speaker'],{encoding:'utf8'}).trim());
  const log=path.join(data,'calls.log'),ready=path.join(data,'mpris.ready');
  player=spawn('python3',[path.join(__dirname,'fixtures/mpris_fake.py'),log,ready],{stdio:'inherit'});
  for(let i=0;i<100&&!fs.existsSync(ready);i++)await new Promise(r=>setTimeout(r,20));assert.ok(fs.existsSync(ready));
  app=await electron.launch({executablePath:process.env.JARVIS_EXECUTABLE||undefined,args:[...(process.env.JARVIS_EXECUTABLE?[]:[path.resolve(__dirname,'..')]),'--no-sandbox','--disable-gpu'],env:{...process.env,JARVIS_TEST_DATA_DIR:data,PULSE_SINK:"jarvis_test_output"}});
  const page=await app.firstWindow(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.text().startsWith('AUDIO_DEBUG'))console.log(m.text());});
  await app.context().route(/https:\/\/(chatgpt\.com|claude\.ai|gemini\.google\.com)\//,async route=>{await route.fulfill({contentType:'text/html',body:'<!doctype html><title>Provider lifecycle fixture</title><button aria-label="Start voice mode" onclick="this.setAttribute(\'aria-label\',\'End voice conversation\');this.textContent=\'Fixture call active\'">Start fixture</button>'}).catch(()=>{});});
  await page.waitForFunction(()=>document.querySelector('#micButton').textContent.includes('ausschalten'),{timeout:30000});
  // Virtual-monitor test input is computer playback, not a physical microphone.
  // Disable processing only in this test; production defaults remain enabled.
  await page.evaluate(()=>{const get=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=c=>get({...c,audio:{...c.audio,echoCancellation:false,noiseSuppression:false,autoGainControl:false}});});
  await page.click('#settingsButton');
  const inputs=await page.locator('#inputDevice option').evaluateAll(es=>es.map(e=>({value:e.value,label:e.textContent})));
  const input=inputs.find(x=>/Jarvis.Test.Microphone/i.test(x.label));assert.ok(input,JSON.stringify(inputs));
  await page.selectOption('#inputDevice',input.value);
  await page.waitForFunction(()=>mic&&mic.getAudioTracks()[0].getSettings().echoCancellation===false&&document.querySelector('#micDetail').textContent.includes('Jarvis_Test_Microphone'),null,{timeout:15000});
  assert.equal(await page.evaluate(()=>capture.constructor.name),'AudioWorkletNode');
  await page.click('[data-close=settingsDialog]');
  console.log('REAL_CAPTURE',input.label,'AudioWorkletNode');await page.evaluate(()=>{window.__audioTest={peak:0,chunks:0,results:[]};const receive=capture.port.onmessage;capture.port.onmessage=e=>{window.__audioTest.chunks++;for(const x of e.data)window.__audioTest.peak=Math.max(window.__audioTest.peak,Math.abs(x));receive(e);};const onResult=pump.onResult;pump.onResult=r=>{if(r.text||r.command)window.__audioTest.results.push(r);onResult(r);};});
  const names=['ChatGPT','ChatGPT abbrechen','Claude','Claude abbrechen','Gemini','Gemini abbrechen','Jarvis nächstes Lied','Jarvis wie ist das Wetter in Wien'];
  for(let i=Number(process.env.JARVIS_AUDIO_START||0);i<names.length;i++){
    const mp3=path.join(__dirname,'fixtures/voice',`${i}.mp3`),wave=path.join(data,`${i}.wav`);
    assert.ok(fs.existsSync(mp3),mp3);
    await execFile('ffmpeg',['-v','error','-y','-i',mp3,'-af','adelay=500,apad=pad_dur=1.5','-ac','1','-ar','48000',wave]);
    await execFile('paplay',['--device=jarvis_test',wave]);
    if(i<6){const expected=i%2===0?['chatgpt','claude','gemini'][Math.floor(i/2)]:null;await page.waitForFunction(want=>active===want,expected,{timeout:12000});console.log('SPOKEN_PROVIDER_PASS',names[i],expected);}
    if(i===6){await page.waitForFunction(()=>document.querySelector('#toast').textContent.includes('Nächster Titel'),null,{timeout:10000});assert.match(fs.readFileSync(log,'utf8'),/Next/);console.log('SPOKEN_MEDIA_PASS','Next received by real D-Bus MPRIS');}
    if(i===7){await page.waitForFunction(()=>lastCommand===JSON.stringify({type:'weather',city:'wien'}),null,{timeout:10000});await page.waitForFunction(()=>lastWeatherCity==='wien'&&document.querySelector('#weatherSummary').textContent.includes('Stand'),null,{timeout:20000});console.log('SPOKEN_WEATHER_PASS',await page.locator('#weatherSummary').textContent());}
  }
  await page.evaluate(()=>say('Guten Tag. Ich bin Jarvis.','de-DE-ConradNeural'));assert.equal(await page.evaluate(()=>speaking),false);console.log('CONRAD_PLAYBACK_PASS');await page.evaluate(()=>stopPreview());
  if(process.env.JARVIS_AUDIO_BRAIN==='1'){
    await page.evaluate(()=>window.jarvis.invoke('brain:configure',{provider:'local',localUrl:'http://127.0.0.1:18944',localModel:'qwen2.5:0.5b'}));
    async function playBrain(name){const wave=path.join(data,name+'.wav');await execFile('ffmpeg',['-v','error','-y','-i',path.join(__dirname,'fixtures/voice',name+'.mp3'),'-af','adelay=300,apad=pad_dur=1.0','-ac','1','-ar','48000',wave]);await execFile('paplay',['--device=jarvis_test',wave]);}
    if(process.env.JARVIS_AUDIO_ONLY_CANCEL!=='1'){await playBrain('jarvis-question');await page.waitForFunction(()=>document.querySelector('#brainAnswer').textContent.length>0,null,{timeout:60000});assert.notEqual(await page.locator('#brainState').textContent(),'Anfrage fehlgeschlagen');
    console.log('SPOKEN_REAL_LOCAL_MODEL_PASS',await page.locator('#brainPrompt').textContent(),await page.locator('#brainAnswer').textContent());
    await page.waitForFunction(()=>!JarvisBrain.isBusy(),null,{timeout:30000});}else await page.click('#jarvisButton');
    await page.evaluate(()=>{window.__bargePlayback=say('Dies ist eine längere gesprochene Antwort. Du kannst mich während der Wiedergabe unterbrechen. Ich spreche absichtlich weiter, damit wir den Abbruch testen können. Die Antwort muss beim gesprochenen Abbruch sofort enden. Danach ist das Mikrofon weiterhin bereit für den nächsten Assistenten.');});
    await page.waitForFunction(()=>speaking,null,{timeout:30000});await page.evaluate(()=>{window.__audioTest.peak=0;window.__audioTest.chunks=0;window.__audioTest.results=[];window.__audioProbe={push:0,send:0,peak:0,raw:[],epoch:pump.generation,micGeneration};const oldPush=pump.push;pump.push=function(samples){window.__audioProbe.push++;return oldPush.call(this,samples);};const oldSend=pump.send;pump.send=async audio=>{window.__audioProbe.send++;const bytes=Uint8Array.from(atob(audio),x=>x.charCodeAt(0));const dv=new DataView(bytes.buffer);for(let i=0;i<bytes.length;i+=2)window.__audioProbe.peak=Math.max(window.__audioProbe.peak,Math.abs(dv.getInt16(i,true)));const r=await oldSend(audio);if(r.text||r.command)window.__audioProbe.raw.push(r);return r;};});await playBrain('jarvis-cancel');console.log('BARGE_MIC_SIGNAL',await page.evaluate(()=>({peak:window.__audioTest.peak,chunks:window.__audioTest.chunks,queued:pump.samples,running:pump.running,results:window.__audioTest.results,probe:window.__audioProbe})));await page.waitForFunction(()=>!speaking&&document.querySelector('#brainState').textContent==='Unterhaltung beendet',null,{timeout:10000});
    console.log('SPOKEN_JARVIS_BARGE_IN_CANCEL_PASS');await page.evaluate(()=>window.__bargePlayback);
  }
  assert.deepEqual(errors,[]);
  await page.screenshot({path:path.resolve(__dirname,'../release-audio-test.png')});
  console.log('AUDIO_E2E_PASS (synthetic speech, real capture/recognizer; provider pages are fixtures)');
})().catch(async e=>{if(app)console.log('AUDIO_FAILURE_STATE',JSON.stringify(await app.firstWindow().then(p=>p.evaluate(()=>({heard:document.querySelector('#heard').textContent,active,audio:window.__audioTest,context:context?.state,mic:mic?.getAudioTracks().map(t=>({label:t.label,enabled:t.enabled,muted:t.muted,settings:t.getSettings()})),pumpClosed:pump?.closed,speaking,toast:document.querySelector('#toast').textContent}))).catch(()=>null)));console.error(e);process.exitCode=1;}).finally(async()=>{
  if(app)await app.close().catch(()=>{});player?.kill('SIGTERM');for(const id of ownedModules.reverse())try{execFileSync('pactl',['unload-module',id]);}catch{}fs.rmSync(data,{recursive:true,force:true});
});
