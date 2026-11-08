import test from 'node:test';
import assert from 'node:assert/strict';
import {SEA_PALETTE,SEA_CHROMA,BREAKERS,WET_MEMORY,SHORE_GLSL,breakerFoam,wetReachAt,wetFromReach,shoreReach,createSignedShoreJob} from '../dist/valley/kamakura-shore.js';
import {waveEnvelope} from '../dist/valley/kamakura-sea-audio.js';
import {bankRibbon,buildBankWet} from '../dist/valley/kamakura-bank-wet.js';
import {riverRibbon,prepareRivers,decodeRivers} from '../dist/valley/kamakura-rivers.js';
import {buildShoreProps,PROP_SIZES} from '../dist/valley/kamakura-shore-props.js';
import {installGroundDetail} from '../dist/valley/kamakura-ground-detail.js';
import {THREE,load} from './helpers/tree-modules.mjs';
function shaderSafe(src){
  const s=src.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[],pp=[];
  for(const token of s.match(/[{}()[\]]|^\s*#\s*(?:ifdef|ifndef|if|else|elif|endif)\b/gm)||[]){
    if(token.includes('#')){if(/endif/.test(token))assert(pp.pop());else if(/else|elif/.test(token))assert(pp.length);else pp.push(token);continue;}
    if('{(['.includes(token))stack.push(token);else assert.equal(stack.pop(),{'}':'{',')':'(',']':'['}[token]);
  }
  assert.equal(stack.length,0);assert.equal(pp.length,0);
  assert(!/\b(?:float|vec[234]|int|bool)\s+(?:patch|sample|input|output|common|filter|active)\b/.test(s),'reserved identifier');
}
const compile=m=>{const b=THREE.ShaderLib[m.isMeshStandardMaterial?'standard':m.isMeshLambertMaterial?'lambert':'basic'],s={uniforms:{},vertexShader:b.vertexShader,fragmentShader:b.fragmentShader};m.onBeforeCompile(s);shaderSafe(s.vertexShader);shaderSafe(s.fragmentShader);return s;};
function bankStats(f,terrain){
  let maxEdge=0,maxError=0,flipped=0;
  const v=i=>Array.from(f.positions.slice(i*3,i*3+3));
  for(let i=0;i<f.indices.length;i+=3){
    const [a,b,c]=f.indices.slice(i,i+3).map(v);
    if((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])<=0)flipped++;
    for(const q of [a,b,c,[(a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3,(a[2]+b[2]+c[2])/3]])maxError=Math.max(maxError,Math.abs(q[1]-terrain.heightAt(q[0],q[2])));
    for(const [q,r] of [[a,b],[b,c],[c,a]]){maxEdge=Math.max(maxEdge,Math.hypot(...q.map((n,j)=>n-r[j])));maxError=Math.max(maxError,Math.abs((q[1]+r[1])/2-terrain.heightAt((q[0]+r[0])/2,(q[2]+r[2])/2)));}
  }
  return {maxEdge,maxError,flipped,rejected:f.rejected,folds:f.folds,triangles:f.indices.length/3};
}
function assertBank(s){assert(s.maxEdge<=1.2,JSON.stringify(s));assert(s.maxError<=.02,JSON.stringify(s));assert.equal(s.flipped,0);assert.equal(s.rejected,0);}
test('9e3 muted table follows distance, decreases luminance/chroma and retains evening source',()=>{
  assert.deepEqual(SEA_PALETTE.map(a=>a[0]),[0,6,40,200]);
  let lum=Infinity;
  for(const [,hex] of SEA_PALETTE){const c=new THREE.Color(hex),l=.2126*c.r+.7152*c.g+.0722*c.b;assert(l<lum);lum=l;assert(Math.max(c.r,c.g,c.b)-Math.min(c.r,c.g,c.b)<.14);}
  // Absolute linear RGB chroma of 9e2's cyan was .275-.050=.225.
  assert(Math.max(...SEA_PALETTE.map(([,hex])=>{const c=new THREE.Color(hex);return (Math.max(c.r,c.g,c.b)-Math.min(c.r,c.g,c.b))*SEA_CHROMA;}))<=.225*.5);
});
test('9e3 three fronts have 8–40m gaps, varying .5–3m width, bounded offshore and distinct clocks',()=>{
  assert.equal(BREAKERS.length,3);assert(BREAKERS.every(b=>b.speed>=.7&&b.speed<=1));
  for(const b of BREAKERS){let visible=0,empty=0;const widths=[];
    for(let x=-100;x<=100;x+=.5){const wave=waveEnvelope(10*b.speed+b.phase),centre=1+5*(1-wave)+b.offset;let width=0;
      for(let d=centre-2;d<centre+2;d+=.05)if(breakerFoam(d,wave,x,0,b.offset)>.03)width+=.05;
      if(width)visible++;else empty++;widths.push(width);
      assert.equal(breakerFoam(45.001,wave,x,0,b.offset),0);assert.equal(breakerFoam(-.1,wave,x,0,b.offset),0);
    }assert(visible>10&&empty>10);assert(Math.max(...widths)<=3.01);assert(Math.max(...widths)-Math.min(...widths)>.5);
  }
});
test('9e3 wet memory is a decaying maximum over six seconds with the shared 4s constant and 1.5m soft edge',()=>{
  assert.equal(WET_MEMORY.decay,4);assert.equal(WET_MEMORY.seconds,6);assert.equal(WET_MEMORY.edge,1.5);
  const pulse=t=>t<=1?1:0;
  for(const t of [1.5,2,3])assert(Math.abs(wetReachAt(t,pulse)-9*Math.exp(-(t-1)/4))<1e-9);
  assert(wetReachAt(2,pulse)>shoreReach(pulse(2)));assert.equal(wetReachAt(8,pulse),3.3);
  for(let t=0;t<100;t+=.1){const r=wetReachAt(t,waveEnvelope);assert(r>=shoreReach(waveEnvelope(t))&&r<=9);}
  assert.equal(wetFromReach(4,5.5),1);assert.equal(wetFromReach(5.5,5.5),0);assert(SHORE_GLSL.includes('/1.5'));
});
test('9e3 props use solid separate shapes, <=20 triangles, life sizes, wood <=2, cap and exact disposal',()=>{
  const terrain={heightAt:()=>1,isSea:()=>false,seaDistanceAt:()=>11,riverDistanceAt:()=>Infinity};
  const v=buildShoreProps(THREE,terrain,{});for(let i=0;i<20;i++)v.update({x:0,z:0});assert(v.count<=60&&v.count>=20);assert(v.meshes[2].count<=2);
  v.meshes.forEach((m,type)=>{
    const g=m.geometry;assert((g.index?g.index.count:g.attributes.position.count)/3<=20);assert.equal(m.castShadow,false);
    const mat=new THREE.Matrix4(),scale=new THREE.Vector3(),p=new THREE.Vector3(),q=new THREE.Quaternion();
    for(let i=0;i<m.count;i++){m.getMatrixAt(i,mat);mat.decompose(p,q,scale);assert(scale.x>=PROP_SIZES[type][0]-1e-7&&scale.x<=PROP_SIZES[type][1]+1e-7);const thickness=(g.boundingBox.max.y-g.boundingBox.min.y)*scale.y;assert(thickness>=.005);}
  });
  const resources=[...v.group.children,...v.meshes.map(m=>m.geometry),v.meshes[0].material],calls=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>calls[i]++));v.dispose();v.dispose();assert(calls.every(n=>n===1));
});
test('9e3 bank conforms on 30 degree slopes and curved uneven terrain, no reversed triangles',()=>{
  const river={xy_m:[[0,0],[0,-5],[2,-10],[6,-14]],water_elev_m:[1,1,1,1],width_m:[4,4,4,4],enters_sea:false};
  for(const heightAt of [(x,z)=>x*Math.tan(Math.PI/6)+z*.03,(x,z)=>Math.sin(x*2)*.1+Math.abs(z+5)*.3]){const terrain={heightAt};assertBank(bankStats(bankRibbon(riverRibbon(river),terrain),terrain));}
});
test('9e3 all generated sea, sand, props and bank shader strings balance delimiters/conditionals and avoid reserved names',async()=>{
  shaderSafe(SHORE_GLSL);assert.throws(()=>shaderSafe('void main(){x=(1.0;}'));assert.throws(()=>shaderSafe('#ifdef X\nvoid main(){}'));assert.throws(()=>shaderSafe('float patch=1.0;'));
  const {buildKamakuraSea}=await load('kamakura-sea-view.js'),terrain={bounds:{minX:-40,maxX:40,minZ:-40,maxZ:40},heightAt:(x,z)=>z,isSea:(x,z)=>z<0,seaDistanceAt:(x,z)=>Math.max(0,z),riverDistanceAt:()=>Infinity};
  const data={meta:{grid:{width:11,height:11,cell_m:8},surface:{}},surface:new Uint8Array(121)};
  for(const search of ['', '?time=evening','?seav=0','?bankwet=1']){
    const sea=buildKamakuraSea(terrain,data,{search});compile(sea.mesh.material);
    const ground=new THREE.MeshLambertMaterial(),detail=installGroundDetail(THREE,ground,data),gs=compile(ground);
    if(sea.props){for(const m of sea.props.meshes)compile(m.material);assert.equal(gs.uniforms.uShoreWetReach,sea.uniforms.uShoreWetReach);}
    for(const step of [0,2,3,0]){sea.setAdapt(step);sea.update(1/60,{x:0,z:4},10);if(sea.props)assert.equal(sea.props.group.visible,step<2);}
    detail.dispose();ground.dispose();sea.dispose();
  }
  const bank=buildBankWet(THREE,prepareRivers({rivers:[]}),terrain);compile(bank.material);bank.dispose();
});
test('9e3 private full-river edge, height and orientation acceptance (aggregate only)',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有データを同梱しない'},async t=>{
  const {readPrivateData}=await import('../tools/lib/kamakura-validation.mjs'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js'),fs=await import('node:fs/promises'),path=await import('node:path');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),terrain=createKamakuraTerrain(data);
  const rivers=decodeRivers(JSON.parse(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'rivers.json'),'utf8'))),prepared=prepareRivers(rivers,terrain.vscale??1);
  const total={maxEdge:0,maxError:0,flipped:0,rejected:0,folds:0,triangles:0},start=performance.now();
  for(const r of prepared.ribbons){const s=bankStats(bankRibbon(r,terrain),terrain);total.maxEdge=Math.max(total.maxEdge,s.maxEdge);total.maxError=Math.max(total.maxError,s.maxError);for(const k of ['flipped','rejected','folds','triangles'])total[k]+=s[k];}
  t.diagnostic(JSON.stringify({...total,ms:performance.now()-start}));assertBank(total);
});
test('9e3 nearby bank preparation yields, fades, evicts buffers once, quality/URL disable work',()=>{
  const terrain={heightAt:()=>1},r={xy_m:[[0,0],[0,-6],[0,-12]],water_elev_m:[1,1,1],width_m:[4,4,4],enters_sea:false},prepared=prepareRivers({rivers:[r]});
  // Fixed work clock: CPU scheduling must not decide how many update calls finish this fixture.
  const bank=buildBankWet(THREE,prepared,terrain,{defer:true,now:()=>0});assert.equal(bank.group.children.length,0);
  bank.update({x:0,z:0});assert.equal(bank.group.children.length,0);bank.update({x:0,z:0});assert.equal(bank.group.children.length,1);
  const geometry=bank.group.children[0].geometry;assert(geometry.index.isBufferAttribute);assert(Number.isFinite(geometry.index.count)&&geometry.index.count>0);assert(geometry.index.array.every(i=>i<geometry.attributes.position.count));
  let disposed=0;for(const m of bank.group.children)m.geometry.addEventListener('dispose',()=>disposed++);
  bank.update({x:1000,z:1000});assert.equal(bank.group.children.length,0);assert.equal(disposed,1);
  bank.setAdapt(3);bank.update({x:0,z:0});assert.equal(bank.group.visible,false);assert.equal(bank.group.children.length,0);
  bank.setAdapt(2);bank.update({x:0,z:0});assert.equal(bank.group.visible,true);assert.equal(bank.uniforms.uBankRange.value,48);compile(bank.material);
  bank.dispose();bank.dispose();assert.equal(disposed,1);
  const off=buildBankWet(THREE,prepared,terrain,{search:'?bankwet=0'});assert.equal(off.group.children.length,0);off.dispose();
});
