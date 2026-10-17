const {app,BrowserWindow,WebContentsView,ipcMain,shell,session,safeStorage}=require('electron');
const fs=require('node:fs'); const path=require('node:path');
const {createService}=require('../core/service.cjs');
const {voiceActionScript}=require('./providers.cjs');
let main,view,service,cloud,provider=null,voiceTimer=null,shuttingDown=false;
const PROVIDERS={chatgpt:{name:'ChatGPT',url:'https://chatgpt.com/'},claude:{name:'Claude',url:'https://claude.ai/new'},gemini:{name:'Gemini',url:'https://gemini.google.com/app'}};
const LOCAL=path.resolve(__dirname,'../ui/index.html');
const resourceDir=app.isPackaged?process.resourcesPath:path.resolve(__dirname,'../resources');
if(!app.isPackaged)process.env.JARVIS_PYTHON=process.env.JARVIS_PYTHON||path.resolve(__dirname,process.platform==='win32'?'../resources-win/python/python.exe':'../resources-linux/python/bin/python3');
function secureAvailable(){return safeStorage.isEncryptionAvailable()&&(process.platform!=='linux'||safeStorage.getSelectedStorageBackend?.()!=='basic_text');}
function emit(event){if(main&&!main.isDestroyed())main.webContents.send('jarvis:event',event);}
function isLocal(contents){return contents===main?.webContents;}
function originAllowed(url,kind){try{const host=new URL(url).hostname;const list=kind==='chatgpt'?['chatgpt.com','chat.openai.com']:kind==='claude'?['claude.ai']:kind==='gemini'?['gemini.google.com']:[];return list.includes(host);}catch{return false;}}
function permissions(ses,kind){
 ses.setPermissionCheckHandler((wc,permission,origin)=>permission==='media'&&(kind==='local'?wc===main?.webContents:originAllowed(origin,kind)));
 ses.setPermissionRequestHandler((wc,permission,done,details)=>{const url=details?.requestingUrl||wc.getURL();done(permission==='media'&&(kind==='local'?wc===main?.webContents:originAllowed(url,kind)));});
}
function layout(){if(view&&main){const [w,h]=main.getContentSize();view.setBounds({x:310,y:80,width:Math.max(100,w-310),height:Math.max(100,h-80)});}}
function stopProvider(){clearInterval(voiceTimer);voiceTimer=null;if(view){const old=view;view=null;main.contentView.removeChildView(old);old.webContents.setAudioMuted(true);old.webContents.close();}provider=null;emit({type:'provider',provider:null,status:'idle'});return {provider:null};}
async function startProvider(id){
 if(!PROVIDERS[id])throw Error('Unbekannter Anbieter');
 if(provider===id&&view){main.show();main.focus();return {provider:id};}
 stopProvider();provider=id;
 const partition='persist:jarvis-'+id;permissions(session.fromPartition(partition),id);
 view=new WebContentsView({webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 main.contentView.addChildView(view);layout();
 const wc=view.webContents;wc.setUserAgent(wc.getUserAgent().replace(/\sElectron\/[^ ]+/g,'').replace(/\s*nexar-jarvis\/[^ ]+/g,''));
 wc.setWindowOpenHandler(({url})=>{if(!/^https:\/\//.test(url))return {action:'deny'};return {action:'allow',overrideBrowserWindowOptions:{autoHideMenuBar:true,width:620,height:800,webPreferences:{partition,contextIsolation:true,nodeIntegration:false,sandbox:true}}};});
 wc.on('will-navigate',(e,url)=>{if(!/^https:\/\//.test(url)){e.preventDefault();}});
 let tries=0,confirmed=false,busy=false;
 const attempt=async()=>{if(busy||wc.isDestroyed()||provider!==id)return;busy=true;try{const r=await wc.executeJavaScript(voiceActionScript(id),true);if(r.state==='active'){confirmed=true;emit({type:'provider',provider:id,status:'active',message:'Voice-Oberfläche erkannt'});clearInterval(voiceTimer);}else if(r.state==='clicked'){emit({type:'provider',provider:id,status:'starting',message:'Voice-Schaltfläche geöffnet'});}if(++tries>=40&&!confirmed){clearInterval(voiceTimer);emit({type:'provider',provider:id,status:'needs-action',message:id==='gemini'?'Kein Live-Knopf gefunden. Gemini Live ist ggf. nur in unterstütztem Chrome verfügbar.':'Bitte anmelden oder den Voice-Knopf einmal manuell öffnen. Die Anbieteroberfläche wurde nicht verändert.'});}}catch(e){if(++tries>=40)clearInterval(voiceTimer);}finally{busy=false;}};
 wc.on('did-finish-load',()=>{tries=0;clearInterval(voiceTimer);voiceTimer=setInterval(attempt,750);attempt();});
 wc.on('did-fail-load',(_e,code,description,_url,isMain)=>{if(isMain&&code!==-3)emit({type:'provider',provider:id,status:'error',message:description});});
 emit({type:'provider',provider:id,status:'loading',message:'Originalseite wird geöffnet'});
 await wc.loadURL(PROVIDERS[id].url);main.show();main.focus();return {provider:id};
}
async function createWindow(){
 main=new BrowserWindow({width:1420,height:920,minWidth:1030,minHeight:720,title:'Jarvis Voice',backgroundColor:'#0a0e15',autoHideMenuBar:true,webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true,backgroundThrottling:false}});
 permissions(main.webContents.session,'local');
 main.webContents.setWindowOpenHandler(()=>({action:'deny'}));
 main.webContents.on('will-navigate',(e,url)=>{if(url!==require('node:url').pathToFileURL(LOCAL).href)e.preventDefault();});
 main.on('resize',layout);main.on('closed',()=>{main=null;});
 service=await createService({dataDir:path.join(app.getPath('userData'),'core'),resourceDir,onEvent:(event)=>{emit(event);if(event.type==='settings'&&main)main.setAlwaysOnTop(!!event.settings.alwaysOnTop);}});
 const config=JSON.parse(fs.readFileSync(path.join(resourceDir,'cloud.json'),'utf8'));
 const {createCloud}=require('./cloud.cjs');
 const cloudInvoke=createCloud({dataDir:path.join(app.getPath('userData'),'cloud'),config,onSettings:async(settings)=>{const local={...settings};delete local.wakeEnabled;await service.invoke('settings:set',local);},onEvent:emit,
 encrypt:(text)=>secureAvailable()?safeStorage.encryptString(text).toString('base64'):null,
 decrypt:(text)=>secureAvailable()?safeStorage.decryptString(Buffer.from(text,'base64')):null});
 cloud={invoke:cloudInvoke,close:cloudInvoke.close};
 main.setAlwaysOnTop(!!(await service.invoke('settings:get')).alwaysOnTop);
 await main.loadFile(LOCAL);
}
const CORE_ACTIONS=new Set(['status','settings:get','settings:set','weather','voices','speak','recognizer:pcm','recognizer:reset','media','pairing:enable','pairing:disable','pairing:invite','devices','device:revoke']);
ipcMain.handle('jarvis:invoke',async(event,action,payload)=>{
 if(!isLocal(event.sender)||event.senderFrame!==main.webContents.mainFrame)throw Error('Nicht berechtigt');
 if(action==='provider:start')return startProvider(payload?.id);
 if(action==='provider:stop')return stopProvider();
 if(action==='provider:visibility'){if(view)view.setVisible(payload?.visible!==false);return {};}
 if(action==='provider:reload'){if(view)view.webContents.reload();return {};}
 if(action==='app:info')return {version:app.getVersion(),platform:process.platform,packaged:app.isPackaged};
 if(action==='app:quit'){app.quit();return {};}
 if(action==='help:gemini'){await shell.openExternal('https://support.google.com/gemini/answer/16363185?hl=de');return {};}
 if(action.startsWith('auth:')||action.startsWith('cloud:')){const result=await cloud.invoke(action,payload);if(action==='auth:github'&&result?.url)await shell.openExternal(result.url);return result;}
 if(!CORE_ACTIONS.has(action))throw Error('Unbekannter Befehl');
 const result=await service.invoke(action,payload);
 if(action==='settings:set')cloud.invoke('cloud:push',Object.fromEntries(Object.entries(result).filter(([key])=>['voice','weatherCity','alwaysOnTop','wakeEnabled'].includes(key)))).catch(e=>emit({type:'cloud-error',message:e.message}));
 return result;
});
const single=app.requestSingleInstanceLock();if(!single)app.quit();else{
 app.on('second-instance',()=>{if(main){main.show();main.focus();}});
 app.whenReady().then(createWindow).catch(e=>{console.error('Jarvis konnte nicht starten:',e.message);app.quit();});
 app.on('window-all-closed',()=>app.quit());
 app.on('before-quit',e=>{if(shuttingDown)return;e.preventDefault();shuttingDown=true;clearInterval(voiceTimer);Promise.allSettled([service?.close(),cloud?.close?.()]).finally(()=>app.quit());});
}
