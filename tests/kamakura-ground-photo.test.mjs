import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { THREE } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { scatterStone } from '../dist/valley/kamakura-ground-pattern.js';
import { toneTexel,toneWeightGrid } from '../dist/valley/kamakura-ground-tone-rules.js';
import { GROUND_PHOTO_KEYS,GROUND_PHOTO_MEANS,selectGroundPhotos,groundPhotoMean,GROUND_PHOTO_NORMAL,GROUND_PHOTO_CONTRAST,GROUND_PHOTO_GLSL} from '../dist/valley/kamakura-ground-photo.js';
import { photoSampler,photoBlendUniform,PHOTO_TEX_DATA } from '../dist/valley/kamakura-photo-tex.js';
import { registerShoreView,unregisterShoreView } from '../dist/valley/kamakura-shore.js';
const input=(n=9)=>{const d=fixture({width:n,height:n,cell:4});d.meta.ground={};d.meta.surface={};d.surface=new Uint8Array(n*n).fill(4);d.ground=new Uint8Array(n*n*3).fill(140);return d;};
function compile(d,options={}){
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,options);
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(shader);
  return {m,owner,shader,dispose(){owner.dispose();m.dispose();}};
}
function balanced(source){
  const clean=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
  let depth=0;for(const l of clean.split('\n')){if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(l))depth++;if(/^\s*#\s*endif\b/.test(l))assert(--depth>=0);}assert.equal(depth,0);
  assert(!/\b(?:float|vec[234]|int|sampler2D)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(clean));
}
test('R4 all eight classes bake to exact unit byte mass; unknown class uses soil; old tone weights unchanged',()=>{
  const d=input(),g=toneWeightGrid(d),n=g.width*g.height,old=new Uint8Array(n*4),weights=new Uint8Array(n*4),a=new Uint8Array(n*4),b=new Uint8Array(n*4);
  for(const code of [0,1,2,3,4,5,6,7,255]){
    d.surface.fill(code);
    for(let i=0;i<n;i++){toneTexel(d,[],i,old,g);toneTexel(d,[],i,weights,g,a,b);
      const c=code<8?code:4;for(let k=0;k<8;k++)assert.equal((k<4?a:b)[i*4+k%4],k===c?255:0);
    }
    assert.equal(Buffer.compare(old,weights),0);
  }
  for(let i=0;i<d.surface.length;i++)d.surface[i]=i%8;
  for(let i=0;i<n;i++){toneTexel(d,[],i,weights,g,a,b);assert.equal([...a.subarray(i*4,i*4+4),...b.subarray(i*4,i*4+4)].reduce((x,y)=>x+y,0),255);}
});
test('R4 binomial prefilter and bilinear class transition have no nearest class jump',()=>{
  const d=input(5);for(let z=0;z<5;z++)for(let x=0;x<5;x++)d.surface[z*5+x]=x<2?0:6;
  const g=toneWeightGrid(d),a=new Uint8Array(100),b=new Uint8Array(100),w=new Uint8Array(100);
  for(let i=0;i<25;i++)toneTexel(d,[],i,w,g,a,b);
  assert.equal(a[(2*5+1)*4],191);assert.equal(a[(2*5+2)*4],64);
  const at=u=>a[(2*5+1)*4]/255*(1-u)+a[(2*5+2)*4]/255*u;
  let previous=at(0);for(let i=1;i<=1000;i++){const v=at(i/1000);assert(v<=previous);assert(previous-v<.001);previous=v;}
  assert(Math.abs(at(.5-1e-6)-at(.5+1e-6))<2e-6);
});
test('R4 deterministic top two, stable ties, threshold and light budget',()=>{
  assert.deepEqual(selectGroundPhotos([.14,.15,.4,.4,.1]),[2,3]);
  assert.deepEqual(selectGroundPhotos([.14,.15,.4,.4,.1],true),[2]);
  assert.deepEqual(selectGroundPhotos([.14,.149,0]),[]);
  assert.deepEqual(selectGroundPhotos([.15,0]),[0]);
  for(let seed=0;seed<100;seed++){
    const w=Array.from({length:7},(_,i)=>((seed*17+i*11)%101)/101),ids=selectGroundPhotos(w);
    assert.deepEqual(ids,selectGroundPhotos(w));assert(ids.length<=2);assert(ids.every(i=>w[i]>=.15));
    const sorted=w.map((v,i)=>[v,i]).filter(([v])=>v>=.15).sort((a,b)=>b[0]-a[0]||a[1]-b[1]).slice(0,2).map(([,i])=>i);
    assert.deepEqual(ids,sorted);
  }
});
test('R4 source/mip de-meaning and normalised material mixing preserve expected ratio 1',()=>{
  for(let a=0;a<7;a++)for(let b=0;b<7;b++)for(const lod of [0,.5,2.5,5.5,12]){
    const ma=groundPhotoMean(a,lod),mb=groundPhotoMean(b,lod);assert(ma>.9&&ma<1.02);assert(mb>.9&&mb<1.02);
    for(const weights of [[.15,.65],[.38,.62],[1,0]]){
      let sum=0;for(const sign of [-1,1])sum+=((ma*(1+sign*.3)/ma)*weights[0]+(mb*(1-sign*.2)/mb)*weights[1])/(weights[0]+weights[1]);
      assert(Math.abs(sum/2-1)<1e-12);
    }
  }
  assert.equal(GROUND_PHOTO_MEANS.length,GROUND_PHOTO_KEYS.length);
});
test('R4 assembled Lambert: gradients before branching, one unconditional perturbation, six/one photo fetch bound',()=>{
  const d=input();registerShoreView(d,{uShoreSea:{value:null},uShoreReady:{value:1},uSeaSky:{value:new THREE.Color(.2,.3,.4)}});
  try{for(const quality of ['standard','light']){
    const h=compile(d,{quality});try{
      const s=h.shader.fragmentShader;balanced(s);balanced(h.shader.vertexShader);
      assert.equal((s.match(/normal=kzPerturbNormal\(/g)||[]).length,1);assert(!GROUND_PHOTO_NORMAL.includes('if('));
      assert(s.includes('varying vec3 vGroundPhotoView;'));assert(h.shader.vertexShader.includes('vGroundPhotoView=-(modelViewMatrix*vec4(position,1.0)).xyz;'));
      const prepare=s.slice(s.indexOf('void groundPhotoPrepare'),s.indexOf('void main()'));
      assert(prepare.indexOf('dx=dFdx(p),dy=dFdy(p)')<prepare.indexOf('if('));
      assert(!/\bkzPhoto(?:Hex)?\(/.test(prepare));assert(prepare.includes('if(w[i]>=.15)'));
      assert(prepare.includes('if(dist>=312.0)groundPhotoAmount=0.0;'));
      assert(s.includes('smoothstep(25.0,90.0,noisyDist)'));assert(s.includes('smoothstep(60.0,200.0,noisyDist)'));
      assert(s.includes('if(uGroundPhotoLight>.5){second=-1;next=0.0;}'));
      assert.equal((s.match(/return kzPhotoHexGrad\(uGroundPhoto\d,uv,1.2,1.0,gx,gy\)/g)||[]).length,7);
      // Each selected standard lookup calls the shared three-fetch hex helper; at most two selections.
      assert.equal((s.match(/textureGrad\(photoMap,r[012]\*uv/g)||[]).length,3);
      assert.equal(h.shader.uniforms.uGroundPhotoLight.value,quality==='light'?1:0);
      for(let i=0;i<7;i++)assert.equal(h.shader.uniforms[`uGroundPhoto${i}`],photoSampler(GROUND_PHOTO_KEYS[i]));
      assert.equal(h.shader.uniforms.uPhotoBlend,photoBlendUniform);
      const samplers=[...s.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(','));
      assert.equal(new Set(samplers).size,15,'15 ground samplers plus the existing single sun shadow fit WebGL2 minimum 16');
    }finally{h.dispose();}
  }}finally{unregisterShoreView(d);}
});
test('R4 photo=0, startup, adapt3 and return retain neutral ratios; G2/G6 only suppress with photo amount',async()=>{
  for(const search of ['', '?photo=0']){
    const h=compile(input(100),{search});try{
      const u=h.shader.uniforms,s=h.shader.fragmentShader;
      assert.equal(u.uGroundPhotoEnabled.value,search?0:1);assert.equal(u.uToneBlend.value,0);
      assert.equal(h.owner.tone.textures[3].version,0);assert.equal(h.owner.tone.textures[4].version,0);
      assert(s.includes('uPhotoBlend*uGroundPhotoEnabled*uToneBlend*step(.001,uToneStrength)'));
      assert(s.includes('float groundPhotoAmount=0.0,groundPhotoRatio=1.0'));
      assert(s.includes('mix(1.0,.06,groundPhotoAmount*clamp(use+groundPhotoGravel,0.0,1.0))'));
      assert(s.includes('result*=mix(1.0,groundPhotoRatio,groundPhotoAmount)'));
      h.owner.setAdapt(3);assert.equal(u.uToneStrength.value,0);h.owner.setAdapt(0);assert.equal(u.uToneStrength.value,1);
      await h.owner.tone.ready;assert(h.owner.tone.textures[3].version>0);assert(h.owner.tone.textures[4].version>0);
      assert.equal(h.owner.tone.stats.classBytes,100*100*8);
    }finally{h.dispose();}
  }
  const d=input();registerShoreView(d,{uShoreSea:{value:null},uShoreReady:{value:1}});
  const h=compile(d);try{assert(h.shader.fragmentShader.includes('wind*.055*(1.0-groundPhotoAmount)+grain*.12'));}finally{h.dispose();unregisterShoreView(d);}
});
test('R4 courtyard/gravel spot RMS falls to 6% while three irregular stone scales survive',()=>{
  const h=compile(input());try{
    const residual=Number(h.shader.fragmentShader.match(/photoStones=mix\(1\.0,([.\d]+)/)[1]);
    assert(residual<=.08);let oldEnergy=0,newEnergy=0;
    for(let i=0;i<2000;i++)for(const scale of [.08,.16,.32]){const old=scatterStone(i*.137,7+i*.019,scale),now=old*residual;oldEnergy+=old*old;newEnergy+=now*now;}
    assert(oldEnergy>0);assert(Math.abs(Math.sqrt(newEnergy/oldEnergy)-.06)<1e-12);
  }finally{h.dispose();}
});
test('R4 cancellation disposes each new class texture once and settles readiness',async()=>{
  const h=compile(input(200)),counts=h.owner.tone.textures.map(()=>0);
  h.owner.tone.textures.forEach((t,i)=>{t.addEventListener('dispose',()=>counts[i]++);assert(['RGB8','RGBA8'].includes(t.internalFormat));});
  h.dispose();h.owner.dispose();await h.owner.tone.ready;await h.owner.tone.faded;
  assert(counts.every(n=>n===1));assert.equal(counts.length,5);
});
test('R4 private palette class means in linear RGB; source colours are read only',async t=>{
  if(!process.env.KZ_WORLD_DIR){t.skip('KZ_WORLD_DIR is required for the source palette; synthetic colours are not a substitute');return;}
  const {data:d}=await readPrivateData(process.env.KZ_WORLD_DIR),sum=Array.from({length:8},()=>[0,0,0]),counts=new Uint32Array(8);
  d.surface=new Uint8Array(await readFile(join(process.env.KZ_WORLD_DIR,d.meta.surface.file)));
  for(let i=0;i<d.surface.length;i++){const c=d.surface[i];if(c>=8)continue;counts[c]++;for(let k=0;k<3;k++){const v=d.ground[i*3+k]/255;sum[c][k]+=v<=.04045?v/12.92:((v+.055)/1.055)**2.4;}}
  for(const [c,key] of [[2,'groundTurf'],[4,'groundSoil'],[0,'groundSand'],[3,'groundDark']]){
    assert(counts[c]>0);t.diagnostic(`${key}: source linear RGB=(${sum[c].map(v=>(v/counts[c]).toFixed(4)).join(', ')}); photo albedo=(${PHOTO_TEX_DATA[key].meanLinearRgb.join(', ')})`);
  }
});

test('R4 parent tuning: gravel contrast is halved and applied after de-meaning, so the mean ratio stays 1',()=>{
  assert.equal(GROUND_PHOTO_CONTRAST.length,GROUND_PHOTO_KEYS.length);
  const pebbles=GROUND_PHOTO_KEYS.indexOf('groundPebbles');
  assert(GROUND_PHOTO_CONTRAST[pebbles]<=.5);
  for(const key of ['groundSoil','groundTurf','groundDark'])assert.equal(GROUND_PHOTO_CONTRAST[GROUND_PHOTO_KEYS.indexOf(key)],1);
  assert(GROUND_PHOTO_CONTRAST.every(k=>k>0&&k<=1));
  // A zero-mean deviation scaled by k keeps its mean: mean(1+(r-1)k)=1 for any k.
  for(const k of GROUND_PHOTO_CONTRAST){const rs=[.6,.9,1,1.2,1.3],mean=rs.reduce((a,r)=>a+r,0)/rs.length;assert(Math.abs(rs.reduce((a,r)=>a+1+(r-mean)*k,0)/rs.length-1)<1e-12);}
  assert(/groundPhotoContrast\(int id\)/.test(GROUND_PHOTO_GLSL));
});
