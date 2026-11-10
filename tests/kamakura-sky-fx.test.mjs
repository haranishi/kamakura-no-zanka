import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { postOptions } from '../dist/valley/kamakura-post.js';
import { KAMAKURA_TIMES, atmosphereOptions, validateAtmosphere, kamakuraAtmosphere } from '../dist/valley/kamakura-atmosphere.js';
import { LIGHT_TIMES, CLOUD, SHAFT_TAPS, cloudDensity, cloudShadeWeight, cloudAttenuation, shaftVisibility, advanceCloudTime, lightSettings, lightFinalShader, SHAFT_SHADERS } from '../dist/valley/kamakura-sky-fx.js';
const { createKamakuraPost, POST_SHADERS }=await load('kamakura-post-view.js');
const digest=s=>createHash('sha256').update(s).digest('hex');
function stub() {
  let target=null,width=1280,height=720;
  const resources=new Map(),draws=[];
  function track(r) { if(!r || resources.has(r)) return; resources.set(r,0); r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1)); }
  return {toneMapping:THREE.NoToneMapping,toneMappingExposure:1,autoClear:false,resources,draws,
    getDrawingBufferSize:v=>v.set(width,height),size(w,h){width=w;height=h;},getRenderTarget:()=>target,
    setRenderTarget(t){target=t;if(t && !resources.has(t))t.addEventListener('dispose',()=>t.depthTexture?.dispose());track(t);track(t?.depthTexture);},
    render(s,c){s.traverse(o=>{track(o.geometry);track(o.material);}); draws.push({target,material:s.children[0]?.material,camera:c});},
  };
}
const camera=()=>new THREE.PerspectiveCamera(60,16/9,.15,10000);
const sun=()=>new THREE.Vector3(0,.2,-1).normalize();

test('R10 URL flags, time strengths and a shaft gate that lets the sun sit a little outside the frame',()=>{
  assert(postOptions('').shafts);assert(postOptions('').cloud);assert.equal(postOptions('?postdebug=bad').postdebug,'');
  for(const mode of ['depth','shafts','cloud'])assert.equal(postOptions('?postdebug='+mode).postdebug,mode);
  const off=postOptions('?shafts=0&cloud=0&mist=0&cloudhigh=0');assert(!off.shafts);assert(!off.cloud);
  assert.deepEqual(Object.values(LIGHT_TIMES).map(v=>[v.shafts,v.cloud]),[[.15,.3],[.5,.25],[.6,.25],[.7,.12]]);
  assert.equal(lightSettings('bad'),LIGHT_TIMES.noon);assert.equal(SHAFT_TAPS,24);
  assert.equal(shaftVisibility(.5,.5,1),1);
  // Rays still enter from the edge when the sun is just outside: full to 5 % outside, gone at 25 % outside.
  for(const [x,y] of [[-.04,.5],[1.04,.5],[.5,-.04],[.5,1.04],[0,.5]])assert.equal(shaftVisibility(x,y,1),1);
  for(const [x,y,s] of [[-.25,.5,1],[1.3,.5,1],[.5,-.26,1],[.5,1.4,1],[.5,.5,0]])assert.equal(shaftVisibility(x,y,s),0);
  const half=shaftVisibility(-.15,.5,1);assert(half>.4 && half<.6);
  let last=0;for(let i=-260;i<=80;i++){const v=shaftVisibility(i/1000,.5,1);assert(v>=last);last=v;}
});

test('golden is complete, normalized WSW at 21.74 degrees; R9 presets are unchanged',()=>{
  const old={noon:'0266810a94f125045eee358aa5f9b8ce774855d64bf4dc3516c19ee60c01ba92',morning:'6f2e74b53331c45672d895bfaa86dacc8dbabec49700fe8ad11115e384d4ebc5',evening:'53b43fa68cc9aa1e4d2988ce111160466d864e3981765a522f9edc7468cbcca3'};
  for(const t of Object.keys(old))assert.equal(digest(JSON.stringify(KAMAKURA_TIMES[t])),old[t]);
  assert.equal(atmosphereOptions('?time=golden').time,'golden');
  const g=validateAtmosphere(KAMAKURA_TIMES.golden);
  assert.deepEqual(Object.keys(g).sort(),Object.keys(KAMAKURA_TIMES.noon).sort());
  assert(Math.abs(Math.hypot(...g.sunDir)-1)<1e-12);assert(Math.abs(Math.asin(g.sunDir[1])*180/Math.PI-21.74)<.1);
  assert(g.sunDir[0]<0 && g.sunDir[2]>0);assert(Math.abs(g.sunDir[0])>g.sunDir[2]);
  const copied=kamakuraAtmosphere('golden',{});assert.equal(copied.hemiSky,g.hemiSky);
  for(const name of ['kamakura-sea-view.js','kamakura-water-view.js'])assert(source(name).includes('kamakuraAtmosphere(atmosphereOptions(search).time'));
  assert(source('world-kamakura.js').includes('atmosphere.atmosphere?.params'));
});

