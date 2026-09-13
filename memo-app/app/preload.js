'use strict';
/*
 * 预加载脚本（contextIsolation: false，因此这里就是页面的主世界）
 *  1) 把 localStorage 换成「主进程 JSON 文件仓库」的同步镜像 —— 数据落在独立配置目录，
 *     每次写入立即落盘，强杀 / 断电也不会丢。
 *  2) 多窗口实时同步：其它窗口改了便签，本窗口立即重绘。
 *  3) 每个窗口绑定自己的便签（标签页），多个窗口可以同时显示不同便签。
 *  4) 注入窗口外壳（拖动 / 缩放 / 关闭按钮）。
 */
const { ipcRenderer } = require('electron');
const shell = require('./shell.js');

function argValue(name) {
  const p = '--' + name + '=';
  const hit = process.argv.find((a) => a.startsWith(p));
  return hit ? hit.slice(p.length) : '';
}

const WINDOW_ID = argValue('nt-window-id');
const NOTE_ID = argValue('nt-note-id');
const APP_VERSION = argValue('nt-version');
const DATA_DIR = argValue('nt-data-dir');

// ============================================================
// 1. 存储垫片
// ============================================================
const mem = new Map(Object.entries(ipcRenderer.sendSync('nt:store:all') || {}));

/** 页面顶部有一段「按 document.title 加前缀」的隔离代码（标题改名会换命名空间）。
 *  这里统一把 "xxx::key" 归一成 "key"，这样以后改页面标题也不会让便签"消失"。 */
function normKey(key) {
  const k = String(key);
  const i = k.lastIndexOf('::');
  return i >= 0 ? k.slice(i + 2) : k;
}

const Store = {
  getItem(key) {
    const k = normKey(key);
    return mem.has(k) ? mem.get(k) : null;
  },
  setItem(key, value) {
    const k = normKey(key);
    const v = String(value);
    if (mem.has(k) && mem.get(k) === v) return;   // 完全相同就不写，避免多窗口来回弹
    mem.set(k, v);
    ipcRenderer.send('nt:store:set', k, v);
    if (k === 'sao_current_note') {
      ipcRenderer.send('nt:window:note', v);      // 让主进程知道这个窗口在看哪个便签
    }
  },
  removeItem(key) {
    const k = normKey(key);
    if (!mem.has(k)) return;
    mem.delete(k);
    ipcRenderer.send('nt:store:del', k);
  },
  clear() {
    for (const k of [...mem.keys()]) Store.removeItem(k);
  },
  key(index) {
    const keys = [...mem.keys()];
    return index >= 0 && index < keys.length ? keys[index] : null;
  },
  get length() { return mem.size; }
};

let storageMode = 'window';
try {
  Object.defineProperty(window, 'localStorage', {
    value: Store, configurable: true, enumerable: true, writable: false
  });
} catch (err) {
  storageMode = 'prototype';
}
if (storageMode === 'prototype') {
  try {
    const proto = window.Storage && window.Storage.prototype;
    if (proto) {
      Object.defineProperty(proto, 'getItem', { value: Store.getItem, configurable: true, writable: true });
      Object.defineProperty(proto, 'setItem', { value: Store.setItem, configurable: true, writable: true });
      Object.defineProperty(proto, 'removeItem', { value: Store.removeItem, configurable: true, writable: true });
      Object.defineProperty(proto, 'clear', { value: Store.clear, configurable: true, writable: true });
      Object.defineProperty(proto, 'key', { value: Store.key, configurable: true, writable: true });
    }
  } catch (err) {
    console.error('[NT] storage shim failed', err);
  }
}
console.log('[NT] storage mode = ' + storageMode + ', keys = ' + mem.size);

// ============================================================
// 2. 多窗口同步
// ============================================================
function shortKey(k) {
  const i = String(k).lastIndexOf('::');
  return i >= 0 ? String(k).slice(i + 2) : String(k);
}

