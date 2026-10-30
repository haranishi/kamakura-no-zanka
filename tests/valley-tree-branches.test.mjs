// なぜ失敗したか（8.1a・2026-10-30）: 近景の杉は26段×6本の輪生カード（板）と滑らかな芯の円錐で、「張りぼて」「段の針葉樹」に見えた。
// 中景は同じ形の笠を9枚重ね、モミ・トウヒの段になった。枝が無く「棒に樹冠を載せた」見え方だった。樹皮は無地だった。
// 原因の型: whorl（同じ高さの輪生）/spiral（向きの規則）/envelope（大きさ）/tuft（房の付き方）/connection（枝と房）/mid（中景の段）/bark（樹皮）/determinism。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as B from '../dist/valley/tree-branches.js';
const families = B.CEDAR_FAMILIES.map((_, shape) => shape);
const near = (a, b, e = 1e-9) => Math.abs(a - b) <= e;
const std = xs => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length); };

test('plans are deterministic, family specific and free of external state [determinism]', () => {
  for (const shape of families) {
    assert.deepEqual(B.cedarBranchPlan(shape), B.cedarBranchPlan(shape), '[determinism] branch plan drift');
    assert.deepEqual(B.cedarMidPlan(shape), B.cedarMidPlan(shape), '[determinism] middle plan drift');
  }
  assert.notDeepEqual(B.cedarBranchPlan(0).branches.map(b => b.y), B.cedarBranchPlan(1).branches.map(b => b.y), '[determinism] families share one plan');
  assert.throws(() => B.cedarBranchPlan(5), RangeError, '[determinism] unknown family accepted');
  const code = fs.readFileSync(new URL('../dist/valley/tree-branches.js', import.meta.url), 'utf8').replace(/\/\/.*$/gm, '');
  assert(!/from\s+'three|Math\.random|Date\.|performance\.|document\.|window\./.test(code), '[determinism] pure layer touches Three/DOM/time/random');
});

// 旧の杉は1段に6本が同じ高さ（6.5cm刻みの輪）に並んだ。輪生が戻れば、同じ高さの枝が3本以上そろう。
test('near cedar limbs climb a jittered spiral, never a whorl [whorl/spiral]', () => {
  for (const shape of families) {
    const { branches } = B.cedarBranchPlan(shape), ys = branches.map(b => b.y).sort((a, b) => a - b);
    assert.equal(branches.length, B.CEDAR_FAMILIES[shape].branches, '[whorl] branch count');
    for (let i = 2; i < ys.length; i++) assert(ys[i] - ys[i - 2] > .06, `[whorl] three limbs within 6cm at ${ys[i].toFixed(2)}m`);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]), mean = gaps.reduce((a, b) => a + b) / gaps.length;
    assert(std(gaps) / mean > .3, '[whorl] evenly spaced rows returned');
    const turns = branches.slice(1).map((b, i) => ((b.azimuth - branches[i].azimuth) % B.TAU + B.TAU) % B.TAU);
    assert(std(turns) > .15, '[spiral] constant azimuth step (regular phyllotaxis)');
    // Every 3m band of the crown reaches at least four of six sides: no bald face.
    for (let y = 3.5; y < 16; y += 3) {
      const sides = new Set(branches.filter(b => b.y >= y && b.y < y + 3).map(b => Math.floor(((b.azimuth % B.TAU + B.TAU) % B.TAU) / (B.TAU / 6))));
      assert(sides.size >= 4, `[spiral] band ${y}m faces only ${sides.size} sides`);
    }
  }
});

test('limb lengths taper upward and tips stay inside the middle crown rim [envelope]', () => {
  for (const shape of families) {
    const { branches } = B.cedarBranchPlan(shape), quarter = Math.floor(branches.length / 4);
    const low = branches.slice(0, quarter).reduce((a, b) => a + b.length, 0) / quarter, high = branches.slice(-quarter).reduce((a, b) => a + b.length, 0) / quarter;
    assert(low > 2 * high, '[envelope] crown is not conical');
    for (const b of branches) {
      assert(b.length >= .35 && Number.isFinite(b.length), '[envelope] degenerate limb');
      const axis = B.cedarTrunkAxis(shape, b.y), reach = Math.hypot(b.tip[0] - axis[0], b.tip[2] - axis[2]);
      assert(reach <= Math.max(.35, 1.12 * B.cedarSkirtRadius(shape, b.y)) + 1e-9, `[envelope] limb tip ${reach.toFixed(2)}m beyond the middle rim`);
      assert(Math.abs(b.pitch) < .7, '[envelope] limb pitch out of range');
    }
  }
});

