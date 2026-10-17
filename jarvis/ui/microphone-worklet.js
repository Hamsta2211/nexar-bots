'use strict';
class JarvisCapture extends AudioWorkletProcessor {
  constructor(){super();this.buffer=new Float32Array(Math.max(1024,Math.round(sampleRate*0.256)));this.offset=0;}
  process(inputs){const channel=inputs[0]?.[0];if(channel){let at=0;while(at<channel.length){const n=Math.min(channel.length-at,this.buffer.length-this.offset);this.buffer.set(channel.subarray(at,at+n),this.offset);this.offset+=n;at+=n;if(this.offset===this.buffer.length){const size=this.buffer.length;this.port.postMessage(this.buffer,[this.buffer.buffer]);this.buffer=new Float32Array(size);this.offset=0;}}}return true;}
}
registerProcessor('jarvis-capture',JarvisCapture);
