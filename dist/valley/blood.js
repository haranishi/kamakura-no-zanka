// blood.js — 設定「血の表現」の規則（R18.11・tasks-polish3.md 8.4b）。純粋：Three.js・DOM・乱数・時計に触れない（乱数は種から作る）。
// 段階は なし／ひかえめ／標準。既定は「ひかえめ」（2026-11-03・本人。旧案の既定「なし」を改めた）。
// 様式は朱の墨絵風：飛沫は刃の当たった向きへ短く散る点と筆の払い（速度の向きへ細長く伸びる点）。「標準」だけ地面に数秒で薄れるしみ。
// 写実的な傷口・持続する流血・全画面の赤は扱わない。戦闘の規則（時間割・ダメージ・構え・間合い・無敵・入力）には触れない（18.9）。
// 見せ方の結線は fx.js（点群 norm の枠を使い、描画呼出を増やさない）と battle.js（刃が体に入った hit だけ）。

export const BLOOD_LEVELS = Object.freeze(['off', 'subtle', 'standard']);
export const BLOOD_DEFAULT = 'subtle';
// 同時の上限（R18.11）。超える命中では、空いた分だけ出す（枠は増やさない）
export const BLOOD_CAP = Object.freeze({ drops: 64, stains: 16 });

// 未設定・未知の値は既定「ひかえめ」へ（guide-view.js の normalizeWaymarks にならう）
export function normalizeBlood(level) {
  return BLOOD_LEVELS.includes(level) ? level : BLOOD_DEFAULT;
}

// 色（線形の値）。朱〜濃い赤を主に、墨の濃淡を少し混ぜる。しみは乾いた濃い赤
export const BLOOD_COLOR = Object.freeze({
  shu: [0.62, 0.06, 0.025], deep: [0.24, 0.012, 0.01], ink: [0.05, 0.035, 0.03], stain: [0.2, 0.012, 0.01],
  inkShare: 0.18,          // 飛沫のうち墨寄りの色にする割合
});

// 1回の命中で出す量の表。kind：hit（ふつう）／strong（強い技・三段目・闇討ち）／kill（倒れる瞬間・とどめ。1回きり）。
// 軽量品質は粒を減らすが、ひかえめでも0にしない（段階の見え方を保つ）。数は本人の確認前の初期値（2026-11-03）
const DROPS = {
  standard: { subtle: { hit: 6, strong: 9, kill: 12 }, standard: { hit: 12, strong: 18, kill: 26 } },
  light: { subtle: { hit: 4, strong: 6, kill: 8 }, standard: { hit: 8, strong: 12, kill: 16 } },
};
const STAINS = {
  standard: { hit: 1, strong: 2, kill: 4 },
  light: { hit: 1, strong: 1, kill: 3 },
};
const LOOK = {
  subtle: { speed: [1.6, 3.2], life: [0.22, 0.42], size: [0.028, 0.05], stretch: [1.2, 2.4] },
  standard: { speed: [2.0, 4.4], life: [0.32, 0.65], size: [0.032, 0.066], stretch: [1.4, 3.0] },
};
const STAIN_LOOK = { life: [2.6, 3.6], size: [0.2, 0.34], reach: [0.25, 0.9] };
const ZERO = Object.freeze({ drops: 0, speed: [0, 0], life: [0, 0], size: [0, 0], stretch: [0, 0], stains: 0, stainLife: [0, 0], stainSize: [0, 0], stainReach: [0, 0], color: BLOOD_COLOR });
const KINDS = ['hit', 'strong', 'kill'];

