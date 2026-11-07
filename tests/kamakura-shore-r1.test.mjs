import test from 'node:test';
import assert from 'node:assert/strict';
import {SHORE_BANDS,shoreMoisture,shoreDepthMix,surfCentre,surfWidth,surfFoam,riverPropAt} from '../dist/valley/kamakura-shore.js';
import {bankRibbon,bankSurfaceRibbon,buildBankWet} from '../dist/valley/kamakura-bank-wet.js';
import {riverRibbon,prepareRivers} from '../dist/valley/kamakura-rivers.js';
import {chunkGeometry} from '../dist/valley/kamakura-chunks.js';
import {createFxState} from '../dist/valley/kamakura-fx.js';
import {buildShoreProps} from '../dist/valley/kamakura-shore-props.js';
import {THREE,load} from './helpers/tree-modules.mjs';
const terrain={cell:4,w:9,h:9,x0:0,z0:0,heightAt:(x,z)=>2+.08*x*z,normalAt:()=>({x:0,y:1,z:0})};
const river=(xy=[[8,-4],[12,-12],[9,-20],[14,-27]])=>({xy_m:xy,width_m:xy.map(()=>3),water_elev_m:xy.map(()=>3),enters_sea:false});
const area=(a,b,c)=>(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
function heightOn(mesh,x,z){
  for(let k=0;k<mesh.indices.length;k+=3){
    const [a,b,c]=mesh.indices.slice(k,k+3).map(i=>Array.from(mesh.positions.slice(i*3,i*3+3))),q=[x,0,z],den=area(a,b,c);
    const u=area(q,b,c)/den,v=area(a,q,c)/den,w=1-u-v;
    if(u>=-1e-6&&v>=-1e-6&&w>=-1e-6)return u*a[1]+v*b[1]+w*c[1];
  }throw Error('point outside terrain');
}
function safe(source){
  const s=source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,''),stack=[],pp=[];
  for(const t of s.match(/[{}()[\]]|^\s*#\s*(?:if|ifdef|ifndef|else|elif|endif)\b/gm)||[]){
    if(t.includes('#')){if(/endif/.test(t))assert(pp.pop());else if(/else|elif/.test(t))assert(pp.length);else pp.push(t);}
    else if('{(['.includes(t))stack.push(t);else assert.equal(stack.pop(),{'}':'{',')':'(',']':'['}[t]);
  }assert.equal(stack.length,0);assert.equal(pp.length,0);
  assert(!/\b(?:float|vec[234]|int|bool)\s+(?:patch|sample|input|output|filter|common|active|partition|resource)\b/.test(s));
}
const compile=m=>{const b=THREE.ShaderLib[m.isMeshStandardMaterial?'standard':'basic'],s={uniforms:{},vertexShader:b.vertexShader,fragmentShader:b.fragmentShader};m.onBeforeCompile(s);safe(s.vertexShader);safe(s.fragmentShader);return s;};
test('R1 shared d: wetness and depth continuous, bounded, monotonic; broken surf has variable widths and gaps',t=>{
  let wet=1,deep=0;
  for(let d=0;d<=40;d+=.001){const w=shoreMoisture(d,9),c=shoreDepthMix(d);assert(w>=0&&w<=wet&&c>=deep&&c<=1);assert(Math.abs(w-wet)<.001&&Math.abs(c-deep)<.001);wet=w;deep=c;}
  const widths=[],gaps=[];let visible=0,empty=0;
  for(let x=-80;x<=80;x+=.5){const centres=SHORE_BANDS.map(b=>surfCentre(.4,x,3,b));for(let i=1;i<centres.length;i++)gaps.push(centres[i]-centres[i-1]);
    for(const b of SHORE_BANDS){widths.push(surfWidth(x,3,b));const value=surfFoam(surfCentre(.4,x,3,b),.4,x,3,b);assert(value>=0&&value<=1);if(value>.02)visible++;else empty++;
      const c=surfCentre(.4,x,3,b);let previous=surfFoam(c,.4,x,3,b);for(let d=c+.001;d<c+3;d+=.001){const f=surfFoam(d,.4,x,3,b);assert(f<=previous+1e-10);assert(Math.abs(f-previous)<.004);previous=f;}
    }
  }
  assert(visible>20&&empty>20);assert(Math.max(...widths)-Math.min(...widths)>.5);assert(Math.max(...gaps)-Math.min(...gaps)>1);
  t.diagnostic(JSON.stringify({bands:SHORE_BANDS.length,widthRange:[Math.min(...widths),Math.max(...widths)],gapRange:[Math.min(...gaps),Math.max(...gaps)]}));
});
test('R1 bank: old bilinear drape intersects saddle faces; clipped ribbon stays 15mm above rendered surface on bends',t=>{
  const mesh=chunkGeometry(terrain,0,0,8,8,1,{},false),r=riverRibbon(river());
  const old=bankRibbon(r,terrain);let oldError=0;
  for(let i=0;i<old.positions.length;i+=3)oldError=Math.max(oldError,Math.abs(old.positions[i+1]-.015-heightOn(mesh,old.positions[i],old.positions[i+2])));
  assert(oldError>.02);
  let maxError=0,triangles=0;
  for(const xy of [undefined,[[5,-5],[15,-5],[16,-15],[9,-17]],[[7,-7],[15,-7],[7,-8],[16,-9]]]){
    const bent=riverRibbon(river(xy));
    // Deliberately include the hairpin segments normally culled by water preparation.
    if(!bent.indices.length)for(let k=0;k<bent.positions.length/3-2;k+=2)bent.indices.push(k,k+1,k+2,k+1,k+3,k+2);
    const f=bankSurfaceRibbon(bent,terrain);assert(f.indices.length>0);
    for(let k=0;k<f.indices.length;k+=3){const face=f.indices.slice(k,k+3).map(i=>Array.from(f.positions.slice(i*3,i*3+3)));assert(area(...face)>0);triangles++;
      for(const q of [...face,face[0].map((_,j)=>(face[0][j]+face[1][j]+face[2][j])/3)])maxError=Math.max(maxError,Math.abs(q[1]-.015-heightOn(mesh,q[0],q[2])));
    }
  }
  const straight=bankSurfaceRibbon(riverRibbon(river([[12,-4],[12,-24]])),terrain);
  for(let k=0;k<straight.positions.length;k+=3)assert(straight.positions[k]>=14.7-1e-5||straight.positions[k]<=9.3+1e-5,'wet strip must extend outwards from both banks');
  assert(maxError<.00001);t.diagnostic(JSON.stringify({oldDrapeError:oldError,newDrapeError:maxError,triangles}));
});
test('R1 river props deterministic, slope-gated and pooled; wet idle legs ripple, dry/legacy/paused do not',()=>{
  const wet={heightAt:()=>2,isSea:()=>false,riverDistanceAt:(x,z)=>Math.abs(z),seaDistanceAt:()=>100,waterAt:()=>.4};
  assert.equal(riverPropAt({...wet,slopeAt:()=>40},1,1),false);
  assert.equal(riverPropAt(wet,1,8),false);
  let sites=0;for(let x=0;x<30;x++){assert.equal(riverPropAt(wet,x,1),riverPropAt(wet,x,1));if(riverPropAt(wet,x,1))sites++;}assert(sites>0);
  const props=buildShoreProps(THREE,wet,{},'standard',{shore2:true});for(let i=0;i<20;i++)props.update({x:0,z:0});assert(props.count>0);const buffers=props.meshes.map(m=>m.instanceMatrix);props.update({x:0,z:0});assert.deepEqual(props.meshes.map(m=>m.instanceMatrix),buffers);props.dispose();props.dispose();
  const rivers={sampleAt:()=>({valid:true,y:2.4})},hero={pos:{x:0,y:2,z:0},yaw:0};
  for(const [shore2,depth,dt,expected] of [[true,.4,.1,true],[false,.4,.1,false],[true,0,.1,false],[true,.4,0,false]]){
    const s=createFxState({terrain:{waterAt:()=>depth},rivers,shore2}),pool=s.ripples;s.update(dt,hero);assert.equal(s.ripples.some(r=>r.life>0),expected);
    for(let i=0;i<100;i++)s.update(dt,hero);assert.equal(s.ripples,pool);
    s.setLimits(0,0);s.update(1,hero);assert(s.ripples.every(r=>!r.life));
  }
});
test('R1 Three: URL/quality/adapt switches, generated GLSL, stable update buffers and exact disposal',async()=>{
  const {buildKamakuraSea}=await load('kamakura-sea-view.js'),{buildKamakuraWater}=await load('kamakura-water-view.js');
  const t={...terrain,bounds:{minX:0,maxX:32,minZ:0,maxZ:32},isSea:()=>false,seaDistanceAt:()=>100,riverDistanceAt:()=>Infinity};
  for(const search of ['', '?shore2=0'])for(const quality of ['standard','light']){
    const s=buildKamakuraSea(t,{},{search,quality}),w=buildKamakuraWater(prepareRivers({rivers:[river()]}),{terrain:t,search,quality});
    assert.equal(s.uniforms.uShore2.value,search?0:1);assert.equal(w.uniforms.uShore2.value,search?0:1);compile(s.mesh.material);compile(w.material);compile(s.bank.material);
    const resources=new Map();for(const r of [s.mesh.geometry,s.mesh.material,...s.textures,w.material,...w.group.children.map(m=>m.geometry)]){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}
    for(const step of [0,2,3,0]){s.setAdapt(step);w.setAdapt(step);assert.equal(s.uniforms.uShoreBands.value,step>=3?0:quality==='light'||step>=2?1:3);assert.equal(w.uniforms.uRiverBands.value,step>=3?0:quality==='light'||step>=2?1:2);}
    w.dispose();w.dispose();s.dispose();s.dispose();assert([...resources.values()].every(n=>n===1));
  }
  const p=prepareRivers({rivers:[river()]}),bank=buildBankWet(THREE,p,terrain,{defer:true});for(let i=0;i<300;i++)bank.update({x:12,z:12});assert(bank.group.children.length>0);
  const resources=new Map();for(const r of [bank.material,...bank.group.children.map(m=>m.geometry)]){resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));}
  const geometry=bank.group.children[0].geometry;for(let i=0;i<100;i++)bank.update({x:12,z:12});assert.equal(bank.group.children[0].geometry,geometry);
  bank.dispose();bank.dispose();assert([...resources.values()].every(n=>n===1));
  const off=buildBankWet(THREE,p,terrain,{search:'?bankwet=0'});assert.equal(off.group.children.length,0);off.dispose();
});
test('R1 private nearby bank preparation and steady updates (aggregate only)',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有データは同梱しない'},async t=>{
  const {readPrivateData}=await import('../tools/lib/kamakura-validation.mjs'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js'),{decodeRivers}=await import('../dist/valley/kamakura-rivers.js'),fs=await import('node:fs/promises'),path=await import('node:path');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),terrain=createKamakuraTerrain(data);
  const prepared=prepareRivers(decodeRivers(JSON.parse(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'rivers.json'),'utf8'))),terrain.vscale);
  const r=prepared.ribbons.find(r=>r.indices.length>0),pos={x:r.positions[r.indices[0]*3],z:r.positions[r.indices[0]*3+2]};
  const bank=buildBankWet(THREE,prepared,terrain,{defer:true});let maxPrep=0;
  for(let i=0;i<10000;i++){const start=performance.now();bank.update(pos);maxPrep=Math.max(maxPrep,performance.now()-start);if(bank.group.children.length)break;}
  assert(bank.group.children.length>0);const g=bank.group.children[0].geometry;assert(g.attributes.position.array.every(Number.isFinite));
  for(let k=0;k<g.index.count;k+=3){const face=Array.from(g.index.array.slice(k,k+3),i=>Array.from(g.attributes.position.array.slice(i*3,i*3+3)));assert(area(...face)>0);}
  const start=performance.now();for(let i=0;i<10000;i++)bank.update(pos);const steady=(performance.now()-start)/10000;
  assert.equal(bank.group.children[0].geometry,g);t.diagnostic(JSON.stringify({maxPreparationMs:maxPrep,steadyMsPerFrame:steady}));bank.dispose();
});
test('R1 clipped bank matches fine patches and the real chunk perimeter across a seam',()=>{
  const t={...terrain,w:69,heightAt:(x,z)=>2+.08*(x-256)*z,patches:{},patchIndex:(i,j)=>i>=62&&i<=65&&j===3?0:undefined};
  const a=chunkGeometry(t,0,0,64,8,1,{},false),b=chunkGeometry(t,64,0,68,8,1,{},false);
  const surface={positions:[...a.positions,...b.positions],indices:[...a.indices,...b.indices.map(i=>i+a.positions.length/3)]};
  const f=bankSurfaceRibbon(riverRibbon(river([[247,-11],[255,-16],[263,-19]])),t);assert(f.indices.length>0);
  for(let k=0;k<f.indices.length;k+=3){
    const face=f.indices.slice(k,k+3).map(i=>Array.from(f.positions.slice(i*3,i*3+3)));assert(area(...face)>0);
    const q=face[0].map((_,j)=>(face[0][j]+face[1][j]+face[2][j])/3);
    const error=Math.abs(q[1]-.015-heightOn(surface,q[0],q[2]));assert(error<.00003,JSON.stringify({error,q}));
  }
});
