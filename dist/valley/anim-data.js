// anim-data.js — 論理の状態・技 → 動作クリップの対応表と、技の時間割から動作の切り出しを決める純粋関数。
// 動作の長さ・当たり区間は assets/characters/clips.json（Blenderの焼き込み記録）から読む。Three.js非依存。

// 移動の動作。style ごとに待ち・歩き・小走り・走りを持つ。speed は m/s、clip 側の avgSpeed に再生速度を合わせる。
export const LOCOMOTION = {
  relaxed: { idle: 'Long_Breathe_and_Look_Around', walk: 'Samurai_Walk', jog: 'CMU_Jog', run: 'CMU_Run' },
  guard: { idle: 'Katana_Guard_Idle', walk: 'Walk_Fight_Forward', jog: 'CMU_Jog', run: 'CMU_Run' },
  crouch: { idle: 'Cautious_Crouch_Walk_Forward', walk: 'Cautious_Crouch_Walk_Forward', jog: 'Cautious_Crouch_Walk_Forward', run: 'Cautious_Crouch_Walk_Forward', idleFreeze: true },
  injured: { idle: 'Long_Breathe_and_Look_Around', walk: 'Samurai_Walk', jog: 'Samurai_Walk', run: 'CMU_Jog' },
  villager: { idle: 'Stand_and_Chat', walk: 'Casual_Walk', jog: 'CMU_Jog', run: 'CMU_Run' },
};

// 歩き↔小走り↔走りの切り替え速度（m/s）。往復で揺れないよう、上がるときと下がるときで境を変える。
export const GAITS = { walkUp: 0.15, walkDown: 0.08, jogUp: 2.1, jogDown: 1.8, runUp: 3.7, runDown: 3.3 };
export const TIME_SCALE_RANGE = [0.55, 2.0];

// 技 → 動作。clip は動作の名前、cut は当たりの後にどれだけ長く残すか（戻りを短く切るための上限・動作の秒）。
export const MOVE_CLIPS = {
  light1: { clip: 'Katana_Kesa_Cut' },
  light2: { clip: 'Katana_Gyakukesa_Cut' },
  light3: { clip: 'Katana_Yokonagi_Cut' },
  heavy: { clip: 'Katana_Karatake_Heavy' },
  finisher: { clip: 'Katana_Finisher' },
  counter: { clip: 'Katana_Counter_Cut' },
  soldier_slash: { clip: 'Attack_r1' },
  soldier_thrust: { clip: 'Katana_Thrust' },
  officer_a: { clip: 'Officer_Attack' },
  officer_b: { clip: 'Katana_Gyakukesa_Cut' },
  officer_c: { clip: 'Katana_Karatake_Heavy' },
  archer_shot: { clip: 'Archery_Shot' },
  ally_shot: { clip: 'Archery_Shot' },
};

