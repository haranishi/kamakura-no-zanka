import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { shotOverride } from '../dist/valley/shots.js';
import { MIST3, bakeMistField, mistFieldAt, marchMist, mistProfile, mistStepAlpha, mistInterval, mistJitter, mistSteps, mistHeightBounds, MIST3_AMOUNT_GLSL } from '../dist/valley/mist-field.js';
const { Post, MIST3_FRAGMENT } = await load('post.js');
const { buildRidges } = await load('ridges.js');
const { ATMOS } = await load('atmosphere.js');
const terrain = createTerrain();
let samples = 0;
const started = performance.now(), map = bakeMistField(WORLD, { ...terrain, heightAt(x,z) { samples++; return terrain.heightAt(x,z); } });
const bakeMs = performance.now() - started;

// Four neighbours; only regions with >=30 cells and >=10 cells inside the actual fixed camera count.
function basinComponents() {
  const view = shotOverride('concept',terrain), camera = new THREE.PerspectiveCamera(view.fov,16/9,.15,2200);
  camera.position.set(...view.pos); camera.lookAt(...view.look); camera.updateMatrixWorld();
  const visited = new Uint8Array(65536), parts = [], p = new THREE.Vector3();
  for(let k=0;k<visited.length;k++) {
    if(visited[k] || map.kinds[k]!==1 || map.data[k*4+1]<=MIST3.threshold)continue;
    const queue=[k]; visited[k]=1;let visible=0,minX=Infinity,maxX=-Infinity,minZ=Infinity,maxZ=-Infinity;
    for(let at=0;at<queue.length;at++) {
      const cell=queue[at],i=cell%256,j=Math.floor(cell/256);
      minX=Math.min(minX,i);maxX=Math.max(maxX,i);minZ=Math.min(minZ,j);maxZ=Math.max(maxZ,j);
      p.set(map.x0+(i+.5)*map.step,map.data[cell*4]+map.data[cell*4+2],map.z0+(j+.5)*map.step).project(camera);
      if(Math.abs(p.x)<1&&Math.abs(p.y)<1&&p.z>-1&&p.z<1)visible++;
      for(const n of [i?cell-1:-1,i<255?cell+1:-1,cell-256,cell+256]) {
        if(n<0||n>=65536||visited[n]||map.kinds[n]!==1||map.data[n*4+1]<=MIST3.threshold)continue;
        visited[n]=1;queue.push(n);
      }
    }
    if(queue.length>=30&&visible>=10)parts.push({cells:queue.length,visible,span:Math.max(maxX-minX+1,maxZ-minZ+1)*map.step});
  }
  return parts;
}

test('one deterministic 256 square map samples terrain once per cell and occupies 6 to 22 percent', t => {
  assert.equal(samples,65536);assert.equal(map.data.length,65536*4);
  assert(map.stats.occupiedFraction>=.06&&map.stats.occupiedFraction<=.22);
  assert.equal(Object.values(map.stats.area).reduce((a,b)=>a+b,0),map.stats.occupiedFraction*1280**2);
  assert(Object.values(map.stats.area).every(a=>a>0));assert(map.data.every(Number.isFinite));
  const second=bakeMistField(WORLD,terrain);assert.deepEqual(map.data,second.data);
  const parts=basinComponents();assert(parts.length>=6&&parts.length<=12,JSON.stringify(parts));
  assert(parts.every(p=>p.span>=60&&p.span<=180),JSON.stringify(parts));
  t.diagnostic(JSON.stringify({...map.stats,bakeMs,basinComponents:parts}));
});

