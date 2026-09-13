'use strict';
/*
 * NoMoreTomorrow · 桌面便签
 * 主进程：单进程多窗口 / 独立配置目录 / 窗口几何持久化 / 托盘 / 开机自启 / 文件级数据存储
 */
const {
  app, BrowserWindow, ipcMain, Tray, Menu, nativeImage, screen, shell, powerMonitor
} = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// ============================================================
// 0. 基础常量 / 参数
// ============================================================
const APP_NAME = 'NoMoreTomorrow';
const APP_ID = 'com.nomoretomorrow.memo';
const DATA_DIR_NAME = APP_NAME + '-Data';
// 改名前的旧数据目录：发现就自动改名迁移，避免用户觉得"便签丢了"
const LEGACY_DATA_DIR_NAMES = ['NoTomorrowMe-Data', 'NoTomorrowMe'];
// 改名前的旧开机自启注册表项名（Electron 用 appId 作为值名）
const LEGACY_AUTOSTART_NAMES = ['com.notomorrow.memo', 'NoTomorrowMe'];
const MIN_W = 200;
const MIN_H = 150;
const MAX_RESTORE = 24;          // 最多恢复的窗口数（防御异常状态文件）
const DEFAULT_W = 320;
const DEFAULT_H = 430;

const ARGV = process.argv.slice(1);
function argValue(name, def) {
  const p = '--' + name + '=';
  const hit = ARGV.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : def;
}

app.setAppUserModelId(APP_ID);
app.setName(APP_NAME);

// 日志函数在下面才初始化，启动早期的信息先排队，稍后补写进日志文件
const earlyLogs = [];
function logEarly(...args) { earlyLogs.push('[' + new Date().toISOString() + '] ' + args.join(' ')); }

// ============================================================
// 1. 独立配置目录（便携版放 exe 旁边，安装版放 %APPDATA%）
// ============================================================
function isUsableDir(dir) {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.nt-write-test');
    fs.writeFileSync(probe, 'ok');
    fs.unlinkSync(probe);
    return true;
  } catch (err) {
    return false;
  }
}

/** 在 baseDir 下定位数据目录；若只有旧名字（NoTomorrowMe-Data）则原地改名迁移。
 *  create=false 时目录不存在就返回 null（用于"用户手动放了个数据文件夹"这种绿色化开关） */
function adoptDataDir(baseDir, create = true) {
  const target = path.join(baseDir, DATA_DIR_NAME);
  if (fs.existsSync(target)) return isUsableDir(target) ? target : null;
  for (const legacyName of LEGACY_DATA_DIR_NAMES) {
    const legacy = path.join(baseDir, legacyName);
    if (!fs.existsSync(legacy)) continue;
    try {
      fs.renameSync(legacy, target);
      logEarly('数据目录已迁移:', legacy, '->', target);
      return isUsableDir(target) ? target : legacy;
    } catch (err) {
      logEarly('数据目录改名失败，继续沿用旧目录:', legacy, err && err.message);
      return isUsableDir(legacy) ? legacy : null;
    }
  }
  if (!create) return null;
  return isUsableDir(target) ? target : null;
}

function resolveDataDir() {
  const forced = argValue('data-dir', process.env.NT_DATA_DIR || '');
  if (forced) {
    const abs = path.resolve(forced);
    if (isUsableDir(abs)) return abs;
  }

  // 便携版（electron-builder portable）：数据放在便携 exe 旁边，真正随身携带。
  // 注意：便携版会把真实 exe 解压到临时目录，因此必须用 PORTABLE_EXECUTABLE_DIR。
  const portableDir = process.env.PORTABLE_EXECUTABLE_DIR || '';
  if (portableDir) {
    const dir = adoptDataDir(portableDir);
    if (dir) return dir;
  }

  if (app.isPackaged) {
    // 用户手动在 exe 旁边放了数据文件夹 -> 按便携/绿色模式使用（不自动创建）
    const beside = adoptDataDir(path.dirname(app.getPath('exe')), false);
    if (beside) return beside;
    return adoptDataDir(app.getPath('appData'));
  }

  // 开发模式
  const devDir = adoptDataDir(path.dirname(app.getPath('exe')));
  if (devDir) return devDir;
  return adoptDataDir(app.getPath('appData'));
}

