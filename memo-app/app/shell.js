'use strict';
/*
 * 窗口外壳：给无边框透明窗口补上「标题栏」应有的能力
 *   - 拖拽移动（整块便签 + 右上角 ⠿ 手柄）
 *   - 八向缩放热区（透明窗口没有系统边框，必须自己实现）
 *   - 窗口按钮：新建窗口 / 置顶 / 最小化 / 关闭
 * 只注入 DOM 与 CSS，不改动原页面任何逻辑。
 */

const CSS = `
/* 重要：本窗口完全不用 -webkit-app-region。
   这个页面（backdrop-filter / isolation / z-index:-1 伪元素）配上透明无边框窗口后，
   拖拽区的命中判定不可靠：会把子元素的 no-drag 吃掉导致 UI 点击全部失效，
   自建的元素又时灵时不灵。所以「移动」和「缩放」都改成同一套机制：
   renderer 按下 -> 主进程按真实光标位置 setPosition/setBounds。 */
#nt-dragbar {
  position: fixed; top: 5px; left: 14px; right: 14px; height: 8px;
  z-index: 88; cursor: grab; background: rgba(0,0,0,.05);
  border-radius: 4px; transition: background .15s; touch-action: none;
}
#nt-dragbar::after {
  content: ''; display: block; width: 34px; height: 3px; margin: 2.5px auto 0;
  border-radius: 2px; background: rgba(0,0,0,.22);
}
#nt-dragbar:hover { background: rgba(0,0,0,.12); }
#nt-dragbar:hover::after { background: rgba(0,0,0,.4); }
#nt-dragbar:active { cursor: grabbing; }
#nt-chrome {
  position: fixed; top: 3px; right: 4px; z-index: 400;
  display: flex; align-items: center; gap: 3px;
  opacity: .5; transition: opacity .16s ease;
  -webkit-app-region: no-drag;
  font-family: 'Segoe UI', system-ui, sans-serif;
}
body:hover #nt-chrome, #nt-chrome:hover { opacity: 1; }
.nt-btn {
  width: 15px; height: 15px; line-height: 13px; text-align: center;
  font-size: 10px; border-radius: 4px; color: #555;
  background: rgba(255,255,255,.75); border: 1px solid rgba(0,0,0,.10);
  cursor: pointer; user-select: none; box-shadow: 0 1px 3px rgba(0,0,0,.08);
  transition: background .12s, color .12s;
}
.nt-btn:hover { background: #fff; color: #111; }
.nt-btn.nt-close:hover { background: #ff4d4f; color: #fff; border-color: transparent; }
.nt-btn.nt-on { background: rgba(0,120,212,.92); color: #fff; border-color: transparent; }
.nt-grip { cursor: grab; letter-spacing: -1px; font-size: 11px; width: 18px; }
.nt-grip:active { cursor: grabbing; }
.nt-rs { position: fixed; z-index: 90; -webkit-app-region: no-drag; }
.nt-rs-n { top: 0; left: 10px; right: 10px; height: 3px; cursor: ns-resize; }
.nt-rs-s { bottom: 0; left: 10px; right: 10px; height: 4px; cursor: ns-resize; }
.nt-rs-w { left: 0; top: 10px; bottom: 10px; width: 4px; cursor: ew-resize; }
.nt-rs-e { right: 0; top: 10px; bottom: 10px; width: 4px; cursor: ew-resize; }
.nt-rs-nw { left: 0; top: 0; width: 11px; height: 11px; cursor: nwse-resize; }
.nt-rs-ne { right: 0; top: 0; width: 11px; height: 11px; cursor: nesw-resize; }
.nt-rs-sw { left: 0; bottom: 0; width: 11px; height: 11px; cursor: nesw-resize; }
.nt-rs-se { right: 0; bottom: 0; width: 11px; height: 11px; cursor: nwse-resize; }
`;

const EDGES = ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'];

/** 自实现的窗口拖动：按住 -> 主进程按真实光标位置移动窗口（和缩放同一套机制，最稳）
 *  ignoreSelector: 命中这些后代元素时不拖动（保证 UI 点击照旧） */
