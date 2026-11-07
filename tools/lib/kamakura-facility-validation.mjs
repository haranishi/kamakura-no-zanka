// Private geometry/elevations stay in memory. Reports are stdout-only, never fixtures.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { parseGlb, readAccessor } from './glb.mjs';
import { decodeFacilities, facilityPlacement, facilityVertexY, facilityFootprint, facilityGroundSamples, facilitySolid, facilityExcludesTrees } from '../../dist/valley/kamakura-facilities.js';
import { houseIntersects } from '../../dist/valley/kamakura-houses.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { buildColliders, moveActor } from '../../dist/valley/collision.js';
export async function readPrivateFacilities(dir,data) {
  if(!data.meta.facilities)return null;
  assert.equal(data.meta.facilities.file,'facilities.json');assert.equal(data.meta.facilities.kit,'facilities.glb');
  const [c,b]=await Promise.all(['facilities.json','facilities.glb'].map(n=>fs.readFile(path.join(dir,n))));
  const facilities=decodeFacilities(JSON.parse(c));facilities.kit=b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
  assert.equal(facilities.nodes.length,data.meta.facilities.count);assert.equal(facilities.catalog.total_triangles,data.meta.facilities.total_triangles);
  const doc=parseGlb(b),positions=new Map(),meshNodes=doc.json.nodes.filter(n=>n.mesh!==undefined);
  assert.equal(meshNodes.length,facilities.nodes.length);assert.equal(new Set(meshNodes.map(n=>n.name)).size,meshNodes.length);
  for(const n of facilities.nodes) {
    const node=meshNodes.find(a=>a.name===n.node);assert(node,'Private facility node missing');
    assert(!node.matrix&&!node.rotation&&!node.translation&&!node.scale,'Facility export must bake transforms');
    const values=[];let triangles=0;
    for(const p of doc.json.meshes[node.mesh].primitives) {
      const a=readAccessor(doc,p.attributes.POSITION);for(const v of a.array)values.push(v);
      triangles+=(p.indices===undefined?a.count:readAccessor(doc,p.indices).count)/3;
    }
    assert.equal(triangles,n.triangles);assert(values.every(Number.isFinite));positions.set(n.node,values);
  }
  const exclusionBoxes=facilities.nodes.filter(facilityExcludesTrees).map(n=>facilityFootprint(n,positions.get(n.node),n.part!=='stairs'));
  return {facilities,positions,exclusionBoxes};
}
export function verifyFacilities(data,input) {
  if(!input)return {skip:'meta.facilities が無いため施設検査を省略'};
  const {facilities,positions}=input,boxes=[],exclusions=[],byScale={},overlaps={spawn:[],paths:[],walkingRoutes:[]};
  for(const n of facilities.nodes) {
    const p=positions.get(n.node);
    if(facilitySolid(n))boxes.push(facilityFootprint(n,p));
    if(facilityExcludesTrees(n))exclusions.push(facilityFootprint(n,p,n.part!=='stairs'));
  }
  for(const scale of [1,1.8]) {
    const terrain=createKamakuraTerrain(data,scale),s={hard:0,soft:0,softVertices:0,maxSoftError:0,floating:0,maxFloat:0,buried:0,maxBury:0,buriedOver:{'.5':0,'1':0,'1.5':0,'3':0},warnings:[]};
    for(const n of facilities.nodes) {
      const p=positions.get(n.node),placed=facilityPlacement(n,p,terrain);
      if(n.soft) {
        s.soft++;
        for(let i=0;i<p.length;i+=3) {
          const expected=facilityVertexY(n,terrain.heightAt(n.anchor_xz[0]+p[i],n.anchor_xz[1]+p[i+2]),p[i+1]),error=Math.abs(placed.positions[i+1]-expected);
          assert(error<=Math.max(1e-5,Math.abs(expected)*1.2e-7),'Soft vertex differs beyond float32 precision');
          s.softVertices++;s.maxSoftError=Math.max(s.maxSoftError,error);
        }
      } else {
        s.hard++;
        for(let i=0;i<p.length;i++)assert.equal(placed.positions[i],Math.fround(p[i]));
        const box=facilityFootprint(n,p),ground=facilityGroundSamples(box,terrain),bottom=placed.position.y+box.bottom;
        const floating=Math.max(0,bottom-ground.low),buried=Math.max(0,ground.high-bottom);
        if(floating>1e-5)s.floating++;if(buried>1e-5)s.buried++;
        s.maxFloat=Math.max(s.maxFloat,floating);s.maxBury=Math.max(s.maxBury,buried);
        for(const k of Object.keys(s.buriedOver))if(buried>+k)s.buriedOver[k]++;
        if(floating>.5||buried>1.5)s.warnings.push({node:n.node,facility:n.facility,floating,buried});
      }
    }
    s.warningCount=s.warnings.length; s.warnings.sort((a,b)=>Math.max(b.floating,b.buried)-Math.max(a.floating,a.buried));s.warnings=s.warnings.slice(0,10);
    byScale[scale]=s;
  }
  const spawn={x:data.meta.spawn.x,z:-data.meta.spawn.y}, terrain=createKamakuraTerrain(data);
  const empty=buildColliders({bounds:terrain.bounds}), yaw=-data.meta.spawn.yaw_deg_clockwise_from_north*Math.PI/180;
  const walk=[{...spawn,y:data.meta.spawn.z}];
  // Match the existing 200 x 0.1m departure regression without letting a new box mask an overlap.
  for(let i=0;i<200;i++)walk.push(moveActor(empty,terrain,walk.at(-1),-Math.sin(yaw)*.1,-Math.cos(yaw)*.1));
  for(const box of boxes) {
    const location={node:box.id,x:box.x,z:box.z};
    if(houseIntersects(box,spawn,spawn,.3))overlaps.spawn.push(location);
    for(const [route,p] of Object.entries(data.patches?.paths||{})) {
      for(let i=1;i<p.xyz_m.length;i++) {
        const a=p.xyz_m[i-1],b=p.xyz_m[i];
        if(houseIntersects(box,{x:a[0],z:-a[1]},{x:b[0],z:-b[1]},.3)) {overlaps.paths.push({...location,route});break;}
      }
    }
    for(let i=1;i<walk.length;i++)if(houseIntersects(box,walk[i-1],walk[i],.3)) {
      overlaps.walkingRoutes.push({...location,route:'spawn-forward-200-steps',radius:.3});break;
    }
  }
  const col=buildColliders({bounds:terrain.bounds,extraBoxes:boxes});
  return {count:facilities.nodes.length,parts:facilities.catalog.parts,triangles:facilities.catalog.total_triangles,
    colliders:col.boxes.length,treeExclusionBoxes:exclusions.length,overlaps,grounding:{spacing:.5,byVerticalScale:byScale}};
}
