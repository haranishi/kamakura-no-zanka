import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { contactShadowChunk, softShadowEnabled, shadowRadiusMeters } from '../dist/valley/kamakura-shadow.js';
import { shadeColor, shadeSettings, SHADE_GLSL } from '../dist/valley/kamakura-post.js';
import { adaptPolicy } from '../dist/valley/kamakura-adapt.js';
import { KAMAKURA_TIMES } from '../dist/valley/kamakura-atmosphere.js';
const {createKamakuraAtmosphere}=await load('kamakura-atmosphere-view.js');
const {createKamakuraPost,POST_SHADERS}=await load('kamakura-post-view.js');
function balanced(code){
  const s=code.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,''), stack=[], directives=[];
  for(const c of s)if('({['.includes(c))stack.push(c);else if(')}]'.includes(c))assert.equal(stack.pop(),'({['[')}]'.indexOf(c)]);
  assert.equal(stack.length,0);
  for(const line of s.split('\n'))if(/^\s*#if(n?def)?\b/.test(line))directives.push(line);else if(/^\s*#endif\b/.test(line))assert(directives.pop());
  assert.equal(directives.length,0);
  assert(!/\b(?:float|vec[234]|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(s));
  assert(!/--\s*(?:\d|\.)|(?<![\w.])(?:\d+\.\d*|\.\d+|\d+)[a-df-zA-DF-Z_]\w*\s*\(/.test(s));
}
test('r180 PCFSoft footprint: 16 existing reads, at most +8, depth-scaled bounded radius; idempotent patch',()=>{
  const original=THREE.ShaderChunk.shadowmap_pars_fragment, patched=contactShadowChunk(original);
  const soft=original.split('#elif defined( SHADOWMAP_TYPE_PCF_SOFT )')[1].split('#elif defined( SHADOWMAP_TYPE_VSM )')[0];
  assert.equal((soft.match(/texture2DCompare\(/g)||[]).length,16); assert(!soft.includes('shadowRadius'));
  assert.match(original,/shadowCoord.xyz \/= shadowCoord.w/); assert.match(original,/unpackRGBAToDepth\( texture2D/);
  const added=patched.split('if(shadowRadius>1.5){')[1].split('} else {')[0];
  assert.equal((added.match(/texture2D\(/g)||[]).length,8); assert.equal((added.match(/texture2DCompare\(/g)||[]).length,16);
  assert.equal(contactShadowChunk(patched),patched); assert.throws(()=>contactShadowChunk(''),/boundary/);
  assert(patched.indexOf('dFdx(shadowCoord.xyz)')<patched.indexOf('if ( frustumTest )'));
  assert.match(added,/shadowCoord.z\+dot\(kzSlope,kzOffset\)/); // receiver-plane correction, no floating bias increase
  assert.equal(shadowRadiusMeters(0)*2,.016); assert.equal(shadowRadiusMeters(-5),.008);
  assert(Math.abs(shadowRadiusMeters(5)*2-.081)<1e-12); assert.equal(shadowRadiusMeters(10)*2,.14);
  let previous=0;for(let i=0;i<=1000;i++){const r=shadowRadiusMeters(i/20);assert(r>=previous&&r<=.07);previous=r;}
  assert.match(source('atmosphere.js'),/near: 1, far: 260/);assert.match(source('atmosphere.js'),/left: -46, right: 46/);
  balanced(patched); balanced(SHADE_GLSL); balanced(POST_SHADERS.final);
  for(const bad of ['float patch;','float x=0mix(1.);','float x=--0.2;','void x(){','0.2foo(1.)'])assert.throws(()=>balanced(bad));
});
test('light7 routes: light has no extra reads; stages 2/3 disable the widened footprint',()=>{
  for(const step of [0,1,2,3])assert.equal(softShadowEnabled('', 'standard',adaptPolicy(step)),step<2);
  assert(!softShadowEnabled('?light7=0'));assert(!softShadowEnabled('', 'light'));assert(!softShadowEnabled('', 'standard',{shadows:false}));
  assert(softShadowEnabled('?light7=1'));
});
const luma=c=>.2126*c[0]+.7152*c[1]+.0722*c[2];
const saturation=c=>Math.max(...c)>0?1-Math.min(...c)/Math.max(...c):0;
test('LG2 cooling: bounded channel shifts, unchanged luminance, no saturation increase; URL and bright neutrality',()=>{
  for(const time of ['noon','morning','evening'])assert.equal(KAMAKURA_TIMES[time].postShade,.15);
  for(const bad of ['','-1','2','NaN'])assert.equal(shadeSettings('?pshade='+bad).strength,.15);
  assert.equal(shadeSettings('?pshade=.4',{postShade:.8}).strength,.4);assert.equal(shadeSettings('',{postShade:.8}).strength,.8);
  assert.equal(shadeSettings('?pshade=0').strength,0);assert.equal(shadeSettings('?pshade=1&light7=0').strength,0);
  const settings=shadeSettings('?pshade=1'), out=[];
  for(let ri=0;ri<=16;ri++)for(let gi=0;gi<=16;gi++)for(let bi=0;bi<=16;bi++){
    const rgb=[ri/80,gi/80,bi/80];shadeColor(...rgb,settings,out);
    assert(out[0]>=rgb[0]*.98-1e-12&&out[0]<=rgb[0]);assert(out[2]>=rgb[2]&&out[2]<=rgb[2]*1.03+1e-12);
    assert(Math.abs(luma(out)-luma(rgb))<1e-12);assert(saturation(out)<=saturation(rgb)+1e-12);assert(out.every(x=>x>=0));
    if(luma(rgb)>=.12)assert.deepEqual(out,rgb);
  }
  let prior=1;for(let i=1;i<=120;i++){const rgb=[.001*i,.0006*i,.0003*i];shadeColor(...rgb,settings,out);const weight=(rgb[0]-out[0])/rgb[0];assert(weight<=prior+1e-12);prior=weight;}
});
test('LG3 dusk floor: zero by day, .0068 at black, smooth monotonic gray ramp; legacy is exact',()=>{
  const dusk=shadeSettings('?time=evening'), day=shadeSettings(''), off=shadeSettings('?time=evening&light7=0'), out=[];
  assert.equal(dusk.floor,.0068);assert.equal(day.floor,0);assert.equal(off.floor,0);
  shadeColor(0,0,0,dusk,out);assert(out.every(v=>v>=.006&&v<=.010));assert(out[2]>out[0]);
  let previous=0, priorLift=.0068;
  for(let i=0;i<=1000;i++){
    const x=i/1000;shadeColor(x,x,x,dusk,out);assert(out[2]>=previous);assert(out[2]-x<=priorLift+1e-12);
    previous=out[2];priorLift=out[2]-x;if(x>=.12)assert.deepEqual(out,[x,x,x]);
    shadeColor(x,.5*x,.25*x,off,out);assert.deepEqual(out,[x,.5*x,.25*x]);
  }
});
function stub(){let target=null;return {shadowMap:{enabled:false,type:THREE.BasicShadowMap},xr:{enabled:false},autoClear:true,toneMapping:THREE.NoToneMapping,toneMappingExposure:1,
  state:{buffers:{depth:{getReversed:()=>false}}},compile(){},getClearColor:c=>c.set(0),getRenderTarget:()=>target,
  getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,setRenderTarget(t){target=t;},render(scene){this.last=scene.children[0]?.material;},getDrawingBufferSize:v=>v.set(16,16)};}
test('real Three owners: legacy chunk byte identity, stage-2 return to original filter, disposal restoration and post uniforms',()=>{
  const original=THREE.ShaderChunk.shadowmap_pars_fragment;
  for(const args of [{search:'?light7=0'},{quality:'light'},{}]){
    const renderer=stub(),scene=new THREE.Scene(), c=createKamakuraAtmosphere({renderer,scene,...args});assert(c.atmosphere);
    const enhanced=!args.search&&!args.quality;
    assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment===original,!enhanced);
    assert.equal(c.atmosphere.sun.shadow.radius,enhanced?2:1);
    for(const step of [2,0,3,1]){c.setAdapt(adaptPolicy(step));assert.equal(c.atmosphere.sun.shadow.radius,enhanced&&step<2?2:1);}
    c.dispose();c.dispose();assert.equal(THREE.ShaderChunk.shadowmap_pars_fragment,original);
  }
  for(const search of ['?time=evening','?time=evening&light7=0','?pshade=.3']){
    const renderer=stub(),p=createKamakuraPost({renderer,search});p.render(new THREE.Scene(),new THREE.PerspectiveCamera());
    const u=renderer.last.uniforms, expected=shadeSettings(search);
    assert.equal(u.shadeStrength.value,expected.strength);assert.equal(u.shadeFloor.value,expected.floor);
    p.setAdapt(2);assert(!p.active);p.dispose();p.dispose();
  }
});
