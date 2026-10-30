import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseGlb, decodedAccessor } from '../tools/lib/glb.mjs';
import { solveTwoBone } from '../dist/valley/arm-ik.js';
import {
  HAND, FIT, FINGERS, DIGIT_KEYS, measureHand, palmCoords, boneLayout, fingerShares, splitHandWeight, quantizeInfluences, wrapAngles, solveTwoBoneInto,
  rollWithinReach, thumbAxis, poseDigits, skinDigits, cylinderDistance, fitGrip, gripExtent, groupName,
} from '../dist/valley/hand-grip.js';

const close = (a, b, e = 1e-9, msg = '') => assert.ok(Math.abs(a - b) <= e, `${msg} ${a} != ${b}`);
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

// 出荷している人物GLBから、手の骨の局所（結合姿勢）の頂点と手の重みを取り出す（メッシュの節点は単位行列＝結合行列も単位）
const cache = new Map();
function handOf(who, side) {
  const key = who + side;
  if (cache.has(key)) return cache.get(key);
  const doc = parseGlb(fs.readFileSync(new URL(`../dist/assets/characters/${who}.glb`, import.meta.url)));
  const j = doc.json, skin = j.skins[0], names = skin.joints.map(i => j.nodes[i].name), h = names.indexOf(side + 'Hand');
  const ibm = decodedAccessor(doc, skin.inverseBindMatrices).array, o = h * 16, prim = j.meshes[0].primitives[0];
  const P = decodedAccessor(doc, prim.attributes.POSITION).array, J = decodedAccessor(doc, prim.attributes.JOINTS_0).array, W = decodedAccessor(doc, prim.attributes.WEIGHTS_0).array;
  const mul = (x, y, z) => [ibm[o] * x + ibm[o + 4] * y + ibm[o + 8] * z + ibm[o + 12], ibm[o + 1] * x + ibm[o + 5] * y + ibm[o + 9] * z + ibm[o + 13], ibm[o + 2] * x + ibm[o + 6] * y + ibm[o + 10] * z + ibm[o + 14]];
  const points = [], weights = [];
  for (let v = 0; v < P.length / 3; v++) {
    let w = 0; for (let k = 0; k < 4; k++) if (J[v * 4 + k] === h) w += W[v * 4 + k];
    if (w > 0) { points.push(mul(P[v * 3], P[v * 3 + 1], P[v * 3 + 2])); weights.push(w); }
  }
  const down = [-ibm[o + 4], -ibm[o + 5], -ibm[o + 6]], dl = Math.hypot(...down);   // 結合姿勢の「下」（0,-1,0）を手の局所へ
  const m = measureHand(points, weights, { down: down.map(x => x / dl), side });
  const out = { points, weights, m, down: down.map(x => x / dl) };
  cache.set(key, out);
  return out;
}
const HANDS = [['hero', 'Right'], ['hero', 'Left'], ['soldier', 'Right'], ['soldier', 'Left'], ['officer', 'Right'], ['officer', 'Left']];

test('実際の手：手のひらは結合姿勢の下、親指の側は手の向きの決まりと出っ張りが一致し、座標は直交する', () => {
  for (const [who, side] of HANDS) {
    const { m, down } = handOf(who, side);
    assert.ok(m.thumbAgrees, `${who} ${side}: 親指の出っ張りが w の正の側にない`);
    assert.ok(dot(m.n, down) > 0.5, `${who} ${side}: 手のひらが下でない`);
    for (const [a, b] of [[m.w, m.f], [m.f, m.n], [m.n, m.w]]) close(dot(a, b), 0, 1e-12);
    for (const v of [m.w, m.f, m.n]) close(Math.hypot(...v), 1, 1e-12);
    const hand = dot(cross(m.w, m.f), m.n);
    assert.ok(side === 'Right' ? hand > 0.99 : hand < -0.99, `${who} ${side}: 左右の向きの決まり`);
    assert.ok(m.joints[0].f < m.joints[1].f && m.joints[1].f < m.joints[2].f && m.joints[2].f < m.tipF, '関節の順');
    assert.ok(m.wHi - m.wLo > 0.05 && m.wHi - m.wLo < 0.11, `${who} ${side}: 指の板の幅 ${m.wHi - m.wLo}`);
  }
  // 手のひらの向きは down で決まる（逆の down を与えれば、n も逆）
  const { points, weights, down } = handOf('hero', 'Right');
  const flipped = measureHand(points, weights, { down: down.map(x => -x), side: 'Right' });
  assert.ok(dot(flipped.n, down) < -0.5, 'down を逆にしても手のひらの向きが変わらない');
});