const DATA_DIR = resolveDataDir();
const RUNTIME_DIR = path.join(DATA_DIR, 'runtime');
try { fs.mkdirSync(RUNTIME_DIR, { recursive: true }); } catch (err) { /* ignore */ }
app.setPath('userData', DATA_DIR);
try { app.setPath('sessionData', RUNTIME_DIR); } catch (err) { /* ignore */ }

const STORE_FILE = path.join(DATA_DIR, 'store.json');
const WINDOWS_FILE = path.join(DATA_DIR, 'windows.json');
const PREFS_FILE = path.join(DATA_DIR, 'prefs.json');
const LOG_FILE = path.join(DATA_DIR, 'log.txt');
// 图标放在 resources/assets（asar 之外），开发模式则在工程目录
const RES_ROOT = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..');
const ICON_PNG = path.join(RES_ROOT, 'assets', 'icon.png');
const TRAY_PNG = path.join(RES_ROOT, 'assets', 'tray.png');

// ============================================================
// 2. 日志 + JSON 原子读写
// ============================================================
let logSize = 0;
try { logSize = fs.statSync(LOG_FILE).size; } catch (err) { logSize = 0; }
if (logSize > 512 * 1024) { try { fs.rmSync(LOG_FILE); } catch (err) { /* ignore */ } }

function log(...args) {
  const line = '[' + new Date().toISOString() + '] ' + args
    .map((a) => (typeof a === 'string' ? a : (a && a.stack) ? a.stack : JSON.stringify(a)))
    .join(' ');
  try { fs.appendFileSync(LOG_FILE, line + '\r\n'); } catch (err) { /* ignore */ }
}
process.on('uncaughtException', (err) => log('uncaughtException', err));
process.on('unhandledRejection', (err) => log('unhandledRejection', err));

function readJSON(file, def) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (err) { return def; }
}
function writeJSON(file, obj) {
  const tmp = file + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
    fs.renameSync(tmp, file);
    return true;
  } catch (err) {
    log('writeJSON failed', file, err);
    try { fs.rmSync(tmp, { force: true }); } catch (e2) { /* ignore */ }
    return false;
  }
}

log('==== 启动 ====', 'v' + app.getVersion(), 'data=' + DATA_DIR, 'portable=' + (process.env.PORTABLE_EXECUTABLE_FILE || '-'));
for (const line of earlyLogs) { try { fs.appendFileSync(LOG_FILE, line + '\r\n'); } catch (err) { /* ignore */ } }
earlyLogs.length = 0;

// ============================================================
// 3. 数据仓库（替代 localStorage，落盘为 JSON，天然抗强杀/断电）
// ============================================================
let store = readJSON(STORE_FILE, null);
if (!store || typeof store !== 'object' || Array.isArray(store)) store = {};
let storeTimer = null;

function flushStore() {
  if (storeTimer) { clearTimeout(storeTimer); storeTimer = null; }
  writeJSON(STORE_FILE, store);
}
function scheduleStoreFlush() {
  if (storeTimer) return;
  storeTimer = setTimeout(() => { storeTimer = null; writeJSON(STORE_FILE, store); }, 120);
}

// ============================================================
// 4. 应用偏好 & 窗口状态
// ============================================================
const DEFAULT_PREFS = { autostart: false, alwaysOnTop: false, firstRun: true, opacity: 1 };
let prefs = Object.assign({}, DEFAULT_PREFS, readJSON(PREFS_FILE, {}));
function savePrefs() { writeJSON(PREFS_FILE, prefs); }

const winState = Object.assign({ version: 1, windows: [] }, readJSON(WINDOWS_FILE, {}));
if (!Array.isArray(winState.windows)) winState.windows = [];
let stateTimer = null;

/** 当前打开的窗口记录：id -> { id, win, x, y, width, height, maximized, noteId } */
const wins = new Map();
let isQuitting = false;

function snapshotWindows() {
  winState.windows = [...wins.values()].map((r) => ({
    id: r.id,
    x: r.x, y: r.y, width: r.width, height: r.height,
    maximized: !!r.maximized,
    noteId: r.noteId || ''
  }));
  winState.savedAt = new Date().toISOString();
}

