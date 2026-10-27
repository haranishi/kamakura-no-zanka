// Grass view: full deterministic chunks are cached; only active tiles are submitted.
import * as THREE from 'three';
import { GRASS } from './config.js';
import { nearTile, midTile, tilesAround, SUSUKI, FLOWER } from './grass-field.js';
import { CHUNK_TILES, chunkTiles, wantedChunks, planChunks } from './grass-schedule.js';
import { patchLift } from './grade.js';

const STRIDE = 15, TAU = Math.PI * 2;
const palette = [['#5b7736', '#a09e56'], ['#65803d', '#b0a65d'], ['#65803d', '#b0a65d'], ['#426b37', '#6b894b'], ['#5b7736', '#a09e56']];
const colors = palette.map(p => p.map(c => new THREE.Color(c)));
const stem = new THREE.Color('#4c6a2c'), head = new THREE.Color('#b3261e'), plume = new THREE.Color('#e3d6ad');
const hash = (x, z, n) => { const v = Math.sin(x * 127.1 + z * 311.7 + n * 74.7) * 43758.5453; return v - Math.floor(v); };

function cardTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d'); g.lineCap = 'round';
  for (let v = 0; v < 4; v++) {
    const seed = 11 + v;
    const centers = Array.from({ length: 6 }, (_, k) => 128 + (hash(seed, k, 9) - .5) * 110);
    for (let i = 0; i < 110; i++) {
      const k = Math.floor(hash(seed, i, 7) * 6), cx = centers[k];
      const x = v * 256 + cx + (hash(seed, i, 1) - .5) * 36, y = 254;
      const length = 235 * (.35 + .65 * hash(seed, i, 2) * (.6 + .4 * hash(seed, k, 8)));
      const top = y - length, dx = (hash(seed, i, 3) - .5) * 110, bend = (hash(seed, i, 4) - .5) * 40;
      const width = 2.4 + 2.2 * hash(seed, i, 5), shade = .82 + .30 * hash(seed, i, 6);
      const gv = value => Math.max(0, Math.min(255, Math.round(255 * value * shade)));
      const gradient = g.createLinearGradient(0, y, 0, top);
      gradient.addColorStop(0, `rgba(${gv(.5)},${gv(.5)},${gv(.5)},0.2)`);
      gradient.addColorStop(.3, `rgb(${gv(.62)},${gv(.62)},${gv(.62)})`);
      gradient.addColorStop(1, `rgb(${gv(1)},${gv(1)},${gv(1)})`);
      g.fillStyle = gradient;
      g.beginPath(); g.moveTo(x - width / 2, y);
      g.quadraticCurveTo(x + dx * .45 + bend - width / 3, y - length * .5, x + dx - width * .1, top + 1);
      g.quadraticCurveTo(x + dx, top - 1, x + dx + width * .1, top + 1);
      g.quadraticCurveTo(x + dx * .45 + bend + width / 3, y - length * .5, x + width / 2, y); g.fill();
    }
  }
  // Bleed neutral gray only into transparent padding; keep leaf shading and alpha.
  const pixels = g.getImageData(0, 0, c.width, c.height);
  for (let i = 0; i < pixels.data.length; i += 4) {
    if (pixels.data[i + 3] < 6) pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = 190;
  }
  // Upload raw, unpremultiplied bytes. A canvas upload would erase RGB at
  // alpha zero again and undo the edge bleed above.
  const map = new THREE.DataTexture(pixels.data, c.width, c.height, THREE.RGBAFormat);
  map.flipY = true; map.colorSpace = THREE.SRGBColorSpace; map.needsUpdate = true;
  map.generateMipmaps = true; map.minFilter = THREE.LinearMipmapLinearFilter;
  return map;
}

