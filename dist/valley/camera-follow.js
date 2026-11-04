// camera-follow.js — 追従カメラの式（走り・歩きの滑らかさ M4・design-locomotion-camera.md）。純粋（渡された値だけで進める）。
// 結線は camera-rig.js。ここは「どれだけ・どの速さで寄せるか」だけを決める。ばねはどれも臨界減衰で dt によらず厳密に解く（30・60・144コマ/秒で同じ曲線）。
// s は [位置, 速さ] の2要素の配列（毎コマ新しく作らない）。

// 数値の根拠（M4 の計測・design-locomotion-camera.md §2）
export const CAM = Object.freeze({
  // 注視点の水平：ω15 のばねに、ならした速さ×0.03秒の先回りを足す。M3 の ω18（先回りなし）と走り5m/秒の遅れが同じ（約0.52m）で、
  // 止まり・走り出しの加加速度が約15%小さい。先回りなしで ω15 にすると加加速度は下がるが、遅れが0.63mに伸び、主人公が画面の奥へ流れる量が増える
  w: 15, lead: 0.03, wv: 8, cut: 1.5,
  // 注視点の上下：ω20 で一度ならしてから ω12（M3 は ω12 だけ）。棚田の段0.55mで、カメラの上下の加速度が31→15m/秒²
  wy1: 20, wy2: 12,
  // 遮蔽：0.4秒先の注視点とカメラの線でも当たりを見て、先に寄せ始める。目標を ω30 で一度ならしてから、寄せは ω20（合わせて95%に0.32秒）、
  // 戻りは ω7（0.7秒）。今のコマの当たりは常に守る（壁の中は映さない）。1段の ω24 では、先回りで目標が段で変わった瞬間の加加速度が約4倍だった
  predict: 0.4, clipPre: 30, clipIn: 20, clipOut: 7, liftUp: 28, liftDown: 6.3,
  // 地面からの下限0.55mは、折れ目のない最大（log-sum-exp・幅0.12m）で効かせる。下限は常に守り（なめらかな最大は大きい方以上）、効き始めでカメラの上下の速さが折れない
  floorSoft: 0.12,
  // 画角：ならした速さが3.2→5.0m/秒で0→+3度。上げは ω4（95%に1.2秒）、戻りは ω3（1.6秒）。「画面の揺れ・衝撃」の倍率を掛け、「動きを減らす」で0
  fov: 3, fovFrom: 3.2, fovTo: 5.0, fovUp: 4, fovDown: 3,
});

// 臨界減衰のばね（位置と速さ）。dt が0なら動かさない
export function spring(s, target, w, dt) {
  if (!(dt > 0)) return s[0];
  const e = s[0] - target, k = Math.exp(-w * dt), tmp = (s[1] + w * e) * dt;
  s[1] = (s[1] - w * tmp) * k; s[0] = target + (e + tmp) * k;
  return s[0];
}
// 目標が下にあるとき wDown、上にあるとき wUp で寄せる（状態は続いているので、切り替わっても位置と速さは跳ばない）
export function springAsym(s, target, wUp, wDown, dt) { return spring(s, target, target > s[0] ? wUp : wDown, dt); }

// 主人公の水平の速さを推定する（位置の差÷dt をばねでならす）。cut m を超えて1コマで動いたら瞬間移動とみなして0から測り直す。
// vx・vz は [位置, 速さ] のばね、prev は [x, z]（前のコマの位置。最初は null で渡さず、呼ぶ側が初期化する）
export function trackVelocity(vx, vz, prev, x, z, dt, c = CAM) {
  if (!(dt > 0)) return;
  const dx = x - prev[0], dz = z - prev[1]; prev[0] = x; prev[1] = z;
  if (Math.hypot(dx, dz) > c.cut) { vx[0] = vx[1] = vz[0] = vz[1] = 0; return; }
  spring(vx, dx / dt, c.wv, dt); spring(vz, dz / dt, c.wv, dt);
}

// 速さで広げる画角（度）。scale は「画面の揺れ・衝撃」の倍率（0〜1）、reduced は「動きを減らす」、lock は狙い固定の混ぜ（0〜1）
export function speedFov(speed, scale = 1, reduced = false, lock = 0, c = CAM) {
  if (reduced || !(scale > 0)) return 0;
  const k = Math.max(0, Math.min(1, (speed - c.fovFrom) / (c.fovTo - c.fovFrom)));
  return c.fov * k * k * (3 - 2 * k) * Math.min(1, scale) * (1 - Math.max(0, Math.min(1, lock)));
}

// 折れ目のない最大：常に max(a, b) 以上で、差が k の数倍を超えると max と同じ（差が1mなら3e-5m）
export function softMax(a, b, k) { const m = Math.max(a, b); return m + k * Math.log1p(Math.exp(-Math.abs(a - b) / k)); }

// 遮蔽の寄せの目標：今のコマの当たり hard と、先回りの当たり ahead（無ければ null）の小さい方。どちらも下限 floor を下回らない
export function clipTarget(hard, ahead, floor) { return Math.max(floor, ahead == null ? hard : Math.min(hard, ahead)); }
