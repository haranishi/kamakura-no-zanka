// Optional private validation: retain only aggregates; never return points or source arrays.
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadKamakura} from '../../dist/valley/kamakura-data.js';
import {createKamakuraTerrain} from '../../dist/valley/kamakura-terrain.js';
import {kamakuraSpawn} from '../../dist/valley/kamakura-spawn.js';
import {createSurfaceCodeAt} from '../../dist/valley/kamakura-surface.js';
import {prepareVeg,vegCircles} from '../../dist/valley/kamakura-veg.js';
import {buildColliders} from '../../dist/valley/collision.js';
import {loadHouseView} from './kamakura-house-view.mjs';
import {loadFacilityView} from './kamakura-facility-view.mjs';
import {load,THREE} from './tree-modules.mjs';
export async function validateGrassLook(dir) {
  const data=await loadKamakura(async url=>{const b=await fs.readFile(path.join(dir,path.basename(url)));return {ok:true,json:async()=>JSON.parse(b.toString()),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};});
  if(!data.surface)return {skipped:'私有v0.9の地表クラスなし'};
  const terrain=createKamakuraTerrain(data), spawn=kamakuraSpawn(terrain,''), scene=new THREE.Scene();
  const {buildKamakuraHouses}=await loadHouseView(),{buildKamakuraFacilities}=await loadFacilityView();
  const houses=data.houses?await buildKamakuraHouses(data.houses,terrain,scene):null;
  const facilities=data.facilities?await buildKamakuraFacilities(data.facilities,terrain,scene):null;
  try {
    const boxes=[...(houses?.boxes||[]),...(facilities?.exclusionBoxes||[])];
    const prepared=prepareVeg(data.veg||[],terrain,{boxes,paths:data.patches?.paths||{},spawn});
    const {vegHeight}=await load('kamakura-veg-view.js');
    const colliders=buildColliders({bounds:terrain.bounds,extraBoxes:boxes,extraCircles:vegCircles(prepared,vegHeight)});
    const surface=createSurfaceCodeAt(data.meta,data.surface), sites=[spawn];let grass=false,forest=false;
    const {width,height,cell_m:cell}=data.meta.grid;
    for(let j=0;j<height&&(!grass||!forest);j+=7)for(let i=0;i<width&&(!grass||!forest);i+=7){const x=(i-(width-1)/2)*cell,z=(j-(height-1)/2)*cell,code=surface(x,z);if(((code===2&&!grass)||(code===3&&!forest))&&terrain.walkable(x,z)&&terrain.slopeAt(x,z)<20&&terrain.waterAt(x,z)===0){sites.push({x,z});if(code===2)grass=true;else forest=true;}}
    const {buildKamakuraGrass}=await load('kamakura-grass-view.js');
    const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}}, samples=[];
    for(const pos of sites) {
      const camera={position:new THREE.Vector3(pos.x,terrain.heightAt(pos.x,pos.z)+1.7,pos.z)}, hero={x:pos.x,y:terrain.heightAt(pos.x,pos.z),z:pos.z};
      const times=[],counts=[];
      for(const search of ['?glook=0','']) {
        const v=buildKamakuraGrass({data,terrain,colliders,search,wind,sunDir:new THREE.Vector3(1,1,0)});
        try {
          let start=performance.now();v.warm(camera,pos);const warmMs=performance.now()-start,s=v.stats();
          if(s.pending||s.queue)throw new Error('warm left incomplete grass');
          for(let i=0;i<500;i++){v.updateHero(hero,3,false,1/60);v.update(camera,pos);}
          const batches=[];for(let k=0;k<5;k++){start=performance.now();for(let i=0;i<1000;i++){v.updateHero(hero,3,false,1/60);v.update(camera,pos);}batches.push((performance.now()-start)/1000);}
          batches.sort((a,b)=>a-b);
          start=performance.now();for(let i=0;i<600;i++){hero.x=pos.x+i/12;hero.y=terrain.heightAt(hero.x,hero.z);camera.position.x=hero.x;v.updateHero(hero,5,false,1/60);v.update(camera,hero);}const movingMs=(performance.now()-start)/600;
          camera.position.x=pos.x;hero.x=pos.x;
          times.push({warmMs,windowMs:s.lastWorkMs,steadyMs:batches[2],movingMs});counts.push({lawn:s.lawn||0,tall:s.tallBlades??s.nearBlades,flowers:s.flowers||0,mid:s.midCards,triangles:s.triangles});
        }finally{v.dispose();}
      }
      samples.push({old:times[0],look:times[1],cpuDeltaMs:times[1].steadyMs-times[0].steadyMs,movingDeltaMs:times[1].movingMs-times[0].movingMs,counts:counts[1]});
    }
    const range=get=>{const a=samples.map(get);return {min:Math.min(...a),max:Math.max(...a)};};
    return {samples:samples.length,warmMs:range(s=>s.look.warmMs),oldWarmMs:range(s=>s.old.warmMs),windowMs:range(s=>s.look.windowMs),cpuDeltaMs:range(s=>s.cpuDeltaMs),movingDeltaMs:range(s=>s.movingDeltaMs),counts:Object.fromEntries(['lawn','tall','flowers','mid','triangles'].map(k=>[k,range(s=>s.counts[k])]))};
  }finally{houses?.dispose();facilities?.dispose();}
}
