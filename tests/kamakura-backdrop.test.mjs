import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKDROP as C,backdropPoint,backdropRange,buildBackdrop} from '../dist/valley/kamakura-backdrop.js';
import {createKamakuraTerrain} from '../dist/valley/kamakura-terrain.js';
import {readPrivateData} from '../tools/lib/kamakura-validation.mjs';
// North and east are land; south is sea; west crosses a coast. Shared southern corners remain sea.
const synthetic=()=>({bounds:{minX:-600,maxX:600,minZ:-400,maxZ:400},cell:20,heightAt:(x,z)=>-.2*z+(x+600)/1200*76});
function verify(p,t){
  const b=t.bounds;
  assert(p.triangles<=C.maxTriangles);assert(p.draws<=C.maxDraws);
  for(const s of p.segments){
    const pos=s.positions;
    for(let i=0;i<pos.length;i+=3){
      const x=pos[i],y=pos[i+1],z=pos[i+2],dx=Math.max(0,b.minX-x,x-b.maxX),dz=Math.max(0,b.minZ-z,z-b.maxZ);
      assert(!(x>b.minX&&x<b.maxX&&z>b.minZ&&z<b.maxZ),'No vertex inside terrain');
      assert(Math.hypot(dx,dz)<=C.extentM+.1,'No vertex beyond exterior extent');
      assert(Number.isFinite(y)&&y>=C.landThresholdM-.02,'Finite land height');
      assert(t.heightAt(Math.max(b.minX,Math.min(b.maxX,x)),Math.max(b.minZ,Math.min(b.maxZ,z)))>=C.landThresholdM-.02,'No extension of a sea edge');
      if(Math.hypot(dx,dz)<.02)assert(Math.abs(y-t.heightAt(x,z))<=.5,'Seam height within half a metre');
      else assert(y>=C.minHeightM,'Land clears sea away from shared seam');
    }
    for(let i=0;i<s.indices.length;i+=3){
      const a=s.indices[i]*3,b=s.indices[i+1]*3,c=s.indices[i+2]*3;
      assert((pos[b]-pos[a])*(pos[c+2]-pos[a+2])-(pos[b+2]-pos[a+2])*(pos[c]-pos[a])<=.02,'Upward winding');
      const x=(pos[a]+pos[b]+pos[c])/3,z=(pos[a+2]+pos[b+2]+pos[c+2])/3;
      assert(backdropPoint(t,x,z).edgeHeight>=C.landThresholdM-.02,'No triangle crosses an extended marine interval');
    }
  }
}

test('S3 synthetic exterior is deterministic, bounded, land-only and matches the original boundary',()=>{
  const t=synthetic(),p=buildBackdrop(t),again=buildBackdrop(t);
  verify(p,t);assert.deepEqual(p,again);assert.equal(p.landEdges.north,1);assert(p.landEdges.east>.9);assert.equal(p.landEdges.south,0);assert(p.landEdges.west>.4&&p.landEdges.west<.6);
  assert.equal(p.draws,2);assert(p.work.heightSamples>0);
  for(const s of p.segments)for(let i=0;i<s.positions.length;i+=3)assert(s.positions[i+2]<t.bounds.maxZ,'An entirely marine south edge gets no exterior vertices');
});

test('S3 nearest edge/corner decisions, exact heights, mountain envelopes and low coastal seam exception',()=>{
  const t=synthetic(),b=t.bounds;
  assert.equal(backdropPoint(t,b.minX-100,b.minZ-200).land,true);
  assert.equal(backdropPoint(t,b.minX-200,b.maxZ+100).land,false);
  assert.equal(backdropPoint(t,b.maxX+200,b.maxZ+100).land,false);
  assert.equal(backdropPoint(t,0,0).land,false);
  for(const [x,z] of [[b.minX,-200],[b.maxX,0],[0,b.minZ]])assert.equal(backdropPoint(t,x,z).height,t.heightAt(x,z));
  for(let x=-2000;x<2000;x+=100){const p=backdropPoint(t,x,b.minZ-800);assert(p.height>=C.nearMinM&&p.height<=C.nearMaxM+2);}
  for(let x=-3000;x<=3000;x+=200){const p=backdropPoint(t,x,b.minZ-20000);assert(p.height>=C.farMinM&&p.height<=C.farMaxM);}
  const low={...t,heightAt:()=>.7};assert.equal(backdropPoint(low,0,b.minZ).height,.7);assert(backdropPoint(low,0,b.minZ-1).height>=2);
});

test('S3 sea worlds draw nothing, seam rows share vertices and light/adapt reduce counts and extent',()=>{
  const t=synthetic(),b=t.bounds,p=buildBackdrop(t),light=buildBackdrop(t,{quality:'light'}),sea=buildBackdrop({...t,heightAt:()=>-10});
  verify(light,t);assert.equal(sea.draws,0);assert.equal(sea.triangles,0);assert(light.triangles<p.triangles);assert.equal(light.draws,1);
  const seams=p.segments.map(s=>{const out=[];for(let i=0;i<s.positions.length;i+=3){const x=s.positions[i],z=s.positions[i+2];if(Math.abs(Math.max(b.minX-x,x-b.maxX,b.minZ-z,z-b.maxZ)-C.nearExtentM)<.02)out.push(Array.from(s.positions.slice(i,i+3)).join(','));}return new Set(out);});
  assert(seams[0].size>0);for(const vertex of seams[0])assert(seams[1].has(vertex),'Near/far grid seam is welded');
  assert(backdropRange('light')<backdropRange());assert(backdropRange('standard',2)<backdropRange('standard',1));assert(backdropRange('standard',3)<backdropRange('standard',2));
  // A large synthetic footprint also exercises the all-land construction cap.
  verify(buildBackdrop({bounds:{minX:-5600,maxX:5600,minZ:-4300,maxZ:4300},cell:16,heightAt:()=>80}),{bounds:{minX:-5600,maxX:5600,minZ:-4300,maxZ:4300},heightAt:()=>80});
});

test('S3 private world produces valid exterior geometry within the same budgets (no source values persisted)',{skip:!process.env.KZ_WORLD_DIR&&'Private world not configured'},async()=>{
  const {data}=await readPrivateData(process.env.KZ_WORLD_DIR),terrain=createKamakuraTerrain(data);verify(buildBackdrop(terrain),terrain);
});
