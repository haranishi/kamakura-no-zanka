// tools/verify-pages-browser.mjs — .pages-dist/ を本番と同じ _headers（CSP含む）付きで配信し、
// 実ブラウザ（Playwright Chromium + pointerlock-guard）で PC・スマホ縦・スマホ横・極小横を検証する。
// 実行例: PLAYWRIGHT_MODULE=<path/to/playwright/index.mjs> node tools/verify-pages-browser.mjs [--out .pages-dist] [--shots .work/pages-shots]
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { guardPointerLock } from './lib/pointerlock-guard.mjs';

const DEFAULT_ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function parseHeaders(filePath) {
  const rules = [];
  let current = null;
  for (const raw of fs.readFileSync(filePath, 'utf8').split('\n')) {
    const line = raw.trimEnd();
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!line.startsWith(' ')) {
      current = { pattern: line.trim(), headers: [] };
      rules.push(current);
    } else if (current) {
      const idx = line.indexOf(':');
      if (idx > 0) current.headers.push([line.slice(0, idx).trim(), line.slice(idx + 1).trim()]);
    }
  }
  return rules;
}

function headersForPath(rules, urlPath) {
  const out = {};
  for (const rule of rules) {
    const prefix = rule.pattern.endsWith('*') ? rule.pattern.slice(0, -1) : rule.pattern;
    const match = rule.pattern.endsWith('*') ? urlPath.startsWith(prefix) : urlPath === rule.pattern;
    if (match) for (const [k, v] of rule.headers) out[k] = v;
  }
  return out;
}

function startStaticServer(dir) {
  const rules = parseHeaders(path.join(dir, '_headers'));
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    if (urlPath === '/valley' || urlPath === '/valley/' || urlPath === '/valley/index.html') {
      res.writeHead(301, { Location: '/', ...headersForPath(rules, urlPath) });
      res.end();
      return;
    }
    const rel = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '');
    const file = path.resolve(dir, rel);
    if (!file.startsWith(path.resolve(dir) + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      const notFound = fs.readFileSync(path.join(dir, '404.html'));
      res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8', ...headersForPath(rules, urlPath) });
      res.end(notFound);
      return;
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', ...headersForPath(rules, urlPath) });
    res.end(fs.readFileSync(file));
  });
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

async function measureShareContrast(page) {
  return page.locator('.share__button').evaluateAll(nodes => {
    const parse = value => {
      const nums = (value.match(/[\d.]+/g) || []).map(Number);
      const scale = value.startsWith('color(') ? 255 : 1;
      return { rgb: nums.slice(0, 3).map(v => v * scale), alpha: nums.length > 3 ? nums[3] : 1 };
    };
    const ch = v => {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
    };
    const lum = rgb => 0.2126 * ch(rgb[0]) + 0.7152 * ch(rgb[1]) + 0.0722 * ch(rgb[2]);
    const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const groundOf = node => {
      let p = node.parentElement;
      while (p) {
        const bg = parse(getComputedStyle(p).backgroundColor);
        if (bg.alpha > 0) return bg.rgb;
        p = p.parentElement;
      }
      return [16, 23, 27];
    };
    return nodes.map(node => {
      const edge = parse(getComputedStyle(node).borderTopColor);
      const bg = groundOf(node);
      const blended = edge.rgb.map((v, i) => edge.alpha * v + (1 - edge.alpha) * bg[i]);
      const rect = node.getBoundingClientRect();
      return {
        text: node.textContent.trim(),
        height: Math.round(rect.height),
        ratio: +ratio(lum(blended), lum(bg)).toFixed(2),
      };
    });
  });
}