/** 退出前把所有窗口的最后几何抓一遍（退出过程中窗口会被逐个关掉，必须提前抓） */
function captureAllWindows() {
  for (const r of wins.values()) {
    const w = r.win;
    if (!w || w.isDestroyed()) continue;
    if (w.isMinimized() || w.isFullScreen()) continue;
    const maximized = w.isMaximized();
    r.maximized = maximized;
    if (!maximized) {
      const b = w.getBounds();
      r.x = b.x; r.y = b.y; r.width = b.width; r.height = b.height;
    }
  }
}

function flushWindows() {
  if (stateTimer) { clearTimeout(stateTimer); stateTimer = null; }
  // 退出过程中 wins 会被逐个清空，此时必须写「退出前的快照」，否则数量会被写成 0
  if (!isQuitting) snapshotWindows();
  writeJSON(WINDOWS_FILE, winState);
}
function scheduleSaveWindows() {
  if (isQuitting) return;
  if (stateTimer) return;
  stateTimer = setTimeout(() => { stateTimer = null; snapshotWindows(); writeJSON(WINDOWS_FILE, winState); }, 250);
}

// ============================================================
// 5. 几何工具
// ============================================================
function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

function rectOverlap(a, b) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** 保证窗口至少露出可见区域，否则回落到主屏中央 */
function normalizeBounds(b) {
  const displays = screen.getAllDisplays();
  let out = {
    x: Math.round(b.x), y: Math.round(b.y),
    width: Math.round(b.width), height: Math.round(b.height)
  };
  const wa = screen.getPrimaryDisplay().workArea;
  out.width = clamp(out.width || DEFAULT_W, MIN_W, Math.max(MIN_W, wa.width));
  out.height = clamp(out.height || DEFAULT_H, MIN_H, Math.max(MIN_H, wa.height));
  const visible = displays.some((d) => rectOverlap(out, d.workArea));
  if (!visible) {
    const cx = wa.x + Math.round((wa.width - out.width) / 2);
    const cy = wa.y + Math.round((wa.height - out.height) / 2);
    out.x = clamp(cx, wa.x, wa.x + wa.width - 100);
    out.y = clamp(cy, wa.y, wa.y + wa.height - 60);
  }
  return out;
}

function cascadeBounds() {
  const wa = screen.getPrimaryDisplay().workArea;
  const n = wins.size;
  const step = 26;
  const baseX = Math.max(wa.x, wa.x + wa.width - DEFAULT_W - 40 - (n % 6) * step);
  const baseY = wa.y + 40 + (n % 6) * step;
  return normalizeBounds({ x: baseX, y: baseY, width: DEFAULT_W, height: DEFAULT_H });
}

// ============================================================
// 6. 便签 id 选择：新窗口尽量显示一个“还没被其它窗口占用”的便签
// ============================================================
function notesFromStore() {
  for (const key of Object.keys(store)) {
    if (key === 'sao_notes' || key.endsWith('sao_notes')) {
      try {
        const arr = JSON.parse(store[key]);
        if (Array.isArray(arr)) return arr;
      } catch (err) { /* ignore */ }
    }
  }
  return [];
}
function pickFreeNoteId() {
  const notes = notesFromStore();
  if (!notes.length) return '';
  const used = new Set([...wins.values()].map((r) => r.noteId).filter(Boolean));
  // 还没绑定具体便签的窗口，实际上正显示着“上次选中的便签”，也算被占用
  const hasUnbound = [...wins.values()].some((r) => !r.noteId);
  if (hasUnbound) {
    const cur = store['sao_current_note'] || store['NoMoreTomorrow::sao_current_note']
      || store['NoTomorrow Me::sao_current_note'];
    if (cur) used.add(cur);
  }
  const free = notes.find((n) => n && n.id && !used.has(n.id));
  if (free) return free.id;
  const focused = BrowserWindow.getFocusedWindow();
  for (const r of wins.values()) if (r.win === focused && r.noteId) return r.noteId;
  return notes[0].id || '';
}

