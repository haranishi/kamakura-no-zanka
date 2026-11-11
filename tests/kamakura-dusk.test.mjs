import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { shoreNoise } from '../dist/valley/kamakura-shore.js';
import { sceneSearch, atmosphereOptions, KAMAKURA_TIMES, DUSK, SUN_DISC, isEveningLike, kamakuraAtmosphere, validateAtmosphere, sunPlace, visualSun } from '../dist/valley/kamakura-atmosphere.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { buddhaSearch, buddhaHallMode } from '../dist/valley/kamakura-facilities.js';
import { overlookConfig, overlookPose, camOption, createFly, FREE_OVERLOOK_FIELDS } from '../dist/valley/kamakura-fly.js';
import { timeSwitchSearch } from '../dist/valley/kamakura-time-switch.js';
import { driftAmounts } from '../dist/valley/kamakura-drift.js';
import { faunaAmounts } from '../dist/valley/kamakura-fauna.js';
import { voiceLikelihood, voiceInterval } from '../dist/valley/kamakura-soundscape.js';
import { shadeSettings, bloomCap } from '../dist/valley/kamakura-post.js';
import { prepareRivers } from '../dist/valley/kamakura-rivers.js';
import { seaDiscPath } from '../dist/valley/kamakura-sea-far.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { loadFacilityView } from './helpers/kamakura-facility-view.mjs';
import { box, makeGlb } from '../tools/lib/synthetic-glb.mjs';
const { ATMOS, skyMaterial } = await load('atmosphere.js');
const { kamakuraSkyMaterial, createKamakuraAtmosphere } = await load('kamakura-atmosphere-view.js');
const { buildKamakuraSea } = await load('kamakura-sea-view.js');
const base = () => ({ ...ATMOS, sunDir: ATMOS.sunDir.toArray() });
const near = (a,b,e=1e-8) => assert(Math.abs(a-b)<e, `${a} != ${b}`);
const bearing = d => (Math.atan2(d[0],-d[2])*180/Math.PI+360)%360;
const elevation = d => Math.asin(d[1])*180/Math.PI;
const seaTerrain = () => ({cell:2,bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},heightAt:(_x,z)=>-z*.2,isSea:(_x,z)=>z>=0,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>0});
const seaData = () => ({rivers:[],meta:{grid:{width:101,height:101,cell_m:2},surface:{},sea:{surf_scale:.4}},surface:new Uint8Array(10201)});
const compile = v => {const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};v.mesh.material.onBeforeCompile(s);return s;};

test('map time is strict, URL wins, absence retains golden, and boot resolves before any downstream consumer', () => {
  for (const [meta,query,time] of [[{},'?world=kamakura','golden'],[{time:'dusk'},'?world=kamakura','dusk'],[{time:'dusk'},'?world=kamakura&time=noon','noon'],[{time:'dusk'},'?time=','golden']]) {
    const search=sceneSearch(meta,query); assert.equal(atmosphereOptions(search).time,time);
    if(meta.time && !new URLSearchParams(query).has('time')) assert.equal(new URLSearchParams(search).get('time'),meta.time);
    else assert.equal(search,query);
    assert.equal(new URLSearchParams(timeSwitchSearch(search)).get('time'),time==='dusk'?'morning':time==='noon'?'golden':'evening');
  }
  for(const time of ['night','constructor','toString',null,4,{},[]]) { const f=fixture(); f.meta.time=time; assert.throws(()=>validateMeta(f.meta)); }
  const boot=source('world-kamakura.js'), resolve=boot.indexOf('search = buddhaSearch(data.meta, sceneSearch(data.meta, search))');
  for(const call of ['createKamakuraTerrain(data','createKamakuraAtmosphere({','createKamakuraPost({','buildKamakuraSea(t','createKamakuraAudio({','createKamakuraLayers({']) assert(resolve>=0 && resolve<boot.indexOf(call));
  for(const name of ['kamakura-atmosphere-view.js','kamakura-post-view.js','kamakura-props-view.js','kamakura-fauna-view.js','kamakura-soundscape-view.js','kamakura-sea-view.js']) assert.match(source(name),/atmosphereOptions\((?:context\.)?search\)/);
});

