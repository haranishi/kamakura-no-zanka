// slash-trail.js — 刃の軌跡（斬撃の帯）の純粋な部分（8.3a・R18.2）。Three.js・DOM・乱数・時計に触れない。
// 見た目の結線（fx.js の SlashTrails）が、毎コマ、帯の両縁の世界位置（A＝内側の縁・B＝外側の縁）とゲーム内の時刻を渡す。
// ここは、帯ごとのサンプルの保持（環状の配列）・寿命・時刻を使った曲線での補間・頂点の並べ方だけを決める。
// 配列はすべて作るときに確保し、毎コマは書き込むだけ（新規確保なし）。時刻はゲーム内の秒なので、命中の停止中は帯も止まる。
// 時刻は pool.clock[0]（呼ぶ側が毎コマ書く）から読む。数を関数の引数で渡すと、呼ぶたびに数の箱（16バイト）が作られたため。
// 第2周（2026-10-31）：帯は「刃の先の道に沿う細く明るい芯が、内側と後ろへ素早く消える弧」。乳白の板・縦の柱に見えた第1周の帯を作り直した。
//   当たり（接触）は判定の始めに来るので、帯は判定の0.08秒前（振り下ろしの入り）〜判定の終わりまで。戻りには足さず、閉じたら0.05秒で消す。

export const TRAIL = Object.freeze({
  maxTrails: 6,       // 同時に出す帯の上限。超えたら、いちばん古い帯を譲る
  maxSamples: 16,     // 1本が持つサンプルの上限（寿命0.11秒×120コマ/秒＝14。minGap で毎秒120より多くは足さない）
  subdiv: 4,          // サンプルのあいだを曲線で割る数（切先は1コマで0.4〜0.8m動くので、折れ線に見せない）
  lead: 0.08,         // 判定の開始（＝接触）の何秒前から出すか。振り下ろしの入りの弧を、停止のコマに残す
  minGap: 1 / 120,    // 前のサンプルからこれより短い時刻（ゲーム内の秒）なら、先頭の位置だけを置き換える
  jumpSpeed: 60,      // 縁がこの速さ（m/秒。実測の切先の最大は約47）×経過秒＋jumpSlack より動いたら、帯を切る（瞬間移動・やり直し）
  jumpSlack: 0.3,     //   遊びは1コマを最大0.05秒で進めるので、切先が1コマに2m以上動くことがある。距離だけの閾値にしない
  maxLife: 0.11,      // 寿命の上限（秒）
  maxWidth: 0.24,     // 帯の幅（刃の上の長さ）の上限（m）。fx.js の sample が trailEdges で守る
  maxLength: 0.8,     // 帯の長さ（切先の道のり、先頭から）の上限（m）。後ろ半分で薄れて消える。縦の斬りが画面の上から地面までの線・柱にならない
  closeFade: 0.05,    // 閉じた帯（技が判定を抜けた・中断した）が消えるまでの秒。戻りの間に帯を残さない
  streak: Object.freeze({ k: 0.03, min: 0.14, max: 0.42, width: 0.024 }),   // 突きの光の線：長さ＝切先の速さ×k（m）、根元の幅（m）
});
// 頂点・添字の上限（帯の数×曲線の点の数×2 ＋ 突きの線（帯ごとに4頂点・6添字））
export const TRAIL_POINTS = (TRAIL.maxSamples - 1) * TRAIL.subdiv + 1;
export const TRAIL_VERTS = TRAIL.maxTrails * (TRAIL_POINTS * 2 + 4);
export const TRAIL_INDICES = TRAIL.maxTrails * ((TRAIL_POINTS - 1) * 6 + 6);

