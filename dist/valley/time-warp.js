// time-warp.js — 時間の進みの速さ（8.5a・R18.5・R18.12）。純粋：Three.js・DOM・乱数・時計に触れない。
// 命中の停止（ヒットストップ・config.js の FEEL.hitStop）と、とどめ・弾きの瞬間の軽いスローを、1コマの速さ（倍）にする。
// 停止とスローは重ねない（掛け算しない）。停止の間は停止の速さだけで、スローの残りは減らさない。スローは停止が明けてから進む。
// スローは本人の指定「約0.25秒」（2026-10-30）。揺れでも光でもないので、「画面の揺れ・衝撃 0」「動きを減らす」でも短くしない。
// 状態は呼び出し側の物（game.js では Game 自身）の stopT・slowT・slowDur に置く。検査の道具が g.stopT を読むので名前を保つ。

export const SLOW = Object.freeze({
  dur: 0.25,      // スローの長さ（秒。実時間＝画面のコマの時間）
  scale: 0.3,     // いちばん遅い速さ（倍）
  hold: 0.55,     // 長さのうち、いちばん遅い速さを保つ割合。残りで1倍へ滑らかに戻す（急に戻すと、そこで「カクッ」と動いて見えた）
});

// スローの進み u（0＝始め・1＝終わり）での速さ（倍）
export function slowCurve(u) {
  if (!(u > SLOW.hold)) return SLOW.scale;
  if (u >= 1) return 1;
  const k = (u - SLOW.hold) / (1 - SLOW.hold), s = k * k * (3 - 2 * k);
  return SLOW.scale + (1 - SLOW.scale) * s;
}

// スローを始める（進んでいる途中なら、始めからやり直す）。秒は実時間
export function requestSlow(w, sec = SLOW.dur) {
  if (!(sec > 0)) return false;
  w.slowT = sec; w.slowDur = sec;
  return true;
}

// このコマの速さ（倍）。dt は実時間の秒（game.js では上限0.05に切った値）。停止の扱いは前と同じ：
// 停止が残っていれば、このコマ全体を停止の速さにして、停止の残りを dt だけ減らす。
export function warpScale(w, dt, stopScale) {
  if (w.stopT > 0) { w.stopT -= dt; return stopScale; }
  if (w.slowT > 0 && w.slowDur > 0) {
    const scale = slowCurve(1 - w.slowT / w.slowDur);
    w.slowT = Math.max(0, w.slowT - dt);
    return scale;
  }
  return 1;
}
