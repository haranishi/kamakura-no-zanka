import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { THREE } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { installGroundSoil } from '../dist/valley/kamakura-ground-soil.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { grassAmount, smooth, soilNoise, soilGrain, soilFine, scatterFade, SOIL_GRAIN_GLSL } from '../dist/valley/kamakura-ground-pattern.js';
import { toneChannel, toneGrain, tonePebble, toneRelief, toneNearRelief, groundUseAt, groundUseBoxes } from '../dist/valley/kamakura-ground-tone-rules.js';
import { groundDetailChannel as detail } from './helpers/kamakura-ground-color.mjs';

const luma=[.2126,.7152,.0722],base=[.25,.27,.19];
const encode=v=>255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055);
const luminance=rgb=>rgb.reduce((s,v,k)=>s+encode(v)*luma[k],0);
const sigma=values=>{const mean=values.reduce((s,v)=>s+v,0)/values.length;return Math.sqrt(values.reduce((s,v)=>s+(v-mean)**2,0)/values.length);};
// Legacy SOIL_GLSL flat field: constant class => edge equals its class mean.
function legacySoil(x,z,d,code,px){
  const qx=x+Math.sin(z*.11)*.22,qz=z+Math.sin(x*.09)*.22;
  const patch=(soilNoise(qx/.75,qz/.75)*.55+soilNoise((.8*qx+.6*qz)/1.5,(-.6*qx+.8*qz)/1.5)*.45)*2-1;
  let broad=code===4?patch*.12:code===6?patch*.08:code===3?(soilNoise(qx/5,qz/5)*2-1)*.12:0;
  const cell=code===3?.09:code===6?.05:.06;
  let fine=code===2?0:soilGrain(qx,qz,cell)*(code===6?.8:.45)*soilFine(d,px,cell);
  if(code===4){
    const track=Math.sin(qz*8+Math.sin(qx*.18)*2+soilNoise(qx/9,qz/9));
    const crack=(1-smooth(.008,.025,Math.abs(Math.sin(qx*5+Math.sin(qz*2)))))*(soilNoise(qx,qz)>=.8?1:0);
    fine+=track*.035*soilFine(d,px,.4)+(.002-crack*.10)*soilFine(d,px,.025);
  }
  return 1+Math.max(-.28,Math.min(.28,broad+fine));
}
function colors(x,z,d,code,use=0,soil=1){
  const macro=soilNoise(x/43,z/43),relief=toneNearRelief(toneRelief(0,1,0,0,macro),x,z,d);
  return base.map((b,k)=>toneChannel(b,k,relief,0,0,use,1,toneGrain(x,z,d,.01),soil,0,macro,detail(x,z,d,grassAmount(code),k),tonePebble(x,z,d,.01)));
}
const points=()=>{const out=[];for(let j=0;j<120;j++)for(let i=0;i<120;i++)out.push([7+i*.0173,11+j*.0187]);return out;};

test('r3 actual shader stacks continuous tone -> legacy detail -> shared soil grain; no nearest path or late overwrite',async()=>{
  const d=fixture({width:9,height:9,cell:2});d.meta.surface={};d.meta.ground={};d.surface=new Uint8Array(81).fill(4);d.ground=new Uint8Array(243).fill(140);
  for(const search of ['', '?gsoil=0','?gtone=0']){
    const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,{search}),soil=installGroundSoil(THREE,m,owner,{search});
    await Promise.all([owner.tone?.ready,soil.ready]);
    const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);
    assert(s.fragmentShader.includes(SOIL_GRAIN_GLSL));
    if(owner.tone){
      const f=s.fragmentShader.slice(s.fragmentShader.indexOf('vec3 groundTone('),s.fragmentShader.indexOf('void main()'));
      assert(f.indexOf('vec3 result=mix(natural,yard')<f.indexOf('result*=groundGrassDetail'));
      assert(f.indexOf('result*=groundGrassDetail')<f.indexOf('result*=1.0+uToneSoil'));
      assert(f.includes('groundScatter(p,.08)'));assert(f.includes('grain*.8+pebble*.22*use'));
      assert(!f.includes('texture2D(uGroundSurface'));
      assert(s.fragmentShader.indexOf('vec3 groundGrassDetail(')<s.fragmentShader.indexOf('vec3 groundTone('));
    }else assert(s.fragmentShader.includes('grain=groundSoilGrain(q,cell)'));
    owner.dispose();soil.dispose();m.dispose();
  }
});

