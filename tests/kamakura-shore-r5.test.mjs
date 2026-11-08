import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { riverFoam5, riverMacro5, riverStreak5, riverColor4, riverColor5, surfCore5, FOAM_LINEAR_MAX5, SHORE_R4_GLSL, waterAlpha4, waterFresnel4, waterOpacity5 } from '../dist/valley/kamakura-shore-r4.js';
import { createFxState } from '../dist/valley/kamakura-fx.js';
import { prepareFishRivers } from '../dist/valley/kamakura-fish.js';
import { prepareRivers } from '../dist/valley/kamakura-rivers.js';
const river={id:'test',xy_m:[[0,0],[96,0]],width_m:[5,5],water_elev_m:[1,1],bed_m:[.5,.5]};
const terrain={bounds:{minX:-32,maxX:128,minZ:-32,maxZ:32},heightAt:x=>.6-x*.002,waterAt:()=>.2,isSea:(x,z)=>z>16,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>0};
function compile(material){const s={uniforms:{},...THREE.ShaderLib[material.isMeshBasicMaterial?'basic':'standard']};material.onBeforeCompile(s);return s;}
function balanced(s){
  const clean=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean)if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);assert.equal(stack.length,0);
  let n=0;for(const line of clean.split('\n')){if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(line))n++;else if(/^\s*#\s*endif\b/.test(line))assert(n-->0);}assert.equal(n,0);
  assert(!/\b(?:float|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(clean));
}
test('S7 energetic shallow bends foam monotonically; slow straight banks are empty',()=>{
  assert.equal(riverFoam5(.1,.3,.12,0),0);
  assert(riverFoam5(.1,.5,.4,0)<.01);
  for(const field of [0,1,2,3]){let previous=field===0?Infinity:-Infinity;for(let i=0;i<=100;i++){
    const p=[.1,.5,.5,.3];p[field]=i/100;const value=riverFoam5(...p);
    assert(field===0?value<=previous:value>=previous);previous=value;
  }}
  assert(FOAM_LINEAR_MAX5<.69);
  // Execute the actual scalar shader body, so reference-only changes cannot pass.
  const body=SHORE_R4_GLSL.match(/float riverFoam5\([^)]*\)\{([^}]+)\}/)[1];
  const smoothstep=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
  const gpu=Function('depth','slope','speed','bend','smoothstep','abs',body);
  for(let i=0;i<80;i++){const p=[i/100,(i%13)/13,(i%7)/7,(i%11)/11];assert.equal(gpu(...p,smoothstep,Math.abs),riverFoam5(...p));}
});
test('S8 streak amplitude follows speed and centre; broad modulation correlates beyond 20m',t=>{
  for(const broad of [0,.3,1]){
    assert.equal(riverStreak5(0,0,broad),0);
    assert.equal(riverStreak5(.12,.4,broad),2*riverStreak5(.06,.4,broad));
    assert(riverStreak5(.3,1,broad)<riverStreak5(.3,0,broad));
  }
  function correlation(lag){let sum=0,power=0;for(let x=-1000;x<1000;x+=3.7)for(let z=-100;z<100;z+=13.1){const a=riverMacro5(x,z)-.5,b=riverMacro5(x+lag,z)-.5;sum+=a*b;power+=a*a;}return sum/power;}
  const c20=correlation(20);assert(c20>.5);assert(correlation(80)<c20);t.diagnostic(JSON.stringify({macroCorrelation20m:c20,calmCentreGain:riverStreak5(.12,0,.5)}));
  const luma=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
  for(const sky of [[.4,.5,.6],[.8,.4,.2]])for(const depth of [0,.1,.6,20]){
    const old=riverColor4(depth,sky,sky),now=riverColor5(depth,sky,sky);
    assert(Math.abs(luma(old)-luma(now))<1e-12);
    assert(Math.abs((Math.max(...now)-Math.min(...now))/(Math.max(...old)-Math.min(...old))-.75)<1e-12);
  }
});
test('S9 submerged standing/walking emit 2–3 fronts, bounded size and downstream drift, no sea rings',()=>{
  const rivers=prepareFishRivers({rivers:[river]}),hero={pos:{x:10,y:.5,z:0},yaw:0,stepGait:'walk'};
  for(const moving of [false,true]){
    const state=createFxState({terrain,rivers,shore4:true,particles:0});
    let measured=0;
    for(let i=0;i<600;i++){
      if(moving&&i%20===0)state.contact({foot:'L'},hero);
      state.update(1/60,hero);
      const live=state.ripples.filter(r=>r.local&&r.life>0);assert(live.length<=3);
      if(i>100){assert(live.length>=2);measured++;}
      for(const r of live){assert(r.radius>=.3&&r.radius*2*1.45<=1.6);assert(r.vx>0);assert(r.x>=hero.pos.x-.12);}
    }
    assert(measured>0);
    state.ripple(2,1,0,.12);const fish=state.ripples.find(r=>r.x===2);assert(!fish.local);state.update(.3);assert(fish.radius<.2);
    state.setLimits(0,0);state.update(.5,hero);assert(state.ripples.every(r=>r.life===0));
  }
  const sea=createFxState({terrain,rivers:{segments:[],sampleAt:()=>({valid:false})},shore4:true});sea.update(.5,hero);assert(sea.ripples.every(r=>r.life===0));
});
test('S10 absorption and Fresnel retain transparent top view and strong grazing reflection',()=>{
  assert(waterAlpha4(.3,2,1)<waterAlpha4(.8,2,1));assert(waterFresnel4(.1)>waterFresnel4(.8));assert.equal(waterAlpha4(0,2,1),0);assert.equal(waterOpacity5(0,2,1),0);assert(waterOpacity5(.3,2,.1)>waterOpacity5(.3,2,1));assert(waterOpacity5(.3,2,.1)>=waterAlpha4(.3,2,.1));
});
test('S11 foam core spans at least two pixels across distant footprints',()=>{
  for(const footprint of [.001,.1,.3,1,3,8])assert(surfCore5(footprint)*2/footprint>=2);
  assert(source('kamakura-sea-view.js').includes('waves.z,vSeaWorld.xz,11.5,shoreFootprint'));
});
test('S7–S11 bundled shaders, legacy expressions, neutral wet uniform and adaptation survive',async()=>{
  const {buildKamakuraWater}=await load('kamakura-water-view.js'),{buildKamakuraSea}=await load('kamakura-sea-view.js');
  balanced(SHORE_R4_GLSL);
  for(const quality of ['standard','light'])for(const search of ['', '?shore4=0']){
    const prepared=prepareRivers({rivers:[river]}),water=buildKamakuraWater(prepared,{terrain,quality,search});
    const data={meta:{grid:{width:17,height:17,cell_m:4},surface:{}},surface:new Uint8Array(289)};
    const sea=buildKamakuraSea({...terrain},data,{search,quality});
    for(const step of [0,2,3,0]){
      water.setAdapt(step);sea.setAdapt(step);
      const wet=search||step===3?0:step===2?.45:1;assert.equal(sea.uniforms.uShoreWet5.value,wet);
      for(const m of [water.material,sea.mesh.material,sea.bank.material]){const s=compile(m);balanced(s.vertexShader);balanced(s.fragmentShader);}
    }
    const s=compile(water.material).fragmentShader;
    assert(s.includes('if(uShore4<=0.0)diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.88)'));
    assert(s.includes('w_height(p)'));assert(s.includes('riverColor5(depth4),uShore4'));assert(s.includes('waterOpacity5(vWDepth,bankD,waterCosine),uShore4'));assert(s.includes('riverStreak5(vWFlow.z,vWUv.x,broad5)'));
    // Prepared collision/ribbon buffers remain untouched by visual changes.
    for(let i=0;i<prepared.chunks[0].positions.length;i++)assert.equal(water.group.children[0].geometry.attributes.position.array[i],Math.fround(prepared.chunks[0].positions[i]));
    if(search){assert.equal(water.uniforms.uShore4.value,0);assert.equal(sea.bank.material.color.getHex(),0x55574d);}
    water.dispose();sea.dispose();
  }
});
