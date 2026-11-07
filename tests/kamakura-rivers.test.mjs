import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { decodeRivers, riverRibbon, splitRiverRibbon, prepareRivers, riverPolicy, riverDistanceAlpha, waterEnabled } from '../dist/valley/kamakura-rivers.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { startWorld } from '../dist/valley/world-entry.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { verifyRivers } from '../tools/lib/kamakura-river-validation.mjs';
const river = (xy = [[0, 0], [10, 0], [20, 0]], options = {}) => ({ id: 'synthetic', name: null, enters_sea: false,
  xy_m: xy, width_m: xy.map(() => 4), depth_m: xy.map(() => 1), bed_m: xy.map(() => 2), water_elev_m: xy.map(() => 2.5), ...options });
const catalog = () => ({ schema: 'kz-rivers/0.1', rivers: Array.from({ length: 27 }, (_, i) => river(undefined, { id: 'synthetic-' + i })) });
function triangles(g) {
  for (let i = 0; i < g.indices.length; i += 3) {
    const [a,b,c] = g.indices.slice(i,i+3).map(n => g.positions.slice(n*3,n*3+3));
    assert((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]) > 1e-6, 'upward and nondegenerate projected area');
  }
}
test('rivers strictly reject malformed catalog, counts, arrays, IDs and nonfinite or inverted water', () => {
  assert.equal(decodeRivers(catalog()).points, 81);
  const mutations = [d=>d.schema='bad', d=>d.rivers.pop(), d=>d.rivers[0].width_m.pop(), d=>d.rivers[0].xy_m[0][0]=Infinity,
    d=>d.rivers[0].width_m[0]=0, d=>d.rivers[0].water_elev_m[0]=2, d=>d.rivers[0].bed_m[0]=NaN,
    d=>d.rivers[0].depth_m[0]=-1, d=>d.rivers[0].id=d.rivers[1].id, d=>d.rivers[0].name=42,
    d=>d.rivers[0].enters_sea='yes', d=>d.rivers[0].xy_m[0]=null];
  for (const mutate of mutations) { const d=catalog(); mutate(d); assert.throws(()=>decodeRivers(d)); }
});
test('ribbon width, north mapping, vscale, monotone metric UV and upward triangles in both directions', () => {
  for (const xy of [[[0,0],[10,0],[20,0]], [[0,20],[0,10],[0,0]], [[20,0],[10,0],[0,0]]]) {
    const r=river(xy), g=riverRibbon(r,1.8);
    assert.equal(g.positions.length/3,6); assert.equal(g.indices.length,12); triangles(g);
    for(let i=0;i<xy.length;i++) {
      const k=i*6; assert(Math.abs(g.positions[k+1]-4.5)<1e-6); assert.equal(g.positions[k+4],g.positions[k+1]);
      assert(Math.abs(Math.hypot(g.positions[k]-g.positions[k+3],g.positions[k+2]-g.positions[k+5])-6.4)<1e-5);
      assert(Math.abs((g.positions[k]+g.positions[k+3])/2-xy[i][0])<1e-5);
      assert(Math.abs((g.positions[k+2]+g.positions[k+5])/2+xy[i][1])<1e-5);
      assert.equal(g.uvs[i*4],-1); assert.equal(g.uvs[i*4+2],1); assert.equal(g.uvs[i*4+1],i*10);
    }
  }
  assert.throws(()=>riverRibbon(river(),0));
});
test('duplicate points, zero sections, hairpins and folded wide bends never create degenerate triangles', () => {
  for (const xy of [[[0,0],[0,0],[10,0],[20,0]], [[0,0],[0,0]], [[0,0],[10,0],[0,0]], [[0,0],[1,0],[1,1],[1,2]]]) {
    const g=riverRibbon(river(xy)); triangles(g);
    assert(g.positions.every(Number.isFinite)); assert(g.uvs.every(Number.isFinite));
    for(let i=5;i<g.uvs.length;i+=4) assert(g.uvs[i]>g.uvs[i-4]);
  }
  assert.equal(riverRibbon(river([[0,0],[10,0],[0,0]])).indices.length,0);
});
test('sea crossing interpolates width, along distance and y=0, without overlaying sea', () => {
  const g=riverRibbon(river(undefined,{enters_sea:true,water_elev_m:[3,1,-1],bed_m:[2,0,-2]}),1.8);
  assert(g.seaClipped); assert.equal(g.positions[13],0); assert.equal(g.positions[12],15); assert.equal(g.uvs[9],15); triangles(g);
  assert.equal(riverRibbon(river(undefined,{enters_sea:true,water_elev_m:[-3,-2,-1]})).positions.length,0);
  assert(!riverRibbon(river()).seaClipped);
  const initial=riverRibbon(river(undefined,{enters_sea:true,water_elev_m:[-1,2,1]}));
  assert(initial.positions.every((v,i)=>i%3!==1||v>=0)); triangles(initial);
});
test('512m sections conserve triangles and all referenced vertices; seam duplication is explicit', () => {
  const r=river(Array.from({length:151},(_,i)=>[i*10,Math.sin(i*.05)*20])), g=riverRibbon(r), chunks=splitRiverRibbon(g);
  assert.equal(chunks.length,3); assert.equal(chunks.reduce((n,c)=>n+c.indices.length,0),g.indices.length);
  const seen=new Set();
  for(const c of chunks) {
    triangles(c);
    c.sourceVertices.forEach((source,i)=>{ seen.add(source); assert.deepEqual(c.positions.slice(i*3,i*3+3),g.positions.slice(source*3,source*3+3));
      assert.deepEqual(c.uvs.slice(i*2,i*2+2),g.uvs.slice(source*2,source*2+2)); });
  }
  assert.equal(seen.size,g.positions.length/3);
  assert.equal(chunks.reduce((n,c)=>n+c.positions.length/3,0),seen.size+2*(chunks.length-1));
});
test('optional river loading is local and failure leaves walkable terrain; schemas 0.1–0.6 stay supported', async () => {
  const f=fixture({width:2,height:2}), calls=[]; let payload=catalog();
  const fetcher=async(url,opts)=>{
    calls.push(url); assert.equal(opts.redirect,'error'); assert.equal(opts.cache,'no-store');
    return { ok:true,json:async()=>url.endsWith('meta.json')?f.meta:payload,
      arrayBuffer:async()=>url.endsWith('height_u16.bin')?f.heights.buffer:f.walk.buffer };
  };
  for(let version=1;version<=6;version++) {
    f.meta.schema='kz-world-web/0.'+version; calls.length=0;
    const data=await loadKamakura(fetcher); assert.equal(data.rivers,null); assert(!calls.some(u=>u.endsWith('rivers.json')));
    assert(createKamakuraTerrain(data).walkable(0,0));
  }
  f.meta.schema='kz-world-web/0.7'; f.meta.rivers={file:'rivers.json',count:27,points:81};
  const good=await loadKamakura(fetcher); assert.equal(good.rivers.rivers.length,27); assert.equal(good.riverNotice,'');
  for(const mode of ['url','missing','redirect','bad','count','points']) {
    calls.length=0; f.meta.rivers={file:mode==='url'?'https://invalid.example/rivers.json':'rivers.json',count:mode==='count'?26:27,points:mode==='points'?82:81};
    payload=mode==='bad'?{}:catalog();
    const data=await loadKamakura(async(url,opts)=>{
      if(url.endsWith('rivers.json') && ['missing','redirect'].includes(mode)) throw new Error(mode);
      return fetcher(url,opts);
    });
    assert.equal(data.rivers,null); assert(data.riverNotice); assert(createKamakuraTerrain(data).walkable(0,0));
    assert(calls.every(u=>u.startsWith('/world-private/')));
  }
});
test('water opt-out and missing data leave movement rules and the original valley entry intact', async () => {
  assert(!waterEnabled('?world=kamakura&water=0')); assert(waterEnabled('')); assert.equal(prepareRivers(null).chunks.length,0);
  const f=fixture(), t=createKamakuraTerrain(f), state=[t.heightAt(0,0),t.waterAt(0,0),t.walkable(0,0)];
  prepareRivers(decodeRivers(catalog())); assert.deepEqual([t.heightAt(0,0),t.waterAt(0,0),t.walkable(0,0)],state);
  for(const search of ['?water=0','?water=1','']) {
    let original=0; await startWorld(search,{valley:()=>original++,kamakura:()=>assert.fail(),fallback:()=>assert.fail()}); assert.equal(original,1);
  }
  const source=await fs.readFile(new URL('../dist/valley/world-kamakura.js',import.meta.url),'utf8');
  assert.match(source,/data.rivers && waterEnabled\(search\)/); assert.match(source,/sunDir: atmosphere.sunDir/);
  assert.match(source,/flight\.updateViews\(uniforms.uTime, paused \? 0 : dt\)/);
  const flightSource=await fs.readFile(new URL('../dist/valley/kamakura-fly-view.js',import.meta.url),'utf8');
  assert.match(flightSource,/water\?\.update\(time\)/); assert.match(source,/water\?\.dispose\(\)/);
});
test('shipped Three view: construction, shader uniforms/fog/distance, static geometry and idempotent disposal (no GPU)', async () => {
  const three=new URL('../dist/vendor/three.module.min.js',import.meta.url).href, THREE=await import(three);
  const source=(await fs.readFile(new URL('../dist/valley/kamakura-water-view.js',import.meta.url),'utf8')).replace("from 'three'",`from '${three}'`);
  const { buildKamakuraWater }=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  for(const quality of ['standard','light']) for(let run=0;run<3;run++) {
    const prepared=prepareRivers({rivers:[river(Array.from({length:151},(_,i)=>[i*10,0]))]},1,quality), sunDir=new THREE.Vector3(1,2,3).normalize();
    const view=buildKamakuraWater(prepared,{sunDir}), scene=new THREE.Scene(); scene.add(view.group);
    assert.equal(view.group.children.length,3); const mesh=view.group.children[0], before=mesh.geometry.attributes.position.array.slice();
    scene.updateMatrixWorld(true);
    for(const child of view.group.children) { assert.equal(child.matrixAutoUpdate,false); assert.deepEqual(child.matrixWorld.elements,new THREE.Matrix4().elements); }
    assert(mesh.frustumCulled); assert(mesh.geometry.boundingSphere.radius>0); assert.equal(mesh.renderOrder,2);
    assert(view.material.transparent); assert(!view.material.depthWrite); assert(view.material.fog);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};
    view.material.onBeforeCompile(shader); view.update(12.5); assert.equal(shader.uniforms.uTime.value,12.5);
    assert.deepEqual(shader.uniforms.SUN_DIR_W.value,sunDir); assert.equal(shader.uniforms.uWaterDistance.value,riverPolicy(quality).maxDistance);
    assert.match(shader.fragmentShader,/#include <fog_fragment>/); assert.match(shader.fragmentShader,/waterDistance >= uWaterDistance\) discard/);
    assert.match(shader.fragmentShader,/cameraPosition.xz/); assert.match(shader.fragmentShader,/smoothstep\(uWaterDistance - 128.0/);
    assert.match(shader.fragmentShader,/foam/); assert.match(shader.fragmentShader,/glint/);
    const d=riverPolicy(quality).maxDistance;
    assert.equal(riverDistanceAlpha(d-128,d),1); assert.equal(riverDistanceAlpha(d-64,d),.5); assert.equal(riverDistanceAlpha(d,d),0); assert.equal(riverDistanceAlpha(d+1,d),0);
    assert.deepEqual(mesh.geometry.attributes.position.array,before);
    let geometries=0, materials=0; for (const child of view.group.children) child.geometry.addEventListener('dispose',()=>geometries++); view.material.addEventListener('dispose',()=>materials++);
    view.dispose(); view.dispose(); assert.equal(geometries,3); assert.equal(materials,1); assert.equal(view.group.children.length,0); assert.equal(scene.children.length,0);
  }
  const originalGeometryDispose=THREE.BufferGeometry.prototype.dispose, originalMaterialDispose=THREE.Material.prototype.dispose;
  let releasedGeometries=0, releasedMaterials=0;
  THREE.BufferGeometry.prototype.dispose=function(){ releasedGeometries++; return originalGeometryDispose.call(this); };
  THREE.Material.prototype.dispose=function(){ releasedMaterials++; return originalMaterialDispose.call(this); };
  try {
    const p=prepareRivers({rivers:[river()]});
    p.chunks.push({get positions(){throw new Error('synthetic allocation failure');}});
    assert.throws(()=>buildKamakuraWater(p),/synthetic allocation failure/);
    assert.equal(releasedGeometries,2); assert.equal(releasedMaterials,1);
  } finally { THREE.BufferGeometry.prototype.dispose=originalGeometryDispose; THREE.Material.prototype.dispose=originalMaterialDispose; }
  const empty=buildKamakuraWater(prepareRivers(null)); assert.equal(empty.group.children.length,0); empty.dispose();
});
test('private v0.7: all river water/terrain distributions at 1× and 1.8×', {skip:!process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR 未設定：私有川データを省略'}, async t => {
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR);
  const report=await verifyRivers(data,process.env.KZ_WORLD_DIR); if(report.skip) t.skip(report.skip);
});
