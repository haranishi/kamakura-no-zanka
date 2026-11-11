import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SEA3 as S,SEA_FAR as C,SEA3_GLSL,SEA3_SCALAR_GLSL,sea3Enabled,sea3Gain,sea3Count,sea3Phase,sea3Shift,sea3WidthScale,sea3Density,sea3Texture,sea3Profile,sea3WashCentre,sea3WashProfile,sea3Centre,sea3Sample,sea3Color,sea3ColorGain} from '../dist/valley/kamakura-sea-far.js';
import {shoreNoise,SHORE_GLSL,SHORE_GRID,shoreFieldCell,createSignedShoreJob,shoreWetBand,surfFoam} from '../dist/valley/kamakura-shore.js';
import {previewTerrain,PREVIEW_SEA} from '../tools/preview-sea.mjs';
import {THREE,load,source} from './helpers/tree-modules.mjs';
const {buildKamakuraSea}=await load('kamakura-sea-view.js');
const finish=job=>{while(!job.step(4096));return job.field;};
const terrain=()=>({...previewTerrain('beach'),riverDistanceAt:()=>Infinity,seaDistanceAt:(_x,z)=>Math.max(0,-z)});
const data=()=>({rivers:[],meta:{grid:{width:301,height:151,cell_m:2},surface:{}},surface:new Uint8Array(301*151)});
const shader=v=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};v.mesh.material.onBeforeCompile(s);return s;};
const luma=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];

test('sea3 S1 asymmetric edge, bounded density/width/shift, moving fronts never cross and pixel coverage is conserved',()=>{
  assert(Object.isFrozen(S));assert.deepEqual(S.positionsM,[5,16,30,50,80]);
  assert(S.edgeM>=.3&&S.edgeM<=.6);assert(S.tailWidths>=2&&S.tailWidths<=3);
  assert.equal(sea3Count(),5);assert.equal(sea3Count('light'),3);assert.equal(sea3Count('standard',2),3);assert.equal(sea3Count('standard',3),0);
  for(let x=-300;x<300;x+=3.7)for(let i=0;i<5;i++){
    const offset=i*C.gapOffset,w=sea3WidthScale(x,2,offset),density=sea3Density(x,2,offset);
    assert(w>=.5&&w<=1.8);assert(density>=.45&&density<=1);
    for(const gap of [5,11,30])assert(Math.abs(sea3Shift(x,2,offset,gap))<=gap*.18);
    for(let time=0;time<25;time+=.37){
      if(i)assert(sea3Centre(i,x,2,time)>sea3Centre(i-1,x,2,time));
      assert(sea3Centre(i,x,2,time+.001)<sea3Centre(i,x,2,time));
    }
  }
  assert(sea3Profile(-.5,2,0)===0);assert(sea3Profile(.5,2,0)>0);assert(sea3Profile(4,2,0)>0);
  // Integrate the smoothstep edge and tail: broadening preserves total surface film area.
  for(const width of [1,2,4])for(const footprint of [0,.5,4,20]){
    let area=0;for(let d=-40;d<80;d+=.01)area+=sea3Profile(d,width,footprint)*.01;
    assert(Math.abs(area-(S.edgeM+width*S.tailWidths)/2)<.012);
  }
  let holes=0,solid=0;for(let x=0;x<500;x+=.5){const n=sea3Texture(x,4,0,0,1);assert(n>=0&&n<=1);if(n===0)holes++;if(n>.7)solid++;}assert(holes>0&&solid>0);
});

test('sea3 S2 shoreline swash has six-second period, +/-1.5m motion and bounded offshore residue',()=>{
  for(const x of [-100,-3,12,80]){
    const centre=sea3WashCentre(x,0,0),hi=sea3WashCentre(x,0,S.washPeriodS/4),lo=sea3WashCentre(x,0,3*S.washPeriodS/4);
    assert(Math.abs(hi-lo-3)<2e-7);assert(Math.abs(sea3WashCentre(x,0,S.washPeriodS)-centre)<2e-7);
    for(const time of [0,2,4]){
      const c=sea3WashCentre(x,0,time);assert(Math.abs(c)<=S.washAmplitudeM+S.scallopAmplitudeM);
      assert(sea3WashProfile(c,x,0,time,0)>.9);assert(sea3WashProfile(c+2,x,0,time,0)>0);
      assert.equal(sea3WashProfile(c+4,x,0,time,0),0);assert.equal(sea3WashProfile(c-4,x,0,time,0),0);
    }
  }
  for(const d of [-20,-6,6,20,80])assert.equal(sea3Sample(d,0,0,0).wash,0);
});