function materialFor(kind, wind, sun, radii, map, quality) {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map,
    alphaTest: kind === 'mid' ? .3 : 0, alphaToCoverage: kind === 'mid' && quality === 'standard', emissive: 0x182212 });
  patchLift(m, .8);
  const lift = m.onBeforeCompile;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, wind, { uSunDir: sun, uGrassRadii: radii, uGroundTint: { value: new THREE.Color('#6b6a35') } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute vec4 iRoot; attribute vec4 iShape; attribute vec3 iColor; attribute vec4 iTip;
      uniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uGuideMix;
      uniform vec2 uGrassRadii;
      varying float vGrassDistance;
      varying vec3 vGrassColor; varying vec3 vGrassWorld; varying vec2 vGrassUV;
      float grassNoise(vec2 p) {
        vec2 a = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
        return mix(mix(sin(dot(a,vec2(12.9898,78.233))),sin(dot(a+vec2(1,0),vec2(12.9898,78.233))),f.x),
          mix(sin(dot(a+vec2(0,1),vec2(12.9898,78.233))),sin(dot(a+vec2(1,1),vec2(12.9898,78.233))),f.x),f.y);
      }
      vec2 grassWind(vec3 root, float t, float h) {
        float ph = root.x*.37 + root.z*.21;
        float slow = (sin(uTime*1.15+ph)+.5*sin(uTime*2.4+ph*1.7))*.065;
        float flutter = sin(uTime*7.1+ph*2.3+t*4.0)*.018*t;
        float bandPhase = dot(root.xz,uWindDir)*.045-uTime*.9;
        float band = smoothstep(.55,.95,sin(bandPhase+grassNoise(root.xz*.025)*.65));
        float gust = band*.35*step(.5,uWind)*(1.0+.6*uGuideMix);
        vec2 local = vec2(sin(iRoot.w),cos(iRoot.w));
        vec2 dir = normalize(mix(uWindDir*.8+local*.2,uWindDir,uGuideMix));
        return (dir*(slow+gust)+vec2(-dir.y,dir.x)*flutter)*h*t*t*uWind;
      }`).replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
        vec3 leafNormal = vec3(objectNormal.x*cos(iRoot.w)-objectNormal.z*sin(iRoot.w), .15,
          objectNormal.x*sin(iRoot.w)+objectNormal.z*cos(iRoot.w));
        objectNormal = normalize(mix(leafNormal,vec3(0,1,0),${kind === 'mid' ? '.8' : '.65'}));`)
      .replace('#include <begin_vertex>', `
        float t = uv.y;
        vec2 along = vec2(cos(iRoot.w),sin(iRoot.w));
        vec3 rootWorld = (modelMatrix*vec4(iRoot.xyz,1.0)).xyz;
        float dd = distance(rootWorld.xz,cameraPosition.xz);
        float fadeOut = smoothstep(${kind === 'near' ? '.75*uGrassRadii.x,1.25*uGrassRadii.x' : '.45*uGrassRadii.y,uGrassRadii.y'},dd);
        float alive = step(fadeOut,iShape.w);
        ${kind === 'mid' ? 'float appear = smoothstep(.85*uGrassRadii.x,1.25*uGrassRadii.x,dd); alive *= step(fract(iShape.w*7.13),appear);' : ''}
        vec3 transformed;
        ${kind === 'near' ? `
          vec2 viewXZ = normalize(cameraPosition.xz-rootWorld.xz+vec2(.0001));
          float face = abs(dot(viewXZ,vec2(-along.y,along.x)));
          float widen = mix(2.5,1.0,smoothstep(0.0,.6,face)) * mix(1.0,1.6,fadeOut);
          float width = mix(max(.02,1.0-t),iTip.x,t*t);
          transformed = vec3(along.x*position.x*iShape.y*width*widen,t*iShape.x,along.y*position.x*iShape.y*width*widen);
          transformed.xz += vec2(-along.y,along.x)*iShape.z*iShape.x*t*t;` : `
          vec2 p = mat2(along.x,along.y,-along.y,along.x)*position.xz*iShape.y;
          transformed = vec3(p.x,t*iShape.x,p.y) * mix(.7,1.0,appear);
          vec3 axis = vec3(-sin(iTip.z),0.0,cos(iTip.z));
          transformed = transformed*cos(iTip.y) + cross(axis,transformed)*sin(iTip.y)
            + axis*dot(axis,transformed)*(1.0-cos(iTip.y));`}
        transformed.xz += grassWind(rootWorld,t,iShape.x);
        transformed *= alive;
        transformed += iRoot.xyz;
        vGrassWorld = (modelMatrix*vec4(transformed,1.0)).xyz;
        vGrassUV = uv; vGrassDistance = dd;
        vGrassColor = ${kind === 'near' ? 'mix(iColor,iTip.yzw,smoothstep(.55,1.0,t)*step(.01,iTip.x))' : 'iColor'}
          *${kind === 'near' ? 'mix(.6,1.1,t)' : 'mix(.9,1.1,t)'}*${kind === 'near' ? 'mix(.85,1.15,iShape.w)' : '1.0'};
      `).replace('#include <uv_vertex>', `#include <uv_vertex>
        ${kind === 'mid' ? '#ifdef USE_MAP\n vMapUv.x = (mix(vMapUv.x,1.0-vMapUv.x,step(iShape.z,0.0))+floor(iShape.w*3.999))/4.0;\n #endif' : ''}`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform vec3 uSunDir; uniform vec3 uGroundTint; varying float vGrassDistance; varying vec3 vGrassColor; varying vec3 vGrassWorld; varying vec2 vGrassUV;`)
      .replace('#include <map_fragment>', `#include <map_fragment>
        ${kind === 'mid' ? 'diffuseColor.a *= smoothstep(0.0,.18,vGrassUV.y);' : ''}
        diffuseColor.rgb *= vGrassColor;
        ${kind === 'mid' ? 'diffuseColor.rgb = mix(diffuseColor.rgb,uGroundTint,.60*smoothstep(9.0,25.0,vGrassDistance));' : ''}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        vec3 sight = normalize(vGrassWorld-cameraPosition);
        float backlight = pow(max(0.0,dot(sight,normalize(uSunDir))),3.0);
        backlight *= ${kind === 'near' ? '(1.0-smoothstep(5.0,14.0,vGrassDistance))' : '.6'};
        float edge = pow(abs(vGrassUV.x*2.0-1.0),3.0);
        totalEmissiveRadiance += min(vec3(.35),vec3(.50,.60,.16)*backlight*vGrassUV.y*vGrassUV.y*mix(.8,1.0,edge)*.39);`);
    lift(shader);
    if (kind === 'mid') {
      // Expand after patchLift, which also hooks map_fragment.
      shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>',
        THREE.ShaderChunk.map_fragment.replace('texture2D( map, vMapUv )', 'texture2D( map, vMapUv, 1.25*smoothstep(6.8,25.0,vGrassDistance) )'))
        // Both faces represent an upward-lit tuft, rather than a dark underside.
        .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
          #ifdef DOUBLE_SIDED
            normal *= faceDirection;
          #endif`);
    }
  };
  m.customProgramCacheKey = () => `grass-ribbon-v3-${kind}-lift3-.8`;
  return m;
}

