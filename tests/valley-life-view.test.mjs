// S7-A 暮らしの小物の型（life-kit.js）と置き方（life-view.js）の試験。Node で three.js の形を作り、描かずに確かめる。
// 見た目そのもの（色・絵肌）はブラウザの固定画角（tools/scenarios/capture-set.mjs の 08・09・19・25・26）で見る。
import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, loadView, installCanvasStub } from './helpers/valley-view-modules.mjs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { lifeScene, lifeItem } from '../dist/valley/life-rules.js';

installCanvasStub();
const { buildLifeKit, KIT } = await loadView('life-kit.js');
const { buildLifeView, NEAR_SMALL } = await loadView('life-view.js');
const terrain = createTerrain(WORLD);
// 柵と大岩は読み込んだ模型の代わり（柵は4部品・影を落とす、岩は1部品）
const part = (w, h, d) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0), new THREE.MeshStandardMaterial()); m.castShadow = true; m.receiveShadow = true; return m; };
const models = () => { const fence = new THREE.Group(); for (let i = 0; i < 4; i++) fence.add(part(2.6, 1.4, 0.3)); const boulder_lo = new THREE.Group(); boulder_lo.add(part(2.7, 1.5, 2)); return { fence, boulder_lo }; };
const raid = (extra = {}) => lifeScene({ beat: 'b4_village', approach: 'front', food: 60, ...extra });
const view = (q = 'standard') => { let quality = q; const v = buildLifeView({ world: WORLD, terrain, models: models(), quality: () => quality }); v.setQ = x => { quality = x; }; return v; };
const setOf = (v, kind) => v.debug.sets.find(s => s.kind === kind);
const visible = (v, id) => { for (const s of v.debug.sets) { const k = s.list.findIndex(d => d.id === id); if (k >= 0) return s.meshes[0].getVisibleAt(k); } throw Error('no ' + id); };
const box = kind => { const g = buildLifeKit().models[kind].children[0].geometry; g.computeBoundingBox(); return g.boundingBox; };

test('kit: every shape is one mesh with uv inside its cell, vertex colours, few triangles, and no shadow [kit-shapes]', () => {
  const kit = buildLifeKit();
  for (const kind of Object.keys(KIT)) {
    const g = kit.models[kind];
    assert.equal(g.children.length, 1, `[kit-shapes] ${kind}: one mesh (one draw when batched)`);
    const m = g.children[0], geo = m.geometry, tris = geo.index.count / 3;
    for (const a of ['position', 'normal', 'uv', 'color']) assert(geo.attributes[a], `[kit-shapes] ${kind}: ${a}`);
    assert(geo.attributes.uv.array.every(u => u >= 0 && u <= 1), `[kit-shapes] ${kind}: uv outside the texture`);
    assert(geo.attributes.position.array.every(Number.isFinite), `[kit-shapes] ${kind}: broken vertex`);
    assert(tris > 4 && tris <= 1600, `[kit-shapes] ${kind}: ${tris} triangles`);
    assert.equal(m.castShadow, false, `[kit-shapes] ${kind}: small props must not cast shadows (they sit on a dark disc)`);
  }
  assert(!kit.materials.ember.emissive.equals(new THREE.Color(0)) && kit.materials.kit.emissive.equals(new THREE.Color(0)), '[kit-shapes] only the embers glow');
});

// 閉じた形（と、口が地面の高さにある形）は、面の表が外を向く：原点まわりの符号付き体積が正になる。裏返しだと外から見て内側の面が写る。
const signedVolume = g => { const p = g.attributes.position, ix = g.index.array, a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(); let v = 0;
  for (let i = 0; i < ix.length; i += 3) { a.fromBufferAttribute(p, ix[i]); b.fromBufferAttribute(p, ix[i + 1]); c.fromBufferAttribute(p, ix[i + 2]); v += a.dot(b.cross(c)) / 6; } return v; };
