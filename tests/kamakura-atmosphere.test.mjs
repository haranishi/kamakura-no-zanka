import test from 'node:test';
import assert from 'node:assert/strict';
import { atmosphereOptions, atmospherePolicy, kamakuraAtmosphere, validateAtmosphere, DEFAULT_TIME} from '../dist/valley/kamakura-atmosphere.js';
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
test('world absent never initializes Kamakura even with time and atmosphere query parameters', async()=>{
  let valley=0; await startWorld('?time=morning&atmos=0',{valley:()=>valley++,kamakura:()=>assert.fail(),fallback:()=>assert.fail()}); assert.equal(valley,1);
});