test('cloud field range, shadow cores over a fifth of the land, smooth edges, translation at 10m/s and a visible but bounded shade',t=>{
  let count=0,covered=0,cores=0,total=0,min=1,max=0,largestDelta=0;
  for(let z=-5000;z<5000;z+=25)for(let x=-5000;x<5000;x+=25){
    const d=cloudDensity(x,z,0);assert(d>=0 && d<=1);count++;covered+=d>0;cores+=d>.5;total+=d;min=Math.min(min,d);max=Math.max(max,d);
    largestDelta=Math.max(largestDelta,Math.abs(d-cloudDensity(x+.1,z,0)));
    assert(Math.abs(d-cloudDensity(x+100,z,10))<1e-12);
  }
  // A core (more than half the shade) covers 12 to 35 % of the land; the rest is sun or a wide soft edge.
  assert(cores/count>=.12 && cores/count<=.35,`cores ${cores/count}`);assert(total/count>=.12 && total/count<=.32,`mean ${total/count}`);
  assert.equal(min,0);assert(max>.95);assert(largestDelta<.01);
  for(const [x,z] of [[-137,92],[481,-238],[0,0]]) assert.equal(cloudDensity(x,z,4,0,1),cloudDensity(x,z-40,0,0,1));
  assert.equal(cloudShadeWeight(0),0);assert.equal(cloudShadeWeight(.06),0);assert.equal(cloudShadeWeight(.65),1);assert(cloudShadeWeight(.12)<.02);
  // A noon cloud core takes about 30 % off sunlit ground (it has to be seen); the mean over the land stays under 7 %.
  const maxChannelDrop=cloudAttenuation(1,.3,1)*1.03;
  assert(maxChannelDrop>.2 && maxChannelDrop<.4);
  assert(cloudAttenuation(total/count,.3,1)*(.2126*1.03+.7152+.0722*.82)<.07);
  assert.equal(advanceCloudTime(2,60000),2.1);assert.equal(advanceCloudTime(2,-1),2);assert.equal(advanceCloudTime(2,16),2.016);
  t.diagnostic(JSON.stringify({syntheticSamples:count,shadowArea:covered/count,coreArea:cores/count,meanDensity:total/count,maxDeltaPer10cm:largestDelta,
    maxLinearChannelDrop:maxChannelDrop,meanLinearGrayDrop:cloudAttenuation(total/count,.3,1)*(.2126*1.03+.7152+.0722*.82)}));
});

