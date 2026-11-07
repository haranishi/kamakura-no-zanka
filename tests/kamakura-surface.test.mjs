import test from 'node:test';
import assert from 'node:assert/strict';
import { surfaceWeights, createSurfaceAt, createRiverIndex, segmentBankDistance } from '../dist/valley/kamakura-surface.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { classifySurface, stepSurfaceAt } from '../dist/valley/step-surface.js';
import { mulberry32 } from '../dist/valley/scatter.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
const near = (a, b) => assert(Math.abs(a - b) < 1e-8, `${a} != ${b}`);
const river = (xy_m, width_m) => ({ xy_m, width_m });
const flat = () => fixture({ width: 3, height: 3, cell: 10 });
test('eight classes and none produce the existing step surface types', () => {
  const f = flat(); f.meta.surface = {}; f.surface = new Uint8Array([0,1,2,3,4,5,6,7,255]);
  const sample = createSurfaceAt(f.meta, f.surface);
  const expected = ['gravel','water','grass','leaves','dirt','stone','gravel','water','dirt'];
  for (let i = 0; i < 9; i++) {
    const weights = sample((i % 3 - 1) * 10, (Math.floor(i / 3) - 1) * 10);
    assert.equal(Object.values(weights).reduce((a,b) => a+b), 1);
    assert.equal(classifySurface(weights), expected[i]);
  }
  assert.deepEqual(sample(-5.01,-10),surfaceWeights(0));
  assert.deepEqual(sample(-4.99,-10),surfaceWeights(1));
  assert.deepEqual(sample(-999,-999),surfaceWeights(0));
  for (const samples of [null,new Uint8Array(8)]) assert.deepEqual(createSurfaceAt(f.meta,samples)(0,0),surfaceWeights(255));
  delete f.meta.surface; assert.deepEqual(createSurfaceAt(f.meta,f.surface)(0,0),surfaceWeights(255));
});
test('river banks: inside, boundary, far, north/south, varying half-width and absent rivers', () => {
  const index = createRiverIndex({ rivers: [river([[0,0],[100,0]],[10,10])] });
  for (const [x,z,d] of [[50,0,0],[50,5,0],[50,8,3],[50,-8,3],[-10,0,5],[1000,0,895]]) near(index.riverDistanceAt(x,z),d);
  assert.equal(createRiverIndex(null).riverDistanceAt(0,0),Infinity);
  const tapered = createRiverIndex({rivers:[river([[0,0],[100,0]],[10,30])]});
  near(tapered.riverDistanceAt(50,20),10);
});
test('256m index agrees with brute force, including empty cells, outside bounds and duplicate points', () => {
  const rng = mulberry32(51), rivers = Array.from({length:20},()=> {
    const points=Array.from({length:15},()=>[(rng()-.5)*6000,(rng()-.5)*6000]); points.push(points.at(-1));
    return river(points,points.map(()=>2+rng()*60));
  });
  const index=createRiverIndex({rivers});
  for(let i=0;i<1000;i++) {
    const x=(rng()-.5)*20000,z=(rng()-.5)*20000;
    near(index.riverDistanceAt(x,z),Math.min(...index.segments.map(s=>segmentBankDistance(s,x,z))));
  }
});
test('a river is wadeable through the real collision rule (waterAt under the 0.45 m cut-off) while the sea still blocks',()=>{
  const f=flat(); f.rivers={rivers:[river([[0,10],[0,-10]],[4,4])]};
  const t=createKamakuraTerrain(f), col=buildColliders({bounds:t.bounds});
  const w=t.waterAt(1,0); assert(w>0.05&&w<0.45,`river waterAt ${w}`);
  const moved=moveActor(col,t,{x:1,y:t.heightAt(1,0),z:0},0,1.5,.3);
  assert.notEqual(moved.blocked,'water'); assert(moved.z>.5,'the hero walked through the river');
  const g=flat(); g.walk.fill(2); const sea=createKamakuraTerrain(g);
  assert(sea.waterAt(0,0)>=.46); const stuck=moveActor(buildColliders({bounds:sea.bounds}),sea,{x:0,y:0,z:0},0,1.5,.3); assert.equal(stuck.blocked,'water');
});
test('river overlay yields water footsteps while walking/collision rules stay unchanged', () => {
  const f=flat(), before=createKamakuraTerrain(f); f.rivers={rivers:[river([[0,10],[0,-10]],[4,4])]};
  const t=createKamakuraTerrain(f);
  assert(t.waterAt(1,0)>0); assert.equal(t.waterAt(3,0),0);
  assert.equal(stepSurfaceAt(1,0,{terrain:t,world:{buildings:[]}}),'water');
  for(let x=-10;x<=10;x++) for(let z=-10;z<=10;z++) {
    assert.equal(t.walkable(x,z),before.walkable(x,z)); assert.equal(t.movementBlockedAt(x,z,.4),before.movementBlockedAt(x,z,.4));
  }
});
test('surface is optional, fixed local filename only, size-checked; schemas 0.1–0.9 remain valid', async () => {
  for (const kind of ['absent','valid','wrong-size','failed','url','encoding']) {
    const f=flat();f.meta.schema='kz-world-web/0.9';
    if(kind!=='absent')f.meta.surface={file:kind==='url'?'https://example.invalid/secret':'surface_class_u8.bin',encoding:kind==='encoding'?'float32':'uint8 (H,W)'};
    const calls=[];
    const data=await loadKamakura(async url=> {
      calls.push(url);
      const value=url.endsWith('height_u16.bin')?f.heights.buffer:url.endsWith('walk_u8.bin')?f.walk.buffer:new Uint8Array(kind==='wrong-size'?8:9).fill(2).buffer;
      return {ok:kind!=='failed'||!url.endsWith('surface_class_u8.bin'),json:async()=>f.meta,arrayBuffer:async()=>value};
    });
    assert(calls.every(url=>url.startsWith('/world-private/')));
    assert.equal(createKamakuraTerrain(data).surfaceAt(0,0).grass,kind==='valid'?1:0);
    if(['absent','url','encoding'].includes(kind))assert(!calls.some(u=>u.endsWith('surface_class_u8.bin')));
  }
  const {validateMeta}=await import('../dist/valley/kamakura-data.js');
  for(let n=1;n<=9;n++){const f=flat();f.meta.schema=`kz-world-web/0.${n}`;assert.equal(validateMeta(f.meta),f.meta);}
});

test('private v0.9 surface orientation, known codes, river index accuracy and CPU timing', {
  skip: !process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有のv0.9足元データが必要'
}, async t => {
  const {verifyPrivateSurface}=await import('../tools/lib/kamakura-surface-validation.mjs');
  const result=await verifyPrivateSurface(process.env.KZ_WORLD_DIR);
  if(result.skipped){t.skip(result.skipped);return;}
  t.diagnostic(JSON.stringify(result));
});
