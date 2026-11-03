// arm-spread.js — 被弾・弾かれ・倒れの間だけ、腕が胴から開きすぎないように寄せる（8.3b・見た目だけ・純粋）。
// 開き＝腕全体（肩→手首）と、胴の下向き（首→腰）のなす角。0度＝体の横に下がる、90度＝水平、180度＝頭の上。
// 焼き込んだ動作（dying_backwards・Hit_Reaction_1・Hit_Reaction_to_Waist）は、腕を水平より上へ広げたまま倒れる・跳ね上げる（実測は design-combat-pose.md）。
// 規則・論理の位置・時間には触れない。結線は characters.js（骨を回す）と actors.js（状態から上限を選ぶ）。Three.js・DOM・乱数・時計に触れない。

// cap：開きの上限（度）。rate：上限の効き（0〜1）を追う速さ（1/秒）。
// dead 40度：倒れる間は体の横〜斜め下まで（55度では、真横のカメラで腕が前へ突き出たままに見えた）
export const SPREAD = { dead: 40, rate: 18 };

// 人物の状態から、開きの上限（度）を返す。上限をかけない状態は 0。毎コマ全員に呼ぶので、引数は物にしない（新規確保をしない）。
// dead：倒れた
export function spreadCap(dead = false) {
  if (dead) return SPREAD.dead;
  return 0;
}

// 効き w を、上限をかける間は1へ、外したら0へ、指数で追う（動作の切り替えで腕が1コマで跳ばないように）。
export function spreadWeight(w, on, dt) {
  if (!(dt > 0)) return w;
  const k = 1 - Math.exp(-SPREAD.rate * dt);
  return w + ((on ? 1 : 0) - w) * k;
}

// 腕（ax,ay,az）を胴の下向き（dx,dy,dz）へ寄せる回転を、out に書く（毎コマの新規確保をしない）。
// out[0..2]＝回す軸（単位・世界）、out[3]＝回す角（ラジアン・腕を下向きへ近づける向きが正）。上限の内・向きが決まらないときは角0。
// 回すのは「腕と下向きを含む面」の中だけ（横へ広げた腕は体の横へ、前へ上げた腕は前の下へ下ろす）。
export function spreadFix(ax, ay, az, dx, dy, dz, capDeg, weight, out) {
  out[0] = 0; out[1] = 0; out[2] = 0; out[3] = 0;
  const la = Math.hypot(ax, ay, az), ld = Math.hypot(dx, dy, dz);
  if (!(capDeg > 0) || !(weight > 0) || !(la > 1e-9) || !(ld > 1e-9)) return out;
  const c = (ax * dx + ay * dy + az * dz) / (la * ld), theta = Math.acos(Math.max(-1, Math.min(1, c)));
  const over = theta - capDeg * Math.PI / 180;
  if (!(over > 0)) return out;
  // 軸＝腕×下向き（この軸まわりに正に回すと、腕が下向きへ近づく）
  const cx = ay * dz - az * dy, cy = az * dx - ax * dz, cz = ax * dy - ay * dx, lc = Math.hypot(cx, cy, cz);
  if (!(lc > 1e-6 * la * ld)) return out;   // 腕が胴の軸とほぼ平行（真上・真下）：向きが決まらない
  out[0] = cx / lc; out[1] = cy / lc; out[2] = cz / lc; out[3] = over * Math.min(1, weight);
  return out;
}
