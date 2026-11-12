// Tree instances and QA specimens share the same geometry and materials.
import * as THREE from 'three';
import { TREES } from './config.js';
import { treeGeometry } from './tree-geometry.js';
import { treeMaterials } from './tree-materials.js';
import { lodMembership, uLodFor, fadeWeight } from './tree-lod.js';
import { treeImpostors } from './tree-bake.js';
const names = ['cedar', 'zelkova', 'pine', 'maple', 'sapling', 'shrub'];
const clamp = v => Math.max(0, Math.min(1, v));
export function stageColor(species, stage = 0, tint = .5, variant = 0) {
  const name = species === 4 ? (variant === 1 ? 'maple' : 'zelkova') : names[species];
  const palette = TREES.palette[name]; if (!palette) throw new RangeError('tree color species');
  const t = clamp(stage) * (palette.length - 1), k = Math.min(Math.floor(t), palette.length - 1);
  return new THREE.Color(palette[k]).lerp(new THREE.Color(palette[Math.min(k + 1, palette.length - 1)]), t - k).multiplyScalar(.88 + .24 * clamp(tint));
}
// The five autumn stops are derived from the existing species palettes, with unchanged saturation.
export function forestColor(species, tone, brightness = 1, hue = 0) {
  const c = TREES.forest2, p = TREES.palette;
  let color;
  if (tone < 3 && species === 3) {
    const t = c.tones[tone], k = Math.floor(t);
    color = new THREE.Color(p.maple[k]).lerp(new THREE.Color(p.maple[Math.min(3, k + 1)]), t - k);
    if (tone === 0) color.lerp(new THREE.Color(p.zelkova[3]), c.toneMix[0]).multiplyScalar(1 - c.toneMix[0]);
  } else if (tone === 4) color = new THREE.Color(p.zelkova[c.tones[4]]).lerp(new THREE.Color(p.zelkova[c.tones[3]]), c.toneMix[4]);
  else color = new THREE.Color(p.zelkova[tone === 2 ? c.tones[0] : c.tones[3]]);
  const hsl = color.getHSL({}); color.offsetHSL(hsl.h * hue, 0, 0);
  return color.multiplyScalar(brightness);
}
// No additional family or bake pass: old cedars keep their scaled trunk and lose lower foliage.
// The colour and shadow programs share the same cut; distant boards use the baked leaf mask.
export function forestProgram(material, { board = false, leaf = true, debug = false, depth = false } = {}) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    compile(shader);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float aForestAge;
      varying float vForestAge; varying float vForestHeight; varying float vForestPart;
      ${debug && !depth ? 'varying vec3 vForestDebug;' : ''}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vForestAge = aForestAge; vForestHeight = position.y;
      vForestPart = ${board || leaf ? '1.0' : 'aPivot.w'};
      ${debug && !depth ? 'vForestDebug = instanceColor;' : ''}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying float vForestAge; varying float vForestHeight; varying float vForestPart;
      ${debug && !depth ? 'varying vec3 vForestDebug;' : ''}`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      if (vForestAge > .5 && vForestPart > .5 && vForestHeight < ${(20 * TREES.forest2.oldCrown).toFixed(2)}${board ? ' && impNormal.a > .5' : ''}) discard;`);
    if (debug && !depth) shader.fragmentShader = shader.fragmentShader.replace('#include <fog_fragment>', '#include <fog_fragment>\n gl_FragColor.rgb = vForestDebug;');
  };
  material.customProgramCacheKey = () => `${key}-forest2-${board}-${leaf}-${debug}-${depth}`;
}
// Shape is a stable property of an individual, independent of LOD and array order. Brightness and
// height come from tint itself, so shape uses a second hash of it: tint bands tied each shape to one brightness.
const shapeHash = tint => { const v = clamp(tint) * 97.13 + .37; return v - Math.floor(v); };
export function treeShape(species, tint) {
  const count = TREES.variants[names[species]] ?? 1, h = shapeHash(tint);
  if (species === 0) return h < .45 ? Math.min(2, Math.floor(h / .15)) : h < .70 ? 3 : 4;
  return Math.min(count - 1, Math.floor(h * count));
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
    // L1 starts at 13/18m (shrub/sapling) and 40m (adult), inside the ±46m shadow box:
    // unshadowed L1 glowed in shade and popped at the split. L2 lies outside it.
    m.castShadow = level === 0; m.receiveShadow = level < 2;
    // The near level's shadow moves with the same wind and cedar profile as its crown (tree-materials.js depthMaterial).
    if (m.castShadow) m.customDepthMaterial = material.userData.depth;
    return m;
  }
  return { leaf: mesh(g.leaf, pair.leaf, 'tree-specimen-leaf'), wood: g.tris.wood ? mesh(g.wood, pair.wood, 'tree-specimen-wood') : null };
}
// The far level of an adult family as one baked board per tree (tree-bake.js): no trunk mesh, the board carries the trunk
// and takes the individual's bark brightness from aImpWood. It neither casts nor receives shadows, like the far cones.
export function createImpostorSet({ impostors, species, shape = 0, capacity }) {
  if (!Number.isInteger(capacity) || capacity < 0) throw new RangeError('tree capacity');
  const geometry = impostors.geometry(species, shape);
  geometry.setAttribute('aImpWood', new THREE.InstancedBufferAttribute(new Float32Array(capacity).fill(1), 1).setUsage(THREE.DynamicDrawUsage));
  const m = new THREE.InstancedMesh(geometry, impostors.material(species, shape), capacity);
  m.name = 'tree-impostor'; m.count = 0; m.frustumCulled = false;
  m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3).fill(1), 3).setUsage(THREE.DynamicDrawUsage);
  m.castShadow = false; m.receiveShadow = false;
  return { leaf: m, wood: null, impostor: true };
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
  constructor({ data, species, understory, wind, sunDir, quality = 'standard', renderer = null,
    forest2 = new URLSearchParams(globalThis.location?.search ?? '').get('forest2') !== '0',
    forest2debug = new URLSearchParams(globalThis.location?.search ?? '').get('forest2debug') === '1' }) {
    this.data = data;
    this.species = (!forest2 && species?.legacy ? species.legacy : species) ?? { species: data.kind, stage: new Uint8Array(data.x.length) };
    this.forest = forest2 && this.species.outside ? this.species : null;
    this.forestDebug = forest2 && forest2debug;
    this.forestColors = new Float32Array(data.x.length * 3);
    if (this.forest) for (let i = 0; i < data.x.length; i++) {
      const f = this.forest, sp = f.species[i];
      if (!f.outside[i]) continue;
      const color = sp === 1 || sp === 3 ? forestColor(sp, f.tone[i], f.brightness[i], f.hue[i])
        : new THREE.Color().setRGB(f.brightness[i] * (1 - f.blue[i]), f.brightness[i], f.brightness[i] * (1 + f.blue[i]));
      color.toArray(this.forestColors, i * 3);
    }
    this.forestSummary = this.forest ? { enabled: true, ...this.forest.summary } : { enabled: false };
    this.understory = understory ?? { x: [] };
    this.renderer = renderer; this.initialPixelRatio = renderer?.getPixelRatio?.() ?? 1; this.adaptiveTier = 0;
    this.light = quality === 'light';
    this.lod = TREES.lod[this.light ? 'light' : 'standard'];
    this.policy = { lod: this.lod, blend: TREES.lod.blend[this.light ? 'light' : 'standard'] };
    this.group = new THREE.Group(); this.group.name = 'trees';
    this.last = new THREE.Vector2(1e9, 1e9);
    this.materials = treeMaterials({ wind, sunDir, quality });
    // With a renderer the far adults are baked boards (8.1a, second round); without one (Node, a failed bake) they keep the far meshes.
    this.impostors = null; this.bakeMs = 0;
    if (renderer) {
      const impostors = treeImpostors({ wind, sunDir, quality, materials: this.materials });
      try { this.bakeMs = impostors.bake(renderer); this.impostors = impostors; }
      catch (error) { impostors.dispose(); console.warn('tree impostor bake failed; far trees keep their meshes', error); }
    }
    this.sets = []; this.lookup = new Map(); this.disposed = false;
    this.stats = { near: 0, mid: 0, far: 0, understory: 0, forest2: this.forestSummary };
    const counts = new Map();
    const count = (sp, variant, shape = 0) => { const key = `${sp}/${variant}/${shape}`; counts.set(key, (counts.get(key) ?? 0) + 1); };
    for (let i = 0; i < data.x.length; i++) { const sp = this.species.species[i]; count(sp, 0, treeShape(sp, data.tint[i])); }
    for (let i = 0; i < this.understory.x.length; i++) count(this.understory.species[i], this.understory.species[i] === 4 ? this.understory.variant[i] ?? 0 : 0);
    for (const [key, capacity] of counts) {
      const [sp, variant, shape] = key.split('/').map(Number), cfg = sp >= 4 ? TREES[names[sp]] : null;
      for (let level = 0; level < (cfg ? 2 : 3); level++) {
        const set = !cfg && level === 2 && this.impostors ? createImpostorSet({ impostors: this.impostors, species: sp, shape, capacity })
          : createTreeSet({ species: sp, level, capacity, materials: this.materials, variant, shape });
        Object.assign(set, { species: sp, level, variant, shape, capacity });
        // Reserve both hard-split levels during the five-metre allocation cadence.
        // Their shader masks are binary, so the reserve never cross-fades.
        const values = cfg ? [-1, -1, -1, -1] : uLodFor(level, this.policy);
        for (const mesh of [set.leaf, set.wood]) if (mesh) {
          mesh.name = `tree-${sp}-${level}-${variant}-${shape}-${set.impostor ? 'board' : mesh === set.leaf ? 'leaf' : 'wood'}`;
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
        if (this.forest || this.forestDebug) for (const mesh of [set.leaf, set.wood]) if (mesh) {
          mesh.geometry.setAttribute('aForestAge', new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1).setUsage(THREE.DynamicDrawUsage));
          forestProgram(mesh.material, { board: !!set.impostor, leaf: mesh === set.leaf, debug: this.forestDebug });
          if (mesh.customDepthMaterial) forestProgram(mesh.customDepthMaterial, { leaf: mesh === set.leaf, depth: true });
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
    let tier = 0;
    if (this.forest) {
      const pixelRatio = this.renderer?.getPixelRatio?.() ?? this.initialPixelRatio;
      this.initialPixelRatio = Math.max(this.initialPixelRatio, pixelRatio);
      const ratio = pixelRatio / this.initialPixelRatio;
      for (let k = 1; k < TREES.forest2.adaptive.length; k++) if (ratio < (TREES.forest2.adaptive[k - 1] + TREES.forest2.adaptive[k]) / 2) tier = k;
    }
    if (tier !== this.adaptiveTier) {
      this.adaptiveTier = tier; force = true;
      this.policy = { lod: this.lod.map(d => d * TREES.forest2.lodScale[tier]), blend: this.policy.blend };
      for (const set of this.sets) if (set.species < 4) for (const mesh of [set.leaf, set.wood]) if (mesh) mesh.material.userData.uLod.value.set(...uLodFor(set.level, this.policy));
    }
    if (!force && Math.hypot(cx - this.last.x, cz - this.last.y) < 5) return;
    this.last.set(cx, cz);
    for (const set of this.sets) { set.leaf.count = 0; if (set.wood) set.wood.count = 0; }
    this.stats = { near: 0, mid: 0, far: 0, understory: 0, forest2: { ...this.forestSummary, adaptiveTier: tier, drawnOld: 0 } };
    const put = (d, i, sp, stage, variant, shape, level, baseScale) => {
      const set = this.lookup.get(`${sp}/${variant}/${shape}/${level}`), k = set.leaf.count;
      if (k >= set.capacity) throw new RangeError('tree capacity exceeded');
      const tv = d.tint[i], f1 = (tv * 7.31) % 1, f2 = (tv * 3.17) % 1, f3 = (tv * 11.9) % 1;
      const forest = d === this.data && this.forest?.outside[i] ? this.forest : null;
      const old = forest?.old[i] ?? 0;
      const width = forest && sp === 0 ? forest.width[i] : .85 + .5 * f1;
      const height = forest && sp === 0 ? forest.height[i] : .85 + .45 * f2;
      this.s.set(baseScale * width, baseScale * height, baseScale * width);
      const tiltX = (((tv * 17.7) % 1) * 2 - 1) * Math.PI / 60;
      const tiltZ = (((tv * 23.3) % 1) * 2 - 1) * Math.PI / 60;
      this.q.setFromEuler(this.euler.set(tiltX, d.rot[i], tiltZ, 'YXZ')); this.p.set(d.x[i], d.y[i] - .15, d.z[i]); this.m.compose(this.p, this.q, this.s);
      if (forest) this.color.fromArray(this.forestColors, i * 3);
      else if (sp !== 0 && sp !== 2) this.color.copy(stageColor(sp, stage / 255, tv, variant));
      // Far conifers keep the near brightness and add only a small far-only jitter (no jump at the dissolve).
      else if (level === 2) { const v = (.85 + tv * .3) * (.88 + .24 * f3); this.color.setRGB(v * (.9 + .2 * f1), v, v * (.8 + .4 * f2)); }
      else { const v = .85 + tv * .3; this.color.setRGB(v, v * 1.02, v * .95); }
      if (old) this.stats.forest2.drawnOld++;
      if (this.forestDebug) this.color.set(TREES.forest2.debug[old ? 4 : sp === 4 ? (variant ? 3 : 1) : sp === 5 ? 1 : sp]);
      set.leaf.setMatrixAt(k, this.m); set.leaf.setColorAt(k, this.color); set.leaf.count++;
      if (set.leaf.geometry.attributes.aForestAge) set.leaf.geometry.attributes.aForestAge.array[k] = old;
      if (set.wood) {
        set.wood.setMatrixAt(k, this.m); this.color.setRGB(1, 1, 1).multiplyScalar(.85 + tv * .3);
        if (this.forestDebug) this.color.set(TREES.forest2.debug[old ? 4 : sp === 4 ? (variant ? 3 : 1) : sp === 5 ? 1 : sp]);
        set.wood.setColorAt(k, this.color); set.wood.count++;
        if (set.wood.geometry.attributes.aForestAge) set.wood.geometry.attributes.aForestAge.array[k] = old;
      } else if (set.impostor) set.leaf.geometry.attributes.aImpWood.array[k] = .85 + tv * .3;
      if (sp < 4) this.stats[['near', 'mid', 'far'][level]]++;
      else this.stats.understory++;
    };
    for (let i = 0; i < this.data.x.length; i++) {
      const d = this.data, distance = Math.hypot(d.x[i] - cx, d.z[i] - cz);
      const membership = lodMembership(distance, this.policy);
      for (let level = 0; level < 3; level++) if (membership[level]) {
        if (this.light && level === 2 && (i & 1)) continue;
        if (this.forest?.outside[i] && level === 2 && ((this.data.tint[i] * 31.73) % 1) >= TREES.forest2.farKeep[tier]) continue;
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
    for (const set of this.sets) {
      for (const mesh of [set.leaf, set.wood]) if (mesh) { mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true; }
      if (set.impostor) set.leaf.geometry.attributes.aImpWood.needsUpdate = true;
      for (const mesh of [set.leaf, set.wood]) if (mesh?.geometry.attributes.aForestAge) mesh.geometry.attributes.aForestAge.needsUpdate = true;
    }
    if (this.forest) {
      let calls = 0, triangles = 0;
      for (const set of this.sets) for (const mesh of [set.leaf, set.wood]) if (mesh?.count) { calls++; triangles += mesh.count * mesh.geometry.index.count / 3; }
      Object.assign(this.stats.forest2, { calls, triangles });
    }
  }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.group.removeFromParent();
    for (const set of this.sets) for (const mesh of [set.leaf, set.wood]) if (mesh) { mesh.geometry.dispose(); mesh.dispose(); }
    this.materials.dispose(); this.impostors?.dispose(); this.group.clear();
  }
}