test('重みの分け方は、どの頂点でも0以上・合計1で、指先・手首・親指の先が正しい骨へ行き、指はその横の位置の指へ行く', () => {
  for (const [who, side] of HANDS) {
    const { points, m } = handOf(who, side);
    let tip = null, wrist = null, thumb = null;
    for (const p of points) {
      const s = splitHandWeight(m, p), vals = Object.values(s);
      assert.deepEqual(Object.keys(s).sort(), ['palm', ...DIGIT_KEYS].sort());
      assert.ok(vals.every(x => x >= -1e-12), `${who} ${side}: 負の重み ${JSON.stringify(s)}`);
      close(vals.reduce((a, b) => a + b, 0), 1, 1e-9, '合計');
      const q = palmCoords(m, p);
      if (!tip || q[1] > tip.q[1]) tip = { q, s };
      if (!wrist || q[1] < wrist.q[1]) wrist = { q, s };
      if (q[1] > 0.3 * m.tipF && q[1] < 0.8 * m.tipF && (!thumb || q[0] > thumb.q[0])) thumb = { q, s };
      // 指の板の中で、横の位置の4分の1（境から fingerBlend より離れた所）の頂点は、その指の骨だけへ行く
      const k = Math.floor((q[0] - m.wLo) / ((m.wHi - m.wLo) / FINGERS)), b0 = m.wLo + k * (m.wHi - m.wLo) / FINGERS;
      if (k >= 0 && k < FINGERS && q[0] - b0 > HAND.fingerBlend && b0 + (m.wHi - m.wLo) / FINGERS - q[0] > HAND.fingerBlend && s.t0 + s.t1 === 0)
        for (const key of DIGIT_KEYS) if (key[0] === 'f' && Number(key[1]) !== k) assert.equal(s[key], 0, `${who} ${side}: ${key} が別の指 ${k} の頂点を持つ`);
    }
    const tipShare = [0, 1, 2, 3].reduce((a, k) => a + tip.s['f' + k + '2'], 0);
    assert.ok(tipShare > 0.9, `${who} ${side}: 指先が先の節へ行かない ${JSON.stringify(tip.s)}`);
    assert.ok(wrist.s.palm > 0.99, `${who} ${side}: 手首が手のひらに残らない`);
    assert.ok(thumb.s.t1 > 0.5, `${who} ${side}: 親指の先が親指の先の節へ行かない ${JSON.stringify(thumb.s)}`);
  }
});

test('指への横の分け方は、合計1・0以上で、境の外は1本の指、境では隣の2本だけを混ぜる', () => {
  const { m } = handOf('hero', 'Right'), fw = (m.wHi - m.wLo) / FINGERS;
  for (let i = -20; i <= 220; i++) {
    const w = m.wLo + (m.wHi - m.wLo) * i / 200, s = fingerShares(m, w);
    assert.equal(s.length, FINGERS);
    assert.ok(s.every(x => x >= -1e-12), '負の分');
    close(s.reduce((a, b) => a + b, 0), 1, 1e-12, '合計');
    assert.ok(s.filter(x => x > 1e-12).length <= 2, '3本以上を混ぜる');
    const k = Math.max(0, Math.min(FINGERS - 1, Math.floor((w - m.wLo) / fw)));
    const edge = Math.min(Math.abs(w - (m.wLo + k * fw)), Math.abs(w - (m.wLo + (k + 1) * fw)));
    if (edge > HAND.fingerBlend || (k === 0 && w < m.wLo + fw - HAND.fingerBlend) || (k === FINGERS - 1 && w > m.wLo + k * fw + HAND.fingerBlend)) close(s[k], 1, 1e-12, `指 ${k} だけでない`);
  }
  // 境の真上は、隣の2本を半分ずつ
  for (let b = 1; b < FINGERS; b++) { const s = fingerShares(m, m.wLo + b * fw); close(s[b - 1], 0.5, 1e-12); close(s[b], 0.5, 1e-12); }
});