// 状態 → 一度きりの動作（反応・回避・生活など）。fade は前の動作からの混ぜ秒。
export const ACTION_CLIPS = {
  dodge: { clip: 'Roll_Dodge', fade: 0.08 },
  dodge_small: { clip: 'Stand_Dodge', fade: 0.08 },
  parry: { clip: 'Katana_Parry', fade: 0.06 },
  block: { clip: 'Two_Handed_Parry', fade: 0.08 },
  hit: { clip: 'Hit_Reaction', fade: 0.05 },
  hit2: { clip: 'Hit_Reaction_1', fade: 0.05 },
  hit_waist: { clip: 'Hit_Reaction_to_Waist', fade: 0.05 },
  stagger: { clip: 'Knock_Down', fade: 0.06 },
  die: { clip: 'dying_backwards', fade: 0.08 },
  die2: { clip: 'Fall_Dead_from_Abdominal_Injury', fade: 0.08 },
  getup: { clip: 'Stand_Up2', fade: 0.1 },
  draw: { clip: 'Katana_Draw_v2', fade: 0.1 },
  sheathe: { clip: 'Katana_Sheathe', fade: 0.12 },
  wake: { clip: 'Wake_Up_and_Look_Up', fade: 0.1 },
  bow: { clip: 'Formal_Bow', fade: 0.2 },
  wave: { clip: 'Wave_One_Hand', fade: 0.2 },
  talk: { clip: 'Talk_with_Hands_Open', fade: 0.3 },
  chat: { clip: 'Stand_and_Chat', fade: 0.3 },
  kneel: { clip: 'Kneel_on_One_Knee_and_Stand', fade: 0.2 },
  sit: { clip: 'Sit_Cross_Legged_on_Floor', fade: 0.3 },
  work_pull: { clip: 'Pull_Radish', fade: 0.3 },
  work_pick: { clip: 'Male_Bend_Over_Pick_Up', fade: 0.3 },
  look: { clip: 'Walking_Scan_with_Sudden_Look_Back', fade: 0.3 },
  catch_breath: { clip: 'Catching_Breath', fade: 0.3 },
  shout: { clip: 'Sword_Shout', fade: 0.1 },
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// 手首の速さの山が「当たり／放ち」と一致しない動作は、使う区間を決め打ちにする（秒）。
// Archery_Shot：矢筒から矢を取る動きが速さの山になるので、つがえ（from）〜放ち（release）〜下ろし（end）を直接指定する。
export const CLIP_SEGMENTS = { Archery_Shot: { from: 2.0, release: 4.0, end: 4.95 } };

// 移動の速さから、歩き・小走り・走りのどれを再生するかと再生速度を決める（pure）。
export function pickGait(prev, speed) {
  let gait = prev;
  if (speed < GAITS.walkDown) gait = 'idle';
  else if (prev === 'idle') gait = speed >= GAITS.walkUp ? 'walk' : 'idle';
  if (gait !== 'idle') {
    if (speed >= GAITS.runUp) gait = 'run';
    else if (gait === 'run' && speed >= GAITS.runDown) gait = 'run';
    else if (speed >= GAITS.jogUp) gait = 'jog';
    else if (gait === 'jog' && speed >= GAITS.jogDown) gait = 'jog';
    else gait = 'walk';
  }
  return gait;
}

export function locomotionTimeScale(speed, avgSpeed) {
  if (!avgSpeed || avgSpeed < 0.3) return 1;
  return clamp(speed / avgSpeed, TIME_SCALE_RANGE[0], TIME_SCALE_RANGE[1]);
}

// 技の時間割（予備・当たり・戻り・秒）に合わせて、動作のどの区間をどの速さで再生するかを決める（pure）。
// meta は clips.json の1動作。active は手首の速さの山（秒）。足りない動作は先頭から全体を再生する。
export function segmentFor(meta, { windup, active, recover }, override = null) {
  const total = meta.seconds;
  if (override) {
    const speed = clamp((override.release - override.from) / Math.max(0.2, windup), 0.7, 2.4);
    return { from: override.from, to: Math.min(override.end ?? total, override.release + recover * speed), speed, approximate: false };
  }
  if (!meta.active) return { from: 0, to: total, speed: total / Math.max(0.2, windup + active + recover), approximate: true };
  const [a, b] = meta.active;
  let speed = clamp((b - a) / Math.max(0.02, active), 1.1, 2.2);
  let from = a - windup * speed;
  if (from < 0) { from = 0; speed = clamp(a / Math.max(0.05, windup), 0.6, 2.2); }
  const to = Math.min(total, b + recover * speed);
  return { from, to, speed, approximate: false };
}

// 振りの山を判定の区間へ合わせ直す技（8.3a・表示だけ。combat.js の時間割は変えない）。
// 動作の予備（手首の速さの山＝meta.active の前）が技の予備より短く、1つの速さでは山が判定より早く来る・判定のあとも振り続ける技。
// 使う区間（from・to）は segmentFor のまま、予備・振り・戻りの3区間で速さを変え、山の中央を判定の区間の中央へ置く。振りの速さの上限は maxSpeed。
export const MOVE_SYNC = Object.freeze({
  soldier_thrust: Object.freeze({ maxSpeed: 1.8 }),
  officer_b: Object.freeze({ maxSpeed: 1.8 }),
});

// 3区間の切り出し（pure）。knots は［技の開始からの秒, 動作の秒］の折れ線、speeds は区間ごとの速さ（予備・振り・戻り）。
// 合わせられない（山の前に動作が無い・戻りに使う所が無い）ときは segmentFor のまま返す。
export function syncedSegment(meta, timing, spec) {
  const base = segmentFor(meta, timing);
  if (!spec || !meta.active) return base;
  const [a, b] = meta.active, { windup, active, recover } = timing, total = windup + active + recover;
  const strike = Math.min(spec.maxSpeed, (b - a) / Math.max(1e-3, active)), half = (b - a) / strike / 2, mid = windup + active / 2;
  const t1 = mid - half, t2 = mid + half;
  if (!(t1 > 0 && a > base.from && t2 < total && base.to > b)) return base;
  const speeds = [(a - base.from) / t1, strike, (base.to - b) / (total - t2)];
  return { ...base, speed: Math.max(...speeds), speeds, knots: [[0, base.from], [t1, a], [t2, b], [total, base.to]] };
}

// 接触の動作の時刻（8.3a 第2周・表示だけ）。刃の中ほど〜切先が相手の胴の高さ（地面から1.1m±0.35m）を通るうちで、
// 胴の点（間合いの距離）へ最も近づく、動作の時刻（秒）。tools/scenarios/measure-combat-trail.mjs の contact で実ゲームから測った値。
// この間合いでは、どの技も刃が胴の点に届かない（最短0.25〜1.5m）。第3周で、見た目だけの踏み込み（lunge.js）が根を出して向きを回し、刃を胴へ通す。
// 三段目（light3）だけは第3周で 0.609→0.645 へ遅らせた：0.609 では刃が頭の高さ（1.44m）で止まり「振りかぶったまま」に見えた。0.645 で肩の高さ（約1.2m）。
export const MOVE_CONTACT = Object.freeze({
  light1: 0.79, light2: 0.38, light3: 0.645, heavy: 0.915, counter: 0.479, finisher: 2.785,
  soldier_slash: 1.053, soldier_thrust: 0.336, officer_a: 1.058, officer_b: 0.383, officer_c: 0.919,
});
export const CONTACT_MAX_SPEED = 1.8;

// 接触の動作の時刻を、判定の始め（予備の終わり）へ置く切り出し（pure）。base は今の切り出し（segmentFor・syncedSegment）。
// 予備〜接触を1つの速さ s1 で流せて、それが今の振りの速さ以上なら、from〜手首の山の終わりまでをその速さで（振りの途中で遅くしない）。
//   s1 が上限を超えるなら、上限で間に合うよう、動作の少し先から始める（from を後ろへ。始めの姿勢は混ぜが隠す）。
// s1 が今の振りの速さより遅いなら、振り（手首の山）は今の速さのまま、予備だけをゆっくりにする（3区間。8.3a の突き・二段目の形）。
// 戻りは、使う長さを今より短くしないよう、上限・動作の終わりまでで延ばす。上限は1.8倍、今すでに超えている技は今の速さまで。
// 戻りは knots（[技の開始からの秒, 動作の秒] の折れ線）と、区間ごとの速さ speeds。
export function contactSegment(meta, timing, contact, base) {
  if (!meta?.active || !Number.isFinite(contact) || !base || base.approximate) return base;
  const { windup, active, recover } = timing, total = windup + active + recover, [a, b] = meta.active;
  const strike = base.speeds ? base.speeds[1] : base.speed, cap = Math.max(CONTACT_MAX_SPEED, base.speed);
  let from = base.from, tc = windup;
  const s1 = (contact - from) / windup, bb = Math.max(b, contact), knots = [];
  let S;
  if (s1 >= strike - 1e-9) {
    S = Math.min(s1, cap);
    if (s1 > cap) { from = Math.max(0, contact - cap * windup); tc = (contact - from) / cap; }   // 0 から始めても間に合わないときだけ、接触が遅れる
    knots.push([0, from], [tc, contact]);
  } else {
    S = strike;
    const aa = Math.min(Math.max(a, from), contact), t1 = windup - (contact - aa) / strike;
    knots.push([0, from]); if (t1 > 1e-6 && t1 < windup - 1e-6 && aa > from) knots.push([t1, aa]); knots.push([windup, contact]);
  }
  if (!(tc < total - 1e-3)) return base;
  const tb = tc + (bb - contact) / S;
  if (tb > total - 1e-3) knots.push([total, contact + S * (total - tc)]);
  else {
    if (tb > tc + 1e-6) knots.push([tb, bb]);
    const want = Math.max(base.to, from + (base.to - base.from));            // 使う長さを今より短くしない
    knots.push([total, Math.max(bb + 1e-3, Math.min(meta.seconds, want, bb + cap * (total - tb)))]);
  }
  const speeds = knots.slice(1).map((k, i) => (k[1] - knots[i][1]) / (k[0] - knots[i][0]));
  return { from, to: knots.at(-1)[1], speed: Math.max(...speeds), speeds, knots, contact, contactAt: tc, approximate: false };
}

// 技の切り出しの選び方（characters.js の playMove と measure-move-segments.mjs が同じものを使う）。
// 弓（区間の決め打ち）→ そのまま。8.3a の3区間（MOVE_SYNC）→ 振りの速さの元。接触の時刻がある技 → 接触を判定の始めへ。
export function moveSegment(id, meta, timing) {
  const def = MOVE_CLIPS[id];
  if (!def || !meta) return null;
  const fixed = CLIP_SEGMENTS[def.clip];
  if (fixed) return segmentFor(meta, timing, fixed);
  const base = MOVE_SYNC[id] ? syncedSegment(meta, timing, MOVE_SYNC[id]) : segmentFor(meta, timing);
  return Object.hasOwn(MOVE_CONTACT, id) ? contactSegment(meta, timing, MOVE_CONTACT[id], base) : base;
}

// 技の開始から t 秒の、動作の時刻（pure）。折れ線の外は、端の区間の速さで延ばす。
export function clipTimeAt(knots, t) {
  let i = 1;
  while (i < knots.length - 1 && t > knots[i][0]) i++;
  const [t0, c0] = knots[i - 1], [t1, c1] = knots[i];
  return c0 + (c1 - c0) * (t - t0) / (t1 - t0);
}

// clipTimeAt の逆（pure）：動作の時刻 c になる、技の開始からの秒。折れ線は単調に増えるので1つに決まる。外は端の区間で延ばす。
export function timeAtClip(knots, c) {
  let i = 1;
  while (i < knots.length - 1 && c > knots[i][1]) i++;
  const [t0, c0] = knots[i - 1], [t1, c1] = knots[i];
  return t0 + (t1 - t0) * (c - c0) / (c1 - c0);
}

// 動作の水平な根の移動（in-place化で取り除いた分）を、区間 [from,to] で取り出す。論理側の前進量の参考値。
export function rootTravel(root, from, to) {
  if (!root) return { x: 0, z: 0 };
  const at = t => {
    const ts = root.times;
    if (t <= ts[0]) return [root.x[0], root.z[0]];
    if (t >= ts[ts.length - 1]) return [root.x[ts.length - 1], root.z[ts.length - 1]];
    let i = 1;
    while (ts[i] < t) i++;
    const k = (t - ts[i - 1]) / (ts[i] - ts[i - 1]);
    return [root.x[i - 1] + (root.x[i] - root.x[i - 1]) * k, root.z[i - 1] + (root.z[i] - root.z[i - 1]) * k];
  };
  const p0 = at(from), p1 = at(to);
  return { x: p1[0] - p0[0], z: p1[1] - p0[1] };
}