// 色は線形の値（後処理で階調を付ける前）。芯は白（1を少し超えて、わずかににじむ）、尾は青白。強い技は尾に朱。
// 予兆の光（battle.js の金色・赤＞緑＞青）と取り違えないよう、帯の色は青を赤以上にする（朱の尾だけが例外で、そこは古く薄い所）。
// 色は Float64Array にそろえる：凍らせた配列とふつうの配列が同じ読み出しの場所に混ざると、数の箱が毎コマ作られた
// （主人公と敵の帯が同時にあると、第1周の形で68バイト/コマ）。帯の見た目の物も、すべて同じ並びの性質を持たせる（streak も）。
const WHITE = [1, 1, 1], AO = [0.62, 0.76, 1.0], SHU = [0.86, 0.24, 0.12];
const scale = (c, k = 1) => Float64Array.from(c, x => x * k);
// 見た目：刃の inner〜outer（根元0・切先1）の帯。life 秒で薄れる。alpha は最も濃い所。
// taper は尾の細り（0〜1）、pivot は尾がどちらの縁へ細るか（1＝外側の縁＝切先の道）。head→tail は新しい所→古い所の色。
// speed は濃さの付き方（外側の縁の、刃に直交する速さ m/秒が lo で0、hi で最大）。刃が自分の軸に沿って動く（突き・戻りの引き）ときは描かない（縦の柱を防ぐ）。
// streak は突き：切先の前に、刃の軸の向きへ短い光の線を出す。
export const TRAIL_STYLES = Object.freeze({
  light: Object.freeze({ life: 0.09, alpha: 0.8, inner: 0.68, outer: 1, taper: 0.8, pivot: 1, speed: scale([5, 16]), head: scale(WHITE, 1.15), tail: scale(AO), streak: false }),
  light3: Object.freeze({ life: 0.11, alpha: 0.9, inner: 0.6, outer: 1, taper: 0.75, pivot: 1, speed: scale([5, 16]), head: scale(WHITE, 1.3), tail: scale(SHU), streak: false }),
  heavy: Object.freeze({ life: 0.11, alpha: 0.92, inner: 0.6, outer: 1, taper: 0.75, pivot: 1, speed: scale([5, 16]), head: scale(WHITE, 1.35), tail: scale(SHU), streak: false }),
  enemy: Object.freeze({ life: 0.07, alpha: 0.5, inner: 0.72, outer: 1, taper: 0.85, pivot: 1, speed: scale([5, 16]), head: scale(WHITE, 0.95), tail: scale(AO, 0.85), streak: false }),
  enemyHeavy: Object.freeze({ life: 0.08, alpha: 0.58, inner: 0.68, outer: 1, taper: 0.8, pivot: 1, speed: scale([5, 16]), head: scale(WHITE, 1.0), tail: scale(AO, 0.85), streak: false }),
  enemyThrust: Object.freeze({ life: 0.07, alpha: 0.7, inner: 0.8, outer: 1, taper: 0.85, pivot: 1, speed: scale([4, 12]), head: scale(WHITE, 1.05), tail: scale(AO, 0.85), streak: true }),
});
// 技 → 帯の見た目。主人公（と味方）の技と、敵の技で分ける。弓は出さない。stealth は闇討ち（技ではなく、演出の別の時間割）。
const HERO = Object.freeze({ light1: 'light', light2: 'light', counter: 'light', light3: 'light3', heavy: 'heavy', finisher: 'heavy', stealth: 'heavy' });
const ENEMY = Object.freeze({ soldier_slash: 'enemy', soldier_thrust: 'enemyThrust', officer_a: 'enemy', officer_b: 'enemy', officer_c: 'enemyHeavy' });
export function trailStyleFor(moveId, team) {
  const key = (team === 'enemy' ? ENEMY : HERO)[moveId];
  return key ? TRAIL_STYLES[key] : null;
}
// 帯を出す区間（技の開始からの秒）。接触（判定の始め）の少し前から、判定の終わりまで。戻りには出さない。
export function trailWindow({ windup, active }) { return { start: windup - TRAIL.lead, end: windup + active }; }
export function inTrailWindow({ windup, active }, t) {   // 毎コマ呼ぶので、区間の物を作らずに比べる
  return Number.isFinite(t) && t >= windup - TRAIL.lead - 1e-9 && t <= windup + active + 1e-9;
}
// 帯の両縁の、刀の枠の y（握りが0・刃は root〜tip）。幅は maxWidth まで（長い刃・低い inner でも、刃の先の細い弧にとどめる）。
export function trailEdges(style, root, tip, out) {
  const len = tip - root, y1 = root + len * style.outer;
  out[0] = Math.max(root + len * style.inner, y1 - TRAIL.maxWidth); out[1] = y1;
  return out;
}

