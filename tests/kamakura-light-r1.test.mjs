import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { kamakuraAtmosphere, eveningEnabled, eveningLight, sunBacklight, validateAtmosphere } from '../dist/valley/kamakura-atmosphere.js';
import { bloomLift, bloomCap } from '../dist/valley/kamakura-post.js';
const { LEGACY_ATMOS: ATMOS } = await load('atmosphere.js');
const { installKamakuraFog } = await load('kamakura-atmosphere-view.js');
const { createKamakuraPost } = await load('kamakura-post-view.js');
const base = { ...ATMOS, sunDir: ATMOS.sunDir.toArray() };
test('R1 evening A/B, bounded color interpolation, unchanged day/morning and public backlight', () => {
  assert(eveningEnabled('')); assert(!eveningEnabled('?evening2=0'));
  for (const time of ['noon', 'morning']) assert.deepEqual(kamakuraAtmosphere(time, base), kamakuraAtmosphere(time, base, false));
  const old = kamakuraAtmosphere('evening', base, false), next = kamakuraAtmosphere('evening', base);
  assert.deepEqual(eveningLight(old, 0), old);
  assert.equal(next.sunColor, old.sunColor); assert.equal(next.hemiSky, '#acb4da');
  for (let i = -1; i <= 11; i++) validateAtmosphere(eveningLight(old, i / 10));
  assert.deepEqual(next.sunDir, old.sunDir);
  assert.equal(sunBacklight([0,0,-1],[0,0,1]),1);
  assert.equal(sunBacklight([0,0,1],[0,0,1]),0);
  assert.equal(sunBacklight([0,0,0],[0,0,1]),0);
  for (let i=-10;i<=10;i++) assert(sunBacklight([i,1,-2],next.sunDir,.55) <= .55);
});
test('R1 synthetic HDR lift is monotonic and bounded for gray and saturated highlights', t => {
  for (const search of ['', '?time=evening']) {
    const cap = bloomCap(search); let previous = 0;
    for (let i=0;i<=100000;i++) {
      const value=bloomLift(i/100,1.05,cap);
      assert(value>=previous && value<=cap); previous=value;
    }
    assert.equal(bloomLift(1.05,1.05,cap),0);
    // GPU uses peak-normalized RGB: each channel <= lift, regardless of hue.
    for (const rgb of [[100,0,0],[0,100,0],[0,0,100],[100,100,100]]) {
      const l=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722, lift=bloomLift(l,1.05,cap);
      for(const c of rgb) assert(c/100*lift<=cap);
    }
    t.diagnostic(`cap=${cap}; lift(1000)=${previous}`);
  }
  assert.equal(bloomCap('?evening2=0'),0);
});
test('R1 fog has no geometry or bands; legacy restores exact chunks; GLSL remains balanced', () => {
  const keys=['fog_pars_vertex','fog_vertex','fog_pars_fragment','fog_fragment'];
  const saved=keys.map(k=>THREE.ShaderChunk[k]);
  try {
    const a={...kamakuraAtmosphere('evening',base),sunDir:ATMOS.sunDir};
    installKamakuraFog(a,false); const old=THREE.ShaderChunk.fog_fragment;
    assert.match(old,/float bandY/);
    installKamakuraFog(a,true,true);
    assert(!THREE.ShaderChunk.fog_fragment.includes('bandY'));
    assert.match(THREE.ShaderChunk.fog_pars_fragment,/smoothstep\(0.65, 0.995/);
    for(const k of keys) {
      const shader=THREE.ShaderChunk[k].replace(/\/\/[^\n]*/g,''), stack=[];
      for(const c of shader) { if('([{'.includes(c))stack.push(c); else if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]); }
      assert.equal(stack.length,0);
      let depth=0;
      for(const line of shader.split('\n')) { if(/^\s*#if/.test(line))depth++; if(/^\s*#endif/.test(line))depth--; assert(depth>=0); }
      assert.equal(depth,0);
      assert(!/\b(?:float|int|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource)\b/.test(shader));
    }
    installKamakuraFog(a,false); assert.equal(THREE.ShaderChunk.fog_fragment,old);
  } finally { keys.forEach((k,i)=>THREE.ShaderChunk[k]=saved[i]); }
});
test('R1 actual world HUD reset wiring counts scene plus post, once each frame', () => {
  const world=source('world-kamakura.js'), order=[];
  const info={render:{calls:99,triangles:99},reset(){order.push('reset');this.render.calls=0;this.render.triangles=0;}};
  Object.defineProperty(info,'autoReset',{get(){return false;},set(v){assert.equal(v,false);order.push('autoReset=false');}});
  const renderer={info,toneMapping:0,toneMappingExposure:1,autoClear:true,
    getDrawingBufferSize:v=>v.set(1280,720),getRenderTarget:()=>null,setRenderTarget(){},
    render(scene){order.push('draw');info.render.calls+=scene.name==='synthetic-world'?300:1;info.render.triangles+=scene.name==='synthetic-world'?100000:1;}};
  const init=world.match(/renderer.info.autoReset = false;/); assert(init);
  new Function('renderer',init[0])(renderer);
  const p=createKamakuraPost({renderer}), scene=new THREE.Scene(),camera=new THREE.PerspectiveCamera();scene.name='synthetic-world';
  const reset=world.match(/renderer.info.reset\(\);/g);assert.equal(reset.length,1);
  assert(world.indexOf(reset[0])<world.indexOf('post.render(scene, camera)'));
  for(let i=0;i<2;i++) {
    new Function('renderer',reset[0])(renderer);p.render(scene,camera);
    assert.equal(info.render.calls,305);assert.equal(info.render.triangles,100005);
  }
  assert.deepEqual(order,['autoReset=false','reset',...Array(6).fill('draw'),'reset',...Array(6).fill('draw')]);
  p.dispose();p.dispose();
});
