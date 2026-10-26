// 開発用：配信中の画面を1枚撮る（ヘッドレスChrome）。固定画角の撮影・ラボの確認に使う。ランタイムは依存なし。
// 使い方: PLAYWRIGHT_MODULE=<playwright/index.mjs> node tools/valley-shot.mjs <パス?クエリ> <出力.png>
//         [--w 900 --h 1000 --dpr 1 --ready "式" --delay ms --eval "式" --base http://127.0.0.1:8123 --log]
import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from './serve.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const pos = args.filter((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--log'));
const [target, out] = pos;
if (!target || !out) { console.error('usage: valley-shot.mjs <path> <out.png> [--w --h --dpr --ready --delay --eval --base --log]'); process.exit(2); }
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
let server, base = flag('base', null);
if (!base) { server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${server.address().port}`; }
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width: Number(flag('w', 1280)), height: Number(flag('h', 800)) }, deviceScaleFactor: Number(flag('dpr', 1)) });
  const logs = [];
  page.on('console', m => { if (args.includes('--log') || m.type() === 'error') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + e));
  await page.goto(base + (target.startsWith('/') ? target : '/' + target));
  await page.waitForFunction(flag('ready', 'document.title === "ready"'), null, { timeout: Number(flag('timeout', 120000)) });
  if (flag('eval')) { const r = await page.evaluate(flag('eval')); if (r !== undefined) console.log('eval:', JSON.stringify(r)); }
  await page.waitForTimeout(Number(flag('delay', 600)));
  await fs.mkdir(path.dirname(path.resolve(out)), { recursive: true });
  await page.screenshot({ path: out });
  if (logs.length) console.log(logs.join('\n'));
  console.log('saved', out);
} finally { await browser.close(); server?.closeAllConnections?.(); server?.close(); }
