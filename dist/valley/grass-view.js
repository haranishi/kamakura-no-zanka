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

function materialFor(kind, wind, sun, radii, map, quality, groundTint, look) {
  const m = new THREE.MeshLambertMaterial({ side: THREE.DoubleSide, map,
    alphaTest: kind === 'mid' ? .3 : 0, alphaToCoverage: kind === 'mid' && quality === 'standard', emissive: 0x182212 });
  patchLift(m, .8);
  const lift = m.onBeforeCompile;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, wind, { uSunDir: sun, uGrassRadii: radii, uGroundTint: groundTint });
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
    look?.patch(shader, kind);
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
  m.customProgramCacheKey = () => `grass-ribbon-v3-${kind}-lift3-.8${look ? "-kamakura-9c" : ""}`;
  return m;
}

function geometryFor(kind, capacity, look, streaming) {
  const g = new THREE.InstancedBufferGeometry(), pos = [], uv = [], idx = [];
  if (kind === 'near') {
    // W2c-9c: valley's three sections -> optional six, with a coarse index range.
    const segments = look?.segments ?? 3;
    for (let i = 0; i <= segments; i++) for (const side of [-.5, .5]) { pos.push(side, i / segments, 0); uv.push(side + .5, i / segments); }
    if (streaming) idx.push(0,1,7,0,7,6,6,7,13,6,13,12);
    if (look) for (let i = 0; i < segments; i += 2) { const a=i*2; idx.push(a,a+1,a+5,a,a+5,a+4); }
    for (let i = 0; i < segments; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
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
  if (look && kind === 'near') g.setDrawRange(look.uniforms.uGrassLookStep.value >= 2 ? 0 : 18, look.uniforms.uGrassLookStep.value >= 2 ? 18 : 36);
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

export function buildGrass({ field, wind, quality = 'standard', sunDir, reach, look, streaming }) {
  const chunkSizes = streaming?.chunkSizes ?? CHUNK_TILES;
  const q = GRASS.quality[quality]; if (!q) throw new RangeError('grass quality');
  const group = new THREE.Group(); group.name = 'grass';
  const sun = { value: new THREE.Vector3().copy(sunDir).normalize() };
  // W2c-9b: optional Kamakura reach; valley keeps its original radii.
  const groundTint = { value: new THREE.Color('#6b6a35') };
  const radii = { value: new THREE.Vector2((reach?.near ?? GRASS.nearRadius) * q.distance, (reach?.mid ?? GRASS.midRadius) * q.distance) };
  const map = cardTexture();
  const materials = { near: materialFor('near', wind, sun, radii, null, quality, groundTint, look), mid: materialFor('mid', wind, sun, radii, map, quality, groundTint, look) };
  const resident = { near: new Map(), mid: new Map() }, pools = { near: [], mid: [] };
  const all = new Set();
  let last = null, wanted = { near: [], mid: [] }, active = { near: new Set(), mid: new Set() }, dead = false;
  let densityScale = 1;
  let builds = 0, queue = 0, lastBuildMs = 0, maxBuildMs = 0, overBudget = 0;
  let replans = 0, replanMs = 0, replanMaxMs = 0, submitSkipped = 0;
  const ALL_ACTIVE = { has: () => true };
  const perCell = { near: Math.ceil(Math.round(GRASS.nearDensity * Math.ceil(GRASS.maxDensity * 255 / 2) * 2 / 255) * q.density) + 13,
    mid: Math.min(GRASS.midMaxCards, Math.ceil(GRASS.midCardRate * q.density * 1.8)) };
  function slot(kind, required = 0) {
    if (!streaming && pools[kind].length) return pools[kind].pop();
    if (streaming) {
      const index=pools[kind].findIndex(s=>s.buffer.array.length>=required*STRIDE);
      if(index>=0)return pools[kind].splice(index,1)[0];
    }
    const size = (kind === 'near' ? GRASS.nearSize : GRASS.midSize) * chunkSizes[kind];
    const capacity=streaming?2**Math.ceil(Math.log2(Math.max(1,required))):size*size*perCell[kind]*(look?.capacityFactor??1);
    const { g, buffer } = geometryFor(kind, capacity, look, streaming);
    const mesh = new THREE.Mesh(g, materials[kind]); mesh.name = `grass-${kind}`;
    mesh.receiveShadow = true; mesh.frustumCulled = true; mesh.visible = false;
    group.add(mesh); const s = { mesh, buffer, tiles: [] };
    if(streaming && kind==='near'){
      const detail=geometryFor(kind,capacity,look,streaming);
      detail.mesh=new THREE.Mesh(detail.g,materials.near);detail.mesh.name='grass-near';
      detail.mesh.receiveShadow=true;detail.mesh.frustumCulled=true;detail.mesh.visible=false;
      detail.g.setDrawRange(30,36);g.setDrawRange(0,12);s.detail=detail;group.add(detail.mesh);
    }
    all.add(s); return s;
  }
  function submit(c, kind) {
    let offset = 0, detailOffset=0;
    const out = c.buffer.array, dout = c.detail?.buffer.array, activeSet = active[kind];
    const lowStep = Boolean(c.detail) && look.uniforms.uGrassLookStep.value < 2;
    const sx = streaming ? streaming.position.x : 0, sz = streaming ? streaming.position.z : 0;
    for (const t of c.tiles) if (activeSet.has(t.key)) {
      const data = t.data;
      if (densityScale === 1 && (!look || (kind === 'mid' && look.bulkMid))) { out.set(data, offset); offset += data.length; }
      // Thin by a hash of the root position, not by iShape.w: the shader also uses w for the distance fade and the
      // card pattern, so thinning on w would drop the far blades first and wipe out the last card pattern.
      else for (let i = 0; i < data.length; i += STRIDE) if ((!look || look.accept(data,i,kind)) && (densityScale === 1 || hash(data[i], data[i + 2], 61) < densityScale)) {
        if (lowStep) {
          // Blades within 12 m take the full-detail mesh (squared distance: this loop runs for every resident blade).
          const dx = data[i] - sx, dz = data[i + 2] - sz;
          if (dx * dx + dz * dz < 144) { for (let j = 0; j < STRIDE; j++) dout[detailOffset++] = data[i + j]; continue; }
        }
        if (look) { for (let j = 0; j < STRIDE; j++) out[offset++] = data[i + j]; }
        else { out.set(data.subarray(i, i + STRIDE), offset); offset += STRIDE; }
      }
    }
    if(c.detail){
      c.detail.g.instanceCount=detailOffset/STRIDE;c.detail.mesh.visible=detailOffset>0;
      c.detail.buffer.clearUpdateRanges();if(detailOffset)c.detail.buffer.addUpdateRange(0,detailOffset);c.detail.buffer.needsUpdate=true;
    }
    c.mesh.geometry.instanceCount = offset / STRIDE; c.mesh.visible = offset > 0;
    c.buffer.clearUpdateRanges(); if (offset) c.buffer.addUpdateRange(0, offset); c.buffer.needsUpdate = true;
    if (streaming && kind === 'near') c.subClass = nearClass(c);
  }
  // Streaming only. What look.accept and the 12 m detail disc decide for a chunk cannot change while it stays wholly inside
  // the always-accepted zone (past the disc) or wholly beyond the rejected zone, so such chunks are not copied again.
  // 0: accepted and past the disc; 1: rejected; 2: depends on the player's position.
  function nearClass(c) {
    const r = streaming.radius(), p = streaming.position, size = GRASS.nearSize * chunkSizes.near, x0 = c.cx * size, z0 = c.cz * size;
    const nearest = streaming.distance(c);
    const farthest = Math.hypot(Math.max(Math.abs(x0 - p.x), Math.abs(x0 + size - p.x)), Math.max(Math.abs(z0 - p.z), Math.abs(z0 + size - p.z)));
    if (nearest >= 12.5 && farthest < r + 12.5) return 0;
    if (nearest >= r + 16.5) return 1;
    return 2;
  }
  // Mid chunks always show all their tiles, so once submitted they only change through setDensityScale / setLookQuality.
  const needsSubmit = (c, kind) => kind === 'near' && (c.subClass === 2 || c.subClass !== nearClass(c));
  // W2c-9c: optional look only; omitted packs exactly the valley bytes.
  function packed(data, kind) {
    // Optional look owns its flowers/seed heads; legacy elevated clumps would float above shorter leaves.
    const raw = packTile(look && kind === 'near' ? { ...data, clumps: null } : data,kind);
    return look ? look.pack(raw,kind) : raw;
  }
  function build(c, kind) {
    const make = kind === 'near' ? nearTile : midTile;
    const prepare=()=>chunkTiles(kind,c.cx,c.cz,chunkSizes).map(t=>({key:`${kind}:${t.tx},${t.tz}`,data:packed(make(field,t.tx,t.tz,{quality,...(kind==='mid'?look?.midPlacement:{})}),kind)}));
    const prepared=streaming?prepare():null;
    const s=slot(kind,prepared?prepared.reduce((n,t)=>n+t.data.length/STRIDE,0):0);
    Object.assign(s,c);s.tiles=prepared??prepare();
    // All roots and every possible displaced tip, including elevated flower/plume roots.
    const size = (kind === 'near' ? GRASS.nearSize : GRASS.midSize) * chunkSizes[kind];
    let minY = Infinity, maxY = -Infinity;
    for (const t of s.tiles) for (let i = 0; i < t.data.length; i += STRIDE) { minY = Math.min(minY, t.data[i + 1]); maxY = Math.max(maxY, t.data[i + 1] + t.data[i + 4]); }
    if (!Number.isFinite(minY)) minY = maxY = 0;
    const margin = 2.5;
    s.mesh.geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3((c.cx + .5) * size, (minY + maxY) / 2, (c.cz + .5) * size), Math.hypot(size / 2 + margin, size / 2 + margin, (maxY - minY) / 2 + margin));
    if(s.detail)s.detail.g.boundingSphere=s.mesh.geometry.boundingSphere;
    submit(s, kind); resident[kind].set(c.key, s); builds++;
  }
  function replan(camera) {
    look?.prepare(camera);
    const { x, z } = streaming ? streaming.position : camera.position;
    let tiles = null;
    if (streaming) {
      // Both kinds are planned per chunk and every tile of a resident chunk is shown: look.accept rejects near blades
      // beyond the fade and the mid shader zeroes cards outside its ring.
      wanted = streaming.plan(field);
      active.near = active.mid = ALL_ACTIVE;
    } else {
      tiles = tilesAround(field, x, z, { quality, reach });
      wanted = wantedChunks(tiles, chunkSizes);
    }
    for (const kind of ['near', 'mid']) {
      if (!streaming) active[kind] = new Set(tiles[kind].map(t => t.key));
      const size = (kind === 'near' ? GRASS.nearSize : GRASS.midSize) * chunkSizes[kind], radius = kind === 'near' ? radii.value.x : radii.value.y;
      for (const c of resident[kind].values()) c.dist = Math.hypot(Math.max(c.cx * size - x, 0, x - (c.cx + 1) * size), Math.max(c.cz * size - z, 0, z - (c.cz + 1) * size)) - radius;
      const plan = planChunks({ wanted: wanted[kind], resident: resident[kind], maxBuild: 0 });
      for (const key of plan.evict) { const c = resident[kind].get(key); resident[kind].delete(key); c.mesh.visible = false; c.mesh.geometry.instanceCount = 0; if(c.detail){c.detail.mesh.visible=false;c.detail.g.instanceCount=0;} c.tiles = []; pools[kind].push(c); }
      for (const c of resident[kind].values()) {
        if (streaming && kind === 'near') c.dist = streaming.distance(c);
        if (streaming && !needsSubmit(c, kind)) { submitSkipped++; continue; }
        submit(c, kind);
      }
    }
    last = { x, z };
  }
  // Optional policy is used only by Kamakura R9. Omitted preserves valley/R8.
  let streamReady = false, appeared30 = 0, holes30 = 0, drawnX=0, drawnZ=0, drawnRadius=0;
  function forward(camera, warm) {
    const p=streaming.position;
    const distance=last?Math.hypot(p.x-last.x,p.z-last.z):Infinity;
    const jump=streamReady&&Math.hypot(p.x-drawnX,p.z-drawnZ)>=20, radius=streaming.radius();
    const expandedRadius=radius>drawnRadius;
    if(!warm && distance<1 && !queue && !streaming.changed)return;
    if(warm || distance>=1 || streaming.changed) { const r0=streaming.now(); replan(camera); streaming.changed=false; const dt=streaming.now()-r0; replans++; replanMs+=dt; replanMaxMs=Math.max(replanMaxMs,dt); }
    const start=streaming.now(), full=warm||jump||!streamReady||expandedRadius;
    let made=0;
    const pending=streaming.queue(wanted,resident.near);
    for(const c of pending){
      const budget=streaming.budget(c.dist,radius);
      if(!full && made && streaming.now()-start>=budget)break;
      build(c,'near');made++;
      if(streamReady&&!jump&&c.dist<=radius){
        const slot=resident.near.get(c.key);
        const tally=(a,n)=>{for(let i=0;i<n*STRIDE;i+=STRIDE)if(Math.hypot(a[i]-p.x,a[i+2]-p.z)<=radius)appeared30++;};
        tally(slot.buffer.array,slot.mesh.geometry.instanceCount);if(slot.detail)tally(slot.detail.buffer.array,slot.detail.g.instanceCount);
      }
    }
    // Mid cards are optional work; urgent blades always take precedence.
    for(const c of wanted.mid)if(!resident.mid.has(c.key)){
      if(!full && made && streaming.now()-start>=2)break;
      build(c,'mid');made++;
    }
    holes30=0;
    for(const c of wanted.near)if(streaming.distance(c)<=radius&&!resident.near.has(c.key))holes30++;
    queue=wanted.near.filter(c=>!resident.near.has(c.key)).length+wanted.mid.filter(c=>!resident.mid.has(c.key)).length;
    lastBuildMs=made?streaming.now()-start:0;maxBuildMs=Math.max(maxBuildMs,lastBuildMs);
    if(!full&&lastBuildMs>6)overBudget++;
    streamReady=true;drawnX=p.x;drawnZ=p.z;drawnRadius=radius;
  }
  function stream(camera, warm = false) {
    if (dead) return;
    if (streaming) return forward(camera,warm);
    const distance = last ? Math.hypot(camera.position.x - last.x, camera.position.z - last.z) : Infinity;
    const moved = distance >= (look?.replanDistance ?? .25);
    if (look && !warm && !moved && queue === 0) return;
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
    // Keep fully interior chunks: their world-cell values are unchanged. Only
    // chunks touching either field's feathered edge need replacement, using pools.
    setField(next) {
      if (dead || next === field) return;
      const interior = (f, c, kind) => {
        const size = (kind === 'near' ? GRASS.nearSize : GRASS.midSize) * chunkSizes[kind];
        const edge = f.edge ?? 0;
        return c.cx * size >= f.x0 + edge && c.cz * size >= f.z0 + edge &&
          (c.cx + 1) * size <= f.x0 + f.nx - edge && (c.cz + 1) * size <= f.z0 + f.nz - edge;
      };
      for (const kind of ['near', 'mid']) for (const [key, c] of resident[kind]) {
        if (interior(field, c, kind) && interior(next, c, kind)) continue;
        resident[kind].delete(key); c.mesh.visible = false; c.mesh.geometry.instanceCount = 0; if(c.detail){c.detail.mesh.visible=false;c.detail.g.instanceCount=0;} c.tiles = []; pools[kind].push(c);
      }
      field = next; last = null;
    },
    setDensityScale(value) {
      if (dead) return;
      const next = Math.max(0, Math.min(1, value)); if (next === densityScale) return;
      densityScale = next;
      for (const kind of ['near', 'mid']) for (const c of resident[kind].values()) { if(streaming && kind==='near')c.dist=streaming.distance(c); submit(c, kind); }
    },
    setLookQuality(step) {
      if (!look || dead) return;
      look.setAdapt(step);
      for (const kind of ['near', 'mid']) for (const c of resident[kind].values()) submit(c,kind);
      for (const c of all) if (!streaming && c.mesh.name === 'grass-near') c.mesh.geometry.setDrawRange(step >= 2 ? 0 : 18, step >= 2 ? 18 : 36);
    },
    setGroundTint(color) { groundTint.value.copy(color); },
    setSun(dir) { sun.value.copy(dir).normalize(); },
    stats() {
      const count = kind => [...resident[kind].values()].reduce((n, c) => n + c.mesh.geometry.instanceCount+(c.detail?.g.instanceCount??0), 0);
      const chunks = kind => [...resident[kind].values()].reduce((n,c)=>n+Number(c.mesh.visible)+Number(c.detail?.mesh.visible??false),0);
      const nearBlades = count('near'), midCards = count('mid'), nearChunks = chunks('near'), midChunks = chunks('mid');
      let lawn=0, flowers=0;
      if (look) for (const c of resident.near.values()) {
        const tally=(a,count)=>{for(let i=0;i<count;i++){const marker=a[i*STRIDE+11];if(marker===-1)lawn++;if(marker===-2)flowers++;}};
        tally(c.buffer.array,c.mesh.geometry.instanceCount);if(c.detail)tally(c.detail.buffer.array,c.detail.g.instanceCount);
      }
      const nearTriangles=streaming?[...resident.near.values()].reduce((n,c)=>n+c.mesh.geometry.instanceCount*4+(c.detail?.g.instanceCount??0)*12,0):nearBlades*(look&&look.uniforms.uGrassLookStep.value<2?12:6);
      return { ...(streaming?{holes30,appeared30,radius30:streaming.radius()}:{}), ...(look ? { lawn, flowers, tallBlades: nearBlades-lawn-flowers, nearTriangles } : {}), nearChunks, midChunks, nearBlades, midCards, triangles: nearTriangles + midCards * 6, drawCalls: nearChunks + midChunks, builds, queue, lastBuildMs, maxBuildMs, overBudget, replans, replanMs, replanMaxMs, submitSkipped };
    },
    dispose() {
      if (dead) return; dead = true;
      for (const s of all) {s.mesh.geometry.dispose();s.detail?.g.dispose();}
      for (const m of Object.values(materials)) m.dispose(); map.dispose();
      all.clear(); resident.near.clear(); resident.mid.clear(); pools.near.length = pools.mid.length = 0;
      wanted = { near: [], mid: [] }; active = { near: new Set(), mid: new Set() }; queue = 0; group.clear();
    } };
}
