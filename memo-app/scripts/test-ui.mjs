// 真实鼠标点击回归测试：逐项点击 UI，读取 DOM 状态变化，确认没有被拖拽区吃掉。
// 用法: node scripts/test-ui.mjs [targetIndex]
import { execFileSync } from 'node:child_process';

const PORT = process.env.NT_DEBUG_PORT || '9222';
const idx = Number(process.argv[2] || 0);

const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const t = pages[idx];
if (!t) { console.error('no target', idx); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
function send(method, params = {}) {
  const myId = ++id;
  return new Promise((res, rej) => { pending.set(myId, { res, rej }); ws.send(JSON.stringify({ id: myId, method, params })); });
}
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true })).result.value;
const winCtl = (...args) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/win-ctl.ps1', ...args], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function realClick(selector) {
  const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
    const r = e.getBoundingClientRect(); return { x: screenX, y: screenY, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2) }; })()`);
  if (!box) throw new Error('no element: ' + selector);
  winCtl('-Action', 'click', '-X', String(box.x + box.cx), '-Y', String(box.y + box.cy));
  await sleep(500);
}

let pass = 0, fail = 0;
const RESET = `(() => { document.querySelectorAll('.modal-overlay').forEach((m) => { m.style.display = 'none'; });
  try { closePicker(false); } catch (e) {} return 'reset'; })()`;
async function check(name, selector, probe, expect, cleanup) {
  await evaluate(RESET);          // 每项测试前清干净弹窗状态，否则探针读到的是上一项遗留
  await sleep(200);
  const before = await evaluate(probe);
  await realClick(selector);
  const after = await evaluate(probe);
  const ok = String(after) === String(expect);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  [${JSON.stringify(before)} -> ${JSON.stringify(after)}]  期望 ${JSON.stringify(expect)}`);
  ok ? pass++ : fail++;
  if (cleanup) { await evaluate(cleanup); await sleep(150); }
  return ok;
}

console.log('=== 真实鼠标 UI 回归测试 ===');
// 至少保证有两个便签页，否则"切换标签页"一项无从点击
await evaluate(`(() => {
  document.querySelectorAll('.modal-overlay').forEach((m) => { m.style.display = 'none'; });
  if (typeof notes !== 'undefined' && notes.length < 2) {
    notes.push({ id: 'note_extra', name: '便签X', title: '', tasks: [] });
    saveNotes(); renderTabs(); render();
  }
  return 'ready';
})()`);
await sleep(300);
await check('外观设置 ⚙', '.gear-btn',
  `getComputedStyle(document.getElementById('settings-modal')).display`, 'flex',
  `closeModal('settings-modal')`);
await check('清空列表', '.clear-btn',
  `getComputedStyle(document.getElementById('clear-list-modal')).display`, 'flex',
  `closeModal('clear-list-modal')`);
await check('标签栏 + 新建便签', '.add-tab-btn',
  `getComputedStyle(document.getElementById('add-note-modal')).display`, 'flex',
  `closeModal('add-note-modal')`);
await check('排序开关 → 按截止', '.sort-opt[data-mode=deadline]',
  `document.getElementById('sort-toggle').classList.contains('deadline')`, 'true',
  `setSortMode('manual')`);
await check('输入框获得焦点', '#task-name', `document.activeElement.id`, 'task-name');
await check('切换标签页', '#tab-bar .tab:nth-child(2) .tab-name', `currentNoteId`, 'note_2',
  `switchNote('note_1')`);
await check('标题点击（编辑标题弹窗）', '#note-title',
  `getComputedStyle(document.getElementById('edit-title-modal')).display`, 'flex',
  `closeModal('edit-title-modal')`);
await check('设置里的色块（取色器）', '.gear-btn',
  `getComputedStyle(document.getElementById('settings-modal')).display`, 'flex');

// 取色器需要设置面板先打开（RESET 会把它关掉），所以这里手工排顺序
// 注意：窗口很矮时靠下的设置项在滚动区外面，要点第一个（可见的）色块
await evaluate(`openSettings(); document.querySelector('.set-scroll').scrollTop = 0; 'opened'`);
await sleep(400);
{
  const before = await evaluate(`getComputedStyle(document.getElementById('cp-backdrop')).display`);
  await realClick('.swatch[data-key=titleColor]');
  const after = await evaluate(`getComputedStyle(document.getElementById('cp-backdrop')).display`);
  const ok = after === 'flex';
  console.log(`${ok ? 'PASS' : 'FAIL'}    └ 点开颜色选择器  [${JSON.stringify(before)} -> ${JSON.stringify(after)}]  期望 "flex"`);
  ok ? pass++ : fail++;
}
{
  const before = await evaluate(`settings.titleColor`);
  await realClick('#cp-presets .cp-preset:nth-child(5)');   // 点一个预设色
  await realClick('#cp-ok');                                // 确定
  await sleep(250);
  const after = await evaluate(`settings.titleColor`);
  const ok = before !== after && after != null;
  console.log(`${ok ? 'PASS' : 'FAIL'}    └ 取色器选色并确定  [${JSON.stringify(before)} -> ${JSON.stringify(after)}]`);
  ok ? pass++ : fail++;
  await evaluate(`settings.titleColor = '#333333'; applySettings(); persistSettings(); closeModal('settings-modal'); 'restored'`);
}
await check('注入按钮 📌 置顶切换', '#nt-chrome [data-act=pin]',
  `document.querySelector('#nt-chrome [data-act=pin]').classList.contains('nt-on')`, 'true',
  `window.__NT__.toggleTop()`);
await sleep(300);

// ---- 任务行的真实点击（勾选 / 编辑 / 删除）----
await evaluate(`(() => {
  const n = getCurrentNote();
  n.tasks = [{ tid: 'ui_test', name: '回归测试', mode: 'date', date: '2026-06-01', done: false }];
  render(); return 'seeded';
})()`);
await sleep(300);
await check('任务勾选（checkbox）', '.task-item .checkbox',
  `getCurrentNote().tasks[0].done`, 'true');
await check('任务名称（打开编辑弹窗）', '.task-item .t-name',
  `getComputedStyle(document.getElementById('edit-task-modal')).display`, 'flex',
  `closeModal('edit-task-modal')`);
await check('任务删除按钮', '.task-item .del-btn',
  `getCurrentNote().tasks.length`, '0');

// 放在最后：这项会真的开出一个新窗口，会盖住后续测试的点击位置
{
  const before = pages.length;
  await realClick('#nt-chrome [data-act=new]');
  await sleep(1200);
  const now = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page').length;
  const ok = now === before + 1;
  console.log(`${ok ? 'PASS' : 'FAIL'}  注入按钮 ＋ 新建窗口  [${before} -> ${now}]  期望 ${before + 1}`);
  ok ? pass++ : fail++;
}

// 顶置状态确认关掉了
await sleep(300);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
ws.close();
process.exit(fail === 0 ? 0 : 1);