test('village margin, terraces, temple and road treads are clear; bridge and sightline remain thin', () => {
  const f=(x,z)=>mistFieldAt(WORLD,terrain,x,z);
  for(const [x,z] of [[0,4],[65,4],[-60,60],[45,100],[-98,-86],[-36,-48],[60,6]])assert.equal(f(x,z).strength,0,`${x},${z}`);
  for(const [x,z] of [[128.4,-44.5],[120,8],[112,-26]])assert(f(x,z).strength<=.08,JSON.stringify(f(x,z)));
  for(let x=-135;x<=102;x+=10)for(let z=-135;z<=112;z+=10){const field=f(x,z);assert(field.strength<=.5);assert(['river','forest'].includes(field.kind),JSON.stringify(field));}
  assert(f(130,-280).strength>0);assert(f(138,420).strength>0);
  const basinIndex=map.kinds.findIndex((kind,i)=>kind===1&&map.data[i*4+1]>.15);assert(basinIndex>=0);
  const x=map.x0+(basinIndex%256+.5)*5,z=map.z0+(Math.floor(basinIndex/256)+.5)*5;
  assert(f(x,z).strength>0);assert.deepEqual(f(x,z),f(x,z));
});

const constantField = () => ({ g: 0, lift: 0, thick: 20, strength: 1 });
const ray = overrides => marchMist({ origin: [0, 10, 0], direction: [1, 0, 0], bounds: [0, 24], sample: constantField, ...overrides });

test('ray integration has soft vertical edges, physical extinction, monotonic length and density, and a shared cap for light', t => {
  for (const steps of [14, 20, 28]) {
    assert.equal(ray({ origin:[0,30,0], steps }).amount,0);
    assert.equal(ray({ distance:25, steps }).amount,0);
    assert.equal(ray({ sigma:0, steps }).amount,0);
    assert.equal(ray({ thicknessScale:0, steps }).amount,0);
    const a=ray({ origin:[0,8,0], bounds:[0,24], distance:160, steps, pixel:[9,16] });
    // 55..115m is a full-density 60m path: 1-exp(-0.012*60) ~= 0.513.
    const sixty=ray({origin:[0,8,0],distance:115,steps, bounds:[0,24], sample:p=>({...constantField(),strength:p[0]>=55?1:0})});
    assert(Math.abs(sixty.amount-(1-Math.exp(-MIST3.sigma*60)))<.04);
    let last=0;for(const distance of [25,55,100,160,300,650]){const r=ray({distance,steps});assert(r.amount>=last-1e-12);last=r.amount;}
    last=0;for(const sigma of [0,.002,.006,.012,.03,1]){const r=ray({distance:160,sigma,steps});assert(r.amount>=last-1e-12);assert(r.amount<=MIST3.maxOpacity+1e-12);last=r.amount;}
    assert.equal(ray({sigma:1,steps}).amount,MIST3.maxOpacity);
    assert(a.amount>0);assert(a.scattering.every(v=>Math.abs(v-a.amount)<1e-12));
  }
  assert.equal(mistProfile(-1,20,1),0);assert.equal(mistProfile(0,20,1),0);assert.equal(mistProfile(21,20,1),0);
  assert(mistProfile(1,20,1)<mistProfile(6,20,1));assert(mistProfile(19,20,1)<mistProfile(12,20,1));
  assert.equal(mistProfile(0,0,1),0);
  t.diagnostic(JSON.stringify({opacity60m:1-Math.exp(-MIST3.sigma*60),standardSteps:mistSteps(),lightSteps:mistSteps('light')}));
});

test('surfaces just behind and far behind the fog receive equal haze; foreground remains clear', () => {
  // Downward ray exits a horizontal fog slab at t=100. Both opaque surfaces lie outside it.
  const opts={origin:[0,50,0],direction:[Math.sqrt(.75),-.5,0],bounds:[0,24],pixel:[7,9]};
  const near=ray({...opts,distance:110}),far=ray({...opts,distance:600}),sky=ray({...opts});
  assert(near.amount>0);assert.equal(near.amount,far.amount);assert.equal(far.amount,sky.amount);
  assert.deepEqual(near.scattering,far.scattering);
  assert.equal(ray({...opts,distance:40}).amount,0);
});