test('sea3 S3 3D range exchange is smooth, nearby walking waves are unchanged and total weights never exceed one',()=>{
  assert(sea3Enabled(''));assert(!sea3Enabled('?sea3=0'));
  for(let r=0;r<=110;r+=.25){const gain=sea3Gain(r);assert(gain>=0&&gain<=1);assert.equal((1-gain)+gain,1);if(r<=40)assert.equal(gain,0);if(r>=90)assert.equal(gain,1);
    for(let d=0;d<=100;d+=1.3){const s=sea3Sample(d,15,d,2,.5,r),old=surfFoam(d,.5,15,d,0);assert(s.foam>=0&&s.foam<=gain+1e-12);assert(old*(1-gain)+s.foam<=1+1e-12);if(r<=40)assert.equal(s.foam,0);}
  }
  assert(sea3Gain(Math.hypot(0,60))>0,'altitude alone can enter the transition');
});

test('sea3 S4 absorption luminance falls continuously, shallow reflection stays unchanged through nine degrees',()=>{
  let prev=Infinity;for(let d=-5;d<=150;d+=.05){const c=sea3Color(d),l=luma(c);assert(l<=prev+1e-12);prev=l;assert(c.every(v=>v>=0&&v<=1));
    const next=sea3Color(d+.001);assert(next.every((v,i)=>Math.abs(v-c[i])<.0001));}
  assert(luma(sea3Color(0))>luma(sea3Color(25)));assert(luma(sea3Color(25))>luma(sea3Color(120)));
  for(let a=0;a<=9;a+=.1)assert.equal(sea3ColorGain(Math.sin(a*Math.PI/180),300),0);
  assert.equal(sea3ColorGain(1,39),0);assert.equal(sea3ColorGain(1,90),1);
});

test('sea3 S5 small grid resolves rock and narrow open wall; wide grid and metre-valued wetness/foam remain stable',()=>{
  const t=terrain();assert.equal(shoreFieldCell(t),4);assert.equal(shoreFieldCell({...t,cell:3}),6);
  assert.equal(shoreFieldCell({...t,bounds:{...t.bounds,maxX:3001}}),SHORE_GRID.legacyCellM);
  const bigSmall={...t,bounds:{minX:0,maxX:2500,minZ:0,maxZ:2500},cell:.5},cap=createSignedShoreJob(bigSmall).field;
  assert(cap.w<=512&&cap.h<=512);assert(shoreFieldCell(bigSmall)>=4);
  const fine=finish(createSignedShoreJob(t,{cell:4})),coarse=finish(createSignedShoreJob(t,{cell:8}));
  for(let d=-12;d<24;d+=.2){const a=fine.signedDistanceAt(0,d),b=coarse.signedDistanceAt(0,d);assert(Math.abs(a-b)<1e-6);assert(Math.abs(shoreWetBand(-a,6,.5)-shoreWetBand(-b,6,.5))<1e-6);assert(Math.abs(sea3Sample(a,4,d,2).foam-sea3Sample(b,4,d,2).foam)<1e-6);}
  for(const scene of ['island','ring']){
    const t=previewTerrain(scene),f=finish(createSignedShoreJob(t));
    for(const side of [-1,1]){const x=scene==='island'?side*(PREVIEW_SEA.islandRadiusM-3):side*PREVIEW_SEA.ringRadiusM;
      assert(t.heightAt(x,PREVIEW_SEA.centreZ)>=0);assert(f.signedDistanceAt(x,PREVIEW_SEA.centreZ)<=0);}
    let visible=0;for(let x=-110;x<=110;x+=1)for(let z=-50;z<=170;z+=1)if(t.isSea(x,z)&&sea3Sample(f.signedDistanceAt(x,z),x,z,2,.5).wash>.05)visible++;
    assert(visible>20,scene+' shoreline foam must survive the real sampled field');
  }
});