test('r3 near flat field preserves >=80% legacy luminance sigma at 2–12m, with soil on/off and inside/outside',t=>{
  const pts=points();
  for(const code of [2,4,6])for(const d of [2,5,8,12])for(const soil of [0,1]){
    const old=pts.map(([x,z])=>luminance(base.map((b,k)=>b*detail(x,z,d,grassAmount(code),k)*(soil?legacySoil(x,z,d,code,.01):1))));
    const before=sigma(old);
    for(const use of [0,1]){
      const after=sigma(pts.map(([x,z])=>luminance(colors(x,z,d,code,use,soil))));
      assert(after>=before*.8,`class=${code}, distance=${d}, soil=${soil}, use=${use}: ${after}/${before}`);
      if(d===5&&soil===1)t.diagnostic(`class=${code} use=${use}: old sigma=${before.toFixed(4)}, new=${after.toFixed(4)} sRGB luma/255; ratio=${(after/before).toFixed(3)}`);
    }
  }
  // Isolate grain: the previous replacement kernel had .18 amplitude vs the
  // legacy gravel's .8. A spatially fixed macro cannot hide this regression.
  const old=sigma(pts.map(([x,z])=>luminance(base.map(b=>b*(1+.8*soilGrain(x,z,.05))))));
  const previous=sigma(pts.map(([x,z])=>{
    const u=x/.09,v=z/.09,seed=soilNoise(Math.floor(u),Math.floor(v));
    const pebble=1-smooth(.15+(.32-.15)*seed,.44,Math.hypot(u-Math.floor(u)-.5,v-Math.floor(v)-.5));
    return luminance(base.map(b=>b*(1+(seed-.5)*pebble*.18)));
  }));
  assert(previous<old*.8);t.diagnostic(`r2 isolated grain regression sigma=${previous.toFixed(4)} vs legacy=${old.toFixed(4)} (ratio=${(previous/old).toFixed(3)})`);
});

test('r2 restrained gravel and source-hued packed earth and smooth distance/pixel integration',t=>{
  const pts=points(),outside=pts.map(([x,z])=>luminance(colors(x,z,5,4,0))),inside=pts.map(([x,z])=>luminance(colors(x,z,5,4,1)));
  const mean=v=>v.reduce((s,x)=>s+x,0)/v.length,sd=sigma(inside);
  const bright=inside.filter((_,i)=>tonePebble(...pts[i],5,.01)>.25);
  const contrast=mean(bright)-mean(inside);
  const rgb=use=>[0,1,2].map(k=>mean(pts.map(([x,z])=>encode(colors(x,z,5,4,use)[k]))).toFixed(3));
  assert(bright.length>pts.length*.01,'stones must occupy visible area');
  assert(contrast>0 && contrast<sd*2,'R2 small stones have restrained contrast');
  assert(mean(inside)-mean(outside)>3 && mean(inside)-mean(outside)<12,'R2 packed earth stays near the source colour');
  let maxJump=0;
  for(const [x,z] of pts.slice(0,240)){
    let last=Infinity;
    for(let d=0;d<=100;d+=.25){
      const amplitude=Math.abs(toneGrain(x,z,d,.01))+Math.abs(tonePebble(x,z,d,.01));
      // Independent signed scales may cancel; each scale envelope must still fade monotonically.
      for(const cell of [.08,.16,.24,.32])assert(scatterFade(x,z,d,.01,cell)<=scatterFade(x,z,Math.max(0,d-.25),.01,cell)+1e-12);last=amplitude;
      maxJump=Math.max(maxJump,...colors(x,z,d-.001,4,1).map((v,k)=>Math.abs(encode(v)-encode(colors(x,z,d+.001,4,1)[k]))));
    }
    assert.equal(Math.abs(toneGrain(x,z,400,.01)),0);assert.equal(Math.abs(tonePebble(x,z,400,.01)),0);
    assert.equal(Math.abs(toneGrain(x,z,5,.3)),0);assert.equal(Math.abs(tonePebble(x,z,5,.3)),0);
  }
  assert(maxJump<.01);
  t.diagnostic(`mean outside=${mean(outside).toFixed(4)}, inside=${mean(inside).toFixed(4)} sRGB luma/255; bright contrast=${contrast.toFixed(4)}, sigma=${sd.toFixed(4)}, ratio=${(contrast/sd).toFixed(3)}; .002m distance jump=${maxJump.toFixed(6)}/255`);
  t.diagnostic(`synthetic mean sRGB outside=[${rgb(0)}], inside=[${rgb(1)}] /255`);
});

