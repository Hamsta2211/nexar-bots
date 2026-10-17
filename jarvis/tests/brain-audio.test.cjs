'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {parse,corroborateWake}=require('../ui/commands.js');const {PcmPump}=require('../ui/audio.js');
test('Jarvis starts, asks with original Unicode, and cancels without opening a provider',()=>{
 assert.deepEqual(parse('Jarvis',null,true),{type:'brain-start'});
 assert.deepEqual(parse('Jarvis abbrechen','claude',true),{type:'brain-cancel'});
 assert.deepEqual(parse('Jarvis was ist ChatGPT?',null,true),{type:'brain',text:'was ist ChatGPT?'});
 assert.deepEqual(parse('Jarvis, was bedeutet Grüße?',null,true),{type:'brain',text:'was bedeutet Grüße?'});
 assert.deepEqual(parse('Jarvis öffne Claude',null,true),{type:'start',id:'claude'});
});
test('measured ambiguous Jarvis onset is corrected only with both recognizers as evidence',()=>{
 let r=corroborateWake({text:'javascript',partial:true,command:'jarvis',commandPartial:true});assert.equal(r.evidence,true);
 r=corroborateWake({text:'ja was ist zwei plus zwei',partial:false,command:''},r.evidence);
 assert.equal(r.result.text,'Jarvis was ist zwei plus zwei');assert.equal(r.evidence,false);
 assert.equal(corroborateWake({text:'ich was was ist zwei plus zwei',partial:false},true).result.text,'Jarvis was ist zwei plus zwei');
 assert.deepEqual(parse(r.result.text,null,true),{type:'brain',text:'was ist zwei plus zwei'});
 assert.equal(corroborateWake({text:'ja was ist zwei plus zwei',partial:false,command:''}).result.text,'ja was ist zwei plus zwei');
 assert.equal(corroborateWake({text:'ja',partial:true,command:'jarvis'}).evidence,false);
 assert.equal(corroborateWake({text:'jahres',partial:true,command:'[unk] jarvis'}).evidence,false);
 assert.equal(corroborateWake({text:'javascript ist eine Programmiersprache',partial:false,command:'jarvis'},true).result.text,'javascript ist eine Programmiersprache');
});
test('pump reset drops old queued audio and old results but continues with new microphone audio',async()=>{
 let resolveFirst,sends=0;const results=[];
 const p=new PcmPump({send:()=>++sends===1?new Promise(r=>resolveFirst=r):Promise.resolve('new'),onResult:r=>results.push(r)});
 p.push(Float32Array.of(.1));p.push(Float32Array.of(.2));p.reset();p.push(Float32Array.of(.3));resolveFirst('old');
 await new Promise(r=>setImmediate(r));assert.equal(sends,2);assert.deepEqual(results,['new']);assert.equal(p.closed,false);p.close();
});