test('dusk passes validation, faces WSW at six degrees, keeps a blue sky light, dims the fill, and turns the leaves darker and bluer', () => {
  const dusk=kamakuraAtmosphere('dusk',base()), evening=kamakuraAtmosphere('evening',base());
  validateAtmosphere(dusk); near(bearing(dusk.sunDir),250,1e-6);near(elevation(dusk.sunDir),6,1e-6);
  assert(dusk.sunIntensity<evening.sunIntensity);
  // Tuned in real Chrome: the sky light stays near the evening's (level ground gets almost nothing from a sun at six degrees),
  // the fill and the reflections are dimmer.
  for(const [key,low,high] of [['hemiIntensity',.75,1.1],['fillIntensity',.5,.8],['envIntensity',.5,.8]]){const ratio=dusk[key]/evening[key];assert(ratio>=low&&ratio<=high,`${key} ${ratio}`);}
  assert(dusk.mist.density>evening.mist.density);
  assert(dusk.foliage.every(v=>v<1)&&dusk.foliage[2]>dusk.foliage[1]&&dusk.foliage[1]>dusk.foliage[0],'leaves are darker and bluer than in daylight');
  assert(Object.isFrozen(DUSK)&&Object.isFrozen(DUSK.mist)&&Object.isFrozen(DUSK.sunDir));
  assert(isEveningLike('dusk')&&isEveningLike('evening'));for(const time of ['golden','morning','noon','night',null])assert(!isEveningLike(time));
});

test('four existing presets stay exactly as shipped, and the shared sky without the optional factory is unchanged', () => {
  // Fixed before the change: independent of the branch HEAD after merging.
  const previous = {
    morning: {"postExposure":1.04,"postBloom":0.15,"postGlare":0.85,"postWarmth":0.012,"postToe":0.6,"postShade":0.15,"sunDir":[0.837319,0.4226182617,0.346829],"sunColor":"#ffe6bf","sunIntensity":2.6,"zenith":"#648bb9","mid":"#adc5dc","horizon":"#d1e0ea","below":"#7e9085","fogColor":"#c4d8e8","hazeCool":"#c4d8e8","hazeWarm":"#e9ddd0","hazeExp":5,"fogDensity":0.00012,"mist":{"density":0.00006,"base":-4,"falloff":0.045},"hemiSky":"#b6cfe6","hemiGround":"#707b58","hemiIntensity":1,"envIntensity":0.7,"fillColor":"#b9cfe7","fillIntensity":0.35,"exposure":1},
    noon: {"postExposure":1,"postBloom":0.12,"postGlare":0.7,"postWarmth":0.008,"postToe":0.6,"postShade":0.15,"sunDir":[0.08,0.8480480962,0.523803],"sunColor":"#fff1d6","sunIntensity":2.8,"zenith":"#5a86c0","mid":"#a4c3df","horizon":"#cfe0ea","below":"#829389","fogColor":"#cfe0ea","hazeCool":"#cfe0ea","hazeWarm":"#e0e6e7","hazeExp":4,"fogDensity":0.0001,"mist":{"density":0.00004,"base":-4,"falloff":0.045},"hemiSky":"#c3dcf2","hemiGround":"#75825b","hemiIntensity":1.2,"envIntensity":0.7,"fillColor":"#d0e1f2","fillIntensity":0.3,"exposure":1},
    golden: {"postExposure":1.06,"postBloom":0.16,"postGlare":0.95,"postWarmth":0.028,"postToe":0.7,"postShade":0.22,"sunDir":[-0.8008814546671346,0.3704076727835497,0.4705178546169415],"sunColor":"#ffd08c","sunIntensity":4.2,"zenith":"#4f7fbd","mid":"#a9c0d8","horizon":"#ecdcc8","below":"#868f88","fogColor":"#b7c6d8","hazeCool":"#a9bcd6","hazeWarm":"#f4cf96","hazeExp":7,"fogDensity":0.00011,"mist":{"density":0.00006,"base":-4,"falloff":0.045},"hemiSky":"#b2c7ee","hemiGround":"#7d7c5e","hemiIntensity":1.28,"envIntensity":0.7,"fillColor":"#b3c5ea","fillIntensity":0.52,"exposure":1,"foliage":[1.6,1.5,1.05]},
    evening: {"postExposure":1.12,"postBloom":0.18,"postGlare":1,"postWarmth":0.018,"postToe":1,"postShade":0.15,"fogDensity":0.0001,"mist":{"density":0.00005,"base":-4,"falloff":0.045}},
  };
  for(const time of ['morning','noon','golden','evening']) assert.deepEqual(KAMAKURA_TIMES[time],previous[time]);
  const vertex = "varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }";
  const fragment = "\n      varying vec3 vDir; uniform vec3 sunDir, sunColor, zenith, mid, horizon, below, fogColor; uniform float uTime;\n      \n    const vec3 HAZE_COOL = vec3(0.3968, 0.5029, 0.6724); const vec3 HAZE_WARM = vec3(0.9047, 0.6240, 0.3050);\n    const vec2 SUN_XZ = vec2(-0.8009, 0.4705);\n    const vec3 SUN_DIR3 = vec3(-0.8009, 0.3704, 0.4705);\n    vec3 hazeColor(vec3 dir) {                                  // 空の地平線：太陽側の半分が暖色（従来どおり）\n      float s = dot(normalize(dir.xz + 1e-5), normalize(SUN_XZ)) * 0.5 + 0.5;\n      return mix(HAZE_COOL, HAZE_WARM, pow(max(s, 0.0), 7.000));\n    }\n    // 地形・木・山並みにかかる霧：暖色は太陽の周り（高さも含めた角度で約25°以内）に絞り、ほかは灰紫〜青灰（奥ほど冷たい）。\n    // 向いた方角だけで色が決まると、太陽側の遠景が全部琥珀色になり奥行きが消えた（第2周の評価）。\n    vec3 fogHazeColor(vec3 dir) {\n      float s = dot(normalize(dir), SUN_DIR3);\n      return mix(HAZE_COOL, HAZE_WARM, clamp(smoothstep(0.93, 0.998, s) * 0.55, 0.0, 0.6));\n    }\n      float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }\n      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);\n        return mix(mix(hash(i), hash(i+vec2(1.,0.)), f.x), mix(hash(i+vec2(0.,1.)), hash(i+vec2(1.)), f.x), f.y); }\n      float fbm(vec2 p){ return noise(p)*0.5 + noise(p*2.07+3.1)*0.28 + noise(p*4.3-7.7)*0.16 + noise(p*8.9+1.9)*0.06; }\n      void main(){\n        vec3 d = normalize(vDir);\n        float h = d.y;\n        // 地平線の暖色→中間の青灰→天頂\n        vec3 hz = hazeColor(d);\n        vec3 col = mix(hz, mid, smoothstep(0.0, 0.22, h));\n        col = mix(col, zenith, smoothstep(0.12, 0.85, h));\n        col = mix(col, mix(hz, below, 0.5), (1.0 - smoothstep(-0.18, 0.0, h)));\n        float sd = max(dot(d, normalize(sunDir)), 0.0);\n        // 太陽のまわり（暖色の散乱）と円盤\n        col += sunColor * (pow(sd, 5.0) * 0.20 + pow(sd, 40.0) * 0.55);\n        col += sunColor * 22.0 * smoothstep(0.99965, 0.9999, sd);\n        // 薄い雲（高い層）。太陽側は縁が明るい\n        vec2 cp = d.xz / (max(h, 0.0) + 0.18) * 2.2 + vec2(uTime * 0.0035, 0.0);\n        float c = fbm(cp * 1.15);\n        float cover = smoothstep(0.50, 0.78, c) * smoothstep(0.02, 0.2, h) * (1.0 - smoothstep(0.7, 1.0, h));\n        vec3 cloudCol = mix(vec3(0.78, 0.74, 0.74), sunColor * 1.15, pow(sd, 1.6) * 0.85 + 0.15);\n        col = mix(col, cloudCol, cover * 0.55);\n        // 地平線は霧の色へなじませる（地形の遠景との継ぎ目を消す）\n        col = mix(col, hz, (1.0 - smoothstep(0.0, 0.09, abs(h))) * 0.7);\n        col += (hash(gl_FragCoord.xy) - 0.5) / 255.0;\n        gl_FragColor = vec4(col, 1.0);\n      }";
  const a={...kamakuraAtmosphere('golden',base()),sunDir:new THREE.Vector3(...KAMAKURA_TIMES.golden.sunDir)};
  const now=skyMaterial(a,{value:0});assert.equal(now.fragmentShader,fragment);assert.equal(now.vertexShader,vertex);now.dispose();
});

