import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { CANOPY, canopyClumps, canopyCoverage, canopyHandoff, canopyScale, canopyEnabled, stands2Enabled } from '../dist/valley/kamakura-canopy.js';
import { prepareVeg, vegPolicy } from '../dist/valley/kamakura-veg.js';
import { prepareStands, standPolicy } from '../dist/valley/kamakura-stands.js';
import { adaptPolicy } from '../dist/valley/kamakura-adapt.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { kamakuraPaths } from '../dist/valley/kamakura-roads.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { kamakuraSpawn } from '../dist/valley/kamakura-spawn.js';
import { houseBox, houseMatrix } from '../dist/valley/kamakura-houses.js';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
import { readPrivateFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
import { load, THREE } from './helpers/tree-modules.mjs';
import { wind } from './helpers/tree-field.mjs';
const { buildKamakuraStands, canopyGeometry, STANDS2 } = await load('kamakura-stand-view.js');
const terrain = { bounds: { minX: -100, maxX: 100, minZ: -100, maxZ: 100 }, insideA: () => true, heightAt: () => 12, waterAt: () => 0, surfaceAt: () => ({ litter: 1 }) };
const raw = (id, x, z, extra = {}) => ({ id, x, z, crown: 4, height: 16, sourceSpecies: 0, tier: 0, variant: 0, tint: 0, ...extra });
const prepare = items => prepareVeg(items, terrain);
const options = search => ({ wind, sunDir: new THREE.Vector3(-1, 1, 1).normalize(), search });
const camera = (x = 0, y = 20, z = 0) => ({ position: { x, y, z } });
function bundle(items, search = '', quality = 'standard', t = terrain) {
  return prepareStands(items, t, { preparedVeg: prepareVeg(items, t), search }, standPolicy(quality));
}
test('F1 fixed cells, crown-weighted centroids, species majority/ties, height and sparse/dense radius bounds', () => {
  const input = [raw(0, 1, 1, { crown: 2, height: 10 }), raw(1, 9, 5, { crown: 6, height: 20, sourceSpecies: 1 }), raw(2, 4, 6, { crown: 2, height: 30 }), raw(3, -1, -1)];
  const p = prepare(input), a = canopyClumps(p), b = canopyClumps({ active: p.active.slice().reverse() });
  assert.deepEqual(a, b); assert.equal(a.clumps.length, 2);
  const i = a.clumps.find(i => i.trees === 3);
  assert.equal(i.x, 6.4); assert.equal(i.z, 4.4); assert.equal(i.height, 20); assert.equal(i.sourceSpecies, 0);
  assert.equal(i.crown, CANOPY.cell * CANOPY.radius * CANOPY.coverageGain);
  assert.equal(new Set(a.clumps.map(i => i.cellKey)).size, a.clumps.length);
  const sparse = canopyClumps(prepare([raw(0, 2, 3, { crown: 1 }), raw(1, 20, 3, { crown: 100 })])).clumps;
  assert.equal(sparse[0].crown, CANOPY.minRadius * CANOPY.coverageGain); assert.equal(sparse[1].crown, CANOPY.cell * CANOPY.maxRadius);
  const tie = canopyClumps(prepare([raw(1, 2, 2, { sourceSpecies: 2 }), raw(2, 4, 4, { sourceSpecies: 0 })]));
  assert.equal(tie.clumps[0].sourceSpecies, 0);
  const two = canopyClumps(prepare([raw(0, 1, 1), raw(1, 2, 2)]));
  assert.equal(two.clumps[0].crown, 8 * CANOPY.sparseGain * CANOPY.coverageGain);
});
test('F1 ignores shrubs and excluded records; preserves outside-A trees; overlap is exact across grid boundaries', () => {
  const p = prepareVeg([raw(0, 2, 3), raw(1, 22, 3), raw(2, 42, 3, { sourceSpecies: 4 }), raw(3, 62, 3)], { ...terrain, insideA: () => false }, { exclude: i => i.id === 1 ? 'house' : null });
  assert.equal(canopyClumps(p).clumps.length, 2);
  const existing = [{ x: 11, z: 3 }, { x: 73, z: 3 }];
  const a = canopyClumps(p, { existing }); assert.equal(a.clumps.length, 1); assert.equal(a.clumps[0].id, 3);
  assert(!a.clumps[0].expandable);
  const boundary = canopyClumps(prepare([raw(0, 19, 19)]), { existing: [{ x: 25, z: 27 }] }); assert.equal(boundary.clumps.length, 0);
  for (const reason of ['house','path','water','spawn']) {
    const filtered = prepareVeg([raw(0, 2, 3)], terrain, { exclude: () => reason });
    assert.equal(canopyClumps(filtered).clumps.length, 0);
  }
});
test('F1 quality cells, deterministic regridding, bounded results and options validation', () => {
  const points = [];
  for (let x = -90; x <= 90; x += 7) for (let z = -90; z <= 90; z += 7) points.push(raw(points.length, x, z));
  const p = prepare(points), light = canopyClumps(p, { quality: 'light' }), standard = canopyClumps(p);
  assert.equal(standard.cell, CANOPY.cell); assert.equal(light.cell, CANOPY.lightCell); assert(light.clumps.length < standard.clumps.length);
  const limited = canopyClumps(p, { limit: 8 }); assert(limited.passes > 1); assert(limited.clumps.length <= 8);
  assert.equal(limited.scanned, p.active.length * limited.passes); assert.deepEqual(limited, canopyClumps(p, { limit: 8 }));
  for (const bad of [{ limit: 0 }, { limit: 1 }, { cell: 0 }, { cell: NaN }, { limit: .5 }]) assert.throws(() => canopyClumps(p, bad), RangeError);
  assert.equal(canopyClumps({ active: [] }).clumps.length, 0);
  assert(canopyEnabled('')); assert(!canopyEnabled('?canopy=0')); assert(stands2Enabled('')); assert(!stands2Enabled('?stands2=0'));
});
test('F2 cutoff follows tree quality and adaptation; scaling is zero inside, monotonic and one at the cutoff', () => {
  for (const quality of ['standard','light']) for (let step = 0; step <= 3; step++) {
    const policy = adaptPolicy(step), b = canopyHandoff(quality, policy.impostorRange);
    assert.equal(b.to, vegPolicy(quality).range * policy.impostorRange); assert.equal(b.to - b.from, CANOPY.handoff);
    assert.equal(canopyScale(b.from - 100, b.from, b.to), 0); assert.equal(canopyScale(b.from, b.from, b.to), 0); assert.equal(canopyScale(b.to, b.from, b.to), 1);
    let last = 0;
    for (let d = b.from; d <= b.to; d++) { const next = canopyScale(d, b.from, b.to); assert(next >= last && next <= 1); last = next; }
  }
});
test('F4 coverage counts the union of disks on litter inside A, including samples on disk edges', () => {
  const t = { ...terrain, bounds: { minX: 0, maxX: 16, minZ: 0, maxZ: 0 } };
  const a = canopyCoverage(t, [{ x: 0, z: 0, crown: 8 }, { x: 0, z: 0, crown: 8 }]);
  assert.equal(a.samples, 3); assert.equal(a.covered, 2); assert.equal(a.ratio, 2 / 3);
  assert.equal(canopyCoverage({ ...t, insideA: () => false }, []).samples, 0);
  assert.equal(canopyCoverage({ ...t, surfaceAt: () => ({ grass: 1 }) }, []).samples, 0);
  assert.throws(() => canopyCoverage(t, [], 0), RangeError);
  const points = [];
  for (let x = -96; x <= 96; x += 9) for (let z = -96; z <= 96; z += 9) points.push(raw(points.length, x, z));
  assert(canopyCoverage(terrain, canopyClumps(prepare(points)).clumps).ratio >= .85);
});
function shader(material, depth = false) {
  const base = depth ? THREE.ShaderLib.depth : material.isMeshBasicMaterial ? THREE.ShaderLib.basic : THREE.ShaderLib.lambert;
  const s = { uniforms: {}, vertexShader: base.vertexShader, fragmentShader: base.fragmentShader };
  material.onBeforeCompile(s); return s;
}
function balanced(s) {
  s = s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '');
  const stack = [], pairs = { ')': '(', '}': '{', ']': '[' }, pp = [];
  for (const c of s) if ('({['.includes(c)) stack.push(c); else if (')}]'.includes(c)) assert.equal(stack.pop(), pairs[c]);
  assert.equal(stack.length, 0);
  for (const line of s.split('\n')) { if (/^\s*#if/.test(line)) pp.push(line); if (/^\s*#endif/.test(line)) assert(pp.pop()); }
  assert.equal(pp.length, 0);
  assert.doesNotMatch(s, /--\s*\d|\b\d+\.\d+(?:float|vec[234]|[a-df-zA-DF-Z_])\w*/);
  assert.doesNotMatch(s, /\b(?:float|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/);
  for (const name of ['kzFineP','kzCoarseP','kzFineW','kzCoarseW','kzFineN','kzCoarseN','vStandObject','standOrigin','standDistance','standKeep']) {
    if (s.includes(name)) assert.match(s, new RegExp('(?:float|vec[234])\\s+[^;]*\\b' + name + '\\b'));
  }
}
test('F3 dome crown families are deterministic, bounded, closed and retain flat bottoms in both LODs', () => {
  const shapes = new Set();
  for (let variant = 0; variant < STANDS2.variants; variant++) for (const far of [false,true]) {
    const g = canopyGeometry(variant, far), other = canopyGeometry(variant, far);
    const tris = g.index.count / 3; assert(tris <= (far ? 28 : 80)); assert.equal(tris, far ? 18 : 56);
    assert.deepEqual(g.attributes.position.array, other.attributes.position.array); assert.equal(g.attributes.position.count, far ? 11 : 32);
    shapes.add(Array.from(g.attributes.position.array).join(','));
    const edges = new Map();
    for (let i = 0; i < g.index.count; i += 3) for (let k = 0; k < 3; k++) {
      const a = g.index.array[i + k], b = g.index.array[i + (k + 1) % 3], key = [Math.min(a,b),Math.max(a,b)].join('/'); edges.set(key,(edges.get(key) || 0) + 1);
    }
    assert([...edges.values()].every(n => n === 2));
    for (const a of Object.values(g.attributes)) assert([...a.array].every(Number.isFinite));
    assert(Math.abs(g.boundingBox.min.y - STANDS2.bottom) < 1e-7); g.dispose(); other.dispose();
  }
  assert(shapes.size >= 6);
});
test('F2/F3 shader handoff, scene fog/shadows, derivatives, existing chunk anchors and adaptive uniform identity', () => {
  const items = [raw(0, 1, 2), raw(1, 2000, 2, { tier: 1 }), raw(2, -2000, 2, { tier: 2 })];
  for (const quality of ['standard','light']) for (const search of ['', '?stands2=0', '?canopydebug=1']) {
    const p = bundle(items, search, quality, { ...terrain, insideA: () => false });
    const view = buildKamakuraStands(p, { ...options(search), quality });
    try {
      const b = canopyHandoff(quality);
      for (const d of view.distant) for (const material of [d.nearMaterial, d.farMaterial]) {
        const s = shader(material); balanced(s.vertexShader); balanced(s.fragmentShader);
        assert.equal(s.uniforms.uStandEye, view.eye); assert.equal(s.uniforms.uCanopyHandoff, view.handoff);
        assert.match(s.vertexShader, /distance\(standOrigin.xz, uStandEye.xz\)/);
        assert.match(s.vertexShader, /transformed \*= mix/);
        if (d.tier === 0) assert.match(s.vertexShader, /smoothstep\(uCanopyHandoff.x, uCanopyHandoff.y/);
        if (search === '') {
          assert.match(s.fragmentShader, /fwidth\(kzFineP/); assert.match(s.fragmentShader, /fwidth\(kzCoarseP/);
          assert.match(s.fragmentShader, /lights_fragment_begin|directionalShadowMap/); assert.match(s.fragmentShader, /#include <fog_fragment>/);
          assert.match(s.fragmentShader, /dot\(geometryNormal,directLight.direction\)/);
        }
        if (d.mesh.customDepthMaterial) balanced(shader(d.mesh.customDepthMaterial, true).vertexShader);
      }
      for (const step of [3,2,1,0]) {
        view.setAdapt(adaptPolicy(step)); const expected = canopyHandoff(quality, adaptPolicy(step).impostorRange);
        assert.equal(view.handoff.value.x, expected.from); assert.equal(view.handoff.value.y, expected.to);
      }
      assert.equal(view.handoff.value.y, b.to);
      for (const chunk of ['begin_vertex','normal_fragment_maps','emissivemap_fragment','lights_lambert_pars_fragment']) {
        assert(THREE.ShaderLib.lambert.vertexShader.includes(`#include <${chunk}>`) || THREE.ShaderLib.lambert.fragmentShader.includes(`#include <${chunk}>`));
      }
      assert(THREE.ShaderChunk.lights_lambert_pars_fragment.includes('saturate( dot( geometryNormal, directLight.direction ) )'));
    } finally { view.dispose(); }
  }
});
test('F2/F3/F6 1000 moving updates reuse buffers, uniforms and result objects; 3D tile LOD has hysteresis', t => {
  const p = bundle([raw(0, 500, 0)], '', 'standard', { ...terrain, insideA: () => false });
  const view = buildKamakuraStands(p, options('?debug=1'));
  const c = camera(500, 20, 0), d = view.distant[0], original = d.mesh.instanceMatrix.array.slice(), handoff = view.handoff.value;
  const start = performance.now(), result = view.update(c), report = globalThis.__kzCanopy(); let writes = 0;
  d.mesh.setMatrixAt = () => { writes++; throw Error('per-frame matrix upload'); };
  const resources = [d.nearGeometry,d.farGeometry,d.nearMaterial,d.farMaterial];
  for (let k = 0; k < 1000; k++) { c.position.x += .1; assert.equal(view.update(c), result); assert.equal(globalThis.__kzCanopy(), report); }
  assert.equal(writes,0); assert.equal(view.handoff.value,handoff); assert.deepEqual(d.mesh.instanceMatrix.array,original); assert.equal(view.eye.value.x,c.position.x);
  assert.equal(d.far,false);
  c.position.x = d.sphere.center.x; c.position.z = d.sphere.center.z;
  c.position.y = d.sphere.center.y + STANDS2.lodDistance + 1; view.update(c); assert(d.far); assert.equal(d.mesh.geometry,resources[1]);
  c.position.y -= STANDS2.lodHysteresis / 2; view.update(c); assert(d.far);
  c.position.y = d.sphere.center.y + STANDS2.lodDistance - STANDS2.lodHysteresis - 1; view.update(c); assert(!d.far); assert.equal(d.mesh.geometry,resources[0]);
  assert.equal(report.clumps.veg,1); assert.equal(report.look,'stands2');
  c.position.x = -500; c.position.y = 20; c.position.z = 0; view.update(c);
  assert.equal(report.nearest.tier,'veg'); assert(report.nearest.distance > 0); assert(Math.abs(report.nearest.bearing - 90) < 1e-7);
  assert.equal(report.drawn.draws,1); assert.equal(report.drawn.triangles,d.mesh.geometry.index.count / 3);
  const version = d.mesh.instanceMatrix.version; view.setAdapt(adaptPolicy(3)); view.update(c); assert.equal(d.mesh.instanceMatrix.version,version);
  t.diagnostic(`1000 moving updates: ${(performance.now()-start).toFixed(3)} ms; matrix writes=${writes}; near=56/far=18 triangles`);
  view.dispose(); assert.equal(globalThis.__kzCanopy,undefined);
});
test('F6 unlit debug colours, far darkening and idempotent disposal of every owned resource', () => {
  const p = bundle([raw(0, 500, 0),raw(1, -500, 0, { tier: 1 }),raw(2, 2000, 0, { tier: 2 })], '', 'standard', { ...terrain, insideA: () => false });
  const view = buildKamakuraStands(p, options('?debug=1&canopydebug=1')), watched = new Map();
  for (const d of view.distant) {
    assert(d.mesh.material.isMeshBasicMaterial); assert.equal(d.mesh.material.fog,false); assert.equal(d.mesh.material.toneMapped,false);
    const expected = new THREE.Color(d.tier === 0 ? STANDS2.debugVeg : d.tier === 1 ? STANDS2.debugT1 : STANDS2.debugT2);
    assert(d.nearMaterial.color.equals(expected)); assert(d.farMaterial.color.equals(expected.multiplyScalar(STANDS2.debugFar)));
    for (const o of [d.mesh,d.nearGeometry,d.farGeometry,d.nearMaterial,d.farMaterial,d.mesh.customDepthMaterial]) if (!watched.has(o)) {
      watched.set(o,0); o.addEventListener('dispose',() => watched.set(o,watched.get(o)+1));
    }
  }
  view.dispose(); view.dispose(); for (const n of watched.values()) assert.equal(n,1);
  assert.equal(globalThis.__kzCanopy,undefined);
});
test('F4/F5 private forest: actual exclusions, coverage and all-tile command/triangle limits; no fixture values', { skip: !process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定' }, async t => {
  const dir = process.env.KZ_WORLD_DIR;
  const fetcher = async url => {
    const bytes = await fs.readFile(path.join(dir, url.slice('/world-private/'.length)));
    return { ok: true, json: async () => JSON.parse(bytes), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength) };
  };
  const data = await loadKamakura(fetcher), terrain = createKamakuraTerrain(data);
  const houses = await readPrivateHouses(dir,data), facilities = await readPrivateFacilities(dir,data);
  const boxes = houses.houses.instances.map(i => houseBox(houses.houses.kinds.get(i.kind),houseMatrix(i,terrain,houses.bodies.get(i.kind)),houses.bodies.get(i.kind)));
  boxes.push(...facilities.exclusionBoxes);
  const config = { boxes, paths: kamakuraPaths(data), spawn: kamakuraSpawn(terrain,'') }, veg = prepareVeg(data.veg,terrain,config);
  for (const quality of ['standard','light']) {
    const p = prepareStands(data.veg,terrain,{...config,preparedVeg:veg},standPolicy(quality));
    assert(p.canopy.clumps.length <= (quality === 'light' ? CANOPY.lightLimit : CANOPY.limit), 'private capacity exceeded');
    for (const i of p.canopy.clumps) assert(Number.isFinite(i.x+i.y+i.z+i.height+i.crown), 'nonfinite private canopy');
    const all = [...p.distant.values()].flat(), cover = canopyCoverage(terrain,all);
    t.diagnostic(`${quality}: forest coverage=${(100*cover.ratio).toFixed(3)}%; aggregation passes=${p.canopy.passes}; coverage probes=${cover.probes}`);
    assert(cover.ratio >= .6, 'private forest coverage below minimum');
    const view = buildKamakuraStands({ ...p, grid: new Map() },{...options(''),quality});
    // Count ALL tiles; use each tile's 3D centre distance at an elevated overview-like camera.
    const c = camera(0,700,0); view.update(c);
    let triangles = 0, draws = 0;
    for (const d of view.distant) { triangles += d.mesh.count*d.mesh.geometry.index.count/3; draws++; }
    t.diagnostic(`${quality}: all-tile triangles=${triangles}; draws=${draws}; clump pass visits=${p.canopy.scanned}`);
    assert(triangles <= 1900000, 'private all-tile triangle budget exceeded'); assert(draws <= 460, 'private all-tile command budget exceeded');
    const old = prepareStands(data.veg,terrain,config,standPolicy(quality));
    const previous = buildKamakuraStands({ ...old, grid: new Map() }, { ...options('?canopy=0&stands2=0'),quality });
    let increase = -Infinity, walkSamples = 0;
    for (let x = terrain.bounds.minX; x <= terrain.bounds.maxX; x += STANDS2.tile / 2) for (let z = terrain.bounds.minZ; z <= terrain.bounds.maxZ; z += STANDS2.tile / 2) {
      if (!terrain.insideA(x,z)) continue;
      c.position.x = x; c.position.z = z; c.position.y = terrain.heightAt(x,z) + 2.5;
      view.update(c); previous.update(c); walkSamples++;
      const nextDraws = view.distant.filter(d => d.mesh.visible).length, oldDraws = previous.distant.filter(d => d.mesh.visible).length;
      increase = Math.max(increase,nextDraws-oldDraws);
    }
    assert(walkSamples > 0); assert(increase <= 60,'walk command increase exceeded');
    t.diagnostic(`${quality}: maximum walk command increase=${increase}`);
    previous.dispose(); view.dispose();
  }
});

test('F3 both flags off match HEAD meshes, instances, buffers, materials, shadow flags and tile visibility', async () => {
  const { execFileSync } = await import('node:child_process');
  const { moduleURL } = await import('./helpers/tree-modules.mjs');
  const head = execFileSync('git',['show','HEAD:dist/valley/kamakura-stand-view.js'],{ encoding:'utf8' });
  const base = new URL('../dist/valley/',import.meta.url);
  let s = head.replace(/from 'three'/g, `from '${new URL('../dist/vendor/three.module.min.js',import.meta.url).href}'`);
  s = s.replace(/from '(\.\/[^']+)'/g, (_, p) => `from '${p.startsWith('./tree-') || p === './kamakura-veg-view.js' ? moduleURL(p.slice(2)) : new URL(p,base).href}'`);
  const old = await import('data:text/javascript;base64,' + Buffer.from(s).toString('base64'));
  const items = [raw(0,500,0),raw(1,-500,0,{tier:1}),raw(2,2000,0,{tier:2}),raw(3,1000,1000,{tier:1,sourceSpecies:2})];
  const t = { ...terrain, insideA:()=>false }, search = '?canopy=0&stands2=0', p = bundle(items,search,'standard',t);
  assert.equal(p.canopy,null);
  const before = old.buildKamakuraStands(p,options(search)), after = buildKamakuraStands(p,options(search));
  try {
    assert.equal(after.group.children.length,before.group.children.length); assert.equal(after.distant.length,before.distant.length);
    for (let k=0;k<before.distant.length;k++) {
      const a=after.distant[k].mesh,b=before.distant[k].mesh;
      assert.equal(a.count,b.count); assert.equal(a.material.type,b.material.type);
      assert.equal(a.material.vertexColors,b.material.vertexColors); assert.equal(a.material.fog,b.material.fog);
      assert.equal(a.customDepthMaterial,b.customDepthMaterial); assert.equal(a.castShadow,b.castShadow); assert.equal(a.receiveShadow,b.receiveShadow);
      assert.deepEqual(a.instanceMatrix.array,b.instanceMatrix.array); assert.deepEqual(a.instanceColor.array,b.instanceColor.array);
      assert.deepEqual(Object.keys(a.geometry.attributes),Object.keys(b.geometry.attributes));
      for (const name of Object.keys(a.geometry.attributes)) assert.deepEqual(a.geometry.attributes[name].array,b.geometry.attributes[name].array);
      assert.deepEqual(a.geometry.index.array,b.geometry.index.array);
    }
    for (const c of [camera(),camera(3000,700,3000),camera(20000,20,20000)]) {
      before.update(c); after.update(c);
      assert.deepEqual(after.distant.map(d=>d.mesh.visible),before.distant.map(d=>d.mesh.visible));
    }
  } finally { before.dispose(); after.dispose(); }
});

test('F6 real camera diagnostics exclude tiles behind the view and report a visible nearest bearing', () => {
  const p = bundle([raw(0,0,-1000),raw(1,0,1000)], '', 'standard', { ...terrain, insideA:()=>false });
  const view=buildKamakuraStands(p,options('?debug=1')), c=new THREE.PerspectiveCamera(60,1,.1,5000);
  c.position.set(0,20,0); c.lookAt(0,20,-1000); view.update(c);
  const report=globalThis.__kzCanopy();
  assert.equal(report.clumps.veg,2); assert.equal(report.drawn.tiles,1); assert.equal(report.drawn.instances,1); assert.equal(report.nearest.bearing,0);
  c.lookAt(0,20,1000); view.update(c); assert.equal(report.drawn.tiles,1); assert.equal(report.nearest.bearing,180);
  view.dispose();
});

test('F3 foliage-mean source textures and every constructed shape/material/mesh dispose exactly once', () => {
  const prototypes = [THREE.Texture.prototype,THREE.Material.prototype,THREE.BufferGeometry.prototype,THREE.InstancedMesh.prototype];
  const originals = prototypes.map(p=>p.dispose), calls = new Map();
  for (let k=0;k<prototypes.length;k++) prototypes[k].dispose = function() { calls.set(this,(calls.get(this)||0)+1); return originals[k].call(this); };
  try {
    const view=buildKamakuraStands(bundle([raw(0,500,0)], '', 'standard', { ...terrain, insideA:()=>false }),options(''));
    view.dispose(); view.dispose();
    assert([...calls.keys()].some(o=>o.isTexture)); assert([...calls.keys()].some(o=>o.isInstancedMesh));
    for (const count of calls.values()) assert.equal(count,1);
  } finally { for (let k=0;k<prototypes.length;k++) prototypes[k].dispose=originals[k]; }
});
