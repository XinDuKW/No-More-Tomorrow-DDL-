// 端到端测试：用真实鼠标坐标 + CDP 注入指针事件，验证「自定义缩放热区」是否真的能改窗口大小。
// 用法: node scripts/test-resize.mjs <targetIndex> [dx] [dy]
import { execFileSync } from 'node:child_process';

const PORT = process.env.NT_DEBUG_PORT || '9222';
const idx = Number(process.argv[2] || 0);
const dx = Number(process.argv[3] || 120);
const dy = Number(process.argv[4] || 90);

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
const setCursor = (x, y) => execFileSync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', 'scripts/win-ctl.ps1', '-Action', 'setcursor', '-X', String(Math.round(x)), '-Y', String(Math.round(y))], { encoding: 'utf8' }).trim();

const before = await evaluate('({x: screenX, y: screenY, w: innerWidth, h: innerHeight})');
console.log('before:', JSON.stringify(before));

const hx = before.w - 5;
const hy = before.h - 5;
console.log('cursor ->', setCursor(before.x + hx, before.y + hy));
await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: hx, y: hy, button: 'left', buttons: 1, clickCount: 1 });
await new Promise((r) => setTimeout(r, 250));
console.log('cursor ->', setCursor(before.x + hx + dx, before.y + hy + dy));
await new Promise((r) => setTimeout(r, 500));
await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: hx + dx, y: hy + dy, button: 'left', buttons: 0, clickCount: 1 });
await new Promise((r) => setTimeout(r, 500));

const after = await evaluate('({x: screenX, y: screenY, w: innerWidth, h: innerHeight})');
console.log('after :', JSON.stringify(after));
const ok = after.w === before.w + dx && after.h === before.h + dy;
console.log(ok ? 'PASS: 缩放生效' : `FAIL: 期望 ${before.w + dx}x${before.h + dy}`);
ws.close();
process.exit(ok ? 0 : 1);
