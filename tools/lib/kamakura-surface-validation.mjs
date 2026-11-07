// Private inputs stay outside the repository. Never emit surface cell counts.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { validateMeta } from '../../dist/valley/kamakura-data.js';
import { decodeRivers } from '../../dist/valley/kamakura-rivers.js';
import { createRiverIndex, createSurfaceAt, surfaceWeights, segmentBankDistance } from '../../dist/valley/kamakura-surface.js';
import { mulberry32 } from '../../dist/valley/scatter.js';
export async function verifyPrivateSurface(dir) {
  const meta=validateMeta(JSON.parse(await fs.readFile(path.join(dir,'meta.json'),'utf8')));
  if(!meta.surface) return { skipped: 'meta.surfaceなし：v0.9の足元データが必要' };
  assert.equal(meta.surface.file,'surface_class_u8.bin');
  const surface=new Uint8Array(await fs.readFile(path.join(dir,'surface_class_u8.bin')));
  assert.equal(surface.length,meta.grid.width*meta.grid.height,'Private surface length mismatch');
  assert(surface.every(v=>v<=7||v===255),'Private surface contains unknown classes');
  const sample=createSurfaceAt(meta,surface),rng=mulberry32(601);
  for(let n=0;n<1000;n++) {
    const i=Math.floor(rng()*meta.grid.width),j=Math.floor(rng()*meta.grid.height);
    assert.deepEqual(sample((i-(meta.grid.width-1)/2)*meta.grid.cell_m,(j-(meta.grid.height-1)/2)*meta.grid.cell_m),surfaceWeights(surface[j*meta.grid.width+i]),'Private surface orientation mismatch');
  }
  const rivers=decodeRivers(JSON.parse(await fs.readFile(path.join(dir,'rivers.json'),'utf8'))),index=createRiverIndex(rivers);
  const points=[];
  for(let n=0;n<1000;n++) points.push([(rng()-.5)*meta.grid.width*meta.grid.cell_m,(rng()-.5)*meta.grid.height*meta.grid.cell_m]);
  for(const [x,z] of points.slice(0,100)) {
    assert(Math.abs(index.riverDistanceAt(x,z)-Math.min(...index.segments.map(s=>segmentBankDistance(s,x,z))))<1e-8,'Private indexed/brute-force mismatch (values withheld)');
  }
  for(const s of index.segments.filter((_,i)=>i%100===0)) assert.equal(index.riverDistanceAt(s.ax,s.az),0,'Private river centre must be water');
  const start=performance.now();for(let k=0;k<10;k++)for(const [x,z]of points)index.riverDistanceAt(x,z);
  return {cellM:index.cell,cells:index.cells.size,segments:index.segments.length,references:index.references,queryMs:(performance.now()-start)/10000};
}
