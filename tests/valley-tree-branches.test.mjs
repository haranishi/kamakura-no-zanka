// なぜ失敗したか（8.1a・2026-10-30）: 近景の杉は26段×6本の輪生カード（板）と滑らかな芯の円錐で、「張りぼて」「段の針葉樹」に見えた。
// 中景は同じ形の笠を9枚重ね、モミ・トウヒの段になった。枝が無く「棒に樹冠を載せた」見え方だった。樹皮は無地だった。
// 原因の型: whorl（同じ高さの輪生）/spiral（向きの規則）/envelope（大きさ）/tuft（房の付き方）/connection（枝と房）/mid（中景の段）/bark（樹皮）/determinism。
// 第2周（10-31・盲検）: 細い杉が「魚の骨」（同じ間隔・大きさ・角度の房）、中景が「円錐に星形の紙」、広葉が「棒の上の球」、樹皮が等間隔の縞に見えた。
// 原因の型を追加: clump（枝の疎密）/jitter（房の向き・大きさ）/broad（広葉の房の集まり）/strip（樹皮の帯の幅）。
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

// 房が枝先だけ（あるいは幹から浮いて）付くと、「棒に葉の玉」に戻る。房は枝の外側の約2/3（第2周：内側の枝を見せる）に重なり、最後は枝先。
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
      if (b.wood) { woody++; assert(b.length > 1.05 && b.t < .8, '[connection] limb flag'); }
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

// 中景の裾は9枚の同じ笠だった（段）。第1周の螺旋の大きな房と芯の円錐は、見晴らしから「円錐に星形の紙」に見えた（第2周）。
// 中景の房は近景の枝ごと（長い枝は2枚）で、近景の房の向き・色を引き継ぎ、枝の先の側に付く。
test('middle cedar tufts follow the near limbs, one per limb and two on long limbs [mid]', () => {
  for (const shape of families) {
    const limbs = B.cedarBranchPlan(shape), { tufts } = B.cedarMidPlan(shape), perLimb = new Map();
    for (const t of tufts) perLimb.set(t.limb, (perLimb.get(t.limb) ?? 0) + 1);
    assert.equal(perLimb.size, limbs.branches.length, '[mid] a near limb lost its middle tuft');
    for (const b of limbs.branches) {
      const n = perLimb.get(b.index), cover = .64 * b.length + .55 * b.tufts.at(-1).length;
      assert.equal(n, cover > 2.6 ? 2 : 1, '[mid] tufts per limb');
    }
    const ys = tufts.map(t => t.center[1]).sort((a, b) => a - b);
    // A skirt is a ring of tufts at one height: no four tufts within 5cm (two pieces of one limb may sit close).
    for (let i = 3; i < ys.length; i++) assert(ys[i] - ys[i - 3] > .05, '[mid] tufts stacked at one height (skirt)');
    for (const t of tufts) {
      const b = limbs.branches[t.limb];
      B.branchPoint(b, t.s).forEach((v, q) => assert(near(v, t.center[q]), '[mid] middle tuft off its limb'));
      assert(t.s >= .3 && t.length >= .7 && t.length <= 2.6 && Math.abs(t.width / t.length - .92) < 1e-9, '[mid] tuft placement or size');
      assert(Math.abs(Math.hypot(...t.along) - 1) < 1e-9, '[mid] tuft direction');
    }
    // The middle crown reaches as far as the near tips (the dissolve band does not shrink the crown).
    const reach = plan => Math.max(...plan.map(t => { const tip = t.center.map((v, q) => v + t.along[q] * .55 * t.length), axis = B.cedarTrunkAxis(shape, t.center[1]); return Math.hypot(tip[0] - axis[0], tip[2] - axis[2]); }));
    const nearReach = reach(limbs.branches.flatMap(b => b.tufts)), midReach = reach(tufts);
    assert(Math.abs(midReach / nearReach - 1) < .15, `[mid] middle crown ${midReach.toFixed(2)}m against near ${nearReach.toFixed(2)}m`);
  }
});

