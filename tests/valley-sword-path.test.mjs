import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SWORD, BLADE_SECTION, S_CLEAR, S_OUT, SAYA_BACK_MAX, TWIST_MAX_DEG, sayaCenter, bladeCenter, bladeHalfSection, swordOnSaya, blendPose, bladeCenterInSayaFrame, swingBlend, blendOrientation, swingRollDeg } from '../dist/valley/sword-path.js';
const close = (a, b, e = 1e-12) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const vector = (a, b, e = 1e-12) => a.forEach((v, i) => close(v, b[i], e));

test('寸法と抜ける境界は契約どおりで、端点と中央の反りも一致する', () => {
  assert.deepEqual(SWORD, { bladeBase: .16, bladeLength: .72, bladeSori: .018, sayaY0: .17, sayaLength: .78, sayaSori: .018, sayaRadius: .0225, koiguchiY: .168, tsubaY: .128, tsukaLength: .25 });
  close(S_CLEAR, .712); assert.equal(S_OUT, .74); assert.equal(SAYA_BACK_MAX, .22); assert.equal(TWIST_MAX_DEG, 35);
  vector([sayaCenter(.17), sayaCenter(.56), sayaCenter(.95)], [0, .018, 0]);
  vector([bladeCenter(.16), bladeCenter(.52), bladeCenter(.88)], [0, .018, 0]);
});
test('weapons.jsに記された実寸を文脈付きで読み、この層の寸法と照合する', () => {
  const source = fs.readFileSync(new URL('../dist/valley/weapons.js', import.meta.url), 'utf8');
  const number = '(0\\.\\d+)';
  for (const [key, pattern] of [
    ['bladeBase', 'blade.position.y = ' + number],
    ['bladeLength', 'L = ' + number], ['bladeSori', 'sori = ' + number],
    ['sayaY0', 'saya.position.y = ' + number], ['koiguchiY', 'koiguchi.position.y = ' + number],
    ['tsubaY', 'tsuba.position.y = ' + number],
    ['tsukaLength', 'CylinderGeometry\\(0.0165, 0.0165, ' + number],
  ]) {
    const match = source.match(new RegExp(pattern)); assert.ok(match, key); assert.equal(Number(match[1]), SWORD[key]);
  }
  const bladeArgs = source.match(/function bladeGeometry\(\{ L = [\d.]+, sori = [\d.]+, w0 = (0\.\d+), w1 = (0\.\d+), th0 = (0\.\d+), th1 = (0\.\d+)/);
  assert.ok(bladeArgs); vector(bladeArgs.slice(1).map(Number), [BLADE_SECTION.w0, BLADE_SECTION.w1, BLADE_SECTION.th0, BLADE_SECTION.th1]);
  assert.ok(source.includes('t > ' + BLADE_SECTION.taperStart + ' ? Math.max(0, (1 - t) / ' + (1 - BLADE_SECTION.taperStart).toFixed(2) + ')'), '先端の絞りの式');
  const tube = source.match(/curvedTube\((0\.\d+), (0\.\d+), (0\.\d+)\)/);
  assert.ok(tube); vector(tube.slice(1).map(Number), [SWORD.sayaLength, SWORD.sayaSori, SWORD.sayaRadius]);
});
test('s=0は恒等であり、範囲外を両端へクランプする', () => {
  const identity = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  assert.deepEqual(swordOnSaya(0), identity); assert.deepEqual(swordOnSaya(-1), identity);
  assert.deepEqual(swordOnSaya(S_OUT + 10), swordOnSaya(S_OUT));
  assert.deepEqual(swordOnSaya(NaN), identity);
});
const inSaya = (s, n = 721) => bladeCenterInSayaFrame(s, n).map((p, i) => ({ p, y: SWORD.bladeBase + SWORD.bladeLength * i / (n - 1) })).filter(({ p }) => p[1] >= SWORD.sayaY0 && p[1] <= SWORD.sayaY0 + SWORD.sayaLength);
test('刃の中心線の差は、鞘に収めた姿勢（s=0）で既に約5.9mmある。滑らせても、それより1.5mm以上は悪くならない', () => {
  const worst = s => Math.max(...inSaya(s).map(({ p }) => Math.hypot(p[0], p[2] - sayaCenter(p[1]))));
  const rest = worst(0);
  assert.ok(rest > .005 && rest < .007, `静止時の差 ${rest}`);   // 鞘と刃の反りの形が違う分（設計どおり）
  let peak = 0;
  for (let i = 0; i <= 1480; i++) peak = Math.max(peak, worst(S_OUT * i / 1480));
  assert.ok(peak <= rest + .0015, `滑らせたときの最大 ${peak}・静止時 ${rest}`);
});
test('全区間を0.5mm刻み・刃721点で検査し、刃の断面は鞘の管の中に0.5mmの余裕をもって収まる', () => {
  let tightest = Infinity, where;
  for (let i = 0; i <= 1480; i++) {
    const s = S_OUT * i / 1480;
    for (const { p, y } of inSaya(s)) {
      const { halfWidth, halfThickness } = bladeHalfSection(y);
      const room = SWORD.sayaRadius - Math.hypot(p[0] + halfThickness, Math.abs(p[2] - sayaCenter(p[1])) + halfWidth);
      if (room < tightest) { tightest = room; where = { s, y }; }
    }
  }
  assert.ok(tightest >= .0005, `余裕 ${tightest} ${JSON.stringify(where)}`);
  assert.ok(tightest < .009, `余裕が実寸（根元で約5.7mm）より大きい＝断面の幅を数えていない疑い ${tightest}`);
});
test('刃の断面は根元で幅31mm・厚み7.5mm、最後の7%で先端へ絞られる', () => {
  const base = bladeHalfSection(SWORD.bladeBase), mid = bladeHalfSection(SWORD.bladeBase + SWORD.bladeLength / 2), tip = bladeHalfSection(SWORD.bladeBase + SWORD.bladeLength);
  close(base.halfWidth * 2, .031 * (.18 + .82), 1e-9); close(base.halfThickness * 2, .0075, 1e-9);
  assert.ok(mid.halfWidth < base.halfWidth && mid.halfThickness < base.halfThickness);
  assert.ok(tip.halfWidth * 2 < .005 && tip.halfThickness === 0);
});
test('S_CLEAR以後は刃の全点が鯉口の外にあり、切先の-Y移動量がsと一致する', () => {
  for (let i = 0; i <= 100; i++) {
    const s = S_CLEAR + (S_OUT - S_CLEAR) * i / 100, points = bladeCenterInSayaFrame(s, 721);
    assert.ok(points.every(p => p[1] <= SWORD.koiguchiY + 1e-12));
    close(points.at(-1)[1], .88 - s);
  }
  assert.ok(bladeCenterInSayaFrame(S_CLEAR - 1e-6, 2).at(-1)[1] > SWORD.koiguchiY);
});
test('姿勢は単調・連続で正規化され、鞘の円弧の中心を保つ', () => {
  let previous = swordOnSaya(0);
  const radius = (.78 ** 2 / 4 + .018 ** 2) / (2 * .018), cy = .56, cz = .018 - radius;
  for (let i = 1; i <= 7400; i++) {
    const p = swordOnSaya(S_OUT * i / 7400), [x, , , w] = p.quaternion;
    assert.ok(p.position[1] < previous.position[1]);
    assert.ok(Math.hypot(...p.position.map((v, j) => v - previous.position[j])) < .0002);
    assert.ok(Math.hypot(...p.quaternion.map((v, j) => v - previous.quaternion[j])) < .00002);
    close(Math.hypot(...p.quaternion), 1);
    const c = 1 - 2 * x * x, sn = 2 * x * w;
    close(p.position[1] + c * cy - sn * cz, cy);
    close(p.position[2] + sn * cy + c * cz, cz);
    previous = p;
  }
  const angle = 2 * Math.asin(previous.quaternion[0]) * 180 / Math.PI;
  assert.ok(angle > 9 && angle < 11);
});
test('刃の補助標本は両端を含み、姿勢からの変換と一致する', () => {
  for (const s of [0, .1, .4, S_OUT]) {
    const pose = swordOnSaya(s), [x, , , w] = pose.quaternion;
    const points = bladeCenterInSayaFrame(s, 31);
    for (let i = 0; i < 31; i++) {
      const y = .16 + .72 * i / 30, z = bladeCenter(y);
      vector(points[i], [0, pose.position[1] + (1 - 2 * x * x) * y - 2 * x * w * z, pose.position[2] + 2 * x * w * y + (1 - 2 * x * x) * z]);
    }
  }
  for (const n of [0, 1, 2.5, NaN]) assert.throws(() => bladeCenterInSayaFrame(0, n), RangeError);
});
test('blendPoseは端点・クランプ・球面線形補間・正規化を守る', () => {
  const a = { position: [1, 2, 3], quaternion: [0, 0, 0, 2] };
  const b = { position: [3, 4, 5], quaternion: [0, 0, 3, 0] };
  vector(blendPose(a, b, -1).position, a.position); vector(blendPose(a, b, 2).position, b.position);
  vector(blendPose(a, b, 0).quaternion, [0, 0, 0, 1]); vector(blendPose(a, b, 1).quaternion, [0, 0, 1, 0]);
  for (let i = 0; i <= 100; i++) {
    const w = i / 100, r = blendPose(a, b, w);
    vector(r.position, [1 + 2 * w, 2 + 2 * w, 3 + 2 * w]);
    vector(r.quaternion, [0, 0, Math.sin(Math.PI * w / 2), Math.cos(Math.PI * w / 2)]);
    close(Math.hypot(...r.quaternion), 1);
  }
});
test('blendPoseはqと-qの短い弧を選び、微小角と零回転入力も有限', () => {
  const a = { position: [0, 0, 0], quaternion: [0, 0, 0, 1] };
  for (const q of [[0, 0, 0, -1], [1e-6, 0, 0, -1], [0, 0, 0, 0]]) {
    const b = { ...a, quaternion: q }, copy = structuredClone([a, b]);
    for (const w of [0, .25, .5, 1]) {
      const r = blendPose(a, b, w); close(Math.hypot(...r.quaternion), 1); assert.ok(Math.abs(r.quaternion[3]) > .99999);
    }
    assert.deepEqual([a, b], copy);
  }
});

// 向きの混ぜ：反対向きの2つの向きの間でも、刃が上を通り、1コマで跳ばない
const qAxis = (axis, deg) => { const n = Math.hypot(...axis), a = deg * Math.PI / 360; return [...axis.map(v => v / n * Math.sin(a)), Math.cos(a)]; };
const qMul = (a, b) => [a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1], a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0], a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3], a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2]];
const qAngle = (a, b) => 2 * Math.acos(Math.min(1, Math.abs(a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3])));
const rotate = (q, v) => { const c = [-q[0], -q[1], -q[2], q[3]], r = qMul(qMul(q, [v[0], v[1], v[2], 0]), c); return [r[0], r[1], r[2]]; };
test('swingBlendは両端の向きに一致し、単位で、反対向きでも刃が上を通る', () => {
  const blade = [0, 1, 0];
  const qa = qAxis([1, 0, 0], -100), qf = qAxis([1, 0, 0], 80);       // 刃の向きがほぼ反対（約180度）
  assert.ok(qAngle(swingBlend(qa, qf, 0, blade), qa) < 1e-6 && qAngle(swingBlend(qa, qf, 1, blade), qf) < 1e-6);   // acosの丸め（約1e-8）を許す
  for (let i = 0; i <= 20; i++) close(Math.hypot(...swingBlend(qa, qf, i / 20, blade)), 1, 1e-9);
  const dA = rotate(qa, blade), dF = rotate(qf, blade);
  assert.ok(dA[0] * dF[0] + dA[1] * dF[1] + dA[2] * dF[2] < -0.9);      // ほぼ反対向き
  assert.ok(rotate(swingBlend(qa, qf, .5, blade), blade)[1] > Math.max(dA[1], dF[1]) + .3, '途中で刃が上へ振れる');
});
test('swingBlendは、近い向きでは上へ振らず、実際に使う範囲の組では1コマ（h=0.01）で跳ばない', () => {
  const blade = [0, 0.6, 0.8];
  const near = swingBlend(qAxis([0, 1, 0], 10), qAxis([0, 1, 0], 20), .5, blade);
  assert.ok(qAngle(near, qAxis([0, 1, 0], 15)) < .05, '近い向きの中間は、ほぼ最短の弧');
  // 実際の組：刃が後ろ下向き（鞘の軸）から、前上向き（構え）へ。向きのずれと、刃のまわりのねじれを振る
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const around = (dir, cone) => { const v = [dir[0] + (rnd() - .5) * cone, dir[1] + (rnd() - .5) * cone, dir[2] + (rnd() - .5) * cone], n = Math.hypot(...v); return v.map(x => x / n); };
  const qTo = (from, to, roll) => { const c = [from[1] * to[2] - from[2] * to[1], from[2] * to[0] - from[0] * to[2], from[0] * to[1] - from[1] * to[0]], d = from[0] * to[0] + from[1] * to[1] + from[2] * to[2], n = Math.hypot(...c);
    const q = n < 1e-9 ? [0, 0, 0, 1] : [...c.map(x => x / n * Math.sin(Math.acos(Math.max(-1, Math.min(1, d))) / 2)), Math.cos(Math.acos(Math.max(-1, Math.min(1, d))) / 2)];
    return qMul(qAxis(to, roll), q); };
  let worst = 0, upOk = 0, total = 0;
  for (let k = 0; k < 2000; k++) {
    const dA = around([0, -.3, -.95], .6), dF = around([0, .3, .95], .6);
    const qa = qTo(blade, dA, rnd() * 360), qf = qTo(blade, dF, rnd() * 360);
    let prev = swingBlend(qa, qf, 0, blade);
    for (let i = 1; i <= 100; i++) { const q = swingBlend(qa, qf, i / 100, blade); worst = Math.max(worst, qAngle(prev, q)); prev = q; }
    total++; if (rotate(swingBlend(qa, qf, .5, blade), blade)[1] > 0.3) upOk++;
  }
  assert.ok(worst < .12, `1コマ（h=0.01）の最大の回転 ${worst}rad`);
  assert.ok(upOk / total > .95, `途中で刃が上へ振れる組 ${upOk}/${total}`);
});

