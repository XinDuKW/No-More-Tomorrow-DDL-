// 真实鼠标拖动测试：按住某个元素拖动 dx,dy，验证窗口是否跟着移动。
// 用法: node scripts/test-drag.mjs <targetIndex> "<selector>" <dx> <dy>
import { execFileSync } from 'node:child_process';

const PORT = process.env.NT_DEBUG_PORT || '9222';
const idx = Number(process.argv[2] || 0);
const selector = process.argv[3] || '#nt-dragbar';
const dx = Number(process.argv[4] || 100);
const dy = Number(process.argv[5] || 80);

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

const info = await evaluate(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null;
  const r = e.getBoundingClientRect(); return { x: screenX, y: screenY, cx: Math.round(r.left + r.width / 2), cy: Math.round(r.top + r.height / 2),
  region: getComputedStyle(e).webkitAppRegion, top: (function(){ const el = document.elementFromPoint(Math.round(r.left+r.width/2), Math.round(r.top+r.height/2)); return el ? (el.id || el.className) : null; })() }; })()`);
if (!info) { console.error('no element', selector); process.exit(1); }
console.log('drag source:', JSON.stringify(info));

const sx = info.x + info.cx, sy = info.y + info.cy;
console.log(winCtl('-Action', 'drag', '-X', String(sx), '-Y', String(sy), '-X2', String(sx + dx), '-Y2', String(sy + dy)));
await new Promise((r) => setTimeout(r, 700));

const after = await evaluate(`({x: screenX, y: screenY, w: innerWidth, h: innerHeight})`);
console.log(`before: ${info.x},${info.y}   after: ${after.x},${after.y}`);
const movedX = after.x - info.x, movedY = after.y - info.y;
const ok = Math.abs(movedX - dx) <= 20 && Math.abs(movedY - dy) <= 20;
console.log(`${ok ? 'PASS' : 'FAIL'}: 窗口位移 ${movedX},${movedY}（期望约 ${dx},${dy}）`);
ws.close();
process.exit(ok ? 0 : 1);