test('r3 facility forecourt fills hall/gate gaps; torii apron follows the site axis and remains bounded',()=>{
  const node=(part,x,z,w=8,d=8)=>({part,facility:'synthetic',anchor_xz:[x,z],bbox_min:[-w/2,0,-d/2],bbox_max:[w/2,1,d/2]});
  for(const [dx,dz] of [[0,1],[0,-1],[1,0],[-1,0]]){
    const data={facilities:{nodes:[node('hall',0,0,24,24),node('torii',dx*40,dz*40)]}},boxes=groundUseBoxes(data);
    assert.equal(groundUseAt(boxes,dx*20,dz*20),1);
    assert.equal(groundUseAt(boxes,dx*48,dz*48),1);
    assert.equal(groundUseAt(boxes,dx*80,dz*80),0);
  }
});

test('r3 private URL locations and forward near field are covered by placement-derived use; CPU grid stays within r2',{
  skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有施設が必要'
},async t=>{
  const {data:d}=await readPrivateData(process.env.KZ_WORLD_DIR);
  d.surface=new Uint8Array(await readFile(join(process.env.KZ_WORLD_DIR,d.meta.surface.file)));
  d.facilities=JSON.parse(await readFile(join(process.env.KZ_WORLD_DIR,d.meta.facilities.file),'utf8'));
  const boxes=groundUseBoxes(d);
  // URL pos is east,north. Shader/catalog z is south. Only public brief
  // coordinates are literals; no catalog coordinates or counts are emitted.
  for(const [label,x,north] of [['11',-2200,-700],['12',-366,230]]){
    const z=-north;
    for(const forward of [0,2,8,12])assert.equal(groundUseAt(boxes,x,z-forward),1,`${label}: use must reach foreground`);
  }
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d);
  await owner.tone.ready;
  assert(owner.tone.stats.bytes<=22_759_200);
  // Check the actual prepared, bilinear texture as well as the exact catalog.
  const img=owner.tone.textures[1].image,span=owner.tone.uniforms.uToneWeightSpan.value;
  const terrain=createKamakuraTerrain(d);
  for(const [x,north] of [[-2200,-700],[-366,230]])for(const forward of [0,2,8,12]){
    const z=-north-forward,wx=x+1.6*(soilNoise(x/23,z/23)-.5),wz=z+1.6*(soilNoise((x+71)/23,(z-37)/23)-.5);
    const u=(wx/span.x+.5)*img.width-.5,v=(wz/span.y+.5)*img.height-.5,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j;
    const at=(i,j,c)=>img.data[(j*img.width+i)*4+c]/255;
    const weight=c=>(1-b)*((1-a)*at(i,j,c)+a*at(i+1,j,c))+b*((1-a)*at(i,j+1,c)+a*at(i+1,j+1,c));
    const amount=weight(2)*weight(3)*smooth(.55,.9,terrain.normalAt(x,z).y);
    assert(amount>.99,'prepared use texture must include foreground');
  }
  t.diagnostic(`11/12 and forward near field covered; additional CPU grid ${(owner.tone.stats.bytes/2**20).toFixed(2)} MiB; no catalog values emitted`);
  owner.dispose();m.dispose();
});
