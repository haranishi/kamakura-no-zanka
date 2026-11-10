import test from 'node:test';
import assert from 'node:assert/strict';
import { RIVER_ROCKS as R, riverRocks, rockCircles, rocksEnabled } from '../dist/valley/kamakura-river-rocks.js';
const channel = ({ length = 1000, width = 10, steep = false, reverse = false, mouth = true, id = 'invented' } = {}) => ({ id, enters_sea: mouth,
  xy_m: reverse ? [[0, -length], [0, 0]] : [[0, 0], [0, -length]], width_m: [width, width],
  water_elev_m: reverse ? [2, 2 + (steep ? length * .03 : 0)] : [2 + (steep ? length * .03 : 0), 2],
  bed_m: reverse ? [1, 1 + (steep ? length * .03 : 0)] : [1 + (steep ? length * .03 : 0), 1] });
const terrain = { vscale: 1, heightAt: () => 1 };
const data = options => ({ rivers: { rivers: [channel(options)] } });
test('B4 placement is deterministic, keeps the mouth/pier clear and leaves a 1.6m corridor', () => {
  const d = data(), sites = [{ minX: -8, maxX: 8, minZ: 190, maxZ: 210, piers: [{ x: -3, z: 200 }] }];
  const p = riverRocks(d, terrain, sites); assert.deepEqual(p, riverRocks(d, terrain, sites)); assert(p.rocks.length > 0);
  for (const r of p.rocks) {
    assert(r.width >= .5 && r.width <= 2.2); assert(r.along < 1000 - R.mouthClear);
    assert(Math.hypot(r.x + 3, r.z - 200) >= R.pierClear + r.width / 2);
    if (r.stream) {
      assert(r.width <= r.channelWidth / 3);
      const free = r.channelWidth / 2 + Math.abs(r.offset) - r.width / 2; assert(free >= R.passage);
    }
    assert(Math.abs(r.y - (Math.max(r.water, 1) - r.height / 3)) < 1e-12);
  }
  for (const group of p.groups) {
    const members = p.rocks.filter(r => r.group === p.groups.indexOf(group));
    assert.equal(members.length, group.count);
    if (group.stream) assert(group.count === 0 || group.count >= 2);
    if (group.stream) for (const r of members) assert.equal(Math.sign(r.offset), group.sign);
  }
  const circles = rockCircles(p.rocks); assert.equal(circles.length, p.rocks.filter(r => r.width >= 1.2).length);
});
test('B4 bank phases, density doubling, width eligibility and count limits', () => {
  const flat = riverRocks(data({ length: 1600, mouth: false }), terrain), steep = riverRocks(data({ length: 1600, steep: true, mouth: false }), terrain);
  assert(steep.groups.length > flat.groups.length * 1.7);
  const left = flat.groups.filter(g => !g.stream && g.sign < 0), right = flat.groups.filter(g => !g.stream && g.sign > 0);
  assert.notEqual(left[0].along, right[0].along);
  for (const groups of [left, right, flat.groups.filter(g => g.stream)]) for (let i = 1; i < groups.length; i++) {
    const delta = groups[i].along - groups[i - 1].along; assert(delta >= (groups[i].stream ? R.streamMin : R.bankMin)); assert(delta <= (groups[i].stream ? R.streamMax : R.bankMax));
  }
  assert.equal(riverRocks(data({ width: 3.9 }), terrain).rocks.length, 0);
  const big = data({ length: 200000 });
  assert.equal(riverRocks(big, terrain).rocks.length, R.standardCap); assert.equal(riverRocks(big, terrain, [], 'light').rocks.length, R.lightCap);
  const narrow = riverRocks(data({ width: 4 }), terrain);
  for (const r of narrow.rocks) if (r.stream) assert(r.width <= 4 / 3 && 2 >= R.passage);
});
test('B5 every stream rock has a downstream wake and upstream arc, with shared flow speed and lifted water', () => {
  for (const reverse of [false, true]) {
    const p = riverRocks(data({ reverse, steep: true }), terrain);
    const stream = p.rocks.filter(r => r.stream), wakes = p.foam.filter(f => f.kind === 0), arcs = p.foam.filter(f => f.kind === 1);
    assert.equal(wakes.length, stream.length); assert.equal(arcs.length, stream.length);
    for (let i = 0; i < stream.length; i++) {
      const r = stream[i], f = wakes[i], a = arcs[i];
      assert((f.x - r.x) * r.tx + (f.z - r.z) * r.tz > 0); assert((a.x - r.x) * r.tx + (a.z - r.z) * r.tz < 0);
      assert(f.length >= 2 * r.width && f.length <= 4 * r.width); assert.equal(f.width, 1.2 * r.width);
      assert(Math.abs(f.y - (32 - f.z * .03 + .03)) < 1e-9); assert(f.speed >= .5 && f.speed <= 1.2); assert(f.tz > 0);
    }
    assert(p.foam.some(f => f.kind === 2));
  }
  assert(!rocksEnabled('?rocks=0')); assert(!rocksEnabled('?layers=0'));
});
test('B4 mouth is the actual sea clipping point, even when the raw polyline continues offshore', () => {
  const d = data({ length: 1000 }); d.rivers.rivers[0].water_elev_m = [2, -2];
  const p = riverRocks(d, terrain); assert(p.rocks.length);
  for (const r of p.rocks) assert(r.z <= 500 - R.mouthClear);
  for (const f of p.foam) assert(f.z <= 500 - R.mouthClear);
});
