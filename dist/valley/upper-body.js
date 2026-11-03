// upper-body.js — 走りの形（上半身の二次運動）の式（design-locomotion-smooth §6・§13、M3）。純粋：渡された値だけで進める。Three.js・DOM・乱数・時計に触れない。
// 骨へ当てるのは upper-rig.js。ここは「どれだけ動かすか」だけを決める。
// 調べて分かったこと（M3 の物差し tools/lib/upper-metrics.mjs、M2b の main）：走り（CMU_Run）の腕は反対側の太ももと既に同期している（相関0.98・位相差0）が、
// 上腕は真下より後ろ（−48〜+2度・平均−25度）でしか振れず、肘を125度ほど曲げた前腕が胸の前に残る＝手の前後の行き来が20〜25cmで「腕を前に出したまま固まる」。
// 胸（肩の線）は骨盤と同じ向きに回る（相関+0.57＝体幹が一枚の板）。頭は左右7.6度・上下4.6度揺れる。腰の上下は8.3cmのまま、走り5m/秒では歩調1.72倍で回るので跳ねて見える。
// 腕・体幹・頭・前傾は収録動作のまま、ほかの層（relaxArms・刀・握り）は腕を変えていない（final＝mixer の姿勢）。どれも手続きの層で直せる範囲（再収録は要らない）。
export const UPPER = Object.freeze({
  // 腕：上腕を体の横の軸まわりに前へ。目標＝offset＋gain×反対側の太ももの角度（度）。gain・offset は速さで増やす（2→5m/秒）。
  // 減衰の弱いばね（ζ0.35）で追い、角振動数は歩調の2.2倍（駆動より速いので遅れは周期の約6%・振り幅は約1.17倍）。肘は elbow 度だけ伸ばし（手を胸の前から下ろす）、
  // 腕が平均より前へ振れた分の elbowSwing 倍だけ前腕も前へ（前で肘を畳み、後ろで伸ばす。一定に伸ばすだけでは、前へ振った腕が棒のように突き出た＝撮影で確認）
  arm: { offset: [10, 17], gain: [0.16, 0.30], elbow: 12, elbowSwing: 0.45, omegaPerCycle: 2.2, omegaMin: 8, zeta: 0.35, max: 40, constrained: 0.35 },
  // 体幹：胸（肩の線）の回りの揺れを、脚の位相から決めた目標へ寄せる（平均はそのまま）。目標＝−perThigh×（右の太もも−左の太もも）/2＝右脚が前のとき左肩が前（骨盤と逆）。
  // 骨盤の回りに合わせる案（−0.45×骨盤）は、動作の骨盤の回りが±4度と小さく偏るので、胸がほぼ止まって「上体が硬い」に戻った。背骨3本に分ける
  // 測ってみると、動作の胸の揺れはもともとこの目標に近く（±9度）、硬さの元は骨盤が胸と同じ向きに回ること（相関+0.57）だった。骨盤も脚の位相から
  // ＋pelvisPerThigh×（右−左）/2 へ寄せ（右脚が前のとき右の腰が前）、太もも・胸は逆に回して元の向きに残す（腰の形だけが回る。股の位置は±1.5cm動き、着いた足は脚のIKが留める）
  twist: { perThigh: 0.2, pelvisPerThigh: 0.18, max: 12, mean: 3 },
  // 頭：進む向きから見た頭の向きをゆっくりならした向きへ keep だけ寄せる（揺れを打ち消す）
  head: { keep: 0.8, rate: 4 },
  // 前傾：速さ（from を超えた分×perSpeed）と加速度（accel×tanh(a/accelScale)）。ばね（ω・ζ）で遅らせる＝加減速で胸と頭が遅れる
  lean: { from: 3.0, perSpeed: 1.3, accel: 10, accelScale: 10, min: -6, max: 13, omega: 9, zeta: 0.75 },
  // 曲がり：横の加速度（速さ×向きの変化の速さ）の atan(a/g) の ratio 倍を内側へ（上限 max 度）。人の体全体の傾きの一部を上体で見せる
  bank: { ratio: 0.2, max: 8, omega: 10, zeta: 0.8 },
  // 骨盤の上下：歩調 ts 倍で回すと、同じ8.5cmの弧は ts² 倍の重さで跳ぶ（放物線の高さは周期の2乗に比例）。弧を clip/ts² へ縮め、人の走りの目安の下限 floor で止める
  bob: { floor: 0.06, rate: 2 },
  fade: { up: 6, down: 6, cut: 25 },   // 効きの立ち上がり・止まりの戻り（1/秒）・移動の動作でなくなったとき（技・回避・受け）
  reduce: 0.35,                         // 「動きを減らす」：二次運動の振り幅の倍率
  teleport: 1.0,                        // 1コマにこれ以上根が動いたら瞬間移動とみなし、状態を戻す（m）
});

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
export const lerp = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
// 速さ v（m/秒）での腕の目標の係数（2m/秒で下、5m/秒で上）
export const speedT = v => clamp((v - 2) / 3, 0, 1);