// ============================================================
// 7. 窗口创建
// ============================================================
function nextWindowId() {
  return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function createWindow(spec = {}) {
  const id = spec.id || nextWindowId();
  if (wins.has(id)) return wins.get(id).win;

  const bounds = normalizeBounds(spec.width
    ? { x: spec.x, y: spec.y, width: spec.width, height: spec.height }
    : cascadeBounds());
  const noteId = spec.noteId || pickFreeNoteId();

  const win = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: MIN_W,
    minHeight: MIN_H,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    movable: true,
    minimizable: true,
    maximizable: true,
    fullscreenable: false,
    skipTaskbar: false,
    show: false,
    title: APP_NAME,
    icon: fs.existsSync(ICON_PNG) ? ICON_PNG : undefined,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: false,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
      backgroundThrottling: false,
      additionalArguments: [
        '--nt-window-id=' + id,
        '--nt-note-id=' + noteId,
        '--nt-version=' + app.getVersion(),
        '--nt-data-dir=' + DATA_DIR
      ]
    }
  });

  const record = {
    id, win, noteId,
    x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height,
    maximized: !!spec.maximized
  };
  wins.set(id, record);

  // ---- 几何记忆 ----
  const capture = () => {
    const r = wins.get(id);
    if (!r || r.win.isDestroyed()) return;
    if (win.isMinimized() || win.isFullScreen()) return;
    const maximized = win.isMaximized();
    r.maximized = maximized;
    if (!maximized) {
      const b = win.getBounds();
      r.x = b.x; r.y = b.y; r.width = b.width; r.height = b.height;
    }
    scheduleSaveWindows();
  };
  win.on('resize', capture);
  win.on('move', capture);
  win.on('maximize', capture);
  win.on('unmaximize', capture);
  win.on('restore', capture);
  win.on('close', () => {
    capture();
    flushWindows();          // 关窗前立刻落盘（含强杀/关机前的最后一次）
  });
  win.on('closed', () => {
    endResize();
    endMove();
    wins.delete(id);
    if (!isQuitting) {
      snapshotWindows();
      writeJSON(WINDOWS_FILE, winState);
    }
    refreshTrayMenu();
  });

  // ---- 第一帧渲染完成后再显示，避免透明窗口白闪 ----
  win.once('ready-to-show', () => {
    if (!win.isDestroyed()) win.show();
    if (spec.maximized) win.maximize();
    win.setAlwaysOnTop(!!prefs.alwaysOnTop);
    win.webContents.send('nt:prefs', { alwaysOnTop: !!prefs.alwaysOnTop });
  });

  win.webContents.on('did-finish-load', () => log('窗口已加载', id, 'note=' + (noteId || '-')));

  // 渲染进程的报错也写进日志，免得前端异常静默消失
  win.webContents.on('console-message', (...args) => {
    const ev = args[0];
    const level = (ev && typeof ev === 'object' && 'level' in ev) ? ev.level : args[1];
    const message = (ev && typeof ev === 'object' && 'message' in ev) ? ev.message : args[2];
    if (level === 'error' || level === 3 || level === 'warning' || level === 2) {
      log('[renderer:' + level + ']', String(message));
    }
  });
  win.webContents.on('preload-error', (e, p, err) => log('[preload-error]', p, err));

  // 窗口聚焦时的快捷键：Ctrl+N 新窗口 / Ctrl+Q 退出
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    const key = String(input.key || '').toLowerCase();
    const ctrl = input.control || input.meta;
    if (ctrl && key === 'n') {
      e.preventDefault();
      createWindow();
    } else if (ctrl && key === 'q') {
      e.preventDefault();
      isQuitting = true;
      app.quit();
    }
  });

  // 安全：禁止跳转/开新窗口
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (url !== win.webContents.getURL()) {
      e.preventDefault();
      if (/^https?:/i.test(url)) shell.openExternal(url);
    }
  });

  win.loadFile(path.join(__dirname, 'Activities.html'));
  refreshTrayMenu();
  log('创建窗口', id, JSON.stringify(bounds), 'note=' + (noteId || '-'));
  return win;
}

