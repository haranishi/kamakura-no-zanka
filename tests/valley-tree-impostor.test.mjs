// なぜ失敗したか（8.1a第2周・盲検）: 遠景（150m以遠）の杉は重ねた円錐のままで、見晴らしから「段の針葉樹」に見え、三角形の約半分を使っていた。
// 遠景は、近景の木を8方向から焼いた絵の板にした。その純粋な部分（方向の選び方・帳の割り付け・枠への収め方・近くの葉を薄める距離）を確かめる。
// 原因の型: view（方向の選択と混ぜ）/wrap（一周のつなぎ目）/layout（帳の重なり）/fit（歪み・はみ出し）/bake（焼く置き方と読む位置）/near（近くの葉）/determinism。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as I from '../dist/valley/tree-impostor.js';
import { nearFade } from '../dist/valley/tree-lod.js';
import { TREES } from '../dist/valley/config.js';
const TAU = Math.PI * 2;

test('thirteen adult families, one atlas row each [layout]', () => {
  const fams = I.impostorFamilies(TREES.variants);
  assert.deepEqual(fams.map(f => [f.species, f.shape]), [[0, 0], [0, 1], [0, 2], [0, 3], [0, 4], [1, 0], [1, 1], [1, 2], [2, 0], [2, 1], [3, 0], [3, 1], [3, 2]], '[layout] family order');
  fams.forEach((f, i) => assert.equal(f.row, i, '[layout] row'));
  const L = I.impostorLayout(fams.length);
  assert.deepEqual([L.width, L.height, L.step], [I.IMPOSTOR.views * I.IMPOSTOR.cell[0], fams.length * I.IMPOSTOR.cell[1], 1 / I.IMPOSTOR.views], '[layout] atlas size');
  assert(L.width * L.height * 4 <= 4 * 1024 * 1024, '[layout] atlas over 4 MiB per image');
  assert.throws(() => I.impostorFamilies({ cedar: 0 }), RangeError, '[layout] empty family accepted');
  assert.throws(() => I.impostorLayout(0), RangeError, '[layout] empty atlas accepted');
});

// 焼いた方位では1枚だけ（二重像なし）。方位を一周しても、見せる絵の位置（a+t）は連続で、刻みを飛ばさない。
test('the view choice shows one frame at each baked azimuth and blends only between neighbours [view/wrap]', () => {
  const V = I.IMPOSTOR.views, band = I.IMPOSTOR.band;
  for (let k = 0; k < V; k++) {
    const v = I.impostorView(I.viewAzimuth(k));
    assert(v.a === k && v.t === 0 && v.b === (k + 1) % V, `[view] baked azimuth ${k} does not show its own frame`);
    // Within (.5 - band/2) of a step around a baked azimuth, exactly one frame is shown.
    for (const d of [-.24, .24]) { const w = I.impostorView(I.viewAzimuth(k) + d * TAU / V); assert(w.t === 0 || w.t === 1, '[view] blending outside the band'); }
  }
  let prev = null, maxJump = 0, blended = 0;
  for (let i = 0; i <= 20000; i++) {
    const az = i / 20000 * TAU * 2 - TAU / 2, v = I.impostorView(az), pos = (v.a + v.t) % V;
    assert(v.t >= 0 && v.t <= 1 && v.b === (v.a + 1) % V, '[view] invalid pair');
    if (v.t > 0 && v.t < 1) blended++;
    if (prev !== null) { let d = Math.abs(pos - prev); d = Math.min(d, V - d); maxJump = Math.max(maxJump, d); }
    prev = pos;
  }
  assert(maxJump < .01, `[wrap] the shown frame jumps by ${maxJump.toFixed(3)} views`);
  assert(blended / 20000 > band * .6 && blended / 20000 < band * 1.05, '[view] blend band width');
  assert.deepEqual(I.impostorView(0), I.impostorView(TAU), '[wrap] one turn does not return to the same frame');
  assert.deepEqual(I.impostorView(-.1), I.impostorView(TAU - .1), '[wrap] negative azimuth');
  const step = TAU / 8;
  assert.equal(I.impostorView(.45 * step, 8, 0).t, 0, '[view] zero band must switch hard'); assert.equal(I.impostorView(.55 * step, 8, 0).t, 1, '[view] zero band must switch at the middle');
  assert.throws(() => I.impostorView(NaN), RangeError, '[view] NaN azimuth');
  for (const [dx, dz, a] of [[0, 1, 0], [1, 0, TAU / 4], [0, -1, TAU / 2], [-1, 0, 3 * TAU / 4]]) assert(Math.abs(I.localAzimuth(dx, dz) - a) < 1e-12, '[view] azimuth convention (0 = +Z, +X = quarter turn)');
});