// 一様な層化の枝は、細い家族で同じ間隔の「魚の骨」に見えた。波で疎密を作る（順序は保つ）。
test('crown warp clusters limb heights without reordering them [clump]', () => {
  const wave = { k: 4, phase: 1.1, amp: .55 };
  let prev = -1, dmin = Infinity, dmax = 0;
  for (let i = 0; i <= 400; i++) {
    const s = i / 400, t = B.crownWarp(s, wave);
    assert(t >= prev - 1e-12 && t >= 0 && t <= 1, '[clump] warp reorders or leaves the crown');
    if (i) { const d = (t - prev) * 400; dmin = Math.min(dmin, d); dmax = Math.max(dmax, d); }
    prev = t;
  }
  assert(dmax / dmin > 2.5, '[clump] no dense and sparse bands');
  assert(B.crownWarp(0, wave) === 0, '[clump] crown base moved');
  assert.throws(() => B.crownWarp(.5, { k: 4, phase: 0, amp: 1 }), RangeError, '[clump] folding warp accepted');
  for (const shape of families) {
    const { branches } = B.cedarBranchPlan(shape), ys = branches.map(b => b.y).sort((a, b) => a - b);
    const gaps = ys.slice(1).map((y, i) => y - ys[i]), mean = gaps.reduce((a, b) => a + b) / gaps.length;
    // Measured .51-.59 with the warp; the same plan without it (the fishbone) gives .32-.42.
    assert(std(gaps) / mean > .46, `[clump] limb spacing too even (${(std(gaps) / mean).toFixed(2)})`);
  }
});

// 同じ角度・同じ大きさの房が枝ごとに並ぶと、櫛に見えた。房の向きは枝の接線から±.3/.25rad、大きさは約2倍の幅で揺れる。
test('tufts tilt off their limb and vary in size [jitter]', () => {
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  const angles = [];
  for (let i = 0; i < 400; i++) {
    const along = [Math.cos(i), .3 * Math.sin(i * .7), Math.sin(i)], a = B.perturbTuft(along, rnd), n = Math.hypot(...along);
    assert(near(Math.hypot(...a), 1, 1e-9), '[jitter] tuft direction not unit');
    const cos = a.reduce((m, v, q) => m + v * along[q] / n, 0); angles.push(Math.acos(Math.min(1, cos)));
  }
  assert(Math.max(...angles) < Math.hypot(.3, .25) + 1e-9, '[jitter] tuft turned too far from its limb');
  // Both turns act: the sideways one leaves the limb's vertical plane, the pitch one leaves its horizontal heading.
  let side = 0, lift = 0;
  for (let i = 0; i < 400; i++) { const along = [1, 0, 0], a = B.perturbTuft(along, rnd); side += Math.abs(a[2]); lift += Math.abs(a[1]); }
  assert(side / 400 > .05 && lift / 400 > .05, '[jitter] tufts turn only one way');
  assert(std(angles) > .05 && angles.filter(x => x > .1).length > 100, '[jitter] tufts keep the limb direction');
  assert.deepEqual(B.perturbTuft([0, 1, 0], () => .5), [0, 1, 0], '[jitter] centred draw moves a vertical tuft');
  for (const shape of families) {
    const tufts = B.cedarBranchPlan(shape).branches.flatMap(b => b.tufts.map(t => ({ t, b })));
    const off = tufts.map(({ t, b }) => Math.acos(Math.min(1, t.along.reduce((m, v, q) => m + v * B.branchTangent(b, t.s)[q], 0))));
    assert(off.filter(x => x > .08).length > .5 * off.length, '[jitter] most tufts point along their limb');
    const tips = tufts.filter(({ t }) => t.s === 1).map(({ t, b }) => t.length / (.55 + .45 * Math.min(1, b.length / 2.6)));
    assert(Math.max(...tips) / Math.min(...tips) > 1.6, '[jitter] tip tufts share one size');
  }
});

