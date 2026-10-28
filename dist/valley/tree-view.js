// Tree instances and QA specimens share the same geometry and materials.
import * as THREE from 'three';
import { TREES } from './config.js';
import { treeGeometry } from './tree-geometry.js';
import { treeMaterials } from './tree-materials.js';
import { lodMembership, uLodFor, fadeWeight } from './tree-lod.js';
const names = ['cedar', 'zelkova', 'pine', 'maple', 'sapling', 'shrub'];
const clamp = v => Math.max(0, Math.min(1, v));
export function stageColor(species, stage = 0, tint = .5, variant = 0) {
  const name = species === 4 ? (variant === 1 ? 'maple' : 'zelkova') : names[species];
  const palette = TREES.palette[name]; if (!palette) throw new RangeError('tree color species');
  const t = clamp(stage) * (palette.length - 1), k = Math.min(Math.floor(t), palette.length - 1);
  return new THREE.Color(palette[k]).lerp(new THREE.Color(palette[Math.min(k + 1, palette.length - 1)]), t - k).multiplyScalar(.88 + .24 * clamp(tint));
}
// Shape is a stable property of an individual, independent of LOD and array order.
export function treeShape(species, tint) {
  const count = TREES.variants[names[species]] ?? 1;
  if (species === 0) return tint < .45 ? Math.min(2, Math.floor(clamp(tint) / .15)) : tint < .70 ? 3 : 4;
  return Math.min(count - 1, Math.floor(clamp(tint) * count));
}
// Each set owns cloned buffers; the cached geometry templates never reach the GPU.
// Caller owns disposal of the two cloned geometries and mesh instance buffers.
export function createTreeSet({ species, level, capacity, materials, variant = 0, shape = 0 }) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('tree capacity');
  const g = treeGeometry(species, level, shape), pair = materials.get(species, level, variant, shape);
  function mesh(geometry, material, name) {
    const m = new THREE.InstancedMesh(geometry.clone(), material, capacity);
    m.name = name; m.count = 0; m.frustumCulled = false;
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
    m.castShadow = level === 0; m.receiveShadow = level === 0; return m;
  }
  return { leaf: mesh(g.leaf, pair.leaf, 'tree-specimen-leaf'), wood: g.tris.wood ? mesh(g.wood, pair.wood, 'tree-specimen-wood') : null };
}
export function buildSpecimens({ terrain, wind, sunDir, quality = 'standard', at = [0, 0], yaw = 0, spacing = 10, items = [] }) {
  // Validate the complete request before allocating owned resources.
  for (const i of items) {
    treeGeometry(i.species, i.level, i.shape ?? 0);
    if (!Number.isFinite(i.stage ?? 0) || !Number.isFinite(i.scale ?? 1) || (i.scale ?? 1) <= 0) throw new RangeError('tree specimen stage/scale');
  }
  if (![...at, yaw, spacing].every(Number.isFinite)) throw new RangeError('tree specimen placement');
  const group = new THREE.Group(); group.name = 'tree-specimens';
  const materials = treeMaterials({ wind, sunDir, quality }), placed = [], meshes = [];
  let disposed = false;
  const dispose = () => {
    if (disposed) return; disposed = true; group.removeFromParent();
    for (const mesh of meshes) { mesh.geometry.dispose(); mesh.dispose(); }
    materials.dispose(); group.clear();
  };
  try {
    for (let k = 0; k < items.length; k++) {
      const { species, level, stage = 0, variant = 0, shape = 0, scale = 1 } = items[k];
      const localX = (k - (items.length - 1) / 2) * spacing;
      const x = at[0] + Math.cos(yaw) * localX, z = at[1] - Math.sin(yaw) * localX, y = terrain.heightAt(x, z);
      if (!Number.isFinite(y)) throw new RangeError('tree specimen terrain height');
      const set = createTreeSet({ species, level, capacity: 1, materials, variant, shape });
      const pair = materials.get(species, level, variant, shape), matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), new THREE.Vector3(scale, scale, scale));
      for (const kind of ['leaf', 'wood']) if (set[kind]) {
        const mesh = set[kind]; meshes.push(mesh); mesh.material = pair[kind];
        mesh.setMatrixAt(0, matrix); mesh.setColorAt(0, kind === 'leaf' ? stageColor(species, stage, .5, variant) : new THREE.Color(0xffffff));
        mesh.count = 1; mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; group.add(mesh);
      }
      placed.push({ species, level, stage, x, y, z, height: treeGeometry(species, level).height * scale });
    }
  } catch (error) { dispose(); throw error; }
  return { group, items: placed, dispose };
}