test('影響の量子化：4つまで・合計255・大きい順・同じ骨はまとめる・0は捨てる・同じ入力には同じ出力', () => {
  const q = quantizeInfluences([[3, 0.1], [7, 0.3], [3, 0.2], [9, 0.25], [1, 0.05], [2, 0.1], [5, 0]]);
  assert.equal(q.length, 4);
  assert.equal(q.reduce((s, [, w]) => s + w, 0), 255);
  assert.deepEqual(q.map(([b]) => b), [3, 7, 9, 2]);   // 3は0.3にまとまり、7と同じ重みは骨の番号の小さい順
  assert.deepEqual(q, quantizeInfluences([[3, 0.1], [7, 0.3], [3, 0.2], [9, 0.25], [1, 0.05], [2, 0.1], [5, 0]]));
  assert.deepEqual(quantizeInfluences([[7, 0.25], [3, 0.25], [9, 0.5]]).map(([b]) => b), [9, 3, 7]);   // 同じ重みは骨の番号の小さい順
  assert.deepEqual(quantizeInfluences([[4, 1]]), [[4, 255]]);
  assert.deepEqual(quantizeInfluences([[4, 0]]), []);
  for (let n = 0; n < 200; n++) {
    const list = Array.from({ length: 1 + (n % 7) }, (_, i) => [(n * 7 + i * 13) % 40, ((n * 31 + i * 17) % 97) / 97 + 1e-3]);
    const out = quantizeInfluences(list);
    assert.ok(out.length <= 4 && out.every(([, w]) => w > 0 && Number.isInteger(w)));
    assert.equal(out.reduce((s, [, w]) => s + w, 0), 255);
  }
});

test('配列を作らない二関節IKは、arm-ik.js の solveTwoBone と同じ答えを返す（格子・縮退）', () => {
  const out = { mid: [0, 0, 0], end: [0, 0, 0] }, cases = [];
  for (let x = -3; x <= 3; x++) for (let y = -3; y <= 3; y++) for (let z = -3; z <= 3; z++) cases.push({ root: [0.1, 0.2, -0.1], mid: [0.1, 0.408, -0.1], end: [0.322, 0.408, -0.1], target: [0.1 + x * 0.09, 0.2 + y * 0.09, -0.1 + z * 0.09], hint: [0.2, 0.5, 0.4] });
  cases.push({ root: [0, 0, 0], mid: [0, 0.2, 0], end: [0.2, 0.2, 0], target: [0, 0, 0], hint: [0, 0, 1] });
  cases.push({ root: [0, 0, 0], mid: [0.2, 0, 0], end: [0.4, 0, 0], target: [0.2, 0, 0], hint: [1, 0, 0] });
  cases.push({ root: [0, 0, 0], mid: [0, 0.2, 0], end: [0.2, 0.2, 0], target: [0.25, 0, 0], hint: [1, 0, 0] });
  for (const c of cases) {
    const a = solveTwoBone(c), b = solveTwoBoneInto(out, c.root, c.mid, c.end, c.target, c.hint);
    for (let k = 0; k < 3; k++) { close(b.mid[k], a.mid[k], 1e-12, 'mid'); close(b.end[k], a.end[k], 1e-12, 'end'); }
    assert.equal(b.reached, a.reached); close(b.error, a.error, 1e-12, 'error');
  }
});

