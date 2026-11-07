import test from 'node:test';
import assert from 'node:assert/strict';
import {bankWetAlpha,bankCrossingDistance,riverFoamCentre,riverFoamWidth,riverBankFoam,shoreWetBand,SHORE_GLSL} from '../dist/valley/kamakura-shore.js';
import {bankWaterlineRibbon,buildBankWet} from '../dist/valley/kamakura-bank-wet.js';
import {buildShoreProps} from '../dist/valley/kamakura-shore-props.js';
import {prepareRivers} from '../dist/valley/kamakura-rivers.js';
import {THREE,load} from './helpers/tree-modules.mjs';
const river={xy_m:[[0,0],[0,-16]],width_m:[8,8],water_elev_m:[1,1],enters_sea:false};
// Different bank slopes deliberately put one shoreline inside, the other outside the nominal margin.
const terrain={heightAt:x=>x<0?Math.abs(x)*.2:Math.abs(x)*.5};
const prepared=()=>prepareRivers({rivers:[river]});
function shader(material){const base=THREE.ShaderLib[material.isMeshStandardMaterial?'standard':'basic'];const s={uniforms:{},vertexShader:base.vertexShader,fragmentShader:base.fragmentShader};material.onBeforeCompile(s);return s;}
test('R2 wet land and water foam share actual crossings on unequal banks, not nominal ribbon edges',async t=>{
  const p=prepared(),r=bankWaterlineRibbon(p.ribbons[0],terrain);
  const radii=[];
  for(let i=0;i<r.positions.length;i+=3){const x=r.positions[i];radii.push(Math.abs(x));assert(Math.abs(terrain.heightAt(x)-1)<.00013);}
  assert(Math.min(...radii)<2.001&&Math.max(...radii)>4.999);
  for(const side of [-1,1])for(let d=0;d<=1.5;d+=.05){const cross=bankCrossingDistance(terrain,0,0,1,side,0,5.2);assert(Math.abs(cross-(side<0?5:2))<.00025);assert.equal(bankWetAlpha(d),bankWetAlpha(Math.abs(side*d)));}
  const {buildKamakuraWater}=await load('kamakura-water-view.js');const water=buildKamakuraWater(p,{terrain});
  for(let i=0;!water.preparedBanks&&i<1000;i++)water.update(0);assert(water.preparedBanks);
  const banks=water.group.children[0].geometry.attributes.waterBanks;
  for(let i=0;i<banks.count;i++){assert(Math.abs(banks.getX(i)-2)<.00025);assert(Math.abs(banks.getY(i)-5)<.00025);}
  const s=shader(water.material);assert(s.fragmentShader.includes('min(vWBanks.x+vWUv.x*vWHalf,vWBanks.y-vWUv.x*vWHalf)'));assert(s.fragmentShader.includes('riverBankFoam(bankD'));
  const wet=buildBankWet(THREE,p,terrain);assert(wet.group.children.length>0);const w=shader(wet.material);assert(w.fragmentShader.includes('float bankMottle=.5;'),'equal distance must give equal wet pigment/opacity, without axis mottle');
  water.dispose();wet.dispose();t.diagnostic(JSON.stringify({crossingRange:[Math.min(...radii),Math.max(...radii)],wetWidth:1.5}));
});
test('R2 river foam has long gaps, variable centre/width and pixel filtering without a row boundary',t=>{
  let gaps=0,visible=0;const centres=[],widths=[],row=[];
  for(let x=-80;x<80;x+=.25){const c=riverFoamCentre(x,4),w=riverFoamWidth(x,4),f=riverBankFoam(c,x,4,2);centres.push(c);widths.push(w);if(f<.01)gaps++;if(f>.1)visible++;
    assert(f>=0&&f<=1);assert.equal(riverBankFoam(c,x,4,2,2),0);row.push(riverBankFoam(c,x,4,2,.6));}
  assert(gaps>100&&visible>30);assert(Math.max(...centres)-Math.min(...centres)>.2);assert(Math.max(...widths)-Math.min(...widths)>.2);assert(new Set(row.map(v=>v.toFixed(3))).size>30);
  assert(SHORE_GLSL.includes('float gaps=smoothstep(.43,.65'));assert(SHORE_GLSL.includes('softWidth=sqrt(width*width+footprint*footprint)'));
  t.diagnostic(JSON.stringify({gaps,visible,centreRange:[Math.min(...centres),Math.max(...centres)],halfWidthRange:[Math.min(...widths),Math.max(...widths)]}));
});
test('R2 wet sand is saturated at the waterline and fades over 0.6–1.5m; river reflection and quality switches retain A/B',async()=>{
  for(const reach of [3.3,5,9]){assert.equal(shoreWetBand(0,reach),1);assert(shoreWetBand(.3,reach)>.45);assert.equal(shoreWetBand(1.5,reach),0);}
  const {buildKamakuraWater}=await load('kamakura-water-view.js');
  for(const search of ['', '?shore2=0']){const w=buildKamakuraWater(prepared(),{search,terrain}),s=shader(w.material);assert.equal(w.material.envMapIntensity,search?.95:1.65);assert(s.fragmentShader.includes('uShore2>.5?.45:.9'));
    for(const step of [0,2,3,0]){w.setAdapt(step);assert.equal(w.uniforms.uRiverBands.value,step===3?0:step===2?1:2);}
    w.dispose();w.dispose();}
});
test('R2 water cross-sections prepare in bounded updates, publish once, and dispose during preparation safely',async()=>{
  const {buildKamakuraWater}=await load('kamakura-water-view.js');let calls=0;
  const t={heightAt(x){calls++;return terrain.heightAt(x);}},p=prepared(),w=buildKamakuraWater(p,{terrain:t});
  const g=w.group.children[0].geometry,a=g.attributes.waterBanks,buffer=a.array;
  assert.equal(calls,g.attributes.position.count/2,'construction samples the bed only; no synchronous bank search');assert(!w.preparedBanks);
  w.setAdapt(3);const paused=calls;w.update(0);assert.equal(calls,paused);assert(!w.preparedBanks);w.setAdapt(0);
  let frames=0;while(!w.preparedBanks&&frames++<1000)w.update(0);assert(w.preparedBanks);assert.equal(a.version,1);
  const count=calls;for(let i=0;i<1000;i++)w.update(i/60);assert.equal(calls,count);assert.equal(a.array,buffer);
  let disposed=0;g.addEventListener('dispose',()=>disposed++);w.dispose();w.update(2);w.dispose();assert.equal(disposed,1);
  const cancel=buildKamakuraWater(p,{terrain:t});cancel.dispose();const before=calls;cancel.update(2);assert.equal(calls,before);
});
test('R2 private river preparation and steady updates (aggregate only)',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有データは同梱しない'},async t=>{
  const {readPrivateData}=await import('../tools/lib/kamakura-validation.mjs'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js'),{decodeRivers}=await import('../dist/valley/kamakura-rivers.js'),fs=await import('node:fs/promises'),path=await import('node:path');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),terrain=createKamakuraTerrain(data),p=prepareRivers(decodeRivers(JSON.parse(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'rivers.json'),'utf8'))),terrain.vscale);
  const {buildKamakuraWater}=await load('kamakura-water-view.js'),start=performance.now(),w=buildKamakuraWater(p,{terrain});const constructionMs=performance.now()-start;
  let frames=0,maxPreparationMs=0;while(!w.preparedBanks&&frames++<10000){const tick=performance.now();w.update(frames/60);maxPreparationMs=Math.max(maxPreparationMs,performance.now()-tick);}assert(w.preparedBanks);
  for(const m of w.group.children)assert(m.geometry.attributes.waterBanks.array.every(v=>Number.isFinite(v)&&v>0));
  const tick=performance.now();for(let i=0;i<10000;i++)w.update(i/60);const steadyMs=(performance.now()-tick)/10000;
  t.diagnostic(JSON.stringify({constructionMs,frames,maxPreparationMs,steadyMs}));w.dispose();
});

test('R2 river stones and clumps are readable in metres, deterministic, capped and adapt away',()=>{
  const t={heightAt:()=>0,slopeAt:()=>0,isSea:()=>false,riverDistanceAt:(x,z)=>Math.abs(z),seaDistanceAt:()=>100};
  const props=buildShoreProps(THREE,t,{},'standard',{shore2:true}),matrix=new THREE.Matrix4(),scale=new THREE.Vector3();
  for(let i=0;i<20;i++)props.update({x:0,z:0});assert(props.meshes[0].count>5&&props.meshes[1].count>2);assert(props.count<=60);
  for(let type=0;type<2;type++)for(let i=0;i<props.meshes[type].count;i++){props.meshes[type].getMatrixAt(i,matrix);scale.setFromMatrixScale(matrix);assert(scale.x>=(type===0?.179:.419));assert(scale.x<=(type===0?.411:.721));}
  const buffers=props.meshes.map(m=>m.instanceMatrix);for(let i=0;i<100;i++)props.update({x:0,z:0});for(let i=0;i<4;i++)assert.equal(props.meshes[i].instanceMatrix,buffers[i]);
  for(const step of [2,3,0]){props.setAdapt(step);assert.equal(props.group.visible,step<2);}props.dispose();props.dispose();
});
