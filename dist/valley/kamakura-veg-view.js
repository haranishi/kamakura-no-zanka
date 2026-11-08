// Kamakura-only allocation. The valley TreeField and shared templates remain unchanged.
import * as THREE from 'three';
import { applyVegLook, barkMeters, vegLookEnabled } from './kamakura-veg-look.js';
import { TREES } from './config.js';
import { treeGeometry } from './tree-geometry.js';
import { treeMaterials } from './tree-materials.js';
import { createTreeSet, createImpostorSet } from './tree-view.js';
import { treeImpostors } from './tree-bake.js';
import { uLodFor } from './tree-lod.js';
import { selectVeg, vegPolicy, vegCircles, vegTrunkHandover, vegTrunkLod } from './kamakura-veg.js';
export const vegHeight = (species, shape = 0) => treeGeometry(species, 0, shape).height;
export function buildKamakuraVeg(prepared, { wind, sunDir, quality = 'standard', renderer = null, families = [], search = '' }) {
  const policy = vegPolicy(quality), group = new THREE.Group(), sets = new Map(), trunkHandover = vegTrunkHandover(search);
  const materials = treeMaterials({ wind, sunDir, quality });
  // W2c-10b veg5: shared valley shaders stay untouched; this uniform controls only Kamakura.
  const look = { value: quality === 'light' ? .65 : 1 }, lookEnabled = vegLookEnabled(search);
  let farScale = 1;
  let impostors = null, disposed = false, last = null, stats = null;
  const circles = vegCircles(prepared, vegHeight);
  function dispose() {
    if (disposed) return; disposed = true;
    for (const set of sets.values()) for (const mesh of [set.leaf, set.wood]) if (mesh) { mesh.geometry.dispose(); mesh.dispose(); }
    materials.dispose(); impostors?.dispose(); group.removeFromParent(); group.clear(); sets.clear();
  }
  try {
    if (renderer) {
      const candidate = treeImpostors({ wind, sunDir, quality, materials });
      try { candidate.bake(renderer); impostors = candidate; }
      catch { candidate.dispose(); console.warn('木の遠景板を生成できないため、遠景も木のメッシュで続けます'); }
    }
    const counts = new Map();
    for (const i of prepared.active) { const k = `${i.species}/${i.shape}`; counts.set(k, (counts.get(k) || 0) + 1); }
    for (const family of families) counts.set(family, Math.max(...policy.capacities));
    for (const [key, count] of counts) {
      const [species, shape] = key.split('/').map(Number);
      for (let level = 0; level < (species === 5 ? 2 : 3); level++) {
        const capacity = Math.min(count, policy.capacities[level]);
        const set = level === 2 && impostors ? createImpostorSet({ impostors, species, shape, capacity })
          : createTreeSet({ species, shape, level, capacity, materials });
        sets.set(`${key}/${level}`, set);
        for (const mesh of [set.leaf, set.wood]) if (mesh) {
          mesh.geometry.setAttribute('aKzPhase', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1));
          const range = species === 5 ? (quality === 'light' ? TREES.shrub.lightDistance : TREES.shrub.distance) : policy.range;
          let values = species === 5 ? (level === 0 ? [-1, -1, TREES.shrub.split, TREES.shrub.split + .01] : [TREES.shrub.split, TREES.shrub.split + .01, -1, -1]) : uLodFor(level, policy);
          // W2c-9r1 veg: only the trunk hands over late; crowns keep entering early so alpha-cut crowns leave no holes.
          if (trunkHandover && species !== 5 && level === 1 && mesh === set.wood) values = vegTrunkLod(policy);
          mesh.material.userData.uLod.value.set(...values);
          const original = mesh.material.onBeforeCompile, originalKey = mesh.material.customProgramCacheKey();
          mesh.material.onBeforeCompile = shader => {
            original(shader);
            shader.vertexShader = 'attribute float aKzPhase;\n' + shader.vertexShader
              .replaceAll('distance(treeOrigin,cameraPosition)', 'distance(treeOrigin.xz,cameraPosition.xz)')
              .replace('float ph = treeOrigin.x*.37+treeOrigin.z*.21;', 'float ph = treeOrigin.x*.37+treeOrigin.z*.21+aKzPhase*6.283185;')
              .replace('vTreeWeight = enter*leave;', `vTreeWeight = enter*leave*(1.0-smoothstep(${range.toFixed(1)},${(range + 5).toFixed(1)},vTreeDistance));`);
          };
          mesh.material.customProgramCacheKey = () => `${originalKey}-kamakura-${range}`;
          if (mesh.customDepthMaterial) {
            const depth = mesh.customDepthMaterial, compileDepth = depth.onBeforeCompile, depthKey = depth.customProgramCacheKey();
            depth.onBeforeCompile = shader => {
              compileDepth(shader);
              shader.vertexShader = 'attribute float aKzPhase;\n' + shader.vertexShader.replace('float ph = treeOrigin.x*.37+treeOrigin.z*.21;', 'float ph = treeOrigin.x*.37+treeOrigin.z*.21+aKzPhase*6.283185;');
            };
            depth.customProgramCacheKey = () => `${depthKey}-kamakura-phase`;
          }
          if (lookEnabled) {
            if (mesh === set.wood) mesh.geometry.setAttribute('aKzBarkMeters', new THREE.BufferAttribute(barkMeters(mesh.geometry), 2));
            applyVegLook(mesh.material, { lightsChunk: THREE.ShaderChunk.lights_fragment_begin, species, leaf: mesh === set.leaf, geometry: mesh.geometry, sunDir, strength: look, impostor: !!set.impostor });
          }
          group.add(mesh);
        }
      }
    }
  } catch (error) { dispose(); throw error; }
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), scale = new THREE.Vector3(), color = new THREE.Color();
  function update(camera, force = false) {
    if (disposed) return;
    const pos = camera.position;
    if (!force && last && Math.hypot(pos.x - last.x, pos.z - last.z) < 5) return stats;
    last = { x: pos.x, z: pos.z };
    const selection = selectVeg(prepared.grid, pos, policy); let triangles = 0;
    for (const set of sets.values()) for (const mesh of [set.leaf, set.wood]) if (mesh) mesh.count = 0;
    selection.levels.forEach((items, level) => {
      for (const item of items) {
        if (level === 2 && Math.hypot(item.x - pos.x, item.z - pos.z) > policy.range * farScale) continue;
        const set = sets.get(`${item.species}/${item.shape}/${level}`), k = set.leaf.count, size = item.height / vegHeight(item.species, item.shape);
        q.setFromEuler(e.set(item.lean, item.yaw, 0, 'YXZ')); p.set(item.x, item.y, item.z); scale.setScalar(size); matrix.compose(p, q, scale);
        for (const mesh of [set.leaf, set.wood]) if (mesh) {
          if (k >= mesh.instanceMatrix.count) throw new RangeError('木の容量を超えました');
          mesh.setMatrixAt(k, matrix);
          color.setRGB(...(mesh === set.leaf ? item.color : [1, 1, 1].map(v => v * (1 + .12 * item.tint))));
          mesh.setColorAt(k, color); mesh.geometry.attributes.aKzPhase.array[k] = item.phase; mesh.count++;
          triangles += (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;
        }
        if (set.impostor) set.leaf.geometry.attributes.aImpWood.array[k] = 1 + .12 * item.tint;
      }
    });
    for (const set of sets.values()) for (const mesh of [set.leaf, set.wood]) if (mesh) {
      mesh.instanceMatrix.needsUpdate = mesh.instanceColor.needsUpdate = mesh.geometry.attributes.aKzPhase.needsUpdate = true;
      if (set.impostor) mesh.geometry.attributes.aImpWood.needsUpdate = true;
    }
    stats = { counts: selection.levels.map(v => v.length), triangles, dropped: selection.dropped, cells: selection.cells, scanned: selection.scanned };
    return stats;
  }
  return { group, circles, update, dispose, sets, policy, setAdapt(next) { farScale = next.impostorRange; last = null; }, replacePrepared(next) { prepared = next; last = null; }, get stats() { return stats; } };
}