test('kit: solid shapes face outward (a shape turned inside out shows its inner wall from outside) [kit-outward]', () => {
  const kit = buildLifeKit();
  for (const kind of ['bale', 'bale_torn', 'rice', 'pot', 'ladle', 'bucket', 'basket', 'hearth', 'stake', 'post', 'door', 'itabi', 'embers', 'brush'])
    assert(signedVolume(kit.models[kind].children[0].geometry) > 0, `[kit-outward] ${kind} is inside out`);
});

test('kit: shapes stand on the ground at their real size (bale, bucket, stake, post, door, itabi, mat, rope, flag, hedge) [kit-sizes]', () => {
  const near = (v, want, eps, label) => assert(Math.abs(v - want) <= eps, `[kit-sizes] ${label}: ${v.toFixed(3)} vs ${want}`);
  let b = box('bale'); near(b.max.x - b.min.x, 0.75, 0.05, 'bale length'); near(b.max.y, 0.39, 0.04, 'bale height'); assert(b.min.y > -0.03, '[kit-sizes] bale sinks');
  b = box('bucket'); near(b.max.y, 0.3, 0.01, 'bucket height'); near(b.max.x * 2, 0.34, 0.01, 'bucket width');
  b = box('stake'); near(b.max.y, 0.9, 0.01, 'stake height'); b = box('post'); near(b.max.y, 1.5, 0.01, 'post height');   // 第3周で1.15→1.5m（注連縄を大きく）
  b = box('door'); near(b.max.y, 1.74, 0.01, 'door height'); near(b.max.x * 2, 0.88, 0.01, 'door width');
  b = box('itabi'); near(b.max.y, 1.0, 0.01, 'itabi top'); near(b.min.y, -0.15, 0.01, 'itabi buried part'); near(b.max.z - b.min.z, 0.035, 0.002, 'itabi thickness');
  b = box('mat'); assert(b.max.y < 0.07, '[kit-sizes] the mat lies flat');
  b = box('rope_tied'); near(b.max.x, 1.05 + 0.11, 0.03, 'rope reaches the right post'); near(b.min.x, -1.05 - 0.11, 0.03, 'rope reaches the left post');
  near(b.max.y, 1.35 + 0.075, 0.03, 'rope is tied at 1.35 m');
  b = box('flag'); near(b.max.y, 3.2, 0.03, 'flag pole height'); assert(b.max.x > 0.4 && b.min.y > -0.01, '[kit-sizes] the flag cloth hangs from the crossbar');
  b = box('hedge'); near(b.max.x - b.min.x, 1.62, 0.04, 'hedge length'); assert(b.max.y > 0.75 && b.max.y < 0.98, '[kit-sizes] hedge height');
});

test('one batched draw per shape, whatever the number placed; the loaded models are not changed [life-draws]', () => {
  const m = models(), before = JSON.stringify([m.fence.children.map(c => [c.geometry.uuid, c.castShadow]), m.boulder_lo.children[0].geometry.uuid]);
  const v = buildLifeView({ world: WORLD, terrain, models: m });
  assert.equal(v.group.name, 'life');
  const batched = [], plain = [];
  v.group.traverse(o => { if (o.isBatchedMesh) batched.push(o); else if (o.isMesh) plain.push(o); });
  const kinds = new Set(v.debug.sets.map(s => s.kind));
  assert.equal(batched.length, kinds.size + (kinds.has('fence') ? 3 : 0) + 1, '[life-draws] one batch per shape (+3 for the 4-part fence, +1 for the crows)');
  assert(batched.length + plain.length <= 40, `[life-draws] ${batched.length + plain.length} draws for the whole of S7-A`);
  assert(setOf(v, 'stone').list.length === WORLD.life.stones.length + 1 && setOf(v, 'tuft').list.length === WORLD.life.tufts.length, '[life-draws] scattered stones and tufts are batched, not copied');
  assert(plain.every(p => p.name === 'life-marks' && !p.castShadow), '[life-draws] the only plain meshes are the ground marks');
  assert.equal(JSON.stringify([m.fence.children.map(c => [c.geometry.uuid, c.castShadow]), m.boulder_lo.children[0].geometry.uuid]), before, '[life-draws] models untouched');
});

