'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const commands=require('../ui/commands.js');
const source=fs.readFileSync(require('node:path').join(__dirname,'../ui/app.js'),'utf8');
const body=source.slice(source.indexOf('function audioResult('),source.indexOf('async function startMic('));
function run(result){const calls=[],context=vm.createContext({active:null,JarvisCommands:commands,handleTranscript:(text,partial)=>{calls.push({text,partial});return !!commands.parse(text,null);}});vm.runInContext(body,context);context.audioResult(result);return calls;}
test('a final grammar-confirmed wake word is not lost behind a provisional matching transcript',()=>{const calls=run({text:'chat g pc',partial:true,command:'chat g p t',commandPartial:false});assert.equal(calls.length,2);assert.equal(calls[1].partial,false);});
test('weather is never replaced with an unrelated provider interpretation',()=>{const calls=run({text:'Jarvis wie ist das Wetter',partial:true,command:'Claude',commandPartial:false});assert.equal(calls.length,1);});
test('a different constrained provider does not replace a recognized provisional provider',()=>{assert.equal(run({text:'Claude',partial:true,command:'ChatGPT',commandPartial:false}).length,1);});
test('unknown-word constrained guesses never trigger a provider',()=>{assert.equal(run({text:'unverständlich',partial:false,command:'[unk] chat g p t',commandPartial:false}).length,1);});