test('swingRollDegは、刃の向きが同じで刃のまわりだけ回した2つの向きで、その角度を返す', () => {
  const blade = [0, 1, 0];
  for (const deg of [0, 30, 90, 150, 179]) close(swingRollDeg([0, 0, 0, 1], qAxis([0, 1, 0], deg), blade), deg, 1e-4);
  close(swingRollDeg([0, 0, 0, 1], qAxis([1, 0, 0], 100), blade), 0, 1e-4);      // 刃を振るだけ（ねじれなし）
  close(swingRollDeg([0, 0, 0, 1], qAxis([0, 1, 0], 181), blade), 179, 1e-4);    // 0〜180度に折り返す
});

// 刃の向き（後ろ下→前上）はそのままで、刃のまわりの向きだけが動く列でも、memo（前のコマの結果）があれば混ぜは連続。
// memoなしの最短側は、実際の使用範囲のどの構成でも、あるねじれの角度で約90度跳ぶ（400構成で確認）ので、この試験は意味を持つ。
test('swingBlend・blendOrientationは、2つの向きの相対回転が180度をまたいで動く列でも、memoがあれば連続', () => {
  const blade = [0, 0.6, 0.8], steps = 100;
  const qa = qAxis([1, 0, 0], -100), qf0 = qMul(qAxis([0, 0, 1], 25), qAxis([1, 0, 0], 80)), dF = rotate(qf0, blade);
  const sweepMax = (make, from, to, memo) => { let prev = null, worst = 0, at = null;
    for (let i = 0; i <= steps; i++) { const deg = from + (to - from) * i / steps, q = make(deg, memo); if (prev) { const a = qAngle(prev, q); if (a > worst) { worst = a; at = deg; } } prev = q; } return { worst, at }; };
  const swing = (deg, memo) => swingBlend(qa, qMul(qAxis(dF, deg), qf0), .5, blade, undefined, memo);
  const cut = sweepMax(swing, -180, 180, null);                                     // 短い側が入れ替わる所を探す
  assert.ok(cut.worst > 1, `memoなしが跳ぶ所が見つかる（${cut.worst}）`);
  const near = [cut.at - 20, cut.at + 20];
  assert.ok(sweepMax(swing, near[0], near[1], {}).worst < .1, 'memoありは、その所をまたいでも連続');
  assert.ok(sweepMax(swing, near[1], near[0], {}).worst < .1, '逆向きに動いても連続');
  // 単純な混ぜ：同じ向きの列
  const blend = (deg, memo) => blendOrientation([0, 0, 0, 1], qAxis([0, 1, 0], 180 + deg), .5, memo);
  assert.ok(sweepMax(blend, -30, 30, null).worst > 1, 'memoなしは、180度をまたぐ所で跳ぶ');
  assert.ok(sweepMax(blend, -30, 30, {}).worst < .05, 'memoありは連続');
  // 端点：h=0 は qa、h=1 は qf（memoがあっても）
  const memo = {}; for (const [h, want] of [[0, qa], [1, qf0]]) assert.ok(qAngle(swingBlend(qa, qf0, h, blade, undefined, memo), want) < 1e-6);
});
