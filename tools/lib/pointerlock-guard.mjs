// pointerlock-guard.mjs
// 自動試験のブラウザで「マウスの固定（ポインタロック）」を、本物のOSへ届かせないための差し替え。
//
// 背景: 本物のChromeの画面なしモード（Playwright の channel:'chrome' ＋ headless など）は、ページが
//   requestPointerLock() を呼ぶと、本物のカーソルを画面の決まった場所へ動かして隠し、解除で元へ戻す。
//   試験を回すたびに、使っている人のカーソルが飛ぶ（2026-11-03 に再現・確認）。
//
// 使い方: ページを開く前に呼ぶ。
//   import { guardPointerLock, guardBrowser } from './pointerlock-guard.mjs';
//   await guardPointerLock(context);   // BrowserContext か Page。mode は省略で 'pretend'
//   guardBrowser(browser);             // 以後その browser から作る context / page すべてに掛ける（context を何個も作る試験向け）
//
// mode:
//   'pretend'（既定）= ロックできたことにする。本物のChromeと同じ決まりで許可・拒否する：
//                      ユーザー操作（navigator.userActivation.isActive）が無い要求は NotAllowedError で断る。
//                      ただしページ自身がロックを解除したあとは、操作なしでも取り直せる（ユーザー操作の効力が切れたあとでも）。
//                      すでに固定中・許可待ちのときの再要求は、操作がなくてもすぐ成功にして change を出し、要素を差し替える（本物と同じ）。
//                      ページから見える状態（document.pointerLockElement・pointerlockchange・pointerlockerror・Promiseの結果）は
//                      本物と同じ順に出る。ロック前提のゲームの試験は、これで今までどおり進む。
//   'reject'         = 常に断る。Playwright標準の headless shell と同じ（拒否の Promise と pointerlockerror）。
//                      「ロックが使えない環境」の動きを確かめたいときに使う。
//
// どちらも本物のカーソルには何もしない。ブラウザ自体は変えないので、画面の見た目は変わらない。
//
// 本物と違う点（2026-11-03 の実測で確認済み）:
//   ・ロック中に page.mouse.move すると、movementX/Y は本物と同じだが、clientX/Y は本物のように固定されず動く。
//   ・許可（イベントとPromiseの結果）は要求の2ms後（本物は1〜5ms後）。別のタスクからの読み取りは、要求の0.5ms後から許可済みに見える。
//     どちらも、要求と同じタスクの中では「まだ固定されていない」と見える。
//   ・読み取りが許可を引き起こした場合、その読み取りを記録するコードは、Promiseの結果より先に動く（本物は許可が先）。
//   ・本物のブラウザの「ユーザーがEscでロックを外す」動きは無い（ただし本物でも、Playwright が送る Escape では外れない）。