export function createTrailPool({ maxTrails = TRAIL.maxTrails, maxSamples = TRAIL.maxSamples } = {}) {
  const n = maxTrails * maxSamples;
  return {
    maxTrails, maxSamples,
    owner: new Array(maxTrails).fill(null), style: new Array(maxTrails).fill(null),
    count: new Int32Array(maxTrails), head: new Int32Array(maxTrails), open: new Uint8Array(maxTrails), touched: new Uint8Array(maxTrails),
    born: new Float64Array(maxTrails), closedAt: new Float64Array(maxTrails),
    time: new Float64Array(n), a: new Float32Array(n * 3), b: new Float32Array(n * 3), speed: new Float32Array(n), tipSpeed: new Float32Array(n),
    path: new Float64Array(maxSamples),                             // 先頭からの切先の道のり（作り直すたびに書く作業用）
    tanA: new Float64Array(n * 3), tanB: new Float64Array(n * 3),   // 曲線の接線（作り直すたびに書く作業用）
    clock: new Float64Array(1), camera: new Float64Array(3),       // 時刻と、カメラの位置（突きの線をカメラへ向ける。呼ぶ側が毎コマ書く）
    stats: { opened: 0, stolen: 0, cuts: 0 },
  };
}
// 時刻（ゲーム内の秒）を合わせる。毎コマの結線は pool.clock[0] へ直接書いてよい
export function setTrailTime(pool, now) { pool.clock[0] = now; }

// Math.hypot は引数の数が決まらない組み込みで、呼ぶたびに数の箱が作られたので、平方根で書く
const dist = (x, y, z) => Math.sqrt(x * x + y * y + z * z);
function reset(pool, i) { pool.count[i] = 0; pool.head[i] = 0; pool.open[i] = 0; pool.touched[i] = 0; pool.owner[i] = null; pool.style[i] = null; }
export function clearTrails(pool) { for (let i = 0; i < pool.maxTrails; i++) reset(pool, i); }

// owner が出している途中の帯（閉じた帯は使わない。間が空いたら別の帯にして、空白を直線でつながない）。無ければ -1。
export function openSlotOf(pool, owner) {
  for (let i = 0; i < pool.maxTrails; i++) if (pool.open[i] && pool.owner[i] === owner) return i;
  return -1;
}

// 新しい帯の枠を取る。空き → 閉じた帯のいちばん古いもの → 出している途中の帯のいちばん古いもの、の順に譲ってもらう。
export function openTrail(pool, owner, style) {
  let pick = -1;
  for (let i = 0; i < pool.maxTrails && pick < 0; i++) if (!pool.open[i] && pool.count[i] === 0) pick = i;
  for (let wantOpen = 0; wantOpen <= 1 && pick < 0; wantOpen++) {
    for (let i = 0; i < pool.maxTrails; i++) if (pool.open[i] === wantOpen && (pick < 0 || pool.born[i] < pool.born[pick])) pick = i;
    if (pick >= 0) pool.stats.stolen++;
  }
  reset(pool, pick);
  pool.owner[pick] = owner; pool.style[pick] = style; pool.open[pick] = 1; pool.born[pick] = pool.clock[0];
  pool.stats.opened++;
  return pick;
}

