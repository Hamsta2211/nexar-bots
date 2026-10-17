'use strict';
const { _electron:electron }=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),http=require('node:http');
(async()=>{
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-brain-ui-')),errors=[];
 const slow=http.createServer((req,res)=>{req.resume();if(req.url==='/api/chat'){const timer=setTimeout(()=>{if(!res.destroyed){res.setHeader('content-type','application/json');res.end(JSON.stringify({message:{content:'VERSPAETETE_ANTWORT'}}));}},15000);res.on('close',()=>clearTimeout(timer));}else{res.setHeader('content-type','application/json');res.end(JSON.stringify({models:[{name:'slow-test'}]}));}});await new Promise(r=>slow.listen(0,'127.0.0.1',r));
 let app;
 try{
  app=await electron.launch({executablePath:process.env.JARVIS_EXECUTABLE||undefined,args:[...(process.env.JARVIS_EXECUTABLE?[]:[path.resolve(__dirname,'..')]),'--no-sandbox','--disable-gpu','--use-fake-ui-for-media-stream','--use-fake-device-for-media-stream'],env:{...process.env,JARVIS_TEST_DATA_DIR:dir}});
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));await page.waitForFunction(()=>document.querySelector('#micButton').textContent.includes('ausschalten'),{timeout:30000});
  await page.click('#brainSettings');await page.fill('#brainLocalUrl',process.env.JARVIS_OLLAMA_TEST_URL||'http://127.0.0.1:18944');await page.click('#brainLoadModels');await page.waitForFunction(()=>document.querySelector('#brainModels').options.length>0,{timeout:30000});
  await page.fill('#brainModelId',process.env.JARVIS_OLLAMA_TEST_MODEL||'qwen2.5:0.5b');await page.click('#brainSave');await page.click('[data-close="brainDialog"]');
  await page.fill('#brainQuestion','Antworte mit einem kurzen Satz: Was ist zwei plus zwei?');await page.click('#brainSend');
  await page.waitForFunction(()=>document.querySelector('#brainAnswer').textContent.length>0,{timeout:90000});assert.notEqual(await page.locator('#brainState').textContent(),'Anfrage fehlgeschlagen');
  assert.match(await page.locator('#brainModelLabel').textContent(),/Lokal/);console.log('REAL_LOCAL_UI_RESPONSE',await page.locator('#brainAnswer').textContent());
  await page.screenshot({path:path.resolve(__dirname,'../release-brain-preview.png')});await page.click('#brainCancel');
  await page.click('#brainSettings');await page.selectOption('#brainProvider','groq');await page.fill('#brainGroqKey','test-groq-key-not-real-for-storage');await page.click('#brainSave');
  await page.waitForFunction(()=>document.querySelector('#brainGroqKey').value==='');const safe=await page.evaluate(()=>window.jarvis.invoke('brain:status'));assert.equal(safe.hasGroqKey,true);assert.ok(['memory','encrypted'].includes(safe.keyStorage));assert.ok(!JSON.stringify(safe).includes('test-groq-key'));
  console.log('GROQ_KEY_UI_STORAGE',safe.keyStorage);await page.click('#brainDeleteKey');await page.waitForFunction(()=>document.querySelector('#brainKeyStatus').textContent.includes('Kein Groq'));
  await page.click('[data-close="brainDialog"]');
  await page.evaluate(async url=>window.jarvis.invoke('brain:configure',{provider:'local',localUrl:url,localModel:'slow-test'}),'http://127.0.0.1:'+slow.address().port);
  await page.fill('#brainQuestion','Warte auf eine Antwort.');await page.click('#brainSend');await page.waitForFunction(()=>document.querySelector('#brainState').textContent.includes('denkt'));
  await page.click('#jarvisButton');assert.match(await page.locator('#brainState').textContent(),/denkt/);
  await page.click('#brainCancel');await page.waitForFunction(()=>document.querySelector('#brainState').textContent==='Unterhaltung beendet');assert.equal((await page.evaluate(()=>window.jarvis.invoke('brain:status'))).busy,false);
  await page.waitForTimeout(400);assert.ok(!(await page.locator('#brainAnswer').textContent()).includes('VERSPAETETE_ANTWORT'));assert.deepEqual(errors,[]);
  console.log('BRAIN_DESKTOP_PASS: actual local inference, model settings, key save/delete, cancel without late answer');
 }finally{if(app)await app.close();await new Promise(r=>slow.close(r));await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