test('slab misses read no field points; sky rays integrate up to 650m and keep static per-pixel jitter', t => {
  for(const direction of [[1,0,0],[0,1,0],[0,-1,0]]) {
    const origin=[0,80,0],bounds=direction[1]<0?[90,110]:[0,24];
    const result=ray({origin,direction,bounds,sample(){assert.fail('slab miss must not read');}});
    assert.equal(result.reads,0);assert.equal(result.amount,0);
  }
  let furthest=0;const sky=ray({sample:p=>{furthest=Math.max(furthest,p[0]);return constantField();}});
  assert.equal(sky.reads,28);assert(furthest<=650&&furthest>600);
  assert.deepEqual(ray({distance:2000}),sky);
  let maxStepError=0;const values=new Set();for(let x=0;x<32;x++)for(let y=0;y<16;y++){
    const j=mistJitter(x+.5,y+.5);assert(j>=0&&j<1);assert.equal(j,mistJitter(x+.5,y+.5));values.add(j);
    const opts={pixel:[x+.5,y+.5],sigma:.004,distance:220,noiseAt:p=>.7+.2*Math.sin(p[0]/50)};
    for(const steps of [14,28]) {const error=Math.abs(ray({...opts,steps}).amount-ray({...opts,steps:steps*2}).amount);maxStepError=Math.max(maxStepError,error);assert(error<.05);}
  }
  t.diagnostic(JSON.stringify({jitterPixels:values.size,maxDoubledStepError:maxStepError}));
  assert(values.size>500);
  // Execute the actual shader's hash, so jitter cannot drift from its JS copy.
  const hashSource=MIST3_FRAGMENT.match(/float hash\(vec2 p\)\{[^}]+\}/)[0]
    .replace('float hash(vec2 p)','function hash(p)').replace('sin(', 'Math.sin(');
  const hash=new Function('fract','dot','vec2',hashSource+';return hash;')(v=>v-Math.floor(v),(a,b)=>a[0]*b[0]+a[1]*b[1],(a,b)=>[a,b]);
  for(let x=0;x<30;x++)assert.equal(hash([x+.5,12.5]),mistJitter(x+.5,12.5));
});

