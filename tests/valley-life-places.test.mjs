// S7-A の配置の表（world-data.js の life）の約束：出し入れの条件・当たり・道と建物からの距離・踏み固めた土。
// 通行・逃げ道・戸口から持ち場への道・行き止まりは tests/valley-world.test.mjs が、life の当たりを入れた世界で確かめる（propColliders 経由）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { insideFootprint, insidePlot } from '../dist/valley/scatter.js';
import { propColliders } from '../dist/valley/world-colliders.js';
import { LIFE_ITEMS } from '../dist/valley/life-rules.js';
import { createGrassField } from '../dist/valley/grass-field.js';
import { loadView, installCanvasStub } from './helpers/valley-view-modules.mjs';

installCanvasStub();
const { KIT } = await loadView('life-kit.js');
const terrain = createTerrain(WORLD), L = WORLD.life, items = L.items;
const byId = id => items.find(d => d.id === id);
const KNEE = ['bale', 'bale_torn', 'stake', 'post', 'itabi'];                    // 膝より高い物（俵・杭・板碑）。桶や籠は倒れて膝より低い
const roadClear = (x, z) => Math.min(...terrain.roads.map(r => r.index.nearest(x, z, 40).d - r.half));
const everyPoint = () => [...items.filter(d => d.kind !== 'hit').map(d => [d.id, d.x, d.z]), ...['stones', 'tufts', 'susuki'].flatMap(k => L[k].map(([x, z], i) => [`${k}_${i}`, x, z]))];

test('every life item names a known shape, and every show names a life-rules item, its states and sane counts [life-table]', () => {
  const ids = new Set(items.map(d => d.id));
  assert.equal(ids.size, items.length, '[life-table] ids are unique');
  for (const d of items) {
    assert(KIT[d.kind] || ['stone', 'fence', 'hit'].includes(d.kind), `[life-table] ${d.id}: unknown shape ${d.kind}`);
    if (!d.show) continue;
    const rule = LIFE_ITEMS.find(i => i.id === d.show.item);
    assert(rule, `[life-table] ${d.id}: show names no life-rules item (${d.show.item})`);
    for (const s of d.show.state || []) assert(rule.states.includes(s), `[life-table] ${d.id}: ${d.show.item} has no state ${s}`);
    for (const k of ['min', 'max']) if (d.show[k] != null) assert(Number.isInteger(d.show[k]) && d.show[k] >= 1 && d.show[k] <= 6, `[life-table] ${d.id}: ${k}`);
  }
  for (const m of L.marks) if (m.show) assert(LIFE_ITEMS.some(i => i.id === m.show.item), `[life-table] mark ${m.mark}: unknown item`);
  for (const id of ['bale_row', 'camp_kitchen', 'boundary_rope', 'raid_marks', 'fallen_fence', 'captive_bow'])
    assert(items.some(d => d.show?.item === id), `[life-table] nothing on the map follows ${id}`);
});

test('colliders: only items that are always shown carry one (no invisible walls), and every knee-high item that is always shown is solid [life-hit]', () => {
  const { circles, boxes } = propColliders(WORLD), solid = [...circles, ...boxes];
  for (const d of items) if (d.hit) assert(!d.show, `[life-hit] ${d.id} can disappear, so it must not carry a collider`);
  for (const d of items.filter(d => d.hit)) assert(solid.some(c => c.id === d.id), `[life-hit] ${d.id}: collider missing`);
  for (const d of items.filter(d => KNEE.includes(d.kind) && !d.show && !(d.lift > 0.2))) {
    const covered = circles.some(c => Math.hypot(c.x - d.x, c.z - d.z) <= c.r + 0.05);
    assert(covered, `[life-hit] knee-high ${d.id} at ${d.x},${d.z} has no collider around it`);
  }
  // 場面で出入りする物に当たりを書いても、当たりにはならない（表の書き間違いの保険）
  const world = { dress: [], distant: [], life: { items: [{ id: 'x', kind: 'bale', x: 0, z: 0, hit: { r: 0.4, height: 0.4 }, show: { item: 'bale_row', min: 5 } }] } };
  assert.equal(propColliders(world).circles.length, 0, '[life-hit] an item that can disappear got a collider');
  // 組の当たりは組の俵を全部くるむ（積み増す5・6個目も、下の組の当たりの内側。新しい当たりを要らなくするため）
  for (const [owner, group] of [['bale_3', ['bale_3', 'bale_4', 'bale_5']], ['bale_1', ['bale_1', 'bale_6']]]) {
    const c = circles.find(o => o.id === owner);
    for (const id of group) { const d = byId(id); assert(Math.hypot(d.x - c.x, d.z - c.z) + 0.3 <= c.r + 0.05, `[life-hit] ${id} sticks out of the collider of ${owner}`); }
  }
});

