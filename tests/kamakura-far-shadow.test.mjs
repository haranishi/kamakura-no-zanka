import test from 'node:test';
import assert from 'node:assert/strict';
import { FAR_SHADOW as C,farShadowBox,farShadowProject,farShadowTownBounds,createFarShadowGrid,farShadowDensity,farShadowBias,farShadowRadius,farShadowFade,farShadowTownWeight,farShadowAmount,farShadowStrength } from '../dist/valley/kamakura-far-shadow.js';
const bounds={minX:-64,maxX:64,minZ:-64,maxZ:64},sun=[-Math.cos(.4),Math.sin(.4),0];
const field={size:2,spanX:128,spanZ:128,bytes:new Uint8Array([255,0,0,0,255,0,0,0,255,0,0,0,255,0,0,0])};
const near=(a,b,e=1e-7)=>assert(Math.abs(a-b)<e,`${a} != ${b}`);
test('solar box contains every town/whole corner and terrain + headroom in all four times; 16-bit precision is below quarter texel',()=>{
  for(const light of [[-.8,.37,.47],[.08,.85,.52],[.84,.42,.35],[.5,.17,.85],[0,1,0]])for(const footprint of [bounds,{minX:-1800,maxX:1800,minZ:-1800,maxZ:1800}]){
    const b=farShadowBox(footprint,-20,360,light,C.townSize),out=[];
    for(const x of [footprint.minX,footprint.maxX])for(const z of [footprint.minZ,footprint.maxZ])for(const y of [-20,400]){
      farShadowProject(b,[x,y,z],out);for(const n of out)assert(n>=-1e-12&&n<=1+1e-12);
    }
    assert(b.near>0&&b.far>b.near);assert(b.depthStep<=b.metersPerTexel*C.precisionShare);
  }
  const terrain={bounds},town=farShadowTownBounds(terrain,{meta:{places:[{id:'wakamiya_oji',x:20,y:-30}]}});
  near((town.minX+town.maxX)/2,20);near((town.minZ+town.maxZ)/2,30);near(town.maxX-town.minX,C.townSpan);
});
test('incremental terrain grid samples once; full density lifts 11m, threshold holes emit no canopy quads; heights and winding correct',t=>{
  let calls=0;const terrain={heightAt:(x,z)=>{calls++;return 10+x*.1+z*.05;}};
  const g=createFarShadowGrid(terrain,bounds,8,field);assert.equal(calls,0);g.step(7);assert.equal(calls,7);
  while(!g.ready)g.step(31);
  assert.equal(calls,g.positions.length/3);assert.equal(g.canopyCount,g.indices.length);
  for(let i=0;i<g.positions.length;i+=3){near(g.positions[i+1],10+g.positions[i]*.1+g.positions[i+2]*.05,2e-6);near(g.canopy[i+1]-g.positions[i+1],11,2e-6);}
  const off=createFarShadowGrid(terrain,bounds,8,{...field,bytes:new Uint8Array(16)});while(!off.ready)off.step(1000);assert.equal(off.canopyCount,0);
  assert.equal(farShadowDensity(field,1000,0),0);near(farShadowDensity(field,0,0),1);
  const partial=createFarShadowGrid(terrain,bounds,8,{...field,bytes:new Uint8Array([255,0,0,0,0,0,0,0,255,0,0,0,0,0,0,0])});while(!partial.ready)partial.step(1000);
  assert(partial.canopyCount>0&&partial.canopyCount<partial.indices.length);
  const work=g.work;g.step(1000);assert.equal(g.work,work);
  t.diagnostic(JSON.stringify({syntheticTerrainTriangles:g.indices.length/3,syntheticCanopyTriangles:g.canopyCount/3,work:g.work}));
});
test('CPU mirror bias, growing penumbra cap, town blend, walking/flying hand-off, backfaces, dark pixels and times',()=>{
  near(farShadowBias(1,.5),1.75);near(farShadowRadius(0),.6);near(farShadowRadius(20),1.5);near(farShadowRadius(200),6);
  near(farShadowFade(42,false),0);near(farShadowFade(52,false),.5);near(farShadowFade(62,false),1);near(farShadowFade(0,true),1);
  near(farShadowTownWeight(bounds,64,0),0);near(farShadowTownWeight(bounds,34,0),.5);near(farShadowTownWeight(bounds,0,0),1);
  for(const n of [-1,0,.02])near(farShadowAmount(1,n,1000,true,1,.6),0);
  near(farShadowAmount(1,1,1000,true,.08,.6),0);near(farShadowAmount(1,1,1000,true,1,.6),.6);
  assert.deepEqual(['morning','noon','golden','evening'].map(farShadowStrength),[.55,.5,.6,.62]);
});
test('rasterised synthetic box casts east with height/tan(elevation) length within two solar texels',()=>{
  const b=farShadowBox({minX:-80,maxX:80,minZ:-80,maxZ:80},0,12,sun,512),map=new Float64Array(b.size*b.size).fill(1),q=[];
  // Sample top and all four walls densely into an orthographic depth map, independent of the comparison mirror.
  const height=12,half=2,step=b.metersPerTexel/5;
  for(let x=-half;x<=half;x+=step)for(let z=-half;z<=half;z+=step){farShadowProject(b,[x,height,z],q);const k=Math.floor(q[1]*b.size)*b.size+Math.floor(q[0]*b.size);map[k]=Math.min(map[k],q[2]);}
  for(let y=0;y<=height;y+=step)for(let a=-half;a<=half;a+=step)for(const p of [[-half,y,a],[half,y,a],[a,y,-half],[a,y,half]]){farShadowProject(b,p,q);const k=Math.floor(q[1]*b.size)*b.size+Math.floor(q[0]*b.size);map[k]=Math.min(map[k],q[2]);}
  let last=0;
  for(let x=half;x<60;x+=step){farShadowProject(b,[x,0,0],q);const depth=map[Math.floor(q[1]*b.size)*b.size+Math.floor(q[0]*b.size)];if(q[2]>depth+farShadowBias(b.metersPerTexel,sun[1])/(b.far-b.near))last=x;}
  const expected=half+height/Math.tan(.4);
  assert(Math.abs(last-expected)<b.metersPerTexel*2,`${last} vs ${expected}`);
  farShadowProject(b,[-20,0,0],q);assert(q[2]<=map[Math.floor(q[1]*b.size)*b.size+Math.floor(q[0]*b.size)]);
});
