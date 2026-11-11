import test from 'node:test';
import assert from 'node:assert/strict';
import { atmosphereOptions, atmospherePolicy, kamakuraAtmosphere, validateAtmosphere, DEFAULT_TIME, KAMAKURA_TIMES, SUN_PLACE, sunPlace, placeSun } from '../dist/valley/kamakura-atmosphere.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { startWorld } from '../dist/valley/world-entry.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
const { ATMOS } = await load('atmosphere.js');
const { createKamakuraAtmosphere } = await load('kamakura-atmosphere-view.js');
const base = () => ({ ...ATMOS, sunDir: ATMOS.sunDir.toArray() });
const chunks = () => Object.fromEntries(['fog_pars_vertex','fog_vertex','fog_pars_fragment','fog_fragment'].map(k=>[k,THREE.ShaderChunk[k]]));
// Real bundled PMREM/Three objects, renderer protocol only. No GPU draw or GLSL compilation.
function rendererStub(fail = false) {
  let target = null, draws = 0;
  const live = new Set(), seen = new Set();
  const track = r => { if (!r || seen.has(r)) return; seen.add(r); live.add(r); r.addEventListener('dispose', () => live.delete(r)); };
  return { shadowMap: { enabled: false, type: THREE.BasicShadowMap }, xr: {enabled:true}, autoClear:true, toneMapping:THREE.NoToneMapping,
    state:{buffers:{depth:{getReversed:()=>false}}}, compile() {},
    getRenderTarget:()=>target, getActiveCubeFace:()=>0, getActiveMipmapLevel:()=>0,
    getClearColor: c=>c.set(0), setRenderTarget(t) { target=t; track(t); },
    render(object) { object.traverse(o=>{track(o.geometry); for(const m of [].concat(o.material || [])) track(m);}); draws++; if(fail === true || draws === fail) throw Error('GPU unavailable'); },
    live, seen, get draws() {return draws;},
  };
}
test('time/atmos defaults, all presets, invalid values and comparison switch', () => {
  for (const search of ['', '?time=', '?time=night', '?time=constructor', '?time=toString']) assert.deepEqual(atmosphereOptions(search), {enabled:true,time:DEFAULT_TIME});
  for (const time of ['noon','morning','golden','evening']) assert.deepEqual(atmosphereOptions('?time='+time), {enabled:true,time});
  assert.deepEqual(atmosphereOptions('?atmos=0&time=morning'), {enabled:false,time:'morning'});
  for(const v of ['','false','off','1','00']) assert(atmosphereOptions('?atmos='+v).enabled);
  assert.equal(atmospherePolicy('light').shadowSize,2048); assert.equal(atmospherePolicy().shadowSize,4096);
  assert(!atmospherePolicy('light').standShadows); assert(atmospherePolicy().standShadows); assert(!atmospherePolicy('standard',false).shadows);
});
test('validated normalized directions, elevation, colors, thin haze and independent evening copy', () => {
  const original = JSON.stringify(base());
  for (const [time,elevation] of [['noon',58],['morning',25],['golden',21.74],['evening',9.78]]) {
    const a = kamakuraAtmosphere(time,base(),false); validateAtmosphere(a);
    assert(Math.abs(Math.hypot(...a.sunDir)-1)<1e-12);
    assert(Math.abs(Math.asin(a.sunDir[1])*180/Math.PI-elevation)<.1);
    assert(a.sunDir[2]>0); if(time==='noon') assert(a.sunDir[0]<.1); if(time==='morning') assert(a.sunDir[0]>a.sunDir[2]);
    assert(a.fogDensity>=.00008 && a.fogDensity<=.00012); assert(a.mist.density<=.0001);
    if(time==='evening') for(const k of Object.keys(ATMOS).filter(k=>!['sunDir','mist','fogDensity'].includes(k))) assert.equal(a[k],ATMOS[k]);
    a.mist.base=500; a.sunDir[0]=123;
  }
  assert.equal(JSON.stringify(base()),original);
  const good=kamakuraAtmosphere('noon',base());
  for(const bad of [{sunColor:'#fff'},{sunDir:[0,0,0]},{sunDir:[0,1,0]},{sunDir:[NaN,1,1]},{sunIntensity:Infinity},{hemiIntensity:-1},{fogDensity:.0007},{mist:{density:.0012,base:0,falloff:.045}}]) assert.throws(()=>validateAtmosphere({...good,...bad}),RangeError);
});
test('foliage gain: only the low sun carries one; three bounded numbers or nothing', () => {
  const golden=kamakuraAtmosphere('golden',base(),false);
  assert(Array.isArray(golden.foliage)&&golden.foliage.length===3&&golden.foliage.every(v=>v>=1&&v<=2.5));
  assert(golden.foliage[0]>golden.foliage[2],'the gain is warmer than it is bright: more red and green than blue');
  for(const time of ['noon','morning','evening']) assert.equal(kamakuraAtmosphere(time,base(),false).foliage,undefined);
  const good=kamakuraAtmosphere('noon',base());
  for(const foliage of [[1,1],[1,1,1,1],[.4,1,1],[1,1,2.6],[1,NaN,1],'1,1,1',{0:1,1:1,2:1},null]) assert.throws(()=>validateAtmosphere({...good,foliage}),RangeError);
  for(const foliage of [undefined,[1,1,1],[.5,2.5,1]]) validateAtmosphere({...good,foliage});
});
test('actual atmosphere creation, fog once before materials, quality, follow, update and repeat disposal', () => {
  const fogBefore=chunks(), original=JSON.stringify(base());
  for (const quality of ['standard','light']) for (const time of ['noon','morning','golden','evening']) {
    const scene=new THREE.Scene(), renderer=rendererStub(), external=new THREE.Group(); scene.add(external);
    const background=scene.background=new THREE.Color('#123456');
    const controller=createKamakuraAtmosphere({scene,renderer,search:'?time='+time,quality});
    const a=controller.atmosphere; assert(a,'real createAtmosphere must succeed'); assert.equal(controller.notice,'');
    assert.equal(scene.background,null); assert(scene.fog.isFogExp2); assert(scene.environment.isTexture); assert(renderer.draws>6);
    assert(renderer.shadowMap.enabled); assert.equal(renderer.shadowMap.type,THREE.PCFSoftShadowMap);
    assert.equal(a.sun.shadow.mapSize.x,quality==='light'?2048:4096); assert.equal(a.sun.shadow.camera.left,-46); assert.equal(a.sun.shadow.camera.right,46);
    assert(a.sun.castShadow); assert.equal(a.params.sunDir.length(),1);
    const seenBefore = renderer.seen.size;
    for (let i=0;i<4;i++) { controller.setAdapt({shadows:false}); assert(!a.sun.castShadow); controller.setAdapt({shadows:true}); assert(a.sun.castShadow); }
    assert.equal(renderer.seen.size,seenBefore);
    const installed=chunks(), camera=new THREE.PerspectiveCamera(); camera.position.set(2,10,3);
    const skyG=a.sky.geometry, skyM=a.sky.material; let skyDisposed=0; skyG.addEventListener('dispose',()=>skyDisposed++); skyM.addEventListener('dispose',()=>skyDisposed++);
    controller.update(camera,.1,{x:200,y:5,z:300},Math.PI/2);
    assert(a.sky.position.equals(camera.position)); assert(Math.abs(a.sun.target.position.x-192)<.03); assert(Math.abs(a.sun.target.position.z-300)<.03);
    assert.deepEqual(chunks(),installed); // update never reinstalls shader chunks
    const unrelated=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshLambertMaterial()); scene.add(unrelated);
    assert(unrelated.material.fog); // sea uses this same fog-enabled Lambert path
    // Simulate the shadow target allocated on first GPU frame; disposal must own it too.
    const map=a.sun.shadow.map=new THREE.WebGLRenderTarget(2,2); let shadowDisposed=0; map.addEventListener('dispose',()=>shadowDisposed++);
    controller.dispose(); controller.dispose();
    assert.equal(skyDisposed,2); assert.equal(shadowDisposed,1); assert.equal(renderer.live.size,0);
    assert.equal(scene.background,background); assert.deepEqual(scene.children,[external,unrelated]); assert.equal(scene.environment,null); assert.equal(scene.fog,null);
    assert.deepEqual(chunks(),fogBefore); assert(!renderer.shadowMap.enabled); assert(renderer.xr.enabled);
    unrelated.geometry.dispose(); unrelated.material.dispose();
  }
  assert.equal(JSON.stringify(base()),original);
});
test('atmos=0 skips PMREM and shader installation; initialization failure restores legacy lights and all resources', () => {
  for (const [search,fail] of [['?atmos=0',false],['',true],['',15]]) {
    const before=chunks(), renderer=rendererStub(fail), scene=new THREE.Scene();
    const c=createKamakuraAtmosphere({scene,renderer,search});
    assert.equal(c.atmosphere,null); assert(!renderer.shadowMap.enabled); assert.equal(scene.background.getHex(),0xacc3cb);
    assert.equal(scene.children.filter(o=>o.isLight).length,2); assert.equal(scene.fog,null); assert.equal(scene.environment,null);
    assert.equal(c.policy.shadows,false); assert.equal(!!c.notice,!!fail); if(!fail) assert.equal(renderer.draws,0);
    assert.deepEqual(chunks(),before); assert(renderer.xr.enabled); assert(renderer.autoClear);
    c.dispose(); assert.equal(renderer.live.size,0); assert.equal(scene.children.length,0); assert.deepEqual(chunks(),before);
  }
});
test('ground receives shadows after progressive rebuilding, house flags and boot ordering stay wired', async () => {
  const {buildKamakuraChunks}=await load('kamakura-chunk-view.js');
  const scene=new THREE.Scene(), t=createKamakuraTerrain(fixture({width:9,height:9}));
  const view=buildKamakuraChunks(t,scene,{x:0,z:0}); view.update({x:0,z:0});
  assert(scene.children.length); assert(scene.children.every(o=>o.receiveShadow && o.material.fog)); view.dispose(); assert.equal(scene.children.length,0);
  const boot=source('world-kamakura.js');
  assert(boot.indexOf('atmosphere = createKamakuraAtmosphere')<boot.indexOf('roster = await loadRoster'));
  assert(boot.indexOf('atmosphere = createKamakuraAtmosphere')<boot.indexOf('chunks = buildKamakuraChunks'));
  assert.match(boot,/flight\.updateViews\(uniforms.uTime, paused \? 0 : dt\)/);
  assert.match(source('kamakura-fly-view.js'),/atmosphere\.update\(camera, dt, pos, yaw, state.mode !== 'walk', terrain\)/);
  assert.match(source('kamakura-house-view.js'),/mesh.castShadow = true; mesh.receiveShadow = true/);
  assert.match(source('characters.js'),/o.castShadow = true; o.receiveShadow = true/);
});
// A map may move the sun (meta.sun): the direction turns clockwise seen from above and rises or sinks, and nothing else changes.
const azimuth = d => (Math.atan2(d[0], -d[2]) * 180 / Math.PI + 360) % 360, height = d => Math.asin(d[1]) * 180 / Math.PI;
const near = (a, b, e = 1e-9) => assert(Math.abs(a - b) < e, `${a} vs ${b}`);
test('sun place: a map turns and lifts the sun of every time, and leaves it alone when it says nothing', () => {
  for (const time of Object.keys(KAMAKURA_TIMES)) {
    const plain = kamakuraAtmosphere(time, base(), false);
    assert.deepEqual(kamakuraAtmosphere(time, base(), false, 1, undefined).sunDir, plain.sunDir);
    assert.deepEqual(kamakuraAtmosphere(time, base(), false, 1, { turn: 0, lift: 0 }).sunDir, plain.sunDir);
    assert.deepEqual(placeSun(plain.sunDir), plain.sunDir); assert.notEqual(placeSun(plain.sunDir), plain.sunDir);
    for (const [turn, lift] of [[40, 0], [-75, 0], [0, 18], [0, -9], [40, 18], [180, 45], [-180, -45]]) {
      const placed = kamakuraAtmosphere(time, base(), false, 1, { turn, lift }), d = placed.sunDir;
      near(Math.hypot(...d), 1);
      near((azimuth(d) - azimuth(plain.sunDir) - turn + 720) % 360 < 1e-6 ? 0 : (azimuth(d) - azimuth(plain.sunDir) - turn + 720) % 360 - 360, 0, 1e-6);
      near(height(d), Math.max(SUN_PLACE.low, Math.min(SUN_PLACE.high, height(plain.sunDir) + lift)), 1e-9);
      const rest = a => { const { sunDir, ...others } = a; return others; }; assert.deepEqual(rest(placed), rest(plain));
      validateAtmosphere(placed);
    }
  }
  // East of north is clockwise: a sun in the south turned by +90 stands in the west.
  const west = placeSun([0, Math.SQRT1_2, Math.SQRT1_2], { turn: 90 }); near(west[0], -Math.SQRT1_2); near(west[2], 0); near(west[1], Math.SQRT1_2);
});
test('sun place: the stored fields are checked, and the address overrides each of them for tuning', () => {
  assert.deepEqual(sunPlace(undefined), { turn: 0, lift: 0 }); assert.deepEqual(sunPlace({}), { turn: 0, lift: 0 }); assert.deepEqual(sunPlace({ sun: {} }), { turn: 0, lift: 0 });
  assert.deepEqual(sunPlace({ sun: { turn_deg: 30, lift_deg: -12 } }), { turn: 30, lift: -12 });
  assert.deepEqual(sunPlace({ sun: { turn_deg: 30, lift_deg: -12 } }, '?sunturn=-45'), { turn: -45, lift: -12 });
  assert.deepEqual(sunPlace({ sun: { turn_deg: 30 } }, '?sunlift=20&sunturn=0'), { turn: 0, lift: 20 });
  for (const search of ['?sunturn=', '?sunturn=abc', '?sunturn=181', '?sunlift=46', '?sunlift=Infinity']) assert.deepEqual(sunPlace({ sun: { turn_deg: 30, lift_deg: 5 } }, search), { turn: 30, lift: 5 });
  for (const sun of [null, [], 'west', 3, { turn_deg: '30' }, { turn_deg: NaN }, { turn_deg: 180.5 }, { lift_deg: 45.5 }, { lift_deg: null }, { turn_deg: 1, azimuth: 2 }]) {
    assert.throws(() => sunPlace({ sun }), RangeError); const f = fixture(); f.meta.sun = sun; assert.throws(() => validateMeta(f.meta));
  }
  const f = fixture(); f.meta.sun = { turn_deg: 30, lift_deg: 14 }; assert.equal(validateMeta(f.meta), f.meta);
});
test('sun place: the light, the sky and everything that asks the world for the sun get the moved direction', () => {
  const scene = new THREE.Scene(), renderer = rendererStub(), place = { turn: 30, lift: 14 };
  const plain = createKamakuraAtmosphere({ scene: new THREE.Scene(), renderer: rendererStub(), search: '?time=golden' });
  const moved = createKamakuraAtmosphere({ scene, renderer, search: '?time=golden', sunPlace: place });
  const expected = placeSun(plain.atmosphere.params.sunDir.toArray(), place);
  moved.atmosphere.params.sunDir.toArray().forEach((v, i) => near(v, expected[i], 1e-12));
  moved.sunDir.toArray().forEach((v, i) => near(v, expected[i], 1e-12));
  const camera = new THREE.PerspectiveCamera(); moved.update(camera, .1, { x: 0, y: 0, z: 0 }, 0);
  const toSun = moved.atmosphere.sun.position.clone().sub(moved.atmosphere.sun.target.position).normalize().toArray();
  toSun.forEach((v, i) => near(v, expected[i], 1e-6));
  plain.dispose(); moved.dispose();
  const boot = source('world-kamakura.js');
  assert.match(boot, /createKamakuraAtmosphere\(\{ scene, renderer, search, quality, sunPlace: sunPlace\(data\.meta, search\) \}\)/);
});
test('world absent never initializes Kamakura even with time and atmosphere query parameters', async()=>{
  let valley=0; await startWorld('?time=morning&atmos=0',{valley:()=>valley++,kamakura:()=>assert.fail(),fallback:()=>assert.fail()}); assert.equal(valley,1);
});