function applyExternal(key, value) {
  const k = shortKey(key);
  try {
    if (k === 'sao_notes') {
      if (typeof notes === 'undefined' || !value) return;
      const parsed = JSON.parse(value);
      if (!Array.isArray(parsed) || !parsed.length) return;
      notes = parsed;
      if (!notes.some((n) => n && n.id === currentNoteId)) {
        currentNoteId = (notes[0] && notes[0].id) || currentNoteId;
      }
      if (typeof renderTabs === 'function') renderTabs();
      if (typeof updateSortUI === 'function') updateSortUI();
      if (typeof render === 'function') render();
    } else if (k === 'sao_settings') {
      if (typeof settings === 'undefined' || !value) return;
      const parsed = JSON.parse(value);
      settings = Object.assign({}, DEFAULT_SETTINGS, parsed);
      if (typeof applySettings === 'function') applySettings();
      if (typeof renderTabs === 'function') renderTabs();
      if (typeof render === 'function') render();
    } else if (k === 'sao_input_mode') {
      if (typeof inputMode === 'undefined' || !value) return;
      inputMode = value;
      if (typeof updateInputModeUI === 'function') updateInputModeUI();
    }
  } catch (err) {
    console.warn('[NT] 同步外部改动失败: ' + (err && err.message));
  }
}

ipcRenderer.on('nt:store:changed', (ev, key, value) => {
  const k = String(key);
  if (value === null) mem.delete(k); else mem.set(k, value);
  try {
    window.dispatchEvent(new StorageEvent('storage', {
      key: shortKey(k), newValue: value === null ? null : String(value), storageArea: Store
    }));
  } catch (err) { /* ignore */ }
  applyExternal(k, value);
});

// ============================================================
// 3. 页面就绪
// ============================================================
function bindOwnNote() {
  if (!NOTE_ID) return;
  try {
    if (typeof notes === 'undefined' || !Array.isArray(notes)) return;
    if (!notes.some((n) => n && n.id === NOTE_ID)) return;
    if (currentNoteId === NOTE_ID) return;
    currentNoteId = NOTE_ID;
    renderTabs();
    if (typeof updateSortUI === 'function') updateSortUI();
    render();
    console.log('[NT] 本窗口绑定便签 ' + NOTE_ID);
  } catch (err) {
    console.warn('[NT] 绑定便签失败: ' + (err && err.message));
  }
}

window.addEventListener('DOMContentLoaded', () => {
  try {
    shell.install({
      send: (ch, payload) => ipcRenderer.send(ch, payload),
      onPrefs: (cb) => ipcRenderer.on('nt:prefs', (ev, p) => cb(p || {}))
    });
  } catch (err) {
    console.error('[NT] 窗口外壳注入失败', err);
  }
});

window.addEventListener('load', () => {
  bindOwnNote();
  try {
    if (typeof currentNoteId !== 'undefined' && currentNoteId) {
      ipcRenderer.send('nt:window:note', currentNoteId);
    }
  } catch (err) { /* ignore */ }
  ipcRenderer.send('nt:window:ready', WINDOW_ID);
});

// 阻止拖拽整页 / 选中，避免部分区域拖不动窗口
window.addEventListener('dragover', (e) => e.preventDefault(), false);
window.addEventListener('drop', (e) => e.preventDefault(), false);

window.__NT__ = {
  windowId: WINDOW_ID, noteId: NOTE_ID, version: APP_VERSION, dataDir: DATA_DIR,
  Store, mode: storageMode,
  // 供外部/脚本调用的小接口（本窗口动作）
  newWindow: () => ipcRenderer.send('nt:window:new'),
  openDataDir: () => ipcRenderer.send('nt:app:open-data-dir'),
  quit: () => ipcRenderer.send('nt:app:quit'),
  toggleTop: () => ipcRenderer.send('nt:window:toggle-top')
};