test('dusk reuses evening insects, fireflies, bells and grading while golden behavior is separate', () => {
  const h={forest:.3,meadow:.5,river:.7,paddy:.3,town:.6,temple:.4};
  assert.deepEqual(driftAmounts(h,'dusk'),driftAmounts(h,'evening'));
  assert.deepEqual(faunaAmounts(h,'dusk'),faunaAmounts(h,'evening'));
  assert.deepEqual(voiceLikelihood(h,'dusk',30),voiceLikelihood(h,'evening',30));
  assert.equal(voiceInterval('kane',1,'dusk',()=>.5),voiceInterval('kane',1,'evening',()=>.5));
  assert(shadeSettings('?time=dusk').floor>shadeSettings('?time=evening').floor);assert(shadeSettings('?time=dusk').strength>shadeSettings('?time=evening').strength);assert.deepEqual(shadeSettings('?time=dusk&duskair=0'),shadeSettings('?time=evening'));assert.equal(bloomCap('?time=dusk'),bloomCap('?time=evening'));
  assert(driftAmounts(h,'dusk').firefly>0);assert.equal(driftAmounts(h,'golden').firefly,0);
});

test('disc metadata accepts only finite 0.5–10 degrees; URL overrides including zero and never changes shadows', () => {
  for(const disc_deg of [.5,2,10]) {const f=fixture();f.meta.sun={disc_deg};assert.equal(validateMeta(f.meta),f.meta);assert.equal(sunPlace(f.meta).disc,disc_deg);}
  for(const disc_deg of [0,.49,10.01,-1,'2',null,NaN,Infinity]) {const f=fixture();f.meta.sun={disc_deg};assert.throws(()=>validateMeta(f.meta));}
  const meta={sun:{disc_deg:2,turn_deg:35,lift_deg:12}},place=sunPlace(meta,'?sundisc=1&sunturn=-10');
  assert.deepEqual(place,{turn:-10,lift:12,disc:1});assert.equal(sunPlace(meta,'?sundisc=0').disc,0);
  for(const query of ['?sundisc=','?sundisc=bad','?sundisc=.1','?sundisc=11'])assert.equal(sunPlace(meta,query).disc,2);
  const shadow=kamakuraAtmosphere('dusk',base(),true,1,place).sunDir;
  assert.deepEqual(shadow,kamakuraAtmosphere('dusk',base(),true,1,{...place,disc:9}).sunDir);
  const visible=visualSun('dusk',shadow,place);near(elevation(visible.dir),1);near(bearing(visible.dir),bearing(shadow));
  assert(!visualSun('dusk',shadow,{disc:0}).enabled);assert.equal(visualSun('golden',shadow),null);
  near(elevation(visualSun('dusk',shadow).dir),elevation(shadow));
});

