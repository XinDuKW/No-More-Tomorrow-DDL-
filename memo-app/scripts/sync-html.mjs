// 把工作区里的 Activities.html 同步进 app 目录（原始 html 保持不动，始终是唯一数据源）
import { copyFileSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, '..');
const workspace = resolve(appDir, '..');
const src = join(workspace, 'Activities.html');
const dst = join(appDir, 'app', 'Activities.html');

if (!existsSync(src)) {
  console.error('[sync] 找不到源文件: ' + src);
  process.exit(1);
}
mkdirSync(dirname(dst), { recursive: true });
copyFileSync(src, dst);
const kb = (statSync(dst).size / 1024).toFixed(1);
console.log('[sync] ' + src + '  ->  ' + dst + '  (' + kb + ' KB)');
