import test from 'node:test';
import assert from 'node:assert/strict';
import { load, THREE } from './helpers/tree-modules.mjs';
import { TREES } from '../dist/valley/config.js';
import { wind } from './helpers/tree-field.mjs';
import { CROWN_TILT_RADIANS, cardHash, crownAttributes, crownLookEnabled, cardVariation, crownGap, crownDistance, crownTransmission } from '../dist/valley/kamakura-crown.js';
import { photoBlendUniform } from '../dist/valley/kamakura-photo-tex.js';
const { buildKamakuraVeg } = await load('kamakura-veg-view.js');
const { buildKamakuraStands } = await load('kamakura-stand-view.js');
const { treeGeometry } = await load('tree-geometry.js');
const sunDir = new THREE.Vector3(.3,.4,.5).normalize();
const item = {x:17,y:3,z:-29,species:1,shape:0,height:12,color:[.1,.2,.1],lean:0,yaw:.2,tint:0,phase:0};
function shader(material) {
  const s = {uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
  material.onBeforeCompile(s); return s;
}
function balanced(source) {
  const s=source.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''), stack=[], pairs={')':'(',']':'[','}':'{'};
  for(const c of s) if('([{'.includes(c)) stack.push(c); else if(')]}'.includes(c)) assert.equal(stack.pop(),pairs[c]);
  assert.equal(stack.length,0);
  const pp=[]; for(const line of s.split('\n')) { if(/^\s*#if/.test(line))pp.push(line); if(/^\s*#endif/.test(line))assert.ok(pp.pop()); } assert.equal(pp.length,0);
  assert.doesNotMatch(s,/\b(?:float|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/);
  // A negative number spliced after a minus (`position.y--0.013`) is a GLSL compile error that Node never sees; only the real GPU did.
  assert.doesNotMatch(s,/[\w)\].]\s*--\s*[0-9.]/);
  assert.doesNotMatch(s,/[\w)\].]\s*\+\+\s*[0-9.]/);
}
test('card identity is constant on each independent quad/triangle and unaffected by cloning or window order',()=>{
  let cards=0;
  for(const species of [0,1,2,3,4,5]) for(let shape=0;shape<TREES.variants[['cedar','zelkova','pine','maple','sapling','shrub'][species]];shape++) for(const level of [0,1]) {
    const g=treeGeometry(species,level,shape).leaf, attrs=crownAttributes(g), cloned=g.clone(), again=crownAttributes(cloned), ids=g.index.array;
    assert.equal(Buffer.compare(Buffer.from(attrs.card.buffer),Buffer.from(again.card.buffer)),0);
    assert.equal(g.attributes.aKzCard,undefined);
    const unique=new Set();
    for(let t=0;t<ids.length;) {
      const a=ids[t],b=ids[t+1],c=ids[t+2];
      const quad=t+5<ids.length&&ids[t+3]===a&&ids[t+4]===c&&Math.max(a,b,c,ids[t+5])-Math.min(a,b,c,ids[t+5])===3;
      const independent=quad||(a===t&&b===t+1&&c===t+2);
      if(independent){
        const vertices=quad?[a,b,c,ids[t+5]]:[a,b,c], identity=Array.from(attrs.card.slice(a*3,a*3+3)).join(',');
        for(const v of vertices)assert.equal(Array.from(attrs.card.slice(v*3,v*3+3)).join(','),identity);
        assert.ok(!unique.has(identity),`duplicate card centre ${species}/${level}`); unique.add(identity); cards++;
      }
      t+=quad?6:3;
    }
    assert.ok(attrs.normals.every(Number.isFinite)); cloned.dispose();
  }
  // Same world coordinate is independent of sampling window / instance insertion order.
  const coordinates=Array.from({length:4096},(_,i)=>[i*.37-80,(i%31)*.9,(i%67)*1.3]);
  const forward=new Map(coordinates.map(p=>[p.join(','),cardVariation(...p)]));
  for(const p of coordinates.reverse()) assert.equal(cardVariation(...p).join(','),forward.get(p.join(',')).join(','));
  console.log(`veg6 independent cards=${cards}`);
});
test('card gain/hue are centred, bounded and varied; height and spherical blend preserve finite unit normals',()=>{
  const samples=Array.from({length:32768},(_,i)=>cardVariation(i*.371,(i%97)*.83,(i%173)*1.19));
  const means=[0,1].map(k=>samples.reduce((s,v)=>s+v[k],0)/samples.length);
  const sd=Math.sqrt(samples.reduce((s,v)=>s+(v[0]-means[0])**2,0)/samples.length);
  for(const [gain,hue]of samples){assert.ok(gain>=.88&&gain<=1.12);assert.ok(Math.abs(hue)<=.03);}
  assert.ok(Math.abs(means[0]-1)<.002);assert.ok(Math.abs(means[1])<.001);assert.ok(sd>.067&&sd<.071);
  for(let i=0;i<4096;i++){
    const angle=CROWN_TILT_RADIANS*cardHash(i*.31,i%97,i%79,73.1);
    const tilted=new THREE.Vector3(0,Math.cos(angle),Math.sin(angle));
    assert.ok(tilted.angleTo(new THREE.Vector3(0,1,0))<=25*Math.PI/180+1e-12);
  }
  for(const species of [0,1,2,3]){
    const {normals}=crownAttributes(treeGeometry(species,0).leaf);
    for(let k=0;k<normals.length;k+=3)assert.ok(Math.abs(Math.hypot(...normals.slice(k,k+3))-1)<1e-6);
  }
  console.log(`veg6 gain mean=${means[0].toFixed(6)} sd=${sd.toFixed(6)} hue mean=${means[1].toFixed(6)}`);
});
test('synthetic crown discs lose 5–12 percent near the rim; no new holes at 150m or in the centre',()=>{
  const ratios=[];
  for(const z of [3.7,11.3,27.9]) {
    let total=0,holes=0;
    for(let i=0;i<400;i++)for(let j=0;j<400;j++){
      const x=(i/399*2-1)*10,y=(j/399*2-1)*10,r=Math.hypot(x,y)/10;
      if(r>1)continue; total++;
      const gap=crownGap(x,y,z,r,0); if(gap>.5)holes++;
      assert.equal(crownGap(x,y,z,r,150),0); assert.equal(crownGap(x,y,z,r,600),0);
      if(r<=.65)assert.equal(gap,0);
    }
    ratios.push(holes/total); assert.ok(holes/total>=.05&&holes/total<=.12);
  }
  assert.equal(crownDistance(60),1); assert.equal(crownDistance(150),0);
  console.log(`veg6 disc holes=${ratios.map(v=>(v*100).toFixed(3)).join(',')}%`);
});
test('transmission is zero in shade or away from sun, capped at .08',()=>{
  for(const rim of [0,.3,1])for(const facing of [0,.5,1])for(const back of [0,.4,1]) {
    assert.equal(crownTransmission(0,rim,facing,back),0);assert.equal(crownTransmission(1,rim,facing,0),0);
    assert.ok(crownTransmission(1,rim,facing,back)<=.08);
  }
  assert.equal(crownTransmission(1,1,1,1),.08);
});
test('veg6 shader variants balance, derivatives precede alpha tests; depth, valley and resources stay unchanged',()=>{
  for(const quality of ['standard','light']) for(const species of [0,1,2,3,5]) {
    const views=['?veg6=0',''].map(search=>buildKamakuraVeg({active:[{...item,species}],grid:new Map()},{wind,sunDir,quality,search}));
    try {
      for(let level=0;level<(species===5?2:3);level++){
        const old=views[0].sets.get(`${species}/0/${level}`),now=views[1].sets.get(`${species}/0/${level}`);
        const before=shader(old.leaf.material),s=shader(now.leaf.material); balanced(s.vertexShader);balanced(s.fragmentShader);
        assert.doesNotMatch(before.vertexShader,/aKzCard/);assert.doesNotMatch(before.fragmentShader,/kzGapNoise/);
        assert.equal(s.uniforms.uKzCrownPhoto,photoBlendUniform);
        assert.match(s.vertexShader,/modelMatrix\*kzCardWorld/);
        assert.equal(old.leaf.geometry.attributes.position.count,now.leaf.geometry.attributes.position.count);
        assert.equal(old.leaf.geometry.index.count,now.leaf.geometry.index.count);
        if(old.leaf.customDepthMaterial){
          const d0=shader(old.leaf.customDepthMaterial),d1=shader(now.leaf.customDepthMaterial);
          assert.equal(d0.vertexShader,d1.vertexShader);assert.equal(d0.fragmentShader,d1.fragmentShader);
        }
        if(quality==='standard'){
          assert.match(s.vertexShader,/0\.436332313/);assert.match(s.fragmentShader,/min\(vec3\(\.08\)/);
          assert.ok(s.fragmentShader.indexOf('fwidth(kzGapNoise)')<s.fragmentShader.indexOf('#include <alphatest_fragment>'));
          assert.match(s.fragmentShader,/60.0,150.0/);
        }else{
          assert.doesNotMatch(s.vertexShader,/kzTiltAxis/);assert.doesNotMatch(s.fragmentShader,/fwidth\(kzGapNoise\)|kzHeightGain,kzCrownWeight|min\(vec3\(\.08\)/);
        }
      }
      const mesh=views[1].sets.get(`${species}/0/0`).leaf;let released=0;mesh.geometry.addEventListener('dispose',()=>released++);
      views[1].dispose();views[1].dispose();assert.equal(released,1);
    }finally{for(const view of views)view.dispose();}
  }
  assert.equal(crownLookEnabled('?veg6=0'),false);
});
test('distant stands keep fog, shadow policy and topology; only card tint and height are added',()=>{
  const prepared={policy:{hide:[[0,0],[100,180],[500,800]],ranges:[0,5000,8000]},distant:new Map([['test',[{tier:2,species:0,x:0,y:0,z:0,height:20,crown:4,color:[.1,.2,.1]}]]]),grid:new Map()};
  const views=['?veg6=0',''].map(search=>buildKamakuraStands(prepared,{wind,sunDir,search}));
  try{
    const old=views[0].distant[0].mesh,now=views[1].distant[0].mesh,s=shader(now.material);
    balanced(s.vertexShader);balanced(s.fragmentShader);assert.match(s.fragmentShader,/#include <fog_fragment>/);
    assert.match(s.fragmentShader,/vKzCardTint/);assert.match(s.fragmentShader,/vKzHeightGain,kzCrownWeight/);
    assert.doesNotMatch(s.fragmentShader,/kzGapNoise|kzTiltAxis/);assert.equal(now.castShadow,old.castShadow);
    assert.equal(now.geometry.index.count,old.geometry.index.count);
  }finally{for(const view of views)view.dispose();}
});
