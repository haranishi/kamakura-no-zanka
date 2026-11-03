import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { POINTER_LOCK_GUARD, guardPointerLock, guardBrowser } from '../tools/lib/pointerlock-guard.mjs';

// ページに差し込む文字列（pretend / reject）を、仮のDOMの中で動かして決まりを確かめる。
// 「本物のChromeと同じ許可・拒否・イベントの順」は、本物のブラウザと同じ手順で記録して突き合わせた内容（2026-11-03）。
// ここは、その決まりが後の手直しで崩れないための番人。
class FakeDocument extends EventTarget {}
const tick = () => new Promise(resolve => setTimeout(resolve, 5));

function install(mode, world) {
  vm.runInNewContext(POINTER_LOCK_GUARD[mode], { window: world.window, document: world.document, Document: FakeDocument, Element: world.Element, navigator: world.navigator, Event, DOMException, setTimeout, performance: world.performance });
}

function makeWorld(mode, { active = true } = {}) {
  class Element { constructor(id, isConnected = true) { this.id = id; this.isConnected = isConnected; } }
  const world = { Element, document: new FakeDocument(), navigator: { userActivation: { isActive: active } }, window: {}, events: [], bubbles: [], clock: 0 };
  world.performance = { now: () => world.clock };   // 時計は試験が進める（0.5msの境目を実時間に頼らず確かめるため）。タイマーは実時間で動く
  install(mode, world);
  const { document, events } = world;
  document.addEventListener('pointerlockchange', event => { events.push(['change', document.pointerLockElement?.id ?? null]); world.bubbles.push(event.bubbles); });
  document.addEventListener('pointerlockerror', event => { events.push(['error']); world.bubbles.push(event.bubbles); });
  world.request = (element, label) => {
    const result = element.requestPointerLock();
    events.push(['request', label, document.pointerLockElement?.id ?? null]);
    result.then(() => events.push(['resolved', label]), error => events.push(['rejected', label, error.name]));
    return result;
  };
  return world;
}

test('pretend: a request with user activation is granted asynchronously, like real Chrome', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a');
  await w.request(a, 'click'); await tick();
  assert.deepEqual(w.events, [['request', 'click', null], ['resolved', 'click'], ['change', 'a']]);
  assert.equal(w.document.pointerLockElement, a);
  w.events.length = 0;
  w.document.exitPointerLock(); await tick();
  assert.equal(w.document.pointerLockElement, null);
  assert.deepEqual(w.events, [['change', null]]);
});

test('pretend: a request without user activation is refused with NotAllowedError', async () => {
  const w = makeWorld('pretend', { active: false }); const a = new w.Element('a');
  await assert.rejects(() => w.request(a, 'timer'), { name: 'NotAllowedError' }); await tick();
  assert.equal(w.document.pointerLockElement, null);
  assert.deepEqual(w.events, [['request', 'timer', null], ['rejected', 'timer', 'NotAllowedError'], ['error']]);
});

test('pretend: after the page releases the lock itself, a request without activation is allowed again', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a');
  await w.request(a, 'first'); await tick();
  w.document.exitPointerLock(); await tick();
  w.navigator.userActivation.isActive = false;
  await w.request(a, 'relock'); await tick();
  assert.equal(w.document.pointerLockElement, a);
});

test('pretend: requesting again on the locked element still fires pointerlockchange, and another element takes over', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a'); const b = new w.Element('b');
  await w.request(a, 'a'); await tick(); w.events.length = 0;
  await w.request(a, 'again'); await tick();
  assert.deepEqual(w.events, [['request', 'again', 'a'], ['resolved', 'again'], ['change', 'a']]);
  w.events.length = 0;
  await w.request(b, 'switch'); await tick();
  assert.equal(w.document.pointerLockElement, b);
  assert.deepEqual(w.events.at(-1), ['change', 'b']);
});

test('pretend: leaving before the grant arrives still reports the change and resolves, with no lock held', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a');
  const pending = w.request(a, 'x');
  w.document.exitPointerLock();
  await pending; await tick();
  assert.equal(w.document.pointerLockElement, null);
  assert.deepEqual(w.events, [['request', 'x', null], ['change', null], ['resolved', 'x']]);
});

test('pretend: a request without activation is allowed while the lock is already held (real Chrome does not ask the browser again)', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a');
  await w.request(a, 'click'); await tick(); w.events.length = 0;
  w.navigator.userActivation.isActive = false;
  await w.request(a, 'timer'); await tick();
  assert.deepEqual(w.events, [['request', 'timer', 'a'], ['resolved', 'timer'], ['change', 'a']]);
});