test('raid, rescue and the archer: the cut rope, the embers and the bow show only when life-rules says so [life-states]', () => {
  const v = view();
  v.apply(raid());
  assert(visible(v, 'rope_cut') && !visible(v, 'rope_tied'), '[life-states] the rope hangs cut during the raid');
  assert(visible(v, 'embers') && visible(v, 'captive_bow') && visible(v, 'captive_quiver'), '[life-states] embers and the bow on the cart during the raid');
  assert(visible(v, 'front_flag') && visible(v, 'north_hedge_1') && visible(v, 'south_hedge_1'), '[life-states] the three roads are marked during the raid');
  v.apply(lifeScene({ beat: 'b5_archer', approach: 'front', food: 60 }));
  assert(!visible(v, 'rope_cut') && visible(v, 'rope_tied'), '[life-states] the rope is tied again after the rescue');
  assert(!visible(v, 'embers'), '[life-states] the embers go cold after the rescue');
  assert(!visible(v, 'front_flag'), '[life-states] the enemy flag on the front road is pulled out after the rescue');
  assert(visible(v, 'captive_bow'), '[life-states] the bow stays until Yajuro joins');
  v.apply(lifeScene({ beat: 'b5_archer', approach: 'front', food: 60, archerJoined: true }));
  assert(!visible(v, 'captive_bow') && !visible(v, 'captive_quiver'), '[life-states] the bow leaves the cart when Yajuro joins');
  v.apply(null);
  assert(!visible(v, 'rope_cut') && !visible(v, 'rope_tied') && visible(v, 'bale_1'), '[life-states] without a scene, only the always-shown things');
});

test('damage: the bale row, the leaning fence and the field mess follow the counts of life-rules [life-damage]', () => {
  const v = view(), row = ['bale_1', 'bale_2', 'bale_3', 'bale_4', 'bale_5', 'bale_6'];
  for (const [input, level] of [[{ beat: 'b3_viewpoint' }, 1], [{ beat: 'b4_village', approach: 'flank', food: 60 }, 1], [{ beat: 'b4_village', approach: 'front', food: 60 }, 2], [{ beat: 'b4_village', approach: 'front', food: 20 }, 3]]) {
    const scene = lifeScene(input); v.apply(scene);
    assert.equal(scene.damage.level, level);
    assert.equal(row.filter(id => visible(v, id)).length, lifeItem(scene, 'bale_row').count, `[life-damage] bales at level ${level}`);
    assert.equal(visible(v, 'fence_b_lean'), lifeItem(scene, 'fallen_fence').count === 2, `[life-damage] the second fence section leans only at level 3 (${level})`);
    assert.equal(visible(v, 'fence_b_stand'), !visible(v, 'fence_b_lean'), '[life-damage] the second section is either standing or leaning');
    assert(visible(v, 'fence_down'), '[life-damage] one section is always down');
    const veg = setOf(v, 'veg'), shown = veg.list.filter((d, k) => veg.meshes[0].getVisibleAt(k)).length;
    assert.equal(shown, [0, 3, 5, 7][level], `[life-damage] scattered greens at level ${level}`);
    const marks = v.debug.marks.filter(m => m.show?.item === 'raid_marks');
    for (const m of marks) assert.equal(m.mesh.visible, level >= m.show.min, `[life-damage] field marks min ${m.show.min} at level ${level}`);
  }
});

