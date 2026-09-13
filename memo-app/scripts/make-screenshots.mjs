// 生成 README 用的界面截图（需先启动带 --remote-debugging-port 的应用）
// 用法: node scripts/make-screenshots.mjs [targetIndex] [outDir]
import { writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const PORT = process.env.NT_DEBUG_PORT || '9222';
const idx = Number(process.argv[2] || 0);
const outDir = resolve(process.argv[3] || '../docs');

// 截图前把「尺寸提示」这类瞬时 UI 藏起来，并让右上角窗口按钮完全显形
const SHOT_CSS = `
  .size-badge { display: none !important; }
  #nt-chrome { opacity: 1 !important; }
`;

const pages = (await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json())
  .filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const t = pages[idx];
if (!t) { console.error('没有找到页面目标，先用 --remote-debugging-port=9222 启动应用'); process.exit(1); }

const ws = new WebSocket(t.webSocketDebuggerUrl);
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
let id = 0; const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); }
});
const send = (method, params = {}) => { const myId = ++id; return new Promise((res, rej) => { pending.set(myId, { res, rej }); ws.send(JSON.stringify({ id: myId, method, params })); }); };
const evaluate = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shot(name) {
  const size = await evaluate('({w: innerWidth, h: innerHeight})');
  const r = await send('Page.captureScreenshot', {
    format: 'png',
    clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 2 },
    captureBeyondViewport: true
  });
  const file = resolve(outDir, name);
  writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('saved', file, `${size.w * 2}x${size.h * 2}`);
}

mkdirSync(outDir, { recursive: true });

// 注入仅用于截图的样式
await evaluate(`(() => {
  const s = document.createElement('style');
  s.id = 'nt-shot-style';
  s.textContent = ${JSON.stringify(SHOT_CSS)};
  document.head.appendChild(s);
  return 'ok';
})()`);

// 放一份看起来像真实使用的示例数据（只在截图时用，不写进仓库）
await evaluate(`(() => {
  const iso = (d) => { const x = new Date(); x.setHours(0,0,0,0); x.setDate(x.getDate() + d); return toISO(x); };
  notes = [
    { id: 'note_1', name: '期末', title: '这学期还剩', tasks: [
      { tid: 's1', name: '数据结构', mode: 'date', date: iso(1), done: false },
      { tid: 's2', name: '大作业', mode: 'date', date: iso(4), done: false },
      { tid: 's3', name: '六级考试', mode: 'date', date: iso(11), done: false },
      { tid: 's4', name: '开题报告', mode: 'date', date: iso(26), done: true }
    ] },
    { id: 'note_2', name: '生活', title: '', tasks: [
      { tid: 's5', name: '体检', mode: 'date', date: iso(3), done: false },
      { tid: 's6', name: '交房租', mode: 'date', date: iso(8), done: false }
    ] }
  ];
  currentNoteId = 'note_1';
  settings.uiColor = '#0078d4'; settings.glowAuto = true;
  applySettings(); saveNotes(); renderTabs(); updateSortUI(); render();
  return notes.length;
})()`);
await sleep(900);
await shot('screenshot-note.png');

// 设置面板
await evaluate(`openSettings(); document.querySelector('.set-scroll').scrollTop = 0; 'ok'`);
await sleep(600);
await shot('screenshot-settings.png');
await evaluate(`closeModal('settings-modal'); 'ok'`);

// 两个窗口并排（如果开了第二个窗口）
if (pages.length > 1) {
  const t2 = pages[1];
  const ws2 = new WebSocket(t2.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws2.addEventListener('open', res); ws2.addEventListener('error', rej); });
  let id2 = 0; const pend2 = new Map();
  ws2.addEventListener('message', (ev) => { const m = JSON.parse(ev.data); if (m.id && pend2.has(m.id)) { const p = pend2.get(m.id); pend2.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); } });
  const send2 = (method, params = {}) => { const myId = ++id2; return new Promise((res, rej) => { pend2.set(myId, { res, rej }); ws2.send(JSON.stringify({ id: myId, method, params })); }); };
  const size = (await send2('Runtime.evaluate', { expression: '({w: innerWidth, h: innerHeight})', returnByValue: true })).result.value;
  const r = await send2('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size.w, height: size.h, scale: 2 }, captureBeyondViewport: true });
  writeFileSync(resolve(outDir, 'screenshot-note2.png'), Buffer.from(r.data, 'base64'));
  console.log('saved', resolve(outDir, 'screenshot-note2.png'));
  ws2.close();
}

ws.close();