function showAllWindows() {
  for (const r of wins.values()) {
    if (r.win.isDestroyed()) continue;
    if (r.win.isMinimized()) r.win.restore();
    r.win.show();
  }
  const last = [...wins.values()].pop();
  if (last && !last.win.isDestroyed()) last.win.focus();
}

function applyAlwaysOnTop(value) {
  prefs.alwaysOnTop = !!value;
  savePrefs();
  for (const r of wins.values()) {
    if (r.win.isDestroyed()) continue;
    r.win.setAlwaysOnTop(prefs.alwaysOnTop);
    r.win.webContents.send('nt:prefs', { alwaysOnTop: prefs.alwaysOnTop });
  }
  refreshTrayMenu();
}

// ============================================================
// 8. 开机自启
// ============================================================
function autostartTarget() {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}
function isAutostartEnabled() {
  try {
    const s = app.getLoginItemSettings({ path: autostartTarget() });
    return !!s.openAtLogin;
  } catch (err) {
    return !!prefs.autostart;
  }
}
function setAutostart(enabled) {
  const target = autostartTarget();
  try {
    app.setLoginItemSettings({ openAtLogin: !!enabled, path: target, args: [] });
    prefs.autostart = isAutostartEnabled();
  } catch (err) {
    log('setAutostart failed', err);
    prefs.autostart = !!enabled;
  }
  savePrefs();
  refreshTrayMenu();
  log('开机自启 =', prefs.autostart, target);
  return prefs.autostart;
}

/** 改名后清掉旧名字留下的开机自启项，避免登录时启动一个已经不存在的 exe */
function cleanupLegacyAutostart() {
  if (process.platform !== 'win32') return;
  for (const name of LEGACY_AUTOSTART_NAMES) {
    try {
      execFileSync('reg.exe', [
        'delete', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
        '/v', name, '/f'
      ], { stdio: 'pipe' });
      log('已清理旧的开机自启项:', name);
    } catch (err) {
      // 本来就不存在，忽略
    }
  }
}

