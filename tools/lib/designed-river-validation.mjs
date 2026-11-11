import assert from 'node:assert/strict';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { prepareRivers } from '../../dist/valley/kamakura-rivers.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
export function verifyDesignedRivers(data) {
  const prepared=prepareRivers(data.rivers),scales=[];
  for(const scale of [1,1.8]){const terrain=createKamakuraTerrain(data,scale);let accepted=0,total=0;
    for(const r of data.rivers.rivers)r.xy_m.forEach(([x,y],i)=>{const depth=(r.water_elev_m[i]*scale-terrain.heightAt(x,-y))/scale;total++;if(Math.abs(depth-r.depth_m[i])<=.15)accepted++;});
    scales.push({scale,fraction:accepted/total});assert(accepted/total>=.98,'Designed water/terrain depth acceptance below 98%');
  }
  const vertices=prepared.chunks.reduce((n,c)=>n+c.positions.length/3,0);assert(vertices<=40000);
  for(const chunk of prepared.chunks){assert(chunk.positions.every(Number.isFinite)&&chunk.uvs.every(Number.isFinite));for(let i=0;i<chunk.indices.length;i+=3){const [a,b,c]=chunk.indices.slice(i,i+3).map(n=>chunk.positions.slice(n*3,n*3+3));assert((b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2])>1e-6);}}
  const excludedSegments=prepared.ribbons.reduce((n,r)=>n+r.excludedSegments,0);assert.equal(excludedSegments,0);
  return {vertices,excludedSegments,scales};
}