// 指数で追う（30・60・144コマ/秒で同じ時間の形）
export function follow(x, target, rate, dt) { return dt > 0 ? target + (x - target) * Math.exp(-rate * dt) : x; }

// 減衰振動のばね（目標 target を dt の間一定とみなし、厳密に解く。どのコマ速度でも同じ曲線）。st = { x, v } を書き換える
export function springStep(st, target, omega, zeta, dt) {
  if (!(dt > 0) || !(omega > 0)) return st.x;
  const x0 = st.x - target, v0 = st.v;
  if (zeta < 1) {
    const wd = omega * Math.sqrt(1 - zeta * zeta), e = Math.exp(-zeta * omega * dt), c = Math.cos(wd * dt), s = Math.sin(wd * dt);
    st.x = target + e * (x0 * c + (v0 + zeta * omega * x0) / wd * s);
    st.v = e * (v0 * c - (zeta * omega * v0 + omega * omega * x0) / wd * s);
  } else {   // 臨界減衰
    const e = Math.exp(-omega * dt), k = v0 + omega * x0;
    st.x = target + (x0 + k * dt) * e;
    st.v = (v0 - omega * k * dt) * e;
  }
  return st.x;
}

// 腕の目標（度・前が正）。thigh＝反対側の太ももの角度（度・前が正）、v＝速さ、w＝効き（0〜1）、side＝拘束の倍率（鞘・柄・弓を持つ腕は小さく）
export function armTarget(thigh, v, w, side = 1, reduce = false) {
  const t = speedT(v), A = UPPER.arm, k = w * side * (reduce ? UPPER.reduce : 1);
  return clamp(k * (lerp(A.offset[0], A.offset[1], t) + lerp(A.gain[0], A.gain[1], t) * thigh), -A.max, A.max);
}
// 前腕の補正（度・前が正）。armX＝そのコマの上腕の補正（ばねの値）
export function forearmFix(armX, v, w, side = 1, reduce = false) {
  const A = UPPER.arm, k = w * side * (reduce ? UPPER.reduce : 1);
  return -A.elbow * k + A.elbowSwing * (armX - k * lerp(A.offset[0], A.offset[1], speedT(v)));
}
// 腕のばねの角振動数（rad/秒）。period＝周期の動作の1周の秒（歩調で割った後）
export const armOmega = period => Math.max(UPPER.arm.omegaMin, period > 0 ? UPPER.arm.omegaPerCycle * 2 * Math.PI / period : 0);

// 胸の回りの補正（度）：thighR・thighL＝左右の太ももの前後の角度（度）、c＝胸の回りの揺れ（平均を引いた値・度）。
// 効き w で、動作の胸の揺れを目標の揺れへ置き換える（減らす設定では目標を小さく）
export function twistFix(thighR, thighL, c, w, reduce = false) {
  const T = UPPER.twist, want = -T.perThigh * (thighR - thighL) / 2 * (reduce ? UPPER.reduce : 1);
  return clamp(w * (want - c), -T.max, T.max);
}

// 骨盤の回りの補正（度）：p＝骨盤の回りの揺れ（平均を引いた値・度）
export function pelvisFix(thighR, thighL, p, w, reduce = false) {
  const T = UPPER.twist, want = T.pelvisPerThigh * (thighR - thighL) / 2 * (reduce ? UPPER.reduce : 1);
  return clamp(w * (want - p), -T.max, T.max);
}

// 前傾の目標（度・前が正）。v＝速さ、a＝加速度（m/秒²）
export function leanTarget(v, a, w, reduce = false) {
  const L = UPPER.lean, k = w * (reduce ? UPPER.reduce : 1);
  return clamp(k * (L.perSpeed * Math.max(0, v - L.from) + L.accel * Math.tanh(a / L.accelScale)), L.min, L.max);
}

// 曲がりの傾きの目標（度・右が正）。v＝速さ、yawRate＝右回りが正の向きの変化の速さ（rad/秒）
export function bankTarget(v, yawRate, w, reduce = false) {
  const B = UPPER.bank, a = v * yawRate;
  return clamp(w * (reduce ? UPPER.reduce : 1) * B.ratio * Math.atan(a / 9.81) * 180 / Math.PI, -B.max, B.max);
}

// 骨盤の上下の倍率（1＝そのまま）。bob＝動作の腰の高さの幅（m）、ts＝歩調（再生の倍率）
export function bobScale(bob, ts, reduce = false) {
  if (!(bob > 1e-4) || !(ts > 1)) return 1;
  const want = Math.max(UPPER.bob.floor * (reduce ? 0.8 : 1), bob / (ts * ts));
  return clamp(want / bob, 0.4, 1);
}
