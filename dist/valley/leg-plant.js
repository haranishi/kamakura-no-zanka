// leg-plant.js — 足の接地の保持（design-locomotion-smooth §5・§12、M2b）。純粋（渡された数だけで進める。画面・時計・乱数を読まない）。
// 着いている足は世界の位置に留め、遊脚へ移るときは「留めた所と動作の足の差」を時間で0へ戻して放す。脚の骨を回すのは leg-ik.js。
// 足の状態 foot.mode：FREE＝動作のまま／LOCK＝留める／RELEASE＝差を戻している／SETTLE＝止まった後の置き直しの一歩（足を上げて動作の足の所へ）。
// 毎コマの新規確保をしない：足の状態は createFoot で1回作り、結果は渡された out（長さ3以上の配列）へ書く。
export const FREE = 0;
export const LOCK = 1;
export const RELEASE = 2;
export const SETTLE = 3;
export const PLANT = Object.freeze({
  release: 0.12,      // 放すのにかける秒（遊脚の始めは足が上がるので、差が動いても滑って見えない）
  settleDelay: 0.8,   // 止まって（根が動かず）両足を着いてから、置き直しの一歩を始めるまでの秒
  settleMin: 0.05,    // 動作の待ちの足の所から、この長さ（m）より離れて留まっている足だけ置き直す
  settleTime: 0.3,    // 置き直しの一歩の秒
  settleLift: 0.05,   // 置き直しの一歩で足を上げる高さ（m）
  dropDown: 40,       // 骨盤を下げる速さ（1/秒。14では棚田の段の下りで遅れ、着いた足が9cm浮いた）
  dropUp: 10,         // 骨盤を戻す速さ（1/秒）
  maxDrop: 0.28,      // 骨盤を下げる上限（m。棚田の段（高さ0.55m）の下りで10cmでは11cm・20cmでは5cm足が浮いた）
  reach: 0.995,       // 脚の長さのこの割合までを「届く」とする（伸び切った膝は折れて見える）
  maxTilt: 0.35,      // 足を地面の傾きへ合わせる上限（rad・約20度）
});
const smooth01 = x => { const t = x <= 0 ? 0 : x >= 1 ? 1 : x; return t * t * (3 - 2 * t); };
export const follow = (x, target, rate, dt) => dt > 0 ? target + (x - target) * Math.exp(-rate * dt) : x;

export function createFoot() { return { mode: FREE, lx: 0, lz: 0, ox: 0, oz: 0, sx: 0, sz: 0, t: 0, gy: 0, h: 0, ground: false }; }
export function resetFoot(f) { f.mode = FREE; f.ox = f.oz = f.t = f.h = 0; f.ground = false; }

// 周期の動作の位相 phase（0〜1）で、平らな区間 windows（gait-table の flat.left など。[始め,終わり] の列・周期をまたいでよい）の中か
export function inFlat(windows, phase) {
  if (!windows) return false;
  for (let i = 0; i < windows.length; i++) { const s = windows[i][0], e = windows[i][1]; if (s <= e ? phase >= s && phase <= e : phase >= s || phase <= e) return true; }
  return false;
}