// 房が枝先だけ（あるいは幹から浮いて）付くと、「棒に葉の玉」に戻る。房は枝の外側の3/4に重なり、最後は枝先。
test('tufts sit on their limb, overlap along the outer three quarters and end at the tip [tuft/connection]', () => {
  for (const shape of families) {
    const { branches } = B.cedarBranchPlan(shape), variants = [0, 0];
    let woody = 0;
    for (const b of branches) {
      assert(b.tufts.length >= 2 && b.tufts.length <= 6, '[tuft] tufts per limb');
      assert.equal(b.tufts.at(-1).s, 1, '[tuft] last tuft is not at the limb tip');
      for (const t of b.tufts) {
        assert(t.s >= .2 && t.s <= 1, '[tuft] tuft on the bare inner limb');
        B.branchPoint(b, t.s).forEach((v, q) => assert(near(v, t.center[q]), '[connection] tuft off its limb'));
        assert(t.length > .3 && t.length < 2.2 && near(t.width, .9 * t.length), '[tuft] tuft size');
        assert([0, 1].includes(t.variant) && Math.abs(t.hue) <= 1 && Math.abs(t.shade) <= 1, '[tuft] variant/colour jitter');
        variants[t.variant]++;
      }
      const spacing = b.tufts.slice(1).map((t, i) => (t.s - b.tufts[i].s) * b.length);
      assert(spacing.every((d, i) => d < .8 * b.tufts[i + 1].length), '[tuft] neighbouring tufts do not overlap');
      if (b.wood) { woody++; assert(b.length > 1.35 && b.t < .72, '[connection] limb flag'); }
      // The limb starts inside the trunk at its own height.
      const axis = B.cedarTrunkAxis(shape, b.y);
      assert(Math.hypot(b.base[0] - axis[0], b.base[2] - axis[2]) < B.cedarTrunkRadius(b.y) + 1e-9, '[connection] limb floats off the trunk');
    }
    const share = variants[0] / (variants[0] + variants[1]);
    assert(share > .35 && share < .65, '[tuft] one spray image dominates');
    assert(woody >= (shape === 3 ? 12 : 24), `[connection] too few visible limbs (${woody})`);
  }
});

test('three crossed cards per tuft span the limb axis at 60 degrees [tuft-cards]', () => {
  const tuft = B.cedarBranchPlan(0).branches[10].tufts[1], cards = B.tuftCards(tuft);
  assert.equal(cards.length, 3, '[tuft-cards] card count');
  for (let i = 0; i < 3; i++) {
    const a = cards[i], b = cards[(i + 1) % 3], cos = Math.abs(a.across.reduce((n, v, q) => n + v * b.across[q], 0));
    assert(near(cos, .5, 1e-9), '[tuft-cards] cards not 60 degrees apart');
    assert(near(Math.hypot(...a.normal), 1, 1e-9) && near(a.normal.reduce((n, v, q) => n + v * a.along[q], 0), 0, 1e-9), '[tuft-cards] card normal');
    const [r0, r1, e1, e0] = a.corners, root = Math.hypot(...r1.map((v, q) => v - r0[q])), end = Math.hypot(...e1.map((v, q) => v - e0[q]));
    assert(near(end, tuft.width, 1e-9) && near(root, .55 * tuft.width, 1e-9), '[tuft-cards] trapezoid widths');
  }
});

test('crown normals face outward and exposure darkens the inside and the bottom [crown-normal/exposure]', () => {
  for (const shape of families) {
    const axis = B.cedarTrunkAxis(shape, 8), out = [axis[0] + 2, 8, axis[2]];
    for (const card of [[0, 0, 1], [0, 1, 0], [-1, 0, 0]]) {
      const n = B.crownNormal(out, card, axis);
      assert(near(Math.hypot(...n), 1, 1e-9) && n[0] > .3 && n[1] > 0, '[crown-normal] inward or downward crown normal');
    }
    const inner = B.cedarExposure([axis[0] + .3, 8, axis[2]], shape), outer = B.cedarExposure([axis[0] + 2.3 * B.CEDAR_FAMILIES[shape].width, 8, axis[2]], shape);
    const low = B.cedarExposure([B.cedarTrunkAxis(shape, 4)[0] + 1, 4, 0], shape), high = B.cedarExposure([B.cedarTrunkAxis(shape, 16)[0] + 1, 16, 0], shape);
    assert(inner < outer - .2, '[exposure] inner tufts as bright as outer');
    assert(low < high, '[exposure] lower crown not darker');
    for (const e of [inner, outer, low, high]) assert(e >= .3 && e <= 1.1, '[exposure] black or blown tuft');
  }
});

