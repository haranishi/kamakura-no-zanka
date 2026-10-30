// 開発用：人物ラボ（lab.html）を開き、シナリオを動かす（ヘッドレスChrome）。valley-play.mjs のラボ版。ランタイムは依存なし。
// 使い方: PLAYWRIGHT_MODULE=<playwright/index.mjs> node tools/lab-play.mjs <シナリオ.mjs> [--query "who=hero&weapon=drawn"] [--w 900 --h 1100 --out .captures/lab --strict --log]
// シナリオは `export default async function (ctx) {...}`。ctx = { page, out, v(式), shot(名前), log(...) }。
// ラボの描画の繰り返しは、シナリオが __lab.renderer.setAnimationLoop(null) で止めて、自分で描いてよい（固定カメラの寄りの撮影）。
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from './serve.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const scenarioPath = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && !['--log', '--strict'].includes(args[i - 1])));
if (!scenarioPath) { console.error('usage: lab-play.mjs <scenario.mjs> [--query --w --h --out --strict --log]'); process.exit(2); }
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(flag('out', '.captures/lab'));
await fs.mkdir(out, { recursive: true });
const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
const logs = [];
try {
  const W = Number(flag('w', 900)), H = Number(flag('h', 1100));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => { if (args.includes('--log') || m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e)));
  await page.goto(`${base}/valley/lab.html?shot=1&w=${W}&h=${H}&${flag('query', 'who=hero')}`);
  // 読み込みの例外は待たずに止める（ラボは例外のあと ready にならない）
  for (let t = 0; ; t += 250) {
    if (await page.evaluate('document.title === "ready"')) break;
    if (logs.some(l => l.startsWith('[pageerror]'))) throw new Error('page error before ready');
    if (t > 180000) throw new Error('timeout before ready');
    await page.waitForTimeout(250);
  }
  const ctx = {
    page, out, v: expr => page.evaluate(expr),
    shot: async name => { const f = path.join(out, name + '.png'); await page.screenshot({ path: f }); console.log('shot', f); return f; },
    log: (...a) => console.log(...a),
  };
  const mod = await import(pathToFileURL(path.resolve(scenarioPath)).href);
  await mod.default(ctx);
  if (logs.length) console.log('--- console ---\n' + logs.slice(0, 60).join('\n'));
  if (args.includes('--strict') && logs.some(l => l.startsWith('[pageerror]') || l.startsWith('[error]'))) { console.error('STRICT: page errors were logged'); process.exitCode = 1; }
} catch (e) { console.error('FAILED:', e.stack || e); if (logs.length) console.log('--- console ---\n' + logs.slice(0, 60).join('\n')); process.exitCode = 1; }
finally { await browser.close(); server.closeAllConnections?.(); server.close(); }