// 広葉の近景は大きな殻10個（棒の上の球）だった。房は二次の枝の先に付き、樹冠の外殻に沿って並び、間に空が抜ける。
test('broadleaf clusters sit on secondary limbs around the crown with gaps between them [broad]', () => {
  const center = [0, 8, 0], radii = [4.2, 3.6, 4.2], tips = [[1.8, 6.6, 0], [-1.2, 7.4, 1.5], [.4, 8.2, -2.2], [-1, 9, -1]];
  const plan = B.broadClusterPlan({ center, radii, tips, fork: 3.5, vase: true });
  assert.equal(plan.clusters.length, B.BROAD_CLUSTERS, '[broad] cluster count');
  assert.deepEqual(B.broadClusterPlan({ center, radii, tips, fork: 3.5, vase: true }), plan, '[broad] plan drift');
  let gaps = 0;
  for (const c of plan.clusters) {
    const r = c.center.map((v, q) => (v - center[q]) / radii[q]), depth = Math.hypot(...r);
    assert(depth > .5 && depth < 1.25, '[broad] cluster inside the trunk or outside the crown');
    // Third round: sizes 0.2-0.4 of the crown (equal shells read as a ball painted with leaves, blind review Q08/Q14).
    assert(c.radii.every((v, q) => v / radii[q] >= .17 && v / radii[q] <= .41), '[broad] cluster size');
    // The limb leaves its primary somewhere in 40-70% (one fixed fraction read as umbrella ribs, Q10) and ends inside the cluster.
    const along = [0, 1, 2].map(q => (c.limb.from[q] - plan.root[q]) / (tips[c.primary][q] - plan.root[q])).filter(Number.isFinite);
    assert(along.every(t => t >= .4 - 1e-9 && t <= .7 + 1e-9) && along.every(t => near(t, along[0])), '[broad] limb not on its primary');
    assert(Math.hypot(...c.limb.to.map((v, q) => (v - c.center[q]) / c.radii[q])) < 1, '[broad] limb ends outside its cluster');
    const nearest = Math.min(...plan.clusters.filter(o => o !== c).map(o => Math.hypot(...o.center.map((v, q) => v - c.center[q])) - Math.max(...o.radii) - Math.max(...c.radii)));
    if (nearest > -.6) gaps++;
  }
  assert(gaps >= 4, '[broad] every cluster buried in its neighbours (no sky between them)');
  // Third round: inner clusters fill the crown's hollow (from below it read as an empty painted shell, blind review Q10).
  const filled = B.broadClusterPlan({ center, radii, tips, fork: 3.5, vase: true, inner: 4 });
  assert.equal(filled.inner.length, 4, '[broad] inner fill count');
  for (const c of filled.inner) assert(Math.hypot(...c.center.map((v, q) => (v - center[q]) / radii[q])) < .5 && c.limb === null, '[broad] inner cluster outside the crown core');
  assert.deepEqual(filled.clusters, plan.clusters, '[broad] the fill moved the outer clusters');
  const leaves = plan.clusters.map(c => { const q = Math.abs(tips[c.primary][0] - plan.root[0]) > .1 ? 0 : 2; return (c.limb.from[q] - plan.root[q]) / (tips[c.primary][q] - plan.root[q]); });
  assert(Math.max(...leaves) - Math.min(...leaves) > .15, '[broad] every limb leaves its primary at one fraction (umbrella ribs)');
  const sizes = plan.clusters.map(c => c.radii[0] / radii[0]);
  assert(Math.max(...sizes) - Math.min(...sizes) > .12, '[broad] clusters of one size');
  const upper = plan.clusters.filter(c => c.center[1] > center[1]), lower = plan.clusters.filter(c => c.center[1] < center[1]);
  const spread = cs => Math.max(...cs.map(c => Math.hypot(c.center[0], c.center[2])));
  assert(spread(upper) > spread(lower), '[broad] zelkova clusters do not widen upward');
  assert.throws(() => B.broadClusterPlan({ center, radii, tips: [], fork: 3 }), RangeError, '[broad] empty limbs accepted');
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
  // 第2周: 帯の幅は不揃い（等間隔の縞に見えた）。帯の境（x の整数）を周に沿って数え、幅の比を見る。
  const edges = []; let last = Math.floor(14 * 0 + B.barkStripWarp(0));
  for (let k = 1; k <= 2800; k++) { const u = k / 2800, x = Math.floor(14 * u + B.barkStripWarp(u)); if (x !== last) { edges.push(u); last = x; } }
  const widths = edges.slice(1).map((u, i) => u - edges[i]);
  assert(edges.length === 14 && Math.max(...widths) / Math.min(...widths) > 2, '[bark] strips share one width');
  assert(near(B.barkStripWarp(0), B.barkStripWarp(1), 1e-9), '[bark] strip warp not periodic');
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

// なぜ失敗したか（8.1a第3周）: 下から見上げると、房の無い枝の内側（s<.34）が空に突き出す足場の棒に見えた（盲検 Q06）。
test('cedar tufts reach the inner quarter of long limbs [tuft-reach]', () => {
  for (let shape = 0; shape < 5; shape++) {
    const long = B.cedarBranchPlan(shape).branches.filter(b => b.wood);
    // Mean first tuft along the long limbs: .56-.61 in the second round, .49-.55 now (measured).
    const first = long.reduce((n, b) => n + b.tufts[0].s, 0) / long.length;
    assert(first < .56, `[tuft-reach] long limbs bare on their inner part (first tuft at s ${first.toFixed(3)})`);
    assert(long.every(b => b.tufts.every(t => t.s >= .24 - 1e-9)), '[tuft-reach] tuft on the trunk side of the limb');
  }
});