test('柄のまわりの回りは、届くなら want のまま、届かなければ届く弧の端、どれも届かなければ最も近い向き', () => {
  const at = (w, phi) => [w[0] * Math.cos(phi) + w[2] * Math.sin(phi), w[1], -w[0] * Math.sin(phi) + w[2] * Math.cos(phi)];
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  for (let n = 0; n < 400; n++) {
    const w = [rnd() * 0.3 - 0.15, rnd() * 0.2 - 0.1, rnd() * 0.3 - 0.15], s = [rnd() * 0.8 - 0.4, rnd() * 0.8 - 0.4, rnd() * 0.8 - 0.4];
    const reach = 0.2 + rnd() * 0.4, want = rnd() * 6 - 3;
    const phi = rollWithinReach(...w, ...s, reach, want, 0);
    let any = false, bestD = Infinity, bestPhi = 0, bestGap = Infinity;
    for (let k = 0; k < 7200; k++) {
      const p = k / 7200 * 2 * Math.PI - Math.PI, d = dist(at(w, p), s);
      if (d < bestD) { bestD = d; bestPhi = p; }
      if (d <= reach) { any = true; let g = Math.abs(p - want); g = Math.min(g, 2 * Math.PI - (g % (2 * Math.PI))); bestGap = Math.min(bestGap, g % (2 * Math.PI)); }
    }
    const d = dist(at(w, phi), s);
    if (dist(at(w, want), s) <= reach) close(phi, want, 1e-12, '届くなら want');
    else if (any) { assert.ok(d <= reach + 1e-9, `届く弧の外 ${d} > ${reach}`); let g = Math.abs(phi - want) % (2 * Math.PI); g = Math.min(g, 2 * Math.PI - g); close(g, bestGap, 2e-3, '弧の端'); }
    else close(d, bestD, 1e-6, '最も近い向き');
  }
});

test('巻きつけの角は0〜上限に収まり、曲げた節の中心線は膨らませた円に接する', () => {
  const r = 0.0155, half = [0.008, 0.007, 0.006], lengths = [0.04, 0.025, 0.024], center = [-0.012, 0.03];
  const a = wrapAngles({ joint0: [0, 0], lengths, half, center, radius: r });
  a.forEach((x, i) => assert.ok(x >= 0 && x <= HAND.limits[i]));
  assert.ok(a[0] > 0.5, '付け根の関節が、柄の側（前方の接点）へ曲がらない ' + a[0]);
  wrapAngles({ joint0: [0, 0], lengths, half, center, radius: r, limits: [0.2, 0.2, 0.2] }).forEach(x => assert.ok(x >= 0 && x <= 0.2, '上限で止まらない ' + x));
  let jx = 0, jy = 0, h = 0;
  for (let i = 0; i < 3; i++) {
    h += a[i];
    if (a[i] > 0 && a[i] < HAND.limits[i]) close(-(center[0] - jx) * Math.sin(h) + (center[1] - jy) * Math.cos(h), r + half[i], 1e-9, '接する');
    jx += Math.cos(h) * lengths[i]; jy += Math.sin(h) * lengths[i];
  }
  // 関節が円の中なら、その節は曲げない
  assert.deepEqual(wrapAngles({ joint0: [0, 0], lengths: [0.01], half: [0.005], center: [0, 0.001], radius: r }), [0]);
});