function expand(s){return s.replace(/#include <(\w+)>/g,(_,k)=>{assert.equal(typeof THREE.ShaderChunk[k],'string',k);return expand(THREE.ShaderChunk[k]);});}
function checkGLSL(s) {
  s=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');const stack=[],directives=[];
  for(const ch of s){if('([{'.includes(ch))stack.push(ch);else if(')]}'.includes(ch))assert.equal(stack.pop(),'([{'[')]}'.indexOf(ch)]);}assert.equal(stack.length,0);
  for(const line of s.split('\n')){if(/^\s*#if(?:n?def)?\b/.test(line))directives.push(line);else if(/^\s*#endif\b/.test(line))assert(directives.pop());}assert.equal(directives.length,0);
  assert(!/--\s*\d/.test(s));assert(!/\b\d+(?:\.\d*)?[A-Za-z_]\w*\s*\(/.test(s));
  assert(!/\b(?:float|int|bool|vec[234]|mat[234]|sampler2D)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(s));
  const usedUniforms=new Set();
  for(const m of s.matchAll(/uniform\s+\w+\s+([^;]+);/g))for(const n of m[1].split(','))usedUniforms.add(n.trim());
  // All light-related uniform references must have an explicit declaration in this variant.
  const known=['mistField','mistBounds','mistPixels','mistWind','mistReady','mistStrength','mistTime','mistHazeExp','mistCool','mistWarm','mistSun','cloudScale','depthTex','inverseProjection','cameraWorld','viewFar','lightDirection','cloudDirection','cloudTime','cloudStrength','shaftTex','shaftStrength','maskTex','depthPixel'];
  for(const n of known)if(new RegExp('\\b'+n+'\\b').test(s))assert(usedUniforms.has(n),n+' undeclared');
  return usedUniforms;
}

test('all light shader variants are balanced, uniforms supplied, no reserved identifiers (not GPU compile)',()=>{
  for(const shader of Object.values(SHAFT_SHADERS))checkGLSL(shader);
  for(const shafts of [0,1])for(const cloud of [0,1])for(const mist of [0,1])for(const high of [0,1])for(const debug of ['', 'depth','shafts','cloud','mist','valley']){
    const search=`?shafts=${shafts}&cloud=${cloud}&mist=${mist}&cloudhigh=${high}&postdebug=${debug}`;
    const r=stub(),p=createKamakuraPost({renderer:r,search,sunDir:sun(),terrain:{bounds:{minX:-512,maxX:512,minZ:-512,maxZ:512},heightAt:()=>20}});p.render(new THREE.Scene(),camera());
    for(const draw of r.draws)if(draw.material){const m=draw.material;const names=checkGLSL(m.fragmentShader);checkGLSL(expand(m.fragmentShader));checkGLSL(m.vertexShader);
      for(const name of names)assert(Object.hasOwn(m.uniforms,name),name+' missing value');}
    p.dispose();
  }
  for(const bad of ['void main(){float v=(1.;}','uniform float patch;','void main(){float v=1.--0.2;}','void main(){float v=0mix(0.,1.,.5);}','void main(){float v=cloudTime;}'])assert.throws(()=>checkGLSL(bad));
});

test('disabled route retains exact R9 final shader, five targets and six draws without depth',()=>{
  // Hash from the pre-R10 final shader, including its unchanged shade chunk.
  assert.equal(digest(POST_SHADERS.final),'c20d4d608e205c31c42de31706267a8e6936ef46108b333441df3717cb242a63');
  assert.equal(lightFinalShader(POST_SHADERS.final,postOptions('?shafts=0&cloud=0&mist=0&cloudhigh=0')),POST_SHADERS.final);
  const r=stub(),p=createKamakuraPost({renderer:r,search:'?shafts=0&cloud=0',sunDir:sun()});p.render(new THREE.Scene(),camera());
  assert.equal(p.targets.length,5);assert.equal(r.draws.length,6);assert.equal(p.targets[0].depthTexture,null);
  assert.equal(r.draws.at(-1).material.fragmentShader,POST_SHADERS.final);p.dispose();
  for(const count of r.resources.values())assert.equal(count,1);
});

test('MSAA Float depth and quarter-res shafts: +2 facing sun, +0 behind/outside, cloud alone +0',()=>{
  const r=stub(),p=createKamakuraPost({renderer:r,sunDir:sun()}),c=camera(),w=new THREE.Scene();
  p.render(w,c);assert.equal(r.draws.length,8);assert.equal(p.targets.length,7);
  assert.equal(p.targets[0].samples,4);assert.equal(p.targets[0].depthTexture.type,THREE.FloatType);
  assert.equal(p.targets[0].depthTexture.format,THREE.DepthFormat);assert.equal(p.targets[0].resolveDepthBuffer,true);
  for(const target of p.targets.slice(5)){assert.equal(target.width,320);assert.equal(target.height,180);assert.equal(target.samples,0);}
  const u=r.draws.at(-1).material.uniforms;assert(u.shaftStrength.value>0);
  assert(u.inverseProjection.value.equals(c.projectionMatrixInverse));assert(u.cameraWorld.value.equals(c.matrixWorld));
  c.rotation.y=Math.PI;r.draws.length=0;p.render(w,c);assert.equal(r.draws.length,6);assert.equal(u.shaftStrength.value,0);
  c.rotation.y=Math.PI/2;r.draws.length=0;p.render(w,c);assert.equal(r.draws.length,6);assert.equal(u.shaftStrength.value,0);p.dispose();
  const r2=stub(),p2=createKamakuraPost({renderer:r2,search:'?shafts=0',sunDir:sun()});p2.render(w,c);assert.equal(r2.draws.length,6);assert.equal(p2.targets.length,5);assert(p2.targets[0].depthTexture);p2.dispose();
});

test('depth inverse projection reconstructs synthetic 5m plane at near .15/far 10000',()=>{
  const c=camera();c.position.set(17,4,-9);c.rotation.y=.3;c.updateMatrixWorld();
  const pointView=new THREE.Vector3(.4,-.2,-5),pointWorld=pointView.clone().applyMatrix4(c.matrixWorld),ndc=pointWorld.clone().project(c);
  const depth=ndc.z*.5+.5,restored=new THREE.Vector4(ndc.x,ndc.y,depth*2-1,1).applyMatrix4(c.projectionMatrixInverse);
  restored.multiplyScalar(1/restored.w);assert(Math.abs(restored.z+5)<1e-10);restored.applyMatrix4(c.matrixWorld);
  assert(Math.hypot(restored.x-pointWorld.x,restored.y-pointWorld.y,restored.z-pointWorld.z)<1e-10);
});

test('resize, downgrade, light quality, dispose and debug release every depth/resource once',()=>{
  for(const search of ['','?shafts=0','?cloud=0','?shafts=0&cloud=0']) {
    const r=stub(),p=createKamakuraPost({renderer:r,search:search+(search?'&':'?')+'debug=1',sunDir:sun()});
    p.render(new THREE.Scene(),camera());const depth=p.targets[0].depthTexture;
    assert.equal(globalThis.__kzLight().depth,!!depth);
    r.size(390,844);p.resize();if(depth)assert.equal(r.resources.get(depth),1);
    p.render(new THREE.Scene(),camera());p.setAdapt(2);assert.equal(p.targets,null);assert(!globalThis.__kzLight().depth);assert(!globalThis.__kzLight().shafts.active);
    const count=r.resources.size;for(const step of [0,1,3,0]){p.setAdapt(step);p.render(new THREE.Scene(),camera());}assert.equal(r.resources.size,count);
    p.dispose();p.dispose();assert.equal(typeof globalThis.__kzLight,'undefined');for(const n of r.resources.values())assert.equal(n,1);
  }
  for(const args of [{quality:'light'},{search:'?post=0'}]){const r=stub(),p=createKamakuraPost({renderer:r,...args});p.render(new THREE.Scene(),camera());assert.equal(r.resources.size,0);p.dispose();}
});

test('1000 frames reuse targets, materials, matrices and vectors; clock clamps long/negative gaps',t=>{
  let stamp=1000;const r=stub(),p=createKamakuraPost({renderer:r,search:'?debug=1',sunDir:sun(),now:()=>stamp,cloudDirection:[0,1]}),w=new THREE.Scene(),c=camera();
  p.render(w,c);const targets=p.targets,material=r.draws.at(-1).material,u=material.uniforms;
  const refs=Object.fromEntries(Object.entries(u).map(([k,v])=>[k,v.value]));const resourceCount=r.resources.size;
  for(let i=0;i<1000;i++) {r.draws.length=0;stamp+=16;p.render(w,c);assert.equal(p.targets,targets);assert.equal(r.draws.at(-1).material,material);}
  assert.equal(r.resources.size,resourceCount);
  for(const [key,value] of Object.entries(refs))if(value && typeof value==='object')assert.equal(u[key].value,value,key);
  assert(Math.abs(globalThis.__kzLight().cloud.time-16)<1e-9);assert.equal(u.cloudDirection.value.x,0);assert.equal(u.cloudDirection.value.y,1);
  stamp+=60000;p.render(w,c);assert(Math.abs(globalThis.__kzLight().cloud.time-16.1)<1e-9);
  stamp-=1000;p.render(w,c);assert(Math.abs(globalThis.__kzLight().cloud.time-16.1)<1e-9);
  const renderBody=source('kamakura-post-view.js').split('render(world,view) {')[1].split('dispose(){')[0];assert(!/\bnew\s|\.clone\(|\.map\(/.test(renderBody));
  t.diagnostic(JSON.stringify({frames:1000,renderTargets:targets.length,trackedResources:resourceCount,drawsPerFacingFrame:8}));p.dispose();
});
