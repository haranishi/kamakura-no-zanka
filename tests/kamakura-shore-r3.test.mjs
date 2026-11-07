import test from 'node:test';
import assert from 'node:assert/strict';
import * as r3 from '../dist/valley/kamakura-shore-r3.js';
import {shoreNoise,SHORE_GLSL} from '../dist/valley/kamakura-shore.js';
import {prepareRivers} from '../dist/valley/kamakura-rivers.js';
import {installGroundDetail} from '../dist/valley/kamakura-ground-detail.js';
import {THREE,load} from './helpers/tree-modules.mjs';
const cv=a=>{const m=a.reduce((s,v)=>s+v,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length)/m;};
function distribution(api){
  const widths=[],lengths=[],banks=[[],[]];
  for(let side=0;side<2;side++){
    let run=0;
    for(let z=-500;z<500;z+=.1){
      const x=side?4:-3,coarse=shoreNoise(x/8.3+17,z/8.3+3),fine=shoreNoise(x/1.7+4,z/1.7+29);
      const width=api.foamWidth3(coarse,fine,side*.6,side*.3);widths.push(width);banks[side].push(width);
      const gaps=api.foamGaps3(shoreNoise(x/13.7+9,z/13.7+9),shoreNoise(x/2.1+23,z/2.1+23));
      if(gaps>.12)run+=.1;else if(run){lengths.push(run);run=0;}
    }
  }
  assert(cv(widths)>=.3);assert(cv(lengths)>=.3);assert(lengths.length>10);
  assert(banks[0].some((v,i)=>Math.abs(v-banks[1][i])>.15),'unequal banks must not mirror their foam widths');
  return {widthCV:cv(widths),fragmentLengthCV:cv(lengths),widthRange:[Math.min(...widths),Math.max(...widths)],fragmentLengthRange:[Math.min(...lengths),Math.max(...lengths)]};
}
test('R3 foam widths and fragment lengths vary; constant-width/dash mutations fail the same checks',async t=>{
  t.diagnostic(JSON.stringify(distribution(r3)));
  assert.throws(()=>distribution({...r3,foamWidth3:()=>.3}));
  assert.throws(()=>distribution({...r3,foamGaps3:()=>1}));
  assert(r3.FOAM_LINEAR_MAX<=new THREE.Color().setRGB(.85,.85,.85,THREE.SRGBColorSpace).r);
  assert(r3.FOAM_LINEAR_MAX>new THREE.Color().setRGB(.8,.8,.8,THREE.SRGBColorSpace).r);
});
test('R3 shallow sand remains transparent; deep tone is blue-green and continuously more opaque',()=>{
  const color=new Float64Array(3);assert.equal(r3.riverWaterTone(0,0,color),.32);assert(color[0]>color[2]);
  let alpha=0;
  for(let d=0;d<=8;d+=.01){const a=r3.riverWaterTone(d,d,color);assert(a>=alpha&&a<=.85);alpha=a;assert(color.every(v=>v>=0&&v<1));}
  r3.riverWaterTone(8,2,color);assert(color[1]>color[0]*4&&color[2]>color[1]);
  assert.equal(r3.riverWaterTone(0,2,color),.32,'even a deep channel stays translucent at its bank');
});
function wetCheck(width){for(const px of [.001,.01,.05,.1,.3,.5,1,2,4,5]){assert(width(9,px)/2/px>=10);assert(width(9,px)<=120);}}
test('R3 wet half-strength width spans >=10 pixels, with real 1.5–4m near bands; narrowing mutation fails',async()=>{
  wetCheck(r3.surfWetWidth);assert.throws(()=>wetCheck(()=>1.5));
  assert.equal(r3.surfWetWidth(0),1.5);assert.equal(r3.surfWetWidth(9),4);
  for(const n of [0,.5,1])assert(r3.surfFrontWidth(n)>=.3&&r3.surfFrontWidth(n)<=1);
  // Execute the actual scalar GLSL width algebra, so a shader-only regression fails.
  const body=r3.SHORE_R3_GLSL.match(/float surfWetWidth3\(float reach,float footprint\)\{return ([^;]+);/)[1];
  const width=Function('reach','footprint','max','min','clamp',`return ${body};`);
  const evaluate=(reach,px)=>width(reach,px,Math.max,Math.min,(v,a,b)=>Math.max(a,Math.min(b,v)));
  wetCheck(evaluate);for(const px of [0,.1,1,5])assert.equal(evaluate(9,px),r3.surfWetWidth(9,px));
  for(const height of [720,844])for(const fov of [54,65,72])for(const distance of [25,27,50,75,100]){
    const focal=height/(2*Math.tan(fov*Math.PI/360)),eye=1.7;
    const footprint=distance*distance/(focal*eye),near=Math.max(distance*.1,distance-r3.surfWetWidth(9,footprint)/2);
    const projected=focal*eye*(1/near-1/distance);
    assert(projected>=10,`wet half-strength projection ${projected} pixels`);
  }
  assert(SHORE_GLSL.includes('shoreNoise(gl_FragCoord.xy/37.0)'),'wet distant edge must not be a uniform screen row');
});
function shader(m){const b=THREE.ShaderLib[m.isMeshStandardMaterial?'standard':'lambert'],s={uniforms:{},vertexShader:b.vertexShader,fragmentShader:b.fragmentShader};m.onBeforeCompile(s);return s;}
const terrain=()=>({bounds:{minX:-64,maxX:64,minZ:-64,maxZ:64},heightAt:(x,z)=>z*.1,isSea:(x,z)=>z<=0,riverDistanceAt:()=>Infinity,seaDistanceAt:(x,z)=>Math.max(0,z)});
const data=()=>({meta:{grid:{width:33,height:33,cell_m:4},surface:{}},surface:new Uint8Array(33*33)});
test('R3 first draw has signed wet/surf preview; final texture is distinct and shared; quality and disposal round trip',async()=>{
  const {buildKamakuraSea}=await load('kamakura-sea-view.js');
  for(const search of ['', '?shore3=0','?shore2=0'])for(const quality of ['standard','light']){
    const t=terrain(),d=data(),v=buildKamakuraSea(t,d,{search,quality}),initial=v.uniforms.uShoreSea.value;
    const resources=new Map(),track=x=>{if(resources.has(x))return;resources.set(x,0);x.addEventListener('dispose',()=>resources.set(x,resources.get(x)+1));};
    for(const r of [v.mesh.geometry,v.mesh.material,...v.textures])track(r);
    if(!search){assert.equal(v.uniforms.uShoreReady.value,1);assert(initial.image.width>1);assert(initial.image.data.some(n=>(n&0x8000)!==0),'preview contains land as well as water');assert(initial.image.data.some(n=>n>0&&n<0x8000));}
    else assert.equal(v.uniforms.uShoreReady.value,0);
    const m=new THREE.MeshLambertMaterial(),g=installGroundDetail(THREE,m,d),s=shader(m);
    assert.equal(s.uniforms.uShore3,v.uniforms.uShore3);assert(s.fragmentShader.includes('surfWetWidth3'));
    let iterations=0;while(!v.preparedShore){v.update(1/60,{x:0,z:0});assert(++iterations<1000000);}
    assert.notEqual(v.uniforms.uShoreSea.value,initial);assert.equal(v.uniforms.uShoreSea.value,v.uniforms.uShoreLand.value);
    for(const r of v.textures)track(r);
    for(const step of [0,2,3,0]){v.setAdapt(step);assert.equal(v.uniforms.uShore3.value,!search&&step<3?1:0);}
    const final=v.uniforms.uShoreSea.value;for(let i=0;i<100;i++)v.update(1/60,{x:0,z:0});assert.equal(v.uniforms.uShoreSea.value,final);
    const sea=shader(v.mesh.material).fragmentShader;assert(sea.includes('shoreSurf3(landDistance'));assert(sea.includes('seaFoam>.04)gl_FragColor.rgb=min(gl_FragColor.rgb,vec3(.85))'));
    g.dispose();m.dispose();v.dispose();v.dispose();assert([...resources.values()].every(n=>n===1));assert(!t.shoreSigned);
  }
});
test('R3 river shader keeps R1 reflection strength, caps display foam and retains R2 geometry/quality paths',async()=>{
  const {buildKamakuraWater}=await load('kamakura-water-view.js');
  const p=prepareRivers({rivers:[{xy_m:[[0,0],[0,-8]],width_m:[4,4],water_elev_m:[1,1],enters_sea:false}]});
  for(const search of ['', '?shore3=0','?shore2=0']){
    const w=buildKamakuraWater(p,{terrain:terrain(),search}),s=shader(w.material).fragmentShader;
    assert.equal(w.material.envMapIntensity,search==='?shore3=0'?1.65:.95);assert.equal(w.uniforms.uShore3.value,search?0:1);
    assert(s.includes('riverBankFoam3(bankD'));assert(s.includes('vWFoamShape.y:vWFoamShape.z'));assert(s.includes('*(uRiverBands>1.5?1.0:.55)'));assert(s.includes('mix(vec3(.16,.21,.13),vec3(.025,.145,.20),tone3)'));assert(s.includes('foam>.04)gl_FragColor.rgb=min(gl_FragColor.rgb,vec3(.85))'));
    for(const step of [2,3,0]){w.setAdapt(step);assert.equal(w.uniforms.uShore3.value,!search&&step<3?1:0);}
    w.dispose();w.dispose();
  }
});

test('R3 foam shape stores the real bend and independently prepared unequal bank slopes',async()=>{
  const {buildKamakuraWater}=await load('kamakura-water-view.js');
  const p=prepareRivers({rivers:[{xy_m:[[0,0],[0,-8],[2,-16]],width_m:[8,8,8],water_elev_m:[1,1,1],enters_sea:false}]});
  const t={heightAt:x=>Math.abs(x)*(x<0?.2:.5)},w=buildKamakuraWater(p,{terrain:t});
  let n=0;while(!w.preparedBanks){w.update(0);assert(++n<1000000);}
  const shapes=w.group.children[0].geometry.attributes.waterFoamShape;
  assert(shapes.array.some((v,i)=>i%3===0&&v>.05));
  assert(Math.abs(shapes.getY(0)-.5)<1e-5);assert(Math.abs(shapes.getZ(0)-.2)<1e-5);
  const buffer=shapes.array;for(let i=0;i<100;i++)w.update(i);assert.equal(shapes.array,buffer);assert.equal(shapes.version,1);w.dispose();
});