function shaderCheck(shader) {
  const s=shader.replace(/\/\/[^\n]*/g,''),stack=[];
  for(const c of s){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
  assert(!/--\s*\d|\b(?:float|vec[234])\s+(?:input|output|sample|patch|filter|common|active)\b/.test(s));
  // All added identifiers have declarations; all numeric shader exponents are floats.
  const names=new Set([...s.matchAll(/\b(?:float|vec[234])\s+((?:disc|uDisc)\w+)/g)].map(m=>m[1]));
  for(const m of s.matchAll(/\b(?:disc|uDisc)\w+/g))assert(names.has(m[0]),m[0]);
  assert(!/pow\([^;]*,\s*\d+\s*\)/.test(s));
}

test('visible sun shader has angular diameter in range, separated halo, valid anchors and declared GLSL', () => {
  const a=kamakuraAtmosphere('dusk',base());a.sunDir=new THREE.Vector3(...a.sunDir);
  const m=kamakuraSkyMaterial(a,{value:0},visualSun('dusk',a.sunDir.toArray(),{disc:1}),true,true);
  const pixels=941*Math.tan(SUN_DISC.diameterDeg*Math.PI/360)/Math.tan(50*Math.PI/360);
  assert(pixels>=14&&pixels<=22);assert(SUN_DISC.haloRadius>=5&&SUN_DISC.haloRadius<=14);
  assert(m.fragmentShader.includes('float sd = max(dot(d, normalize(sunDir)), 0.0)'),'cloud illumination keeps the shadow-light direction');
  assert(!m.fragmentShader.includes('smoothstep(0.99965'));assert(m.fragmentShader.includes('mix(mid, horizon,'));
  assert(m.fragmentShader.indexOf('float discCore')>m.fragmentShader.indexOf('col = mix(col, hz'));
  shaderCheck(m.fragmentShader);m.dispose();
});

test('sea sun follows the visible azimuth at every depth, has one draw and no preparation work, adapts and disposes', () => {
  const actual=new THREE.Vector3(...kamakuraAtmosphere('dusk',base()).sunDir);
  for(const quality of ['standard','light'])for(const discHeight of [0,.5,2,10]) {
    const disc=visualSun('dusk',actual.toArray(),{disc:discHeight}),v=buildKamakuraSea(seaTerrain(),seaData(),{quality,search:'?time=dusk&debug=1&sundebug=1&bankwet=0',sunDir:actual,disc}),s=compile(v);
    shaderCheck(s.fragmentShader);assert(s.fragmentShader.includes('float discPath'));assert(s.fragmentShader.includes('uniform float uDiscPath; uniform float uDiscPathDebug'));
    near(s.uniforms.SUN_DIR_W.value.y,disc.dir[1]);assert.equal(v.mesh.geometry.index.count/3,2);
    for(const step of [0,1,2,3]) {v.setAdapt(step);assert.equal(s.uniforms.uDiscPath.value,discHeight===0?0:quality==='light'||step>=2?SUN_DISC.seaReduced:1);assert.equal(s.uniforms.uDiscPathDetail.value,quality==='light'||step>=2?0:1);}
    const stats=globalThis.__kzSunPath();assert.equal(stats.draws,1);assert.equal(stats.addedDraws,0);assert.equal(stats.preparationWork,0);
    if(!discHeight){assert.equal(s.uniforms.uSeaSun.value.getHex(),0);assert.equal(s.uniforms.uSea4Glitter.value,0);}
    v.dispose();assert.equal(globalThis.__kzSunPath,undefined);
  }
  assert.equal(seaDiscPath(1,1),SUN_DISC.seaStrength);assert.equal(seaDiscPath(-1),0);assert(seaDiscPath(.8)<.001);
  for(const distance of [20,200,2000,20000]) {const dir=[actual.x*distance,actual.z*distance];near(seaDiscPath((dir[0]*actual.x+dir[1]*actual.z)/(Math.hypot(...dir)*Math.hypot(actual.x,actual.z))),SUN_DISC.seaStrength);}
  assert.match(source('kamakura-water-view.js'),/SUN_DIR_W = \{ value: visualDir.clone\(\).normalize\(\) \}/);
  assert.match(source('kamakura-post-view.js'),/direction.copy\(glareDir\)/);
});

test('free overlook is strict, cannot mix legacy fields, and keeps its exact position without named places', () => {
  const view={east:-120,north:40,height:55,bearing:150,pitch:18,fov:50};
  const pose=overlookPose([],overlookConfig(view));assert.deepEqual(pose.pos,{x:-120,y:55,z:-40});near(pose.yaw,-150*Math.PI/180);near(pose.pitch,18*Math.PI/180);
  assert.deepEqual(camOption('?cam=overlook',[],view),pose);
  const t={meta:{overlook:view,places:[]},heightAt:()=>100};assert.deepEqual(createFly('?fly=1&cam=overlook',t,{x:0,z:0}).pose.pos,pose.pos);
  for(const [name,[min,max]] of Object.entries(FREE_OVERLOOK_FIELDS)) {
    for(const value of [min,max])overlookConfig({...view,[name]:value});
    for(const value of [min-.1,max+.1,NaN,Infinity,'2',null])assert.throws(()=>overlookConfig({...view,[name]:value}));
    const incomplete={...view};delete incomplete[name];assert.throws(()=>overlookConfig(incomplete));
  }
  for(const bad of [{...view,back:100},{back:100,east:0},{...view,far:'shrine'}])assert.throws(()=>overlookConfig(bad));
  const f=fixture();f.meta.overlook=view;assert.equal(validateMeta(f.meta),f.meta);f.meta.overlook={...view,back:4};assert.throws(()=>validateMeta(f.meta));
});

test('map hall default is strict, URL can restore open mode, and actual hall geometry has no ruin layer', async () => {
  assert(buddhaHallMode(buddhaSearch({buddha:'hall'},'')));assert(!buddhaHallMode(buddhaSearch({buddha:'hall'},'?buddha=')));
  assert.equal(buddhaSearch({},'?x=2'),'?x=2');for(const buddha of ['open',null,2,{},[]]) {const f=fixture();f.meta.buddha=buddha;assert.throws(()=>validateMeta(f.meta));}
  const {buildKamakuraFacilities}=await loadFacilityView(), definitions=[['hall','hall',box(0,0,0,40,18,32)],['bronze','buddha',box(0,0,0,6,10,4)]];
  const kit=makeGlb(definitions.map(([name,,geometry])=>({name,parts:[{geometry}]})));
  const data={nodes:definitions.map(([node,part,g])=>({node,part,anchor_xz:[0,0],soft:false,rel_anchor:0,triangles:g.positions.length/9})),kit:kit.buffer.slice(kit.byteOffset,kit.byteOffset+kit.byteLength)};
  const terrain={heightAt:()=>4,bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100}};
  for(const [query,ruins] of [['?ftex=0',0],['?ftex=0&buddha=',1]]) {
    const field=await buildKamakuraFacilities(data,terrain,new THREE.Scene(),'standard',{search:buddhaSearch({buddha:'hall'},query)});
    assert.equal(field.ruinHalls.length,ruins);assert.equal(field.records[0].node.part,ruins?'platform':'hall');field.dispose();
  }
});

