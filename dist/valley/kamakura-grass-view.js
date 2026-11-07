// Reuse valley geometry/materials. Only the bounded CPU window is Kamakura-specific.
import * as THREE from 'three';
import { buildGrass } from './grass-view.js';
import { createSurfaceCodeAt } from './kamakura-surface.js';
import { createGrassCell, createGrassWindows, grassExclusions, grassEnabled, grassFrameBudget } from './kamakura-grass-field.js';
export function buildKamakuraGrass({ data, terrain, colliders, extraColliders, search = '', wind, sunDir, quality = 'standard' }) {
  const group = new THREE.Group(); group.name = 'kamakura-grass';
  const enabled = grassEnabled(search) && !!data.meta.surface && data.surface instanceof Uint8Array && data.surface.length === data.meta.grid.width * data.meta.grid.height;
  const cell = createGrassCell(terrain, { surfaceCodeAt: createSurfaceCodeAt(data.meta, data.surface),
    exclude: grassExclusions(terrain, { colliders, extraColliders, paths: data.patches?.paths || {} }) });
  const windows = createGrassWindows(cell), budget = grassFrameBudget(quality);
  let grass = null, disposed = false, step = 0, switches = 0, lastWorkMs = 0, maxWorkMs = 0;
  return { group, enabled,
    update(camera, pos = camera.position, paused = false) {
      if (disposed || !enabled || paused || step === 3) return;
      windows.plan(pos);
      const start = performance.now(); windows.work(() => performance.now() - start, budget);
      lastWorkMs = performance.now() - start; maxWorkMs = Math.max(maxWorkMs, lastWorkMs);
      const next = windows.commit();
      if (next) {
        if (grass) grass.setField(next);
        else { grass = buildGrass({ field: next, wind, sunDir, quality }); group.add(grass.group); grass.setDensityScale(step === 2 ? .6 : 1); }
        switches++;
      }
      grass?.update(camera);
    },
    setAdapt(next) { step = typeof next === 'number' ? next : next.step; group.visible = step !== 3; grass?.setDensityScale(step === 2 ? .6 : 1); },
    stats() { return { enabled, switches, pending: !!windows.pending, window: windows.field?.stats || null, lastWorkMs, maxWorkMs, ...(grass?.stats() || { nearBlades: 0, midCards: 0, triangles: 0 }) }; },
    dispose() { if (disposed) return; disposed = true; windows.dispose(); grass?.dispose(); grass = null; group.clear(); }
  };
}
