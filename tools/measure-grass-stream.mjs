// Optional private-data CPU measurement. Output contains aggregates only, never source points.
// NODE_OPTIONS=--max-old-space-size=1536 timeout 300 node tools/measure-grass-stream.mjs
// Set KZ_WORLD_DIR and KZ_VIEWS to existing read-only data and camera definitions.
import fs from 'node:fs/promises';
import path from 'node:path';
import {loadKamakura} from '../dist/valley/kamakura-data.js';
import {createKamakuraTerrain} from '../dist/valley/kamakura-terrain.js';
import {prepareVeg,vegCircles} from '../dist/valley/kamakura-veg.js';
import {buildColliders} from '../dist/valley/collision.js';
import {loadHouseView} from '../tests/helpers/kamakura-house-view.mjs';
import {loadFacilityView} from '../tests/helpers/kamakura-facility-view.mjs';
import {load,THREE} from '../tests/helpers/tree-modules.mjs';
const dir=process.env.KZ_WORLD_DIR,viewsFile=process.env.KZ_VIEWS;
if(!dir||!viewsFile){console.log('KZ_WORLD_DIR/KZ_VIEWS未設定：私有データ測定を省略');process.exit(0);}
const data=await loadKamakura(async url=>{const b=await fs.readFile(path.join(dir,path.basename(url)));return {ok:true,json:async()=>JSON.parse(b.toString()),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};});
const terrain=createKamakuraTerrain(data),scene=new THREE.Scene();
const {buildKamakuraHouses}=await loadHouseView(),{buildKamakuraFacilities}=await loadFacilityView();
const houses=data.houses?await buildKamakuraHouses(data.houses,terrain,scene):null;
const facilities=data.facilities?await buildKamakuraFacilities(data.facilities,terrain,scene):null;
try{
 const boxes=[...(houses?.boxes||[]),...(facilities?.exclusionBoxes||[])];
 const prepared=prepareVeg(data.veg||[],terrain,{boxes,paths:data.patches?.paths||{}});
 const {vegHeight}=await load('kamakura-veg-view.js');
 const colliders=buildColliders({bounds:terrain.bounds,extraBoxes:boxes,extraCircles:vegCircles(prepared,vegHeight)});
 const {buildKamakuraGrass}=await load('kamakura-grass-view.js');
 globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
 const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
 const views=JSON.parse(await fs.readFile(viewsFile,'utf8'));
 for(const index of [0,1,4]){
  const site=views[index],p=new URLSearchParams(site.query),[x,north]=p.get('pos').split(',').map(Number),z=-north,pos={x,z},camera={position:new THREE.Vector3(x,terrain.heightAt(x,z)+2,z)};
  const rows=[];
  for(const search of ['?grass9=0','']){
   const v=buildKamakuraGrass({data,terrain,colliders,facilityBoxes:facilities?.exclusionBoxes||[],search,wind,sunDir:new THREE.Vector3(1,1,0),schedule:()=>0,cancel:()=>{}});
   try{
    v.warm(camera,pos);v.update(camera,pos);let s=v.stats();while(s.pending||s.queue){v.update(camera,pos);s=v.stats();}
    let holesMax=s.holes30??0,appearedMax=s.appeared30??0;
    if(!search && index===0)for(let frame=0;frame<240;frame++){
      const hero={x:x+frame*8/60,y:terrain.heightAt(x+frame*8/60,z),z};camera.position.x=hero.x;
      v.updateHero(hero,8,false,1/60);v.update(camera,hero);
      const moving=v.stats();holesMax=Math.max(holesMax,moving.holes30);appearedMax=Math.max(appearedMax,moving.appeared30);
    }
    let capacityBytes=0;v.group.traverse(m=>{if(m.isMesh)capacityBytes+=m.geometry.attributes.iRoot.data.array.byteLength;});
    rows.push({triangles:s.triangles,nearBlades:s.nearBlades,drawCalls:s.drawCalls,capacityBytes,holes30:s.holes30,appeared30:s.appeared30,holesMax,appearedMax});
   }finally{v.dispose();}
  }
  if(rows[1].triangles>rows[0].triangles*1.6)process.exitCode=1;
  console.log(JSON.stringify({view:site.name,old:rows[0],new:rows[1],triangleRatio:rows[1].triangles/rows[0].triangles}));
 }
}finally{houses?.dispose();facilities?.dispose();}
