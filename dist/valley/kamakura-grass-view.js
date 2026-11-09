import { grass9Enabled, grass9Radius, grass9Tiles, grass9Distance, grass9Queue, grass9Plan, GRASS9_CHUNKS, grass9WorkBudget } from './kamakura-grass-stream.js';
import { grassR7Enabled } from './kamakura-grass-r7.js';
import { grassR5Enabled } from './kamakura-grass-r5.js';
import { grassR3Enabled, coastalGrassAt } from './kamakura-grass-r3.js';
// Reuse valley geometry/materials. Only the bounded CPU window is Kamakura-specific.
import * as THREE from 'three';
import { grassBandEnabled, createGrassBandCell } from './kamakura-grass-band.js';
import { grassLookEnabled, createGrassEnvironment, grassGroundTint, grassR4Enabled, grassR4Coast } from './kamakura-grass-look.js';
import { createGrassLook } from './kamakura-grass-look-view.js';
import { buildGrass } from './grass-view.js';
import { createSurfaceCodeAt } from './kamakura-surface.js';
import { KAMAKURA_GRASS_REACH, createGrassCell, createGrassWindows, grassExclusions, grassEnabled, grassFrameBudget } from './kamakura-grass-field.js';
export function buildKamakuraGrass({ data, terrain, colliders, extraColliders, search = '', wind, sunDir, quality = 'standard', facilityBoxes = [], now = () => performance.now(), schedule = fn => setTimeout(fn,0), cancel = clearTimeout }) {
  const group = new THREE.Group(); group.name = 'kamakura-grass';
  const enabled = grassEnabled(search) && !!data.meta.surface && data.surface instanceof Uint8Array && data.surface.length === data.meta.grid.width * data.meta.grid.height;
  // W2c-9r1 grass: gband=0 restores the complete 9c3 path.
  const improved = grassLookEnabled(search), bands = improved && grassBandEnabled(search);
  const r3 = bands && grassR3Enabled(search);
  const r4 = r3 && grassR4Enabled(search); // W2c-10 grass: opt out restores the complete R3 path.
  const r5 = r4 && grassR5Enabled(search);
  const r9 = r5 && grass9Enabled(search);
  const stream = r9 ? {chunkSizes:GRASS9_CHUNKS,budget:grass9WorkBudget,center:{value:new THREE.Vector2()},radiusUniform:{value:grass9Radius(quality)},position:{x:0,z:0},vx:0,vz:0,now,changed:false,
    radius(){return this.radiusUniform.value;},
    distance(c){return grass9Distance(c,this.position.x,this.position.z);},
    tiles(field){return grass9Tiles(field,this.position.x,this.position.z,{quality,radius:this.radius(),vx:this.vx,vz:this.vz});},
    plan(field){return grass9Plan(field,this.position.x,this.position.z,{quality,radius:this.radius(),vx:this.vx,vz:this.vz});},
    queue(wanted,resident){return grass9Queue(wanted,resident,this.position.x,this.position.z);}
    } : undefined;
  const r7 = r5 && grassR7Enabled(search); // W2c-13: off restores the complete R6 path.
  const paths = data.patches?.paths || {};
  // W2c-9c3: metre surface transitions and narrow collider/bank margins replace bare rims.
  const ecology = improved ? createGrassEnvironment(terrain, {colliders, extraColliders, paths, r4, surfaceCodeAt:createSurfaceCodeAt(data.meta,data.surface)}) : null;
  const look = improved ? createGrassLook(ecology, quality, {value:new THREE.Vector4(0,0,0,0)},bands,r3,r4,r5,r7,stream) : undefined;
  const cell = createGrassCell(terrain, { surfaceCodeAt: createSurfaceCodeAt(data.meta, data.surface),
    environmentAt: ecology, ...(improved ? {riverMargin:.25} : {}), exclude: grassExclusions(terrain, { colliders, extraColliders, paths, ...(improved ? {pathMargin:2.5,rootMargin:bands?Math.SQRT1_2:0} : {}) }) });
  // W2c-9r2 grass: 400m band window leaves 200-32-158-6=4m headroom.
  const bandCell = bands ? createGrassBandCell(cell,terrain,{surfaceCodeAt:createSurfaceCodeAt(data.meta,data.surface),facilityBoxes,environmentAt:ecology,...(r3?{sandHabitatAt:r4 && quality!=='light' ? (x,z,d,refuge,crest)=>coastalGrassAt(x,z,d,refuge,crest)*grassR4Coast(d,terrain.heightAt(x,z),r5).density : coastalGrassAt,sandMidScale:1}:{})}) : cell;
  const windows = createGrassWindows(bandCell, improved ? {size:bands?400:352} : {}), budget = grassFrameBudget(quality);
  let grass = null, keyed = false, disposed = false, step = 0, switches = 0, lastWorkMs = 0, maxWorkMs = 0, initial = true, background = null, backgroundWanted = false;
  function advance(camera,pos,warm=false) {
      let recovered=false;
      if (disposed || !enabled || (!r9 && step === 3)) return;
      if(stream){
        stream.position.x=pos.x;stream.position.z=pos.z;stream.center.value.set(pos.x,pos.z);
        // A teleport/landing can outrun the background metre window. Never draw its empty edge.
        const f=windows.field,guard=stream.radius()+24;
        if(f && (pos.x-guard<f.x0 || pos.z-guard<f.z0 || pos.x+guard>f.x0+f.nx || pos.z+guard>f.z0+f.nz)){
          windows.cancel(); windows.plan(pos,quality==='light'?112:144,true);ecology?.retain(windows.pending.field);
          windows.work(()=>0);const fresh=windows.commit();grass?.setField(fresh);warm=true;recovered=true;
        }
      }
      // W2c-9r2 grass: retain the small synchronous boot, then budget the full band window.
      if(!recovered && windows.plan(pos,warm && initial ? (r9?(quality==='light'?144:192):(quality==='light'?96:120)) : bands?400:improved?352:256))ecology?.retain(windows.pending.field);
      const start = now(); if (!recovered && windows.pending) windows.work(() => warm ? 0 : now() - start, budget);
      lastWorkMs = now() - start; maxWorkMs = Math.max(maxWorkMs, lastWorkMs);
      const next = windows.commit();
      if (next) {
        if (grass) grass.setField(next);
        else { grass = buildGrass({ field: next, wind, sunDir, quality, streaming:stream, reach: bands ? {near:r3?32:25,mid:158,midInner:r5?4:8} : improved ? {near:10,mid:120} : KAMAKURA_GRASS_REACH, look }); // W2c-9r3 grass: keep R2/R3 programs distinct when a renderer is reused.
          if(r3)for(const material of new Set(grass.group.children.map(mesh=>mesh.material))){const key=material.customProgramCacheKey();material.customProgramCacheKey=()=>key+(r4?'-r4':'-r3');}
          group.add(grass.group); grass.setDensityScale((r9 ? step >= 2 : step === 2) ? .6 : 1); grass.setLookQuality(step); }
        // W2c-9b: sample the same linear ground colors used by the terrain.
        const tint = new THREE.Color(0,0,0); let n = 0;
        for (const dz of [-8,0,8]) for (const dx of [-8,0,8]) {
          const c = terrain.groundColorAt?.(next.x0+next.nx/2+dx,next.z0+next.nz/2+dz);
          if (c) { tint.r+=c[0]; tint.g+=c[1]; tint.b+=c[2]; n++; }
        }
        if (n) {
          tint.multiplyScalar(1/n);
          // W2c-9c2: mean ground -> shaded tuft target (0.68); floor prevents dusk crush.
          if(improved) { const c=grassGroundTint([tint.r,tint.g,tint.b]); tint.setRGB(...c); }
          else tint.multiplyScalar(.68);
          grass.setGroundTint(tint);
        }
        switches++;
      }
      if (warm) grass?.warm(camera); else grass?.update(camera);
      // W2c-11 grass: warm creates the meshes; key the R5 program after that,
      // before the renderer can compile it. R4/off keeps the shipped cache key.
      if(r5 && grass && !keyed){
        for(const material of new Set(grass.group.children.map(mesh=>mesh.material))){const key=material.customProgramCacheKey();material.customProgramCacheKey=()=>key+(r9?'-r9':'')+(r7?'-r7':'')+'-r5';}
        keyed=true;
      }
      if(warm && initial){initial=false;backgroundWanted=true;}
      else if(!warm && backgroundWanted){
        backgroundWanted=false;
        // The callback runs after this animation frame has drawn the initial field.
        const fill=()=>{
          background=null;if(disposed||!windows.pending)return;
          const start=now();windows.work(()=>now()-start,budget);
          if(windows.pending.cursor<windows.pending.field.nx*windows.pending.field.nz)background=schedule(fill);
        };
        background=schedule(fill);
      }
  }
  return { group, enabled,
    // W2c-9p: initial small window only; outer cells keep the normal budget.
    warm(camera,pos=camera.position) { advance(camera,pos,true); },
    update(camera,pos=camera.position,paused=false) { if(!paused) advance(camera,pos); },
    updateHero(pos,speed,flying,dt) {
      if(stream){
        if(stream.lastHero && dt>0 && !flying){stream.vx=(pos.x-stream.lastHero.x)/dt;stream.vz=(pos.z-stream.lastHero.z)/dt;}
        else {stream.vx=0;stream.vz=0;}
        if(!stream.lastHero)stream.lastHero={x:pos.x,z:pos.z};
        stream.lastHero.x=pos.x;stream.lastHero.z=pos.z;
      }
      if(!disposed && enabled) look?.updateHero(pos,speed,flying,dt); },
    setAdapt(next) { step = typeof next === 'number' ? next : next.step; group.visible = r9 || step !== 3; if(stream){stream.radiusUniform.value=grass9Radius(quality,step);stream.changed=true;} grass?.setDensityScale((r9 ? step >= 2 : step === 2) ? .6 : 1); grass?.setLookQuality(step); },
    stats() { return { enabled, improved, bands, r3, r4, r5, r7, r9, switches, pending: !!windows.pending, window: windows.field?.stats || null, lastWorkMs, maxWorkMs, ...(grass?.stats() || { nearBlades: 0, midCards: 0, triangles: 0 }) }; },
    dispose() { if (disposed) return; disposed = true; cancel(background); ecology?.dispose(); windows.dispose(); grass?.dispose(); grass = null; group.clear(); }
  };
}