// 枠は縦横同じ倍率で、内側の余白を守り、幹を枠の中央に置く。読む UV は焼いた画素と同じ所を指す。
test('frames keep the tree undistorted inside its padded cell, and the board reads what the bake wrote [fit/bake]', () => {
  const fams = I.impostorFamilies(TREES.variants), L = I.impostorLayout(fams.length), { cell, pad, views } = I.IMPOSTOR;
  for (const extent of [{ half: 3.6, bottom: -.1, top: 20.3 }, { half: 5.2, bottom: -.1, top: 12.4 }, { half: .9, bottom: -.1, top: 3.1 }]) {
    const fit = I.frameFit(extent);
    assert(fit.width <= cell[0] - 2 * pad + 1e-9 && fit.height <= cell[1] - 2 * pad + 1e-9, '[fit] frame leaves its padded cell');
    assert(Math.abs(fit.width / fit.height - 2 * extent.half / (extent.top - extent.bottom)) < 1e-9, '[fit] tree distorted');
    assert(Math.abs(fit.width - (cell[0] - 2 * pad)) < 1e-9 || Math.abs(fit.height - (cell[1] - 2 * pad)) < 1e-9, '[fit] frame wastes both directions');
    for (const row of [0, 7, fams.length - 1]) {
      const uv = I.frameUV(row, fit, L);
      for (let col = 0; col < views; col++) {
        const at = I.bakePlacement(row, col, fit), u0 = uv[0] + col * L.step, v0 = uv[1];
        // The trunk foot (board uv x .5, y at -bottom) lands on the bake's foot pixel.
        assert(Math.abs((u0 + .5 * uv[2]) * L.width - at.x) < 1e-6, '[bake] board centre off the baked trunk');
        assert(Math.abs((v0 + (-extent.bottom) / (extent.top - extent.bottom) * uv[3]) * L.height - at.y) < 1e-6, '[bake] board foot off the baked foot');
        assert(Math.abs(at.scale - fit.scale) < 1e-12 && Math.abs(at.yaw + I.viewAzimuth(col)) < 1e-12, '[bake] bake turns the tree the wrong way');
        // Frames never cross their cell.
        const x0 = u0 * L.width, x1 = (u0 + uv[2]) * L.width, y0 = v0 * L.height, y1 = (v0 + uv[3]) * L.height;
        assert(x0 >= col * cell[0] + pad - 1e-6 && x1 <= (col + 1) * cell[0] - pad + 1e-6 && y0 >= row * cell[1] + pad - 1e-6 && y1 <= (row + 1) * cell[1] - pad + 1e-6, '[layout] frame crosses its cell');
      }
    }
  }
  for (const bad of [{ half: 0, bottom: 0, top: 1 }, { half: 1, bottom: 2, top: 1 }, { half: NaN, bottom: 0, top: 1 }]) assert.throws(() => I.frameFit(bad), RangeError, '[fit] bad extent accepted');
});

// カメラの近くの葉：a 以内は消え、b 以遠は残り、その間は単調。
test('the near-camera fade is monotonic between its two distances [near]', () => {
  const [a, b] = TREES.nearFade;
  assert.equal(nearFade(a - .01, [a, b]), 0, '[near] foliage kept at the lens'); assert.equal(nearFade(b + .01, [a, b]), 1, '[near] distant foliage faded');
  let prev = 0; for (let d = 0; d <= b + .5; d += .01) { const w = nearFade(d, [a, b]); assert(w >= prev - 1e-12, '[near] fade not monotonic'); prev = w; }
  assert(Math.abs(nearFade((a + b) / 2, [a, b]) - .5) < 1e-12, '[near] fade midpoint');
  assert.throws(() => nearFade(1, [1, 1]), RangeError, '[near] empty fade band accepted');
});

test('the impostor plan is pure and deterministic [determinism]', () => {
  const code = fs.readFileSync(new URL('../dist/valley/tree-impostor.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert(!/from\s+'three|Math\.random|Date\.|performance\.|document\.|window\./.test(code), '[determinism] pure layer touches Three/DOM/time/random');
  assert.deepEqual(I.impostorFamilies(TREES.variants), I.impostorFamilies(TREES.variants), '[determinism] family drift');
});