test('river highlights read the visible sun and zero removes even the older white glint branch', async () => {
  const {buildKamakuraWater}=await load('kamakura-water-view.js');
  const river={id:'synthetic',xy_m:[[0,0],[10,0]],width_m:[4,4],depth_m:[1,1],bed_m:[2,2],water_elev_m:[2.5,2.5]};
  const sunDir=new THREE.Vector3(...kamakuraAtmosphere('dusk',base()).sunDir);
  for(const height of [0,1,8])for(const legacy of ['', '&shore4=0']) {
    const disc=visualSun('dusk',sunDir.toArray(),{disc:height}),v=buildKamakuraWater(prepareRivers({rivers:[river]}),{sunDir,disc,search:'?time=dusk'+legacy});
    const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};v.material.onBeforeCompile(s);
    s.uniforms.SUN_DIR_W.value.toArray().forEach((n,i)=>near(n,disc.dir[i]));
    assert.equal(s.fragmentShader.includes('vec3(0.0) * glint'),height===0);v.dispose();
  }
});

import { CLOUDS2, CLOUDS2_GLSL, cloudLayerProfile, cloudCoverage, cloudWarmth, clouds2Enabled, DUSK_AIR, DUSK_LEGACY } from '../dist/valley/kamakura-atmosphere.js';
import { SEA_PATH, seaPathWidth, seaPathEnvelope } from '../dist/valley/kamakura-sea-far.js';
import { MIST_GLSL } from '../dist/valley/kamakura-mist.js';
import { shadeColor } from '../dist/valley/kamakura-post.js';
const {duskMistShader}=await load('kamakura-post-view.js');
test('low cloud altitude, 40–50% coverage, overlapping low masses, slow drift and warm sunward rims',t=>{
  assert(Object.isFrozen(CLOUDS2)&&Object.isFrozen(CLOUDS2.heightsDeg));
  let covered=0,total=0;
  for(let b=0;b<360;b+=2)for(let h=.3;h<9;h+=.05){total++;const mask=cloudCoverage(b,h);assert(mask>=0&&mask<=1);covered+=mask>.5;}
  assert(covered/total>=.4&&covered/total<=.5,covered/total);
  for(let b=0;b<360;b+=3){assert.equal(cloudCoverage(b,.29),0);assert.equal(cloudCoverage(b,9.01),0);near(cloudCoverage(b,2,60),cloudCoverage(b-CLOUDS2.driftDegS*60,2,0),1e-6);}
  // Thick masses can overlap: the previous fixed empty rows at 1.8/3.6 degrees no longer apply.
  let lowOverlap=0;
  for(let b=0;b<360;b++){
    const a=cloudLayerProfile(b,0,0),c=cloudLayerProfile(b,0,1);
    lowOverlap+=a.gate>.5&&c.gate>.5&&a.top>c.bottom;
  }
  assert(lowOverlap>0);t.diagnostic(JSON.stringify({coverage:covered/total,lowOverlapAzimuths:lowOverlap,samples:total}));
  const horizontalFov=2*Math.atan(Math.tan(50*Math.PI/360)*16/9)*180/Math.PI;
  assert(CLOUDS2.driftDegS*60/horizontalFov>=.01&&CLOUDS2.driftDegS*60/horizontalFov<=.02);
  assert.equal(cloudWarmth(0),1);assert.equal(cloudWarmth(90),0);assert(cloudWarmth(12)>cloudWarmth(24));
  near(cloudCoverage(0,2),cloudCoverage(360,2),1e-6);assert.equal(cloudCoverage(20,7.7,0,2),0);
});
test('clouds preserve legacy sky bytes when off and at daylight times; added shader identifiers and anchors are valid',()=>{
  for(const time of ['morning','noon','golden','evening','dusk']){
    const a=kamakuraAtmosphere(time,base());a.sunDir=new THREE.Vector3(...a.sunDir);
    const disc=visualSun(time,a.sunDir.toArray()),make=query=>kamakuraSkyMaterial(a,{value:0},disc,time==='dusk',false,clouds2Enabled(query,time)?{gain:1,debug:false}:null);
    const off=make('?time='+time+'&clouds2=0'),legacy=kamakuraSkyMaterial(a,{value:0},disc,time==='dusk');assert.equal(off.fragmentShader,legacy.fragmentShader);
    const on=make('?time='+time);if(['morning','noon','golden'].includes(time))assert.equal(on.fragmentShader,off.fragmentShader);
    else {assert(on.fragmentShader.includes('float cloudCoverage2'));assert.equal(on.uniforms.uCloudLayers.value,4);shaderCheck(on.fragmentShader);
      const declared=new Set([...on.fragmentShader.matchAll(/\b(?:float|vec[234])\s+((?:cloud|uCloud)\w+)/g)].map(m=>m[1]));
      for(const m of on.fragmentShader.matchAll(/\b(?:cloud|uCloud)\w+/g))assert(declared.has(m[0])||['cloudCoverage2','cloudNoise2'].includes(m[0]),m[0]);
    }
    for(const m of [off,legacy,on])m.dispose();
  }
});
test('each cloud layer has bounded thickness, multiple full gaps in 180 degrees, a protected horizon and a bumpy upper face',t=>{
  const measurements=[];
  for(let layer=0;layer<4;layer++){
    let minimum=Infinity,maximum=0,gaps=0,inGap=false,edgeVariation=0,previous=null;
    // Each layer gets a half-turn including several separate gaps, rather than a complete horizontal line.
    const start=layer===1?120:0;
    for(let b=start;b<=start+180;b+=.25){
      const p=cloudLayerProfile(b,0,layer),gap=p.gate===0;
      assert(p.thickness>=.25&&p.thickness<=1.9);minimum=Math.min(minimum,p.thickness);maximum=Math.max(maximum,p.thickness);
      assert(p.bottom>=.55&&p.top>p.bottom);assert(Math.abs(p.centre-CLOUDS2.heightsDeg[layer])<=.7);
      if(gap){if(!inGap)gaps++;for(let h=.55;h<9;h+=.13)assert.equal(layerGpu(b,h,0,layer,1,0),0);}
      inGap=gap;
      if(previous)edgeVariation+=Math.abs((p.top-previous.top)-(p.bottom-previous.bottom));previous=p;
    }
    assert(gaps>=2);assert(minimum<.3&&maximum>1.8);assert(edgeVariation>1);
    measurements.push({layer,start,gaps,minimum,maximum});
  }
  for(let b=0;b<360;b+=.5)for(const h of [-1,0,.3,.549,.55])assert.equal(cloudCoverage(b,h),0);
  t.diagnostic(JSON.stringify(measurements));
});