async function run() {
  const args = process.argv.slice(2);
  const pick = flag => {
    const i = args.indexOf(flag);
    return i >= 0 ? args[i + 1] : undefined;
  };
  const outDir = path.resolve(pick('--out') || path.join(DEFAULT_ROOT, '.pages-dist'));
  const shotsDir = pick('--shots') ? path.resolve(pick('--shots')) : null;
  if (shotsDir) fs.mkdirSync(shotsDir, { recursive: true });

  const pwPath = process.env.PLAYWRIGHT_MODULE;
  if (!pwPath) throw new Error('PLAYWRIGHT_MODULE env var is required');
  const pw = await import(pathToFileURL(pwPath).href);
  const chromium = pw.chromium || pw.default?.chromium;

  const { server, base } = await startStaticServer(outDir);
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const summary = { pc: {}, mobilePortrait: {}, mobileLandscape: {}, compactLandscape: {}, routes: {} };

  try {
    // 0. Route checks: 404 & /valley/ 301
    {
      const r404 = await fetch(`${base}/missing-route`);
      assert.equal(r404.status, 404);
      const r301 = await fetch(`${base}/valley/`, { redirect: 'manual' });
      assert.equal(r301.status, 301);
      assert.equal(r301.headers.get('location'), '/');
      summary.routes = { notFound: 404, valleyRedirect: 301 };
    }

    const openPage = async (viewport, urlPath) => {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await guardPointerLock(page);
      const errors = [];
      const externalRequests = [];
      const failedRequests = [];
      page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
      page.on('console', msg => {
        if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
      });
      page.on('request', req => {
        const u = req.url();
        if (!u.startsWith(base) && !u.startsWith('blob:') && !u.startsWith('data:')) externalRequests.push(u);
      });
      page.on('requestfailed', req => failedRequests.push(`${req.url()} (${req.failure()?.errorText})`));
      await page.goto(`${base}${urlPath}`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__valleyReady === true, null, { timeout: 60000 });
      return { context, page, errors, externalRequests, failedRequests };
    };

    // 1. PC (1280x720)
    {
      const { context, page, errors, externalRequests, failedRequests } = await openPage({ width: 1280, height: 720 }, '/?qa=1&intro=0');
      const touchOn = await page.evaluate(() => document.documentElement.classList.contains('kz-touch'));
      assert.equal(touchOn, false, 'PC must not enable kz-touch');
      const quality = await page.evaluate(() => document.getElementById('set-quality').value);
      assert.equal(quality, 'standard', 'PC default quality must be standard');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `PC overflow: ${overflow}`);

      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '01-pc-title.png') });

      // Share dialog
      await page.getByRole('button', { name: 'このアプリを共有する', exact: true }).click();
      await page.waitForSelector('#share-dialog[open] .share');
      const shareMetrics = await measureShareContrast(page);
      assert.ok(shareMetrics.length >= 3, 'Share widget needs at least X, LINE, Copy');
      for (const m of shareMetrics) {
        assert.ok(m.height >= 44, `Share button too short: ${m.text} (${m.height}px)`);
        assert.ok(m.ratio >= 3, `Share button border contrast too low: ${m.text} (${m.ratio}:1)`);
      }
      const xHref = await page.locator('.share a', { hasText: 'Xで投稿' }).getAttribute('href');
      assert.ok(xHref.includes(encodeURIComponent('https://day98.rairakku.com/')), 'X share URL must use canonical');
      const noteText = await page.locator('.share__note').textContent();
      assert.ok(noteText.includes('Instagram') && noteText.includes('YouTube'));
      await page.click('#share-close');

      // Credits dialog
      await page.click('#btn-credits');
      await page.waitForSelector('#credits-dialog[open]');
      const creditsText = await page.locator('#credits-dialog').textContent();
      assert.ok(creditsText.includes('CC BY 4.0') && creditsText.includes('MIT') && creditsText.includes('Meshy'));
      await page.click('#credits-close');

      // Capture overlook shot (PR #222 latest visuals) & gameplay shot
      await page.evaluate(() => {
        window.__valley.start('new');
        window.__valley.freeze(true);
        window.__valley.step(30, 1 / 60);
      });
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '02-pc-play.png') });

      // Overlook concept camera for card screenshot
      await page.goto(`${base}/?qa=1&autostart=new&intro=0&cam=concept`, { waitUntil: 'domcontentloaded', timeout: 60000 });
      await page.waitForFunction(() => window.__valleyReady === true, null, { timeout: 60000 });
      await page.evaluate(() => {
        window.__valley.freeze(true);
        window.__valley.step(10, 1 / 60);
        document.body.classList.add('hide-hud');
      });
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '00-overlook-card.png') });

      assert.deepEqual(errors, [], `PC errors: ${errors.join('; ')}`);
      assert.deepEqual(externalRequests, [], `PC external requests: ${externalRequests.join(', ')}`);
      assert.deepEqual(failedRequests, [], `PC failed requests: ${failedRequests.join(', ')}`);
      summary.pc = { quality, overflow, shareMetrics, errors: 0, externalRequests: 0 };
      await context.close();
    }

    // 2. Mobile Portrait (390x844, ?touch=1)
    {
      const { context, page, errors, externalRequests, failedRequests } = await openPage({ width: 390, height: 844 }, '/?touch=1&qa=1&intro=0');
      const touchOn = await page.evaluate(() => document.documentElement.classList.contains('kz-touch'));
      assert.equal(touchOn, true, 'Mobile portrait must enable kz-touch');
      const quality = await page.evaluate(() => document.getElementById('set-quality').value);
      assert.equal(quality, 'light', 'Touch device must default to light quality');
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(overflow <= 1, `Portrait overflow: ${overflow}`);
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '03-mobile-portrait-title.png') });

      await page.getByRole('button', { name: 'このアプリを共有する', exact: true }).click();
      await page.waitForSelector('#share-dialog[open] .share');
      const shareOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(shareOverflow <= 1, `Portrait share dialog overflow: ${shareOverflow}`);
      await page.click('#share-close');

      await page.click('#btn-start');
      await page.waitForSelector('.kz-orient-banner:not(.hidden)', { timeout: 15000 });
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '03b-mobile-portrait-play.png') });
      const portraitHudCheck = await page.evaluate(() => {
        const obj = document.querySelector('.obj').getBoundingClientRect();
        const bars = document.querySelector('.bars').getBoundingClientRect();
        const hint = document.getElementById('hint')?.textContent || '';
        return { objBottom: Math.round(obj.bottom), barsTop: Math.round(bars.top), hint };
      });
      assert.ok(portraitHudCheck.objBottom <= portraitHudCheck.barsTop, `Portrait .obj overlaps .bars: ${JSON.stringify(portraitHudCheck)}`);
      assert.ok(!portraitHudCheck.hint.includes('W A S D') && portraitHudCheck.hint.includes('ドラッグ'), `Portrait hint should use touch phrasing: ${portraitHudCheck.hint}`);
      const bannerVisible = await page.locator('.kz-orient-banner').isVisible();
      assert.equal(bannerVisible, true, 'Portrait play should display dismissible orientation recommendation');
      await page.click('.kz-orient-close');
      assert.equal(await page.locator('.kz-orient-banner').isVisible(), false, 'Orientation banner must dismiss');

      assert.deepEqual(errors, [], `Portrait errors: ${errors.join('; ')}`);
      assert.deepEqual(externalRequests, [], `Portrait external requests: ${externalRequests.join(', ')}`);
      assert.deepEqual(failedRequests, [], `Portrait failed requests: ${failedRequests.join(', ')}`);
      summary.mobilePortrait = { quality, overflow, shareOverflow, bannerDismissed: true, errors: 0 };
      await context.close();
    }

    // 3. Mobile Landscape (844x390, ?touch=1) — Full touch input functional check
    {
      const { context, page, errors, externalRequests, failedRequests } = await openPage({ width: 844, height: 390 }, '/?touch=1&qa=1&intro=0');
      await page.click('#btn-start');
      await page.waitForFunction(() => window.__valleyTouch?.active === true, null, { timeout: 10000 });
      await page.evaluate(() => {
        window.__valley.freeze(true);
        window.__valley.step(5, 1 / 60);
      });
      if (shotsDir) await page.screenshot({ path: path.join(shotsDir, '04-mobile-landscape-play.png') });
      const landHudCheck = await page.evaluate(() => {
        const obj = document.querySelector('.obj').getBoundingClientRect();
        const bars = document.querySelector('.bars').getBoundingClientRect();
        const hint = document.getElementById('hint')?.textContent || '';
        return { objBottom: Math.round(obj.bottom), barsTop: Math.round(bars.top), hint };
      });
      assert.ok(landHudCheck.objBottom <= landHudCheck.barsTop, `Landscape .obj overlaps .bars: ${JSON.stringify(landHudCheck)}`);
      assert.ok(!landHudCheck.hint.includes('W A S D') && landHudCheck.hint.includes('ドラッグ'), `Landscape hint should use touch phrasing: ${landHudCheck.hint}`);

      const info = await page.evaluate(() => window.__valleyTouch.info());
      const names = ['attack', 'guard', 'dodge', 'heavy', 'interact', 'crouch', 'lock', 'guide'];
      const rects = [];
      for (const n of names) {
        const r = info.buttons[n];
        assert.ok(r && r.width >= 44 && r.height >= 44, `Touch button ${n} too small: ${JSON.stringify(r)}`);
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 844 && r.y + r.height <= 390, `Touch button ${n} clipped: ${JSON.stringify(r)}`);
        rects.push({ n, ...r });
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i], b = rects[j];
          const overlap = a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
          assert.equal(overlap, false, `Touch buttons overlap: ${a.n} and ${b.n}`);
        }
      }

      // Simulate stick drag (run), look drag, attack, guard, crouch via PointerEvent
      const sim = await page.evaluate(() => {
        const before = window.__valley.state();
        const stickZone = document.querySelector('[data-testid="touch-stick-zone"]');
        const lookZone = document.querySelector('[data-testid="touch-look-zone"]');
        const attackBtn = document.querySelector('[data-testid="touch-btn-attack"]');
        const guardBtn = document.querySelector('[data-testid="touch-btn-guard"]');
        const crouchBtn = document.querySelector('[data-testid="touch-btn-crouch"]');

        const dispatch = (el, type, init) => el.dispatchEvent(new PointerEvent(type, { bubbles: true, cancelable: true, pointerType: 'touch', ...init }));
        // Stick drag upward past run threshold
        dispatch(stickZone, 'pointerdown', { pointerId: 1, isPrimary: true, clientX: 110, clientY: 280 });
        dispatch(window, 'pointermove', { pointerId: 1, isPrimary: true, clientX: 110, clientY: 190 });
        window.__valley.step(30, 1 / 60);
        const afterMove = window.__valley.state();
        const stickRun = window.__valleyTouch.info().stick.run;
        dispatch(window, 'pointerup', { pointerId: 1, isPrimary: true, clientX: 110, clientY: 190 });

        // Look drag
        const yawBefore = window.__valley.state().camera.yaw;
        dispatch(lookZone, 'pointerdown', { pointerId: 2, isPrimary: true, clientX: 480, clientY: 180 });
        dispatch(window, 'pointermove', { pointerId: 2, isPrimary: true, clientX: 540, clientY: 180 });
        window.__valley.step(5, 1 / 60);
        const yawAfter = window.__valley.state().camera.yaw;
        dispatch(window, 'pointerup', { pointerId: 2, isPrimary: true, clientX: 540, clientY: 180 });

        // Crouch toggle
        dispatch(crouchBtn, 'pointerdown', { pointerId: 3, isPrimary: true, clientX: 700, clientY: 80 });
        window.__valley.step(2, 1 / 60);
        dispatch(window, 'pointerup', { pointerId: 3, isPrimary: true, clientX: 700, clientY: 80 });
        const crouched = window.__valley.state().hero.crouch;
        // Stand back up
        dispatch(crouchBtn, 'pointerdown', { pointerId: 4, isPrimary: true, clientX: 700, clientY: 80 });
        window.__valley.step(2, 1 / 60);
        dispatch(window, 'pointerup', { pointerId: 4, isPrimary: true, clientX: 700, clientY: 80 });

        // Guard hold
        dispatch(guardBtn, 'pointerdown', { pointerId: 5, isPrimary: true, clientX: 700, clientY: 340 });
        window.__valley.step(4, 1 / 60);
        const blocking = window.__valley.state().hero.blocking;
        dispatch(window, 'pointerup', { pointerId: 5, isPrimary: true, clientX: 700, clientY: 340 });
        window.__valley.step(3, 1 / 60);

        // Attack tap
        dispatch(attackBtn, 'pointerdown', { pointerId: 6, isPrimary: true, clientX: 790, clientY: 340 });
        window.__valley.step(4, 1 / 60);
        const attackState = window.__valley.state().hero.state;
        dispatch(window, 'pointerup', { pointerId: 6, isPrimary: true, clientX: 790, clientY: 340 });

        const movedDist = Math.hypot(afterMove.hero.x - before.hero.x, afterMove.hero.z - before.hero.z);
        return { movedDist: +movedDist.toFixed(2), stickRun, yawDelta: +(yawAfter - yawBefore).toFixed(3), crouched, blocking, attackState };
      });
      assert.ok(sim.movedDist > 0.5, `Hero did not move on stick drag: ${sim.movedDist}`);
      assert.equal(sim.stickRun, true, 'Stick drag past 1.38R must engage run');
      assert.ok(Math.abs(sim.yawDelta) > 0.05, `Look drag did not rotate camera: ${sim.yawDelta}`);
      assert.equal(sim.crouched, true, 'Crouch button did not toggle crouch');
      assert.equal(sim.blocking, true, 'Guard button did not block');
      assert.equal(sim.attackState, 'attack', `Attack button did not start attack: ${sim.attackState}`);

      // Pause opens cleanly and shows touch key guide
      await page.click('#menu-btn');
      await page.waitForSelector('#pause[open]');
      const touchGuideVisible = await page.locator('.keys-touch').isVisible();
      const pcGuideVisible = await page.locator('.keys-pc').isVisible();
      assert.equal(touchGuideVisible, true, 'Touch guide should be visible in pause dialog on touch devices');
      assert.equal(pcGuideVisible, false, 'PC guide should be hidden in pause dialog on touch devices');
      await page.click('#pause-resume');

      assert.deepEqual(errors, [], `Landscape errors: ${errors.join('; ')}`);
      assert.deepEqual(externalRequests, [], `Landscape external requests: ${externalRequests.join(', ')}`);
      assert.deepEqual(failedRequests, [], `Landscape failed requests: ${failedRequests.join(', ')}`);
      summary.mobileLandscape = { ...sim, buttonsChecked: names.length, overlapCount: 0, errors: 0 };
      await context.close();
    }

    // 4. Compact Landscape (568x320, ?touch=1)
    {
      const { context, page, errors, externalRequests, failedRequests } = await openPage({ width: 568, height: 320 }, '/?touch=1&qa=1&intro=0');
      const titleOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      assert.ok(titleOverflow <= 1, `Compact title overflow: ${titleOverflow}`);
      await page.click('#btn-start');
      await page.waitForFunction(() => window.__valleyTouch?.active === true, null, { timeout: 10000 });
      const info = await page.evaluate(() => window.__valleyTouch.info());
      const names = ['attack', 'guard', 'dodge', 'heavy', 'interact', 'crouch', 'lock', 'guide'];
      for (const n of names) {
        const r = info.buttons[n];
        assert.ok(r && r.width >= 44 && r.height >= 44, `Compact button ${n} too small: ${JSON.stringify(r)}`);
        assert.ok(r.x >= 0 && r.y >= 0 && r.x + r.width <= 568 && r.y + r.height <= 320, `Compact button ${n} clipped: ${JSON.stringify(r)}`);
      }
      assert.deepEqual(errors, [], `Compact errors: ${errors.join('; ')}`);
      assert.deepEqual(externalRequests, [], `Compact external requests: ${externalRequests.join(', ')}`);
      assert.deepEqual(failedRequests, [], `Compact failed requests: ${failedRequests.join(', ')}`);
      summary.compactLandscape = { titleOverflow, buttonsChecked: names.length, errors: 0 };
      await context.close();
    }

    console.log('Browser verification PASSED:', JSON.stringify(summary, null, 2));
  } finally {
    await browser.close();
    server.closeAllConnections?.();
    await new Promise(resolve => server.close(resolve));
  }
}

run().catch(err => {
  console.error('Browser verification FAILED:', err);
  process.exit(1);
});
