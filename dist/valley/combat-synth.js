// combat-synth.js — 戦いの金属音の設計図（純粋）。種類・揺らぎ・相手の鎧から、層の一覧 {type,startMs,...}[] を返すだけ。
// 音のノードへ変えるのは audio-valley.js の scheduleCombat（コンテキストを受け取る）。数値は試聴用の初期値（design-audio.md「戦いの金属音」）。
// 聴き分けの狙い：キーン＝弾き（高く長い余韻）／カーン＝受け・打ち合い（やや低く短い）／ガン＝鎧に当たる（低中域の板の鳴り＋肉の鈍い音）。
// 部分音は整数倍にしない（刃は棒、鎧は板の振動の比）。近い2本の部分音でうなりを作る。打撃の瞬間は数ミリ秒の高域のクリック。火花のジッは同じ声の中の層。
import { pickVariant } from './audio-rules.js';

// 部分音の比（変奏3通り）・強さ・−60dBまでの減衰(ms)。うなりは [部分音の番号, ずれの割合, 強さ]
const RING = {
  parry: { base: 1750, ratios: [[1, 1.47, 2.09, 2.76, 3.62], [1, 1.52, 2.16, 2.71, 3.8], [1, 1.43, 2.02, 2.83, 3.55]], gains: [1, 0.75, 0.6, 0.45, 0.32], decays: [1700, 1250, 900, 600, 380], beats: [[0, 0.0045, 0.55], [1, 0.0065, 0.5]] },
  block: { base: 820, ratios: [[1, 1.62, 2.41, 3.3], [1, 1.58, 2.47, 3.21], [1, 1.67, 2.36, 3.38]], gains: [1, 0.8, 0.55, 0.35], decays: [480, 360, 250, 170], beats: [[0, 0.009, 0.5]] },
  clash: { base: 1080, ratios: [[1, 1.62, 2.41, 3.3], [1, 1.58, 2.47, 3.21], [1, 1.67, 2.36, 3.38]], gains: [1, 0.8, 0.6, 0.4], decays: [650, 480, 330, 220], beats: [[0, 0.006, 0.5]] },
  plate: { base: 520, ratios: [[1, 1.59, 2.14, 2.3, 2.65, 3.16], [1, 1.55, 2.1, 2.36, 2.7, 3.1], [1, 1.62, 2.18, 2.27, 2.6, 3.22]], gains: [1, 0.85, 0.65, 0.6, 0.45, 0.3], decays: [420, 360, 300, 280, 220, 160], beats: [] },
  drop: { base: 1250, ratios: [[1, 2.4, 3.9], [1, 2.3, 4.1], [1, 2.55, 3.8]], gains: [1, 0.6, 0.4], decays: [420, 280, 170], beats: [] },
};
// 直前と同じ変奏を続けない規則（audio-rules.js の pickVariant）の、どの表を使うか
const VARIANT_KEY = { parry: 'parry', block: 'block', clash: 'block', hit_armor: 'hit', hit_armor_heavy: 'hit', sword_drop: 'fall', spark: 'blade' };
export const COMBAT_KINDS = Object.freeze(Object.keys(VARIANT_KEY));

const jit = (rng, amount) => 1 + (rng() * 2 - 1) * amount;
// 鳴る板・棒：部分音ごとに減衰が違う（高い部分音ほど早く消える）。base・比・強さ・減衰に毎回の揺らぎ
function ring(out, rng, spec, variant, { startMs = 0, base = spec.base, gain = 1, decay = 1 } = {}) {
  const f0 = base * jit(rng, 0.03), ratios = spec.ratios[variant % spec.ratios.length];
  ratios.forEach((r, i) => {
    const freq = f0 * r * (i ? jit(rng, 0.006) : 1), g = gain * spec.gains[i] * 10 ** ((rng() * 2 - 1) * 1.5 / 20), d = spec.decays[i] * decay * jit(rng, 0.1);
    out.push({ type: 'mode', startMs, freq, gain: g, attackMs: 1, decayMs: d });
    for (const [k, detune, bg] of spec.beats) if (k === i) out.push({ type: 'mode', startMs, freq: freq * (1 + detune), gain: g * bg, attackMs: 1, decayMs: d });
  });
}
const noise = (out, rng, startMs, filter, freq, q, durMs, gain, freq2 = 0) => out.push({ type: 'noise', startMs, filter, freq, freq2, q, durMs, gain, attackMs: 0.5, offset: rng() * 0.9 });
// 火花のジッ：高い帯の短いノイズと、ばらばらに散る数個の粒
function spark(out, rng, gain, startMs = 2) {
  const k = jit(rng, 0.08); noise(out, rng, startMs, 'bandpass', 7000 * k, 1.3, 45, 0.8 * gain, 9500 * k);
  for (let i = 0; i < 4; i++) noise(out, rng, startMs + 4 + rng() * 50, 'highpass', 6500, 0.7, 4, 0.5 * gain);
}
const thud = (out, startMs, freq, freq2, durMs, gain) => out.push({ type: 'thud', startMs, freq, freq2, durMs, gain });

