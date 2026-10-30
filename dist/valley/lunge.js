// lunge.js — 見た目だけの踏み込み（8.3a 第3周・R18.3）。純粋：Three.js・DOM・乱数・時計に触れない。
// 間合いの距離では、どの技も刃が相手の胴に届かない（0.24〜1.56m足りない）。論理の位置（実座標）と向きは変えずに、
// 振りの間だけ人物の模型の根を相手へ出し、向きを回して、判定の始め（＝接触）の姿勢の刃の中ほど〜切先を相手の胴の軸へ通す。
// actors.js が毎コマ、相手の位置（攻め手の局所）と技の経過を渡す。ここは、量（前進・回す角）と、その時間への配り方、
// めり込みの止め方だけを決める。毎コマ呼ぶ関数は、渡された作業用の物へ書くだけ（新規確保なし）。

const DEG = Math.PI / 180;
export const LUNGE_VIEW = Object.freeze({
  maxShift: 0.9,          // 前進の上限（m）
  minShift: -0.3,         // 相手が刃の届く所より近いときは、少し下がって見せる（刃が胴の向こうへ抜けない）。その下限（m）
  minGap: 0.55,           // 見た目の中心どうしの距離の下限（m。めり込み防止）
  maxTurn: 60 * DEG,      // 回す角の上限（rad）。袈裟は止まるコマで刃が左へ約60度流れている
  depth: 0.1,             // 刃の点を胴の軸よりどれだけ奥へ通すか（m）。胴の半径0.22の内
  guard: 0.45,            // 相手が受けているときは、胴の軸のこれだけ手前（相手の刀の所）で止める（m）
  band: Object.freeze([0.6, 1.65]),   // 刃の点に選ぶ高さ（立ち位置から・m）。腰〜肩
  slack: 0.12,            // この横ずれ（m）までは、胴を通ったとみなす（回す角を上限で止めたときの残り）
  returnTime: 0.3,        // 判定の終わりから元の位置へ戻すまでの秒（戻りの長さの returnShare までに収める）
  returnShare: 0.7,
  settle: 14,             // 技の外（弾かれた・中断）で元へ戻す速さ（1/秒）
  reachSlack: 0.3,        // 論理の間合い（reach＋相手の半径）をこれだけ超えた相手には踏み込まない（当たらない振りで、刃を胴へ入れない）
  arcSlack: 10 * DEG,     // 同じく、論理の弧をこれだけ超えた向きの相手には踏み込まない
  maxRise: 0.25,          // 地面の傾きで根を上下させる上限（m）
});

// 判定の始めの刃の中ほど（刀の枠 y=0.52）と切先（0.88）の位置（mid・tip）と、その1コマ（1/60秒）後（mid2・tip2）。
// 攻め手の局所（x＝右・y＝立ち位置からの高さ・z＝前、m、模型の大きさ1）。tools/scenarios/measure-combat-trail.mjs の contact の pose・pose2（seed 1333）。
// 当たり（と命中の停止）は、判定の始めを越えた最初のコマで起きるので、止まる姿勢はこの2つの間（60コマ/秒で最大1コマ後）。弓は踏み込まない。
const P = (mid, tip, mid2, tip2) => Object.freeze({ mid: Object.freeze(mid), tip: Object.freeze(tip), mid2: Object.freeze(mid2), tip2: Object.freeze(tip2) });
export const CONTACT_POSE = Object.freeze({
  light1: P([-0.672, 1.443, 0.496], [-0.91, 1.448, 0.765], [-0.819, 1.131, 0.339], [-1.069, 1.069, 0.59]),
  light2: P([-0.087, 1.06, 0.834], [0.001, 0.947, 1.164], [-0.363, 1.021, 0.758], [-0.384, 0.894, 1.095]),
  light3: P([-0.624, 1.249, 0.518], [-0.867, 1.137, 0.759], [-0.73, 1.057, 0.331], [-0.977, 0.886, 0.531]),   // 接触を 0.645 へ遅らせた後（anim-data.js）
  heavy: P([-0.53, 1.161, 0.604], [-0.689, 1.278, 0.904], [-0.579, 0.768, 0.601], [-0.757, 0.759, 0.913]),
  counter: P([0.839, 0.804, 0.301], [1.168, 0.661, 0.279], [0.481, 0.494, 0.51], [0.703, 0.218, 0.572]),
  finisher: P([0.069, 1.016, 0.737], [0.21, 0.911, 1.051], [0.099, 0.939, 0.721], [0.252, 0.804, 1.018]),
  soldier_slash: P([0.258, 0.969, 0.91], [0.583, 0.992, 1.062], [0.099, 0.414, 0.876], [0.37, 0.269, 1.063]),
  soldier_thrust: P([-0.243, 1.268, 0.946], [-0.174, 1.409, 1.269], [-0.338, 1.265, 0.925], [-0.301, 1.388, 1.262]),
  officer_a: P([0.345, 0.864, 0.702], [0.701, 0.829, 0.662], [0.2, 0.45, 0.699], [0.545, 0.362, 0.749]),
  officer_b: P([-0.11, 1.166, 0.87], [-0.014, 1.055, 1.199], [-0.384, 1.147, 0.797], [-0.389, 1.038, 1.14]),
  officer_c: P([-0.58, 1.175, 0.612], [-0.742, 1.304, 0.906], [-0.626, 0.805, 0.607], [-0.812, 0.823, 0.915]),
});
// 当たりが起きるコマの時刻（技の開始からの秒）の見込み：判定の始め W を越える最初のコマ。いま t、コマの長さ dt。
export function hitTime(W, t, dt) {
  if (!(t < W)) return t;
  if (!(dt > 1e-6)) return W;
  return t + Math.ceil((W - t) / dt - 1e-6) * dt;
}

