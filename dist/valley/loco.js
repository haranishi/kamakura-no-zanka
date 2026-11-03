// loco.js — 主人公の速さの表と、時間で決める加速・減速・旋回（design-locomotion-smooth §2・§3、M1）。純粋（渡された値だけで進める）。
// 速さの候補を URL で見比べる：?loco=old|a|b|c と個別の ?walk=3.1&sprint=5.2。既定は a。
//   ?loco=old と ?smooth=off は、速さの表・加減速・歩容の境・波及の値をすべて旧い経路へ戻す（位置の列が旧 main と一致する）。
//   ?smooth=speed は表と歩容の境だけ、?smooth=accel は加減速と旋回だけ、?smooth=phase は足の位相と歩調（M2a・gait-phase.js）だけ、?smooth=ik は脚のIKと接地（M2b・leg-ik.js）だけを旧い経路へ戻す（smooth-flags.js）。
// 加減速は臨界減衰のばねで、速さとその変化の速さを状態に持つ。設計の「smootherstep の曲線」と同じく始まりと終わりが滑らかで、
// 途中で目標が変わっても（鋭い向き変え・Shift の押し離し）速さが跳ばない。1コマで進む距離はばねの式を dt で厳密に積分するので、
// 30・60・144 コマ/秒のどれでも止まる距離と時間はほぼ同じ（差は止めきる最後の1コマ分だけ）。
import { parseSmoothFlags } from './smooth-flags.js';

export const LOCO_TABLES = Object.freeze({
  old: Object.freeze({ walk: 2.5, sprint: 5.0 }),
  a: Object.freeze({ walk: 3.0, sprint: 5.0 }),
  b: Object.freeze({ walk: 2.8, sprint: 4.5 }),
  c: Object.freeze({ walk: 3.2, sprint: 5.5 }),
});
export const LOCO_DEFAULT = 'a';
export const SLOW = Object.freeze({ crouch: 1.3, guard: 1.5 });   // 慎重・受け歩きは変えない
// 歩容の境（m/秒・上がる/下がる）。旧：小走り2.1/1.8・走り3.7/3.3（anim-data.js の GAITS）。
// 新：動作の接地中の足の速さ（gait-table：Samurai 1.19・Jog 2.15・Run 2.87）×歩調の許容から、Walk→Jog 1.7/1.4・Jog→Run 2.7/2.4。
// 通常移動3.0は Run を約1.05倍で回す（旧2.5は Jog を1.17倍）。
export const GAITS_SMOOTH = Object.freeze({ walkUp: 0.15, walkDown: 0.08, jogUp: 1.7, jogDown: 1.4, runUp: 2.7, runDown: 2.4 });
// 加速・減速：速さの差の95%に届く時間（秒）。ばねの角振動数 ω＝4.744÷時間（(1+ωt)e^(−ωt)=0.05 の解）
export const ACCEL = Object.freeze({ up: 0.22, down: 0.18, stopBelow: 0.02 });
const K95 = 4.7439;
// 旋回の上限（rad/秒）：遅いとき14、走りの速さで7。受けは6のまま。向きの差が広いほど目標の速さを下げ、真後ろは2割（減速しながら回る＝スキッド）。
// 0まで下げると、反転の途中で一度止まって待ちの動作へ混ぜ、また歩き→走りへ混ぜ直して、着いた足が35cm流れた（2026-11-04 実測）
export const TURN = Object.freeze({ slow: 14, fast: 7, guard: 6, from: 1.5, easy: 0.6, skid: 2.6, skidScale: 0.2 });

const num = (v, lo, hi) => { const x = Number(v); return Number.isFinite(x) && x >= lo && x <= hi ? x : null; };
const clamp01 = x => Math.max(0, Math.min(1, x));

