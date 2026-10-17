'use strict';
const {createBrain}=require('../core/brain.cjs'),{createService}=require('../core/service.cjs'),https=require('node:https'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),assert=require('node:assert/strict');
function call(base,route,method,body,token){return new Promise((resolve,reject)=>{const r=https.request(new URL(route,base),{method,rejectUnauthorized:false,headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})}},s=>{let b='';s.on('data',d=>b+=d);s.on('end',()=>{try{resolve({status:s.statusCode,body:JSON.parse(b)});}catch(e){reject(e);}});});r.on('error',reject);r.end(body?JSON.stringify(body):undefined);});}
(async()=>{const dir=await fs.mkdtemp(path.join(os.tmpdir(),'jarvis-real-bridge-'));let brain,service;
try{
 brain=await createBrain({dataDir:path.join(dir,'brain')});service=await createService({dataDir:path.join(dir,'core'),resourceDir:path.resolve(__dirname,'../resources'),brainInvoke:(a,p)=>brain.invoke(a,p)});
 await brain.invoke('brain:configure',{provider:'local',localUrl:process.env.JARVIS_OLLAMA_TEST_URL||'http://127.0.0.1:18944',localModel:process.env.JARVIS_OLLAMA_TEST_MODEL||'qwen2.5:0.5b'});
 await service.invoke('pairing:enable',{host:'127.0.0.9'});const invite=JSON.parse(Buffer.from(await service.invoke('pairing:invite',{host:'127.0.0.9'}),'base64url').toString());
 const paired=await call(invite.url,'/pair','POST',{secret:invite.secret,name:'Local integration test'});const token=paired.body.token;assert.equal(paired.status,200);assert.ok(token);
 const unauthorized=await call(invite.url,'/brain','GET');assert.equal(unauthorized.status,401);
 const result=await call(invite.url,'/brain/ask','POST',{text:'Sag kurz: zwei plus zwei ist vier.'},token);assert.equal(result.status,200);assert.ok(result.body.text);assert.equal(result.body.provider,'local');
 console.log('REAL_TLS_BRAIN_RESPONSE',result.body);console.log('REAL_AUTHENTICATED_DEVICE_BRAIN_PASS');
}finally{await service?.close();await brain?.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exit(1);});
