'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {spawn, spawnSync, execFileSync} = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {media} = require('../core/service.cjs');

if (!process.env.JARVIS_DBUS_TEST) {
  const r=spawnSync('dbus-run-session',['--',process.execPath,__filename],{stdio:'inherit',env:{...process.env,JARVIS_DBUS_TEST:'1'}});
  process.exitCode=r.status ?? 1;
} else {
  test('real dbus-next MPRIS player receives playerctl dispatches', {concurrency:false}, async t => {
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'jarvis-mpris-')), log=path.join(dir,'calls.log'), ready=path.join(dir,'ready');
    const p=spawn('python3',[path.join(__dirname,'fixtures/mpris_fake.py'),log,ready],{stdio:'ignore'}); t.after(()=>p.kill('SIGTERM'));
    for(let i=0;i<100&&!fs.existsSync(ready);i++) await new Promise(r=>setTimeout(r,20)); assert.ok(fs.existsSync(ready),'fake MPRIS player did not start');
    for (const action of ['next','previous','playpause','stop']) { const out=await media(action); assert.equal(out.ok,true); assert.ok(['playerctl','gdbus'].includes(out.backend)); }
    const calls=fs.readFileSync(log,'utf8').trim().split(/\n/); assert.deepEqual(calls,['Next','Previous','PlayPause','Stop']);
  });
  test('dedicated PulseAudio test endpoints exist and accept isolated PCM samples', {concurrency:false}, () => {
    const sinks=execFileSync('pactl',['list','short','sinks'],{encoding:'utf8'}), sources=execFileSync('pactl',['list','short','sources'],{encoding:'utf8'});
    assert.match(sinks,/jarvis_test/); assert.match(sources,/jarvis_test_mic/);
    const pcm=Buffer.alloc(4800); const child=require('node:child_process').spawnSync('pacat',['--playback','--device=jarvis_test','--format=s16le','--rate=16000','--channels=1'],{input:pcm,stdio:['pipe','ignore','pipe']});
    assert.equal(child.status,0,child.stderr.toString());
  });
}
