const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('jarvis',Object.freeze({
 invoke:(action,payload)=>ipcRenderer.invoke('jarvis:invoke',action,payload),
 onEvent:(callback)=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('jarvis:event',listener);return ()=>ipcRenderer.removeListener('jarvis:event',listener);}
}));