function installDragHandle(el, api, ignoreSelector) {
  el.addEventListener('pointerdown', (ev) => {
    if (ev.button !== 0) return;
    if (ignoreSelector && ev.target && ev.target.closest && ev.target.closest(ignoreSelector)) return;
    ev.preventDefault();
    ev.stopPropagation();
    try { el.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
    api.send('nt:move:start');
    const finish = () => {
      api.send('nt:move:end');
      window.removeEventListener('pointerup', finish, true);
      window.removeEventListener('pointercancel', finish, true);
      window.removeEventListener('mouseup', finish, true);
      window.removeEventListener('blur', finish, true);
    };
    window.addEventListener('pointerup', finish, true);
    window.addEventListener('pointercancel', finish, true);
    window.addEventListener('mouseup', finish, true);
    window.addEventListener('blur', finish, true);
  });
  el.addEventListener('dblclick', () => api.send('nt:window:toggle-max'));
}

function install(api) {
  if (!document.body || document.getElementById('nt-chrome')) return;

  const style = document.createElement('style');
  style.id = 'nt-shell-style';
  style.textContent = CSS;
  document.head.appendChild(style);

  // ---------- 顶部拖动手柄（自实现拖动，不吃任何 UI 点击） ----------
  const dragbar = document.createElement('div');
  dragbar.id = 'nt-dragbar';
  dragbar.title = '按住这里拖动窗口（双击最大化/还原）';
  installDragHandle(dragbar, api);
  document.body.appendChild(dragbar);

  // ---------- 缩放热区 ----------
  EDGES.forEach((edge) => {
    const el = document.createElement('div');
    el.className = 'nt-rs nt-rs-' + edge;
    el.dataset.edge = edge;
    el.addEventListener('pointerdown', (ev) => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      ev.stopPropagation();
      try { el.setPointerCapture(ev.pointerId); } catch (err) { /* ignore */ }
      api.send('nt:resize:start', edge);
      const finish = () => {
        api.send('nt:resize:end');
        window.removeEventListener('pointerup', finish, true);
        window.removeEventListener('pointercancel', finish, true);
        window.removeEventListener('mouseup', finish, true);
        window.removeEventListener('blur', finish, true);
      };
      window.addEventListener('pointerup', finish, true);
      window.addEventListener('pointercancel', finish, true);
      window.addEventListener('mouseup', finish, true);
      window.addEventListener('blur', finish, true);
    });
    document.body.appendChild(el);
  });

  // ---------- 顶部控制条 ----------
  const bar = document.createElement('div');
  bar.id = 'nt-chrome';
  bar.innerHTML =
    '<div class="nt-btn nt-grip" data-act="grip" title="拖动移动窗口（双击最大化/还原）">⠿</div>' +
    '<div class="nt-btn" data-act="new" title="新建便签窗口">＋</div>' +
    '<div class="nt-btn" data-act="pin" title="窗口置顶">📌</div>' +
    '<div class="nt-btn" data-act="min" title="最小化">–</div>' +
    '<div class="nt-btn nt-close" data-act="close" title="关闭这个便签窗口">✕</div>';
  bar.addEventListener('click', (ev) => {
    const btn = ev.target.closest ? ev.target.closest('.nt-btn') : null;
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    const act = btn.dataset.act;
    if (act === 'new') api.send('nt:window:new');
    else if (act === 'pin') api.send('nt:window:toggle-top');
    else if (act === 'min') api.send('nt:window:minimize');
    else if (act === 'close') api.send('nt:window:close');
  });
  bar.addEventListener('contextmenu', (ev) => ev.preventDefault());
  document.body.appendChild(bar);
  installDragHandle(bar.querySelector('.nt-grip'), api);

  // ---------- 便签头部那一行也可以直接拖着走（标题 / 齿轮 / 清空列表仍可点击） ----------
  const header = document.querySelector('header');
  if (header) {
    header.style.cursor = 'grab';
    installDragHandle(header, api, '[onclick], button, input, a, .tab, .gear-btn, .clear-btn, #note-title');
  }

  // ---------- 置顶状态回显 ----------
  api.onPrefs((p) => {
    const pin = bar.querySelector('[data-act="pin"]');
    if (pin) pin.classList.toggle('nt-on', !!p.alwaysOnTop);
  });

  return { bar };
}

module.exports = { install };