function geometryFor(kind, capacity) {
  const g = new THREE.InstancedBufferGeometry(), pos = [], uv = [], idx = [];
  if (kind === 'near') {
    for (let i = 0; i < 4; i++) for (const side of [-.5, .5]) { pos.push(side, i / 3, 0); uv.push(side + .5, i / 3); }
    for (let i = 0; i < 3; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  } else {
    for (let k = 0; k < 3; k++) {
      const a = pos.length / 3;
      for (const [s, t] of [[-.5, 0], [.5, 0], [.5, 1], [-.5, 1]]) { pos.push(Math.cos(k * Math.PI / 3) * s, t, Math.sin(k * Math.PI / 3) * s); uv.push(s + .5, t); }
      idx.push(a, a + 1, a + 2, a, a + 2, a + 3);
    }
  }
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx); g.computeVertexNormals();
  const buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(capacity * STRIDE), STRIDE).setUsage(THREE.DynamicDrawUsage);
  for (const [name, size, offset] of [['iRoot', 4, 0], ['iShape', 4, 4], ['iColor', 3, 8], ['iTip', 4, 11]]) g.setAttribute(name, new THREE.InterleavedBufferAttribute(buffer, size, offset));
  g.instanceCount = 0;
  return { g, buffer };
}

// Pack each tile once. The entire chunk survives LOD boundary crossings without regeneration.
function packTile(d, kind) {
  const data = new Float32Array((d.count + (d.clumps?.count || 0) * 13) * STRIDE);
  let n = 0; const color = new THREE.Color();
  const add = (x, y, z, yaw, h, w, lean, species, hue, tip = 0, tipColor = null, base = null, seed = n, brightness = 1, tilt = 0, tiltYaw = 0) => {
    const p = colors[species]; color.copy(base || p[0]); if (!base) color.lerp(p[1], hue);
    if (kind === 'mid') {
      // Mean of the same near-leaf palette, with 30% dry gold individuals.
      color.copy(p[0]).lerp(p[1], .5);
      if (hue < .3) color.lerp(p[1], .65);
      color.multiplyScalar(brightness);
    }
    // Mid cards reuse the unused tip-color channels for tilt angle/direction; stride stays 15.
    const tc = tipColor || color, a = n++ * STRIDE;
    data.set([x, y, z, yaw, h, w, lean, Math.max(.0001, Math.min(.9999, hash(x, z, seed))), color.r, color.g, color.b, tip, kind === 'mid' ? tilt : tc.r, kind === 'mid' ? tiltYaw : tc.g, tc.b], a);
  };
  for (let i = 0; i < d.count; i++) {
    const mid = kind === 'mid', sp = d.species[i];
    add(d.x[i], d.y[i], d.z[i], d.yaw[i], mid ? d.s[i] * GRASS.card.size * d.sy[i] : d.h[i], mid ? d.s[i] * GRASS.card.size * d.sx[i] : d.w[i], mid ? d.flip[i] : d.lean[i], sp, d.hue[i],
      0, null, null, n, mid ? d.brightness[i] : 1, mid ? d.tilt[i] : 0, mid ? d.tiltYaw[i] : 0);
  }
  const c = d.clumps;
  if (c) for (let i = 0; i < c.count; i++) {
    const x = c.x[i], y = c.y[i], z = c.z[i], h = c.h[i], yaw = c.yaw[i];
    if (c.kind[i] === SUSUKI) {
      const leaves = 8 + Math.floor(hash(x, z, 9) * 3);
      for (let j = 0; j < leaves; j++) add(x, y, z, yaw + j * TAU / leaves, h * 1.8, .025, .65, SUSUKI, c.hue[i]);
      for (let j = 0; j < 3; j++) add(x, y + h * 1.25, z, yaw + j, h * .4, .045, .12, SUSUKI, c.hue[i], 1.6, plume, plume);
    } else if (c.kind[i] === FLOWER) {
      add(x, y, z, yaw, h, .012, 0, FLOWER, 0, 0, null, stem);
      for (let j = 0; j < 5; j++) add(x, y + h * .9, z, yaw + j * TAU / 5, h * .22, .07, 1.7, FLOWER, 0, 1.4, head, head);
    }
  }
  return data.subarray(0, n * STRIDE);
}

