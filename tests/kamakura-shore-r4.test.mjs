import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE,load,source } from './helpers/tree-modules.mjs';
import { prepareRivers, riverRibbon } from '../dist/valley/kamakura-rivers.js';
import { shore4Enabled,riverFlow,flowVelocity,riverHeight4,riverFoamGain4,waterAlpha4,waterFresnel4,riverColor4,seaColor4,seaBand4,SHORE_R4_GLSL } from '../dist/valley/kamakura-shore-r4.js';
import { shoreNoise } from '../dist/valley/kamakura-shore.js';
import { createFxState } from '../dist/valley/kamakura-fx.js';
import { prepareFishRivers } from '../dist/valley/kamakura-fish.js';
import { kamakuraAtmosphere } from '../dist/valley/kamakura-atmosphere.js';
import { photoBlendUniform,photoSampler } from '../dist/valley/kamakura-photo-tex.js';
const river={id:'synthetic',xy_m:[[0,0],[20,0],[20,-20]],width_m:[4,4,4],water_elev_m:[2,1.5,1],bed_m:[1.5,1,.5],enters_sea:false};
const terrain={bounds:{minX:-32,maxX:32,minZ:-32,maxZ:32},heightAt:(x,z)=>2-(x+z)*.025,isSea:(x,z)=>z>0,riverDistanceAt:()=>Infinity,waterAt:()=>.2,seaDistanceAt:()=>0};
const prepared=()=>prepareRivers({rivers:[river]});
function shader(m){const s={uniforms:{},vertexShader:THREE.ShaderLib[m.isMeshBasicMaterial?'basic':'standard'].vertexShader,fragmentShader:THREE.ShaderLib[m.isMeshBasicMaterial?'basic':'standard'].fragmentShader};m.onBeforeCompile(s);return s;}
function balanced(s){
  const clean=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean)if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);assert.equal(stack.length,0);
  let n=0;for(const l of clean.split('\n')){if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(l))n++;else if(/^\s*#\s*endif\b/.test(l))assert(n-->0);}assert.equal(n,0);
  assert(!/\b(?:float|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(clean));
}
test('S1 endpoint heights determine downstream on both ribbon orientations, including chunks',()=>{
  for(const flip of [1,-1]){
    const r=riverRibbon(river),t={heightAt:(x,z)=>flip*terrain.heightAt(x,z)},f=riverFlow(r,t);assert.equal(f.sign,flip);
    for(const [tx,tz] of [[1,0],[0,1]]){const v=flowVelocity(tx,tz,f);assert(v[0]*tx+v[1]*tz===flip*f.speed);assert.equal(v[0]*tz-v[1]*tx,0);}
    assert(Math.abs(flowVelocity(1,0,f,1)[0])<Math.abs(flowVelocity(1,0,f,0)[0]));
    assert(riverFlow(r,{heightAt:()=>0}).speed<f.speed);
  }
  assert(prepared().chunks.every(c=>c.riverId===river.id));
});
test('S1/S2/S5 CPU references execute the actual GLSL arithmetic',()=>{
  const fn=name=>SHORE_R4_GLSL.match(new RegExp('(?:float|vec3) '+name+'\\([^)]*\\)\\{([^}]+)\\}'))[1].replace(/float /g,'let ');
  const height=Function('p','time','speed','edge','uShore4Detail','shoreNoise','vec2',fn('riverHeight4'));
  const alpha=Function('depth','bank','cosine','max','min','abs','exp','waterFresnel4',fn('waterAlpha4'));
  const band=Function('d','edge','footprint','max','smoothstep',fn('seaBand4'));
  for(let i=0;i<40;i++){
    const x=i*.37,y=i*.73,time=i*.13,speed=i%2?.4:-.4,edge=(i%3-1)*.8,detail=i%2;
    assert.equal(height({x,y},time,speed,edge,detail,v=>shoreNoise(...v),(a,b)=>[a,b]),riverHeight4(x,y,time,speed,edge,detail));
    assert.equal(alpha(x,y,.6,Math.max,Math.min,Math.abs,Math.exp,waterFresnel4),waterAlpha4(x,y,.6));
    const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
    assert.equal(band(x,5,.5,Math.max,smooth),seaBand4(x,5,.5));
  }
});
test('S1 actual noise reference has along correlation length at least 3x across and advects downstream',t=>{
  function correlation(axis,lag){let cross=0,power=0;for(let x=-20;x<20;x+=.37)for(let y=-24;y<24;y+=.73){const a=riverHeight4(x,y,0,.5)-.55,b=riverHeight4(x+(axis===0?lag:0),y+(axis===1?lag:0),0,.5)-.55;cross+=a*b;power+=a*a;}return cross/power;}
  const length=axis=>{for(let lag=.05;lag<10;lag+=.05)if(correlation(axis,lag)<.5)return lag;throw Error('no decorrelation');};
  const across=length(0),along=length(1);assert(along/across>=3);t.diagnostic(JSON.stringify({acrossCorrelationM:across,alongCorrelationM:along,ratio:along/across}));
  for(const speed of [-.4,.4])for(const edge of [-1,0,1])assert(Math.abs(riverHeight4(2,7+speed*2*(1-.6*edge*edge),2,speed,edge)-riverHeight4(2,7,0,speed,edge))<1e-12);
});
test('S2 Beer absorption is transparent at zero, monotone with depth and bank distance; sky changes pigment',()=>{
  for(const cosine of [.1,.5,1]){assert.equal(waterAlpha4(0,10,cosine),0);let prev=0;for(let d=0;d<5;d+=.01){const a=waterAlpha4(d,10,cosine);assert(a>=prev&&a<=1);prev=a;}}
  assert(Math.abs(waterAlpha4(.6,10,1)-.5)<.003);assert(waterAlpha4(.3,10,.2)>waterAlpha4(.3,10,1));assert(waterFresnel4(0)>waterFresnel4(1));
  const a=riverColor4(.6,[.4,.5,.6],[.7,.8,.9]),b=riverColor4(.6,[.5,.3,.2],[.9,.5,.3]);assert(a.some((v,i)=>v!==b[i]));
  const deep=riverColor4(20,[1,1,1],[1,1,1]);assert(Math.abs(deep[0]-.02)<1e-6&&Math.abs(deep[2]-.12)<1e-6);
});
test('S5 depth transitions are monotone, pixel width stays positive; horizon converges',()=>{
  for(const edge of [5,20,60,200])for(const pixel of [0,.1,1,5]){let prev=0;for(let d=0;d<=400;d+=.5){const v=seaBand4(d,edge,pixel);assert(v>=prev);prev=v;}assert(seaBand4(edge+Math.max(edge*.35,pixel*2),edge,pixel)>seaBand4(edge,edge,pixel));}
  assert.deepEqual(seaColor4(1000,[.4,.5,.6],[.7,.8,.9]),[.7,.8,.9]);
});
test('S1–S5 bundled shaders balance, A/B and adaptive quality round trip; shared photos stay unowned',async()=>{
  const {buildKamakuraWater}=await load('kamakura-water-view.js'),{buildKamakuraSea}=await load('kamakura-sea-view.js');
  balanced(SHORE_R4_GLSL);
  for(const quality of ['standard','light'])for(const search of ['?time=noon','?time=evening','?shore4=0']){
    const w=buildKamakuraWater(prepared(),{terrain,quality,search});
    const data={meta:{grid:{width:17,height:17,cell_m:4},surface:{}},surface:new Uint8Array(289)};
    const sea=buildKamakuraSea({...terrain},data,{search,quality}),bank=sea.bank;
    const resources=[w.material,...w.group.children.map(m=>m.geometry),sea.mesh.geometry,sea.mesh.material,...sea.textures,bank.material];
    const counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));
    for(const step of [0,2,3,0]){
      w.setAdapt(step);sea.setAdapt(step);
      const value=shore4Enabled(search)&&step<3?(step===2?.45:1):0;assert.equal(w.uniforms.uShore4.value,value);assert.equal(sea.uniforms.uShore4.value,value);
      for(const view of [w.material,sea.mesh.material,bank.material]){const s=shader(view);balanced(s.vertexShader);balanced(s.fragmentShader);}
    }
    const flow=w.group.children[0].geometry.attributes.waterFlow;assert(Math.abs(flow.getX(0)-1)<1e-6);assert(Math.abs(flow.getY(0))<1e-6);assert(Math.abs(flow.getY(flow.count-1)-1)<1e-6);
    const s=shader(w.material);assert(s.fragmentShader.includes('vec2(vWUv.x*vWHalf,vWUv.y)'));assert(s.fragmentShader.includes('w_height(p)'));assert(s.fragmentShader.includes('uShore4>.0'));
    if(shore4Enabled(search)){
      const b=shader(bank.material);assert.equal(b.uniforms.uPhotoBlend,photoBlendUniform);assert.equal(b.uniforms.uBankSand,photoSampler('groundSandWet'));assert(b.fragmentShader.includes('kzPhotoHexGrad'));assert(b.fragmentShader.indexOf('wetDx=dFdx')<b.fragmentShader.indexOf('if(wetStrength'));
      assert.equal(w.uniforms.uWaterSkyHorizon.value.getHex(),sea.uniforms.uWaterSkyHorizon.value.getHex());assert(b.fragmentShader.includes('kzPerturbNormal(bankN4,vBankView4'));assert(b.vertexShader.includes('vBankN4=normalMatrix*normal'));assert(b.fragmentShader.includes('(.8+.2*max(0.0,dot(bankN4,bankLight4)))'));
    }else assert(bank.material.isMeshBasicMaterial);
    w.dispose();w.dispose();sea.dispose();sea.dispose();assert(counts.every(n=>n===1));
  }
});
test('S4 foot rings shrink, drift along local flow and retain untouched fish ripple defaults',()=>{
  const r={...river,xy_m:[[0,0],[20,0]],width_m:[4,4],water_elev_m:[1,1],bed_m:[.5,.5]},rivers=prepareFishRivers({rivers:[r]}),hero={pos:{x:5,y:.5,z:0},yaw:0,stepGait:'walk'};
  assert(riverFoamGain4(.5,2,0,1)>riverFoamGain4(.2,2,0,1));assert(riverFoamGain4(.5,2,0,1)>riverFoamGain4(.5,5,0,1));assert(riverFoamGain4(.2,3,.5,-1)>riverFoamGain4(.2,3,.5,1));
  const a=createFxState({terrain,rivers,shore4:true}),b=createFxState({terrain,rivers,shore4:false});a.contact({},hero);b.contact({},hero);a.update(.3);b.update(.3);
  const ar=a.ripples[0],br=b.ripples[0];assert(ar.radius<br.radius);assert(ar.x>br.x);assert.equal(ar.z,br.z);assert(ar.local);
  a.ripple(2,1,0,.12);assert(!a.ripples.find(r=>r.x===2).local);
  assert(source('kamakura-fx-view.js').includes('r.local?.82:rippleSecondary'));
});
test('S6 report linear model averages (not rendered frame measurements)',async t=>{
  for(const time of ['noon','evening']){
    // Evening base comes from the shipped atmosphere, loaded through bundled Three.
    const {LEGACY_ATMOS: ATMOS}=await load('atmosphere.js');const sky=kamakuraAtmosphere(time,{...ATMOS,sunDir:ATMOS.sunDir.toArray()});
      const mid=new THREE.Color(sky.mid).toArray(),horizon=new THREE.Color(sky.horizon).toArray(),riverMean=[0,0,0],seaMean=[0,0,0];let n=0;
      for(let i=0;i<100;i++){const r=riverColor4(i/99*1.2,mid,horizon),s=seaColor4(i/99*200,mid,horizon);for(let c=0;c<3;c++){riverMean[c]+=r[c]/100;seaMean[c]+=s[c]/100;}n++;}
      const saturation=c=>(Math.max(...c)-Math.min(...c))/Math.max(...c);t.diagnostic(JSON.stringify({time,riverMean,riverSaturation:saturation(riverMean),seaMean,seaSaturation:saturation(seaMean),samples:n}));
  }
});