// solveLunge の入出力（1つの Float64Array）。入：W＝判定の始め・t＝いまの技の経過・dt＝コマの長さ（秒）・scale＝模型の大きさ・
// tx・tz＝相手の胴の軸（攻め手が判定の始めに立つ位置からの局所。右・前、m）・depth。出：shift・turn・miss・height（cost は作業用）。
// 数を引数で渡す・物の欄へ書く・数を返すと、呼ぶたびに数の箱が作られた（第2周の帯と同じ）ので、配列へ書いて読む。
export const LUNGE_IO = Object.freeze({ W: 0, t: 1, dt: 2, scale: 3, tx: 4, tz: 5, depth: 6, shift: 7, turn: 8, miss: 9, height: 10, cost: 11 });
export const createLungeIO = () => new Float64Array(12);

// 止まるコマに、相手の胴の軸へ刃を通す前進（m）と回す角（rad）。止まるコマ＝判定の始め W を越える最初のコマ（いま t・コマの長さ dt から見込む。
// hitTime と同じ）。姿勢は、判定の始めと1コマ後の間を補う。刃の中ほど〜切先の5点のうち、高さが band に近く、回す角が小さく、
// 前進が小さい点を選ぶ。回す角は maxTurn まで（残りの横ずれは miss）。turn はゲームの向きと同じ符号（正＝左へ回す）。
// depth は胴の軸より奥へ通す長さ（受けている相手には −guard）。前進は minShift〜maxShift、かつ見た目の中心どうしが minGap 以上まで。
export function solveLunge(pose, io) {
  const V = LUNGE_VIEW, O = LUNGE_IO, W = io[O.W], t = io[O.t], dt = io[O.dt], scale = io[O.scale], tx = io[O.tx], tz = io[O.tz], depth = io[O.depth];
  const dT = Math.sqrt(tx * tx + tz * tz), aT = Math.atan2(tx, tz), A = pose.mid, B = pose.tip, A2 = pose.mid2, B2 = pose.tip2;
  const th = !(t < W) ? t : !(dt > 1e-6) ? W : t + Math.ceil((W - t) / dt - 1e-6) * dt;
  const w = Math.max(0, Math.min(1, (th - W) * 60));
  io[O.shift] = 0; io[O.turn] = 0; io[O.miss] = 0; io[O.height] = 0; io[O.cost] = Infinity;
  for (let i = 0; i <= 4; i++) {
    const k = i / 4;
    const mx = A[0] + (A2[0] - A[0]) * w, my = A[1] + (A2[1] - A[1]) * w, mz = A[2] + (A2[2] - A[2]) * w, px = B[0] + (B2[0] - B[0]) * w, py = B[1] + (B2[1] - B[1]) * w, pz = B[2] + (B2[2] - B[2]) * w;
    const x = (mx + (px - mx) * k) * scale, y = (my + (py - my) * k) * scale, z = (mz + (pz - mz) * k) * scale;
    const r = Math.sqrt(x * x + z * z);
    if (!(r > 0.15)) continue;
    const d = aT - Math.atan2(x, z), want = Math.atan2(Math.sin(d), Math.cos(d));          // 右へ回す角
    const rot = Math.max(-V.maxTurn, Math.min(V.maxTurn, want)), off = want - rot;
    const along = r * Math.cos(off), miss = Math.abs(r * Math.sin(off)), shift = dT + depth - along;
    const outside = y < V.band[0] ? V.band[0] - y : y > V.band[1] ? y - V.band[1] : 0;
    const cost = Math.abs(rot) + 2 * Math.max(0, miss - V.slack) + 0.2 * Math.abs(shift) + 3 * outside;
    if (cost < io[O.cost]) { io[O.cost] = cost; io[O.turn] = -rot; io[O.shift] = shift; io[O.miss] = miss; io[O.height] = y; }
  }
  io[O.shift] = Math.max(V.minShift, Math.min(Math.min(V.maxShift, dT - V.minGap), io[O.shift]));
  return io;
}