export function buildGrass({ field, wind, quality = 'standard', sunDir }) {
  const q = GRASS.quality[quality]; if (!q) throw new RangeError('grass quality');
  const group = new THREE.Group(); group.name = 'grass';
  const sun = { value: new THREE.Vector3().copy(sunDir).normalize() };
  const radii = { value: new THREE.Vector2(GRASS.nearRadius * q.distance, GRASS.midRadius * q.distance) };
  const map = cardTexture();
  const materials = { near: materialFor('near', wind, sun, radii, null, quality), mid: materialFor('mid', wind, sun, radii, map, quality) };
  const resident = { near: new Map(), mid: new Map() }, pools = { near: [], mid: [] };
  const all = new Set();
  let last = null, wanted = { near: [], mid: [] }, active = { near: new Set(), mid: new Set() }, dead = false;
  let builds = 0, queue = 0, lastBuildMs = 0, maxBuildMs = 0, overBudget = 0;
  const perCell = { near: Math.ceil(Math.round(GRASS.nearDensity * Math.ceil(GRASS.maxDensity * 255 / 2) * 2 / 255) * q.density) + 13,
    mid: Math.min(GRASS.midMaxCards, Math.ceil(GRASS.midCardRate * q.density * 1.8)) };
  function slot(kind) {
    if (pools[kind].length) return pools[kind].pop();
    const size = (kind === 'near' ? GRASS.nearSize : GRASS.midSize) * CHUNK_TILES[kind];
    const { g, buffer } = geometryFor(kind, size * size * perCell[kind]);
    const mesh = new THREE.Mesh(g, materials[kind]); mesh.name = `grass-${kind}`;
    mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.visible = false;
    group.add(mesh); const s = { mesh, buffer, tiles: [] }; all.add(s); return s;
  }
  function submit(c, kind) {
    let offset = 0;
    for (const t of c.tiles) if (active[kind].has(t.key)) { c.buffer.array.set(t.data, offset); offset += t.data.length; }
    c.mesh.geometry.instanceCount = offset / STRIDE; c.mesh.visible = offset > 0;
    c.buffer.clearUpdateRanges(); if (offset) c.buffer.addUpdateRange(0, offset); c.buffer.needsUpdate = true;
  }
  function build(c, kind) {
    const s = slot(kind), make = kind === 'near' ? nearTile : midTile;
    Object.assign(s, c); s.tiles = chunkTiles(kind, c.cx, c.cz).map(t => ({ key: `${kind}:${t.tx},${t.tz}`, data: packTile(make(field, t.tx, t.tz, { quality }), kind) }));
    // All roots and every possible displaced tip, including elevated flower/plume roots.
    const size = (kind === 'near' ? GRASS.nearSize : GRASS.midSize) * CHUNK_TILES[kind];
    let minY = Infinity, maxY = -Infinity;
    for (const t of s.tiles) for (let i = 0; i < t.data.length; i += STRIDE) { minY = Math.min(minY, t.data[i + 1]); maxY = Math.max(maxY, t.data[i + 1] + t.data[i + 4]); }
    if (!Number.isFinite(minY)) minY = maxY = 0;
    const margin = 2.5;
    s.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3((c.cx + .5) * size, (minY + maxY) / 2, (c.cz + .5) * size), Math.hypot(size / 2 + margin, size / 2 + margin, (maxY - minY) / 2 + margin));
    submit(s, kind); resident[kind].set(c.key, s); builds++;
  }
  function replan(camera) {
    const { x, z } = camera.position, tiles = tilesAround(field, x, z, { quality });
    wanted = wantedChunks(tiles);
    for (const kind of ['near', 'mid']) {
      active[kind] = new Set(tiles[kind].map(t => t.key));
      const size = (kind === 'near' ? GRASS.nearSize : GRASS.midSize) * CHUNK_TILES[kind], radius = kind === 'near' ? radii.value.x : radii.value.y;
      for (const c of resident[kind].values()) c.dist = Math.hypot(Math.max(c.cx * size - x, 0, x - (c.cx + 1) * size), Math.max(c.cz * size - z, 0, z - (c.cz + 1) * size)) - radius;
      const plan = planChunks({ wanted: wanted[kind], resident: resident[kind], maxBuild: 0 });
      for (const key of plan.evict) { const c = resident[kind].get(key); resident[kind].delete(key); c.mesh.visible = false; c.mesh.geometry.instanceCount = 0; c.tiles = []; pools[kind].push(c); }
      for (const c of resident[kind].values()) submit(c, kind);
    }
    last = { x, z };
  }
  function stream(camera, warm = false) {
    if (dead) return;
    const distance = last ? Math.hypot(camera.position.x - last.x, camera.position.z - last.z) : Infinity;
    const moved = distance >= .25;
    const before = [...wanted.near, ...wanted.mid];
    if (moved || warm) replan(camera);
    const next = new Set([...wanted.near, ...wanted.mid].map(c => c.key));
    const replaced = before.length > 0 && before.filter(c => !next.has(c.key)).length / before.length >= .7;
    const jump = distance >= 20 || replaced, budget = jump ? 8 : 2, start = performance.now();
    const pending = [];
    for (const kind of ['near', 'mid']) {
      const plan = planChunks({ wanted: wanted[kind], resident: resident[kind], maxBuild: warm || jump ? Infinity : kind === 'near' ? 2 : 1 });
      for (const key of plan.build) pending.push({ kind, c: wanted[kind].find(c => c.key === key) });
    }
    pending.sort((a, b) => a.c.dist - b.c.dist || a.c.key.localeCompare(b.c.key));
    let made = 0;
    for (const { kind, c } of pending) {
      if (!warm && made && performance.now() - start >= budget) break;
      build(c, kind); made++;
    }
    lastBuildMs = made ? performance.now() - start : 0;
    // Timings include synchronous warm; only streaming contributes to overBudget.
    maxBuildMs = Math.max(maxBuildMs, lastBuildMs);
    if (!warm && lastBuildMs > budget) overBudget++;
    queue = ['near', 'mid'].reduce((n, k) => n + wanted[k].filter(c => !resident[k].has(c.key)).length, 0);
  }
  return { group, update: camera => stream(camera), warm: camera => stream(camera, true),
    setSun(dir) { sun.value.copy(dir).normalize(); },
    stats() {
      const count = kind => [...resident[kind].values()].reduce((n, c) => n + c.mesh.geometry.instanceCount, 0);
      const chunks = kind => [...resident[kind].values()].filter(c => c.mesh.visible).length;
      const nearBlades = count('near'), midCards = count('mid'), nearChunks = chunks('near'), midChunks = chunks('mid');
      return { nearChunks, midChunks, nearBlades, midCards, triangles: nearBlades * 6 + midCards * 6, drawCalls: nearChunks + midChunks, builds, queue, lastBuildMs, maxBuildMs, overBudget };
    },
    dispose() {
      if (dead) return; dead = true;
      for (const s of all) s.mesh.geometry.dispose();
      for (const m of Object.values(materials)) m.dispose(); map.dispose();
      all.clear(); resident.near.clear(); resident.mid.clear(); pools.near.length = pools.mid.length = 0;
      wanted = { near: [], mid: [] }; active = { near: new Set(), mid: new Set() }; queue = 0; group.clear();
    } };
}