// ============================================================
// 9. 托盘
// ============================================================
let tray = null;
function refreshTrayMenu() {
  if (!tray || tray.isDestroyed()) return;
  const menu = Menu.buildFromTemplate([
    { label: '新建便签窗口', accelerator: 'CommandOrControl+N', click: () => createWindow() },
    { label: '显示全部窗口（' + wins.size + '）', click: () => showAllWindows() },
    { type: 'separator' },
    {
      label: '窗口置顶', type: 'checkbox', checked: !!prefs.alwaysOnTop,
      click: (mi) => applyAlwaysOnTop(mi.checked)
    },
    {
      label: '开机自启', type: 'checkbox', checked: isAutostartEnabled(),
      click: (mi) => setAutostart(mi.checked)
    },
    { type: 'separator' },
    { label: '打开配置文件夹', click: () => shell.openPath(DATA_DIR) },
    { label: '配置文件夹：' + DATA_DIR, enabled: false },
    { label: '关于 ' + APP_NAME + ' v' + app.getVersion(), enabled: false },
    { type: 'separator' },
    {
      label: '退出（关闭全部窗口）',
      click: () => { isQuitting = true; app.quit(); }
    }
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(APP_NAME + ' 便签 · ' + wins.size + ' 个窗口');
}

function buildTray() {
  let img = nativeImage.createFromPath(TRAY_PNG);
  if (img.isEmpty()) img = nativeImage.createFromPath(ICON_PNG);
  if (img.isEmpty()) {
    // 兜底：16x16 纯色方块，保证托盘一定能起来
    img = nativeImage.createFromDataURL(
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVR42mNgGAWjYBSMglEwCkbBKBgFo2AUjIJRMApGwSgYBaNgFIyCUTAKRsEoGAWjYBSMglEwCkbBKBgFwwYAAJ8kA/9pZQ3zAAAAAElFTkSuQmCC'
    );
  }
  try {
    tray = new Tray(img);
  } catch (err) {
    log('托盘创建失败', err);
    return;
  }
  refreshTrayMenu();
  tray.on('click', () => showAllWindows());
  tray.on('double-click', () => createWindow());
  log('托盘已就绪');
}

// ============================================================
// 10. 自实现的移动 / 缩放（透明无边框窗口没有系统标题栏与边框，必须自己做）
//     统一用「主进程按真实光标位置 setBounds」的方式：稳定、不依赖 -webkit-app-region
// ============================================================
let resizeSession = null;
let moveSession = null;

function endResize() {
  if (!resizeSession) return;
  clearInterval(resizeSession.timer);
  resizeSession = null;
}

function endMove() {
  if (!moveSession) return;
  clearInterval(moveSession.timer);
  log('[move] end at', JSON.stringify(moveSession.last));
  moveSession = null;
}

function startMove(webContents) {
  const win = BrowserWindow.fromWebContents(webContents);
  if (!win || win.isDestroyed() || win.isMaximized()) { log('[move] ignored'); return; }
  endMove();
  const session = {
    win,
    start: screen.getCursorScreenPoint(),
    bounds: win.getBounds(),
    last: null,
    ticks: 0,
    timer: null
  };
  log('[move] start cursor=' + JSON.stringify(session.start) + ' bounds=' + JSON.stringify(session.bounds));
  session.timer = setInterval(() => {
    if (!moveSession || session.win.isDestroyed()) { endMove(); return; }
    session.ticks++;
    const cur = screen.getCursorScreenPoint();
    const x = Math.round(session.bounds.x + (cur.x - session.start.x));
    const y = Math.round(session.bounds.y + (cur.y - session.start.y));
    if (session.last && session.last.x === x && session.last.y === y) return;
    session.last = { x, y };
    session.win.setPosition(x, y);
  }, 16);
  moveSession = session;
}

function startResize(webContents, edge) {
  const win = BrowserWindow.fromWebContents(webContents);
  if (!win || win.isDestroyed() || win.isMaximized()) return;
  endResize();
  if (!/^(n|s|e|w|ne|nw|se|sw)$/.test(String(edge))) return;
  const session = {
    win,
    edge: String(edge),
    start: screen.getCursorScreenPoint(),
    bounds: win.getBounds(),
    last: null,
    timer: null
  };
  session.timer = setInterval(() => {
    if (!resizeSession || session.win.isDestroyed()) { endResize(); return; }
    const cur = screen.getCursorScreenPoint();
    const dx = cur.x - session.start.x;
    const dy = cur.y - session.start.y;
    const b = session.bounds;
    let x = b.x, y = b.y, width = b.width, height = b.height;
    if (session.edge.includes('e')) width = Math.max(MIN_W, b.width + dx);
    if (session.edge.includes('s')) height = Math.max(MIN_H, b.height + dy);
    if (session.edge.includes('w')) { width = Math.max(MIN_W, b.width - dx); x = b.x + (b.width - width); }
    if (session.edge.includes('n')) { height = Math.max(MIN_H, b.height - dy); y = b.y + (b.height - height); }
    const next = { x: Math.round(x), y: Math.round(y), width: Math.round(width), height: Math.round(height) };
    if (session.last && session.last.x === next.x && session.last.y === next.y &&
        session.last.width === next.width && session.last.height === next.height) return;
    session.last = next;
    session.win.setBounds(next);
  }, 16);
  resizeSession = session;
}

// ============================================================
// 11. IPC
// ============================================================
ipcMain.on('nt:store:all', (e) => { e.returnValue = store; });

ipcMain.on('nt:store:set', (e, key, value) => {
  const k = String(key);
  const v = String(value);
  if (store[k] === v) return;
  store[k] = v;
  scheduleStoreFlush();
  for (const r of wins.values()) {
    if (r.win.isDestroyed()) continue;
    if (r.win.webContents === e.sender) continue;
    r.win.webContents.send('nt:store:changed', k, v);
  }
});

ipcMain.on('nt:store:del', (e, key) => {
  const k = String(key);
  if (!(k in store)) return;
  delete store[k];
  scheduleStoreFlush();
  for (const r of wins.values()) {
    if (r.win.isDestroyed() || r.win.webContents === e.sender) continue;
    r.win.webContents.send('nt:store:changed', k, null);
  }
});

ipcMain.handle('nt:window:state', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  let rec = null;
  for (const r of wins.values()) if (r.win === win) rec = r;
  return {
    id: rec ? rec.id : '',
    noteId: rec ? rec.noteId : '',
    alwaysOnTop: !!prefs.alwaysOnTop,
    version: app.getVersion(),
    dataDir: DATA_DIR,
    windowCount: wins.size
  };
});

ipcMain.on('nt:window:new', () => createWindow());
ipcMain.on('nt:window:note', (e, noteId) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  for (const r of wins.values()) {
    if (r.win === win && noteId) {
      if (r.noteId !== noteId) {
        r.noteId = String(noteId);
        scheduleSaveWindows();
      }
      break;
    }
  }
});
ipcMain.on('nt:window:toggle-max', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win || win.isDestroyed()) return;
  if (win.isMaximized()) win.unmaximize(); else win.maximize();
});
ipcMain.on('nt:window:close', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.close();
});
ipcMain.on('nt:window:minimize', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.minimize();
});
ipcMain.on('nt:window:toggle-top', (e) => {
  applyAlwaysOnTop(!prefs.alwaysOnTop);
});
ipcMain.on('nt:window:focus', (e) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (win && !win.isDestroyed()) win.focus();
});
ipcMain.on('nt:resize:start', (e, edge) => startResize(e.sender, edge));
ipcMain.on('nt:resize:end', () => endResize());
ipcMain.on('nt:move:start', (e) => startMove(e.sender));
ipcMain.on('nt:move:end', () => endMove());
ipcMain.on('nt:app:quit', () => { isQuitting = true; app.quit(); });
ipcMain.on('nt:app:open-data-dir', () => shell.openPath(DATA_DIR));

