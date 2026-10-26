// 開発用：縦切りを自動で遊ぶ道具（ヘッドレスChrome + ?qa=1 のフック window.__valley）。ランタイムは依存なし。
// 使い方: PLAYWRIGHT_MODULE=<playwright/index.mjs> node tools/valley-play.mjs <シナリオ.mjs> [--w 1280 --h 720 --q standard --out .captures/play --seed 1333 --intro 1 --log]
//   既定では冒頭の目覚めの演出を飛ばす（intro=0）。演出を見るときは --intro 1。
// シナリオは `export default async function (ctx) {...}`。ctx = { page, v(式), st(), step(n,dt), shot(名前), key/tap/click, wait(ms), log(...) }。
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createServer } from './serve.mjs';

const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : fallback; };
const scenarioPath = args.find((a, i) => !a.startsWith('--') && !(i > 0 && args[i - 1].startsWith('--') && args[i - 1] !== '--log'));
if (!scenarioPath) { console.error('usage: valley-play.mjs <scenario.mjs> [--w --h --q --out --seed --log]'); process.exit(2); }
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const out = path.resolve(flag('out', '.captures/play'));
await fs.mkdir(out, { recursive: true });
const server = createServer(); await new Promise(r => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });
const logs = [];
try {
  const W = Number(flag('w', 1280)), H = Number(flag('h', 720));
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  page.on('console', m => { if (args.includes('--log') || m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
  page.on('pageerror', e => logs.push('[pageerror] ' + (e.stack || e)));
  await page.goto(`${base}/valley/index.html?qa=1&w=${W}&h=${H}&q=${flag('q', 'standard')}&seed=${flag('seed', 1333)}${flag('intro', '0') === '0' ? '&intro=0' : ''}`);
  await page.waitForFunction('window.__valleyReady===true', null, { timeout: 180000 });
  const v = expr => page.evaluate(expr);
  const ctx = {
    page, out, v,
    st: () => page.evaluate('__valley.state()'),
    step: (n = 1, dt = 1 / 60) => page.evaluate(`__valley.step(${n}, ${dt})`),
    start: (mode = 'new') => page.evaluate(`(__valley.start(${JSON.stringify(mode)}), 0)`),
    freeze: (on = true) => page.evaluate(`(__valley.freeze(${on}), 0)`),
    key: (code, down = true) => page.evaluate(`(__valley.key(${JSON.stringify(code)}, ${down}), 0)`),
    tap: (code, frames = 1) => page.evaluate(`__valley.tap(${JSON.stringify(code)}, ${frames})`),
    click: (button = 0, hold = false) => page.evaluate(`__valley.click(${button}, ${hold})`),
    release: (button = 0) => page.evaluate(`(__valley.release(${button}), 0)`),
    call: (fn, ...a) => page.evaluate(`__valley.${fn}(${a.map(x => JSON.stringify(x)).join(',')})`),
    wait: ms => page.waitForTimeout(ms),
    shot: async name => { const f = path.join(out, name + '.png'); await page.screenshot({ path: f }); console.log('shot', f); return f; },
    log: (...a) => console.log(...a),
  };
  await scenario(ctx);
  async function scenario(c) { const mod = await import(pathToFileURL(path.resolve(scenarioPath)).href); await mod.default(c); }
  if (logs.length) console.log('--- console ---\n' + logs.slice(0, 60).join('\n'));
} catch (e) { console.error('FAILED:', e.stack || e); if (logs.length) console.log('--- console ---\n' + logs.slice(0, 60).join('\n')); process.exitCode = 1; }
finally { await browser.close(); server.closeAllConnections?.(); server.close(); }
