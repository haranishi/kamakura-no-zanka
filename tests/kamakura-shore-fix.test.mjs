import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {bankWaterlineRibbon,bankSurfaceRibbon,bankTriangleAspect,buildBankWet,BANK_MAX_ASPECT,BANK_REACH_STEP} from '../dist/valley/kamakura-bank-wet.js';
import {prepareRivers} from '../dist/valley/kamakura-rivers.js';
import {THREE} from './helpers/tree-modules.mjs';
import {shoreBandWidth,shoreWetBand,SHORE_GLSL} from '../dist/valley/kamakura-shore.js';
const river={xy_m:Array.from({length:24},(_,i)=>[0,-i*.8]),width_m:Array(24).fill(4),water_elev_m:Array(24).fill(1),enters_sea:false};
const ribbon=prepareRivers({rivers:[river]}).ribbons[0];
const terrain={heightAt(x,z){const reach=z>6&&z<9?8:z>13&&z<14?1:2;return Math.abs(x)/reach;}};
function checkReach(r,source,tolerance=1e-5){
  for(let side=0;side<2;side++){
    let previous;
    for(let row=0;row<r.positions.length/6;row++){
      const k=row*6,i=k+side*3,x=(source.positions[k]+source.positions[k+3])/2,z=(source.positions[k+2]+source.positions[k+5])/2;
      const reach=Math.hypot(r.positions[i]-x,r.positions[i+2]-z),half=Math.hypot(source.positions[i]-x,source.positions[i+2]-z);
      assert(reach<=half*2+tolerance,'reach exceeds twice nominal half-width');
      if(previous!==undefined)assert(Math.abs(reach-previous)<=BANK_REACH_STEP+tolerance,'neighbour crossing spike');
      previous=reach;
    }
  }
}
function checkFaces(f){
  assert(f.indices.length>0,'guard must retain a visible strip');
  for(let k=0;k<f.indices.length;k+=3){const v=f.indices.slice(k,k+3).map(i=>Array.from(f.positions.slice(i*3,i*3+3)));assert(bankTriangleAspect(...v)<=BANK_MAX_ASPECT+1e-5,'thin triangle survives');}
}
test('R2 fix stepped/protruding banks have bounded adjacent reaches and final triangle aspect',()=>{
  const r=bankWaterlineRibbon(ribbon,terrain);checkReach(r,ribbon);
  checkFaces(bankSurfaceRibbon(ribbon,terrain,1.5,true));
  // Clipping to an actual terrain grid also creates slivers independently of reach jumps.
  const t={...terrain,cell:1,w:40,h:40,x0:-20,z0:-10,normalAt:()=>({x:0,y:1,z:0})};
  checkFaces(bankSurfaceRibbon(ribbon,t,1.5,true));
});
test('R2 fix deferred segments use the same shared rows and guards as the complete strip',()=>{
  const p=prepareRivers({rivers:[river]}),wet=buildBankWet(THREE,p,terrain,{defer:true});
  wet.setAdapt(3);for(let i=0;i<10;i++)wet.update({x:0,z:8});assert.equal(wet.group.children.length,0);
  wet.setAdapt(0);for(let i=0;i<3000;i++)wet.update({x:0,z:8});
  assert.equal(wet.group.children.length,1);
  const g=wet.group.children[0].geometry,expected=bankSurfaceRibbon(ribbon,terrain,1.5,true);
  assert.deepEqual(g.attributes.position.array,expected.positions);
  assert.deepEqual(Array.from(g.index.array),expected.indices);
  checkFaces({positions:g.attributes.position.array,indices:Array.from(g.index.array)});
  let disposals=0;g.addEventListener('dispose',()=>disposals++);wet.dispose();wet.dispose();assert.equal(disposals,1);
});
test('R2 fix removal of reach/triangle limits fails the same acceptance checks',async()=>{
  let code=await fs.readFile(new URL('../dist/valley/kamakura-bank-wet.js',import.meta.url),'utf8');
  code=code.replaceAll("'./kamakura-chunks.js'",JSON.stringify(new URL('../dist/valley/kamakura-chunks.js',import.meta.url).href)).replaceAll("'./kamakura-shore.js'",JSON.stringify(new URL('../dist/valley/kamakura-shore.js',import.meta.url).href));
  code=code.replace('BANK_REACH_STEP=.4','BANK_REACH_STEP=Infinity').replace('BANK_MAX_ASPECT=32','BANK_MAX_ASPECT=Infinity').replace('caps[n]=2*half','caps[n]=Infinity').replace('(reaches[n-2]+2*reaches[n]+reaches[n+2])/4','reaches[n]');
  const broken=await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  assert.throws(()=>checkReach(broken.bankWaterlineRibbon(ribbon,terrain),ribbon));
  assert.throws(()=>checkFaces(broken.bankSurfaceRibbon(ribbon,terrain,1.5,true)));
});
test('R2 fix distant sea films preserve six-pixel half-strength widths up to the explicit world cap',()=>{
  for(const px of [.001,.02,.1,.3,.8,1,2,4]){
    const foam=shoreBandWidth(1.4,px);assert(foam/px>=6);assert(foam<=48);assert(foam>=1.4);
    // Wetness is one-sided: its half-strength width is half the full reach.
    const width=shoreBandWidth(1.5,px*2);assert(width/2/px>=6);
    assert(Math.abs(shoreWetBand(width/2,9,px)-.5)<1e-12);
    assert.equal(shoreWetBand(0,9,px),1);
  }
  assert.equal(shoreBandWidth(1.4,.02),1.4);assert.equal(shoreBandWidth(1.4,100),48);
  assert(SHORE_GLSL.includes('shoreBandWidth(clamp(reach*.18,.6,1.5),max(fwidth(d),.001)*2.0)'));
  assert(!SHORE_GLSL.includes('*width/softWidth'),'far foam must retain contrast');
});
test('R2 fix all private river wet strips reject thin triangles (no private coordinates logged)',{skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有データは同梱しない'},async()=>{
  const {readPrivateData}=await import('../tools/lib/kamakura-validation.mjs'),{createKamakuraTerrain}=await import('../dist/valley/kamakura-terrain.js'),{decodeRivers}=await import('../dist/valley/kamakura-rivers.js');
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),t=createKamakuraTerrain(data);
  const p=prepareRivers(decodeRivers(JSON.parse(await fs.readFile(path.join(process.env.KZ_WORLD_DIR,'rivers.json'),'utf8'))),t.vscale);
  for(const r of p.ribbons){
    const aligned=bankWaterlineRibbon(r,t);checkReach(aligned,r,.002);
    const f=bankSurfaceRibbon(r,t,1.5,true);
    if(f.indices.length)checkFaces(f);
  }
});