const smoothCloud=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
const layerBody=CLOUDS2_GLSL.slice(CLOUDS2_GLSL.indexOf('{',CLOUDS2_GLSL.indexOf('float cloudLayer2'))+1,CLOUDS2_GLSL.indexOf('}\nfloat cloudCoverage2')).replace(/float /g,'let ');
const layerEval=new Function('bearing','height','time','layer','centre','width','rimOnly','cloudNoise2','smoothstep','max','cos','sin','radians',layerBody);
const layerGpu=(bearing,height,time,layer,widthScale=1,rimOnly=0)=>layerEval(bearing,height,time,layer,CLOUDS2.heightsDeg[layer],CLOUDS2.widthsDeg[layer]*widthScale,rimOnly,shoreNoise,smoothCloud,Math.max,Math.cos,Math.sin,x=>x*Math.PI/180);
const coverBody=CLOUDS2_GLSL.slice(CLOUDS2_GLSL.indexOf('{',CLOUDS2_GLSL.indexOf('float cloudCoverage2'))+1,CLOUDS2_GLSL.lastIndexOf('}')).replace(/float /g,'let ');
const coverEval=new Function('bearing','height','time','cloudLayers','rimOnly','cloudLayer2','smoothstep',coverBody);
const cloudGpu=(b,h,t,l,r)=>coverEval(b,h,t,l,r,(b,h,t,i,c,w,r)=>layerEval(b,h,t,i,c,w,r,shoreNoise,smoothCloud,Math.max,Math.cos,Math.sin,x=>x*Math.PI/180),smoothCloud);

