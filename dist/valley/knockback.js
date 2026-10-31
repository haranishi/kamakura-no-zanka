// knockback.js — 命中した敵の押し戻し（8.4a・R18.4・R18.12）。純粋：Three.js・DOM・乱数・時計に触れない。
// 規則に触れる部分（論理の位置を動かす）なので、量・時間・止め方をここだけに置く。actors.js が毎コマ、
// 押す量を受け取り、壁・急な斜面（collision.js の moveActor）と、ほかの人との距離（knockGap）で止める。
// 押すのは主人公の刀が「当たった」ときだけ（受け・弾き・闇討ち・矢は押さない）。時間割・ダメージ・構え・間合い・無敵・連続入力は変えない。
import { gapScale } from './lunge.js';

export const KNOCK = Object.freeze({
  dist: 0.2,              // 押し戻す距離（m）。本人の指定「約0.2m」（2026-10-30）
  strong: 1.25,           // 強い技（三段目・強斬り・反撃・とどめ）は1.25倍＝0.25m
  heavyArmor: 0.5,        // 重い鎧（侍大将）は半分。鎧でひるまない規則（R18.4）に合わせ、押されにくく見せる
  dur: 0.14,              // 押す時間（ゲーム内の秒）。命中の停止の間はゲームの時間がほぼ止まるので、押すのは停止が明けてから
  minGap: 0.72,           // ほかの人との中心の距離の下限（m）。game.js の separateActors と同じ。押された人だけを止め、ほかの人は押さない
  maxDownSlope: 46,       // 下りでも、歩ける斜度（46度）より急な所へは押さない（崖へ落とさない）。上りの急な斜面・段差・壁・水は moveActor の規則
});
// moveActor へ渡す移動の規則（下りの急な斜面へ押さない）
export const KNOCK_MOVE = Object.freeze({ maxDownSlope: KNOCK.maxDownSlope });
const STRONG = new Set(['light3', 'heavy', 'counter', 'finisher']);

// 技と鎧から押す距離（m）。未知の技は基本の距離
export function knockDistance(moveId, armor) {
  return KNOCK.dist * (STRONG.has(moveId) ? KNOCK.strong : 1) * (armor === 'heavy' ? KNOCK.heavyArmor : 1);
}

// 押し戻しの状態（人物ごとに1つ。毎コマ使い回す）
export function createKnock() { return { dx: 0, dz: 0, dist: 0, t: 0 }; }
// 押す向き（水平。攻め手から受け手へ）と距離を入れる。向きが無い・距離が0以下なら押さない
export function startKnock(k, dirX, dirZ, dist) {
  const l = Math.hypot(dirX, dirZ);
  if (!(l > 1e-9) || !(dist > 0)) { k.dist = 0; k.t = 0; return false; }
  k.dx = dirX / l; k.dz = dirZ / l; k.dist = dist; k.t = 0;
  return true;
}
export function endKnock(k) { k.dist = 0; k.t = 0; }
// 始めが速く、終わりがゆるい（打たれて弾かれ、足で踏みとどまる）。0→0、1→1
export const knockEase = u => { const v = Math.max(0, Math.min(1, u)); return 1 - (1 - v) * (1 - v); };
// このコマに押す距離（m）。dt はゲーム内の秒。刻み幅を変えても合計は dist になる
export function knockStep(k, dt) {
  if (!(k.dist > 0) || !(dt > 0) || k.t >= KNOCK.dur) return 0;
  const t1 = Math.min(KNOCK.dur, k.t + dt), d = k.dist * (knockEase(t1 / KNOCK.dur) - knockEase(k.t / KNOCK.dur));
  k.t = t1;
  if (t1 >= KNOCK.dur) k.dist = 0;
  return d;
}
// 押された人が、ほかの人（中心 ox, oz）へ minGap より近づかない割合（0〜1）。もう近いときは離れる向きだけ許す
export const knockGap = (px, pz, sx, sz, ox, oz) => gapScale(px, pz, sx, sz, ox, oz, KNOCK.minGap);
