// S7-0 まとめ描き（batch.js・props.js・buildings.js）の試験。1つずつ複製して置いていた頃（変更前のコードを下に写した参照）と
// 同じ行列・同じ色・同じ影の扱いになり、描画の呼び出しが置く数に比例しないこと、読み込んだ模型を書き換えないことを確かめる。
// 画素の比較は tools/compare-shots.mjs、呼び出しの実測は tools/scenarios/capture-calls.mjs（ブラウザ）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, loadView, installCanvasStub } from './helpers/valley-view-modules.mjs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';

installCanvasStub();
const { buildProps } = await loadView('props.js');
const { buildBuildings } = await loadView('buildings.js');
const { gradeModel, patchGrade } = await loadView('grade.js');
const terrain = createTerrain(WORLD);
const KEYS = { well: 'well', cart: 'cart', stone_lantern: 'lantern', drying_rack: 'hasa', bonfire: 'firepit', jizo: 'jizo', haystack: 'wara', scarecrow: 'kakashi', shrine: 'hokora' };

// 読み込んだ模型と同じ入れ子の作り（柵4部品・薪3部品・農家12部品は glTF の場面→節→部品、Meshy は包み→場面（ずらし）→部品）
const material = (i, color = 0xffffff) => Object.assign(new THREE.MeshStandardMaterial({ color }), { name: 'm' + i });
const part = (i, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(0.4 + i * 0.1, 1, 0.3), material(i, color)); m.name = 'part' + i; m.position.set(i * 0.1, 0.2, -i * 0.05); m.castShadow = true; m.receiveShadow = i % 2 === 0; return m; };
const gltfLike = (node, n, colors = []) => { const scene = new THREE.Group(), g = new THREE.Group(); g.name = node; for (let i = 0; i < n; i++) g.add(part(i, colors[i])); g.rotation.y = 0.3; scene.add(g); return scene; };
const meshyLike = name => { const wrap = new THREE.Group(), scene = new THREE.Group(); wrap.name = 'prop-' + name; scene.position.set(0.12, 0.31, -0.07); scene.add(part(0)); wrap.add(scene); return wrap; };
function makeModels() {
  const models = { fence: gltfLike('rustic_fence_section_LOD1', 4), firewood: gltfLike('split_firewood_stack_LOD1', 3),
    farmhouse: gltfLike('Farmhouse_Game_LOD0', 12, Array.from({ length: 12 }, (_, i) => new THREE.Color().setHSL(i / 12, 0.3, 0.4).getHex())) };
  gradeModel(models.farmhouse, { whiteMax: 0.46 });
  for (const key of new Set(Object.values(KEYS))) models[key] = meshyLike(key);
  return models;
}
const meshesOf = o => { const out = []; o.traverse(m => { if (m.isMesh) out.push(m); }); return out; };
const close = (a, b, eps, label) => { assert.equal(a.length, b.length, `${label}: length`); for (let i = 0; i < a.length; i++) assert(Math.abs(a[i] - b[i]) <= eps, `${label}: element ${i} ${a[i]} vs ${b[i]}`); };
// 置き場所の行列は32bitの小数で GPU へ渡る（複製の頃も、描く前に32bitへ丸めていた）。32bitの精度の内で一致すればよい。
const sameMatrix = (got, want, label) => { for (let i = 0; i < 16; i++) assert(Math.abs(got[i] - want[i]) <= 1e-6 * Math.max(1, Math.abs(want[i])), `${label}: element ${i} ${got[i]} vs ${want[i]}`); };

