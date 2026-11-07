import { verifyScheduledSeams } from '../tools/lib/kamakura-chunk-validation.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { createKamakuraTerrain, groundEnabled } from '../dist/valley/kamakura-terrain.js';
import { decodeData, loadKamakura } from '../dist/valley/kamakura-data.js';
import { startWorld } from '../dist/valley/world-entry.js';
import { chunkGeometry } from '../dist/valley/kamakura-chunks.js';
import { readPrivateData, verifySeams } from '../tools/lib/kamakura-validation.mjs';
import { verifyGround } from '../tools/lib/kamakura-ground-validation.mjs';
function colored(options) {
  const f = fixture(options);
  f.meta.schema = 'kz-world-web/0.5'; f.meta.ground = { file: 'ground_rgb.bin' };
  f.ground = Uint8Array.from({ length: f.heights.length * 3 }, (_, i) => (i * 47) % 256);
  return f;
}
test('ground centres, north orientation, known sRGB conversion, linear interpolation, clamping and vscale', () => {
  const f = colored({ width: 2, height: 2, cell: 2 });
  f.ground.set([0, 10, 128, 255, 255, 255, 255, 0, 0, 0, 255, 0]);
  const t = createKamakuraTerrain(f);
  assert.deepEqual(t.groundColorAt(-1, -1), [0, 10 / 255 / 12.92, 0.21586050011389926]);
  assert.deepEqual(t.groundColorAt(1, -1), [1, 1, 1]);
  assert.deepEqual(t.groundColorAt(-1, 1), [1, 0, 0]);
  assert.deepEqual(t.groundColorAt(1, 1), [0, 1, 0]);
  const a = t.groundColorAt(-1,-1), b = t.groundColorAt(1,-1);
  assert.deepEqual(t.groundColorAt(0,-1), a.map((v,k) => (v+b[k])/2));
  const mid = t.groundColorAt(0,0);
  [0,1,2].forEach(k => assert(Math.abs(mid[k] - (a[k]+b[k]+[1,0,0][k]+[0,1,0][k])/4) < 1e-15));
  assert.deepEqual(t.groundColorAt(-100,-100),a);
  assert.deepEqual(t.groundColorAt(100,100),[0,1,0]);
  assert.deepEqual(t.groundColorAt(0,0), createKamakuraTerrain(f,1.8).groundColorAt(0,0));
});
test('optional loader supports all old schemas and reports missing, truncated, unsafe or redirected ground', async () => {
  const f = colored({ width: 2, height: 2 }), calls = [];
  const fetcher = async (url, opts) => {
    calls.push(url); assert.equal(opts.redirect, 'error');
    return { ok:true, json:async()=>f.meta, arrayBuffer:async()=>url.endsWith('height_u16.bin') ? f.heights.buffer : url.endsWith('walk_u8.bin') ? f.walk.buffer : f.ground.buffer };
  };
  const good = await loadKamakura(fetcher); assert.equal(good.ground.length,12); assert.equal(good.groundNotice,'');
  for (const mode of ['missing','short','url','redirect']) {
    f.meta.ground.file = mode === 'url' ? 'https://invalid.example/ground.bin' : 'ground_rgb.bin';
    calls.length=0;
    const d = await loadKamakura(async (url,opts) => {
      if (url.endsWith('ground_rgb.bin')) {
        if (mode === 'redirect') throw new Error('redirect');
        return {ok: mode !== 'missing',arrayBuffer:async()=>new ArrayBuffer(1)};
      }
      return fetcher(url,opts);
    });
    assert.equal(d.ground,null); assert(d.groundNotice); assert(createKamakuraTerrain(d).walkable(0,0));
    assert.equal(createKamakuraTerrain(d).groundColorAt(0,0),null);
    assert(calls.every(url=>url.startsWith('/world-private/')));
  }
  delete f.meta.ground;
  for (const version of [1,2,3,4]) {
    f.meta.schema = 'kz-world-web/0.'+version;
    const d = await loadKamakura(fetcher);
    assert.equal(d.ground,null); assert(d.groundNotice); assert.equal(createKamakuraTerrain(d).groundColorAt(0,0),null);
  }
  f.meta.ground = {file:'ground_rgb.bin'};
  const bad = decodeData(f.meta,f.heights.buffer,f.walk.buffer,undefined,new ArrayBuffer(1));
  assert.equal(bad.ground,null); assert(bad.groundNotice);
});
test('all LOD pairs and partial edges share identical Float32 colours without altering geometry', () => {
  const f = colored(), t = createKamakuraTerrain(f);
  assert.equal(verifySeams(t),32); assert.equal(verifySeams(t,128,128,8),32);
  assert.equal(verifyScheduledSeams(t,128,128,8).combinations,32);
  const g = chunkGeometry(t,0,0,64,64,1,{east:8});
  assert(g.colors instanceof Float32Array); assert.equal(g.colors.length,g.positions.length);
  const off = chunkGeometry(t,0,0,64,64,1,{east:8},groundEnabled('?world=kamakura&ground=0'));
  assert.equal(off.colors,null);
  for (const key of ['positions','normals','indices']) assert.deepEqual(g[key],off[key]);
  assert(groundEnabled('')); assert(groundEnabled('?ground=1'));
});
test('fine patch quarter vertices and base neighbors share the same ground query', () => {
  const f = colored();
  f.patches = {index:new Map([[63*f.meta.grid.width+63,0]]),heights:new Float32Array(25).fill(1000)};
  const t = createKamakuraTerrain(f);
  assert.equal(verifySeams(t),32); assert.equal(verifyScheduledSeams(t).combinations,32);
  const g = chunkGeometry(t,0,0,64,64,1,{east:1,south:1});
  for(let i=0;i<g.positions.length;i+=3) assert.deepEqual(Array.from(g.colors.slice(i,i+3)),
    Array.from(new Float32Array(t.groundColorAt(g.positions[i],g.positions[i+2]))));
});
test('real Three BufferGeometry uses neutral white vertex material; ground=0 and missing data preserve plain material', async () => {
  const three = new URL('../dist/vendor/three.module.min.js',import.meta.url).href;
  const THREE = await import(three);
  const source = (await fs.readFile(new URL('../dist/valley/kamakura-chunk-view.js',import.meta.url),'utf8'))
    .replace("from 'three'", `from '${three}'`)
    .replace("from './kamakura-ground-detail.js'", `from '${new URL('../dist/valley/kamakura-ground-detail.js',import.meta.url).href}'`)
    .replace("from './kamakura-chunk-jobs.js'", `from '${new URL('../dist/valley/kamakura-chunk-jobs.js',import.meta.url).href}'`)
    .replace("from './kamakura-fly.js'", `from '${new URL('../dist/valley/kamakura-fly.js',import.meta.url).href}'`)
    .replace("from './kamakura-chunks.js'", `from '${new URL('../dist/valley/kamakura-chunks.js',import.meta.url).href}'`);
  const {buildKamakuraChunks} = await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  for (const [f,on] of [[colored({width:70,height:70}),true],[colored({width:70,height:70}),false],[fixture({width:70,height:70}),true]]) {
    const scene=new THREE.Scene(), t=createKamakuraTerrain(f), pos={x:0,z:0};
    const field=buildKamakuraChunks(t,scene,pos,on);
    // Generation now uses elapsed time, rather than the former fixed count of two.
    field.update(pos); assert(scene.children.length >= 1 && scene.children.length <= 4);
    for(let i=0;i<10;i++)field.update(pos);
    assert(field.ready(pos)); assert.equal(scene.children.length,4);
    for (const mesh of scene.children) {
      const enabled=on && !!f.ground;
      assert.equal(mesh.material.vertexColors,enabled);
      assert.equal(!!mesh.geometry.getAttribute('color'),enabled);
      assert.equal(mesh.material.color.getHex(),enabled?0xffffff:0x858563);
      if(enabled) assert.equal(mesh.geometry.getAttribute('color').count,mesh.geometry.getAttribute('position').count);
    }
    field.dispose(); assert.equal(scene.children.length,0);
  }
});
test('ground query alone never activates private loading or replaces the original valley', async () => {
  for (const search of ['?ground=0','?ground=1','']) {
    let original=0;
    await startWorld(search,{valley:()=>{original++;},kamakura:()=>assert.fail('Unexpected private world'),fallback:()=>assert.fail('Unexpected fallback')});
    assert.equal(original,1);
  }
});
test('private v0.5 ground size, finite channels and dominant-class mean errors', {
  skip: !process.env.KZ_WORLD_DIR && 'KZ_WORLD_DIR未設定：私有の地面データが必要'
}, async t => {
  const {data} = await readPrivateData(process.env.KZ_WORLD_DIR);
  if (!data.meta.ground) {t.skip('meta.ground のない旧版');return;}
  t.diagnostic(JSON.stringify(await verifyGround(data,process.env.KZ_WORLD_DIR)));
});
