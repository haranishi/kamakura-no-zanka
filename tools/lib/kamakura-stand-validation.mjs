// Private geometry stays in memory; aggregate measurements go to stdout only.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { decodeVeg, vegCircles } from '../../dist/valley/kamakura-veg.js';
import { prepareStands, standPolicy, standChildCount, generateStandChunk, planStandChunks, combineStandChunks } from '../../dist/valley/kamakura-stands.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { houseBox, houseMatrix } from '../../dist/valley/kamakura-houses.js';
import { buildColliders, addColliderCircles } from '../../dist/valley/collision.js';
import { kamakuraSpawn } from '../../dist/valley/kamakura-spawn.js';
import { load, THREE } from '../../tests/helpers/tree-modules.mjs';
import { wind, stubRenderer } from '../../tests/helpers/tree-field.mjs';
export async function verifyStands(data, dir, privateHouses, facilityBoxes = []) {
  if (!data.meta.veg) return { skip: 'meta.veg が無いため林分検査を省略' };
  const info=JSON.parse(await fs.readFile(path.join(dir,'veg.json'),'utf8')),b=await fs.readFile(path.join(dir,'veg_f32.bin'));
  const items=decodeVeg(info,b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength),data.meta.veg.count);
  const terrain=createKamakuraTerrain(data),spawn=kamakuraSpawn(terrain,'');
  const boxes=privateHouses?privateHouses.houses.instances.map(i=>houseBox(privateHouses.houses.kinds.get(i.kind),houseMatrix(i,terrain,privateHouses.bodies.get(i.kind)),privateHouses.bodies.get(i.kind))):[];
  const options={boxes:[...boxes,...facilityBoxes],paths:data.patches?.paths||{},spawn};
  const tiers=[1,2].map(t=>items.filter(i=>i.tier===t).length);assert(tiers.every(n=>n>0));
  const {buildKamakuraStands}=await load('kamakura-stand-view.js');
  const {vegHeight}=await load('kamakura-veg-view.js');
  const reports={};let expandable=0;
  for(const quality of ['standard','light']){
    const p=prepareStands(items,terrain,options,standPolicy(quality));
    if(quality==='standard')expandable=p.expandable;
    let estimatedChildrenBeforeExclusions=0;
    for(const a of p.grid.values())for(const i of a)estimatedChildrenBeforeExclusions+=standChildCount(i.crown,p.policy.light);
    const col=buildColliders({bounds:terrain.bounds,extraBoxes:boxes});
    const view=buildKamakuraStands(p,{wind,sunDir:new THREE.Vector3(1,1,1),quality,renderer:stubRenderer(),colliders:col});
    const camera={position:{x:spawn.x,y:terrain.heightAt(spawn.x,spawn.z)+2,z:spawn.z}};
    let s=view.update(camera);while(s.pending)s=view.update(camera);
    const children=combineStandChunks(view.resident);
    const circles=vegCircles(children,vegHeight),start=performance.now();
    const release=addColliderCircles(col,circles);const circleRegistrationMs=performance.now()-start;release();
    // Tile-visible estimate, no camera orientation/frustum/GPU occlusion is assumed.
    const distantTriangles=view.distant.reduce((sum,d)=>sum+(d.mesh.visible?d.mesh.count*d.mesh.geometry.index.count/3:0),0);
    const spawnStats={tileVisibleStands:s.distant,residentChildren:children.active.length,drawnChildren:s.children.counts,
      childTrianglesWithBoards:s.children.triangles,distantTriangles,childDropped:s.children.dropped,circles:circles.length,circleRegistrationMs};
    // A forest location is measured too: the default urban spawn may contain no stands.
    let forestKey=null, forestCandidates=-1;
    for(const [key,a] of p.grid){const count=a.reduce((n,i)=>n+standChildCount(i.crown,p.policy.light),0);if(count>forestCandidates){forestCandidates=count;forestKey=key;}}
    let forest=null;
    if(forestKey){
      const [x,z]=forestKey.split(',').map(Number);camera.position.x=x*256+128;camera.position.z=z*256+128;
      s=view.update(camera);while(s.pending)s=view.update(camera);
      const active=combineStandChunks(view.resident),circles=vegCircles(active,vegHeight),start=performance.now();
      const release=addColliderCircles(col,circles);const circleRegistrationMs=performance.now()-start;release();
      forest={residentChildren:active.active.length,drawnChildren:s.children.counts,childTrianglesWithBoards:s.children.triangles,
        childDropped:s.children.dropped,circles:circles.length,circleRegistrationMs};
      assert(active.active.length>0);assert(circles.length>0);
    }
    view.dispose();assert.equal(col.circles.length,0);
    // Walk both axes and every occupied cell centre to exercise create/retain/evict.
    // Pure plan simulation has no resource allocation and never stores all children.
    const resident=new Map();let maxResidentChunks=0;
    const visit=pos=>{const plan=planStandChunks(p,resident,pos);for(const k of plan.remove)resident.delete(k);for(const k of plan.create)resident.set(k,true);maxResidentChunks=Math.max(maxResidentChunks,resident.size);assert(resident.size<=36);};
    for(const key of p.grid.keys()){
      const [x,z]=key.split(',').map(Number);visit({x:x*256+128,z:z*256+128});
    }
    for(const axis of ['x','z'])for(let n=-2000;n<=2000;n+=64)visit({x:axis==='x'?spawn.x+n:spawn.x,z:axis==='z'?spawn.z+n:spawn.z});
    visit({x:1e6,z:1e6});assert.equal(resident.size,0);
    // Check regeneration using a single occupied chunk, without persisting coordinates.
    const first=p.grid.keys().next().value;if(first)assert.deepEqual(generateStandChunk(p,first),generateStandChunk(p,first));
    reports[quality]={expandable:p.expandable,estimatedChildrenBeforeExclusions,spawn:spawnStats,forest,maxResidentChunks,geometricResidentUpperBound:36};
  }
  return {tiers,expandable,quality:reports,measurement:'Node CPU and bundled Three only; tile-visible triangle estimates, no GPU/frustum measurement'};
}
