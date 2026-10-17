(function(root){
  'use strict';
  function encodePCM(samples){
    const bytes=new Uint8Array(samples.length*2),view=new DataView(bytes.buffer);
    for(let i=0;i<samples.length;i++){const f=Math.max(-1,Math.min(1,samples[i]||0));view.setInt16(i*2,Math.round(f<0?f*32768:f*32767),true);}
    let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));
    return typeof btoa==='function'?btoa(binary):Buffer.from(bytes).toString('base64');
  }
  class Resampler{
    constructor(inputRate,outputRate=16000){if(!Number.isFinite(inputRate)||inputRate<8000)throw Error('Ungültige Abtastrate');this.ratio=inputRate/outputRate;this.position=0;this.previous=null;}
    process(chunk){
      if(this.ratio===1)return new Float32Array(chunk);
      const input=this.previous===null?chunk:Float32Array.from([this.previous,...chunk]);
      const result=[];
      while(this.position<input.length-1){const i=Math.floor(this.position),f=this.position-i;result.push(input[i]*(1-f)+input[i+1]*f);this.position+=this.ratio;}
      this.position-=input.length-1;this.previous=input[input.length-1];return Float32Array.from(result);
    }
  }
  class PcmPump{
    constructor({send,onResult,onError,onOverflow,maxSamples=16000*4}){Object.assign(this,{send,onResult,onError,onOverflow,maxSamples});this.queue=[];this.samples=0;this.running=false;this.closed=false;}
    push(samples){if(this.closed||!samples.length)return;const copy=new Float32Array(samples);if(this.samples+copy.length>this.maxSamples){this.queue=[];this.samples=0;this.onOverflow?.();return;}this.queue.push(copy);this.samples+=copy.length;this.drain();}
    async drain(){if(this.running||this.closed)return;this.running=true;try{while(this.queue.length&&!this.closed){const next=this.queue.shift();this.samples-=next.length;const result=await this.send(encodePCM(next));if(!this.closed)this.onResult?.(result);}}catch(e){if(!this.closed)this.onError?.(e);}finally{this.running=false;if(this.queue.length&&!this.closed)this.drain();}}
    close(){this.closed=true;this.queue=[];this.samples=0;}
  }
  const api={encodePCM,Resampler,PcmPump};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.JarvisAudio=api;
})(globalThis);