// 論理の間合いと弧の内の相手か（踏み込むか）。lx・lz は相手の論理の位置（攻め手が判定の始めに立つ位置からの局所）
export function lungeInReach(move, foeRadius, lx, lz) {
  const d = Math.sqrt(lx * lx + lz * lz);
  if (!(d <= move.reach + foeRadius + LUNGE_VIEW.reachSlack)) return false;
  return d < 1e-6 || Math.abs(Math.atan2(lx, lz)) <= move.arcDeg * DEG / 2 + LUNGE_VIEW.arcSlack;
}

const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
// 曲線 ease に沿って u0→u1 へ進むとき、残りの差のうち、このコマで詰める割合（u1≥1 で1）。望みが途中で変わっても、なめらかに寄る
export function easeShare(u0, u1) {
  const e0 = ease(u0);
  return e0 >= 1 ? 1 : Math.max(0, Math.min(1, (ease(u1) - e0) / (1 - e0)));
}
// このコマで、望みへ寄せる割合。望みは、判定の終わりまでは相手へ、それ以降は0（元の位置）。t0→t1 は技の開始からの秒（前のコマ→このコマ）。
// 予備：判定の始め（＝接触）でちょうど望みに着く。判定：望みのまま。戻り：判定の終わりから returnTime（戻りの returnShare まで）で0へ。
// 技が無い（move=null：弾かれた・中断した・技の外）：settle の速さで0へ。
export function lungeShare(move, t0, t1, dt) {
  if (!move) return 1 - Math.exp(-LUNGE_VIEW.settle * Math.max(0, dt));
  const W = move.windup, A = move.active;
  if (t1 < W) return easeShare(t0 / W, t1 / W);
  if (t1 <= W + A) return 1;
  const R = Math.max(1e-3, Math.min(LUNGE_VIEW.returnTime, move.recover * LUNGE_VIEW.returnShare));
  return easeShare(Math.max(0, t0 - W - A) / R, (t1 - W - A) / R);
}

// 見た目の中心（p＋λ·s）が、ほかの人の見た目の中心 o から gap 以上離れる、最大の λ（0〜1）。初めから近すぎれば0。
export function gapScale(px, pz, sx, sz, ox, oz, gap) {
  const dx = px - ox, dz = pz - oz, ss = sx * sx + sz * sz, c = dx * dx + dz * dz - gap * gap;
  if (c <= 0) return (dx + sx) * (dx + sx) + (dz + sz) * (dz + sz) >= dx * dx + dz * dz ? 1 : 0;   // もう近い：離れる向きだけ許す
  if (!(ss > 1e-12)) return 1;
  const b = dx * sx + dz * sz, disc = b * b - ss * c;
  if (disc < 0) return 1;
  const l = (-b - Math.sqrt(disc)) / ss;
  return l >= 0 && l < 1 ? l : 1;
}
