// Optional development check. Runtime has no package dependency.
// Point PLAYWRIGHT_MODULE to an installed Playwright ESM entry, or install Playwright locally.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import { createServer } from './serve.mjs';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server = createServer();
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
const directory = new URL('../reports/screenshots/current/', import.meta.url);
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [], results = [], startedAt = Date.now();
const record = (name, details = '') => { results.push({ name, passed: true, details }); console.log('PASS', name, details); };
const state = page => page.evaluate(() => window.__walktest.state);
async function open(context, query = '?qa=1') {
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  await page.goto(base + '/' + query);
  if (query.includes('qa')) await page.waitForFunction(() => window.__walktest?.state.ready, null, { timeout: 60000 });
  else await page.locator('body[data-state="title"]').waitFor({ timeout: 60000 });
  return page;
}
async function start(page) {
  await page.locator('#start').click();
  await page.waitForFunction(() => document.body.dataset.state === 'playing');
  // Exercise the real drag fallback. Pointer lock has its own verification.
  if ((await state(page)).locked) {
    await page.evaluate(() => document.exitPointerLock());
    await page.waitForFunction(() => document.body.dataset.state === 'paused');
    await page.locator('#dialog-close').click();
  }
}
async function drag(page, dx, dy = 0) {
  const viewport = page.viewportSize(), x = viewport.width * .64, y = viewport.height * .43;
  await page.mouse.move(x, y); await page.mouse.down(); await page.mouse.move(x + dx, y + dy, { steps: 4 }); await page.mouse.up();
  await page.waitForTimeout(40);
}
let keyboardLook = false;
async function turnTo(page, x, z) {
  if (keyboardLook) {
    for(let i=0;i<100;i++){
      const current=await state(page),angle=Math.atan2(-(x-current.player.x),-(z-current.player.z));
      const diff=Math.atan2(Math.sin(angle-current.yaw),Math.cos(angle-current.yaw));
      if(Math.abs(diff)<.025)return;
      const key=diff>0?'j':'l';await page.keyboard.down(key);await page.waitForTimeout(Math.min(180,Math.max(16,Math.abs(diff)/(.85*current.settings.sensitivity)*950)));await page.keyboard.up(key);
    }
    throw new Error('Keyboard could not aim toward waypoint');
  }
  for (let i = 0; i < 5; i++) {
    const current = await state(page); const angle = Math.atan2(-(x - current.player.x), -(z - current.player.z));
    let difference = (angle - current.yaw + Math.PI * 3) % (Math.PI * 2) - Math.PI;
    if (Math.abs(difference) < .025) return;
    await drag(page, Math.max(-320, Math.min(320, -difference / (.0025 * current.settings.sensitivity))));
  }
  const current = await state(page); const target = Math.atan2(-(x - current.player.x), -(z - current.player.z));
  assert.ok(Math.abs(Math.atan2(Math.sin(target - current.yaw), Math.cos(target - current.yaw))) < .04, 'normal mouse drag turns toward waypoint');
}
async function walkTo(page, x, z, tolerance = .28) {
  for (let step = 0; step < 70; step++) {
    const current = await state(page), distance = Math.hypot(x - current.player.x, z - current.player.z);
    if (distance <= tolerance) return;
    assert.equal(current.uiState, 'playing');
    await turnTo(page, x, z);
    await page.keyboard.down('w'); await page.waitForTimeout(Math.min(240, Math.max(45, (distance - tolerance) / 2.1 * 700))); await page.keyboard.up('w');
  }
  throw new Error(`Could not reach ${x},${z}: ${JSON.stringify((await state(page)).player)}`);
}
async function operate(page, expected) {
  await page.keyboard.press('e'); await page.waitForTimeout(120);
  assert.equal((await state(page)).game.stage, expected);
}
async function screenshot(page, name) { await page.waitForTimeout(650); await page.screenshot({ path: new URL(name, directory).pathname }); }
let failure;
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await open(context);
  assert.equal((await state(page)).audio.unlocked, false); record('no autoplay before a user gesture');
  await screenshot(page, 'title-1440.png'); await start(page);
  assert.equal((await state(page)).game.stage, 'bucket');
  const frameStart = (await state(page)).elapsed; await page.waitForTimeout(120); assert.ok((await state(page)).elapsed >= frameStart);
  await page.keyboard.press('e'); assert.equal((await state(page)).game.stage, 'bucket'); record('out-of-range operation is rejected');
  await walkTo(page, -4.55, 3.65, .22); await turnTo(page, -4.55, 3.10005); await operate(page, 'empty');
  let current = await state(page); assert.equal(current.quest.sourceNodes, 39); assert.equal(current.quest.meshes, 56); assert.equal(current.quest.parent, 'camera'); assert.equal(current.quest.waterVisible, false);
  record('walk with W and mouse drag to pick up all 39 bucket nodes'); await screenshot(page, 'empty-bucket-1440.png');
  await page.keyboard.down('e'); for (let i = 0; i < 6; i++) await page.keyboard.down('e'); await page.keyboard.up('e'); assert.equal((await state(page)).game.stage, 'empty'); record('held and repeated E does not skip stages');
  await walkTo(page, -4.9, 2.5, .13); await turnTo(page, -5.35, 2.2); await operate(page, 'full');
  current = await state(page); assert.equal(current.quest.waterVisible, true); assert.equal(current.quest.parent, 'camera'); record('fill from the safe east side of the well'); await screenshot(page, 'full-bucket-1440.png');
  await walkTo(page, -4.9, 3.8, .18); await walkTo(page, -8.5, 3.8, .2); await walkTo(page, -8.5, -.4, .25); await turnTo(page, -8.5, -.4); await operate(page, 'delivered');
  current = await state(page); assert.equal(current.quest.parent, 'scene'); assert.equal(current.quest.waterVisible, true); record('carry along a continuous safe path and deliver with normal controls');
  assert.equal(current.life.watered,true); assert.equal(current.life.flowing,false); assert.equal(current.life.lit,false);
  await screenshot(page, 'delivered-1440.png');
  await walkTo(page,-8.5,3.8,.2);await walkTo(page,-4.9,3.8,.18);await walkTo(page,-2.3,3.8,.18);await walkTo(page,-2.3,1.2,.16);await turnTo(page,-1.16,1.2);await operate(page,'irrigated');
  current=await state(page);assert.equal(current.life.flowing,true);assert.equal(current.life.branchesVisible,false);assert.ok(current.life.gateHeight>.5);assert.equal(current.quest.waterVisible,true);
  record('clear visible branches and restore the canal with normal controls');await screenshot(page,'irrigated-1440.png');
  await walkTo(page,-2.3,3.8,.18);await walkTo(page,-8.5,3.8,.2);await walkTo(page,-10.5,3.8,.2);await walkTo(page,-10.5,.4,.16);await turnTo(page,-10.5,-.65);await operate(page,'restored');
  current=await state(page);assert.equal(current.life.lit,true);assert.ok(current.life.lightIntensity>0);assert.equal(current.quest.parent,'scene');assert.equal(current.quest.waterVisible,true);
  assert.equal(await page.locator('#destination').isVisible(),false);assert.ok(await page.locator('#quest-again').isVisible());
  record('light the porch lantern and retain all world consequences');await screenshot(page,'restored-1440.png');
  await page.keyboard.press('r'); assert.equal((await state(page)).game.stage, 'restored'); assert.ok(Math.abs((await state(page)).player.x + 2.3) < .01); record('R resets position while preserving progress');
  await page.keyboard.press('Escape'); await page.waitForFunction(() => document.body.dataset.state === 'paused');
  const stopped = await state(page); await page.keyboard.down('w'); await page.keyboard.press('e'); await page.waitForTimeout(250); await page.keyboard.up('w');
  current = await state(page); assert.deepEqual(current.player, stopped.player); assert.equal(current.game.stage, 'restored'); assert.equal(current.audio.contextState, 'suspended'); assert.equal(current.elapsed, stopped.elapsed); record('pause stops movement, interactions, time and audio');
  await page.locator('#restart-game').click(); await page.locator('#cancel-restart').click(); assert.equal((await state(page)).game.stage, 'restored'); record('cancel restart keeps the completed state');
  await page.locator('#restart-game').click(); await page.locator('#confirm-restart').click(); assert.equal((await state(page)).game.stage, 'bucket'); assert.equal((await state(page)).quest.parent, 'scene'); record('confirmed restart restores the bucket and position');
  await page.reload(); await page.waitForFunction(() => window.__walktest?.state.ready); assert.equal((await state(page)).game.stage, 'bucket'); record('restart saves a consistent initial state');
  await context.close();

  // State restoration is deliberately seeded here, separate from the normal journey above.
  const restoreContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const restore = await open(restoreContext);
  for (const stage of ['bucket', 'empty', 'full', 'delivered','irrigated','restored']) {
    await restore.evaluate(stage => localStorage.setItem('kamakura-progress-v1', JSON.stringify({ schemaVersion: 2, stage })), stage);
    await restore.reload(); await restore.waitForFunction(() => window.__walktest?.state.ready);
    let value = await state(restore); assert.equal(value.game.stage, stage); assert.equal(value.quest.parent, ['empty','full'].includes(stage) ? 'camera' : 'scene'); assert.equal(value.quest.waterVisible, ['full','delivered','irrigated','restored'].includes(stage));
    assert.equal(value.life.watered,['delivered','irrigated','restored'].includes(stage));assert.equal(value.life.flowing,['irrigated','restored'].includes(stage));assert.equal(value.life.lit,stage==='restored');
    await start(restore); await restore.keyboard.press('Escape');
    value = await state(restore); const before = value.player;
    await restore.keyboard.down('w'); await restore.keyboard.press('e'); await restore.waitForTimeout(120); await restore.keyboard.up('w');
    assert.deepEqual((await state(restore)).player, before); assert.equal((await state(restore)).game.stage, stage);
    await restore.locator('#to-title').click(); await start(restore); assert.equal((await state(restore)).game.stage, stage);
    await restore.keyboard.press('r'); assert.equal((await state(restore)).game.stage, stage);
    record('restore, pause, title, continue and R at ' + stage);
  }
  await restore.evaluate(()=>localStorage.setItem('kamakura-progress-v1',JSON.stringify({schemaVersion:1,stage:'delivered'})));await restore.reload();await restore.waitForFunction(()=>window.__walktest?.state.ready);assert.equal((await state(restore)).game.stage,'delivered');assert.equal((await state(restore)).life.watered,true);assert.equal((await state(restore)).life.flowing,false);record('legacy v1 delivery continues at canal work without losing the seedbed');
  for (const raw of ['{', 'null', '[]', '{"schemaVersion":99,"stage":"full"}', '{"schemaVersion":1,"stage":"unknown"}']) {
    await restore.evaluate(raw => localStorage.setItem('kamakura-progress-v1', raw), raw); await restore.reload(); await restore.waitForFunction(() => window.__walktest?.state.ready);
    assert.equal((await state(restore)).game.stage, 'bucket'); assert.match(await restore.locator('#toast').textContent(), /保存データ/);
  }
  record('corrupt JSON, null, array, future schema and invalid stages recover safely');
  await restoreContext.close();

  const rejected = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await rejected.addInitScript(() => {
    const set = Storage.prototype.setItem;
    Storage.prototype.setItem = function(key, value) { if (key === 'kamakura-progress-v1') throw new DOMException('Full', 'QuotaExceededError'); return set.call(this, key, value); };
    if (globalThis.AudioContext) AudioContext.prototype.resume = function() { return Promise.reject(new DOMException('Denied', 'NotAllowedError')); };
  });
  const denied = await open(rejected); await start(denied); await denied.waitForTimeout(150);
  assert.match(await denied.locator('#toast').textContent(), /音を開始/); record('blocked Web Audio reports a reason and keeps the game available');
  for (const [x,z,angle,next] of [[-4.55,3.65,0,'empty'],[-4.9,2.2,Math.PI/2,'full'],[-8.5,.2,0,'delivered'],[-2.3,1.2,-Math.PI/2,'irrigated'],[-10.5,.4,0,'restored']]) {
    await denied.evaluate(([x,z,angle]) => window.__walktest.teleport(x,z,angle), [x,z,angle]);
    await denied.waitForTimeout(500); await operate(denied,next); assert.match(await denied.locator('#toast').textContent(), /保存容量/);
  }
  assert.equal((await state(denied)).game.stage, 'restored'); assert.equal((await state(denied)).hasSave, false); record('quota refusal keeps all five session transitions usable and visible');
  await rejected.close();

  for (const [width,height] of [[390,844],[768,1024],[844,390]]) {
    const mobile = await browser.newContext({ viewport: { width,height }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
    const phone = await open(mobile);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await screenshot(phone, `title-${width}x${height}.png`); await start(phone);
    assert.equal((await state(phone)).settings.quality, 'light');
    const client = await mobile.newCDPSession(phone);
    const touchAt = async (selector, duration = 250) => {
      const box = await phone.locator(selector).boundingBox(); assert.ok(box); const point = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
      await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [point] }); await phone.waitForTimeout(duration); await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    };
    const before = (await state(phone)).player; await touchAt('[data-move="forward"]', 330); const after = (await state(phone)).player;
    assert.ok(Math.hypot(before.x-after.x,before.z-after.z) > .2);
    const beforeYaw = (await state(phone)).yaw;
    const x = width * .75, y = height * .48;
    await client.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{x,y}] });
    await client.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{x:x-45,y}] }); await client.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    assert.ok(Math.abs((await state(phone)).yaw-beforeYaw) > .05);
    await phone.evaluate(() => window.__walktest.teleport(-4.55,3.65,0)); await phone.waitForTimeout(180);
    assert.ok((await phone.locator('.place').boundingBox()).height < 100, 'location stays a compact top-left label');
    await screenshot(phone, `playing-${width}x${height}.png`);
    await phone.keyboard.press('h'); assert.ok(await phone.locator('#menu-button').isVisible()); assert.ok(await phone.locator('#interaction').isVisible());
    await touchAt('#interaction', 80); await phone.waitForTimeout(120); assert.equal((await state(phone)).game.stage, 'empty');
    await phone.keyboard.press('h'); await phone.locator('#menu-button').tap(); await phone.locator('[data-panel="settings"]').tap();
    await phone.locator('#mute').check(); await phone.locator('#quality').selectOption('standard'); await phone.locator('#fov').fill('70'); await phone.locator('#fov').dispatchEvent('input');
    await screenshot(phone, `settings-${width}x${height}.png`);
    assert.equal(await phone.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await phone.reload(); await phone.waitForFunction(() => window.__walktest?.state.ready);
    const value = await state(phone); assert.equal(value.game.stage,'empty'); assert.equal(value.settings.muted,true); assert.equal(value.settings.fov,70); assert.equal(value.settings.quality,'standard');
    record(`touch movement, drag, HUD recovery, interaction, settings and no overflow at ${width}x${height}`);
    await mobile.close();
  }

  const keyboardContext = await browser.newContext({viewport:{width:1440,height:900},reducedMotion:'reduce'});
  const keyboard = await open(keyboardContext);
  assert.equal(await keyboard.evaluate(()=>document.activeElement.id),'start'); await keyboard.keyboard.press('Tab');
  const focus = await keyboard.evaluate(()=>({tag:document.activeElement.tagName,outline:getComputedStyle(document.activeElement).outlineWidth}));
  assert.equal(focus.tag,'BUTTON'); assert.notEqual(focus.outline,'0px');
  await keyboard.locator('[data-open="settings"]').click(); await keyboard.locator('#quality').selectOption('light'); await keyboard.locator('#quality').selectOption('standard');
  await keyboard.locator('#dialog-close').click(); await start(keyboard); assert.equal(await keyboard.evaluate(()=>matchMedia('(prefers-reduced-motion: reduce)').matches),true);
  await screenshot(keyboard,'reduced-motion-1440.png'); record('visible keyboard focus, both quality modes and reduced-motion media setting');
  keyboardLook=true;
  // No mouse input or QA teleport in this journey. All observation uses the QA read-only state.
  for(const [points,anchor,next] of [
    [[[-4.55,3.65]],[-4.55,3.10005],'empty'],
    [[[-4.9,2.5]],[-5.35,2.2],'full'],
    [[[-4.9,3.8],[-8.5,3.8],[-8.5,.2]],[-8.5,-.4],'delivered'],
    [[[-8.5,3.8],[-4.9,3.8],[-2.3,3.8],[-2.3,1.2]],[-1.16,1.2],'irrigated'],
    [[[-2.3,3.8],[-8.5,3.8],[-10.5,3.8],[-10.5,.4]],[-10.5,-.65],'restored']
  ]){
    for(const [x,z] of points)await walkTo(keyboard,x,z,.18);
    await turnTo(keyboard,...anchor);await operate(keyboard,next);
  }
  keyboardLook=false;record('all five actions with WASD, IJKL and E only, under reduced motion');
  await keyboard.keyboard.down('j');await keyboard.keyboard.down('w');await keyboard.waitForTimeout(100);await keyboard.keyboard.press('Tab');
  assert.equal(await keyboard.evaluate(()=>document.activeElement.id),'menu-button');
  const uiFocused=await state(keyboard);await keyboard.waitForTimeout(350);let guarded=await state(keyboard);
  assert.equal(guarded.uiState,'playing');assert.equal(guarded.yaw,uiFocused.yaw);assert.deepEqual(guarded.player,uiFocused.player);
  await keyboard.keyboard.up('j');await keyboard.keyboard.up('w');await keyboard.keyboard.press('Enter');await keyboard.locator('#dialog-close').click();
  record('Tab into a live menu button clears held look and movement keys');
  const beforeLook=await state(keyboard);await keyboard.keyboard.down('i');await keyboard.waitForTimeout(220);await keyboard.keyboard.up('i');assert.ok((await state(keyboard)).pitch>beforeLook.pitch+.05);
  const beforeArrow=(await state(keyboard)).player;await keyboard.keyboard.down('ArrowRight');await keyboard.waitForTimeout(180);await keyboard.keyboard.up('ArrowRight');assert.ok(Math.hypot((await state(keyboard)).player.x-beforeArrow.x,(await state(keyboard)).player.z-beforeArrow.z)>.1);
  await keyboard.keyboard.press('Escape');const stoppedLook=await state(keyboard);await keyboard.keyboard.down('l');await keyboard.keyboard.down('i');await keyboard.waitForTimeout(180);await keyboard.keyboard.up('l');await keyboard.keyboard.up('i');assert.equal((await state(keyboard)).yaw,stoppedLook.yaw);assert.equal((await state(keyboard)).pitch,stoppedLook.pitch);
  await keyboard.locator('[data-panel="settings"]').click();await keyboard.locator('#sensitivity').focus();await keyboard.keyboard.press('j');assert.equal((await state(keyboard)).yaw,stoppedLook.yaw);
  await keyboard.locator('#dialog-close').click();record('vertical keyboard look, arrow movement, pause and UI focus guards');
  for(let i=0;i<4;i++){await keyboard.keyboard.press('Escape');await keyboard.locator('#dialog-close').click();await keyboard.keyboard.press('Escape');await keyboard.locator('#dialog-close').click();}
  await keyboard.keyboard.press('Escape');
  await keyboard.waitForTimeout(400);let audioStopped=(await state(keyboard)).audio;assert.equal(audioStopped.paused,true);assert.equal(audioStopped.ambientVoices,0);assert.equal(audioStopped.voices,0);assert.equal(audioStopped.contextState,'suspended');
  await keyboard.locator('#dialog-close').click();await keyboard.locator('#menu-button').click();await keyboard.locator('[data-panel="settings"]').click();await keyboard.locator('#mute').check();await keyboard.locator('#dialog-close').click();await keyboard.waitForTimeout(200);audioStopped=(await state(keyboard)).audio;assert.equal(audioStopped.ambientVoices,0);assert.equal(audioStopped.contextState,'suspended');record('immediate resume/pause and mute settle to silence with no ambient source leaks');
  await keyboard.evaluate(()=>window.dispatchEvent(new Event('blur'))); assert.equal((await state(keyboard)).uiState,'paused'); record('blur event pauses and clears input without automatic resume');
  assert.equal(await keyboard.evaluate(()=>!!window.__walktest),true);
  await keyboardContext.close();
  const readDeniedContext = await browser.newContext();
  await readDeniedContext.addInitScript(() => { const get = Storage.prototype.getItem; Storage.prototype.getItem = function(key) { if(key==='kamakura-progress-v1') throw new DOMException('Denied','SecurityError'); return get.call(this,key); }; });
  const readDenied = await open(readDeniedContext); assert.equal((await state(readDenied)).game.stage,'bucket'); assert.match(await readDenied.locator('#toast').textContent(),/進行を読み込めません/); await start(readDenied); record('storage read refusal opens a playable initial state with a reason'); await readDeniedContext.close();

  const noWebGLContext = await browser.newContext();
  await noWebGLContext.addInitScript(() => { const get = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function(type,...args) { return /webgl/i.test(type) ? null : get.call(this,type,...args); }; });
  const noWebGL = await noWebGLContext.newPage(); await noWebGL.goto(base); await noWebGL.locator('body[data-state="error"]').waitFor();
  assert.ok(await noWebGL.locator('#retry').isVisible()); assert.match(await noWebGL.locator('#load-text').textContent(),/3D表示/); assert.equal(await noWebGL.evaluate(()=>document.activeElement.id),'retry');
  record('WebGL refusal exposes an accessible retry screen (expected renderer error)'); await noWebGLContext.close();

  for(const missing of ['dirt_floor_nor_gl_1k.jpg','fir_tree_01_twig_alpha_1k.jpg']){
    const brokenContext=await browser.newContext();await brokenContext.route('**/'+missing,route=>route.abort());
    const broken=await brokenContext.newPage();await broken.goto(base);await broken.locator('body[data-state="error"]').waitFor({timeout:60000});
    assert.ok(await broken.locator('#retry').isVisible());assert.equal(await broken.evaluate(()=>document.activeElement.id),'retry');assert.match(await broken.locator('#load-text').textContent(),/風景の読み込み/);
    record('missing '+missing+' shows the retry screen (intentional request failure)');await brokenContext.close();
  }

  const normalContext = await browser.newContext(); const normal = await open(normalContext,''); assert.equal(await normal.evaluate(()=>window.__walktest),undefined); record('QA hooks are absent from the normal URL'); await normalContext.close();
} catch (error) { failure = error; console.error(error); }
finally {
  await browser.close(); server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve));
  const report = { startedAt: new Date(startedAt).toISOString(), durationSeconds: (Date.now() - startedAt) / 1000, browser: 'Google Chrome, headless on macOS', checks: results, browserErrors: errors, failure: failure ? String(failure) : null };
  await fs.writeFile(new URL('../reports/browser-check.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  if (failure || errors.length) process.exitCode = 1;
}
