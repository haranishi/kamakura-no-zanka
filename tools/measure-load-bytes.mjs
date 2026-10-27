import fs from 'node:fs/promises';
import path from 'node:path';
import { createServer } from './serve.mjs';
import journey from './scenarios/load-journey.mjs';
// design-validation.md「読み込み」の仕様値。上位15件は今回の測定出力契約。
const MIB = 1048576, RESERVE_LIMIT = 84.5, LIMIT = 90, TOP = 15;
const args = process.argv.slice(2), outIndex = args.indexOf('--out');
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer();
let browser;
try {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--use-angle=metal', '--enable-gpu-rasterization', '--ignore-gpu-blocklist', '--enable-unsafe-swiftshader'] });
  // R14.8の画面条件を読み込みにも使用。
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1 });
  const entries = new Map(), pending = [], failures = [], pageErrors = [];
  page.on('pageerror', e => pageErrors.push(e.message));
  // blob: はブラウザ内の一時データ（GLBから取り出した画像など）。通信ではなく、本体は元のGLBに数えている。
  page.on('requestfailed', req => { if (!req.url().startsWith('blob:')) failures.push(`${new URL(req.url()).pathname}: ${req.failure()?.errorText}`); });
  const collect = response => {
    const url = response.url();
    if (url.startsWith('data:') || url.startsWith('blob:') || entries.has(url)) return;
    if (response.status() >= 300 && response.status() < 400) return; // リダイレクトは本体なし
    entries.set(url, null);
    pending.push((async () => {
      try {
        const body = await response.body(); // PlaywrightはContent-Encodingを解いた本体を返す
        if (!response.ok()) failures.push(`${new URL(url).pathname}: HTTP ${response.status()}`);
        entries.set(url, { url: url.replace(base, ''), bytes: body.length, MiB: body.length / MIB });
      } catch { failures.push(`${new URL(url).pathname}: response body unavailable`); }
    })());
  };
  page.on('response', collect);
  await page.goto(`${base}/valley/index.html?qa=1&intro=0&seed=1333&w=1280&h=720`);
  await page.waitForFunction('window.__valleyReady===true', null, { timeout: 180000 }); // valley-playの既存待機上限
  const call = (name, ...a) => page.evaluate(({ name, a }) => window.__valley[name](...a), { name, a });
  const stages = await journey({ call, v: expr => page.evaluate(expr), st: () => call('state'), step: (n, dt = 1 / 60) => call('step', n, dt), start: mode => call('start', mode), freeze: on => call('freeze', on) });
  await page.waitForLoadState('networkidle');
  page.off('response', collect); await Promise.all(pending);
  const files = [...entries.values()].filter(Boolean).sort((a, b) => b.bytes - a.bytes || a.url.localeCompare(b.url));
  const bytes = files.reduce((n, f) => n + f.bytes, 0), MiB = bytes / MIB;
  const result = { note: 'URLごとの非圧縮の本体バイト。重複なし・data:とHTTPヘッダーは除く。URLは配信元相対。',
    complete: failures.length === 0 && pageErrors.length === 0, stages, bytes, MiB, files, top15: files.slice(0, TOP),
    comparison: { reserveLimitMiB: RESERVE_LIMIT, limitMiB: LIMIT, overReserveMiB: MiB - RESERVE_LIMIT, overLimitMiB: MiB - LIMIT },
    decision: failures.length || pageErrors.length ? '測定未完了（失敗あり）' : MiB <= RESERVE_LIMIT ? '削減は不要' : '84.5MiB超過。90MiBを維持して圧縮を先行', failures, pageErrors };
  if (outIndex >= 0) { const out = args[outIndex + 1]; if (!out) throw Error('--out requires a file'); await fs.mkdir(path.dirname(out), { recursive: true }); await fs.writeFile(out, JSON.stringify(result, null, 2) + '\n'); }
  console.log(`実読み込み ${MiB.toFixed(6)} MiB / 84.5 MiB（追加枠確保） / 90 MiB（総枠）: ${result.decision}`);
  console.table(result.top15); console.log(JSON.stringify(result, null, 2));
  if (!result.complete) process.exitCode = 1;
} finally { await browser?.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
