// Static forest skin and a bounded, shared pool of ordinary child trees. No valley TreeField changes.
import * as THREE from 'three';
import { atmospherePolicy } from './kamakura-atmosphere.js';
import { applyVegLook, vegLookEnabled } from './kamakura-veg-look.js';
import { crownLookEnabled } from './kamakura-crown.js';
import { applyCrownLook } from './kamakura-crown-look.js';
import { TREES } from './config.js';
import { TREE_NAMES, vegCircles } from './kamakura-veg.js';
import { buildKamakuraVeg, vegHeight } from './kamakura-veg-view.js';
import { planStandChunks, generateStandChunk, combineStandChunks } from './kamakura-stands.js';
import { addColliderCircles } from './collision.js';
// One deterministic, seam-safe crown shared by all stand instances (64 triangles).
export function standGeometry() {
  const geometry = new THREE.SphereGeometry(1, 8, 5), positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  for (let k = 0; k < positions.count; k++) {
    const x = positions.getX(k), y = positions.getY(k), z = positions.getZ(k);
    // Quantized position, rather than vertex number, keeps duplicate seam/pole vertices together.
    let state = (Math.imul(Math.round(x * 10000), 73856093) ^ Math.imul(Math.round(y * 10000), 19349663) ^ Math.imul(Math.round(z * 10000), 83492791)) >>> 0;
    const next = () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state / 4294967296; };
    const radial = 1 + (next() * 2 - 1) * .1, vertical = 1 + (next() * 2 - 1) * .06;
    positions.setXYZ(k, x * radial, y * vertical, z * radial);
    const t = (y + 1) / 2, shade = .6 + .4 * t * t * (3 - 2 * t);
    colors.fill(shade, k * 3, k * 3 + 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // Keep the original sphere normals for smooth Lambert lighting.
  return geometry;
}
export function buildKamakuraStands(prepared, { wind, sunDir, quality = 'standard', renderer = null, colliders, search = '' }) {
  const group = new THREE.Group(), distant = [], resident = new Map(), releases = new Map();
  const eye = { value: new THREE.Vector3() }, resources = new Set();
  let children, disposed = false, last = null, stats = null;
  const policy = prepared.policy; let rangeScale = 1;
  const look = { value: quality === 'light' ? .65 : 1 }, lookEnabled = vegLookEnabled(search);
  const families = [];
  for (const species of [0, 1, 2]) for (let shape = 0; shape < TREES.variants[TREE_NAMES[species]]; shape++) families.push(`${species}/${shape}`);
  function dispose() {
    if (disposed) return; disposed = true;
    for (const release of releases.values()) release(); releases.clear(); resident.clear();
    children?.dispose();
    for (const resource of resources) resource.dispose(); resources.clear();
    group.removeFromParent(); group.clear(); distant.length = 0;
  }
  try {
    // Static transforms, one mesh per tier/species/1km tile.
    const geometry = standGeometry(); resources.add(geometry);
    const materials = new Map(), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), color = new THREE.Color();
    for (const [key, items] of prepared.distant) {
      const tier = items[0].tier;
      // Outside A never expands: its skin must remain intact at short distances.
      // Per-instance flag also keeps mixed boundary tiles correct.
      if (!materials.has(tier)) {
        const material = new THREE.MeshLambertMaterial({ vertexColors: true }); resources.add(material); materials.set(tier, material);
        material.userData.uStandEye = eye;
        material.onBeforeCompile = shader => {
          shader.uniforms.uStandEye = eye;
          shader.vertexShader = 'uniform vec3 uStandEye; attribute float aStandExpand;\n' + shader.vertexShader;
          shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
            vec3 standOrigin = (modelMatrix * instanceMatrix[3]).xyz;
            float standDistance = distance(standOrigin.xz, uStandEye.xz);
            float standKeep = smoothstep(${policy.hide[tier][0].toFixed(1)}, ${policy.hide[tier][1].toFixed(1)}, standDistance);
            transformed *= mix(1.0, standKeep, aStandExpand);
          `);
        };
        material.customProgramCacheKey = () => `kamakura-stand-${tier}`;
        // W2c-10b veg5: far forest uses the same foliage arithmetic, preserving Three's fog.
        if (lookEnabled) applyVegLook(material, { lightsChunk: THREE.ShaderChunk.lights_fragment_begin, species: -1, leaf: true, geometry, sunDir, strength: look, stand: true });
        if (lookEnabled && crownLookEnabled(search)) applyCrownLook(material, { geometry, light: quality === 'light', distant: true });
      }
      const g = geometry.clone(); resources.add(g);
      if (lookEnabled) g.setAttribute('aKzSpecies', new THREE.InstancedBufferAttribute(Float32Array.from(items, i => i.species), 1));
      g.setAttribute('aStandExpand', new THREE.InstancedBufferAttribute(Float32Array.from(items, i => tier === 2 || i.expandable ? 1 : 0), 1));
      const mesh = new THREE.InstancedMesh(g, materials.get(tier), items.length); resources.add(mesh); mesh.name = `stand/${key}`;
      mesh.castShadow = atmospherePolicy(quality).standShadows; mesh.receiveShadow = true;
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      items.forEach((i, k) => {
        // Minimum of five ground samples: bury the lower crown even on a slope.
        position.set(i.x, i.y + i.height * .3, i.z); scale.set(i.crown, i.height * .7, i.crown);
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, i.yaw ?? 0);
        matrix.compose(position, rotation, scale); mesh.setMatrixAt(k, matrix);
        mesh.setColorAt(k, color.setRGB(...i.color));
      });
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      mesh.updateMatrix(); mesh.matrixAutoUpdate = false; group.add(mesh);
      const sphere = mesh.boundingSphere;
      distant.push({ mesh, sphere, range: policy.ranges[tier] });
    }
    children = buildKamakuraVeg({ active: [], grid: new Map() }, { wind, sunDir, quality, search, renderer: prepared.grid.size ? renderer : null, families: prepared.grid.size ? families : [] });
    group.add(children.group);
  } catch (error) { dispose(); throw error; }
  function update(camera) {
    if (disposed) return;
    const pos = camera.position; eye.value.set(pos.x, pos.y ?? 0, pos.z);
    // No stand instance matrix changes after construction. Tile culling is bounded by tile count.
    if (last && stats?.pending === 0 && Math.hypot(pos.x - last.x, pos.z - last.z) < 5) return stats;
    for (const { mesh, sphere, range } of distant) mesh.visible = Math.hypot(sphere.center.x - pos.x, sphere.center.z - pos.z) - sphere.radius <= range * rangeScale;
    let changed = false;
    const plan = planStandChunks(prepared, resident, pos);
    for (const key of plan.remove) { releases.get(key)?.(); releases.delete(key); resident.delete(key); changed = true; }
    for (const key of plan.create.slice(0, policy.perFrame)) {
      const chunk = generateStandChunk(prepared, key);
      const circles = vegCircles(chunk, vegHeight);
      const release = colliders ? addColliderCircles(colliders, circles) : () => {};
      resident.set(key, chunk); releases.set(key, release); changed = true;
    }
    if (changed) children.replacePrepared(combineStandChunks(resident));
    const childStats = children.update(camera, changed);
    last = { x: pos.x, z: pos.z };
    stats = { chunks: resident.size, pending: Math.max(0, plan.create.length - policy.perFrame), children: childStats,
      distant: distant.reduce((n, i) => n + (i.mesh.visible ? i.mesh.count : 0), 0) };
    return stats;
  }
  return { group, distant, resident, children, eye, update, dispose, setAdapt(policy) { rangeScale = policy.standRange; last = null; children.setAdapt(policy); }, get stats() { return stats; } };
}