// 段階・品質・命中の種類から、出す量と見た目の幅を返す（毎回同じ物。呼出側は書き換えない）
const RECIPES = {};
for (const q of ['standard', 'light']) for (const lv of BLOOD_LEVELS) for (const k of KINDS) {
  RECIPES[`${q}/${lv}/${k}`] = lv === 'off' ? ZERO : Object.freeze({
    drops: DROPS[q][lv][k], ...LOOK[lv],
    stains: lv === 'standard' ? STAINS[q][k] : 0,
    stainLife: lv === 'standard' ? STAIN_LOOK.life : [0, 0], stainSize: lv === 'standard' ? STAIN_LOOK.size : [0, 0], stainReach: lv === 'standard' ? STAIN_LOOK.reach : [0, 0],
    color: BLOOD_COLOR,
  });
}
export function bloodRecipe(level, quality = 'standard', kind = 'hit') {
  return RECIPES[`${quality === 'light' ? 'light' : 'standard'}/${normalizeBlood(level)}/${KINDS.includes(kind) ? kind : 'hit'}`];
}

// 命中の種類。dead（この当たりで倒れた）が最優先、次に強い技
export function bloodKind({ dead = false, strong = false } = {}) {
  return dead ? 'kill' : strong ? 'strong' : 'hit';
}

// 同時の上限の判定：いま出ている数 active に対して、want のうち出してよい数
export function bloodBudget(active, want, cap) {
  return Math.max(0, Math.min(want | 0, (cap | 0) - (active | 0)));
}

// 命中ごとの種（同じ入力なら同じ飛沫。ゲームの乱数 g.rng は使わない＝戦闘の論理に触れない）
export function bloodSeed(n) {
  return (Math.imul((n | 0) + 1, 2654435761) ^ 0x5bd1e995) >>> 0;
}
// 種からの乱数（scatter.js の mulberry32 と同じ式。依存を増やさないためここに置く）
export function bloodRng(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const lerp = (r, [a, b]) => a + (b - a) * r;
// 1粒ぶんの値を out へ書く（作業用の物を使い回す。毎回の新規確保なし）。
// dirX/dirZ：攻め手から受け手への水平の向き。travel：刃の進む向き（無ければ null）。飛沫は刃の進む向きと当たった向きの間の狭い円錐へ、少し上向きに散る
export function sprayDrop(rng, recipe, dirX, dirZ, travel, out) {
  let bx = dirX * 0.45, by = 0.22, bz = dirZ * 0.45;
  const tl = travel ? Math.hypot(travel[0], travel[1], travel[2]) : 0;
  if (tl > 1e-6) { bx += travel[0] / tl * 0.55; by += travel[1] / tl * 0.3; bz += travel[2] / tl * 0.55; } else { bx += dirX * 0.4; bz += dirZ * 0.4; }
  const rx = bx + (rng() - 0.5) * 0.7, ry = by + (rng() - 0.5) * 0.45, rz = bz + (rng() - 0.5) * 0.7, rl = Math.hypot(rx, ry, rz) || 1;
  const sp = lerp(rng(), recipe.speed);
  out.vel[0] = rx / rl * sp; out.vel[1] = ry / rl * sp; out.vel[2] = rz / rl * sp;
  out.life = lerp(rng(), recipe.life); out.size = lerp(rng(), recipe.size); out.stretch = lerp(rng(), recipe.stretch);
  const c = recipe.color, ink = rng() < c.inkShare, m = rng(), from = ink ? c.deep : c.shu, to = ink ? c.ink : c.deep;
  for (let i = 0; i < 3; i++) out.color[i] = from[i] + (to[i] - from[i]) * m * (ink ? 0.8 : 0.6);
  return out;
}
// 1枚ぶんのしみ：受け手の足もとから当たった向きへ少し先の地面（高さは呼出側が地形から取る）
export function sprayStain(rng, recipe, dirX, dirZ, out) {
  const a = (rng() - 0.5) * 1.6, ca = Math.cos(a), sa = Math.sin(a), reach = lerp(rng(), recipe.stainReach);
  out.dx = (dirX * ca - dirZ * sa) * reach; out.dz = (dirX * sa + dirZ * ca) * reach;
  out.life = lerp(rng(), recipe.stainLife); out.size = lerp(rng(), recipe.stainSize);
  return out;
}
export function createSpray() { return { vel: [0, 0, 0], color: [0, 0, 0], life: 0, size: 0, stretch: 0, dx: 0, dz: 0 }; }
