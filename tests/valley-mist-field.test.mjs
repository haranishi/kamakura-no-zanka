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
import { MIST3, bakeMistField, mistFieldAt, mistPath, mistAmount, MIST3_AMOUNT_GLSL } from '../dist/valley/mist-field.js';
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

test('optical path respects the layer, horizontal rays, proximity, distance monotonicity and caps', () => {
  assert.equal(mistAmount(70,30,100,0,10,1),0);
  assert.equal(mistAmount(5,0,25,0,10,1),0);
  assert.equal(mistPath(5,5,90,0,10),90);assert.equal(mistPath(11,11,90,0,10),0);
  assert.equal(mistPath(5,5,500,0,10),120);
  assert.equal(mistAmount(5,0,1000,0,10,1),.8);
  let last=0;for(let d=0;d<=500;d++){const a=mistAmount(60,0,d,0,10,.6);assert(a>=last);assert(a<=.8);last=a;}
  let low=mistAmount(70,10,300,0,15,.6);assert(low>0);assert.equal(mistAmount(70,30,300,0,15,.6),0);
  assert.equal(mistAmount(70,0,300,0,10,0),0);
});

test('JS and actual GLSL optical expressions match including near-horizontal degeneracies', () => {
  // Execute the shipped scalar GLSL after substituting only scalar type/builtin syntax.
  const code=MIST3_AMOUNT_GLSL.replace(/float\s+(\w+)\(/g,'function $1(').replace(/float\s+/g,'let ')
    .replace(/\b(abs|max|min|exp)\(/g,'Math.$1(').replace(/\blet (yc|yp|distance|bottom|thick|strength|noiseValue|sigma)(?=[,)])/g,'$1');
  // Parameter types occur after commas as well as after the opening parenthesis.
  const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};
  const actual=new Function('smoothstep',code+';return mistAmount;')(smoothstep);
  for(const yc of [0,5,70])for(const yp of [0,5,5.00001,20])for(const d of [0,25,30,100,500])for(const strength of [0,.3,1]) {
    const args=[yc,yp,d,0,10,strength,.7,MIST3.sigma];assert(Math.abs(actual(...args)-mistAmount(...args))<1e-12);
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
  assert.equal(post.stats().mist3.drawCalls,1);assert.equal(post.stats().mist3.triangles,1);release(post);
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

test('failed depth framebuffer restores mesh fallback and adaptive tier 3 skips the pass without rebaking', () => {
  const scene=new THREE.Scene(),g=buildRidges();scene.add(g);g.userData.configure({a:ATMOS});
  const r=rendererStub(),post=new Post(r);post.setSize(64,64,1);let tier=0;
  post.configureMist({scene,world:WORLD,terrain,a:ATMOS,tier:()=>tier});
  const camera=new THREE.PerspectiveCamera(),mapTexture=post.mist.texture;
  post.render(scene,camera);assert(post.stats().mist3.active);assert.equal(g.userData.stats().mistBandKinds.river,0);
  tier=3;post.render(scene,camera);assert(!post.stats().mist3.active);assert.equal(post.stats().mist3.reason,'adaptive-tier');
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
    rows.push({quality,tier,old:a.mistBands,new:b.mistBands,triangles:b.triangles,drawCalls:b.drawCalls+(tier<3?1:0),addedTriangles:tier<3?1:0});
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