// kind: COMBAT_KINDS。rng は [0,1) を返す関数（種つき）。last は前回の変奏。armor: 'light'|'heavy'（鎧に当たる音だけ）。
// 戻り: { variant, layers }。周波数は pitch 込み、強さは1付近（音量の補正は audio-valley.js の LEVEL）。
export function combatLayers(kind, { rng, last = null, pitch = 1, armor = 'heavy' } = {}) {
  if (!Object.hasOwn(VARIANT_KEY, kind)) throw new TypeError(`Unknown combat sound: ${String(kind)}`);
  if (typeof rng !== 'function') throw new TypeError('combatLayers needs an rng');
  const variant = pickVariant(VARIANT_KEY[kind], rng, last), L = [], p = pitch;
  switch (kind) {
    case 'parry':                                                   // キーン
      ring(L, rng, RING.parry, variant, { base: RING.parry.base * p, gain: 0.3 });
      noise(L, rng, 0, 'highpass', 5000, 0.7, 4, 0.7); spark(L, rng, 0.16); break;
    case 'block':                                                   // カーン（受け。腕に来る低い衝撃）
      ring(L, rng, RING.block, variant, { base: RING.block.base * p, gain: 0.3 });
      noise(L, rng, 0, 'bandpass', 3200, 0.8, 6, 0.9); thud(L, 0, 150 * p, 75 * p, 90, 0.45); spark(L, rng, 0.1); break;
    case 'clash':                                                   // カーン（刃が触れ合う。明るめ・少し長い）
      ring(L, rng, RING.clash, variant, { base: RING.clash.base * p, gain: 0.3 });
      noise(L, rng, 0, 'highpass', 3800, 0.7, 4, 0.8); spark(L, rng, 0.14); break;
    case 'hit_armor': case 'hit_armor_heavy': {                     // ガン（鎧の板）＋下に肉の鈍い音（傷は入っている）
      const heavy = kind === 'hit_armor_heavy', light = armor === 'light';
      ring(L, rng, RING.plate, variant, { base: (light ? 700 : 520) * (heavy ? 0.88 : 1) * p, gain: 0.3 * (light ? 0.75 : 1), decay: (light ? 0.55 : 1) * (heavy ? 1.25 : 1) });
      noise(L, rng, 0, 'bandpass', light ? 1600 : 1250, 5, 110, 0.5 * (heavy ? 1.2 : 1));
      noise(L, rng, 0, 'bandpass', 2600, 0.7, 4, 0.7);
      thud(L, 0, (heavy ? 95 : 115) * p, (heavy ? 40 : 50) * p, heavy ? 220 : 140, 0.3 * (light ? 1.15 : 1) * (heavy ? 1.4 : 1));
      noise(L, rng, 0, 'lowpass', 900, 0.7, 80, 0.25); spark(L, rng, 0.08); break;
    }
    case 'sword_drop': {                                            // カラン：先が当たる → 小さく跳ねる → 転がって鳴る
      const at = [0, 85 + (rng() * 2 - 1) * 15, 175 + (rng() * 2 - 1) * 25], gain = [1, 0.5, 0.28], decay = [1, 0.8, 0.6];
      at.forEach((ms, i) => { ring(L, rng, RING.drop, variant + i, { startMs: ms, base: RING.drop.base * p, gain: 0.26 * gain[i], decay: decay[i] }); noise(L, rng, ms, 'bandpass', 3000, 0.8, 4, 0.5 * gain[i]); });
      noise(L, rng, 0, 'lowpass', 500, 0.7, 60, 0.35); break;
    }
    case 'spark': spark(L, rng, 1, 0); break;                       // ジッ（単独）
  }
  return { variant, layers: L };
}
// 層の一覧の長さ（ms）。声の束を解放する時刻の計算に使う
export function layersEndMs(layers) {
  let end = 0;
  for (const l of layers) end = Math.max(end, l.startMs + (l.attackMs || 0) + (l.type === 'mode' ? l.decayMs : l.durMs));
  return end;
}