// 中景の裾は9枚の同じ笠だった（段）。房に替えても、数は旧の三角形の数と同じで、外周まで届き、高さは一つずつ違う。
test('middle cedar tufts replace the stacked skirts within their triangles [mid]', () => {
  assert.deepEqual(B.CEDAR_MID_TUFTS, [36, 32, 40, 37, 40], '[mid] tuft counts (old skirt triangles / 6)');
  for (const shape of families) {
    const { tufts } = B.cedarMidPlan(shape), ys = tufts.map(t => t.center[1]).sort((a, b) => a - b);
    assert.equal(tufts.length, B.CEDAR_MID_TUFTS[shape], '[mid] tuft count');
    for (let i = 2; i < ys.length; i++) assert(ys[i] - ys[i - 2] > .1, '[mid] tufts stacked at one height (skirt)');
    let reach = 0;
    for (const t of tufts) {
      const axis = B.cedarTrunkAxis(shape, t.center[1]), rim = B.cedarSkirtRadius(shape, t.center[1]);
      const tip = t.center.map((v, q) => v + t.along[q] * .55 * t.length), r = Math.hypot(tip[0] - axis[0], tip[2] - axis[2]);
      assert(Math.hypot(t.center[0] - axis[0], t.center[2] - axis[2]) < rim + 1e-9, '[mid] tuft centre outside the crown');
      reach += r / rim;
    }
    assert(reach / tufts.length > .85 && reach / tufts.length < 1.2, '[mid] tufts do not reach the crown rim');
  }
});

// 樹皮が無地の棒だと幹が「張りぼて」に見えた。縦の帯と割れ目、平均1の明るさ（遠景で幹の明るさが変わらない）、周期でつながること。
test('bark image is periodic, vertical and brightness neutral [bark]', () => {
  const { width, height, data, mean } = B.barkPixels();
  assert.deepEqual([width, height], [...B.BARK_SIZE], '[bark] size');
  let gain = 0, du = 0, dv = 0;
  for (let i = 0; i < data.length; i += 4) gain += data[i] * 2 / 255;
  assert(Math.abs(gain / (width * height) - 1) < .01, '[bark] mean brightness gain is not 1');
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const h = (u, v) => B.barkHeight(u / width, v / height);
    du += Math.abs(h(x + 1, y) - h(x - 1, y)); dv += Math.abs(h(x, y + 1) - h(x, y - 1));
  }
  // Measured 18x for the shipped image; horizontal fibres fall to about 3x.
  assert(du > 8 * dv, '[bark] strips and fibres are not vertical');
  for (let k = 0; k <= 8; k++) {
    assert(near(B.barkHeight(0, k / 8), B.barkHeight(1, k / 8), 1e-9), '[bark] seam around the trunk');
    assert(near(B.barkHeight(k / 8, 0), B.barkHeight(k / 8, 1), 1e-9), '[bark] seam along the trunk');
  }
  assert(mean > .2 && mean < .8, '[bark] height range');
  for (let i = 0; i < data.length; i += 4) {
    const n = [data[i + 1] / 127.5 - 1, data[i + 2] / 127.5 - 1];
    assert(Math.hypot(...n) < 1, '[bark] tilt encodes a non-unit normal');
  }
});

test('leaf tilt and colour jitter stay bounded per leaf [leaf-tilt]', () => {
  const hash = (i, k) => { const v = Math.sin(i * 127.1 + k * 311.7) * 43758.5453; return v - Math.floor(v); };
  const tilts = Array.from({ length: 300 }, (_, i) => B.leafTilt(hash, i));
  for (const t of tilts) assert(t.tilt >= .25 && t.tilt <= .7 && t.fold >= .18 && t.fold <= .32 && Math.abs(t.hue) <= 1, '[leaf-tilt] range');
  assert(std(tilts.map(t => t.hue)) > .4 && std(tilts.map(t => t.angle)) > 1.2, '[leaf-tilt] leaves share one orientation or colour');
});