// 変更前の置き方（props.js・buildings.js から写した参照）。行列と色だけを比べるため、描かない。
function legacyProps(models) {
  const group = new THREE.Group(), out = { yard: new Map(), fences: [], firewood: [], banners: [] };
  const place = (obj, x, z, rotY = 0, scale = 1, lift = 0) => { obj.position.set(x, terrain.heightAt(x, z) + lift, z); obj.rotation.y = rotY; obj.scale.setScalar(scale); group.add(obj); return obj; };
  for (const p of WORLD.props) {
    const key = KEYS[p.kind], o = key && models[key]?.clone(true);
    if (!o) continue;
    place(o, p.x, p.z, p.rotY || 0, p.scale || 1, p.kind === 'shrine' ? -0.06 : -0.04);
    if (!out.yard.has(key)) out.yard.set(key, []);
    out.yard.get(key).push(o);
  }
  for (const d of WORLD.dress) {
    if (d.kind === 'fence_line') {
      const [x0, z0] = d.from, [x1, z1] = d.to, len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5)), rot = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n, o = models.fence.clone(true), s = (len / n) / 2.63; place(o, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rot, s, -0.05); o.scale.set(s, 0.9, s); out.fences.push(o); }
    } else if (d.kind === 'firewood') out.firewood.push(place(models.firewood.clone(true), d.x, d.z, d.rotY || 0, d.scale || 1.2, -0.03));
    else if (d.kind === 'banner') {
      const g = new THREE.Group();
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.6, 8)); pole.position.y = 1.8;
      const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.8, 6)); bar.rotation.z = Math.PI / 2; bar.position.set(0.4, 3.35, 0);
      const geo = new THREE.PlaneGeometry(0.7, 2.6, 4, 12); geo.translate(0.4, 3.3 - 1.3, 0);
      const cloth = new THREE.Mesh(geo); cloth.userData.base = Float32Array.from(geo.attributes.position.array);
      g.add(pole, bar, cloth); place(g, d.x, d.z, d.rotY || 0, d.scale || 1); out.banners.push({ g, pole, bar, cloth, color: d.color || '#7b1f1a' });
    }
  }
  group.updateMatrixWorld(true);
  return out;
}
// 変更前の幟の布の動き（1本ずつ・布の座標で動かし、法線を計算）
function legacyCloth(b, time) {
  const geo = b.cloth.geometry.clone(), pos = geo.attributes.position, base = b.cloth.userData.base;
  for (let i = 0; i < pos.count; i++) {
    const y = base[i * 3 + 1], down = Math.max(0, (3.3 - y) / 2.6);
    pos.setZ(i, Math.sin(time * 2.1 + down * 3.2 + b.g.position.x) * 0.16 * down * down + Math.sin(time * 5.3 + down * 6) * 0.03 * down);
    pos.setX(i, base[i * 3] - 0.04 * down * Math.sin(time * 1.3 + b.g.position.z));
  }
  geo.computeVertexNormals();
  return geo.applyMatrix4(b.cloth.matrixWorld);
}
const snapshot = models => Object.entries(models).map(([k, m]) => [k, (() => { const s = []; m.traverse(o => s.push([o.name, o.type, o.children.length, ...o.position.toArray(), ...o.quaternion.toArray(), ...o.scale.toArray(),
  ...(o.isMesh ? [o.geometry.uuid, o.geometry.attributes.position.array, o.material.uuid, o.material.color.getHex(), o.material.onBeforeCompile, o.material.customProgramCacheKey?.(), o.castShadow, o.receiveShadow] : [])])); return s; })()]);
const instanceMatrix = (mesh, i) => { const m = new THREE.Matrix4(); mesh.getMatrixAt(i, m); return m.elements; };
// BatchedMesh は形を写して持つ。写しが元の頂点と索引のとおりか。
const sameShape = (batched, g) => ['position', 'normal', 'uv'].every(k => !g.attributes[k] || g.attributes[k].array.every((v, i) => batched.attributes[k].array[i] === v)) && g.index.array.every((v, i) => batched.index.array[i] === v);

test('props: every placed part keeps the matrix it had as a clone, one batched draw per model part [props-matrices]', () => {
  const models = makeModels(), before = snapshot(models);
  const built = buildProps({ world: WORLD, terrain, models }), legacy = legacyProps(makeModels());
  const byName = name => built.group.children.find(c => c.name === name);
  const yard = byName('yard-props');
  assert.deepEqual(yard.children.map(g => g.name).sort(), [...legacy.yard.keys()].sort(), '[props-yard] one batch per prop model');
  for (const g of yard.children) {
    const clones = legacy.yard.get(g.name);
    assert.equal(g.children.length, meshesOf(models[g.name]).length, `[props-yard] ${g.name}: one draw per part`);
    g.children.forEach((mesh, j) => {
      assert(mesh.isBatchedMesh && mesh.instanceCount === clones.length && mesh.perObjectFrustumCulled, `[props-yard] ${g.name}: one batch, every copy culled on its own`);
      clones.forEach((c, i) => sameMatrix(instanceMatrix(mesh, i), meshesOf(c)[j].matrixWorld.elements, `[props-yard] ${g.name} #${i}`));
    });
  }
  for (const [name, clones, model] of [['fences', legacy.fences, models.fence], ['firewood', legacy.firewood, models.firewood]]) {
    const g = byName(name);
    assert.equal(g.children.length, meshesOf(model).length, `[props-${name}] one draw per part`);
    g.children.forEach((mesh, j) => {
      const src = meshesOf(model)[j];
      assert.equal(mesh.instanceCount, clones.length, `[props-${name}] count`);
      assert(mesh.material === src.material && sameShape(mesh.geometry, src.geometry), `[props-${name}] the loaded shape and the shared material`);
      assert.deepEqual([mesh.castShadow, mesh.receiveShadow], [src.castShadow, src.receiveShadow], `[props-${name}] same shadows`);
      clones.forEach((c, i) => sameMatrix(instanceMatrix(mesh, i), meshesOf(c)[j].matrixWorld.elements, `[props-${name}] #${i}`));
    });
  }
  assert.equal(legacy.fences.length, 22, '[props-fences] 22 fence sections as before');
  assert.deepEqual(snapshot(models), before, '[models-untouched] the loaded models are not changed (the opening clones them)');
  const lights = []; built.group.traverse(o => { if (o.isPointLight) lights.push(o); });
  assert.equal(lights.length, 1, '[props-bonfire-light] the bonfire light stays');
});

