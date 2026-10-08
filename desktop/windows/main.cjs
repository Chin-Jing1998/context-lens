const { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, nativeTheme, screen, shell, dialog, utilityProcess } = require('electron');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { spawn } = require('node:child_process');
const { canOpenGithub, fit } = require('./guards.cjs');
const root = path.resolve(__dirname, '../..');
const smokeAt = process.argv.indexOf('--smoke-test'), smokeFile = smokeAt >= 0 ? process.argv[smokeAt + 1] : null;
if (smokeFile) app.setPath('userData', path.join(os.tmpdir(), 'context-lens-smoke-' + process.pid));
if (!app.requestSingleInstanceLock()) app.quit();
app.setAppUserModelId('io.github.Chin-Jing1998.context-lens');
const presets = {
  native: ['system', false, false, 'native', 0], glass: ['song', false, false, 'settle', 12],
  graphite: ['fangsong', true, false, 'magnetic', 24], porcelain: ['kai', false, false, 'settle', 20],
  spectrum: ['song', true, false, 'sequence', 24], contrast: ['song', false, true, 'magnetic', 20],
  ink: ['song', false, false, 'instant', 16], bronze: ['fangsong', true, true, 'settle', 28], cobalt: ['kai', true, false, 'sequence', 24],
};
let preferences = { uiTheme: 'ink', view: 'budget', theme: 'auto', reduceMotion: false, locked: false };
const preferencesFile = path.join(app.getPath('userData'), 'desktop.json');
try {
  const saved = JSON.parse(fs.readFileSync(preferencesFile, 'utf8'));
  if (presets[saved.uiTheme]) preferences.uiTheme = saved.uiTheme;
  if (['budget', 'model'].includes(saved.view)) preferences.view = saved.view;
  if (['auto', 'light', 'dark'].includes(saved.theme)) preferences.theme = saved.theme;
  for (const key of ['reduceMotion', 'locked']) if (typeof saved[key] === 'boolean') preferences[key] = saved[key];
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) { preferences.x = saved.x; preferences.y = saved.y; }
} catch { /* First launch uses the fixed ink theme. */ }
const save = () => { fs.mkdirSync(path.dirname(preferencesFile), { recursive: true }); const next = preferencesFile + '.tmp'; fs.writeFileSync(next, JSON.stringify(preferences)); fs.renameSync(next, preferencesFile); };
const style = () => { const p = presets[preferences.uiTheme]; return { uiTheme: preferences.uiTheme, uiChinese: p[0], uiBold: String(p[1]), uiItalic: String(p[2]), uiMotion: p[3] }; };
const surfaceStyle = () => ({ uiTheme: preferences.uiTheme, chinese: presets[preferences.uiTheme][0], typeBold: String(presets[preferences.uiTheme][1]), typeItalic: String(presets[preferences.uiTheme][2]), uiMotion: presets[preferences.uiTheme][3], theme: preferences.theme });
const widths = { context: 360, usage: 396, cost: 440, commands: 420, skills: 420, mcp: 420, runtime: 460 };
const heights = { context: 320, usage: 520, cost: 420, commands: 500, skills: 500, mcp: 500, runtime: 500 };
let ball, orbit, detail, tray, backend, origin, watcher, watcherStartup, pollTimer, foreground = null;
let island = 'context', selection = '', snapshot = null, orbitOpen = false, pinned = false, settingsOpen = false, hidden = false, forced = false, refreshing = false, revision = 0, dragOrigin;
let contentHeights = {}, settingsHeight = 420;
let watcherAvailable = false;
const validSession = value => typeof value === 'string' && /^(claude|codex|opencode|mimocode|deepseek|zcode):[a-zA-Z0-9_-]{1,100}$/.test(value);
const emit = (window, name, data) => { if (window && !window.isDestroyed() && !window.webContents.isLoading()) window.webContents.send('lens-event', name, data); };
const environment = () => emit(detail, 'context-lens-environment', { desktopConnected: true, platform: process.platform, accessibilityTrusted: watcherAvailable, reduceMotion: preferences.reduceMotion || nativeTheme.prefersReducedMotion, systemReduceMotion: nativeTheme.prefersReducedMotion });
function placeBall(x, y) {
  const area = screen.getDisplayNearestPoint({ x: Math.round(x), y: Math.round(y) }).workArea;
  ball.setBounds(fit({ x, y, width: 76, height: 76 }, area));
  const position = ball.getBounds(); preferences.x = position.x; preferences.y = position.y;
  placeOrbit(); fitDetail();
}
function placeOrbit() { const b = ball.getBounds(), area = screen.getDisplayMatching(b).workArea; orbit.setBounds(fit({ x: b.x - 100, y: b.y - 100, width: 276, height: 276 }, area)); }
function fitDetail() {
  if (!detail) return;
  const b = ball.getBounds(), o = orbit.getBounds(), area = screen.getDisplayMatching(b).workArea;
  const width = Math.min((settingsOpen ? 420 : widths[island]) + presets[preferences.uiTheme][4], area.width);
  const height = Math.min(Math.max(112, settingsOpen ? settingsHeight : contentHeights[island] || heights[island]), 640, area.height);
  const right = area.x + area.width - (o.x + o.width), left = o.x - area.x;
  const x = right >= width + 12 || right >= left ? o.x + o.width + 12 : o.x - width - 12;
  detail.setBounds(fit({ x, y: b.y + 38 - height / 2, width, height }, area));
}
const count = value => typeof value !== 'number' ? '—' : value >= 1000000 ? (value / 1000000).toFixed(1) + 'M' : value >= 1000 ? (value / 1000).toFixed(1) + 'k' : value.toLocaleString('zh-CN');
function surface() {
  const context = snapshot?.context, activities = snapshot?.activity || {};
  const cost = snapshot?.cost, totals = snapshot?.totals?.all, timing = snapshot?.timing;
  const activityCount = key => activities[key] ? activities.complete === false && activities[key].total === 0 ? '—' : (activities.complete === false ? '≥' : '') + count(activities[key].total) : '—';
  const seconds = typeof timing?.elapsedMs === 'number' ? Math.floor(timing.elapsedMs / 1000) : null;
  const values = { context: context?.percent == null ? '—' : context.percent.toFixed(1) + '%',
    usage: totals ? (totals.complete ? '' : '≥') + count(totals.input + totals.output) : '—',
    cost: typeof cost?.amount === 'number' ? (cost.currency === 'USD' ? '$' : cost.currency === 'CNY' ? '¥' : cost.currency + ' ') + cost.amount.toFixed(2) : '—',
    commands: activityCount('commands'), skills: activityCount('skills'), mcp: activityCount('mcp'),
    runtime: seconds === null ? '—' : (timing.startAccuracy === 'observed' ? '≈' : '') + (seconds >= 3600 ? Math.floor(seconds / 3600) + 'h ' + String(Math.floor(seconds / 60) % 60).padStart(2, '0') + 'm' : Math.floor(seconds / 60) + 'm ' + String(seconds % 60).padStart(2, '0') + 's') };
  const data = { style: surfaceStyle(), reduceMotion: preferences.reduceMotion || nativeTheme.prefersReducedMotion, percent: context?.percent ?? null, values, island };
  emit(ball, 'surface', { ...data, surface: 'ball' }); emit(orbit, 'surface', { ...data, surface: 'orbit' });
}
function collapse() { orbitOpen = false; pinned = false; settingsOpen = false; forced = false; orbit.hide(); detail.hide(); }
function showIsland(name) {
  if (!Object.hasOwn(widths, name)) return;
  island = name; pinned = true; settingsOpen = false; forced = true; orbitOpen = true; placeOrbit(); orbit.showInactive(); fitDetail(); detail.show();
  emit(detail, 'context-lens-island', name); surface();
}
function settings() { hidden = false; forced = true; pinned = true; settingsOpen = true; fitDetail(); detail.show(); emit(detail, 'context-lens-command', 'settings'); }
function toolFor(name, title) {
  const value = (name + ' ' + title).toLowerCase();
  for (const tool of ['codex', 'claude', 'opencode', 'mimocode', 'deepseek', 'zcode']) if (value.includes(tool)) return tool;
  return null;
}
function follow(next) {
  if (!next.pid || next.pid === process.pid || /^context lens$/i.test(next.name) || /^electron$/i.test(next.name)) return;
  const client = toolFor(next.name, next.title), terminal = /^(windowsterminal|wt|powershell|pwsh|cmd|conhost)$/i.test(next.name);
  const supported = Boolean(client || terminal), identity = next.pid + ':' + next.title;
  if (foreground?.identity === identity) return;
  foreground = { ...next, client, supported, identity };
  revision++; selection = ''; snapshot = null; emit(detail, 'context-lens-active', { session: '', reason: '正在定位当前对话' }); surface();
  if (!settingsOpen) collapse();
  if (!supported && !forced) ball.hide(); else if (!hidden) ball.showInactive();
  void refresh();
}
async function read(url) { const response = await fetch(origin + url, { signal: AbortSignal.timeout(8000) }); if (!response.ok) throw new Error('Local service unavailable'); return response.json(); }
async function refresh(manual = false) {
  if (refreshing || !origin) return;
  refreshing = true; const currentRevision = revision;
  try {
    if (process.platform === 'win32' && !foreground?.supported) { if (manual) emit(detail, 'context-lens-detection', { state: 'waiting' }); return; }
    const target = foreground;
    const query = new URLSearchParams(); if (target?.pid) query.set('pid', String(target.pid)); if (target?.client) query.set('client', target.client);
    const id = target?.title.match(/(?:[a-f0-9]{8}-){1}[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/i)?.[0];
    if (id) query.set('visibleId', id);
    // Only exact unique local titles can select a visible conversation.
    if (target?.client && !id && !/^(windowsterminal|wt|powershell|pwsh|cmd|conhost)$/i.test(target.name)) {
      const title = target.title.replace(/\s*[-—|]\s*(?:Codex|Claude(?: Code)?)\s*$/i, '').trim(); if (title && title !== target.name) query.set('visibleTitle', title);
    }
    const active = await read('/api/active?' + query);
    if (revision !== currentRevision) return;
    const next = validSession(active.selected) ? active.selected : '';
    if (next !== selection) { selection = next; snapshot = null; emit(detail, 'context-lens-active', { session: selection, reason: active.reason }); }
    if (selection) { const data = await read('/api/snapshot?' + new URLSearchParams({ session: selection, view: preferences.view })); if (revision !== currentRevision) return; snapshot = data; }
    surface(); if (manual) emit(detail, 'context-lens-detection', { state: selection ? 'recognized' : 'waiting' });
  } catch { if (manual) emit(detail, 'context-lens-detection', { state: 'failed' }); }
  finally { refreshing = false; environment(); }
}
function startWatcher() {
  if (process.platform !== 'win32') return Promise.resolve(false);
  if (watcher && watcher.exitCode === null && !watcher.killed) return watcherStartup || Promise.resolve(watcherAvailable);
  let ready;
  const started = new Promise(resolve => { ready = resolve; });
  watcherStartup = started;
  const timeout = setTimeout(() => ready(false), 10000); timeout.unref();
  const command = fs.readFileSync(path.join(__dirname, 'foreground.ps1'), 'utf8');
  watcher = spawn(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoLogo', '-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let buffered = '';
  watcher.stdout.setEncoding('utf8'); watcher.stdout.on('data', data => { buffered += data; if (buffered.length > 8192) buffered = ''; const lines = buffered.split('\n'); buffered = lines.pop(); for (const line of lines) { try { const next = JSON.parse(line); if (next.ready === true) { watcherAvailable = true; clearTimeout(timeout); ready(true); environment(); } else if (!smokeFile) follow(next); } catch { /* Incomplete output waits for the next complete record. */ } } });
  const failed = () => { watcherAvailable = false; clearTimeout(timeout); ready(false); environment(); if (!app.isQuitting) { foreground = null; selection = ''; snapshot = null; revision++; surface(); emit(detail, 'context-lens-active', { session: '', reason: '等待前台会话' }); emit(detail, 'context-lens-detection', { state: 'failed' }); } };
  watcher.on('error', failed); watcher.on('exit', failed);
  watcher.stderr.on('data', () => {});
  return started;
}
function startBackend() {
  return new Promise((resolve, reject) => {
    backend = utilityProcess.fork(path.join(__dirname, 'backend.cjs'), [], { serviceName: 'Context Lens 数据服务', stdio: 'pipe',
      env: { ...process.env, CONTEXT_LENS_DESKTOP_SMOKE: smokeFile ? '1' : '0' } });
    const timeout = setTimeout(() => { backend.kill(); reject(new Error('本地数据服务启动超时')); }, 15000);
    backend.stdout.on('data', () => {}); backend.stderr.on('data', () => {});
    backend.on('message', data => {
      if (data?.app === 'context-lens' && /^http:\/\/127\.0\.0\.1:\d+$/.test(data.url)) { clearTimeout(timeout); resolve(data.url); }
      else if (data?.error) { clearTimeout(timeout); reject(new Error(data.error)); }
    });
    backend.on('exit', () => { clearTimeout(timeout); if (!origin) reject(new Error('本地数据服务未能启动')); });
  });
}
function secureWindow(window, surfaceWindow = false) {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (surfaceWindow || !url.startsWith(origin + '/')) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}
ipcMain.on('lens-action', (event, data) => {
  if (![ball, orbit, detail].some(window => window?.webContents === event.sender) || !data || typeof data.action !== 'string') return;
  const fromDetail = event.sender === detail?.webContents;
  switch (data.action) {
    case 'surface-ready': surface(); break;
    case 'toggle-orbit': if (orbitOpen) collapse(); else { orbitOpen = true; placeOrbit(); orbit.showInactive(); surface(); } break;
    case 'island': showIsland(data.island); break;
    case 'collapse': collapse(); break;
    case 'drag-start': dragOrigin = ball.getBounds(); break;
    case 'drag': if (!preferences.locked && dragOrigin && Number.isFinite(data.dx) && Number.isFinite(data.dy) && Math.abs(data.dx) < 20000 && Math.abs(data.dy) < 20000) placeBall(dragOrigin.x + data.dx, dragOrigin.y + data.dy); break;
    case 'drag-end': dragOrigin = null; save(); break;
    case 'ready':
      if (!fromDetail) return;
      emit(detail, 'context-lens-ui-style', style()); emit(detail, 'context-lens-island', island); emit(detail, 'context-lens-active', { session: selection, reason: '自动跟随活跃对话' }); environment(); surface(); break;
    case 'state': if (!fromDetail) return; if (['budget', 'model'].includes(data.view)) preferences.view = data.view; if (['auto', 'light', 'dark'].includes(data.theme)) preferences.theme = data.theme; nativeTheme.themeSource = preferences.theme === 'auto' ? 'system' : preferences.theme; save(); surface(); void refresh(); break;
    case 'ui-style': if (!fromDetail || !presets[data.uiTheme]) return; preferences.uiTheme = data.uiTheme; save(); emit(detail, 'context-lens-ui-style', style()); fitDetail(); surface(); break;
    case 'motion-preference': if (!fromDetail) return; preferences.reduceMotion = data.reduceMotion === 'true'; save(); environment(); surface(); break;
    case 'settings-open': if (!fromDetail) return; settingsOpen = pinned = true; fitDetail(); break;
    case 'settings-close': if (!fromDetail) return; settingsOpen = false; fitDetail(); break;
    case 'settings-layout': if (!fromDetail || !settingsOpen) return; if (Math.abs(Number(data.width) - detail.getContentBounds().width) > 1) return; if (Number.isFinite(Number(data.height)) && Number(data.height) > 0 && Number(data.height) < 10000) { settingsHeight = Math.ceil(Number(data.height)); fitDetail(); } break;
    case 'layout': if (!fromDetail || settingsOpen || data.island !== island) return; if (Math.abs(Number(data.width) - detail.getContentBounds().width) > 1) return; if (Number.isFinite(Number(data.height)) && Number(data.height) > 0 && Number(data.height) < 10000) { contentHeights[island] = Math.ceil(Number(data.height)); fitDetail(); } break;
    case 'recognize': case 'accessibility': if (!fromDetail) return; emit(detail, 'context-lens-detection', { state: 'loading' }); if (process.platform === 'win32' && !watcherAvailable) { void startWatcher().then(ok => { if (ok) void refresh(true); else emit(detail, 'context-lens-detection', { state: 'failed' }); }); } else if (refreshing) { const attempt = setInterval(() => { if (!refreshing) { clearInterval(attempt); void refresh(true); } }, 100); attempt.unref(); } else void refresh(true); break;
    case 'hide': hidden = true; collapse(); ball.hide(); break;
    case 'open-github': if (fromDetail && canOpenGithub(data.url)) void shell.openExternal(data.url); break;
  }
});
app.on('second-instance', settings);
app.on('window-all-closed', () => {});
app.on('before-quit', () => { app.isQuitting = true; clearInterval(pollTimer); watcher?.kill(); backend?.kill(); });
app.whenReady().then(async () => {
  origin = await startBackend();
  const options = { frame: false, transparent: true, resizable: false, maximizable: false, fullscreenable: false, show: false, skipTaskbar: true, alwaysOnTop: true, backgroundColor: '#00000000', icon: path.join(root, 'desktop/assets/ContextLens.png'), webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false } };
  ball = new BrowserWindow({ ...options, width: 76, height: 76, title: 'Context Lens · 悬浮球' });
  orbit = new BrowserWindow({ ...options, width: 276, height: 276, title: 'Context Lens · 环形岛' });
  detail = new BrowserWindow({ ...options, width: 436, height: 420, title: 'Context Lens' });
  secureWindow(ball, true); secureWindow(orbit, true); secureWindow(detail);
  const area = screen.getPrimaryDisplay().workArea;
  placeBall(preferences.x ?? area.x + area.width - 96, preferences.y ?? area.y + Math.round(area.height / 2));
  detail.on('blur', () => { if (!pinned && !settingsOpen) detail.hide(); });
  detail.webContents.on('before-input-event', (event, input) => { if (input.key === 'Escape' && input.type === 'keyDown') { event.preventDefault(); void detail.webContents.executeJavaScript("typeof window.contextLensEscape==='function' && window.contextLensEscape()").then(handled => { if (!handled) collapse(); }); } });
  for (const window of [ball, orbit, detail]) window.on('close', event => { if (!app.isQuitting) { event.preventDefault(); window.hide(); } });
  app.on('before-quit', () => { app.isQuitting = true; });
  await Promise.all([ball.loadFile(path.join(__dirname, 'orbit.html')), orbit.loadFile(path.join(__dirname, 'orbit.html')), detail.loadURL(origin + '/?view=' + preferences.view)]);
  surface(); environment();
  nativeTheme.on('updated', () => { environment(); surface(); });
  screen.on('display-metrics-changed', () => { const b = ball.getBounds(); placeBall(b.x, b.y); });
  if (smokeFile) {
    const foregroundReady = process.platform === 'win32' ? await startWatcher() : null;
    const health = await read('/api/health');
    const items = await orbit.webContents.executeJavaScript("document.querySelectorAll('.orbit-sector').length");
    const updateTab = await detail.webContents.executeJavaScript("Boolean(document.getElementById('check-updates'))");
    const data = { ok: health.app === 'context-lens' && items === 7 && updateTab && foregroundReady !== false, platform: process.platform, version: app.getVersion(), islands: items, themes: Object.keys(presets).length, updateTab, foregroundReady, origin, electron: process.versions.electron, os: os.release() };
    fs.mkdirSync(path.dirname(path.resolve(smokeFile)), { recursive: true }); fs.writeFileSync(smokeFile, JSON.stringify(data, null, 2)); app.isQuitting = true; watcher?.kill(); backend.kill(); app.exit(data.ok ? 0 : 1); return;
  }
  tray = new Tray(nativeImage.createFromPath(path.join(root, 'desktop/assets/ContextLens.ico')));
  tray.setToolTip('Context Lens'); tray.setContextMenu(Menu.buildFromTemplate([
    { label: '设置', click: settings }, { label: '显示悬浮球', click: () => { hidden = false; forced = true; ball.showInactive(); } },
    { label: '固定悬浮球位置', type: 'checkbox', checked: preferences.locked, click: item => { preferences.locked = item.checked; save(); } },
    { type: 'separator' }, { label: '退出 Context Lens', click: () => app.quit() },
  ])); tray.on('double-click', settings);
  ball.showInactive(); startWatcher(); pollTimer = setInterval(() => { void refresh(); }, 2000); pollTimer.unref(); void refresh();
}).catch(error => { if (smokeFile) { fs.writeFileSync(smokeFile, JSON.stringify({ ok: false, error: error.message })); app.exit(1); } else { dialog.showErrorBox('Context Lens 无法启动', error.message); app.quit(); } });