test('cloud scalar GLSL agrees with CPU at every tier and north seam; only lower sunward edges are warm',()=>{
  for(const layers of [1,2,4])for(const time of [0,60,320])for(let b=-10;b<370;b+=11)for(let h=.4;h<9.1;h+=.19)for(const rim of [0,1]){
    near(cloudCoverage(b,h,time,layers,rim),cloudGpu(b,h,time,layers,rim),1e-12);
    near(cloudCoverage(b,h,time,layers,rim),cloudCoverage(b+360,h,time,layers,rim),1e-10);
    near(cloudCoverage(-.00001,h,time,layers,rim),cloudCoverage(.00001,h,time,layers,rim),1e-4);
  }
  let lit=0;
  for(let layer=0;layer<4;layer++)for(let b=0;b<360;b++){
    const p=cloudLayerProfile(b,0,layer);if(p.gate<.9||p.top-p.bottom<.6)continue;
    const lower=layerGpu(b,p.bottom+.1,0,layer,1,1),upper=layerGpu(b,p.top-.05,0,layer,1,1);
    assert(lower>.5);assert.equal(upper,0);assert.equal(lower*cloudWarmth(41),0);assert(lower*cloudWarmth(0)>0);lit++;
  }
  assert(lit>0);assert.equal(cloudWarmth(40),0);
  const a=kamakuraAtmosphere('dusk',base());a.sunDir=new THREE.Vector3(...a.sunDir);
  const m=kamakuraSkyMaterial(a,{value:0},null,true,false,{gain:1,debug:true});
  assert(m.fragmentShader.includes('uCloudLayers,1.0)*'+CLOUDS2.rimGain.toFixed(8)));
  assert(m.fragmentShader.includes('col=mix(col,vec3(0.0,0.3,1.0),cloudMask*uClouds2)'));
  const warmExpression=m.fragmentShader.match(/float cloudWarm=([^;]+);/)[1];
  const warm=new Function('cloudSunward','smoothstep','radians','acos','clamp','return '+warmExpression);
  for(const angle of [0,12,24,39,40,41,90,180])near(cloudWarmth(angle),warm(Math.max(0,Math.cos(angle*Math.PI/180)),smoothCloud,x=>x*Math.PI/180,Math.acos,(x,a,b)=>Math.max(a,Math.min(b,x))),1e-8);
  m.dispose();
});