// 1コマ進める。planted＝この足が着いているか、ax・az＝動作の足（足首）の世界の水平の位置。
// out[0]・out[1]＝見せる足の水平の位置、out[2]＝足を上げる高さ（m）、out[3]＝地面へ合わせる割合（0〜1：着いている度合い）
export function stepFoot(f, planted, ax, az, dt, out, cfg = PLANT) {
  if (planted && f.mode !== LOCK && f.mode !== SETTLE) {
    // 留め始め：今見せている所（放している途中ならその差を含む）に留める。跳ばさない
    if (f.mode === RELEASE) { const k = 1 - smooth01(f.t / cfg.release); f.lx = ax + f.ox * k; f.lz = az + f.oz * k; } else { f.lx = ax; f.lz = az; }
    f.mode = LOCK;
  } else if (!planted && (f.mode === LOCK || f.mode === SETTLE)) {
    const cur = settlePos(f, ax, az, cfg);
    f.mode = RELEASE; f.ox = cur[0] - ax; f.oz = cur[1] - az; f.t = 0;
  }
  if (f.mode === LOCK) { f.h = follow(f.h, 0, 30, dt); if (f.h < 1e-4) f.h = 0; out[0] = f.lx; out[1] = f.lz; out[2] = f.h; out[3] = 1; return out; }
  if (f.mode === SETTLE) {
    f.t += dt;
    const s = smooth01(f.t / cfg.settleTime);
    // 一歩の間は動作の足の所へ向かう（動作の待ちの姿も少し揺れるので、行き先は毎コマの動作の足）
    out[0] = f.sx + (ax - f.sx) * s; out[1] = f.sz + (az - f.sz) * s; out[2] = cfg.settleLift * Math.sin(Math.PI * s); out[3] = 1 - Math.sin(Math.PI * s);
    if (f.t >= cfg.settleTime) { f.mode = LOCK; f.lx = ax; f.lz = az; f.t = 0; }
    return out;
  }
  if (f.mode === RELEASE) {
    f.t += dt;
    const k = 1 - smooth01(f.t / cfg.release);
    out[0] = ax + f.ox * k; out[1] = az + f.oz * k; out[2] = 0; out[3] = k;
    if (k <= 0) f.mode = FREE;
    return out;
  }
  out[0] = ax; out[1] = az; out[2] = 0; out[3] = 0;
  return out;
}
const SP = [0, 0];
function settlePos(f, ax, az, cfg) {
  if (f.mode !== SETTLE) { SP[0] = f.lx; SP[1] = f.lz; return SP; }
  const s = smooth01(f.t / cfg.settleTime); SP[0] = f.sx + (ax - f.sx) * s; SP[1] = f.sz + (az - f.sz) * s; return SP;
}

// 届かないとき（脚を伸ばしても留めた所まで届かない）：今の所から放す
export function releaseFoot(f, ax, az) {
  if (f.mode !== LOCK) return;
  f.mode = RELEASE; f.ox = f.lx - ax; f.oz = f.lz - az; f.t = 0;
}

// 止まった後の置き直しの一歩を始めるか（両足が留まっている間だけ・1度に片足）。留めた所と動作の足の差が settleMin より大きい足を、
// 大きい方から。始めたら true
export function maybeSettle(feet, ax0, az0, ax1, az1, cfg = PLANT) {
  const a = feet[0], b = feet[1];
  if (a.mode !== LOCK || b.mode !== LOCK) return false;
  const d0 = Math.hypot(a.lx - ax0, a.lz - az0), d1 = Math.hypot(b.lx - ax1, b.lz - az1);
  const i = d0 >= d1 ? 0 : 1, d = i ? d1 : d0;
  if (!(d > cfg.settleMin)) return false;
  const f = feet[i]; f.mode = SETTLE; f.sx = f.lx; f.sz = f.lz; f.t = 0;
  return true;
}

// 置き直しの途中で歩き出した：足をその場へ下ろして留める（上げた高さは LOCK の間に0へ戻す）。動作の足の所へ寄せ続けると、着いた足が流れる
export function abortSettle(f, ax, az, cfg = PLANT) {
  if (f.mode !== SETTLE) return;
  const s = smooth01(f.t / cfg.settleTime);
  f.lx = f.sx + (ax - f.sx) * s; f.lz = f.sz + (az - f.sz) * s; f.h = cfg.settleLift * Math.sin(Math.PI * s); f.mode = LOCK; f.t = 0;
}

// 骨盤をどれだけ下げれば、股関節（hy の高さ）から足の目標（ty の高さ・水平の距離 horiz）へ脚（長さ R）が届くか。下げるだけ（上げない）
export function dropToReach(hy, ty, horiz, R) {
  if (!(horiz < R)) return Infinity;
  const need = (hy - ty) - Math.sqrt(R * R - horiz * horiz);
  return need > 0 ? need : 0;
}
