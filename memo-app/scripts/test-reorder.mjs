// 真实鼠标拖动任务行（HTML5 拖拽排序）是否还能用。
// 用法: node scripts/test-reorder.mjs [targetIndex]
import { execFileSync } from 'node:child_process';

const PORT = process.env.NT_DEBUG_PORT || '9222';
const idx = Number(process.argv[2] || 0);
const pages = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()).filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const t = pages[idx];
if (!t) { console.error('no target'); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
const send = (method, params = {}) => { const myId = ++id; return new Promise((res, rej) => { pending.set(myId, { res, rej }); ws.send(JSON.stringify({ id: myId, method, params })); }); };
const evaluate = async (e) => (await send('Runtime.evaluate', { expression: e, returnByValue: true })).result.value;
const winCtl = (...a) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/win-ctl.ps1', ...a], { encoding: 'utf8' }).trim();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 造 3 个任务，确保是手动排序
await evaluate(`(() => {
  setSortMode('manual');
  const n = getCurrentNote();
  n.tasks = [
    { tid: 'A', name: 'AAA', mode: 'date', date: '2026-06-01', done: false },
    { tid: 'B', name: 'BBB', mode: 'date', date: '2026-06-02', done: false },
    { tid: 'C', name: 'CCC', mode: 'date', date: '2026-06-03', done: false }
  ];
  render(); return 'seeded';
})()`);
await sleep(900);
const before = await evaluate(`getCurrentNote().tasks.map(t => t.tid).join('')`);

// 抓第 3 行（C）的拖动手柄，把它拖到第 1 行上面
const geo = await evaluate(`(() => {
  const items = [...document.querySelectorAll('#task-list .task-item')];
  const h = items[2].querySelector('.drag-handle').getBoundingClientRect();
  const first = items[0].getBoundingClientRect();
  return { x: screenX, y: screenY,
    from: [Math.round(h.left + h.width / 2), Math.round(h.top + h.height / 2)],
    to: [Math.round(h.left + h.width / 2), Math.round(first.top + 2)] };
})()`);
console.log('geometry:', JSON.stringify(geo));

// 真实鼠标：按下 -> 分步移动 -> 松开（HTML5 拖拽需要中间有 dragover）
winCtl('-Action', 'drag',
  '-X', String(geo.x + geo.from[0]), '-Y', String(geo.y + geo.from[1]),
  '-X2', String(geo.x + geo.to[0]), '-Y2', String(geo.y + geo.to[1]));
await sleep(900);

const after = await evaluate(`getCurrentNote().tasks.map(t => t.tid).join('')`);
console.log(`顺序: ${before} -> ${after}`);
const ok = before === 'ABC' && after === 'CAB';
console.log(`${ok ? 'PASS' : 'FAIL'}: 拖动排序${ok ? '有效' : '无效'}`);
ws.close();
process.exit(ok ? 0 : 1);
