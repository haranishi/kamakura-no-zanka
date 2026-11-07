// W2c-9r2 grass: synthetic habitats and actual jittered roots, no geographic fixture.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createGrassBandCell,sandGrassAt,midGrassBandOffset,midGrassDensityAt} from '../dist/valley/kamakura-grass-band.js';
import {createGrassEnvironment,grassColony} from '../dist/valley/kamakura-grass-look.js';
import {createGrassCell,createGrassWindows,grassExclusions} from '../dist/valley/kamakura-grass-field.js';
import {midTile,nearTile,FERN,SUSUKI} from '../dist/valley/grass-field.js';
import {buildColliders} from '../dist/valley/collision.js';
const flat={heightAt:()=>10,slopeAt:()=>0,walkable:()=>true,waterAt:()=>0,seaDistanceAt:()=>50,riverDistanceAt:()=>Infinity};
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
function setup(terrain=flat,code=()=>0,opts={}){
  const env=createGrassEnvironment(terrain,{surfaceCodeAt:code,...opts});
  const base=createGrassCell(terrain,{surfaceCodeAt:code,environmentAt:env,riverMargin:.25,exclude:grassExclusions(terrain,{...opts,pathMargin:2.5,rootMargin:Math.SQRT1_2})});
  return {env,base,cell:createGrassBandCell(base,terrain,{surfaceCodeAt:code,environmentAt:env,facilityBoxes:opts.facilityBoxes})};
}
function field(cell){const w=createGrassWindows(cell,{size:128});w.plan({x:0,z:0});w.work(()=>0);return w.commit();}
function roots(f,near=false){const out=[];for(let z=-48;z<48;z++)for(let x=-48;x<48;x++){
  const a=near?nearTile(f,x,z,{size:1}):midTile(f,x,z,{size:1,cardRate:.38,maxCards:1,sink:.12,maxSlope:32});
  for(let i=0;i<a.count;i++)out.push([a.x[i],a.z[i],a.species[i]]);
}return out;}
const cv=a=>{const m=a.reduce((s,v)=>s+v,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length)/m;};
test('sand colonies recover 2–3x habitat, remain clustered, and vary in centre spacing and size',t=>{
  let before=0,after=0;const centres=[],sizes=[];
  for(let z=-80;z<80;z++)for(let x=-80;x<80;x++){
    before+=smooth(.30,.78,grassColony(x+.5,z+.5));after+=sandGrassAt(x+.5,z+.5,50);
  }
  // Connected cores measure whole colonies, rather than clipping all sizes to one radius.
  const seen=new Set();
  for(let z=-80;z<80;z++)for(let x=-80;x<80;x++){
    const key=`${x},${z}`;if(seen.has(key)||sandGrassAt(x+.5,z+.5,50)<1.1)continue;
    const todo=[[x,z]];seen.add(key);let sx=0,sz=0,n=0;
    for(let i=0;i<todo.length;i++){const [a,b]=todo[i];sx+=a;sz+=b;n++;
      for(const [dx,dz] of [[-1,0],[1,0],[0,-1],[0,1]]){const nx=a+dx,nz=b+dz,k=`${nx},${nz}`;
        if(nx>=-80&&nx<80&&nz>=-80&&nz<80&&!seen.has(k)&&sandGrassAt(nx+.5,nz+.5,50)>=1.1){seen.add(k);todo.push([nx,nz]);}}
    }
    if(n>=4){centres.push([sx/n,sz/n]);sizes.push(n);}
  }
  const ratio=after/before;assert(ratio>=2&&ratio<=3,ratio);
  const {cell,base}=setup(),f=field(cell);
  // R1 sand reference: compare submitted roots, including the changed middle card rate.
  const old=field((x,z)=>{const v=base(x,z),c=grassColony(x+.5,z+.5),h=smooth(.30,.78,c);
    v.density=Math.round(v.density*h);v.midPatch=Math.min(1.8,(.12+1.5*c)*.8)*h;
    v.placeable=+(v.density>0||v.midPatch>0);return v;});
  let oldNear=0,newNear=0,oldMid=0;
  for(let z=-48;z<48;z++)for(let x=-48;x<48;x++){
    oldNear+=nearTile(old,x,z,{size:1}).count;newNear+=nearTile(f,x,z,{size:1}).count;
    oldMid+=midTile(old,x,z,{size:1,cardRate:.62,maxCards:1}).count;
  }
  const points=roots(f);let isolated=0;
  assert(newNear/oldNear>=2&&newNear/oldNear<=3);assert(points.length>=oldMid);
  assert((newNear+points.length)/(oldNear+oldMid)>=2);
  for(const [x,z] of points)if(!points.some(([a,b])=>(x!==a||z!==b)&&Math.hypot(a-x,b-z)<3))isolated++;
  const nearest=centres.map((p,i)=>Math.min(...centres.filter((_,j)=>i!==j).map(q=>Math.hypot(p[0]-q[0],p[1]-q[1]))));
  assert(points.length>150);assert(isolated/points.length<.08,isolated/points.length);assert(centres.length>10);assert(cv(nearest)>.25);assert(cv(sizes)>.25);
  t.diagnostic(JSON.stringify({habitatRatio:ratio,oldNear,newNear,oldMid,midRoots:points.length,isolatedFraction:isolated/points.length,centres:centres.length,centreSpacingCV:cv(nearest),colonySizeCV:cv(sizes)}));
});
test('jittered roots stay outside trunks/boxes/roads/facilities; root and house tufts survive sand',t=>{
  const opts={colliders:buildColliders({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},extraCircles:[{x:0,z:0,r:1,height:8}],extraBoxes:[{x:20,z:0,w:4,d:6,rotY:.4}]}),paths:{lane:{xyz_m:[[-20,50,0],[-20,-50,0]]}},facilityBoxes:[{x:0,z:25,w:16,d:10,rotY:.3}]};
  const f=field(setup(flat,()=>0,opts).cell),points=roots(f,true),reject=grassExclusions(flat,{...opts,pathMargin:2.5,rootMargin:0});let ring=0,base=0,fernRing=0;
  for(const [x,z,species] of points){assert.equal(reject(x,z),null);const b=opts.facilityBoxes[0],dx=x-b.x,dz=z-b.z;assert(Math.abs(dx*Math.cos(.3)-dz*Math.sin(.3))>8||Math.abs(dx*Math.sin(.3)+dz*Math.cos(.3))>5);
    if(Math.hypot(x,z)>1.5&&Math.hypot(x,z)<2.5){ring++;fernRing+=species===FERN;}
    if(Math.hypot(x-20,z)<6)base++;
  }
  assert(ring>0);assert(fernRing>0);assert(base>0);t.diagnostic(JSON.stringify({nearRoots:points.length,trunkRingRoots:ring,houseBaseRoots:base}));
});
test('both banks 1–25m restore fern/reed tufts, but sea swash, slopes and dry lane exclusions win',t=>{
  const terrain={...flat,riverDistanceAt:(x)=>Math.abs(x)-2},f=field(setup(terrain,()=>0).cell),points=roots(f);const banks=[0,0];
  for(const [x,z,species] of points)if(Math.abs(x)>=3&&Math.abs(x)<=27){banks[+(x>0)]++;assert(species===FERN||species===SUSUKI);}
  assert(banks.every(n=>n>150));assert(Math.max(...banks)/Math.min(...banks)<1.25,JSON.stringify(banks));
  for(const terrain of [{...flat,seaDistanceAt:()=>9},{...flat,slopeAt:()=>33},{...flat,heightAt:x=>10+x},{...flat,walkable:()=>false}]){
    const {cell}=setup(terrain);for(let z=-8;z<8;z++)for(let x=-8;x<8;x++){const v=cell(x,z);assert.equal(v.placeable,0);assert.equal(v.midPatch,0);}
  }
  t.diagnostic(JSON.stringify({bankMidRoots:banks}));
});
test('middle tail survives 122m, varies along equal-distance rows, and keeps crest suppression',t=>{
  const offsets=[],densities=[];for(let x=-138;x<=138;x+=2){const z=Math.sqrt(140**2-x*x);offsets.push(midGrassBandOffset(x,z));densities.push(midGrassDensityAt(x,z,140));}
  assert(Math.max(...offsets)-Math.min(...offsets)>12);assert(Math.max(...densities)-Math.min(...densities)>.02);assert(midGrassDensityAt(20,30,122)>0);assert.equal(midGrassDensityAt(20,30,158),0);
  const ridge={...flat,heightAt:(x,z)=>10+.7*Math.cos(x*.4)+.7*Math.cos(z*.4)},a=setup(flat,()=>2),b=setup(ridge,()=>2);
  assert(b.env(.5,.5).crest>.5);assert(b.cell(0,0).midPatch<a.cell(0,0).midPatch*.6);
  t.diagnostic(JSON.stringify({equalDistanceOffsetRange:[Math.min(...offsets),Math.max(...offsets)],densityRange:[Math.min(...densities),Math.max(...densities)]}));
});
