import test from 'node:test';
import assert from 'node:assert/strict';
import { BRIDGES, bridgeSites, deckHeight, withBridgeDecks, bridgeRailBoxes, addBridgeRails, bridgesEnabled, bridgeRange } from '../dist/valley/kamakura-bridges.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { decodeRoads } from '../dist/valley/kamakura-roads.js';
// This analytic channel and all coordinates are invented. The road runs east across a north/south river.
export function bridgeWorld({ width = 8, banks = 1.1, cut = true, offset = 0, water = .5 } = {}) {
  const heightAt = x => banks * Math.min(1, Math.max(0, (Math.abs(x - offset) - width / 2) / 2));
  const bounds = { minX: -1000, maxX: 1000, minZ: -1000, maxZ: 1000 };
  const terrain = { vscale: 1, bounds, heightAt, slopeAt: () => 30, waterAt: (x) => Math.abs(x - offset) < width / 2 ? .4 : 0,
    insideA: () => true, walkable: () => true, movementBlockedAt: () => null, surfaceAt: () => 'original', normalAt: () => ({ x: 0, y: 1, z: 0 }) };
  const road = (xyz_m, width_m = 4, route_id = 'invented road') => ({ xyz_m, width_m, route_id, kind: 'kaido', name: 'test' });
  const roads = cut ? { 'test:0': road([[-40 + offset, 0, 0], [-width / 2 - 2 + offset, 0, 0]]), 'test:1': road([[width / 2 + 2 + offset, 0, 0], [40 + offset, 0, 0]]) } : { test: road([[-40 + offset, 0, 0], [40 + offset, 0, 0]]) };
  const river = { id: 'invented river', enters_sea: false, xy_m: [[offset, 150], [offset, -150]], width_m: [width, width], bed_m: [0, 0], water_elev_m: [water, water] };
  return { data: { roads, rivers: { rivers: [river] } }, terrain };
}
test('B1 split endpoints and continuous road produce the same deterministic bridge', () => {
  for (const cut of [true, false]) {
    const { data, terrain } = bridgeWorld({ cut }), sites = bridgeSites(data, terrain);
    assert.equal(sites.length, 1); assert.deepEqual(sites, bridgeSites(structuredClone(data), terrain));
    const s = sites[0]; assert.equal(s.x, 0); assert(Math.abs(s.z) < 1e-9); assert.equal(s.ux, 1); assert(Math.abs(s.uz) < 1e-9);
    assert(s.span >= BRIDGES.minSpan && s.span <= BRIDGES.maxSpan); assert.equal(s.width, 4);
  }
});
test('B1 endpoint route identity, opposite facing, gap, broad mouth and no roads', () => {
  for (const mutate of [d => d.roads['test:1'].route_id = 'other', d => d.roads['test:1'].xyz_m.reverse(), d => d.rivers.rivers.length = 0]) {
    const { data, terrain } = bridgeWorld(); mutate(data); if (data.rivers.rivers.length) { // reversing a line leaves its geometric ends intact.
      if (data.roads['test:1'].route_id === 'other') assert.equal(bridgeSites(data, terrain).length, 0);
    } else assert.deepEqual(bridgeSites(data, terrain), []);
  }
  const broad = bridgeWorld({ width: 40 }); assert.equal(bridgeSites(broad.data, broad.terrain).length, 0);
  const empty = bridgeWorld(); empty.data.roads = {}; assert.equal(bridgeSites(empty.data, empty.terrain).length, 0);
  const gap = bridgeWorld(); gap.data.roads['test:0'].xyz_m[1][0] = -30; gap.data.roads['test:1'].xyz_m[0][0] = 30; assert.equal(bridgeSites(gap.data, gap.terrain).length, 0);
});
test('B1 decoded road IDs recover the exporter route convention without changing roads', () => {
  const { data, terrain } = bridgeWorld(); data.roads = decodeRoads({ schema: 'kz-roads/0.1', count: 2, roads: data.roads });
  assert.equal(bridgeSites(data, terrain).length, 1);
});
test('B1 near crossings keep the wide road; per-river and global limits', () => {
  const { data, terrain } = bridgeWorld({ cut: false });
  data.roads = Object.fromEntries(Array.from({ length: 30 }, (_, i) => ['road' + i, { ...data.roads.test, width_m: i ? 2 : 20, xyz_m: [[-40, i * 10, 0], [40, i * 10, 0]] }]));
  const sites = bridgeSites(data, terrain); assert(sites.length <= BRIDGES.perRiver); assert.equal(sites[0].roadWidth, 20); assert.equal(sites[0].width, 4.5);
  for (const s of sites.slice(1)) assert(Math.hypot(s.x - sites[0].x, s.z - sites[0].z) > 40);
  data.rivers.rivers = Array.from({ length: 10 }, (_, i) => ({ ...data.rivers.rivers[0], id: 'r' + i, xy_m: [[i * 80, 500], [i * 80, -500]] }));
  for (const r of Object.values(data.roads)) r.xyz_m = [[-40, r.xyz_m[0][1], 0], [900, r.xyz_m[0][1], 0]];
  assert(bridgeSites(structuredClone(data), terrain).length <= BRIDGES.total);
});
test('B2 camber, clearance, approach slope and three-dimensional quality ranges', () => {
  const { data, terrain } = bridgeWorld(), s = bridgeSites(data, terrain)[0]; assert(s);
  assert.equal(deckHeight(s, (s.left + s.right) / 2), s.deck + s.rise);
  assert(s.deck - BRIDGES.thickness - s.water >= .6 - 1e-9);
  for (let u = s.start; u < s.end; u += .05) assert(Math.abs(deckHeight(s, u + .01) - deckHeight(s, u)) / .01 <= Math.tan(8 * Math.PI / 180) + .001);
  assert.equal(bridgeRange(), 4000); assert.equal(bridgeRange('light'), 2500); assert.equal(bridgeRange('standard', 3), 1200);
});
test('B3 decks preserve exterior bits and all unrelated references; disable is identity', () => {
  const { data, terrain } = bridgeWorld(), sites = bridgeSites(data, terrain), t = withBridgeDecks(terrain, sites);
  assert.equal(withBridgeDecks(terrain, sites, false), terrain); assert.equal(withBridgeDecks(terrain, []), terrain); assert(!bridgesEnabled('?bridges=0'));
  for (const name of ['surfaceAt', 'normalAt', 'bounds', 'insideA']) assert.equal(t[name], terrain[name]);
  assert.equal(t.heightAt(500, 500), terrain.heightAt(500, 500)); assert.equal(t.waterAt(500, 500), terrain.waterAt(500, 500)); assert.equal(t.slopeAt(500, 500), terrain.slopeAt(500, 500));
  assert(t.heightAt(0, 0) > terrain.heightAt(0, 0)); assert.equal(t.waterAt(0, 0), 0);
  const s = sites[0]; for (const u of [s.start, s.end]) assert(Math.abs(t.heightAt(u, 0) - terrain.heightAt(u, 0)) < .15);
  // Terrain protruding above the boards always wins.
  const raised = { ...terrain, heightAt: () => 50 }; assert.equal(withBridgeDecks(raised, sites).heightAt(0, 0), 50);
});
test('B3 actual moveActor crosses from the road and cannot enter a deck from the river side', () => {
  const { data, terrain } = bridgeWorld(), sites = bridgeSites(data, terrain), t = withBridgeDecks(terrain, sites), s = sites[0];
  const col = buildColliders({ bounds: terrain.bounds }), release = addBridgeRails(col, sites, terrain);
  let p = { x: -30, z: 0, y: terrain.heightAt(-30, 0) };
  for (let i = 0; i < 300; i++) p = moveActor(col, t, p, .2, 0);
  assert(p.x > 25); assert.equal(p.y, t.heightAt(p.x, p.z));
  p = { x: 0, z: -10, y: terrain.heightAt(0, -10) }; let lifted = false;
  for (let i = 0; i < 100; i++) { p = moveActor(col, t, p, 0, .2); if (p.y > .01) lifted = true; }
  assert.equal(lifted, false); assert(p.z < -s.width / 2);
  assert.equal(col.boxes.length, 2); for (const b of bridgeRailBoxes(sites, terrain)) assert(terrain.heightAt(b.x, b.z) + b.height >= s.deck + s.rise + .75 - 1e-9);
  release(); release(); assert.equal(col.boxes.length, 0); assert.equal(col.grid.size, 0);
});
test('B1 oblique road direction and exact footprint rotation; unsupported ramps are rejected', () => {
  const { data, terrain } = bridgeWorld({ cut: false }); data.roads.test.xyz_m = [[-40, -20, 0], [40, 20, 0]];
  const s = bridgeSites(data, terrain)[0]; assert(s); assert(Math.abs(s.ux - 2 / Math.sqrt(5)) < 1e-9); assert(Math.abs(s.uz + 1 / Math.sqrt(5)) < 1e-9);
  const t = withBridgeDecks(terrain, [s]); assert.equal(t.waterAt(s.x, s.z), 0); assert(t.heightAt(s.x, s.z) > terrain.heightAt(s.x, s.z));
  assert.equal(bridgeSites(bridgeWorld().data, { ...terrain, heightAt: () => 0 }).length, 0);
});
test('B2 pier rows stay 4m apart, reach the riverbed, and the 6m bridge still has paired piles', () => {
  for (const width of [2, 8, 16, 24]) {
    const { data, terrain } = bridgeWorld({ width, cut: false }), sites = bridgeSites(data, terrain);
    for (const s of sites) {
      assert(s.piers.length >= 2); assert.equal(s.piers.length % 2, 0);
      for (let i = 2; i < s.piers.length; i += 2) assert(Math.abs(s.piers[i].u - s.piers[i - 2].u - 4) < 1e-9);
      for (const p of s.piers) { assert.equal(p.bottom, terrain.heightAt(p.x, p.z)); assert(p.top > p.bottom); }
    }
  }
});
test('B3 a high original bank beside a deck cannot create a negative-height rail box', () => {
  const { data, terrain } = bridgeWorld(), sites = bridgeSites(data, terrain);
  const uneven = { ...terrain, heightAt: (x, z) => Math.abs(z) > 2 ? 20 : terrain.heightAt(x, z) };
  for (const box of bridgeRailBoxes(sites, uneven)) assert(box.height >= BRIDGES.railHeight);
  const col = buildColliders({ bounds: terrain.bounds }), release = addBridgeRails(col, sites, uneven);
  assert.equal(col.boxes.length, 2); release();
});