test('low-cloud shader compiles with real sky anchors and rejects missing names and mixed numeric types',t=>{
  const version=spawnSync('glslc',['--version'],{encoding:'utf8'});if(version.error?.code==='ENOENT')return t.skip('glslc unavailable');assert.equal(version.status,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cloud-glsl-'));
  const a=kamakuraAtmosphere('dusk',base());a.sunDir=new THREE.Vector3(...a.sunDir);
  const material=kamakuraSkyMaterial(a,{value:0},visualSun('dusk',a.sunDir.toArray()),true,false,{gain:1,debug:true});
  try{
    const compile=shader=>{
      const file=path.join(dir,'cloud.frag');fs.writeFileSync(file,'#version 310 es\nprecision highp float;\n#define varying in\nout vec4 skyOut;\n#define gl_FragColor skyOut\n'+shader);
      return spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',path.join(dir,'out.spv')],{encoding:'utf8'});
    };
    const shader=material.fragmentShader;shaderCheck(shader);const result=compile(shader);assert.equal(result.status,0,result.stderr);
    assert(!shader.includes('#include'));assert(!shader.includes('undefined'));
    assert.notEqual(compile(shader.replace('cloudAngle=radians(bearing-', 'cloudAngle=radians(missingBearing-')).status,0);
    assert.notEqual(compile(shader.replace('cloudCover=0.0','cloudCover=ivec2(1,2)')).status,0);
    t.diagnostic('1 sky fragment stage compiled; missing-name and numeric-type mutations rejected');
  }finally{material.dispose();fs.rmSync(dir,{recursive:true,force:true});}
});

test('sun path is narrow at horizon, widens downward, thins toward camera and cannot form a round lobe',()=>{
  near(seaPathWidth(0)/SUN_DISC.diameterDeg,1.25);assert(seaPathWidth(15)>seaPathWidth(5));
  assert(SEA_PATH.lengthDeg/seaPathWidth(0)>12);
  for(const height of [1.7,55]){
    let previous=Infinity;
    for(const depression of [0,1,3,7,12,20,24]){
      const amount=seaDiscPath(1,1,depression);assert(amount<=previous);previous=amount;
      const offset=seaPathWidth(depression)/2+.01;assert.equal(seaDiscPath(Math.cos(offset*Math.PI/180),1,depression),0);
      if(depression>0&&depression<20){const distance=height/Math.tan(depression*Math.PI/180);assert(distance>0);near(Math.atan2(height,distance)*180/Math.PI,depression);}
    }
  }
  assert.equal(seaDiscPath(1,0),0);assert.equal(seaPathEnvelope(24),0);assert.equal(seaDiscPath(-1,1,3),0);
  const dir=new THREE.Vector3(...kamakuraAtmosphere('dusk',base()).sunDir);
  for(const query of ['', '&sea2=0','&sea3=0','&glitter=0']){
    const v=buildKamakuraSea(seaTerrain(),seaData(),{search:'?time=dusk&bankwet=0'+query,sunDir:dir}),s=compile(v);
    assert.match(s.fragmentShader,/vec3 outgoingLight = totalDiffuse \+ totalEmissiveRadiance;/);
    assert(!s.fragmentShader.includes('if(uShore6<=0.0)outgoingLight+='));assert(s.fragmentShader.includes('float seaPath2'));shaderCheck(s.fragmentShader);v.dispose();
  }
  const old=buildKamakuraSea(seaTerrain(),seaData(),{search:'?time=dusk&sunpath2=0&bankwet=0',sunDir:dir}),s=compile(old);
  assert(!s.fragmentShader.includes('float seaPath2'));assert(s.fragmentShader.includes('totalDiffuse + totalSpecular'));old.dispose();
});
test('dusk mist and shadow floor change only at dusk and revert with the air flag',()=>{
  for(const time of ['morning','noon','golden','evening'])assert.equal(duskMistShader(MIST_GLSL,'?time='+time),MIST_GLSL);
  assert.equal(duskMistShader(MIST_GLSL,'?time=dusk&duskair=0'),MIST_GLSL);
  const mist=duskMistShader(MIST_GLSL,'?time=dusk');assert.notEqual(mist,MIST_GLSL);shaderCheck(mist);
  assert(mist.includes('smoothstep(35.000000,220.000000,distanceValue)'));
  const old=kamakuraAtmosphere('dusk',base(),true,1,undefined,{legacyDusk:true});assert.deepEqual(old.mist,DUSK_LEGACY.mist);assert.equal(old.postMist,.75);
  assert(DUSK.mist.base>old.mist.base&&DUSK.mist.falloff>old.mist.falloff);
  const shaded=shadeColor(0,0,0,shadeSettings('?time=dusk'),[0,0,0]);assert(shaded[2]>shaded[1]&&shaded[1]>shaded[0]);near(shaded[2],DUSK_AIR.shadeFloor);
});