test('banners: poles and bars as one batched shape, cloth per look, waving exactly as before [banners]', () => {
  const built = buildProps({ world: WORLD, terrain, models: makeModels() }), legacy = legacyProps(makeModels());
  const banners = built.group.children.find(c => c.name === 'banners');
  const wood = banners.children.filter(c => c.isBatchedMesh), cloths = banners.children.filter(c => c.name === 'banner-cloth');
  assert.equal(wood.length, 1, '[banner-wood] one draw for all poles and bars');
  assert.equal(cloths.length, new Set(legacy.banners.map(b => b.color)).size, '[banner-cloth] one draw per cloth look');
  assert(wood[0].castShadow && !wood[0].receiveShadow && cloths.every(c => c.castShadow && !c.receiveShadow), '[banner-shadows] cast, not receive (as before)');
  const v = new THREE.Vector3(), m = new THREE.Matrix4();
  legacy.banners.forEach((b, i) => {
    const want = [...[b.pole, b.bar].flatMap(p => { const g = p.geometry.clone().applyMatrix4(p.matrixWorld); return Array.from(g.attributes.position.array); })];
    wood[0].getMatrixAt(i, m);
    const pos = wood[0].geometry.attributes.position, got = [];
    for (let k = 0; k < pos.count; k++) got.push(...v.fromBufferAttribute(pos, k).applyMatrix4(m).toArray());
    close(got, want, 1e-5, `[banner-wood] banner ${i}`);
  });
  for (const time of [0.5, 3.7, 41.2]) {
    built.update(time);
    const clothOf = new Map();
    for (const b of legacy.banners) {
      const geo = legacyCloth(b, time), n = geo.attributes.position.count, want = geo.attributes.position.array, hits = [];
      for (const cloth of cloths) {
        const a = cloth.geometry.attributes.position.array;
        for (let s = 0; s * 3 < a.length; s += n) if ([0, 1, 2].every(k => Math.abs(a[s * 3 + k] - want[k]) < 1e-4)) hits.push([cloth, s]);
      }
      assert.equal(hits.length, 1, `[banner-cloth] the banner at x=${b.g.position.x} is found once at t=${time}`);
      const [cloth, s] = hits[0]; clothOf.set(b, cloth);
      close(Array.from(cloth.geometry.attributes.position.array.slice(s * 3, (s + n) * 3)), Array.from(want), 2e-5, `[banner-cloth] position t=${time}`);
      close(Array.from(cloth.geometry.attributes.normal.array.slice(s * 3, (s + n) * 3)), Array.from(geo.attributes.normal.array), 2e-4, `[banner-cloth] normal t=${time}`);
    }
    for (const b of legacy.banners) for (const o of legacy.banners) assert.equal(clothOf.get(b) === clothOf.get(o), b.color === o.color, '[banner-cloth] one cloth shape per look');
  }
});

