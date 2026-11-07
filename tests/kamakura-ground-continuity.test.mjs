import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { toneRelief, toneChannel, grassTintAt, toneFine } from '../dist/valley/kamakura-ground-tone-rules.js';
import { grassAmount, smooth, soilNoise } from '../dist/valley/kamakura-ground-pattern.js';

const flat=(alternating=true)=>{
  const d=fixture({width:33,height:33,cell:3.9});d.meta.surface={};d.meta.ground={};
  d.surface=Uint8Array.from({length:33*33},(_,i)=>(alternating?(i%33+Math.floor(i/33))%2:i%33>16)?4:2);
  d.ground=new Uint8Array(33*33*3).fill(140);return d;
};
// Texture-centre convention matches WebGL's LinearFilter, clamp-to-edge.
function linear(image,x,z,spanX,spanZ,channel=0){
  const w=image.width,h=image.height,c=image.data.length/(w*h);
  const u=Math.max(0,Math.min(w-1,(x/spanX+.5)*w-.5)),v=Math.max(0,Math.min(h-1,(z/spanZ+.5)*h-.5));
  const a=Math.floor(u),b=Math.floor(v),f=u-a,g=v-b;
  const at=(i,j)=>image.data[(Math.min(h-1,j)*w+Math.min(w-1,i))*c+channel]/255;
  return (1-g)*((1-f)*at(a,b)+f*at(a+1,b))+g*((1-f)*at(a,b+1)+f*at(a+1,b+1));
}
function amount(owner,d,x,z,forceOld=false){
  if(owner.tone&&!forceOld){
    const span=owner.tone.uniforms.uToneWeightSpan?.value;
    const grid=d.meta.grid;
    const dx=1.6*(soilNoise(x/23,z/23)-.5),dz=1.6*(soilNoise((x+71)/23,(z-37)/23)-.5);
    return linear(owner.tone.textures[1].image,x+dx,z+dz,span?.x??grid.width*grid.cell_m,span?.y??grid.height*grid.cell_m);
  }
  const {width:w,height:h,cell_m:cell}=d.meta.grid;
  const wx=.85*Math.sin(x*.13+Math.sin(z*.09)),wz=.85*Math.sin(z*.11+Math.sin(x*.07));
  const i=Math.max(0,Math.min(w-1,Math.floor((x+wx)/cell+w/2))),j=Math.max(0,Math.min(h-1,Math.floor((z+wz)/cell+h/2)));
  return grassAmount(d.surface[j*w+i]);
}
// At 35m, old near-pattern -> far-mean mixing is active. Fix a visible
// pattern value to isolate the class discontinuity from the texture's grain.
const transitionColor=(a,d)=>.25*(1+a*(smooth(18,55,d)*.42*.5-(1-smooth(8,18,d))*.23));
test('r2 alternating grass/soil flat reproduces old transition jumps and bounds new adjacent colour deltas',async t=>{
  for(const alternating of [true,false])for(const colored of [false,true]){
    const d=flat(alternating),m=new THREE.MeshLambertMaterial({vertexColors:colored}),owner=installGroundDetail(THREE,m,d);
    await owner.tone?.ready;
    assert(owner.tone,'ground=0 must still get filtered class weights');
    assert.equal(owner.tone.uniforms.uToneBaked.value,colored?1:0);
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
    m.onBeforeCompile(shader);
    assert(shader.fragmentShader.includes('uGroundStrength>0.0 && uToneStrength<=0.0'),'nearest detail must be gated even before preparation completes');
    let oldMax=0,newMax=0,renderMax=0,weightMin=1,weightMax=0;
    for(const dist of [8,18,35,55,65,110,700])for(const z of [-11.7,-3.9,0,5.85]){
      let oldLast,newLast,renderLast;
      for(let x=-20;x<=20;x+=.02){
        const a=transitionColor(amount(owner,d,x,z,true),dist),b=transitionColor(amount(owner,d,x,z),dist);
        const macro=soilNoise(x/43,z/43),grass=amount(owner,d,x,z);
        weightMin=Math.min(weightMin,grass);weightMax=Math.max(weightMax,grass);
        // Pixel footprint .2m has integrated out pebbles; this tests the actual
        // new colour equation at the same grass/soil boundary and distance band.
        const render=toneChannel(.25,1,toneRelief(0,1,0,0,macro),0,grass*grassTintAt(x,z,dist),0);
        if(renderLast!==undefined)renderMax=Math.max(renderMax,Math.abs(render-renderLast));
        renderLast=render;
        if(oldLast!==undefined){oldMax=Math.max(oldMax,Math.abs(a-oldLast));newMax=Math.max(newMax,Math.abs(b-newLast));}
        oldLast=a;newLast=b;
      }
    }
    t.diagnostic(`alternating=${alternating} vertexColors=${colored}: legacy max ${(oldMax*255).toFixed(4)}/255; new ${(newMax*255).toFixed(4)}/255 per 2cm; new colour ${(renderMax*255).toFixed(4)}/255`);
    if(alternating)assert(weightMax-weightMin<1/255,'prefilter must remove alternating-grid contrast, not just round its edges');
    owner.dispose();m.dispose();assert(oldMax*255>10);assert(newMax*255<.1,'class boundary must not make a colour step');assert(renderMax*255<.1,'new colour must be continuous too');
  }
});

test('r2 facility interior is brighter than exterior and gravel integrates smoothly to its far mean',async t=>{
  const d=flat(false);d.surface.fill(4);
  d.facilities={nodes:[{part:'sando',anchor_xz:[0,0],bbox_min:[-10,0,-20],bbox_max:[10,1,20]}]};
  const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d);
  await owner.tone.ready;
  try{
    const span=owner.tone.uniforms.uToneWeightSpan.value,image=owner.tone.textures[1].image;
    const inside=linear(image,0,0,span.x,span.y,2),outside=linear(image,30,0,span.x,span.y,2);
    assert(inside>.99);assert.equal(outside,0);
    const encode=v=>255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055);
    const delta=encode(toneChannel(.25,1,0,0,0,inside))-encode(toneChannel(.25,1,0,0,0,outside));
    assert(delta>15,'packed earth must remain visibly lighter at the same base hue');
    let jump=0;
    for(const dist of [0,12,18,35,55,60,65,110,700,2500]){
      const a=toneChannel(.25,1,0,0,0,1,1,.4*toneFine(0,0,dist-.001,.01));
      const b=toneChannel(.25,1,0,0,0,1,1,.4*toneFine(0,0,dist+.001,.01));
      jump=Math.max(jump,Math.abs(encode(a)-encode(b)));
    }
    assert(jump<.01);
    assert.equal(toneFine(0,0,40,.2),0);assert.equal(toneFine(0,0,200,.01),0);
    t.diagnostic(`packed earth interior/exterior ${delta.toFixed(3)}/255; gravel transition max ${jump.toFixed(6)}/255 over .002m`);
  }finally{owner.dispose();m.dispose();}
});