test('nothing stands on a road tread, inside a building, or in a vegetable plot unless it is the field mess [life-clear]', () => {
  for (const [id, x, z] of everyPoint()) {
    assert(roadClear(x, z) > 0.25, `[life-clear] ${id} at ${x},${z} stands on a road (${roadClear(x, z).toFixed(2)} m beyond the tread edge)`);
    for (const b of WORLD.buildings) assert(!insideFootprint(b, x, z, -0.05), `[life-clear] ${id} is inside ${b.id}`);
    const leans = ['captive_bow', 'captive_quiver'].includes(id) ? 'cart' : null;                  // 弓と矢筒は荷車に立てかける
    for (const p of WORLD.props) if (p.id !== leans && Math.hypot(p.x - x, p.z - z) < (p.r || 0.5) + 0.05) assert.fail(`[life-clear] ${id} overlaps ${p.id}`);
    assert(terrain.waterAt(x, z) < 0.05, `[life-clear] ${id} is in water`);
  }
  for (const d of items) for (const f of WORLD.plots) if (insidePlot(f, d.x, d.z, 0)) assert(['veg', 'bucket', 'basket'].includes(d.kind), `[life-clear] ${d.id} stands in ${f.id}`);
});

test('tall things stay out of the middle of the village fight: only by a wall or by the cart [life-fight]', () => {
  const fight = { x: -11, z: 6, r: 15 }, cart = WORLD.props.find(p => p.id === 'cart');
  for (const d of items.filter(d => d.hit)) {
    if (Math.hypot(d.x - fight.x, d.z - fight.z) > fight.r) continue;
    const byWall = WORLD.buildings.some(b => insideFootprint(b, d.x, d.z, 2.5)), byCart = Math.hypot(d.x - cart.x, d.z - cart.z) < 3;
    assert(byWall || byCart, `[life-fight] ${d.id} stands in the open middle of the fight`);
  }
});

test('the shrine rope hangs between its two posts, and the shrine stands off the road [life-rope]', () => {
  const posts = ['shrine_post_l', 'shrine_post_r'].map(byId);
  for (const id of ['rope_cut', 'rope_tied']) {
    const r = byId(id), ax = Math.cos(r.rotY), az = -Math.sin(r.rotY);                    // 縄の X 軸（rotation.y で回した向き）
    const ends = [[r.x + ax * 0.8, r.z + az * 0.8], [r.x - ax * 0.8, r.z - az * 0.8]];
    for (const [x, z] of ends) assert(posts.some(p => Math.hypot(p.x - x, p.z - z) < 0.03), `[life-rope] ${id}: an end at ${x.toFixed(2)},${z.toFixed(2)} has no post`);
  }
  const shrine = WORLD.props.find(p => p.id === 'hokora1');
  assert(roadClear(shrine.x, shrine.z) > shrine.r, '[life-rope] the entrance shrine stands on the road');
});

test('trodden ground at the camp is bare earth: dirt underfoot and no grass cell inside [life-trodden]', () => {
  for (const t of L.trodden) {
    assert(terrain.surfaceAt(t.x, t.z).dirt > 0.6, `[life-trodden] ${t.x},${t.z}: not dirt`);
  }
  const f = createGrassField(WORLD, terrain);
  for (let k = 0; k < f.placeable.length; k++) {
    if (!f.placeable[k]) continue;
    const x = f.x0 + (k % f.nx) + 0.5, z = f.z0 + Math.floor(k / f.nx) + 0.5;
    for (const t of L.trodden) assert(Math.hypot(x - t.x, z - t.z) >= t.r - 0.01, `[life-trodden] grass grows at ${x},${z} on the trodden camp`);
  }
});