test('small things are not drawn beyond 25 m (15 m in light quality), big things stay for the view from the rock [life-near]', () => {
  const v = view(), cam = new THREE.PerspectiveCamera(), sandal = WORLD.life.items.find(d => d.id === 'sandal');
  v.apply(raid());
  cam.position.set(sandal.x + 40, 5, sandal.z); v.update(1, cam);
  assert(!visible(v, 'sandal') && visible(v, 'bale_1') && visible(v, 'itabi'), '[life-near] at 40 m the sandal is hidden, the bales and the stone slab stay');
  cam.position.set(sandal.x + 10, 5, sandal.z); v.update(1.1, cam);
  assert(visible(v, 'sandal'), '[life-near] at 10 m the sandal shows');
  cam.position.set(sandal.x + 20, 5, sandal.z); v.update(1.2, cam);
  assert(visible(v, 'sandal'), '[life-near] at 20 m in standard quality');
  v.setQ('light'); v.update(1.3, cam);
  assert(!visible(v, 'sandal'), `[life-near] at 20 m in light quality (limit ${NEAR_SMALL.light} m)`);
  v.apply(lifeScene({ beat: 'b5_archer', approach: 'front', food: 60, archerJoined: true }));
  cam.position.set(sandal.x + 5, 5, sandal.z); v.update(1.4, cam);
  assert(!visible(v, 'captive_bow'), '[life-near] being near does not bring back what the scene hides');
});

test('crows circle above the south terraces and leave for the peak at the ending [life-crows]', () => {
  const v = view(), c = WORLD.life.crows, mesh = v.debug.crows.mesh, m = new THREE.Matrix4(), p = new THREE.Vector3();
  const centre = () => { const s = new THREE.Vector3(); for (let i = 0; i < c.count; i++) { mesh.getMatrixAt(i, m); s.add(p.setFromMatrixPosition(m)); } return s.divideScalar(c.count); };
  v.apply(raid()); v.update(10, null);
  const ground = terrain.heightAt(c.x, c.z);
  for (let i = 0; i < c.count; i++) { mesh.getMatrixAt(i, m); p.setFromMatrixPosition(m); assert(Math.hypot(p.x - c.x, p.z - c.z) <= c.r + 0.01 && p.y > ground + c.y - 3 && p.y < ground + c.y + 8, `[life-crows] crow ${i} out of its circle`); }
  const a = centre(); v.update(12, null); const b = centre(); mesh.getMatrixAt(3, m);
  assert(Math.hypot(a.x - b.x, a.z - b.z) < 6, '[life-crows] while circling, the flock stays over the terraces');
  v.apply(lifeScene({ beat: 'b7_result', food: 60 })); v.update(20, null); const start = centre(); v.update(40, null); const later = centre();
  const toPeak = q => Math.hypot(c.peak[0] - q.x, c.peak[1] - q.z);
  assert(toPeak(start) - toPeak(later) > 120, `[life-crows] at the ending the flock heads for the peak (${(toPeak(start) - toPeak(later)).toFixed(0)} m in 20 s)`);
  v.update(80, null); assert.equal(mesh.visible, false, '[life-crows] once far away, the flock is no longer drawn');
  v.apply(raid()); v.update(81, null); assert(mesh.visible && toPeak(centre()) > toPeak({ x: c.x, z: c.z }) - c.r - 1, '[life-crows] a new run brings them back over the terraces');
});

test('ground marks lie on the terrain, and stacked or leaning things get no dark disc [life-marks]', () => {
  const v = view();
  for (const { mesh } of v.debug.marks) {
    const pos = mesh.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) assert(Math.abs(pos.getY(i) - terrain.heightAt(pos.getX(i), pos.getZ(i)) - 0.035) < 1e-3, '[life-marks] a mark floats or sinks');
    assert(!mesh.castShadow && mesh.receiveShadow && mesh.material.transparent && !mesh.material.depthWrite, '[life-marks] marks receive shadows, write no depth');
  }
  const always = v.debug.marks.find(m => m.key === 'always').mesh.geometry.attributes.position, n = always.count;
  const at = (x, z) => { for (let i = 0; i < n; i++) if (Math.hypot(always.getX(i) - x, always.getZ(i) - z) < 0.05) return true; return false; };
  const b5 = WORLD.life.items.find(d => d.id === 'bale_5'), bow = WORLD.life.items.find(d => d.id === 'captive_bow');
  assert(!v.debug.marks.some(m => m.show?.item === 'bale_row' && m.show.min === 5) && !at(bow.x, bow.z), '[life-marks] no disc under the stacked bale or the leaning bow');
});