// Full species capacity at every level permits overlap without reallocating GPU buffers.
export class TreeField {
  constructor({ data, species, understory, wind, sunDir, quality = 'standard' }) {
    this.data = data;
    this.species = species ?? { species: data.kind, stage: new Uint8Array(data.x.length) };
    this.understory = understory ?? { x: [] };
    this.light = quality === 'light';
    this.lod = TREES.lod[this.light ? 'light' : 'standard'];
    this.policy = { lod: this.lod, blend: TREES.lod.blend[this.light ? 'light' : 'standard'] };
    this.group = new THREE.Group(); this.group.name = 'trees';
    this.last = new THREE.Vector2(1e9, 1e9);
    this.materials = treeMaterials({ wind, sunDir, quality });
    this.sets = []; this.lookup = new Map(); this.disposed = false;
    this.stats = { near: 0, mid: 0, far: 0, understory: 0 };
    const counts = new Map();
    const count = (sp, variant, shape = 0) => { const key = `${sp}/${variant}/${shape}`; counts.set(key, (counts.get(key) ?? 0) + 1); };
    for (let i = 0; i < data.x.length; i++) { const sp = this.species.species[i]; count(sp, 0, treeShape(sp, data.tint[i])); }
    for (let i = 0; i < this.understory.x.length; i++) count(this.understory.species[i], this.understory.species[i] === 4 ? this.understory.variant[i] ?? 0 : 0);
    for (const [key, capacity] of counts) {
      const [sp, variant, shape] = key.split('/').map(Number), cfg = sp >= 4 ? TREES[names[sp]] : null;
      for (let level = 0; level < (cfg ? 2 : 3); level++) {
        const set = createTreeSet({ species: sp, level, capacity, materials: this.materials, variant, shape });
        Object.assign(set, { species: sp, level, variant, shape, capacity });
        // Reserve both hard-split levels during the five-metre allocation cadence.
        // Their shader masks are binary, so the reserve never cross-fades.
        const values = cfg ? [-1, -1, -1, -1] : uLodFor(level, this.policy);
        for (const mesh of [set.leaf, set.wood]) if (mesh) {
          mesh.name = `tree-${sp}-${level}-${variant}-${shape}-${mesh === set.leaf ? 'leaf' : 'wood'}`;
          mesh.material.userData.uLod.value.set(...values);
          const compile = mesh.material.onBeforeCompile, cacheKey = mesh.material.customProgramCacheKey();
          const range = cfg ? (this.light ? cfg.lightDistance : cfg.distance) : null, blend = this.policy.blend;
          mesh.material.onBeforeCompile = shader => {
            compile(shader);
            // Allocation and shader must use the same ground-plane distance,
            // including on slopes or with the QA camera far above the trees.
            shader.vertexShader = shader.vertexShader.replace('distance(treeOrigin,cameraPosition)', 'distance(treeOrigin.xz,cameraPosition.xz)');
            if (cfg) shader.vertexShader = shader.vertexShader
              .replace('vec4 treeWorld = vec4(transformed,1.0);', `
                float treeShrink = 1.0-smoothstep(${(range - blend).toFixed(1)},${(range + blend).toFixed(1)},distance(treeOrigin.xz,cameraPosition.xz));
                transformed *= treeShrink;
                vec4 treeWorld = vec4(transformed,1.0);`)
              .replace('vTreeWeight = enter*leave;', `vTreeWeight = ${level === 0 ? '1.0-' : ''}step(${cfg.split.toFixed(1)},vTreeDistance);`);
          };
          mesh.material.customProgramCacheKey = () => `${cacheKey}-field-xz-${range}-${blend}`;
          this.group.add(mesh);
        }
        this.sets.push(set); this.lookup.set(`${key}/${level}`, set);
      }
    }
    this.m = new THREE.Matrix4(); this.q = new THREE.Quaternion(); this.s = new THREE.Vector3();
    this.p = new THREE.Vector3(); this.euler = new THREE.Euler(); this.color = new THREE.Color();
  }
  update(camera, force = false) {
    if (this.disposed) return;
    const cx = camera.position.x, cz = camera.position.z;
    if (!force && Math.hypot(cx - this.last.x, cz - this.last.y) < 5) return;
    this.last.set(cx, cz);
    for (const set of this.sets) { set.leaf.count = 0; if (set.wood) set.wood.count = 0; }
    this.stats = { near: 0, mid: 0, far: 0, understory: 0 };
    const put = (d, i, sp, stage, variant, shape, level, baseScale) => {
      const set = this.lookup.get(`${sp}/${variant}/${shape}/${level}`), k = set.leaf.count;
      if (k >= set.capacity) throw new RangeError('tree capacity exceeded');
      const tv = d.tint[i], f1 = (tv * 7.31) % 1, f2 = (tv * 3.17) % 1, f3 = (tv * 11.9) % 1;
      this.s.set(baseScale * (.85 + .5 * f1), baseScale * (.85 + .45 * f2), baseScale * (.85 + .5 * f1));
      const tiltX = (((tv * 17.7) % 1) * 2 - 1) * Math.PI / 60;
      const tiltZ = (((tv * 23.3) % 1) * 2 - 1) * Math.PI / 60;
      this.q.setFromEuler(this.euler.set(tiltX, d.rot[i], tiltZ, 'YXZ')); this.p.set(d.x[i], d.y[i] - .15, d.z[i]); this.m.compose(this.p, this.q, this.s);
      if (sp !== 0 && sp !== 2) this.color.copy(stageColor(sp, stage / 255, tv, variant));
      else if (level === 2) { const v = .55 + .9 * f3; this.color.setRGB(v * (.9 + .2 * f1), v, v * (.8 + .4 * f2)); }
      else { const v = .85 + tv * .3; this.color.setRGB(v, v * 1.02, v * .95); }
      set.leaf.setMatrixAt(k, this.m); set.leaf.setColorAt(k, this.color); set.leaf.count++;
      if (set.wood) {
        set.wood.setMatrixAt(k, this.m); this.color.setRGB(1, 1, 1).multiplyScalar(.85 + tv * .3);
        set.wood.setColorAt(k, this.color); set.wood.count++;
      }
      if (sp < 4) this.stats[['near', 'mid', 'far'][level]]++;
      else this.stats.understory++;
    };
    for (let i = 0; i < this.data.x.length; i++) {
      const d = this.data, distance = Math.hypot(d.x[i] - cx, d.z[i] - cz);
      const membership = lodMembership(distance, this.policy);
      for (let level = 0; level < 3; level++) if (membership[level]) {
        if (this.light && level === 2 && (i & 1)) continue;
        put(d, i, this.species.species[i], this.species.stage[i], 0, treeShape(this.species.species[i], d.tint[i]), level, d.s[i]);
      }
    }
    const d = this.understory;
    for (let i = 0; i < d.x.length; i++) {
      const sp = d.species[i], cfg = TREES[names[sp]], distance = Math.hypot(d.x[i] - cx, d.z[i] - cz);
      const range = this.light ? cfg.lightDistance : cfg.distance;
      if (fadeWeight(distance - 6, range, this.policy.blend) <= 0) continue;
      const membership = lodMembership(distance, { lod: [cfg.split, Infinity], blend: 0 });
      for (let level = 0; level < 2; level++) if (membership[level]) {
        put(d, i, sp, d.stage[i], sp === 4 ? d.variant[i] ?? 0 : 0, 0, level, d.s[i] / treeGeometry(sp, 0).height);
      }
    }
    for (const set of this.sets) for (const mesh of [set.leaf, set.wood]) if (mesh) {
      mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.group.removeFromParent();
    for (const set of this.sets) for (const mesh of [set.leaf, set.wood]) if (mesh) { mesh.geometry.dispose(); mesh.dispose(); }
    this.materials.dispose(); this.group.clear();
  }
}