test('farmhouses: one batched draw per part, the same matrices, and the tint applied before the colour grade [farmhouses]', () => {
  const models = makeModels(), before = snapshot(models);
  const { group, placed } = buildBuildings({ world: WORLD, terrain, models });
  const farms = WORLD.buildings.filter(b => b.kind === 'farmhouse'), batch = group.children.find(c => c.name === 'farmhouses');
  assert.equal(batch.children.length, 12, '[farm-draws] one draw per part (12), not per house');
  // 変更前：1軒ずつ複製し、色違いは材質を複製して色を掛け、補正をかけ直していた
  const tints = [null, '#e8e0d0', '#d8d2c4'], legacy = new THREE.Group();
  const groundHeight = (x, z, b) => { let y = terrain.heightAt(x, z); const c = Math.cos(b.rotY), s = Math.sin(b.rotY), hw = b.footprint.w / 2, hd = b.footprint.d / 2; for (const [u, w] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) y = Math.min(y, terrain.heightAt(x + u * c + w * s, z - u * s + w * c)); return y; };
  const old = farms.map(b => { const o = models.farmhouse.clone(true); o.position.set(b.x, groundHeight(b.x, b.z, b), b.z); o.rotation.y = b.rotY || 0; o.scale.setScalar(0.98 + (b.variant || 0) * 0.04); legacy.add(o); return o; });
  legacy.updateMatrixWorld(true);
  batch.children.forEach((mesh, j) => {
    const src = meshesOf(models.farmhouse)[j];
    assert.equal(mesh.instanceCount, farms.length, '[farm-count]');
    assert(sameShape(mesh.geometry, src.geometry), '[farm-shape]');
    assert.notEqual(mesh.material, src.material, '[farm-material] a clone, the loaded material is kept for the opening');
    assert.equal(mesh.material.color.getHex(), src.material.color.getHex(), '[farm-material] the base colour is not pre-tinted');
    assert.match(mesh.material.customProgramCacheKey(), /^grade-0\.46-0\.85-0\.5-1-tint$/, '[farm-grade] same grade, tint first');
    farms.forEach((b, i) => {
      sameMatrix(instanceMatrix(mesh, i), meshesOf(old[i])[j].matrixWorld.elements, `[farm-matrix] ${b.id}`);
      const c = new THREE.Color(); mesh.getColorAt(i, c);
      const want = tints[(b.variant || 0) % 3] ? new THREE.Color(tints[(b.variant || 0) % 3]) : new THREE.Color(1, 1, 1);
      close(c.toArray(), want.toArray(), 1e-6, `[farm-tint] ${b.id}`);          // 32bitの色。白（1,1,1）はちょうど1
    });
  });
  assert.deepEqual(farms.map(b => placed.find(p => p.name === b.id)?.position.toArray()), old.map(o => o.position.toArray()), '[farm-placed] named markers keep the house positions');
  assert.deepEqual(snapshot(models), before, '[models-untouched] buildings');
});

test('the tinted grade multiplies the per-copy colour before the grade, and the plain grade is unchanged [grade-order]', () => {
  const shader = () => ({ fragmentShader: 'void main(){\n#include <map_fragment>\n#include <color_fragment>\n#include <alphamap_fragment>\n}' });
  const plain = shader(), tinted = shader();
  patchGrade(new THREE.MeshStandardMaterial(), {}).onBeforeCompile(plain);
  patchGrade(new THREE.MeshStandardMaterial(), { tintFirst: true }).onBeforeCompile(tinted);
  const order = (s, a, b) => s.indexOf(a) < s.indexOf(b);
  assert(order(plain.fragmentShader, 'diffuseColor.rgb = gc', '#include <color_fragment>'), '[grade-plain] grade, then the colour (as before)');
  assert.equal(tinted.fragmentShader.split('#include <color_fragment>').length, 2, '[grade-tint] the colour is applied once');
  assert(order(tinted.fragmentShader, '#include <map_fragment>', '#include <color_fragment>') && order(tinted.fragmentShader, '#include <color_fragment>', 'vec3 gc = diffuseColor.rgb'), '[grade-tint] the colour, then the grade');
  const block = s => s.slice(s.indexOf('vec3 gc'), s.indexOf('diffuseColor.rgb = gc;'));
  assert(block(plain.fragmentShader).length > 100 && block(tinted.fragmentShader) === block(plain.fragmentShader), '[grade-tint] the same grade code');
});

test('the batched props and farmhouses need about 60 draws with shadows, whatever the number placed [draw-budget]', () => {
  const models = makeModels(), props = buildProps({ world: WORLD, terrain, models }).group, { group } = buildBuildings({ world: WORLD, terrain, models });
  const draws = root => { let main = 0, shadow = 0; root.traverse(o => { if (!o.isMesh) return; const n = Array.isArray(o.material) ? o.geometry.groups.length : 1; main += n; if (o.castShadow) shadow += n; }); return { main, shadow }; };
  const kinds = { fences: 4, firewood: 3, 'yard-props': 9, banners: 3 }, total = { main: 0, shadow: 0 };
  for (const [name, want] of Object.entries(kinds)) {
    const d = draws(props.children.find(c => c.name === name));
    assert.equal(d.main, want, `[draw-budget] ${name}`); total.main += d.main; total.shadow += d.shadow;
  }
  const farm = draws(group.children.find(c => c.name === 'farmhouses'));
  assert.equal(farm.main, 12, '[draw-budget] farmhouses'); total.main += farm.main; total.shadow += farm.shadow;
  assert(total.main + total.shadow <= 64, `[draw-budget] ${total.main}+${total.shadow} draws (before: 396 counted the same way)`);
});
