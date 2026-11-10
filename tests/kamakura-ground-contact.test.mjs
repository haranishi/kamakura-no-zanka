import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { CONTACT,contactAt,contactBoxDistance,createContactField,groundContactFor } from '../dist/valley/kamakura-ground-contact.js';
import { turfBrightness,turfSignal,turfColor,GROUND6_GLSL } from '../dist/valley/kamakura-ground-turf.js';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { TONE_GLSL } from '../dist/valley/kamakura-ground-tone.js';
const box={x:0,z:0,w:4,d:2,rotY:0};
const circle={x:0,z:0,r:.5};
test('GD1 exact edge, reach, rotated boxes, trunks and minimum overlap',()=>{
  assert.equal(contactAt([box],[],2,0),.45);
  assert.equal(contactAt([box],[],3.2,0),1);
  assert.equal(contactAt([],[],0,0),1);
  assert.equal(contactAt([],[circle],.5,0),.45);
  assert.equal(contactAt([],[circle],1.5,0),1);
  for(let i=0;i<40;i++){
    const angle=i*.137,b={...box,rotY:angle},c=Math.cos(angle),s=Math.sin(angle);
    const x=c*2.6,z=-s*2.6;
    assert(Math.abs(contactBoxDistance(b,x,z)-.6)<1e-12);
    assert(Math.abs(contactAt([b],[],x,z)-contactAt([b],[],-x,-z))<1e-12);
    const a=contactAt([b],[],x,z),d=contactAt([],[circle],x,z);
    assert.equal(contactAt([b],[circle],x,z),Math.min(a,d));
  }
});
test('GD1 half-metre R8 raster, empty/outside, movement and in-place list changes',()=>{
  const f=createContactField(),boxes=[{...box,x:.25,z:.25}],circles=[];
  assert(f.update({x:0,z:0},boxes,circles));
  assert.equal(f.bytes.length,65536);assert(Math.abs(f.at(2.25,.25)-.45)<1/255);
  assert.equal(f.at(200,0),1);assert.equal(f.at(-64.01,0),1);
  assert(!f.update({x:11.9,z:0},boxes,circles));assert.equal(f.revision,1);
  assert(f.update({x:12,z:0},boxes,circles));
  boxes[0].rotY=.3;assert(f.update({x:12,z:0},boxes,circles));
  circles.push(circle);assert(f.update({x:12,z:0},boxes,circles));
  circles[0]={...circle,x:5};assert(f.update({x:12,z:0},boxes,circles));
  boxes.length=0;circles.length=0;assert(f.update({x:12,z:0},boxes,circles));
  assert(f.bytes.every(b=>b===255));
});
function setup(search='',quality='standard'){
  const d=fixture({width:13,height:9,cell:2});d.meta.ground={};d.meta.surface={};d.ground=new Uint8Array(13*9*3).fill(140);d.surface=new Uint8Array(13*9).fill(2);
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,{search,quality});
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(shader);
  return {d,m,owner,shader,dispose(){owner.dispose();m.dispose();}};
}
test('GD1 resource lifetime, quality/adaptation and byte-identical old tone at ground6=0',async()=>{
  const h=setup();try{
    const contact=groundContactFor(h.d),t=contact.texture,u=h.owner.uniforms;
    assert.equal(t.internalFormat,'R8');assert.equal(t.generateMipmaps,false);assert.equal(t.image.width,256);assert(t.image.data.every(v=>v===255));
    assert(contact.update({x:0,z:0},[box],[]));
    assert.equal(h.shader.uniforms.uGroundContact,u.uGroundContact);
    h.owner.setAdapt({step:2});assert.equal(u.uGround6.value,.5);assert.equal(u.uGround6Fine.value,0);
    h.owner.setAdapt({step:3});assert.equal(u.uGround6.value,0);assert(!contact.update({x:100,z:100},[],[]));
    h.owner.setAdapt({step:0});assert.equal(u.uGround6.value,1);assert.equal(u.uGround6Fine.value,1);
    let releases=0;t.addEventListener('dispose',()=>releases++);h.owner.dispose();h.owner.dispose();assert.equal(releases,1);assert.equal(groundContactFor(h.d),undefined);
    assert(!contact.update({x:0,z:0},[],[]));
    await h.owner.tone.ready;
  }finally{h.dispose();}
  for(const search of ['?ground6=0','?gtone=0','?gdetail=0']){
    const old=setup(search+(search?'&':'?')+'gfar=0');try{assert.equal(groundContactFor(old.d),undefined);assert(!old.shader.fragmentShader.includes('vec3 ground6Color'));
      if(search==='?ground6=0')assert(old.shader.fragmentShader.includes(TONE_GLSL));
    }finally{old.dispose();}
  }
  const light=setup('', 'light');try{assert.equal(light.owner.uniforms.uGround6.value,.5);assert.equal(light.owner.uniforms.uGround6Fine.value,0);}finally{light.dispose();}
});
test('GD2 mean brightness within 1%, bounded variance, independent-lag autocorrelation and pixel convergence',t=>{
  const points=[];let state=773;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  for(let i=0;i<40000;i++)points.push([rand()*2000-1000,rand()*2000-1000]);
  for(const fine of [true,false]){
    const values=points.map(([x,z])=>turfBrightness(x,z,0,fine)),mean=values.reduce((a,b)=>a+b,0)/values.length;
    const variance=values.reduce((s,v)=>s+(v-mean)**2,0)/values.length,sd=Math.sqrt(variance);
    assert(Math.abs(mean-1)<.01);assert(sd>.012&&sd<.04);assert(values.every(v=>v>=.9&&v<=1.1));
    let maxCorrelation=-1;
    // Continuous value noise necessarily correlates near the origin. Test lags >= largest 5.5m cell in 8 directions.
    for(const lag of [5.5,11,22,44])for(let a=0;a<8;a++){
      const dx=Math.cos(a*Math.PI/4)*lag,dz=Math.sin(a*Math.PI/4)*lag;
      let cov=0;
      for(let i=0;i<points.length;i++){const [x,z]=points[i];cov+=(values[i]-mean)*(turfBrightness(x+dx,z+dz,0,fine)-mean);}
      maxCorrelation=Math.max(maxCorrelation,cov/points.length/variance);
    }
    assert(maxCorrelation<.5);t.diagnostic(JSON.stringify({fine,mean,sd,maxCorrelation}));
    for(const [x,z] of points.slice(0,100)){
      assert.equal(turfBrightness(x,z,6,fine),1);assert.equal(turfBrightness(x,z,0,fine,600),1);
      assert(Math.abs(turfSignal(x,z,1.4,fine))<=.45);
    }
  }
});
test('GD2 atlas contents, photo=0 independence, no extra sampler, derivatives outside nonuniform branches',async()=>{
  const h=setup('?photo=0');try{
    await h.owner.tone.ready;
    const a=h.owner.tone.textures[3].image,b=h.owner.tone.textures[4].image;
    assert.equal(a.height,b.height*2);assert.equal(a.width,b.width);
    const count=b.data.length;for(let i=0;i<count;i++)assert.equal(a.data[count+i],b.data[i]);
    const s=h.shader.fragmentShader;
    const samplers=[...s.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(','));
    assert.equal(new Set(samplers).size,14); // no shore: 14 + shore + sun <= 16
    assert(s.includes('ground6Class((p+warp)/uToneWeightSpan+.5,0.0).b'));
    assert(s.includes('return ground6Color(result,p,dist,px,'));assert.equal(h.owner.uniforms.uGroundPhotoEnabled.value,0);
    assert(!/dFdx|dFdy|fwidth/.test(GROUND6_GLSL));
    assert(!/\b(?:float|vec[234]|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(GROUND6_GLSL));
    const stack=[],pairs={')':'(',']':'[','}':'{'};for(const c of GROUND6_GLSL.replace(/\/\/[^\n]*/g,'')){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
  }finally{h.dispose();}
});

test('GD2 dry hue is yellowwards, bounded and luminance neutral; no turf/far pixels keep their palette',()=>{
  const base=[.2,.3,.07],luma=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;
  for(let i=0;i<200;i++){
    const x=i*.37,z=i*1.31,a=turfColor(base,x,z,{dry:0}),b=turfColor(base,x,z,{dry:1});
    assert(b[0]>=a[0]);assert(b[1]<=a[1]);
    assert(Math.abs(luma(a)-luma(base)*turfBrightness(x,z))<1e-12);
    assert(Math.abs(luma(b)-luma(a))<1e-12);
    assert.deepEqual(turfColor(base,x,z,{weight:0}),base);
    assert.deepEqual(turfColor(base,x,z,{dist:600}),base);
    for(const c of [a,b])assert(Math.abs(c[0]-base[0]*turfBrightness(x,z))<=luma(base)*.03+1e-12);
  }
});

test('GD1 bounded raster matches independent exact distances and min overlaps at all sampled cell centres',()=>{
  const boxes=[box,{x:-4,z:7,w:12,d:5,rotY:.7},{x:8,z:-5,w:3,d:17,rotY:-1.2}],circles=[circle,{x:-5,z:7,r:1.1}];
  const f=createContactField();f.update({x:0,z:0},boxes,circles);
  for(let j=0;j<256;j+=3)for(let i=0;i<256;i+=3){
    const x=f.x+(i+.5)*CONTACT.cell,z=f.z+(j+.5)*CONTACT.cell;
    assert.equal(f.bytes[j*256+i],Math.round(contactAt(boxes,circles,x,z)*255));
  }
});
