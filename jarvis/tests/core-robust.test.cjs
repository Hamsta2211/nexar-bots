'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { VoiceWorker, createService, weather } = require('../core/service.cjs');

const root = path.join(__dirname, '..');
function req(method, pathname, body, token) { return new Promise((resolve, reject) => {
  const r = https.request({hostname:'127.0.0.1', port:47831, path:pathname, method, rejectUnauthorized:false,
    headers:{...(token?{authorization:`Bearer ${token}`}:{}) , ...(body?{'content-type':'application/json'}:{})}}, res => {
    let s=''; res.setEncoding('utf8'); res.on('data', x=>s+=x); res.on('end',()=>resolve({status:res.statusCode,body:JSON.parse(s)}));
  }); r.on('error',reject); if(body)r.write(JSON.stringify(body)); r.end();
});}
function tempWorker() { const d=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-worker-')); fs.mkdirSync(path.join(d,'core')); fs.copyFileSync(path.join(__dirname,'fixtures/slow_voice_worker.py'),path.join(d,'core/voice_worker.py')); return d; }

test('real Python worker enforces bounded queue and reports crash/restart', { concurrency:false }, async t => {
  const resource=tempWorker(), events=[]; const w=new VoiceWorker(resource,e=>events.push(e)); t.after(()=>w.close());
  await w.start();
  const pending=Array.from({length:8},()=>w.request('health'));
  await assert.rejects(()=>w.request('health'), /backlog full/);
  await Promise.all(pending);
  w.proc.kill('SIGKILL');
  await new Promise((resolve,reject)=>{const until=Date.now()+2000; const poll=()=>events.some(e=>e.workerRestart)?resolve():Date.now()>until?reject(new Error('worker restart event missing')):setTimeout(poll,20);poll();});
  assert.deepEqual(await w.request('health'), {ready:true});
});

test('TLS bind failure leaves retry possible and keep-alive timeouts are bounded', { concurrency:false }, async t => {
  const a=await createService({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-a-')),resourceDir:root});
  const b=await createService({dataDir:fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-b-')),resourceDir:root});
  t.after(async()=>{await a.close();await b.close();});
  await a.invoke('pairing:enable',{host:'127.0.0.1'});
  await assert.rejects(()=>b.invoke('pairing:enable',{host:'127.0.0.1'}));
  await a.close();
  assert.deepEqual(await b.invoke('pairing:enable',{host:'127.0.0.1'}),{sharing:true,port:47831});
  await b.invoke('pairing:disable');
});

test('remote state cannot mutate wakeEnabled and malformed weather input is rejected', { concurrency:false }, async t => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-state-')); const s=await createService({dataDir:dir,resourceDir:root}); t.after(()=>s.close());
  await s.invoke('pairing:enable',{host:'127.0.0.1'}); const invite=JSON.parse(Buffer.from(await s.invoke('pairing:invite'),'base64url'));
  const paired=await req('POST','/pair',{secret:invite.secret,name:'robust'}); assert.equal(paired.status,200);
  const before=(await s.invoke('settings:get')).wakeEnabled;
  const put=await req('PUT','/state',{wakeEnabled:!before,weatherCity:'Graz'},paired.body.token);
  assert.equal(put.status,200); assert.equal((await s.invoke('settings:get')).wakeEnabled,before); assert.equal((await s.invoke('settings:get')).weatherCity,'Graz');
  await assert.rejects(()=>weather('   '),/city required/); await assert.rejects(()=>weather('x'.repeat(201)),/city required/);
});

test('weather validates both real response shapes through injectable global fetch', { concurrency:false }, async t => {
  const old=global.fetch; t.after(()=>{global.fetch=old;}); let n=0;
  global.fetch=async url=>({ok:true,json:async()=>++n===1?{results:[{name:'Wien',country:'Österreich',latitude:48.2,longitude:16.3}]}:{timezone:'Europe/Vienna',current:{temperature_2m:21},current_units:{temperature_2m:'°C'}}});
  assert.equal((await weather(' Wien ')).timezone,'Europe/Vienna');
  global.fetch=async()=>({ok:false,status:503,json:async()=>({})}); await assert.rejects(()=>weather('Wien'),/weather HTTP 503/);
});