// サンプルを1つ足す（owner の帯が無ければ開く）。p は帯の両縁の世界位置 [A.x, A.y, A.z, B.x, B.y, B.z]（作業用の配列を使い回す。
// 座標を6つの数の引数で渡すと、呼ぶたびに数の箱が作られた）。戻りは帯の番号。
export function addSample(pool, owner, style, p) {
  const ax = p[0], ay = p[1], az = p[2], bx = p[3], by = p[4], bz = p[5], now = pool.clock[0];
  let i = openSlotOf(pool, owner);
  if (i < 0) i = openTrail(pool, owner, style);
  pool.touched[i] = 1;
  const S = pool.maxSamples, base = i * S, A = pool.a, B = pool.b;
  if (pool.count[i] > 0) {
    const h = (base + pool.head[i]) * 3, dt = now - pool.time[base + pool.head[i]], limit = TRAIL.jumpSpeed * Math.max(dt, 1 / 60) + TRAIL.jumpSlack;
    const da = dist(ax - A[h], ay - A[h + 1], az - A[h + 2]), db = dist(bx - B[h], by - B[h + 1], bz - B[h + 2]);
    if (!(dt >= 0 && da <= limit && db <= limit)) { pool.count[i] = 0; pool.stats.cuts++; }   // 瞬間移動・時刻の巻き戻し：引き伸ばさずに切る（NaNも切る）
    else if (dt < TRAIL.minGap) {                                                              // 近すぎる：先頭の位置だけ新しくする（時刻はそのまま）
      A[h] = ax; A[h + 1] = ay; A[h + 2] = az; B[h] = bx; B[h + 1] = by; B[h + 2] = bz;
      return i;
    }
  }
  const was = pool.count[i] > 0 ? base + pool.head[i] : -1;
  const head = pool.count[i] === 0 ? 0 : (pool.head[i] + 1) % S, k = (base + head) * 3;
  pool.head[i] = head; pool.count[i] = Math.min(pool.count[i] + 1, S); pool.time[base + head] = now;
  A[k] = ax; A[k + 1] = ay; A[k + 2] = az; B[k] = bx; B[k + 1] = by; B[k + 2] = bz;
  // 外側の縁の速さ（前のサンプルから）。濃さは、刃の軸に直交する成分で付ける（刃が軸に沿って動くと、帯が縦の柱になる）。最初のサンプルは0
  if (was < 0) { pool.speed[base + head] = 0; pool.tipSpeed[base + head] = 0; return i; }
  const dt = Math.max(1e-6, now - pool.time[was]), w = was * 3;
  const mx = bx - B[w], my = by - B[w + 1], mz = bz - B[w + 2];
  let ux = bx - ax, uy = by - ay, uz = bz - az; const ul = dist(ux, uy, uz) || 1; ux /= ul; uy /= ul; uz /= ul;
  const along = mx * ux + my * uy + mz * uz;
  pool.speed[base + head] = dist(mx - along * ux, my - along * uy, mz - along * uz) / dt;
  pool.tipSpeed[base + head] = dist(mx, my, mz) / dt;
  return i;
}
// 先頭からの道のり → 濃さ（0〜1）。maxLength の半分までは1、そこから maxLength で0へ
export function lengthWeight(d) {
  const x = Math.min(1, Math.max(0, (d - TRAIL.maxLength * 0.5) / (TRAIL.maxLength * 0.5)));
  return 1 - x * x * (3 - 2 * x);
}
// 速さ → 濃さ（0〜1）。lo〜hi のなめらかな段
export function speedWeight(style, speed) {
  const lo = style.speed[0], hi = style.speed[1], x = Math.min(1, Math.max(0, (speed - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
}

// このコマにサンプルを足さなかった帯を閉じる（技が判定を抜けた・中断した・死んだ・刀が見えない）。毎コマ1回、足し終えたあとに呼ぶ。
export function closeUntouched(pool) {
  for (let i = 0; i < pool.maxTrails; i++) {
    if (!pool.touched[i] && pool.open[i]) { pool.open[i] = 0; pool.closedAt[i] = pool.clock[0]; }
    pool.touched[i] = 0;
  }
}
// 閉じた帯の残りの濃さ（1→0、closeFade 秒で）。出している途中の帯は1
export function closeFade(pool, i) {
  return pool.open[i] ? 1 : Math.max(0, 1 - (pool.clock[0] - pool.closedAt[i]) / TRAIL.closeFade);
}

// 寿命を過ぎたサンプルを尾から捨てる。尾のすぐ内側のサンプルまで寿命を過ぎたら捨てる（尾は透明へ向かって薄れて消える）。
// 閉じていて、描ける2点が残っていない・寿命を過ぎた・閉じてから消えきった帯は空きにする。
export function pruneTrails(pool) {
  const S = pool.maxSamples, now = pool.clock[0];
  for (let i = 0; i < pool.maxTrails; i++) {
    const style = pool.style[i];
    if (!style) continue;
    while (pool.count[i] >= 2) {
      const second = i * S + (pool.head[i] - pool.count[i] + 2 + S * 2) % S;
      if (now - pool.time[second] > style.life) pool.count[i]--; else break;
    }
    if (!pool.open[i] && (pool.count[i] < 2 || now - pool.time[i * S + pool.head[i]] > style.life || now - pool.closedAt[i] >= TRAIL.closeFade)) reset(pool, i);
  }
}

// 帯の外側の縁（切先側）の、最新の速度（m/秒）を out へ。弾きの火花の向きに使う。owner の帯が複数あれば、出している途中の帯・新しい帯を使う。無ければ false。
export function trailVelocity(pool, owner, out) {
  let pick = -1;
  for (let i = 0; i < pool.maxTrails; i++) {
    if (pool.owner[i] !== owner || pool.count[i] < 2) continue;
    if (pick < 0 || pool.open[i] > pool.open[pick] || (pool.open[i] === pool.open[pick] && pool.born[i] > pool.born[pick])) pick = i;
  }
  if (pick < 0) return false;
  const S = pool.maxSamples, h = pick * S + pool.head[pick], p = pick * S + (pool.head[pick] - 1 + S) % S, dt = pool.time[h] - pool.time[p];
  if (!(dt > 0)) return false;
  for (let c = 0; c < 3; c++) out[c] = (pool.b[h * 3 + c] - pool.b[p * 3 + c]) / dt;
  return true;
}

// 曲線の接線（m/秒）を、帯 i のサンプルごとに dst（tanA・tanB）へ書く。内側は前後のサンプルの差を時刻で割り、
// 両端は隣の2点を使う2次式の傾き（Lagrange）にする（片側の差だと、帯の先頭＝刃に接する所で弧が弦へ寄った）。2点だけなら直線。
// 数を返す関数を内側の繰り返しで呼ぶと、呼ぶたびに数の箱が作られたので、配列へ書くだけにする。
function tangents(pool, i, arr, dst) {
  const S = pool.maxSamples, base = i * S, count = pool.count[i], oldest = pool.head[i] - count + 1 + S * 2, T = pool.time;
  for (let j = 0; j < count; j++) {
    const at = base + (oldest + j) % S;
    if (count === 2) {
      const a = base + oldest % S, b = base + (oldest + 1) % S, dt = Math.max(1e-6, T[b] - T[a]);
      for (let c = 0; c < 3; c++) dst[at * 3 + c] = (arr[b * 3 + c] - arr[a * 3 + c]) / dt;
    } else if (j === 0 || j === count - 1) {
      const first = j === 0, a = base + (oldest + (first ? 0 : count - 3)) % S, b = base + (oldest + (first ? 1 : count - 2)) % S, c3 = base + (oldest + (first ? 2 : count - 1)) % S;
      const ta = T[a], tb = T[b], tc = T[c3], dab = ta - tb, dac = ta - tc, dbc = tb - tc;
      for (let c = 0; c < 3; c++) {
        const pa = arr[a * 3 + c], pb = arr[b * 3 + c], pc = arr[c3 * 3 + c];
        dst[at * 3 + c] = !(Math.abs(dab) > 1e-9 && Math.abs(dac) > 1e-9 && Math.abs(dbc) > 1e-9) ? (pc - pa) / Math.max(1e-6, tc - ta)
          : first ? pa * (2 * ta - tb - tc) / (dab * dac) + pb * dac / (-dab * dbc) + pc * dab / (dac * dbc)
            : pa * -dbc / (dab * dac) + pb * -dac / (-dab * dbc) + pc * (2 * tc - ta - tb) / (dac * dbc);
      }
    } else {
      const a = base + (oldest + j - 1) % S, b = base + (oldest + j + 1) % S, dt = Math.max(1e-6, T[b] - T[a]);
      for (let c = 0; c < 3; c++) dst[at * 3 + c] = (arr[b * 3 + c] - arr[a * 3 + c]) / dt;
    }
  }
}

// 頂点を並べる。out = { position: Float32Array(V*3), uv: Float32Array(V*2), color: Float32Array(V*4), index: Uint16Array(I) }。
// 1点につき2頂点（内側の縁 v=0・外側の縁 v=1）。uv の x は年齢（0＝新しい→1＝寿命）。
// 時刻を使った3次エルミート補間（接線を時刻で割るので、サンプルの時刻の間隔がそろわなくても行き過ぎない）。
// 尾は taper だけ pivot の縁へ細る（先が細い帯）。閉じた帯は closeFade で薄れる。先頭から maxLength を超える所は消す（後ろ半分で薄れる）。
// 突き（streak）は、先頭の切先から刃の軸の向きへ光の線（4頂点）を足す。根元は芯の白、先は細く薄れる。カメラへ面を向ける。
// 使った頂点と添字の数を out.vertices・out.indices に書き、添字の数を返す（新しい物を作らない）。
// 数を返す関数・数を引数に取る関数を、ここ（毎コマ）で呼ぶと数の箱が作られたので、薄れ・長さ・線は式をその場に書く。
export function buildRibbon(pool, out) {
  const S = pool.maxSamples, sub = TRAIL.subdiv, T = pool.time, A = pool.a, B = pool.b, MA = pool.tanA, MB = pool.tanB, now = pool.clock[0];
  const P = out.position, U = out.uv, C = out.color, I = out.index;
  let v = 0, n = 0;
  for (let i = 0; i < pool.maxTrails; i++) {
    const count = pool.count[i], style = pool.style[i];
    if (count < 2 || !style) continue;
    const fade = pool.open[i] ? 1 : Math.max(0, 1 - (now - pool.closedAt[i]) / TRAIL.closeFade);
    if (!(fade > 0)) continue;
    tangents(pool, i, A, MA); tangents(pool, i, B, MB);
    const first = v / 2, base = i * S, oldest = pool.head[i] - count + 1 + S * 2, L = pool.path;
    const life = Math.max(1e-3, style.life), pivot = style.pivot, taper = style.taper, W = pool.speed;
    L[count - 1] = 0;                                               // 先頭（新しい）からの切先の道のり（サンプルの間は弦で近似）
    for (let j = count - 2; j >= 0; j--) {
      const j1 = (base + (oldest + j) % S) * 3, j2 = (base + (oldest + j + 1) % S) * 3;
      L[j] = L[j + 1] + dist(B[j2] - B[j1], B[j2 + 1] - B[j1 + 1], B[j2 + 2] - B[j1 + 2]);
    }
    for (let j = 0; j < count - 1; j++) {
      const j1 = base + (oldest + j) % S, j2 = base + (oldest + j + 1) % S, h = T[j2] - T[j1];
      const w1 = speedWeight(style, W[j1]), w2 = speedWeight(style, W[j2]), d1 = L[j], d2 = L[j + 1], half = TRAIL.maxLength * 0.5;
      for (let q = 0, last = j === count - 2 ? sub : sub - 1; q <= last; q++) {
        const s = q / sub, t = T[j1] + h * s, s2 = s * s, s3 = s2 * s;
        const h00 = 2 * s3 - 3 * s2 + 1, h10 = (s3 - 2 * s2 + s) * h, h01 = -2 * s3 + 3 * s2, h11 = (s3 - s2) * h;
        const age = Math.min(1, Math.max(0, (now - t) / life)), k = taper * Math.pow(age, 1.5);
        for (let c = 0; c < 3; c++) {
          const x1 = j1 * 3 + c, x2 = j2 * 3 + c;
          const a = h00 * A[x1] + h10 * MA[x1] + h01 * A[x2] + h11 * MA[x2], b = h00 * B[x1] + h10 * MB[x1] + h01 * B[x2] + h11 * MB[x2], mid = a + (b - a) * pivot;
          P[v * 3 + c] = a + (mid - a) * k; P[v * 3 + 3 + c] = b + (mid - b) * k;
          const col = style.head[c] + (style.tail[c] - style.head[c]) * age;
          C[v * 4 + c] = col; C[v * 4 + 4 + c] = col;
        }
        const x = Math.min(1, Math.max(0, (d1 + (d2 - d1) * s - half) / half));   // 先頭からの道のりの濃さ（lengthWeight と同じ式）
        C[v * 4 + 3] = C[v * 4 + 7] = style.alpha * fade * (w1 + (w2 - w1) * s) * (1 - x * x * (3 - 2 * x));
        U[v * 2] = U[v * 2 + 2] = age; U[v * 2 + 1] = 0; U[v * 2 + 3] = 1;
        v += 2;
      }
    }
    for (let p = first, end = v / 2 - 1; p < end; p++) {
      const a = p * 2;
      I[n++] = a; I[n++] = a + 1; I[n++] = a + 2;
      I[n++] = a + 1; I[n++] = a + 3; I[n++] = a + 2;
    }
    if (style.streak) {
      const h = base + pool.head[i], age = Math.min(1, Math.max(0, (now - T[h]) / life)), w = speedWeight(style, pool.tipSpeed[h]) * fade * (1 - age);
      if (w > 0.01) {
        const bx = B[h * 3], by = B[h * 3 + 1], bz = B[h * 3 + 2], ex = bx - A[h * 3], ey = by - A[h * 3 + 1], ez = bz - A[h * 3 + 2];
        const dl = dist(ex, ey, ez) || 1, dx = ex / dl, dy = ey / dl, dz = ez / dl;   // 書き直す変数（let）の数は箱になったので、const で書く
        const len = Math.min(TRAIL.streak.max, Math.max(TRAIL.streak.min, pool.tipSpeed[h] * TRAIL.streak.k));
        const cx = pool.camera[0] - bx, cy = pool.camera[1] - by, cz = pool.camera[2] - bz;
        const qx = dy * cz - dz * cy, qy = dz * cx - dx * cz, qz = dx * cy - dy * cx, sl = dist(qx, qy, qz) || 1, sx = qx / sl, sy = qy / sl, sz = qz / sl;
        for (let e = 0; e < 4; e++) {                                 // 0,1＝切先の両側／2,3＝線の先の両側
          const far = e >= 2 ? 1 : 0, side = e % 2 ? 1 : -1, wide = (far ? 0.15 : 1) * TRAIL.streak.width * side, k = (v + e) * 3;
          P[k] = bx + dx * len * far + sx * wide; P[k + 1] = by + dy * len * far + sy * wide; P[k + 2] = bz + dz * len * far + sz * wide;
          U[(v + e) * 2] = far ? 0.75 : age; U[(v + e) * 2 + 1] = 1;
          for (let c = 0; c < 3; c++) C[(v + e) * 4 + c] = style.head[c];
          C[(v + e) * 4 + 3] = style.alpha * w;
        }
        I[n++] = v; I[n++] = v + 1; I[n++] = v + 2; I[n++] = v + 1; I[n++] = v + 3; I[n++] = v + 2;
        v += 4;
      }
    }
  }
  out.vertices = v; out.indices = n;
  return n;
}

export function trailStats(pool) {
  let active = 0, open = 0, samples = 0;
  for (let i = 0; i < pool.maxTrails; i++) { if (pool.count[i] > 0) active++; if (pool.open[i]) open++; samples += pool.count[i]; }
  return { active, open, samples, ...pool.stats };
}
