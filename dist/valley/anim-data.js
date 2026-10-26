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
export function segmentFor(meta, { windup, active, recover }) {
  const total = meta.seconds;
  if (!meta.active) return { from: 0, to: total, speed: total / Math.max(0.2, windup + active + recover), approximate: true };
  const [a, b] = meta.active;
  let speed = clamp((b - a) / Math.max(0.02, active), 1.1, 2.2);
  let from = a - windup * speed;
  if (from < 0) { from = 0; speed = clamp(a / Math.max(0.05, windup), 0.6, 2.2); }
  const to = Math.min(total, b + recover * speed);
  return { from, to, speed, approximate: false };
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