test('JS and shipped GLSL interval, profile and transmittance expressions agree', () => {
  const code=MIST3_AMOUNT_GLSL.replace(/(?:float|vec2)\s+(\w+)\(/g,'function $1(').replace(/float\s+(?=\w+\s*=)/g,'let ')
    .replace(/\b(abs|max|min|exp)\(/g,'Math.$1(').replace(/float\s+/g,'');
  const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  const vec2=(a,b=a)=>[a,b];
  const actual=new Function('smoothstep','vec2',code+';return {mistInterval,mistProfile,mistStepAlpha};')(smoothstep,vec2);
  for(const y of [-20,0,5,70])for(const dy of [-1,-.001,0,.0000001,.5,1])for(const d of [0,25,30,100,500,900]) {
    assert.deepEqual(actual.mistInterval(y,dy,d,0,20),mistInterval(y,dy,d,0,20));
  }
  for(const h of [-1,0,2,6,10,19,25])for(const thick of [0,10,20])for(const n of [.6,.9,1.2])assert(Math.abs(actual.mistProfile(h,thick,n)-mistProfile(h,thick,n))<1e-12);
  for(const T of [.38,.5,1])for(const density of [0,.003,.012,1])for(const dt of [1,20,60])assert(Math.abs(actual.mistStepAlpha(T,density,dt)-mistStepAlpha(T,density,dt))<1e-12);
  assert(MIST3_FRAGMENT.includes(MIST3_AMOUNT_GLSL));
  assert.match(MIST3_FRAGMENT,/point=eye\+direction\*t/);
  assert.match(MIST3_FRAGMENT,/mistProfile\(h,thick,mix/);
  assert.match(MIST3_FRAGMENT,/mistStepAlpha\(transmittance,density,dt\)/);
  assert.match(MIST3_FRAGMENT,/scattering\+=transmittance\*a\*colour;transmittance\*=1.0-a/);
  assert.match(MIST3_FRAGMENT,/original.rgb\*transmittance\+scattering/);
  assert.match(MIST3_FRAGMENT,/if\(depth>=1.0\)distance=650.0/);
  assert(!MIST3_FRAGMENT.includes('mistPath'));
});

test('baked height bounds include bilinear support and HalfFloat rounding at all thickness scales', () => {
  for(const scale of [0,.5,1,3]) {
    const [low,high]=mistHeightBounds(map.stats.heightRange,scale);
    for(let j=1;j<255;j++)for(let i=1;i<255;i++) {
      const k=(j*256+i)*4;if(map.data[k+1]<=0)continue;
      for(const dz of [-1,0,1])for(const dx of [-1,0,1]) {
        const at=((j+dz)*256+i+dx)*4,half=n=>THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(map.data[at+n]));
        const bottom=half(0)+half(2),top=bottom+half(3)*MIST3.thicknessMax*scale;
        assert(bottom>=low&&top<=high,`${bottom},${top} vs ${low},${high}`);
      }
    }
  }
});

test('depth unprojection returns known world points for perspective and orthographic cameras', () => {
  for(const camera of [new THREE.PerspectiveCamera(64,16/9,.15,2200),new THREE.OrthographicCamera(-50,50,30,-30,.1,2000)]) {
    camera.position.set(30,75,180);camera.lookAt(0,0,-50);camera.updateMatrixWorld();
    for(const original of [new THREE.Vector3(0,3,0),new THREE.Vector3(128,-2,-45),new THREE.Vector3(-80,25,-180)]) {
      const ndc=original.clone().project(camera),uv=new THREE.Vector2((ndc.x+1)/2,(ndc.y+1)/2),depth=(ndc.z+1)/2;
      const view=new THREE.Vector4(uv.x*2-1,uv.y*2-1,depth*2-1,1).applyMatrix4(camera.projectionMatrixInverse);
      view.divideScalar(view.w);view.applyMatrix4(camera.matrixWorld);
      assert(original.distanceTo(new THREE.Vector3(view.x,view.y,view.z))<1e-8);
    }
  }
  assert(MIST3_FRAGMENT.includes('inverseProjection*vec4(vUv*2.0-1.0,depth*2.0-1.0,1.0)'));
});

function rendererStub(supported=true) {
  const gl={DEPTH_COMPONENT32F:supported?36012:undefined,FRAMEBUFFER:36160,FRAMEBUFFER_COMPLETE:36053,checkFramebufferStatus:()=>36053};
  return { getContext:()=>gl,extensions:{has:()=>true},toneMapping:THREE.NoToneMapping,autoClear:true,
    setRenderTarget(){},clear(){},render(){},getPixelRatio:()=>1 };
}
function release(post) {
  post.disposeMist();post.target?.dispose();for(const l of post.levels)l.dispose();post.endDissolve();
  for(const k of ['matCopy','matOver','matDown','matUp','matFinal'])post[k].dispose();
}

test('valley-only pass feeds bloom, preserves dissolve, resizes depth, and light uses one noise octave', () => {
  const r=rendererStub(),post=new Post(r),scene=new THREE.Scene(),opening=new THREE.Scene(),camera=new THREE.PerspectiveCamera();
  camera.position.set(30,70,180);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  post.setSize(320,180,1);post.configureMist({scene,world:WORLD,terrain,a:ATMOS});
  const draws=[],run=post.run.bind(post);let bloomInput=null;post.run=(mat,target)=>{draws.push(mat);if(mat===post.matDown&&mat.uniforms.first.value===1)bloomInput=mat.uniforms.tex.value;run(mat,target);};
  post.render(scene,camera,.5);assert(post.stats().mist3.active);assert.equal(draws[0],post.mist.material);
  assert.equal(post.matFinal.uniforms.scene.value,post.mistTarget.texture);assert.equal(bloomInput,post.mistTarget.texture);assert.equal(post.matDown.uniforms.first.value,0);
  draws.length=0;post.render(opening,camera,.5);assert(!post.stats().mist3.active);assert(!draws.includes(post.mist.material));
  assert.equal(post.matFinal.uniforms.scene.value,post.target.texture);
  post.beginDissolve();post.holdFrame();post.setDissolve(.5);post.render(scene,camera,.2);assert(post.hold.frozen);
  const mapData=post.mist.texture,oldDepth=post.target.depthTexture,oldTarget=post.mistTarget;
  let depthDisposed=0,targetDisposed=0;oldDepth.addEventListener('dispose',()=>depthDisposed++);oldTarget.addEventListener('dispose',()=>targetDisposed++);
  post.setQuality('light');post.setSize(640,360,1);post.render(scene,camera);
  assert.equal(post.mist.texture,mapData);assert.equal(post.target.samples,0);assert.equal(post.target.depthTexture.image.width,640);
  assert.equal(depthDisposed,1);assert.equal(targetDisposed,1);assert.equal(post.mist.material.uniforms.lightQuality.value,1);
  assert.equal(post.mist.material.uniforms.stepCount.value,14);assert.equal(post.stats().mist3.maxFieldReads,14);assert.equal(post.stats().mist3.maxNoiseReads,14);assert.equal(post.stats().mist3.drawCalls,1);assert.equal(post.stats().mist3.triangles,1);release(post);
});

test('off flag and unsupported depth skip baking and pass; debug is exact monochrome and lk is bounded', () => {
  for(const [search,supported,reason] of [['?mist3=0',true,'flag'],['',false,'depth-texture-unavailable']]) {
    const post=new Post(rendererStub(supported)),scene=new THREE.Scene();post.setSize(64,64,1);
    post.configureMist({scene,world:WORLD,terrain:{heightAt(){assert.fail('disabled pass must not sample');}},a:ATMOS,search});
    post.render(scene,new THREE.PerspectiveCamera());assert.equal(post.stats().mist3.reason,reason);assert(!post.stats().mist3.active);assert.equal(post.target.depthTexture,null);release(post);
  }
  const post=new Post(rendererStub()),scene=new THREE.Scene();post.setSize(64,64,1);
  post.configureMist({scene,world:WORLD,terrain,a:ATMOS,search:'?mist3debug=1',look:{mist3:.05,mist3t:1.3}});
  const draws=[];post.run=(mat,target)=>draws.push([mat,target]);post.render(scene,new THREE.PerspectiveCamera());
  assert.equal(post.mist.material.uniforms.sigma.value,.05);assert.equal(post.mist.material.uniforms.thicknessScale.value,1.3);
  assert.deepEqual(draws.map(([m])=>m),[post.mist.material,post.matCopy]);release(post);
  assert.match(source('main.js'),/post.configureMist\(\{ scene, world: WORLD, terrain, a: ATMOS, look: LOOK, search: location.search, tier: \(\) => scaleIdx \}\)/);
});

test('failed depth framebuffer restores mesh fallback and adaptive tiers reduce samples without rebaking', () => {
  const scene=new THREE.Scene(),g=buildRidges();scene.add(g);g.userData.configure({a:ATMOS});
  const r=rendererStub(),post=new Post(r);post.setSize(64,64,1);let tier=0;
  post.configureMist({scene,world:WORLD,terrain,a:ATMOS,tier:()=>tier});
  const camera=new THREE.PerspectiveCamera(),mapTexture=post.mist.texture;
  post.render(scene,camera);assert(post.stats().mist3.active);assert.equal(g.userData.stats().mistBandKinds.river,0);
  for(const [level,steps] of [[1,20],[2,14],[3,14]]){tier=level;post.render(scene,camera);assert(post.stats().mist3.active);assert.equal(post.stats().mist3.steps,steps);assert.equal(post.mist.material.uniforms.stepCount.value,steps);assert.equal(post.mist.texture,mapTexture);}
  tier=0;post.render(scene,camera);assert(post.stats().mist3.active);assert.equal(post.mist.texture,mapTexture);
  r.getContext().checkFramebufferStatus=()=>0;post.setSize(80,60,1);post.render(scene,camera);
  assert.equal(post.stats().mist3.reason,'depth-framebuffer-incomplete');assert(!post.stats().mist3.enabled);
  assert.equal(post.target.depthTexture,null);assert.equal(post.mistTarget,null);assert.equal(g.userData.stats().mistBands,11);
  release(post);g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('half float map remains finite and field changes continuously between sub-grid positions', () => {
  let maxHeightError=0;
  for(let i=0;i<map.data.length;i++) {
    const actual=THREE.DataUtils.fromHalfFloat(THREE.DataUtils.toHalfFloat(map.data[i]));assert(Number.isFinite(actual));
    if(i%4===0)maxHeightError=Math.max(maxHeightError,Math.abs(actual-map.data[i]));
  }
  assert(maxHeightError<=.25);
  for(const [x,z] of [[130,-280],[-220,-180],[250,-250],[102,-190],[160,160]]) {
    const a=mistFieldAt(WORLD,terrain,x,z),b=mistFieldAt(WORLD,terrain,x+.001,z);
    assert(Math.abs(a.strength-b.strength)<.001);assert(Math.abs(a.lift-b.lift)<.01);assert(Math.abs(a.thick-b.thick)<.01);
  }
});

test('river and basin meshes disappear only with the new field; ridge band counts and rollback stay exact', t => {
  const old=buildRidges({search:'?mist3=0'}),current=buildRidges(),rows=[];current.userData.setMist3(true);
  for(const [quality,tier] of [['standard',0],['standard',1],['standard',2],['standard',3],['light',0]]) {
    for(const g of [old,current])g.userData.configure({quality,tier,a:ATMOS});
    const a=old.userData.stats(),b=current.userData.stats();
    assert.equal(b.mistBandKinds.river,0);assert.equal(b.mistBandKinds.basin,0);assert.equal(b.mistBandKinds.ridge,a.mistBandKinds.ridge);
    assert.equal(b.triangles,a.triangles-(a.mistBands-b.mistBands)*512);
    rows.push({quality,tier,old:a.mistBands,new:b.mistBands,triangles:b.triangles,drawCalls:b.drawCalls+1,addedTriangles:1});
    current.userData.setMist3(false);assert.equal(current.userData.stats().mistBands,a.mistBands);current.userData.setMist3(true);
  }
  t.diagnostic(JSON.stringify(rows));for(const g of [old,current])g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('both mist GLSL quality branches compile; undeclared names and broken syntax are rejected', t => {
  const compiler=spawnSync('glslc',['--version'],{encoding:'utf8'});if(compiler.error?.code==='ENOENT')return t.skip('glslc unavailable; GPU validation required');assert.equal(compiler.status,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'valley-mist-glsl-'));
  const prefix='#version 310 es\nprecision highp float;precision highp int;\n#define varying in\n#define texture2D texture\nout vec4 outputColour;\n#define gl_FragColor outputColour\n';
  function compile(code,success=true) {
    const file=path.join(dir,'test.frag');fs.writeFileSync(file,prefix+code);
    const r=spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',path.join(dir,'out.spv')],{encoding:'utf8'});
    if(success)assert.equal(r.status,0,r.stderr);else assert.notEqual(r.status,0);
  }
  try{for(const light of ['0.0','1.0'])compile(MIST3_FRAGMENT.replace('uniform float clock, sigma, thicknessScale, lightQuality, debug;',`uniform float clock, sigma, thicknessScale, debug;const float lightQuality=${light};`));
    compile(MIST3_FRAGMENT.replace('float depth=','float depth=undeclaredValue+'),false);compile(MIST3_FRAGMENT.replace('vec3 p=','vec3 p=('),false);
    t.diagnostic('2 fragment programs compiled; 2 negative compiler checks passed');
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});
