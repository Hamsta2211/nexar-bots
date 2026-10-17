'use strict';
const { app, BrowserWindow, WebContentsView, ipcMain, shell, session, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createService } = require('../core/service.cjs');
const { createBrain } = require('../core/brain.cjs');
const { ProviderStateController, voiceActionScript } = require('./providers.cjs');
let main, view, service, cloud, brain, providerId = null, shuttingDown = false, cloudSignedIn = false;
const providerWindows = new Set();
const providerController = new ProviderStateController({ emit: event => emit(event) });
const PROVIDERS = { chatgpt: { name: 'ChatGPT', url: 'https://chatgpt.com/' }, claude: { name: 'Claude', url: 'https://claude.ai/new' }, gemini: { name: 'Gemini', url: 'https://gemini.google.com/app' } };
const LOCAL = path.resolve(__dirname, '../ui/index.html');
const resourceDir = app.isPackaged ? process.resourcesPath : path.resolve(__dirname, '../resources');
if (!app.isPackaged) process.env.JARVIS_PYTHON = process.env.JARVIS_PYTHON || path.resolve(__dirname, process.platform === 'win32' ? '../resources-win/python/python.exe' : '../resources-linux/python/bin/python3');
function secureAvailable() { return safeStorage.isEncryptionAvailable() && (process.platform !== 'linux' || safeStorage.getSelectedStorageBackend?.() !== 'basic_text'); }
function emit(event) { if (main && !main.isDestroyed()) main.webContents.send('jarvis:event', event); }
function isLocal(contents) { return contents === main?.webContents; }
function originAllowed(url, kind) { try { const parsed = new URL(url); if (parsed.protocol !== 'https:') return false; const host = parsed.hostname.toLowerCase(); const list = kind === 'chatgpt' ? ['chatgpt.com', 'chat.openai.com'] : kind === 'claude' ? ['claude.ai'] : kind === 'gemini' ? ['gemini.google.com'] : []; return list.some(allowed => host === allowed || host.endsWith(`.${allowed}`)); } catch { return false; } }
function permissions(ses, kind, currentWebContents) {
  const allowed = (wc, url) => kind === 'local' ? wc === main?.webContents : wc === currentWebContents() && originAllowed(url, kind);
  ses.setPermissionCheckHandler((wc, permission, origin, details) => permission === 'media' && details?.mediaType !== 'video' && allowed(wc, origin));
  ses.setPermissionRequestHandler((wc, permission, done, details) => done(permission === 'media' && !details?.mediaTypes?.includes('video') && allowed(wc, details?.requestingUrl || wc.getURL())));
}
function layout() { if (view && main) { const [w, h] = main.getContentSize(); view.setBounds({ x: 240, y: 64, width: Math.max(100, w - 240), height: Math.max(100, h - 64) }); } }
function closeProviderWindows() {
  for (const popup of [...providerWindows]) { try { if (!popup.isDestroyed()) popup.destroy(); } catch {} providerWindows.delete(popup); }
}
function stopProvider() {
  providerController.stop();
  closeProviderWindows();
  const old = view; view = null; providerId = null;
  if (old) { try { main?.contentView.removeChildView(old); } catch {} try { old.webContents.setAudioMuted(true); old.webContents.close({ waitForBeforeUnload: false }); } catch {} }
  return { provider: null, status: 'idle' };
}
function startProvider(id) {
  if (!PROVIDERS[id]) throw Error('Unbekannter Anbieter');
  if (providerId === id && view) { providerController.rearm(); main.show(); main.focus(); return { provider: id, status: 'loading', reused: true }; }
  stopProvider(); providerId = id;
  const partition = `persist:jarvis-${id}`;
  view = new WebContentsView({ webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  const currentView = view;
  permissions(session.fromPartition(partition), id, () => currentView?.webContents);
  main.contentView.addChildView(currentView); layout();
  const wc = currentView.webContents;
  wc.setUserAgent(wc.getUserAgent().replace(/\sElectron\/[^ ]+/g, '').replace(/\s*nexar-jarvis\/[^ ]+/g, ''));
  wc.setWindowOpenHandler(({ url }) => /^https:\/\//i.test(url) ? { action: 'allow', overrideBrowserWindowOptions: { autoHideMenuBar: true, width: 620, height: 800, webPreferences: { partition, contextIsolation: true, nodeIntegration: false, sandbox: true } } } : { action: 'deny' });
  wc.on('did-create-window', popup => { providerWindows.add(popup); popup.on('closed', () => providerWindows.delete(popup)); });
  wc.on('will-navigate', (event, url) => { if (!/^https:\/\//i.test(url)) event.preventDefault(); });
  wc.on('render-process-gone', (_event, details) => { providerController.loaded=false; emit({ type: 'provider', provider: id, status: 'error', message: details?.reason || 'Provider-Oberfläche wurde beendet' }); });
  providerController.start(id, {
    load: () => wc.loadURL(PROVIDERS[id].url),
    probe: () => wc.executeJavaScript(voiceActionScript(id, !providerController.hasBeenActive), true)
  });
  main.show(); main.focus();
  return { provider: id, status: 'loading' };
}
async function invokeBrain(action, payload) {
  const result = await brain.invoke(action, payload);
  if (action === 'brain:configure' && cloudSignedIn && cloud) {
    const patch = {};
    if (payload?.provider !== undefined) patch.brainProvider = result.provider;
    for (const key of ['localModel', 'groqModel']) if (payload?.[key] !== undefined) patch[key] = result[key];
    if (Object.keys(patch).length) cloud.invoke('cloud:push', patch).catch(error => emit({ type: 'cloud-error', message: error.message }));
  }
  return result;
}
async function createWindow() {
  main = new BrowserWindow({ width: 1420, height: 920, minWidth: 1030, minHeight: 720, title: 'Jarvis', backgroundColor: '#0a0e15', autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } });
  permissions(main.webContents.session, 'local', () => main?.webContents);
  main.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  main.webContents.on('will-navigate', (event, url) => { if (url !== require('node:url').pathToFileURL(LOCAL).href) event.preventDefault(); });
  main.on('resize', layout); main.on('closed', () => { main = null; });
  brain = await createBrain({ dataDir: path.join(app.getPath('userData'), 'brain'), onEvent: emit, encrypt: text => secureAvailable() ? safeStorage.encryptString(text).toString('base64') : null, decrypt: text => secureAvailable() ? safeStorage.decryptString(Buffer.from(text, 'base64')) : null });
  service = await createService({ brainInvoke: invokeBrain, dataDir: path.join(app.getPath('userData'), 'core'), resourceDir, onEvent: event => { emit(event); if (event.type === 'settings' && main) main.setAlwaysOnTop(!!event.settings.alwaysOnTop); } });
  const config = JSON.parse(fs.readFileSync(path.join(resourceDir, 'cloud.json'), 'utf8'));
  const { createCloud } = require('./cloud.cjs');
  const cloudInvoke = createCloud({ dataDir: path.join(app.getPath('userData'), 'cloud'), config, onSettings: async settings => { const local = Object.fromEntries(Object.entries(settings).filter(([key]) => ['voice','weatherCity','alwaysOnTop'].includes(key))); const model = {}; if (settings.brainProvider !== undefined) model.provider = settings.brainProvider; for (const key of ['localModel','groqModel']) if (settings[key] !== undefined) model[key] = settings[key]; if (Object.keys(model).length) await brain.invoke('brain:configure', model); if (Object.keys(local).length) await service.invoke('settings:set', local); }, onEvent: event => { if(event.type === 'auth') cloudSignedIn = !!event.signedIn; emit(event); }, encrypt: text => secureAvailable() ? safeStorage.encryptString(text).toString('base64') : null, decrypt: text => secureAvailable() ? safeStorage.decryptString(Buffer.from(text, 'base64')) : null });
  cloud = { invoke: cloudInvoke, close: cloudInvoke.close };
  main.setAlwaysOnTop(!!(await service.invoke('settings:get')).alwaysOnTop);
  await main.loadFile(LOCAL);
}
const CORE_ACTIONS = new Set(['status', 'settings:get', 'settings:set', 'weather', 'voices', 'speak', 'recognizer:pcm', 'recognizer:reset', 'media', 'pairing:enable', 'pairing:disable', 'pairing:invite', 'devices', 'device:revoke']);
const BRAIN_ACTIONS = new Set(['brain:status','brain:configure','brain:models','brain:ask','brain:cancel','brain:reset']);
const AUTH_ACTIONS = new Set(['auth:status', 'auth:signup', 'auth:signin', 'auth:signout']);
const CLOUD_ACTIONS = new Set(['cloud:push', 'cloud:pull']);
ipcMain.handle('jarvis:invoke', async (event, action, payload) => {
  if (!isLocal(event.sender) || event.senderFrame !== main.webContents.mainFrame) throw Error('Nicht berechtigt');
  if (action === 'provider:start') { await brain.invoke('brain:cancel'); return startProvider(payload?.id); }
  if (BRAIN_ACTIONS.has(action)) return invokeBrain(action, payload);
  if (action === 'provider:stop') return stopProvider();
  if (action === 'provider:visibility') { if (view) view.setVisible(payload?.visible !== false); return {}; }
  if (action === 'provider:reload') { if (view) { view.webContents.reload(); providerController.rearm(); } return {}; }
  if (action === 'app:info') return { version: app.getVersion(), platform: process.platform, packaged: app.isPackaged };
  if (action === 'app:quit') { app.quit(); return {}; }
  if (action === 'help:gemini') { await shell.openExternal('https://support.google.com/gemini/answer/16363185?hl=de'); return {}; }
  if (AUTH_ACTIONS.has(action) || CLOUD_ACTIONS.has(action)) return cloud.invoke(action, payload);
  if (!CORE_ACTIONS.has(action)) throw Error('Unbekannter Befehl');
  const result = await service.invoke(action, payload);
  if (action === 'settings:set') {
    const patch = Object.fromEntries(Object.entries(payload || {}).filter(([key]) => ['voice', 'weatherCity', 'alwaysOnTop', 'wakeEnabled'].includes(key)));
    if (cloudSignedIn && Object.keys(patch).length) cloud.invoke('cloud:push', patch).catch(error => emit({ type: 'cloud-error', message: error.message }));
  }
  return result;
});
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
if (process.env.JARVIS_TEST_DATA_DIR) app.setPath('userData', path.resolve(process.env.JARVIS_TEST_DATA_DIR));
const single = app.requestSingleInstanceLock();
if (!single) app.quit(); else {
  app.on('second-instance', () => { if (main) { main.show(); main.focus(); } });
  app.whenReady().then(createWindow).catch(error => { console.error('Jarvis konnte nicht starten:', error.message); app.quit(); });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', event => { if (shuttingDown) return; event.preventDefault(); shuttingDown = true; stopProvider(); Promise.allSettled([service?.close(), cloud?.close?.(), brain?.close?.()]).finally(() => app.quit()); });
}