test('sea3 S6 shaders, debug reader, quality, no additional resources and exact disposal',()=>{
  for(const quality of ['standard','light']){
    const t=terrain(),v=buildKamakuraSea(t,data(),{quality,search:'?debug=1&sea3debug=1&bankwet=0'}),old=buildKamakuraSea(terrain(),data(),{quality,search:'?sea3=0&bankwet=0'}),s=shader(v);
    assert(s.fragmentShader.includes(SEA3_GLSL));assert(s.fragmentShader.includes('if(uSea3<.5&&seaRange>'));assert(s.fragmentShader.includes('seaFoam=seaFoam*(1.0-sea3Gain(seaRange))'));
    // Shared sea/ground +4m UV convention must still sample the fine cell centres.
    for(let i=0;i<100&&!v.preparedShore;i++)v.update(.016,{x:0,z:20},2);
    const field=v.jobs[0].field,grid=v.uniforms.uShoreGrid.value;
    assert(v.preparedShore);assert(Math.abs((field.x0-grid.x+4)/grid.z-.5/field.w)<1e-12);
    assert(Math.abs((field.z0-grid.y+4)/grid.w-.5/field.h)<1e-12);
    // Compare equal preparation states: sea3 changes resolution, not texture count.
    for(let i=0;i<100&&!old.preparedShore;i++)old.update(.016,{x:0,z:20},2);
    assert.equal(v.group.children.length,old.group.children.length);assert.equal(v.textures.length,old.textures.length);assert.equal(v.mesh.geometry.index.count,6);
    const camera=new THREE.PerspectiveCamera();camera.position.set(0,60,40);camera.lookAt(0,0,0);camera.updateMatrixWorld();v.mesh.onBeforeRender(null,null,camera);
    assert.equal(globalThis.__kzSea3().lines,quality==='light'?3:5);assert.equal(globalThis.__kzSea3().range.from,40);assert(globalThis.__kzSea3().nearest.distance>=60);assert(globalThis.__kzSea3().nearest.bearing>=0);
    v.setAdapt(2);assert.equal(v.uniforms.uSea3Lines.value,3);assert.equal(v.uniforms.uSea3Detail.value,0);
    v.setAdapt(3);assert.equal(v.uniforms.uSea3.value,0);assert.equal(v.uniforms.uSea2.value,1);assert.equal(v.uniforms.uSea2Lines.value,2);assert.equal(globalThis.__kzSea3().lines,0);
    v.setAdapt(0);assert.equal(v.uniforms.uSea3.value,1);assert.equal(v.uniforms.uSea3Lines.value,quality==='light'?3:5);
    const resources=[v.mesh.geometry,v.mesh.material,...v.textures],calls=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>calls[i]++));v.dispose();v.dispose();assert(calls.every(n=>n===1));assert.equal(globalThis.__kzSea3,undefined);old.dispose();
  }
  const update=source('kamakura-sea-view.js').split('update(dt,pos,audioTime)')[1].split('setAdapt(value)')[0];assert(!/=>|\.map\(|\.filter\(|\.slice\(/.test(update));
});

test('sea3=0 retains HEAD shader bytes, cache key, texture format and draw count',()=>{
  const v=buildKamakuraSea(terrain(),data(),{search:'?shelter=0&sea3=0&bankwet=0'}),s=shader(v);
  // Captured from the untouched HEAD onBeforeCompile, independently compared with sea3=0.
  assert.equal(createHash('sha256').update(s.vertexShader+'\n'+s.fragmentShader).digest('hex'),'c892de2aebb1e4200c251020ecb72926a24cedb40f5e200a27393cda2985593e');
  assert.equal(v.mesh.material.customProgramCacheKey(),'kamakura-sea-18-far');assert(!s.fragmentShader.includes('sea3Surf'));assert(!('uSea3' in s.uniforms));assert.equal(v.mesh.geometry.index.count/3,2);assert.equal(v.textures[0].format,THREE.RGFormat);v.dispose();
  for(const search of ['?sea2=0','?seav=0']){const v=buildKamakuraSea(terrain(),data(),{search});assert(!('uSea3' in v.uniforms));v.dispose();}
});

test('sea3 GLSL shared scalar expressions, dependency order, delimiters, reserved identifiers and declarations',()=>{
  // Exact bodies are emitted to GLSL; JS changes only float declarations, not arithmetic.
  assert(SEA3_GLSL.includes(SEA3_SCALAR_GLSL.replace(/shoreNoise\(([^,()]+),([^()]+?)\)/g,'shoreNoise(vec2($1,$2))')));
  const functions={sea3Phase,sea3Shift,sea3WidthScale,sea3Density,sea3Texture,sea3Profile,sea3WashCentre,sea3WashProfile};
  const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  for(const [name,fn]of Object.entries(functions)){
    const m=SEA3_SCALAR_GLSL.match(new RegExp('float '+name+'\\(([^)]*)\\)\\{([\\s\\S]*?)\\n?\\}'));
    assert(m,name);const args=m[1].replace(/float /g,''),mirror=Function('shoreNoise','smoothstep','mix','fract','sin','max','min','abs','clamp',`return function(${args}){${m[2].replace(/float /g,'let ')}}`)(shoreNoise,smoothstep,(a,b,t)=>a+(b-a)*t,x=>x-Math.floor(x),Math.sin,Math.max,Math.min,Math.abs,(x,a,b)=>Math.max(a,Math.min(b,x)));
    for(let n=0;n<10;n++){const values=args.split(',').map((_,i)=>(n+1)*(.3+i*.17));assert.equal(mirror(...values),fn(...values));}
  }
  const v=buildKamakuraSea(terrain(),data(),{search:'?bankwet=0'}),s=shader(v).fragmentShader.replace(/\/\/[^\n]*/g,'');v.dispose();const stack=[];
  for(const c of s){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
  assert(!/--\s*\d|\b\d+(?:\.\d*)?[A-Za-z_]\w*\s*\(/.test(s));assert(!/\b(?:float|vec[234])\s+(?:input|output|sample|patch|filter|common|active)\b/.test(s));
  assert(s.indexOf('float shoreNoise(')<s.indexOf('float sea3Shift('));assert(s.indexOf('float sea3Phase(')<s.indexOf('vec2 sea3Line('));
  const declarations=new Set([...s.matchAll(/\b(?:float|vec[234]|bool)\s+(sea3\w+)/g)].map(m=>m[1]));for(const m of s.matchAll(/\bsea3\w+\b/g))assert(declarations.has(m[0]),m[0]);
  for(const name of ['uSea3','uSea3Lines','uSea3Detail','uSea3Debug'])assert(new RegExp('uniform float [^;]*\\b'+name+'\\b').test(s));
  assert(!/\bshoreNoise\([^,()]+,[^()]+\)/.test(SEA3_GLSL),'noise scalar arguments must be wrapped in vec2');
  for(const [name,chunk]of Object.entries(THREE.ShaderChunk)){if(name==='clipping_planes_pars_fragment'||name==='dithering_fragment')assert.equal(typeof chunk,'string');}
  assert(SHORE_GLSL.includes('float shoreNoise(vec2 p)'));
});

test('sea3 private v12 field is finite with bounded dimensions (aggregate only)',{skip:!process.env.KZ_WORLD_DIR&&'私有データ未指定'},async t=>{
  const {readPrivateData}=await import('../tools/lib/kamakura-validation.mjs'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),terrain=createKamakuraTerrain(data),field=finish(createSignedShoreJob(terrain));
  assert(field.data.every(Number.isFinite));assert(field.data.every(d=>Math.abs(d)<=240));if(Math.max(terrain.bounds.maxX-terrain.bounds.minX,terrain.bounds.maxZ-terrain.bounds.minZ)<=2500)assert(field.w<=512&&field.h<=512);
  t.diagnostic(JSON.stringify({fieldCellM:field.cell,fieldDimensions:[field.w,field.h],fieldTextureBytes:field.w*field.h*4,seaTriangles:2,seaDraws:1,addedDraws:0,addedTextures:0}));
});
