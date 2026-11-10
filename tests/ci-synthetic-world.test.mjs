import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { syntheticWorld, writeSyntheticWorld } from '../tools/make-synthetic-world.mjs';
import { validateMeta, decodeData, loadKamakura } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { prepareVeg } from '../dist/valley/kamakura-veg.js';
import { prepareStands } from '../dist/valley/kamakura-stands.js';
import { parseGlb } from '../tools/lib/glb.mjs';
import { createHandler } from '../tools/serve.mjs';
const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
const digest=b=>createHash('sha256').update(b).digest('hex');
const readJson=(files,name)=>JSON.parse(files.get(name));
const load=files=>loadKamakura(async url=>{const b=files.get(url.slice('/world-private/'.length));assert.ok(b,`Missing startup file: ${url}`);return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>ab(b)};});
test('synthetic files repeat byte-for-byte, use a fixed seed and fit within 8 MB',()=>{
  const a=syntheticWorld(731),b=syntheticWorld(731);assert.equal(a.size,b.size);
  for(const [name,bytes] of a)assert.equal(digest(bytes),digest(b.get(name)),name);
  assert.ok([...a.values()].reduce((n,b)=>n+b.length,0)<=8_000_000);
  assert.notEqual(digest(a.get('ground_rgb.bin')),digest(syntheticWorld(732).get('ground_rgb.bin')));
});
test('schema 0.9 decodes every startup file, all surface classes, water, vegetation, houses and facilities',async()=>{
  const files=syntheticWorld(),meta=validateMeta(readJson(files,'meta.json'));
  const raw=decodeData(meta,ab(files.get(meta.height.file)),ab(files.get(meta.walk.file)),{cells:ab(files.get('patch_cells_i32.bin')),heights:ab(files.get('patch_h_f32.bin')),axes:readJson(files,'patch_axes.json'),paths:readJson(files,'patch_paths.json')},ab(files.get('ground_rgb.bin')));
  assert.equal(raw.heights.length,256*256);assert.equal(raw.groundNotice,'');
  const data=await load(files);assert.ok(data.houses);assert.ok(data.facilities);assert.ok(data.veg);assert.ok(data.rivers);
  for(const key of ['groundNotice','houseNotice','facilityNotice','vegNotice','riverNotice'])assert.ok(!data[key],key);
  assert.equal(new Set(data.surface).size,8);assert.equal(data.rivers.rivers.length,27);
  const terrain=createKamakuraTerrain(data);assert.ok(terrain.walkable(0,0));assert.ok(terrain.heightAt(0,500)<0);
  const trees=prepareVeg(data.veg,terrain);assert.ok(new Set(trees.active.map(t=>t.species)).size>=3);
  const stands=prepareStands(data.veg,terrain);assert.ok(stands.distant.size>0);
  assert.ok(data.patches.paths['synthetic-road']);assert.equal(data.houses.instances.length,3);
});
test('self-contained GLBs have normals, house parts, and dark hall interior primitives',()=>{
  const files=syntheticWorld();
  for(const name of ['houses_kit.glb','facilities.glb']){
    const {json,bin}=parseGlb(files.get(name));assert.ok(bin.length>0);assert.ok(!json.buffers.some(b=>b.uri));
    assert.ok(json.meshes[0].primitives.length>=2);
    for(const p of json.meshes[0].primitives){assert.ok(Number.isInteger(p.attributes.NORMAL));assert.equal(json.accessors[p.attributes.POSITION].count,json.accessors[p.attributes.NORMAL].count);}
    if(name==='facilities.glb')assert.ok(json.meshes[0].primitives.some(p=>p.material===1));
  }
});
test('written fixture serves all declared startup resources through /world-private without listening',async()=>{
  const dir=await fs.mkdtemp(path.join(process.cwd(),'.ci-synthetic-'));
  try{
    const stats=await writeSyntheticWorld(dir);assert.equal(stats.files,syntheticWorld().size);
    const handler=createHandler({worldDir:dir});
    for(const [name,bytes] of syntheticWorld()){
      let status,body;
      await handler({method:'GET',url:'/world-private/'+name},{writeHead(s){status=s;},end(b){body=b;}});
      assert.equal(status,200,name);assert.equal(digest(body),digest(bytes),name);
    }
  }finally{await fs.rm(dir,{recursive:true,force:true});}
});
test('no synthetic checksum matches private files when an explicit KZ_WORLD_DIR is available',async t=>{
  if(!process.env.KZ_WORLD_DIR){t.skip('No private data provided; generator never reads private data');return;}
  const privateHashes=new Set();
  for(const entry of await fs.readdir(process.env.KZ_WORLD_DIR,{withFileTypes:true}))if(entry.isFile())privateHashes.add(digest(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,entry.name))));
  for(const [name,b] of syntheticWorld())assert.ok(!privateHashes.has(digest(b)),name);
});
test('generated kits pass the shipped Three/GLTFLoader and house/facility placement paths without a GPU',async()=>{
  const [{THREE,loadFacilityView},{loadHouseView}]=await Promise.all([import('./helpers/kamakura-facility-view.mjs'),import('./helpers/kamakura-house-view.mjs')]);
  const data=await load(syntheticWorld()),terrain=createKamakuraTerrain(data),scene=new THREE.Scene();
  const {buildKamakuraFacilities}=await loadFacilityView(),{buildKamakuraHouses}=await loadHouseView();
  const facilities=await buildKamakuraFacilities(data.facilities,terrain,scene,'standard',{search:'?ftex=0'});
  let houses;
  try{
    houses=await buildKamakuraHouses(data.houses,terrain,scene,{search:'?htex=0'});
    // The synthetic world has a hall and, since the paved approaches, a gate in front of it.
    assert.equal(facilities.records.length,2);const hall=facilities.records.find(r=>r.node.part==='hall');assert(hall);assert.equal(hall.meshes.length,9);
    assert.equal(houses.boxes.length,3);assert.ok(hall.meshes.some(m=>m.material.name==='interior'));
  }finally{houses?.dispose();facilities.dispose();}
});
