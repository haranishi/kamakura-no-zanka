import test from 'node:test';
import assert from 'node:assert/strict';
import { LAYER, poseAt, createSwordLayer } from '../dist/valley/sword-layer.js';
import { S_CLEAR, S_OUT, SAYA_BACK_MAX } from '../dist/valley/sword-path.js';
const close = (a, b, e = 1e-12) => assert.ok(Math.abs(a - b) <= e, `${a} != ${b}`);
const drawn = () => createSwordLayer({ u: 1 });
const drawing = () => { const l = createSwordLayer(); l.requestDraw(); l.tick(.1); return l; };
const sheathing = () => { const l = drawn(); l.requestSheathe(); l.tick(.1); return l; };
const makers = { sheathed: () => createSwordLayer(), drawing, drawn, sheathing };

test('LAYERの時間と区間は設計値を保持する', () => {
  assert.deepEqual(LAYER, { drawSeconds: .62, sheatheSeconds: .70, snapSeconds: .15, snapPullSeconds: .07, snapSettleSeconds: .07, reachEnd: .30, pullEnd: .68, sayaBackFrom: .40, sayaReturnFrom: .74 });
});
test('全状態の要求受理表: 通常抜刀・高速抜刀・納刀', () => {
  for (const [mode, expected] of Object.entries({ sheathed: [true, true, false], drawing: [false, true, false], drawn: [false, false, true], sheathing: [true, true, false] })) {
    for (let i = 0; i < 3; i++) {
      const l = makers[mode](), before = l.snapshot();
      const ok = i === 0 ? l.requestDraw() : i === 1 ? l.requestDraw({ fast: true }) : l.requestSheathe();
      assert.equal(ok, expected[i], `${mode}, ${i}`);
      if (!ok) assert.deepEqual(l.snapshot(), before);
      else assert.equal(l.snapshot().mode, i === 2 ? 'sheathing' : 'drawing');
    }
  }
});
test('落ち着いた抜刀と納刀の速さ・所要時間・終端', () => {
  const l = createSwordLayer(); assert.deepEqual(l.snapshot(), { mode: 'sheathed', u: 0 });
  l.requestDraw(); close(l.tick(.31).u, .5); assert.equal(l.snapshot().mode, 'drawing');
  assert.deepEqual(l.tick(.31).events, ['clear', 'drawn']); assert.deepEqual(l.snapshot(), { mode: 'drawn', u: 1 });
  l.requestSheathe(); close(l.tick(.35).u, .5); assert.equal(l.snapshot().mode, 'sheathing');
  assert.deepEqual(l.tick(.35).events, ['seat', 'sheathed']); assert.deepEqual(l.snapshot(), { mode: 'sheathed', u: 0 });
});
test('全進捗でfastは60Hzの9コマ・snapSeconds以内に完了する', () => {
  for (let i = 0; i < 100; i++) {
    const l = createSwordLayer({ u: i / 100 }); l.requestDraw({ fast: true });
    let frames = 0;
    while (l.snapshot().mode !== 'drawn' && frames < 10) { l.tick(1 / 60); frames++; }
    assert.ok(frames / 60 <= LAYER.snapSeconds); assert.equal(l.snapshot().u, 1);
  }
});
test('fastの再要求は速さを下げず、通常要求は進行中に拒否する', () => {
  const l = createSwordLayer(); l.requestDraw({ fast: true }); l.tick(.02);
  const before = l.snapshot().u; assert.equal(l.requestDraw(), false); assert.equal(l.requestDraw({ fast: true }), true);
  close(l.tick(.02).u - before, .02 * LAYER.pullEnd / LAYER.snapPullSeconds); assert.equal(l.tick(.2).mode, 'drawn');   // 引く区間は、決まった時間で通る
  const almost = createSwordLayer({ u: .99 }); almost.requestDraw({ fast: true });
  assert.equal(almost.tick(.01).mode, 'drawn', '通常の速さより遅くしない');
});
test('納刀の全進捗で通常要求でも反転し、位置を飛ばさずsnapSeconds以内に戻る', () => {
  for (let i = 1; i < 100; i++) {
    const l = drawn(); l.requestSheathe(); l.tick(.70 * i / 100);
    const before = l.snapshot().u; assert.equal(l.requestDraw(), true); assert.equal(l.snapshot().u, before);
    let previous = before;
    for (let n = 0; n < 10; n++) { const r = l.tick(1 / 60); assert.ok(r.u >= previous); previous = r.u; }
    assert.equal(l.snapshot().mode, 'drawn'); assert.equal(l.snapshot().u, 1);
  }
});
test('clearはsがS_CLEARを越えたtickだけに1回出る', () => {
  const l = createSwordLayer(); l.requestDraw(); let previous = l.tick(0), count = 0;
  for (let i = 0; i < 100; i++) {
    const r = l.tick(1 / 120), crossed = previous.pose.s <= S_CLEAR && r.pose.s > S_CLEAR;
    assert.equal(r.events.includes('clear'), crossed); count += r.events.filter(e => e === 'clear').length;
    previous = r;
  }
  assert.equal(count, 1);
});
test('seatは納刀でsが0.03以下に入るtickだけに1回出る', () => {
  const l = drawn(); l.requestSheathe(); let previous = l.tick(0), count = 0;
  for (let i = 0; i < 100; i++) {
    const r = l.tick(1 / 120), crossed = previous.pose.s > .03 && r.pose.s <= .03;
    assert.equal(r.events.includes('seat'), crossed); count += r.events.filter(e => e === 'seat').length;
    previous = r;
  }
  assert.equal(count, 1);
});
test('clearとseatは境界の直前・直後に出し、逆方向では出さない', () => {
  for (const [threshold, direction, event] of [[S_CLEAR, 1, 'clear'], [.03, -1, 'seat']]) {
    let lo = .3, hi = .68;
    for (let n = 0; n < 60; n++) { const mid = (lo + hi) / 2; if (poseAt(mid).s <= threshold) lo = mid; else hi = mid; }
    const eps = 1e-7, u = (lo + hi) / 2;
    const l = direction > 0 ? createSwordLayer({ u: u - eps }) : drawn();
    if (direction < 0) { l.requestSheathe(); l.tick((1 - u - eps) * .7); }
    assert.deepEqual(l.tick(eps * (direction > 0 ? .62 : .7) / 2).events, []);
    assert.deepEqual(l.tick(eps * (direction > 0 ? .62 : .7) * 2).events, [event]);
  }
});
test('往復するたびにclear・seatを再通知し、終端通知を重複させない', () => {
  const l = createSwordLayer(), events = [];
  l.requestDraw(); events.push(...l.tick(10).events);
  l.requestSheathe(); events.push(...l.tick(.70 * .66).events); // u=.34、seat通過後
  assert.ok(l.snapshot().u > 0); l.requestDraw(); events.push(...l.tick(.2).events);
  l.requestSheathe(); events.push(...l.tick(10).events);
  assert.deepEqual(events, ['clear', 'drawn', 'seat', 'clear', 'drawn', 'seat', 'sheathed']);
  for (let n = 0; n < 10; n++) assert.deepEqual(l.tick(1).events, []);
});
test('clearを下回ってから反転すると再度clearが出る。未通過なら出さない', () => {
  for (const u of [.60, .66, .9]) {
    const l = drawn(); l.requestSheathe(); l.tick((1 - u) * .7); l.requestDraw();
    assert.deepEqual(l.tick(.2).events, poseAt(u).s <= S_CLEAR ? ['clear', 'drawn'] : ['drawn']);
  }
});
test('dt=0・負・NaNで状態と姿勢は動かず通知も出ない', () => {
  for (const make of Object.values(makers)) {
    const l = make(), before = l.snapshot();
    for (const dt of [0, -1, NaN, -Infinity]) {
      const r = l.tick(dt); assert.deepEqual(l.snapshot(), before); assert.deepEqual(r.events, []); assert.deepEqual(r.pose, poseAt(before.u));
    }
  }
});
test('大きなdtも端点へクランプし、同tickの通過順序で通知する', () => {
  for (const dt of [1000, Infinity]) {
    const l = createSwordLayer(); l.requestDraw();
    assert.deepEqual(l.tick(dt).events, ['clear', 'drawn']); assert.equal(l.snapshot().u, 1);
    assert.deepEqual(l.tick(dt).events, []); l.requestSheathe();
    assert.deepEqual(l.tick(dt).events, ['seat', 'sheathed']); assert.equal(l.snapshot().u, 0);
  }
});
test('resetは両端状態に戻し、古い通知を残さずsnapshotは独立する', () => {
  const l = drawing(), s = l.snapshot(); s.u = 999; assert.ok(l.snapshot().u < 1);
  for (const mode of ['drawn', 'sheathed']) {
    l.reset(mode); assert.deepEqual(l.snapshot(), { mode, u: mode === 'drawn' ? 1 : 0 }); assert.deepEqual(l.tick(0).events, []);
  }
  assert.throws(() => l.reset('drawing'), RangeError); assert.deepEqual(l.snapshot(), { mode: 'sheathed', u: 0 });
});
test('生成時のuはクランプし、中間からは通常の抜刀を再開する', () => {
  for (const [u, expected] of [[-1, 0], [2, 1], [NaN, 0]]) assert.equal(createSwordLayer({ u }).snapshot().u, expected);
  const l = createSwordLayer({ u: .4 }); assert.equal(l.snapshot().mode, 'drawing'); close(l.tick(.062).u, .5);
});
test('同じ要求とdt列には同じ出力を返し、別インスタンスに影響しない', () => {
  const run = () => {
    const l = createSwordLayer(), out = [];
    l.requestDraw(); for (const dt of [0, .017, .043, .09, .18, .31]) out.push(l.tick(dt));
    l.requestSheathe(); out.push(l.tick(.11)); l.requestDraw();
    for (const dt of [.01, .03, .08, 0]) out.push(l.tick(dt));
    l.requestSheathe(); out.push(l.tick(1)); return out;
  };
  const first = run(), unrelated = drawing(); unrelated.tick(100);
  assert.deepEqual(first, run());
});
test('poseAtの区間境界・中間値・表示切替が契約どおり', () => {
  assert.deepEqual(poseAt(0), { s: 0, sayaBack: 0, twistDeg: 0, ikRight: 0, ikLeft: 0, handBlend: 0, swordShown: false, hipHiltShown: true });
  assert.deepEqual(poseAt(1), { s: S_OUT, sayaBack: 0, twistDeg: 0, ikRight: 0, ikLeft: 0, handBlend: 1, swordShown: true, hipHiltShown: false });
  for (const u of [.0001, .15, .3, .49, .68, .84, .9999]) {
    const p = poseAt(u); assert.equal(p.swordShown, true); assert.equal(p.hipHiltShown, false);
  }
  close(poseAt(.3).s, 0); close(poseAt(.49).s, S_OUT / 2); close(poseAt(.68).s, S_OUT);
  close(poseAt(.15).ikRight, .5); close(poseAt(.3).ikRight, 1); close(poseAt(.84).ikRight, .5);
  close(poseAt(.15).ikLeft, .5); close(poseAt(LAYER.sayaReturnFrom).ikLeft, 1); close(poseAt((LAYER.sayaReturnFrom + 1) / 2).ikLeft, .5);   // 左手は鞘が戻るまで添える
  const back = LAYER.sayaReturnFrom, mid = (back + 1) / 2;   // 鞘が戻り始める進み具合と、その中間
  close(poseAt(.4).sayaBack, 0); close(poseAt(.68).sayaBack, SAYA_BACK_MAX); close(poseAt(back).sayaBack, SAYA_BACK_MAX); close(poseAt(mid).sayaBack, SAYA_BACK_MAX / 2);
  close(poseAt(.3).twistDeg, 28); close(poseAt(.68).twistDeg, 35); close(poseAt(.84).twistDeg, 17.5);
  close(poseAt(.84).handBlend, .5); close(poseAt(.68).handBlend, 0);
  assert.deepEqual(poseAt(-1), poseAt(0)); assert.deepEqual(poseAt(2), poseAt(1));
});
test('poseAtの全数値成分は細かなuの隣同士で連続、範囲内で有限', () => {
  const keys = ['s', 'sayaBack', 'twistDeg', 'ikRight', 'ikLeft', 'handBlend'];
  const maxima = [S_OUT, SAYA_BACK_MAX, 35, 1, 1, 1], rate = [4, 4, 200, 6, 10, 6];
  let previous = poseAt(0);
  for (let i = 1; i <= 20000; i++) {
    const p = poseAt(i / 20000);
    keys.forEach((key, j) => {
      assert.ok(Number.isFinite(p[key])); assert.ok(p[key] >= 0 && p[key] <= maxima[j]);
      assert.ok(Math.abs(p[key] - previous[key]) <= rate[j] / 20000, key);
    });
    assert.ok(p.ikLeft >= p.ikRight - 1e-12); previous = p;
  }
});

test('納刀を要求した直後（uがまだ1）でも、抜刀の要求は受理され、納刀は取り消される', () => {
  for (const fast of [false, true]) {
    const l = drawn(); assert.equal(l.requestSheathe(), true); assert.equal(l.snapshot().mode, 'sheathing'); assert.equal(l.snapshot().u, 1);
    assert.equal(l.requestDraw({ fast }), true);
    const r = l.tick(1 / 60); assert.equal(r.mode, 'drawn'); assert.equal(r.u, 1);          // u=1 のまま、抜いた状態へ戻る
    assert.deepEqual(r.events.filter(e => e === 'seat' || e === 'sheathed'), []);
  }
  const d = drawn(); assert.equal(d.requestDraw(), false, '抜いた状態への要求は、今までどおり拒否');
});