// search は location.search の形。戻り値は凍結した設定
export function parseLoco(search = '') {
  const q = {}, s = String(search ?? '');
  for (const part of s.replace(/^\?/, '').split('&')) { const i = part.indexOf('='); if (i > 0) q[part.slice(0, i)] = part.slice(i + 1); }
  const flags = parseSmoothFlags(s), asked = String(q.loco || '').toLowerCase();
  const allOld = asked === 'old';
  const name = allOld || !flags.speed ? 'old' : LOCO_TABLES[asked] ? asked : LOCO_DEFAULT;
  const base = LOCO_TABLES[name], custom = name !== 'old';
  const walk = custom ? num(q.walk, 1.6, 6) ?? base.walk : base.walk;
  const sprint = custom ? Math.max(walk, num(q.sprint, 2, 8) ?? base.sprint) : base.sprint;
  const accel = !allOld && flags.accel;
  return Object.freeze({ name: custom && (walk !== base.walk || sprint !== base.sprint) ? `${name}*` : name, walk, sprint, ...SLOW,
    smoothSpeed: custom, smoothAccel: accel, smoothPhase: !allOld && flags.phase, smoothIk: !allOld && flags.ik, unknownLoco: asked && !LOCO_TABLES[asked] ? asked : null });
}

// 速さを上げたときの波及（調査 §6）。旧い表では旧い値そのもの（計算で丸めが混ざらないよう直書き）
export function dependents(cfg) {
  if (!cfg.smoothSpeed) return Object.freeze({ ally: 2.0, allyCatchUp: 1.6, allyStep: 2.1, run: 3.6, officerRun: 3.2 });
  const ally = 2.0 * cfg.walk / 2.5;                         // 仲間の歩き：主人公の通常移動との比を保つ（追いつき始める距離が同じ）
  return Object.freeze({
    ally,
    allyCatchUp: Math.max(1.6, 1.04 * cfg.sprint / ally - 1),  // 離れたときの上限＝主人公の走りの1.04倍（旧 5.2/5.0）
    allyStep: 2.1 * cfg.walk / 2.5,                           // 仲間が「前へ出ない」判定の見込みの速さ（companion-ai）
    run: Math.max(3.6, cfg.walk), officerRun: Math.max(3.2, cfg.walk),   // 敵の走りは主人公の通常移動を下回らない
  });
}

export const gaitsFor = (cfg, old) => cfg.smoothSpeed ? GAITS_SMOOTH : old;

// 旋回の上限（rad/秒）。v は今の速さ
export function turnRate(v, cfg, guard = false) {
  if (guard) return TURN.guard;
  return TURN.slow + (TURN.fast - TURN.slow) * clamp01((v - TURN.from) / Math.max(0.1, cfg.sprint - TURN.from));
}
// 向きの差 d（rad）に応じた目標の速さの倍率（鋭い向き変えほど遅く、真後ろは skidScale）
export function turnTargetScale(d) {
  const a = Math.abs(d);
  return a <= TURN.easy ? 1 : TURN.skidScale + (1 - TURN.skidScale) * clamp01(1 - (a - TURN.easy) / (TURN.skid - TURN.easy));
}

// 速さを dt だけ進め、その間に進んだ距離（m）を返す。st = { v, a }（速さとその変化の速さ）を書き換える。
// 臨界減衰：x＝v−目標、x(t)＝(x0＋(a0＋ωx0)t)e^(−ωt)。距離はこれを0〜dtで積分した厳密な値
export function speedStep(st, target, dt, accel = ACCEL) {
  if (!(dt > 0)) return 0;
  const w = K95 / (target >= st.v ? accel.up : accel.down), x0 = st.v - target, c = st.a + w * x0, e = Math.exp(-w * dt);
  const dist = target * dt + x0 * (1 - e) / w + c * (1 - e * (1 + w * dt)) / (w * w);
  st.v = target + (x0 + c * dt) * e;
  st.a = (st.a - w * dt * c) * e;
  if (st.v < 0 || (target === 0 && st.v < accel.stopBelow)) { st.v = 0; st.a = 0; }
  return Math.max(0, dist);
}

// 一定の目標へ向けて止まる・走り出すときの距離と時間（試験と報告用）。hz コマ/秒で回す
export function simulateRamp(from, target, hz, maxT = 2) {
  const st = { v: from, a: 0 }, dt = 1 / hz; let dist = 0, t = 0, reach = null;
  while (t < maxT) {
    dist += speedStep(st, target, dt); t += dt;
    if (reach == null && Math.abs(st.v - target) <= 0.05 * Math.abs(target - from) + 1e-9) reach = t;
    if (target === 0 && st.v === 0) break;
  }
  return { dist, t, reach };
}

// 実行中の設定（main.js が URL から一度だけ決める。既定は新しい表 a）
export const LOCO = { ...parseLoco('') };
export function useLoco(cfg) { Object.assign(LOCO, cfg); return LOCO; }
