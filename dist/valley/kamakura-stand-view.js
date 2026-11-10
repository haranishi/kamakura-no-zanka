// Static forest skin and a bounded, shared pool of ordinary child trees. No valley TreeField changes.
import * as THREE from 'three';
import { atmospherePolicy } from './kamakura-atmosphere.js';
import { applyVegLook, vegLookEnabled } from './kamakura-veg-look.js';
import { crownLookEnabled } from './kamakura-crown.js';
import { applyCrownLook } from './kamakura-crown-look.js';
import { TREES } from './config.js';
import { treeMaterials } from './tree-materials.js';
import { treeGeometry } from './tree-geometry.js';
import { canopyHandoff, stands2Enabled, canopyEnabled } from './kamakura-canopy.js';
import { TREE_NAMES, vegCircles, mapVeg } from './kamakura-veg.js';
import { buildKamakuraVeg, vegHeight } from './kamakura-veg-view.js';
import { planStandChunks, generateStandChunk, combineStandChunks, standColor } from './kamakura-stands.js';
import { addColliderCircles } from './collision.js';
// All new visual controls live here; colours come from the ordinary tree materials, not a new palette.
export const STANDS2 = Object.freeze({
  tile: 1000, // m: shared draw tile edge, independent of tree species.
  lodDistance: 1200, // m: 3D distance from tile centre to switch to the far crown.
  lodHysteresis: 100, // m: return to the near crown this much closer.
  variants: 3, // shapes: deterministic crown families shared by tiles.
  lobes: 4, // overlapping crowns in each shape, near and far.
  lobeOffset: .35, // radius fraction: offset of the four lobe centres.
  lobeRadius: .65, // radius fraction: each lobe's horizontal radius.
  shapeTurn: .47, // radians: phase offset between crown families.
  shapeWave: 2.3, // radians: irregular lobe width phase.
  lobeJitter: .12, // ratio: deterministic lobe width and height variation.
  bottom: -.6, // height fraction: flat buried crown base.
  upper: .72, // height fraction: near-only rounding ring.
  upperRadius: .72, // ratio: near-only rounding ring width.
  centreHeight: .3, // tree heights: crown origin above sampled ground.
  height: .7, // tree heights: crown vertical scale, unchanged from old stands.
  aspect: .15, // ratio: per-instance independent X/Y/Z aspect variation.
  brightness: .16, // ratio: maximum per-instance brightness variation.
  // Far crowns are seen from their sunlit tops; the near trees' mean colour (measured in their own shade) left the hills a
  // near-black green from the overlook. Gains per ordinary tree species [cedar, zelkova, pine, maple]; broadleaves lean warm.
  gain: Object.freeze([1.5, 2.05, 1.6, 2.1]), // ratio: far-crown albedo relative to the near trees' mean.
  warm: Object.freeze([0, .1, .02, .14]), // ratio: red up / blue down for sunlit broadleaves.
  hue: .025, // ratio: small red/blue variation with neutral green.
  wrap: .35, // ratio: wrapped Lambert diffuse, keeping scene light and shadow visibility.
  floor: .24, // albedo ratio: ordinary far-board emissive floor (tree-bake).
  shade: .34, // ratio: vertex occlusion at the crown base, top is 1 (dark gaps between neighbouring crowns).
  detailFine: 1.2, // m: small leaf-cluster noise wavelength.
  detailCoarse: 3.5, // m: large leaf-cluster noise wavelength.
  detail: .3, // ratio: brightness modulation about the mean.
  detailNormal: .26, // ratio: normal perturbation before scene lighting.
  detailFadeFrom: .5, // cells per pixel: start filtering subpixel detail.
  detailFadeTo: 1, // cells per pixel: completely remove subpixel detail.
  debugFar: .55, // ratio: darken flat debug colour on far geometry.
  debugVeg: 0xff00ff, // sRGB: T0-derived canopy.
  debugT1: 0x00ffff, // sRGB: existing T1.
  debugT2: 0xffff00, // sRGB: existing T2.
  movement: 5, // m: existing child-tree reselection pitch.
});
const f = n => Number(n).toFixed(6);
// Rounded crowns, not spires: each lobe is a five-sided dome (a belly wider than the base, a shoulder, a blunt top).
// The first version used three-sided pyramids; from the overlook the hills read as a spruce plantation of dark cones.
// Near: two overlapping domes of different size. Far: one dome that covers both. Closed meshes with a flat buried base.
const DOME = Object.freeze({
  sides: 5,
  near: Object.freeze([[STANDS2.bottom, .84], [.12, 1], [.64, .7]]),   // [height fraction, radius fraction] rings below the tip (56 triangles for two lobes: the all-tile budget)
  far: Object.freeze([[STANDS2.bottom, .92], [.34, 1.04]]),   // 18 triangles: a blunt, smooth-shaded mound. Far crowns are a few pixels wide.
  lobes: Object.freeze([[-.28, 0, .78, 1], [.34, .1, .62, .82]]),               // near lobes: [x, z, radius, top]
  lump: .12,                                                                     // ratio: deterministic bulge of each ring vertex
});
export function canopyGeometry(variant = 0, far = false) {
  const positions = [], colors = [], indices = [], n = DOME.sides, rings = far ? DOME.far : DOME.near;
  const turn = variant * STANDS2.shapeTurn, lobes = far ? [[0, 0, 1, 1]] : DOME.lobes;
  for (let l = 0; l < lobes.length; l++) {
    const [ox, oz, radius, top] = lobes[l], cx = ox * Math.cos(turn) - oz * Math.sin(turn), cz = ox * Math.sin(turn) + oz * Math.cos(turn);
    const start = positions.length / 3;
    const vertex = (x, y, z) => {
      positions.push(x, y, z);
      const t = Math.max(0, Math.min(1, (y - STANDS2.bottom) / (top - STANDS2.bottom)));
      const shade = STANDS2.shade + (1 - STANDS2.shade) * t;
      colors.push(shade, shade, shade);
    };
    for (let r = 0; r < rings.length; r++) for (let k = 0; k < n; k++) {
      const a = (k + r * .5) / n * Math.PI * 2 + turn + l * 1.3;
      // The base ring stays on the flat bottom; the rings above bulge in and out so that no two crowns share a silhouette.
      const bulge = 1 + DOME.lump * Math.sin((k + 1) * (variant + 2) * STANDS2.shapeWave + r * 1.9 + l * 2.7);
      const y = r === 0 ? STANDS2.bottom : rings[r][0] * top * (1 + .5 * DOME.lump * Math.cos((k + 2) * (variant + 1) + r));
      vertex(cx + Math.cos(a) * radius * rings[r][1] * bulge, y, cz + Math.sin(a) * radius * rings[r][1] * bulge);
    }
    const tip = positions.length / 3; vertex(cx, top, cz);
    for (let k = 1; k < n - 1; k++) indices.push(start, start + k, start + k + 1);   // flat buried base
    for (let r = 0; r < rings.length - 1; r++) for (let k = 0; k < n; k++) {
      const a = start + r * n + k, b = start + r * n + (k + 1) % n, c = a + n, d = b + n;
      indices.push(a, c, b, b, c, d);
    }
    for (let k = 0; k < n; k++) indices.push(start + (rings.length - 1) * n + k, tip, start + (rings.length - 1) * n + (k + 1) % n);
  }
  const g = new THREE.BufferGeometry(); g.setIndex(indices);
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
  return g;
}
// Uses exactly the same image mean, leaf gain, palette tint and exposure vertices as the ordinary trees.
function foliageMeans(wind, sunDir, quality) {
  const source = treeMaterials({ wind, sunDir, quality }), result = [];
  try {
    for (let species = 0; species < 4; species++) {
      const g = treeGeometry(species, 0, 0).leaf, p = g.attributes.position, c = g.attributes.color, ix = g.index.array;
      const sum = [0, 0, 0]; let area = 0;
      const a = new THREE.Vector3(), b = new THREE.Vector3(), d = new THREE.Vector3();
      for (let k = 0; k < ix.length; k += 3) {
        a.fromBufferAttribute(p, ix[k]); b.fromBufferAttribute(p, ix[k + 1]).sub(a); d.fromBufferAttribute(p, ix[k + 2]).sub(a);
        const w = b.cross(d).length(); area += w;
        for (let q = 0; q < 3; q++) sum[q] += w * (c.array[ix[k] * 3 + q] + c.array[ix[k + 1] * 3 + q] + c.array[ix[k + 2] * 3 + q]) / 3;
      }
      const m = source.get(species, 2).leaf.color.toArray();
      result.push(sum.map((v, k) => v / (area || 1) * m[k]));
    }
  } finally { source.dispose(); }
  return result;
}
function handoffShader(material, tier, policy, eye, handoff) {
  material.userData.uStandEye = eye; material.userData.uCanopyHandoff = handoff;
  material.onBeforeCompile = shader => {
    shader.uniforms.uStandEye = eye; shader.uniforms.uCanopyHandoff = handoff;
    shader.vertexShader = 'uniform vec3 uStandEye; uniform vec2 uCanopyHandoff; attribute float aStandExpand;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 standOrigin = (modelMatrix * instanceMatrix[3]).xyz;
      float standDistance = distance(standOrigin.xz, uStandEye.xz);
      float standKeep = ${tier === 0 ? 'smoothstep(uCanopyHandoff.x, uCanopyHandoff.y, standDistance)' : `smoothstep(${policy.hide[tier][0].toFixed(1)}, ${policy.hide[tier][1].toFixed(1)}, standDistance)`};
      transformed *= mix(1.0, standKeep, aStandExpand);
    `);
  };
  material.customProgramCacheKey = () => `kamakura-stand-${tier}`;
}
const NOISE = `
float kzStandHash(vec3 p) { return fract(sin(dot(p,vec3(12.9898,37.719,78.233)))*43758.5453); }
float kzStandNoise(vec3 p) {
  vec3 b=floor(p), t=fract(p); t=t*t*(3.0-2.0*t);
  return mix(mix(mix(kzStandHash(b),kzStandHash(b+vec3(1.0,0.0,0.0)),t.x),
    mix(kzStandHash(b+vec3(0.0,1.0,0.0)),kzStandHash(b+vec3(1.0,1.0,0.0)),t.x),t.y),
    mix(mix(kzStandHash(b+vec3(0.0,0.0,1.0)),kzStandHash(b+vec3(1.0,0.0,1.0)),t.x),
    mix(kzStandHash(b+vec3(0.0,1.0,1.0)),kzStandHash(b+vec3(1.0,1.0,1.0)),t.x),t.y),t.z);
}`;
function canopyLook(material) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  material.onBeforeCompile = shader => {
    compile(shader);
    shader.vertexShader = 'varying vec3 vStandObject;\n' + shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      // Physical local position: rotation/translation do not make the detail slide.
      vStandObject = position * vec3(length(instanceMatrix[0].xyz),length(instanceMatrix[1].xyz),length(instanceMatrix[2].xyz));`);
    shader.fragmentShader = 'varying vec3 vStandObject;\n' + NOISE + '\n' + shader.fragmentShader;
    // Keep the shared fog, hemisphere light and directional shadow computation. Only direct diffuse wraps.
    shader.fragmentShader = shader.fragmentShader.replace('#include <lights_lambert_pars_fragment>', THREE.ShaderChunk.lights_lambert_pars_fragment.replace('saturate( dot( geometryNormal, directLight.direction ) )', `(clamp((dot(geometryNormal,directLight.direction)+${f(STANDS2.wrap)})/(1.0+${f(STANDS2.wrap)}),0.0,1.0))`));
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      vec3 kzFineP = vStandObject / ${f(STANDS2.detailFine)}, kzCoarseP = vStandObject / ${f(STANDS2.detailCoarse)};
      float kzFineW = 1.0-smoothstep(${f(STANDS2.detailFadeFrom)},${f(STANDS2.detailFadeTo)},max(fwidth(kzFineP.x),max(fwidth(kzFineP.y),fwidth(kzFineP.z))));
      float kzCoarseW = 1.0-smoothstep(${f(STANDS2.detailFadeFrom)},${f(STANDS2.detailFadeTo)},max(fwidth(kzCoarseP.x),max(fwidth(kzCoarseP.y),fwidth(kzCoarseP.z))));
      float kzFineN = (kzStandNoise(kzFineP)*2.0-1.0)*kzFineW;
      float kzCoarseN = (kzStandNoise(kzCoarseP)*2.0-1.0)*kzCoarseW;
      diffuseColor.rgb *= 1.0+${f(STANDS2.detail)}*(kzFineN+kzCoarseN)*0.5;
      normal = normalize(normal+${f(STANDS2.detailNormal)}*(kzFineN+kzCoarseN)*vec3(0.6,0.2,0.7));
    `).replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb * ${f(STANDS2.floor)};`);
    // Our instance colour already varies brightness/hue. Do not multiply a second species palette into it.
    shader.vertexShader = shader.vertexShader.replace(/vKzTint = [^;]+;/, 'vKzTint = vec3(1.0);').replace(/vKzCardTint = [^;]+;/, 'vKzCardTint = vec2(1.0,0.0);');
  };
  material.customProgramCacheKey = () => `${key}-stands2`;
}
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
  // The ordinary rollback uses the original constructor/update path, including its child scheduling.
  const params = new URLSearchParams(search);
  if (!stands2Enabled(search) && !canopyEnabled(search) && params.get('debug') !== '1' && params.get('canopydebug') !== '1') {
    return buildLegacyStands(prepared, { wind, sunDir, quality, renderer, colliders, search });
  }
  const group = new THREE.Group(), distant = [], resident = new Map(), releases = new Map();
  const eye = { value: new THREE.Vector3() }, resources = new Set(), policy = prepared.policy;
  const band = canopyHandoff(quality), handoff = { value: new THREE.Vector2(band.from, band.to) };
  const modern = stands2Enabled(search), debug = new URLSearchParams(search).get('canopydebug') === '1';
  const look = { value: quality === 'light' ? .65 : 1 }, lookEnabled = vegLookEnabled(search);
  const report = { clumps: { veg: 0, t1: 0, t2: 0 }, drawn: { tiles: 0, instances: 0, triangles: 0, draws: 0 },
    lod: { near: 0, far: 0 }, handoff: { from: band.from, to: band.to }, nearest: { tier: null, distance: null, bearing: null }, look: modern ? 'stands2' : 'old' };
  const stats = { chunks: 0, pending: 0, children: { counts: [0, 0, 0], triangles: 0, dropped: [0, 0, 0], cells: 0, scanned: 0 }, distant: 0 };
  const childTiles = [];
  for (const [key] of prepared.grid) {
    const [x, z] = key.split(',').map(Number);
    childTiles.push({ key, x: x * 256, z: z * 256, active: false });
  }
  let children, disposed = false, lastX = Infinity, lastZ = Infinity, rangeScale = 1, dirty = true;
  const families = [];
  for (const species of [0, 1, 2]) for (let shape = 0; shape < TREES.variants[TREE_NAMES[species]]; shape++) families.push(`${species}/${shape}`);
  const inspect = new URLSearchParams(search).get('debug') === '1';
  const frustum = inspect ? new THREE.Frustum() : null, clip = inspect ? new THREE.Matrix4() : null, probe = inspect ? new THREE.Vector3() : null;
  const debugRead = () => report;
  function dispose() {
    if (disposed) return; disposed = true;
    if (globalThis.__kzCanopy === debugRead) delete globalThis.__kzCanopy;
    for (const release of releases.values()) release(); releases.clear(); resident.clear();
    children?.dispose();
    for (const resource of resources) resource.dispose(); resources.clear();
    group.removeFromParent(); group.clear(); distant.length = 0;
  }
  try {
    const geometry = standGeometry(); resources.add(geometry);
    const shapes = [];
    if (modern) for (let variant = 0; variant < STANDS2.variants; variant++) {
      const near = canopyGeometry(variant), far = canopyGeometry(variant, true);
      resources.add(near); resources.add(far); shapes.push({ near, far });
    }
    const means = modern ? foliageMeans(wind, sunDir, quality) : null;
    const batches = modern ? new Map() : prepared.distant;
    if (modern) for (const items of prepared.distant.values()) for (const item of items) {
      const k = `${item.tier}/${Math.floor(item.x / STANDS2.tile)},${Math.floor(item.z / STANDS2.tile)}`;
      if (!batches.has(k)) batches.set(k, []);
      batches.get(k).push(item);
    }
    const materials = new Map(), matrix = new THREE.Matrix4(), position = new THREE.Vector3(), scale = new THREE.Vector3(), rotation = new THREE.Quaternion(), color = new THREE.Color();
    for (const [key, items] of batches) {
      const tier = items[0].tier, variant = distant.length % STANDS2.variants;
      if (!materials.has(tier)) {
        const material = debug ? new THREE.MeshBasicMaterial({ vertexColors: false, fog: false, toneMapped: false }) : new THREE.MeshLambertMaterial({ vertexColors: true });
        resources.add(material); materials.set(tier, material);
        handoffShader(material, tier, policy, eye, handoff);
        if (!debug && lookEnabled) applyVegLook(material, { lightsChunk: THREE.ShaderChunk.lights_fragment_begin, species: -1, leaf: true, geometry: modern ? shapes[variant].near : geometry, sunDir, strength: look, stand: true });
        if (!debug && lookEnabled && crownLookEnabled(search)) applyCrownLook(material, { geometry: modern ? shapes[variant].near : geometry, light: quality === 'light', distant: true });
        if (!debug && modern) canopyLook(material);
        if (debug) {
          material.color.setHex(tier === 0 ? STANDS2.debugVeg : tier === 1 ? STANDS2.debugT1 : STANDS2.debugT2);
          const farMaterial = material.clone(); resources.add(farMaterial);
          handoffShader(farMaterial, tier, policy, eye, handoff); farMaterial.color.multiplyScalar(STANDS2.debugFar);
          materials.set(`far/${tier}`, farMaterial);
        }
      }
      const g = (modern ? shapes[variant].near : geometry).clone(); resources.add(g);
      if (lookEnabled) g.setAttribute('aKzSpecies', new THREE.InstancedBufferAttribute(Float32Array.from(items, i => i.species), 1));
      g.setAttribute('aStandExpand', new THREE.InstancedBufferAttribute(Float32Array.from(items, i => tier === 0 || tier === 2 || i.expandable ? 1 : 0), 1));
      let farGeometry = g;
      if (modern) {
        farGeometry = shapes[variant].far.clone(); resources.add(farGeometry);
        if (lookEnabled) farGeometry.setAttribute('aKzSpecies', g.attributes.aKzSpecies);
        farGeometry.setAttribute('aStandExpand', g.attributes.aStandExpand);
      }
      const mesh = new THREE.InstancedMesh(g, materials.get(tier), items.length); resources.add(mesh); mesh.name = `stand/${key}`;
      mesh.castShadow = atmospherePolicy(quality).standShadows; mesh.receiveShadow = true;
      if (modern || tier === 0) {
        const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }); resources.add(depth);
        handoffShader(depth, tier, policy, eye, handoff); mesh.customDepthMaterial = depth;
      }
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      items.forEach((i, k) => {
        let ax = 1, ay = 1, az = 1;
        // Id/position make shape and colour repeatable; no view-dependent transforms.
        const seed = Math.imul((i.id ?? k) + 1, 1664525) >>> 0;
        const noise = salt => { let n = Math.imul(seed ^ salt, 2246822519) >>> 0; n ^= n >>> 13; return (n >>> 0) / 4294967296 * 2 - 1; };
        if (modern) { ax += STANDS2.aspect * noise(17); ay += STANDS2.aspect * noise(43); az += STANDS2.aspect * noise(89); }
        position.set(i.x, i.y + i.height * STANDS2.centreHeight, i.z);
        scale.set(i.crown * ax, i.height * STANDS2.height * ay, i.crown * az);
        rotation.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, i.yaw ?? (modern ? noise(131) * Math.PI : 0));
        matrix.compose(position, rotation, scale); mesh.setMatrixAt(k, matrix);
        if (!debug) {
          if (modern) {
            const mapped = mapVeg({ ...i, tier: 0, variant: 0, sourceSpecies: i.sourceSpecies ?? [2, 0, 1, 6][i.species], tint: i.tint ?? 0 });
            const tint = mapped.color, mean = means[i.species], gain = 1 + STANDS2.brightness * noise(199), hue = STANDS2.hue * noise(271);
            const lift = STANDS2.gain[i.species] ?? 1, warm = STANDS2.warm[i.species] ?? 0;
            color.setRGB(tint[0] * mean[0] * gain * lift * (1 + hue + warm), tint[1] * mean[1] * gain * lift, tint[2] * mean[2] * gain * lift * (1 - hue - warm));
          } else color.setRGB(...(tier === 0 ? standColor({ ...i, sourceSpecies: i.sourceSpecies === 6 ? 3 : i.sourceSpecies }) : i.color));
          mesh.setColorAt(k, color);
        }
        report.clumps[tier === 0 ? 'veg' : tier === 1 ? 't1' : 't2']++;
      });
      mesh.computeBoundingBox(); mesh.computeBoundingSphere();
      mesh.updateMatrix(); mesh.matrixAutoUpdate = false; group.add(mesh);
      // Static, conservative bounds contain both LODs (including independent aspect variation).
      const sphere = mesh.boundingSphere;
      if (modern) sphere.radius += Math.max(...items.map(i => Math.max(i.crown, i.height))) * .5;
      distant.push({ mesh, sphere, range: policy.ranges[tier || 1], tier, items, nearGeometry: g, farGeometry, far: false, casts: mesh.castShadow,
        nearMaterial: materials.get(tier), farMaterial: materials.get(`far/${tier}`) || materials.get(tier) });
    }
    children = buildKamakuraVeg({ active: [], grid: new Map() }, { wind, sunDir, quality, search, renderer: prepared.grid.size ? renderer : null, families: prepared.grid.size ? families : [] });
    group.add(children.group);
    if (inspect) globalThis.__kzCanopy = debugRead;
  } catch (error) { dispose(); throw error; }
  function update(camera) {
    if (disposed) return;
    const pos = camera.position; eye.value.set(pos.x, pos.y ?? 0, pos.z);
    const drawn = report.drawn, lod = report.lod, nearest = report.nearest;
    drawn.tiles = drawn.instances = drawn.triangles = drawn.draws = lod.near = lod.far = 0;
    nearest.tier = nearest.distance = nearest.bearing = null;
    let best = Infinity;
    const hasFrustum = inspect && camera.isCamera;
    if (hasFrustum) {
      camera.updateMatrixWorld(); clip.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      frustum.setFromProjectionMatrix(clip, camera.coordinateSystem, camera.reversedDepth);
    }
    // No per-frame arrays, objects, closures, matrix writes or geometry creation.
    for (let k = 0; k < distant.length; k++) {
      const d = distant[k], mesh = d.mesh, sphere = d.sphere;
      const distance = Math.hypot(sphere.center.x - pos.x, sphere.center.y - (pos.y ?? 0), sphere.center.z - pos.z);
      mesh.visible = Math.hypot(sphere.center.x - pos.x, sphere.center.z - pos.z) - sphere.radius <= d.range * rangeScale;
      if (d.tier === 0 && Math.hypot(sphere.center.x - pos.x, sphere.center.z - pos.z) + sphere.radius < handoff.value.x) mesh.visible = false;
      if (modern) {
        if (d.far ? distance < STANDS2.lodDistance - STANDS2.lodHysteresis : distance > STANDS2.lodDistance) d.far = !d.far;
        mesh.geometry = d.far ? d.farGeometry : d.nearGeometry;
        mesh.material = d.far ? d.farMaterial : d.nearMaterial;
        // Far crowns do not enter the shadow pass: from the overlook that pass doubled the cost of some seventy thousand crowns.
        mesh.castShadow = !d.far && d.casts;
      }
      if (!mesh.visible || hasFrustum && !frustum.intersectsSphere(sphere)) continue;
      drawn.tiles++; drawn.instances += mesh.count; drawn.triangles += mesh.count * mesh.geometry.index.count / 3; drawn.draws++;
      if (d.far) lod.far += mesh.count; else lod.near += mesh.count;
      // Diagnostics are opt-in; ordinary traversal only visits tiles.
      if (globalThis.__kzCanopy === debugRead) for (let n = 0; n < d.items.length; n++) {
        const i = d.items[n], horizontal = Math.hypot(i.x - pos.x, i.z - pos.z);
        if (d.tier === 0 && horizontal <= handoff.value.x || d.tier !== 0 && (d.tier === 2 || i.expandable) && horizontal <= policy.hide[d.tier][0]) continue;
        if (hasFrustum && !frustum.containsPoint(probe.set(i.x, i.y + i.height * STANDS2.centreHeight, i.z))) continue;
        const metres = Math.hypot(horizontal, i.y + i.height * STANDS2.centreHeight - (pos.y ?? 0));
        if (metres < best) { best = metres; nearest.tier = d.tier === 0 ? 'veg' : d.tier === 1 ? 't1' : 't2'; nearest.distance = metres;
          nearest.bearing = (Math.atan2(i.x - pos.x, pos.z - i.z) * 180 / Math.PI + 360) % 360; }
      }
    }
    let changed = false, pending = 0, created = 0;
    for (let k = 0; k < childTiles.length; k++) {
      const t = childTiles[k];
      const distance = Math.hypot(Math.max(t.x - pos.x, 0, pos.x - t.x - 256), Math.max(t.z - pos.z, 0, pos.z - t.z - 256));
      if (t.active && distance > policy.retain) {
        releases.get(t.key)?.(); releases.delete(t.key); resident.delete(t.key); t.active = false; changed = true;
      }
      if (!t.active && distance <= policy.enter) {
        if (created >= policy.perFrame) { pending++; continue; }
        const chunk = generateStandChunk(prepared, t.key), circles = vegCircles(chunk, vegHeight);
        if (colliders) releases.set(t.key, addColliderCircles(colliders, circles));
        resident.set(t.key, chunk); t.active = true; changed = true; created++;
      }
    }
    if (changed) children.replacePrepared(combineStandChunks(resident));
    if (changed || dirty || Math.hypot(pos.x - lastX, pos.z - lastZ) >= STANDS2.movement) {
      if (childTiles.length) stats.children = children.update(camera, changed || dirty);
      lastX = pos.x; lastZ = pos.z; dirty = false;
    }
    stats.chunks = resident.size; stats.pending = pending; stats.distant = drawn.instances;
    return stats;
  }
  return { group, distant, resident, children, eye, handoff, update, dispose, debugText: () => `canopy:${report.drawn.instances}`,
    setAdapt(next) { rangeScale = next.standRange; const band = canopyHandoff(quality, next.impostorRange); handoff.value.set(band.from, band.to);
      report.handoff.from = band.from; report.handoff.to = band.to; dirty = true; children.setAdapt(next); },
    get stats() { return stats; } };
}

// Unmodified pre-W2c-18 path, retained only for the two-switch rollback.
function buildLegacyStands(prepared, { wind, sunDir, quality = 'standard', renderer = null, colliders, search = '' }) {
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
