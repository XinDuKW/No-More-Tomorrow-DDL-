// 测试用 CDP 客户端：连接 Electron 的 remote-debugging-port，读取/操作页面。
// 用法:
//   node scripts/cdp.mjs list
//   node scripts/cdp.mjs eval "<js>"            # 对所有页面目标执行
//   node scripts/cdp.mjs shot <index> <out.png> # 截图某个页面目标
import { writeFileSync } from 'node:fs';

const PORT = process.env.NT_DEBUG_PORT || '9222';
const base = `http://127.0.0.1:${PORT}`;

async function targets() {
  const res = await fetch(`${base}/json/list`);
  const all = await res.json();
  return all.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
}

class Client {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.addEventListener('open', () => resolve());
      this.ws.addEventListener('error', (e) => reject(new Error('ws error')));
      this.ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: r, reject: j } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) j(new Error(JSON.stringify(msg.error))); else r(msg.result);
        }
      });
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => { if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); } }, 15000);
    });
  }
  close() { try { this.ws.close(); } catch (e) { /* ignore */ } }
}

const cmd = process.argv[2] || 'list';
const list = await targets();

if (cmd === 'list') {
  list.forEach((t, i) => console.log(`#${i} ${t.title} | ${t.url} | ${t.id}`));
  console.log(`total ${list.length}`);
  process.exit(0);
}

if (cmd === 'eval' || cmd === 'eval1') {
  const only = cmd === 'eval1' ? Number(process.argv[3]) : -1;
  const code = cmd === 'eval1' ? (process.argv[4] || '1') : (process.argv[3] || '1');
  for (const [i, t] of list.entries()) {
    if (only >= 0 && i !== only) continue;
    const c = new Client(t.webSocketDebuggerUrl);
    await c.connect();
    try {
      const r = await c.send('Runtime.evaluate', {
        expression: `(() => { try { return JSON.stringify((${code})); } catch (e) { return 'ERR: ' + e.message; } })()`,
        returnByValue: true, awaitPromise: true
      });
      console.log(`#${i} ${t.title} -> ${r.result.value}`);
    } catch (err) {
      console.log(`#${i} ${t.title} -> FAILED ${err.message}`);
    }
    c.close();
  }
  process.exit(0);
}

if (cmd === 'shot') {
  const idx = Number(process.argv[3] || 0);
  const out = process.argv[4] || `shot-${idx}.png`;
  const t = list[idx];
  if (!t) { console.error('no such target'); process.exit(1); }
  const c = new Client(t.webSocketDebuggerUrl);
  await c.connect();
  const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  writeFileSync(out, Buffer.from(r.data, 'base64'));
  console.log(`saved ${out} from #${idx} ${t.title}`);
  c.close();
  process.exit(0);
}

if (cmd === 'mouse') {
  // node scripts/cdp.mjs mouse <idx> <pressed|released|moved> <x> <y>
  const idx = Number(process.argv[3]);
  const type = process.argv[4];
  const x = Number(process.argv[5]);
  const y = Number(process.argv[6]);
  const t = list[idx];
  if (!t) { console.error('no such target'); process.exit(1); }
  const c = new Client(t.webSocketDebuggerUrl);
  await c.connect();
  const map = { pressed: 'mousePressed', released: 'mouseReleased', moved: 'mouseMoved' };
  const params = {
    type: map[type] || type, x, y, button: 'left', clickCount: 1,
    buttons: type === 'released' ? 0 : 1
  };
  const r = await c.send('Input.dispatchMouseEvent', params);
  console.log(`mouse ${type} at ${x},${y} on #${idx} -> ok`);
  c.close();
  process.exit(0);
}

console.error('unknown cmd');
process.exit(1);
