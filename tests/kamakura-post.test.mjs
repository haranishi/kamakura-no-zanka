import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { postOptions, postRoute, bloomSizes, projectSun, neutralGray, postMemory, neutralToneChunk, POST_DEFAULTS } from '../dist/valley/kamakura-post.js';
import { KAMAKURA_TIMES } from '../dist/valley/kamakura-atmosphere.js';
const { createKamakuraPost, POST_SHADERS }=await load('kamakura-post-view.js');
function stub(){
  let target=null;
  const draws=[],counts=new Map(); let width=1280,height=720;
  function track(r){if(!r||counts.has(r))return;counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));}
  return {toneMapping:THREE.NoToneMapping,toneMappingExposure:1,autoClear:false,draws,counts,
    getDrawingBufferSize:v=>v.set(width,height),size(w,h){width=w;height=h;},getRenderTarget:()=>target,
    setRenderTarget(t){target=t;track(t);},render(s,c){s.traverse(o=>{track(o.geometry);track(o.material);});draws.push({target,material:s.children[0]?.material,camera:c});},};
}
test('post URL routes, one-way downgrade, pyramid edge sizes and memory',()=>{
  assert.equal(postOptions('?tone=bad').tone,'neutral');
  for(const tone of ['none','aces','neutral','agx'])assert.equal(postOptions('?tone='+tone).tone,tone);
  assert.deepEqual(postOptions('?post=0&bloom=0&glare=0&tone=none'),{post:false,bloom:false,glare:false,tone:'none',toe:null,shafts:true,cloud:true,postdebug:''});
  for(const step of [0,1])assert(postRoute('standard',step,true));
  for(const args of [['light',0,true],['standard',2,true],['standard',3,true],['standard',0,false],['standard',0,true,true]])assert(!postRoute(...args));
  assert.deepEqual(bloomSizes(3,1),[[1,1],[1,1],[1,1]]);
  assert.deepEqual(bloomSizes(1280,720),[[640,360],[320,180],[160,90]]);
  assert.equal(postMemory(1280,720).bytes,59558400);
});
test('directional sun projection: front, behind, below horizon, margin, outside, bounded',()=>{
  const out={}; projectSun(0,.2,-1,.2,1,1,out);assert.equal(out.x,.5);assert.equal(out.y,.6);assert.equal(out.strength,1);
  for(const [x,y,z,e] of [[0,0,1,1],[0,0,-1,0],[0,0,-1,-1],[3,0,-1,1],[0,3,-1,1]]){projectSun(x,y,z,e,1,1,out);assert.equal(out.strength,0);}
  projectSun(1.1,0,-1,1,1,1,out);assert(out.strength>0&&out.strength<1);
  for(let x=-3;x<=3;x+=.01){projectSun(x,0,-1,.01,1,1,out);assert(out.strength>=0&&out.strength<=1);}
});
test('neutral synthetic gray ramp preserves black, is monotonic and has an unclipped shoulder',t=>{
  assert.equal(neutralGray(0),0);let last=0,white=0,black=0;
  for(let i=1;i<=4096;i++){const y=neutralGray(i/1024);assert(y>=last);assert(y<1);if(y>=.999)white++;if(y<=.00001)black++;last=y;}
  assert.equal(white,0);assert.equal(black,1);assert(neutralGray(.01)>.0005);assert(neutralGray(4)>.98);
  let gradedLast=0;
  for(let i=0;i<=4096;i++){const c=neutralGray(i/1024), a=c**1.025, graded=a/Math.max(a+(1-c)**1.025,1e-8);assert(graded>=gradedLast&&graded<1);gradedLast=graded;}
  t.diagnostic(JSON.stringify({whiteRate:white/4096,blackRate:black/4096,gray18:neutralGray(.18),highlight4:neutralGray(4)}));
});
test('real Three HDR targets, 5 passes, resize disposal, downgrade latch, state restore',()=>{
  const r=stub(),p=createKamakuraPost({renderer:r,search:'?shafts=0&cloud=0',sunDir:new THREE.Vector3(0,.2,-1)}),world=new THREE.Scene(),camera=new THREE.PerspectiveCamera(60,16/9,.1,1000);
  assert.equal(r.toneMapping,THREE.NoToneMapping); p.resize();const old=[...p.targets];
  for(const t of old){assert.equal(t.texture.type,THREE.HalfFloatType);assert.equal(t.samples,t===old[0]?4:0);}
  p.render(world,camera);assert.equal(r.draws.length,6);assert.equal(r.getRenderTarget(),null);assert.equal(r.autoClear,false);
  const uniforms=r.draws.at(-1).material.uniforms; assert(uniforms.glareStrength.value>0);assert.equal(uniforms.toneMode.value,2);
  r.size(390,844);p.resize(); for(const t of old)assert.equal(r.counts.get(t),1);
  p.render(world,camera);p.setAdapt(2);assert.equal(p.targets,null);assert(!p.active);assert.equal(r.toneMapping,THREE.NeutralToneMapping);
  const seen=r.counts.size;for(const step of [1,0,3,0]){p.setAdapt(step);p.resize();p.render(world,camera);}assert.equal(r.counts.size,seen);
  p.dispose();p.dispose();for(const count of r.counts.values())assert.equal(count,1);
  assert.equal(r.toneMapping,THREE.NoToneMapping);assert.equal(r.toneMappingExposure,1);
});
test('light/post=0 allocate no post resources; bloom/glare switches and all tones',()=>{
  for(const args of [{quality:'light'},{search:'?post=0'}]){const r=stub(),p=createKamakuraPost({renderer:r,...args});p.resize();p.render(new THREE.Scene(),new THREE.Camera());assert.equal(p.targets,null);assert.equal(r.counts.size,0);p.dispose();}
  for(const tone of ['none','aces','neutral','agx']){
    const r=stub(),p=createKamakuraPost({renderer:r,search:'?tone='+tone+'&bloom=0&glare=0&shafts=0&cloud=0',sunDir:new THREE.Vector3(0,.2,-1)});
    p.render(new THREE.Scene(),new THREE.PerspectiveCamera());assert.equal(r.draws.length,2);
    assert.equal(r.draws.at(-1).material.uniforms.bloomStrength.value,0);assert.equal(r.draws.at(-1).material.uniforms.glareStrength.value,0);p.dispose();
  }
});
function expand(s){return s.replace(/#include <(\w+)>/g,(_,k)=>{assert.equal(typeof THREE.ShaderChunk[k],'string',k);return expand(THREE.ShaderChunk[k]);});}
function balanced(s){
  s=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');const stack=[];
  for(const ch of s){if('([{'.includes(ch))stack.push(ch);else if(')]}'.includes(ch))assert.equal(stack.pop(),'([{'[')]}'.indexOf(ch)]);}
  assert.equal(stack.length,0);
  const directives=[];for(const line of s.split('\n')){if(/^\s*#if(n?def)?\b/.test(line))directives.push(line);else if(/^\s*#endif\b/.test(line))assert(directives.pop());}assert.equal(directives.length,0);
  assert(!/\b(?:float|int|vec[234]|sampler2D)\s+(?:patch|sample|input|output|filter|common|partition|active|namespace|using)\b/.test(s));
}
test('GLSL includes resolve; all shader delimiters and conditionals balance; reserved identifiers absent (not GPU compile)',()=>{
  for(const shader of Object.values(POST_SHADERS)){balanced(shader);balanced(expand(shader));}
  const r=stub(),p=createKamakuraPost({renderer:r});p.render(new THREE.Scene(),new THREE.PerspectiveCamera());
  for(const draw of r.draws)if(draw.material){balanced(draw.material.vertexShader);balanced(expand(draw.material.fragmentShader));}p.dispose();
  assert.match(POST_SHADERS.final,/#include <tonemapping_pars_fragment>/);assert.match(POST_SHADERS.final,/#include <colorspace_fragment>/);
  for(const bad of ['void main(){ float x=(1.0; }','void main(){}}','uniform float patch;'])assert.throws(()=>balanced(bad));
  // Three's prefix supplies colorspace helpers, but no tone chunk for NoToneMapping.
  assert.match(THREE.WebGLRenderer.toString(),/this.toneMapping=\w+,this.toneMappingExposure=1/);
  assert.match(source('world-kamakura.js'),/post.render\(scene, camera\)/);
  for(const file of ['main.js','game.js'])assert(!source(file).includes('kamakura-post'));
});

// W2c-10 grade: three's Neutral operator subtracts x-6.25x^2 (up to .04) from every channel. In shade that strips the smallest channel,
// so shadows turn dark, green and over-saturated. The factor is scaled by the time-of-day preset (a blind A/B on 11/8 preferred .6 by day
// and the unchanged operator at dusk) and by &ptoe=.
test('Neutral toe: pure idempotent chunk patch, bounded URL option, presets and a monotonic scaled transfer',()=>{
  const chunk=THREE.ShaderChunk.tonemapping_pars_fragment,one=neutralToneChunk(chunk,1),six=neutralToneChunk(chunk,.6);
  assert(one.includes('color -= offset * 1.0000;'));assert(six.includes('color -= offset * 0.6000;'));
  assert.equal(six.replace('0.6000','1.0000'),one);
  assert.equal(neutralToneChunk(six,.25),neutralToneChunk(chunk,.25));
  assert.equal(neutralToneChunk(chunk,2),one);assert.equal(neutralToneChunk(chunk,-1),neutralToneChunk(chunk,0));
  assert.throws(()=>neutralToneChunk('vec3 other(){}',1));assert.throws(()=>neutralToneChunk('vec3 NeutralToneMapping( vec3 color ) { return color; }',1));
  assert.equal(postOptions('').toe,null);assert.equal(postOptions('?ptoe=.4').toe,.4);assert.equal(postOptions('?ptoe=0').toe,0);assert.equal(postOptions('?ptoe=1').toe,1);
  for(const bad of ['?ptoe=2','?ptoe=-1','?ptoe=x','?ptoe='])assert.equal(postOptions(bad).toe,null);
  assert.equal(POST_DEFAULTS.toe,.6);
  assert.equal(KAMAKURA_TIMES.noon.postToe,.6);assert.equal(KAMAKURA_TIMES.morning.postToe,.6);assert.equal(KAMAKURA_TIMES.evening.postToe,1);
  // The pure mirror: toe=1 is the shipped operator; a smaller toe lifts darks, keeps black at 0 and stays monotonic with an unclipped shoulder.
  assert.equal(neutralGray(.02),neutralGray(.02,1,1));assert(neutralGray(.02,1,.6)>neutralGray(.02,1,1));assert.equal(neutralGray(0,1,.6),0);
  let last=0;for(let i=1;i<=4096;i++){const y=neutralGray(i/1024,1,.6);assert(y>=last);assert(y<1);last=y;}
  assert(neutralGray(4,1,.6)>.98);
});
test('post owner patches the global tone chunk (preset or URL) before any program compiles and restores it on dispose',()=>{
  const before=THREE.ShaderChunk.tonemapping_pars_fragment;
  for(const [args,expect] of [[{params:{postToe:.6}},'0.6000'],[{params:{postToe:1}},'1.0000'],[{params:{postToe:1},search:'?ptoe=.3'},'0.3000'],[{params:{}},'0.6000'],[{quality:'light',params:{postToe:.6}},'0.6000']]){
    const r=stub(),p=createKamakuraPost({renderer:r,...args});
    assert(THREE.ShaderChunk.tonemapping_pars_fragment.includes(`color -= offset * ${expect};`),expect);
    p.dispose();p.dispose();assert.equal(THREE.ShaderChunk.tonemapping_pars_fragment,before);
  }
});
