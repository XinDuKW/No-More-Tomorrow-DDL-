// 用「真实鼠标」点击页面里的某个元素，然后回读 DOM 状态 —— 这是唯一能暴露
// -webkit-app-region: drag 吃掉点击的测试方式（CDP 注入事件会绕过系统命中判定）。
// 用法: node scripts/test-click.mjs <targetIndex> "<selector>" "<probeJs>"
import { execFileSync } from 'node:child_process';

const PORT = process.env.NT_DEBUG_PORT || '9222';
const idx = Number(process.argv[2] || 0);
const selector = process.argv[3] || '.gear-btn';
const probe = process.argv[4] || 'getComputedStyle(document.getElementById("settings-modal")).display';

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

const box = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
  const r = e.getBoundingClientRect(); return { x: screenX, y: screenY, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2), w: Math.round(r.width), h: Math.round(r.height), region: getComputedStyle(e).webkitAppRegion }; })()`);
if (!box) { console.error('selector not found:', selector); process.exit(1); }
console.log('target element:', JSON.stringify(box));

const before = await evaluate(`(${probe})`);
console.log('probe before:', JSON.stringify(before));

console.log(winCtl('-Action', 'click', '-X', String(box.x + box.cx), '-Y', String(box.y + box.cy)));
await new Promise((r) => setTimeout(r, 600));

const after = await evaluate(`(${probe})`);
console.log('probe after :', JSON.stringify(after));
console.log(before !== after ? 'PASS: 真实点击有反应' : 'FAIL: 真实点击无反应（被拖拽区吃掉）');
ws.close();
process.exit(before !== after ? 0 : 1);
