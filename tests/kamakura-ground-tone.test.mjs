import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { THREE } from './helpers/tree-modules.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { installGroundSoil } from '../dist/valley/kamakura-ground-soil.js';
import { groundUseAt,groundUseBoxes,toneTexel,toneStrength,toneDistance,toneFine,toneRelief,toneChannel,grassTintAt } from '../dist/valley/kamakura-ground-tone-rules.js';
import { grassAmount, smooth, soilNoise } from '../dist/valley/kamakura-ground-pattern.js';
import { registerShoreView,unregisterShoreView } from '../dist/valley/kamakura-shore.js';
import { chunkGeometry } from '../dist/valley/kamakura-chunks.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { readPrivateData,verifySeams } from '../tools/lib/kamakura-validation.mjs';
import { groundDetailChannel } from './helpers/kamakura-ground-color.mjs';
const synthetic=()=>{const d=fixture({width:9,height:9,cell:2});d.meta.ground={};d.meta.surface={};d.ground=new Uint8Array(81*3).fill(140);d.surface=new Uint8Array(81).fill(2);return d;};
function balanced(source){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c],`mismatched ${c}`);}
  assert.equal(stack.length,0,'unclosed bracket');
  const directives=[];
  for(const line of clean.split('\n')){
    if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(line))directives.push(false);
    else if(/^\s*#\s*(else|elif)\b/.test(line)){assert(directives.length,'orphan else/elif');assert(!directives.at(-1),'branch after else');if(/^\s*#\s*else\b/.test(line))directives[directives.length-1]=true;}
    else if(/^\s*#\s*endif\b/.test(line))assert.notEqual(directives.pop(),undefined,'orphan endif');
  }
  assert.equal(directives.length,0,'unclosed conditional');
}
// Expand shipped Three chunks too: checking only hook text misses declarations in includes.
function expanded(source){
  return source.replace(/#include\s+<([\w]+)>/g,(_,name)=>{
    assert.equal(typeof THREE.ShaderChunk[name],'string',`unknown chunk ${name}`);
    return expanded(THREE.ShaderChunk[name]);
  });
}
function uniformDeclarations(source,label){
  const clean=expanded(source).replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const declared=new Map();
  for(const match of clean.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+([^;]+);/g)){
    for(const entry of match[1].split(',')){
      const name=entry.trim().match(/^\w+/)?.[0];
      if(name&&!declared.has(name))declared.set(name,match.index);
    }
  }
  // Project uniforms use u + capital; Three's injected builtins (cameraPosition,
  // modelMatrix, etc.) have other names and are supplied by WebGLProgram.
  for(const match of clean.matchAll(/\bu[A-Z]\w*\b/g)){
    assert(declared.has(match[0]),`${label}: ${match[0]} missing uniform declaration`);
    assert(declared.get(match[0])<match.index,`${label}: ${match[0]} used before uniform declaration`);
  }
}
test('r1 uniform checker rejects absent, late and comma-list declarations with a missing member',()=>{
  for(const s of ['void main(){float x=uMissing;}','float f(){return uLate;} uniform float uLate;','uniform float uA,uB; float f(){return uC;}'])
    assert.throws(()=>uniformDeclarations(s,'checker'),/uniform declaration/);
  uniformDeclarations('uniform sampler2D uA,uB; uniform highp vec3 uGrid; float f(){return uGrid.z;}','checker');
});
test('r1 assembled Lambert uniforms are declared before use for every detail/soil/tone/light combination',async t=>{
  for(let mask=0;mask<32;mask++)for(const shore of [false,true]){
    const params=new URLSearchParams();
    for(const [bit,key] of [[1,'gdetail'],[2,'gsoil'],[4,'gtone'],[16,'ground']])if(mask&bit)params.set(key,'0');
    const quality=mask&8?'light':'standard';if(mask&8)params.set('q','light');
    const search=`?${params}`,label=`${search} shore=${shore}`;
    await t.test(label,async()=>{
      const d=synthetic(),m=new THREE.MeshLambertMaterial({vertexColors:!(mask&16)});
      if(shore)registerShoreView(d,{});
      const detail=installGroundDetail(THREE,m,d,{search,quality});
      const soil=installGroundSoil(THREE,m,detail,{search,quality});
      try{
        await Promise.all([detail.tone?.ready,soil.ready]);
        const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
        m.onBeforeCompile(s);
        for(const stage of ['vertexShader','fragmentShader']){
          balanced(expanded(s[stage]));uniformDeclarations(s[stage],`${label} ${stage}`);
        }
        const fragment=expanded(s.fragmentShader);
        for(const name of ['toneHash','toneNoise','grassTintAt','groundTone','groundSoilGrain','groundGrassDetail']){
          const definitions=[...fragment.matchAll(new RegExp(`\\b(?:float|vec[234])\\s+${name}\\s*\\(`,'g'))];
          assert(definitions.length<=1,`${label}: duplicate ${name}`);
          if(definitions.length)assert.equal(fragment.match(new RegExp(`\\b${name}\\s*\\(`)).index,definitions[0].index+definitions[0][0].indexOf(name),`${label}: ${name} used before declaration`);
        }
        assert(!/\b(?:float|vec[234]|int|sampler2D)\s+(?:patch|sample|input|output|filter|common|active|partition|resource)\b/.test(fragment));
        if(detail.tone){
          assert.deepEqual(s.uniforms.uToneGrid.value.toArray(),[9,9,2]);
          assert.equal(s.uniforms.uToneStrength.value,quality==='light'?.45:1);
          assert.equal(s.uniforms.uToneBaked.value,mask&16?0:1);
        }
      }finally{detail.dispose();soil.dispose();m.dispose();if(shore)unregisterShoreView(d);}
    });
  }
});
test('r1 reproduces LOD interior colour alias and nearest-class jumps, not a stitched-height crack',t=>{
  const d=synthetic();d.ground.fill(80);const w=d.meta.grid.width;
  for(let j=0;j<w;j++)for(let i=0;i<w;i++)for(let c=0;c<3;c++)d.ground[(j*w+i)*3+c]=(i+j)%2?180:80;
  const terrain=createKamakuraTerrain(d);
  const nearMesh=chunkGeometry(terrain,0,0,8,8,1),farMesh=chunkGeometry(terrain,0,0,8,8,8);
  const near=nearMesh.colors[3],far=farMesh.colors[0];
  // At the first odd grid point the coarse triangle interpolates two even endpoints.
  assert.equal(farMesh.colors[0],farMesh.colors[3]);
  assert(near-far>.3);assert.equal(verifySeams(terrain,0,0,4),32);
  // 18/55/700/2500 distance bands are continuous, but equal-distance contours remain straight in old code.
  const nearest=x=>x<0?1:0;
  assert.equal(nearest(-1e-6)-nearest(1e-6),1);
  t.diagnostic(`synthetic old LOD interior linear difference ${(near-far).toFixed(6)}; 32 stitched edge combinations pass`);
});
test('r1 corrections finite and bounded; distance/pixel integration continuous; bands vary in world space',t=>{
  let maxJump=0,min=Infinity,max=-Infinity;
  for(let x=-80;x<=80;x+=4)for(const d of [0,12,18,35,55,60,65,110,700,2500]){
    const a=toneFine(x,17,d-.001,.01),b=toneFine(x,17,d+.001,.01);maxJump=Math.max(maxJump,Math.abs(a-b));
    assert.equal(toneFine(x,17,d,1),0);
    for(const h of [0,80,300])for(const ny of [0,.7,1])for(const c of [-1,0,1])for(const n of [0,.5,1]){
      const r=toneRelief(h,ny,c,.5,n);assert(Number.isFinite(r)&&r>=-.85&&r<=.85);
      for(let k=0;k<3;k++){const v=toneChannel(.25,k,r,1-ny,grassTintAt(x,17,d),0);assert(v>=0&&v<=1);min=Math.min(min,v);max=Math.max(max,v);}
    }
  }
  assert(maxJump<.0001);assert.notEqual(toneDistance(0,0,55),toneDistance(90,50,55));
  assert.equal(toneStrength('standard',0),1);assert.equal(toneStrength('standard',2),.45);assert.equal(toneStrength('light',0),.45);assert.equal(toneStrength('light',3),0);
  t.diagnostic(`max transition change over .002m ${maxJump.toFixed(8)}; channel range ${min.toFixed(6)}..${max.toFixed(6)}`);
});
test('r1 facility use uses anchor-local bounds, soft external edge and only known footprints',()=>{
  const d=synthetic();d.facilities={nodes:[{part:'sando',anchor_xz:[10,20],bbox_min:[-2,0,-10],bbox_max:[2,1,10]},{part:'torii'}]};
  const boxes=groundUseBoxes(d);assert.equal(boxes.length,1);assert.equal(groundUseAt(boxes,10,20),1);assert.equal(groundUseAt(boxes,17,20),0);assert(groundUseAt(boxes,14,20)>.5);
  assert(Math.abs(groundUseAt(boxes,12-1e-5,20)-groundUseAt(boxes,12+1e-5,20))<1e-8);
  const weights=new Uint8Array(324);toneTexel(d,boxes,0,weights);assert.equal(weights[0],255);assert.equal(weights[3],255);
});
test('r1 shipped Three hook composes soil, A/B and adaptation; preparation cancellation and all textures release once',async()=>{
  for(const search of ['', '?gtone=0','?gsoil=0','?gdetail=0']){
    const d=synthetic();registerShoreView(d,{});const m=new THREE.MeshLambertMaterial({vertexColors:true}),detail=installGroundDetail(THREE,m,d,{search}),soil=installGroundSoil(THREE,m,detail,{search});
    await Promise.all([detail.tone?.ready,soil.ready]);
    const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);if(!search.includes('gdetail=0'))assert(s.fragmentShader.includes('groundShoreWet'));balanced(s.fragmentShader);balanced(s.vertexShader);
    assert(!/\b(?:float|vec[234]|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource)\b/.test(s.fragmentShader));
    if(detail.tone){assert.equal(detail.tone.textures[0].image.data,d.ground);assert.equal(detail.tone.textures[0].internalFormat,'SRGB8');assert.equal(soil.textures.length,0);assert(detail.tone.textures.every(t=>t.generateMipmaps&&t.minFilter===THREE.LinearMipmapLinearFilter));assert.equal(s.uniforms.uToneReady.value,1);assert.equal(s.uniforms.uToneSoil.value,search.includes('gsoil=0')?0:1);assert(s.fragmentShader.includes('uGroundStrength>0.0 && uToneStrength<=0.0'));detail.setAdapt(2);assert.equal(s.uniforms.uToneStrength.value,.45);detail.setAdapt(3);assert.equal(s.uniforms.uToneStrength.value,0);detail.setAdapt(0);assert.equal(s.uniforms.uToneStrength.value,1);}
    else assert(search.includes('gtone=0')||search.includes('gdetail=0'));
    const textures=[...detail.textures,...soil.textures,...(detail.tone?.textures||[])],counts=textures.map(()=>0);textures.forEach((v,i)=>v.addEventListener('dispose',()=>counts[i]++));detail.dispose();detail.dispose();assert(counts.every(v=>v===1));m.dispose();unregisterShoreView(d);
  }
  const d=synthetic();d.meta.grid.width=100;d.meta.grid.height=100;d.meta.grid.cell_m=4;d.ground=new Uint8Array(30000);d.surface=new Uint8Array(10000);
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d);owner.dispose();await owner.tone.ready;assert.equal(owner.tone.uniforms.uToneReady.value,0);m.dispose();
  const src=await readFile(new URL('../dist/valley/kamakura-ground-tone.js',import.meta.url),'utf8');
  assert(!src.includes('update(')); // All new CPU work is preparation/adaptation, never a frame callback.
});
test('r1 private corrected natural-class mean stays within existing 25/255 tolerance',{
  skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有地面が必要'
},async t=>{
  const {data:d}=await readPrivateData(process.env.KZ_WORLD_DIR);
  d.surface=new Uint8Array(await readFile(join(process.env.KZ_WORLD_DIR,d.meta.surface.file)));
  if(d.meta.facilities)d.facilities=JSON.parse(await readFile(join(process.env.KZ_WORLD_DIR,d.meta.facilities.file),'utf8'));
  const terrain=createKamakuraTerrain(d),sum=new Float64Array(24),old=new Float64Array(24),counts=new Uint32Array(8);
  let maxError=0;
  const beforeSum=new Float64Array(8),afterSum=new Float64Array(8),beforeSq=new Float64Array(8),afterSq=new Float64Array(8);
  const encode=v=>255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055);
  for(let i=0;i<d.surface.length;i+=127){const code=d.surface[i];if(code>7)continue;counts[code]++;
    const x=(i%d.meta.grid.width-(d.meta.grid.width-1)/2)*d.meta.grid.cell_m,z=(Math.floor(i/d.meta.grid.width)-(d.meta.grid.height-1)/2)*d.meta.grid.cell_m;
    const normal=terrain.normalAt(x,z),ny=normal.y,land=code>1?1:0,steep=1-smooth(.55,.95,ny);
    const r=land*toneRelief(terrain.heightAt(x,z),ny,0,Math.max(0,-normal.z),soilNoise(x/43,z/43));
    let beforeLuma=0,afterLuma=0;
    const macro=soilNoise(x/43,z/43),dry=smooth(0,180,terrain.heightAt(x,z));
    const oldRelief=land*Math.max(-.12,Math.min(.12,.045*(macro*2-1)+.025*dry-.045*steep-.025*Math.max(0,-normal.z)));
    for(let k=0;k<3;k++){const base=terrain.groundColorAt(x,z)[k],detail=groundDetailChannel(x,z,500,grassAmount(code)*smooth(.45,.85,ny),k),value=toneChannel(base,k,r,land*steep,land*grassAmount(code)*(1-steep)*grassTintAt(x,z,500),0,1,0,1,code===5?1:0,soilNoise(x/43,z/43),detail);assert(Number.isFinite(value)&&value>=0&&value<=1);sum[code*3+k]+=encode(value);old[code*3+k]+=encode(base);
      const oldTint=[.015,-.005,-.02][k]*land*steep+[-.25,.3,-.15][k]*land*grassAmount(code)*(1-steep)*grassTintAt(x,z,500);
      const previous=Math.round(base*255)/255*(1+oldRelief+oldTint)*(1+(macro-.5)*.05*(code===5?1:0));
      beforeLuma+=encode(previous)*[.2126,.7152,.0722][k];afterLuma+=encode(value)*[.2126,.7152,.0722][k];
    }
    beforeSum[code]+=beforeLuma;afterSum[code]+=afterLuma;beforeSq[code]+=beforeLuma**2;afterSq[code]+=afterLuma**2;
  }
  for(let c=0;c<8;c++)if(counts[c])for(let k=0;k<3;k++)maxError=Math.max(maxError,Math.abs(sum[c*3+k]-old[c*3+k])/counts[c]);
  assert(maxError<=25);
  for(const c of [2,3,4,5,6,7])if(counts[c]>10){
    const before=Math.sqrt(Math.max(0,beforeSq[c]/counts[c]-(beforeSum[c]/counts[c])**2));
    const after=Math.sqrt(Math.max(0,afterSq[c]/counts[c]-(afterSum[c]/counts[c])**2));
    assert(after>=before*2,`class ${c} luma variation must at least double`);
    t.diagnostic(`class ${c} sRGB luma sigma before=${before.toFixed(3)} after=${after.toFixed(3)} ratio=${(after/before).toFixed(3)}`);
  }
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),start=performance.now(),owner=installGroundDetail(THREE,m,d);
  await owner.tone.ready;assert.equal(owner.tone.uniforms.uToneReady.value,1);
  assert(owner.tone.stats.bytes<=d.surface.byteLength*4);
  assert.equal(owner.tone.textures[0].image.data,d.ground);
  t.diagnostic(`tone preparation ${(performance.now()-start).toFixed(2)}ms including yields; max slice ${owner.tone.stats.maxSliceMs.toFixed(2)}ms; runtime bytes ${owner.tone.stats.bytes}`);
  owner.dispose();m.dispose();t.diagnostic(`maximum corrected natural-class mean shift ${maxError.toFixed(4)}/255 (tolerance 25)`);
});