test('指の姿勢：角0は恒等、骨の長さは変わらず、正の角で手のひらの側へ曲がる。指ごとの角はその指の骨だけを動かす', () => {
  const { points, m } = handOf('hero', 'Right'), L = boneLayout(m), axes = { curl: m.c, thumb: thumbAxis(m) };
  const flat = [[0, 0, 0], [0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const zero = poseDigits(L, axes, flat, [0, 0]);
  for (const p of points.slice(0, 300)) { const q = skinDigits(p, splitHandWeight(m, p), zero); for (let k = 0; k < 3; k++) close(q[k], p[k], 1e-12); }
  const fingers = [[0.9, 0.8, 0.5], [0.7, 0.9, 0.6], [1.0, 0.6, 0.4], [0.5, 0.5, 0.5]];
  const bent = poseDigits(L, axes, fingers, [0.6, 0.4]), move = (k, p) => { const { R, t } = bent[k]; return [R[0] * p[0] + R[1] * p[1] + R[2] * p[2] + t[0], R[3] * p[0] + R[4] * p[1] + R[5] * p[2] + t[1], R[6] * p[0] + R[7] * p[1] + R[8] * p[2] + t[2]]; };
  const W = L.world;
  for (let k = 0; k < FINGERS; k++) {
    const [a, b, c] = ['f' + k + '0', 'f' + k + '1', 'f' + k + '2'];
    close(dist(move(a, W[b]), W[a]), dist(W[b], W[a]), 1e-12, '付け根→中');
    close(dist(move(b, W[c]), move(a, W[b])), dist(W[c], W[b]), 1e-12, '中→先');
    // 回りは c の軸のまわりだけ（指の付け根の回転角が、その指の付け根の角に等しい）
    const R = bent[a].R; close(Math.acos(Math.max(-1, Math.min(1, (R[0] + R[4] + R[8] - 1) / 2))), fingers[k][0], 1e-9, '付け根の角');
  }
  close(dist(move('t0', W.t1), W.t0), dist(W.t1, W.t0), 1e-12, '親指');
  for (const k of DIGIT_KEYS) { const R = bent[k].R, det = R[0] * (R[4] * R[8] - R[5] * R[7]) - R[1] * (R[3] * R[8] - R[5] * R[6]) + R[2] * (R[3] * R[7] - R[4] * R[6]); close(det, 1, 1e-12, k); }
  // 1本の指だけ曲げると、ほかの指の骨は恒等
  const one = poseDigits(L, axes, [[0, 0, 0], [0, 0, 0], [0.8, 0.6, 0.4], [0, 0, 0]], [0, 0]);
  for (const k of DIGIT_KEYS) if (k[1] !== '2' || k[0] !== 'f') { const { R, t } = one[k]; for (let i = 0; i < 9; i++) close(R[i], [1, 0, 0, 0, 1, 0, 0, 0, 1][i], 1e-12, k); for (let i = 0; i < 3; i++) close(t[i], 0, 1e-12, k); }
  const tip = points.reduce((b, p) => (p[1] > b[1] ? p : b));
  const moved = skinDigits(tip, splitHandWeight(m, tip), bent);
  assert.ok(dot(moved.map((x, i) => x - tip[i]), m.n) > 0.03, '指先が手のひらの側へ動かない');
  const th = palmCoords(m, points[0]) && points.reduce((b, p) => { const q = palmCoords(m, p); return q[1] > 0.3 * m.tipF && q[1] < 0.8 * m.tipF && q[0] > palmCoords(m, b)[0] ? p : b; });
  const tm = skinDigits(th, splitHandWeight(m, th), bent);
  assert.ok(dot(tm.map((x, i) => x - th[i]), m.n) > 0.01, '親指の先が手のひらの側へ動かない');
  close(cylinderDistance([0, 0.05, 0], [0, 0, 0], [0, 1, 0], 0.01), -0.01, 1e-12);
  close(cylinderDistance([0.03, 0, 0.04], [0, 0, 0], [0, 1, 0], 0.01), 0.04, 1e-12);
});

test('実際の頂点で握りを合わせる：皮が柄へ2mmより深く入らず、指の付け根・中の節は表面から6mm以内（主人公・兵・侍大将の右手と、両手持ちの左手）。隣の指との角の差は neighbor まで', () => {
  const cases = [['hero', 'Right', 0.0155, 0.0035], ['soldier', 'Right', 0.0155, 0.004], ['officer', 'Right', 0.0155, 0.006], ['hero', 'Left', 0.0155, 0.006], ['soldier', 'Left', 0.0155, 0.006], ['officer', 'Left', 0.0155, 0.006], ['hero', 'Left', 0.0225, 0.006]];
  for (const [who, side, radius, near] of cases) {
    const { points, weights, m } = handOf(who, side), L = boneLayout(m);
    const verts = points.map((p, i) => ({ p, s: splitHandWeight(m, p), w: weights[i] })).filter(v => v.w >= 0.5);
    const fit = fitGrip(m, L, verts, radius);
    assert.ok(fit.report.sinkAll >= -0.002, `${who} ${side}: 皮のめり込み ${(fit.report.sinkAll * 1000).toFixed(1)}mm`);
    assert.equal(fit.fingers.length, FINGERS);
    fit.fingers.forEach(a => a.forEach((x, j) => assert.ok(x >= 0 && x <= HAND.limits[j], `角が上限の外 ${x}`)));
    for (let k = 0; k < FINGERS; k++) assert.ok(fit.fingers[k].reduce((a, b) => a + b, 0) > 1.6, `${who} ${side}: 指 ${k} が巻きつくほど曲がっていない`);
    for (let k = 1; k < FINGERS; k++) for (let j = 0; j < 3; j++) assert.ok(Math.abs(fit.fingers[k][j] - fit.fingers[k - 1][j]) <= FIT.neighbor + 1e-9, `${who} ${side}: 隣の指との差 ${k} ${j}`);
    for (const [k, d] of Object.entries(fit.report)) if (/^f[01]\//.test(k)) assert.ok(d <= near, `${who} ${side} ${k}: すき間 ${(d * 1000).toFixed(1)}mm`);
    assert.ok(fit.lift >= 0 && fit.lift <= FIT.liftMax && fit.shift >= FIT.shift[0] && fit.shift <= FIT.shift[1], '中心線の動かし方が範囲の外');
    assert.deepEqual(fitGrip(m, L, verts, radius).fingers, fit.fingers);
  }
  // 親指は、狭い格子で入らない姿勢があれば、そこから選ぶ（兵の右手：付け根を大きく反らした姿勢を選ぶと、甲の上に親指の先が立った）
  const { points, weights, m } = handOf('soldier', 'Right'), L = boneLayout(m);
  const fit = fitGrip(m, L, points.map((p, i) => ({ p, s: splitHandWeight(m, p), w: weights[i] })).filter(v => v.w >= 0.5), 0.0155);
  assert.ok(fit.thumb[0] >= FIT.thumbGrid[0] - 1e-9 && fit.thumb[1] >= FIT.thumbGrid[2] - 1e-9, `兵の右手の親指が広い格子から選ばれた ${fit.thumb}`);
});

test('握った手の柄に沿った広がり：親指の側と小指の側で測り、軸から遠い皮は数えない', () => {
  const { points, weights, m } = handOf('soldier', 'Right'), L = boneLayout(m);
  const verts = points.map((p, i) => ({ p, s: splitHandWeight(m, p), w: weights[i] })).filter(v => v.w >= 0.5);
  const fit = fitGrip(m, L, verts, 0.0155);
  const thumbSide = gripExtent(L, fit.axes, fit, verts, m.w, 0.051), pinkySide = gripExtent(L, fit.axes, fit, verts, m.w.map(x => -x), 0.051);
  // 手の幅（指の板の幅）の半分より広く、手の長さより狭い
  assert.ok(thumbSide > (m.wHi - m.wLo) / 2 - 0.01 && thumbSide < 0.09, `親指の側 ${thumbSide}`);
  assert.ok(pinkySide > (m.wHi - m.wLo) / 2 - 0.01 && pinkySide < 0.09, `小指の側 ${pinkySide}`);
  // 親指（と母指球）の側は、小指の側より柄に沿って広い（鍔に当たるのは親指の側。主人公65・40mm、兵65・62mm、侍大将68・49mm）
  for (const [who, side] of [['hero', 'Right'], ['soldier', 'Right'], ['officer', 'Right'], ['hero', 'Left']]) {
    const h = handOf(who, side), L2 = boneLayout(h.m), v2 = h.points.map((p, i) => ({ p, s: splitHandWeight(h.m, p), w: h.weights[i] })).filter(v => v.w >= 0.5), f2 = fitGrip(h.m, L2, v2, 0.0155);
    assert.ok(gripExtent(L2, f2.axes, f2, v2, h.m.w, 0.051) > gripExtent(L2, f2.axes, f2, v2, h.m.w.map(x => -x), 0.051), `${who} ${side}: 親指の側が狭い`);
  }
  // 軸からの距離の上限を小さくすると、数える皮が減り、広がりは増えない
  assert.ok(gripExtent(L, fit.axes, fit, verts, m.w, 0.02) <= thumbSide + 1e-12);
  assert.equal(groupName('f21'), 'f1/2'); assert.equal(groupName('t0'), 't0');
});