test('pretend: a second request while the first is still waiting succeeds at once, and the lock lands on the second element', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a'); const b = new w.Element('b');
  w.request(a, 'x'); await w.request(b, 'y');
  assert.equal(w.document.pointerLockElement, null);   // 許可待ちの間は、まだ固定されていない
  await tick();
  assert.equal(w.document.pointerLockElement, b);
  assert.deepEqual(w.events.slice(0, 3), [['request', 'x', null], ['request', 'y', null], ['resolved', 'y']]);   // 2つ目が先に成功する
  assert.deepEqual(w.events.filter(e => e[0] === 'resolved').map(e => e[1]), ['y', 'x']);
  assert.deepEqual(w.events.at(-1), ['change', 'b']);
});

test('pretend: a read from another task sees the grant once 0.5ms have passed, even if the timer has not run yet', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a');
  w.request(a, 'busy');
  w.clock += 0.4;
  assert.equal(w.document.pointerLockElement, null);   // 要求と同じタスクの中とみなす間は、まだ固定されていない
  w.clock += 0.2;
  assert.equal(w.document.pointerLockElement, a);      // 試験の読み取り（CDP）は、タイマーを待たずに許可済みを見る
  await tick();
  assert.deepEqual(w.events, [['request', 'busy', null], ['resolved', 'busy'], ['change', 'a']]);   // 許可は1回だけ（あとから来るタイマーは何もしない）
});

test('pretend: leaving after the grant time has passed releases the lock that was already granted', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a');
  w.request(a, 'x'); w.clock += 1;
  w.document.exitPointerLock(); await tick();
  assert.equal(w.document.pointerLockElement, null);
  assert.deepEqual(w.events.filter(e => e[0] !== 'change'), [['request', 'x', null], ['resolved', 'x']]);
  assert.ok(w.events.some(e => e[0] === 'change') && w.events.filter(e => e[0] === 'change').every(e => e[1] === null));
  w.navigator.userActivation.isActive = false;         // 自分で外した直後は、操作なしで取り直せる
  await w.request(a, 'relock'); await tick();
  assert.equal(w.document.pointerLockElement, a);
});

test('pretend: a detached element is refused, and the events do not bubble (real Chrome keeps them off window)', async () => {
  const w = makeWorld('pretend'); const a = new w.Element('a'); const detached = new w.Element('d', false);
  await assert.rejects(() => w.request(detached, 'detached'), { name: 'WrongDocumentError' });
  await w.request(a, 'a'); await tick();
  assert.equal(w.document.pointerLockElement, a);
  assert.ok(w.bubbles.length >= 2 && w.bubbles.every(bubbles => bubbles === false));
});

test('pretend: installing twice keeps the first definition', () => {
  const w = makeWorld('pretend');
  const first = w.Element.prototype.requestPointerLock;
  install('pretend', w);
  assert.equal(w.Element.prototype.requestPointerLock, first);
});

test('reject: always refuses like the headless shell does (WrongDocumentError and pointerlockerror)', async () => {
  const w = makeWorld('reject'); const a = new w.Element('a');
  await assert.rejects(() => w.request(a, 'click'), { name: 'WrongDocumentError' }); await tick();
  assert.deepEqual(w.events, [['request', 'click', null], ['rejected', 'click', 'WrongDocumentError'], ['error']]);
});

test('guardPointerLock rejects unknown modes and hands the script to addInitScript', async () => {
  const scripts = [];
  const target = { addInitScript: async script => { scripts.push(script); } };
  await assert.rejects(() => guardPointerLock(target, 'nope'), /pretend/);
  await guardPointerLock(target);
  await guardPointerLock(target, 'reject');
  assert.deepEqual(scripts, [POINTER_LOCK_GUARD.pretend, POINTER_LOCK_GUARD.reject]);
});

test('guardBrowser guards every context and page the browser creates afterwards', async () => {
  const scripts = [];
  const created = () => ({ addInitScript: async script => { scripts.push(script); } });
  const browser = { newContext: async () => created(), newPage: async () => created() };
  assert.equal(guardBrowser(browser), browser);
  await browser.newContext({ viewport: { width: 800, height: 600 } });
  await browser.newPage();
  assert.equal(scripts.length, 2);
  assert.ok(scripts.every(script => script === POINTER_LOCK_GUARD.pretend));
  assert.throws(() => guardBrowser({ newContext() {}, newPage() {} }, 'nope'), /pretend/);
});