const PRETEND = `(() => {
  if (window.__pointerLockGuard) return;
  window.__pointerLockGuard = 'pretend';
  const now = performance.now.bind(performance);
  const GRANT_AFTER = 2;  // 許可を出す（イベントとPromiseの結果を返す）までの時間（ms）。本物はブラウザ本体からの通知で、実測 1〜5ms
  const READ_AFTER = 0.5; // 別のタスクから状態を読まれた時に「許可済み」と見せ始める時間（ms）。要求と同じタスクの中（数十マイクロ秒）は、まだ許可前に見せる
  let target = null;      // 要求した（または固定中の）要素。許可待ちの間も入っている（本物の内部の持ち方と同じ）
  let waiting = null;     // 許可待ちの状態 { at, cancelled, resolve, promise }。ある間、document.pointerLockElement は null に見せる
  let selfExit = false;   // ページ自身がロックを外したことがあるか（本物のChromeは、そのあとの取り直しを、操作が無くても許す）
  const fire = (type) => document.dispatchEvent(new Event(type));
  const later = (type) => setTimeout(() => fire(type), 0);
  const active = () => !navigator.userActivation || navigator.userActivation.isActive;
  const refuse = (name, message) => { later('pointerlockerror'); return Promise.reject(new DOMException(message, name)); };
  const due = () => waiting !== null && !waiting.cancelled && now() - waiting.at >= READ_AFTER;
  // 許可を出す。タイマーでも、READ_AFTER が過ぎたあとに誰かが状態を読んだ時でも、1回だけ働く。
  // 本物の許可は、あとから届く試験の読み取り（CDP）より先に処理される。タイマーだけに頼ると、要求の直後にページが忙しいとき（最初の描画など）
  // や、読み取りが要求の約2ms後に走るとき（クリック直後の waitForFunction → state の2往復）に追い越されて結果が変わる
  // （2026-11-03 に総合検査で実測。読み取りは要求の1.8ms後で、2msのしきい値の手前だった）。
  const grant = (w) => {
    if (waiting !== w) return;
    waiting = null;
    if (w.cancelled) { target = null; fire('pointerlockchange'); w.resolve(); return; }   // 本物は、許可の前に解除しても「許可→すぐ失う」の形で change と resolve が届く
    w.resolve(); later('pointerlockchange');
  };
  try {
    Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { if (due()) grant(waiting); return waiting ? null : target; } });
    Element.prototype.requestPointerLock = function () {
      const el = this;
      if (due()) grant(waiting);
      if (!el.isConnected) return refuse('WrongDocumentError', 'The root document of this element is not valid for pointer lock.');
      // 固定中・許可待ちの再要求は、本物もブラウザ本体へ聞き直さず（＝操作の有無を見ず）、すぐ成功にして change を出し、要素を差し替える
      if (target) { target = el; later('pointerlockchange'); return Promise.resolve(); }
      if (!selfExit && !active()) return refuse('NotAllowedError', 'A user gesture is required to request pointer lock.');
      target = el;
      const w = waiting = { at: now(), cancelled: false, resolve: null, promise: null };
      w.promise = new Promise((resolve) => { w.resolve = resolve; });
      setTimeout(() => grant(w), GRANT_AFTER);
      return w.promise;
    };
    Document.prototype.exitPointerLock = function () {
      if (due()) grant(waiting);
      if (waiting) { waiting.cancelled = true; return; }
      if (target) { target = null; selfExit = true; later('pointerlockchange'); }
    };
  } catch (e) { /* 差し替えに失敗しても、ページは動かし続ける */ }
})();`;

const REJECT = `(() => {
  if (window.__pointerLockGuard) return;
  window.__pointerLockGuard = 'reject';
  try {
    Element.prototype.requestPointerLock = function () {
      setTimeout(() => document.dispatchEvent(new Event('pointerlockerror')), 0);
      return Promise.reject(new DOMException('Pointer lock is disabled in automated tests', 'WrongDocumentError'));
    };
  } catch (e) { /* 差し替えに失敗しても、ページは動かし続ける */ }
})();`;

export const POINTER_LOCK_GUARD = { pretend: PRETEND, reject: REJECT };

/** target は Playwright の BrowserContext か Page。ページを開く前に呼ぶ。 */
export async function guardPointerLock(target, mode = 'pretend') {
  const script = POINTER_LOCK_GUARD[mode];
  if (!script) throw new Error(`guardPointerLock: mode は 'pretend' か 'reject'（いま "${mode}"）`);
  await target.addInitScript(script);
}

/** browser から作る context / page すべてに掛ける。launch の直後に1回呼ぶ。 */
export function guardBrowser(browser, mode = 'pretend') {
  if (!POINTER_LOCK_GUARD[mode]) throw new Error(`guardBrowser: mode は 'pretend' か 'reject'（いま "${mode}"）`);
  const newContext = browser.newContext.bind(browser);
  const newPage = browser.newPage.bind(browser);
  browser.newContext = async (...args) => { const context = await newContext(...args); await guardPointerLock(context, mode); return context; };
  browser.newPage = async (...args) => { const page = await newPage(...args); await guardPointerLock(page, mode); return page; };
  return browser;
}
