// pointerlock-guard.mjs
// 自動試験のブラウザで「マウスの固定（ポインタロック）」を、本物のOSへ届かせないための差し替え。
//
// 背景: 本物のChromeの画面なしモード（Playwright の channel:'chrome' ＋ headless など）は、ページが
//   requestPointerLock() を呼ぶと、本物のカーソルを画面の決まった場所へ動かして隠し、解除で元へ戻す。
//   試験を回すたびに、使っている人のカーソルが飛ぶ（2026-11-03 に再現・確認）。
//
// 使い方: ページを開く前に呼ぶ。
//   import { guardPointerLock } from './pointerlock-guard.mjs';
//   const context = await browser.newContext(...);
//   await guardPointerLock(context);          // page でも可。mode は省略で 'pretend'
//
// mode:
//   'pretend'（既定）= ロックできたことにする。ページから見える状態（document.pointerLockElement）と
//                      pointerlockchange は、本物のロックと同じ。ロック前提のゲームの試験は、これで今までどおり進む。
//   'reject'         = 断る。Playwright標準の headless shell と同じ（拒否の Promise と pointerlockerror）。
//                      「ロックが使えない環境」の動きを確かめたいときに使う。
//
// どちらも本物のカーソルには何もしない。ブラウザ自体は変えないので、画面の見た目は変わらない。

const PRETEND = `(() => {
  if (window.__pointerLockGuard) return;
  window.__pointerLockGuard = 'pretend';
  let locked = null;
  const fire = (type) => setTimeout(() => document.dispatchEvent(new Event(type)), 0);
  try {
    Object.defineProperty(Document.prototype, 'pointerLockElement', { configurable: true, get() { return locked; } });
    Element.prototype.requestPointerLock = function () {
      if (locked !== this) { locked = this; fire('pointerlockchange'); }
      return Promise.resolve();
    };
    Document.prototype.exitPointerLock = function () {
      if (locked) { locked = null; fire('pointerlockchange'); }
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