// ============================================================
// 12. 生命周期
// ============================================================
// 单实例：再次双击 exe 时不新开进程，而是让已有进程再开一个便签窗口。
const isPrimary = app.requestSingleInstanceLock();
if (!isPrimary) {
  // 注意：副进程什么都没有加载，绝不能让它把 state / store 写回去。
  log('已有实例在运行，本进程退出并请求新窗口');
  app.quit();
} else {
  app.on('second-instance', () => {
    log('第二实例启动 -> 新建便签窗口');
    createWindow();
  });
}

app.on('before-quit', () => {
  if (!isPrimary) return;
  endResize();
  endMove();
  captureAllWindows();     // 必须在 isQuitting 置位前抓几何
  snapshotWindows();
  isQuitting = true;
  flushStore();
  writeJSON(WINDOWS_FILE, winState);
  log('退出中，记录窗口数 =', winState.windows.length);
});
app.on('will-quit', () => {
  if (!isPrimary) return;
  flushStore();
  writeJSON(WINDOWS_FILE, winState);   // 写退出前快照，不再从 wins 重建
});

app.on('window-all-closed', () => {
  if (!isPrimary) return;
  flushStore();
  if (!isQuitting) {
    // 用户手动关掉最后一个便签：干净退出（下次双击 exe 会重新出现 1 个窗口）
    log('所有窗口已关闭，退出进程');
    app.quit();
  }
});

app.whenReady().then(() => {
  if (!isPrimary) return;
  const target = autostartTarget();
  log('exe =', target, 'packaged =', app.isPackaged);
  cleanupLegacyAutostart();
  buildTray();

  if (prefs.firstRun) {
    prefs.firstRun = false;
    if (app.isPackaged) {
      setAutostart(true);   // 首次运行默认开启开机自启
    } else {
      savePrefs();
    }
  } else if (app.isPackaged) {
    // 目标 exe 换了位置（例如把便携版挪了目录）时，自动修正自启项
    if (prefs.autostart && !isAutostartEnabled()) setAutostart(true);
  }
  refreshTrayMenu();

  const saved = winState.windows.slice(0, MAX_RESTORE);
  if (saved.length) {
    log('恢复窗口', saved.length, '个');
    for (const spec of saved) createWindow(spec);
  } else {
    log('没有历史窗口，创建 1 个默认窗口');
    createWindow();
  }

  powerMonitor.on('shutdown', () => { flushStore(); flushWindows(); });
  powerMonitor.on('suspend', () => { flushStore(); flushWindows(); });
});

app.on('activate', () => { if (wins.size === 0) createWindow(); });
