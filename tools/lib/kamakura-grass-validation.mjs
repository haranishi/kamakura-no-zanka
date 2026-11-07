// Private data stays outside Git. Return aggregate grass counts/timings only, never locations.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { loadKamakura } from '../../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { kamakuraSpawn } from '../../dist/valley/kamakura-spawn.js';
import { createSurfaceCodeAt } from '../../dist/valley/kamakura-surface.js';
import { createGrassCell, createGrassWindows, grassExclusions } from '../../dist/valley/kamakura-grass-field.js';
import { prepareVeg, vegCircles } from '../../dist/valley/kamakura-veg.js';
import { buildColliders } from '../../dist/valley/collision.js';
import { loadHouseView } from '../../tests/helpers/kamakura-house-view.mjs';
import { loadFacilityView } from '../../tests/helpers/kamakura-facility-view.mjs';
import { load, THREE } from '../../tests/helpers/tree-modules.mjs';
const round = n => Math.round(n * 100) / 100;
export async function verifyPrivateGrass(dir) {
  const data = await loadKamakura(async url => {
    const b = await fs.readFile(path.join(dir, path.basename(url)));
    return { ok: true, json: async () => JSON.parse(b.toString()), arrayBuffer: async () => b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength) };
  });
  if (!data.surface) return { skipped: 'v0.9の地表クラスなし' };
  const terrain = createKamakuraTerrain(data), spawn = kamakuraSpawn(terrain,''), scene = new THREE.Scene();
  const {buildKamakuraHouses} = await loadHouseView(), {buildKamakuraFacilities} = await loadFacilityView();
  const houses = data.houses ? await buildKamakuraHouses(data.houses,terrain,scene) : null;
  const facilities = data.facilities ? await buildKamakuraFacilities(data.facilities,terrain,scene) : null;
  try {
    const boxes = [...(houses?.boxes || []),...(facilities?.exclusionBoxes || [])];
    const prepared = prepareVeg(data.veg || [],terrain,{boxes,paths:data.patches?.paths || {},spawn});
    const {vegHeight} = await load('kamakura-veg-view.js');
    const col = buildColliders({bounds:terrain.bounds,extraBoxes:boxes,extraCircles:vegCircles(prepared,vegHeight)});
    const surfaceCodeAt = createSurfaceCodeAt(data.meta,data.surface);
    const evaluate = createGrassCell(terrain,{surfaceCodeAt,exclude:grassExclusions(terrain,{colliders:col,paths:data.patches?.paths || {}})});
    const w = createGrassWindows(evaluate); w.plan(spawn);
    let start = performance.now(); w.work(()=>0); const first = w.commit(); const initialMs = performance.now()-start;
    w.plan({x:spawn.x+24,z:spawn.z}); start=performance.now(); w.work(()=>0); const moved=w.commit(); const moveMs=performance.now()-start;
    assert.equal(moved.stats.evaluated,2304); assert.equal(moved.stats.reused,6912); assert(first.heights.every(Number.isFinite));
    const sites = { spawn };
    // Deterministic grid search for representative walkable grass/forest cells; never export points.
    const {width,height,cell_m:cell} = data.meta.grid;
    for(let j=0;j<height&&(!sites.grass||!sites.forest);j+=7)for(let i=0;i<width&&(!sites.grass||!sites.forest);i+=7){
      const x=(i-(width-1)/2)*cell,z=(j-(height-1)/2)*cell,code=surfaceCodeAt(x,z),name=code===2?'grass':code===3?'forest':null;
      if(name&&!sites[name]&&evaluate(Math.floor(x),Math.floor(z)).placeable)sites[name]={x,z};
    }
    const {buildKamakuraGrass} = await load('kamakura-grass-view.js');
    const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
    const samples={};
    for(const [name,pos]of Object.entries(sites)){
      const v=buildKamakuraGrass({data,terrain,colliders:col,wind,sunDir:new THREE.Vector3(1,1,0)});
      try {
        const camera={position:new THREE.Vector3(pos.x,terrain.heightAt(pos.x,pos.z)+1.7,pos.z)};
        for(let frame=0;frame<2000;frame++){
          v.update(camera);const s=v.stats();if(s.switches&&!s.pending&&s.queue===0)break;
          assert(frame<1999,'Private grass failed to settle (location withheld)');
        }
        const s=v.stats();samples[name]={nearBlades:s.nearBlades,midCards:s.midCards,triangles:s.triangles,maxWindowFrameMs:round(s.maxWorkMs)};
      } finally {v.dispose();}
    }
    return {windowM:96,initialCells:9216,newCells:moved.stats.evaluated,reusedCells:moved.stats.reused,initialMs:round(initialMs),moveMs:round(moveMs),samples};
  } finally {houses?.dispose();facilities?.dispose();}
}
