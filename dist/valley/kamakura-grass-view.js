// Reuse valley geometry/materials. Only the bounded CPU window is Kamakura-specific.
import * as THREE from 'three';
import { grassLookEnabled, createGrassEnvironment, grassGroundTint } from './kamakura-grass-look.js';
import { createGrassLook } from './kamakura-grass-look-view.js';
import { buildGrass } from './grass-view.js';
import { createSurfaceCodeAt } from './kamakura-surface.js';
import { KAMAKURA_GRASS_REACH, createGrassCell, createGrassWindows, grassExclusions, grassEnabled, grassFrameBudget } from './kamakura-grass-field.js';
export function buildKamakuraGrass({ data, terrain, colliders, extraColliders, search = '', wind, sunDir, quality = 'standard', now = () => performance.now(), schedule = fn => setTimeout(fn,0), cancel = clearTimeout }) {
  const group = new THREE.Group(); group.name = 'kamakura-grass';
  const enabled = grassEnabled(search) && !!data.meta.surface && data.surface instanceof Uint8Array && data.surface.length === data.meta.grid.width * data.meta.grid.height;
  const improved = grassLookEnabled(search);
  const paths = data.patches?.paths || {};
  const ecology = improved ? createGrassEnvironment(terrain, {colliders, extraColliders, paths}) : null;
  const look = improved ? createGrassLook(ecology, quality, {value:new THREE.Vector4(0,0,0,0)}) : undefined;
  const cell = createGrassCell(terrain, { surfaceCodeAt: createSurfaceCodeAt(data.meta, data.surface),
    environmentAt: ecology, exclude: grassExclusions(terrain, { colliders, extraColliders, paths, ...(improved ? {pathMargin:2.5} : {}) }) });
  // W2c-9c2: 352m look window leaves 176-32-120-6=18m streaming headroom.
  const windows = createGrassWindows(cell, improved ? {size:352} : {}), budget = grassFrameBudget(quality);
  let grass = null, disposed = false, step = 0, switches = 0, lastWorkMs = 0, maxWorkMs = 0, initial = true, background = null, backgroundWanted = false;
  function advance(camera,pos,warm=false) {
      if (disposed || !enabled || step === 3) return;
      // W2c-9p: ~60m synchronous neighbourhood, then full unchanged 352m window.
      if(windows.plan(pos,warm && initial ? (quality==='light'?96:120) : improved?352:256))ecology?.retain(windows.pending.field);
      const start = now(); if (windows.pending) windows.work(() => warm ? 0 : now() - start, budget);
      lastWorkMs = now() - start; maxWorkMs = Math.max(maxWorkMs, lastWorkMs);
      const next = windows.commit();
      if (next) {
        if (grass) grass.setField(next);
        else { grass = buildGrass({ field: next, wind, sunDir, quality, reach: improved ? {near:10,mid:120} : KAMAKURA_GRASS_REACH, look }); group.add(grass.group); grass.setDensityScale(step === 2 ? .6 : 1); grass.setLookQuality(step); }
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
    updateHero(pos,speed,flying,dt) { if(!disposed && enabled) look?.updateHero(pos,speed,flying,dt); },
    setAdapt(next) { step = typeof next === 'number' ? next : next.step; group.visible = step !== 3; grass?.setDensityScale(step === 2 ? .6 : 1); grass?.setLookQuality(step); },
    stats() { return { enabled, improved, switches, pending: !!windows.pending, window: windows.field?.stats || null, lastWorkMs, maxWorkMs, ...(grass?.stats() || { nearBlades: 0, midCards: 0, triangles: 0 }) }; },
    dispose() { if (disposed) return; disposed = true; cancel(background); ecology?.dispose(); windows.dispose(); grass?.dispose(); grass = null; group.clear(); }
  };
}
