import { isEveningLike } from './kamakura-atmosphere.js';
// W2c-16f: three one-pass instanced meshes, no textures or external assets.
import * as THREE from '../vendor/three.module.min.js';
import { atmosphereOptions } from './kamakura-atmosphere.js';
import { FAUNA, FAUNA_GLSL, faunaAmounts, kiteCell, kitePosition, crowWindow, crowCrossing, crowSpan, crowPosition, flockCell, flockAllowed,
  createFlockState, resetFlock, updateFlock, flockBirdPosition, insectSeed, insectPosition } from './kamakura-fauna.js';

const vertexPars = `
attribute vec4 aFaunaCenter, aFaunaPose, aFaunaMeta;
attribute float aFaunaWing, aFaunaPillar;
uniform float uFaunaTime, uFaunaHeight;
uniform vec3 uFaunaSun;
varying vec3 vFaunaColor;
varying float vFaunaAlpha;
uniform float uFaunaDebug, uFaunaEvening;
${FAUNA_GLSL}
vec3 kzFaunaTurn(vec3 p) {
  bool small = aFaunaMeta.x > 0.5 && aFaunaMeta.x < 1.5;
  // A small bird on the ground keeps its wings folded against the body; they open as it takes off.
  float spread = small ? smoothstep(0.0, 0.2, aFaunaPose.z) : 1.0;
  p.x = mix(sign(p.x) * 0.05, p.x, mix(1.0, spread, abs(aFaunaWing)));
  float wing = kzFaunaWingAngle(aFaunaMeta.x, aFaunaPose.w, aFaunaMeta.y, aFaunaPose.z, uFaunaTime);
  float bend = wing * aFaunaWing;
  p.xy = mat2(cos(bend), sin(bend), -sin(bend), cos(bend)) * p.xy;
  float pitch = small ? (aFaunaPose.z > 0.5 ? -${FAUNA.flightAngle.toFixed(6)} : aFaunaPose.y) : 0.0;
  p.yz = mat2(cos(pitch), -sin(pitch), sin(pitch), cos(pitch)) * p.yz;
  float bank = small ? 0.0 : aFaunaPose.y;
  p.xy = mat2(cos(bank), sin(bank), -sin(bank), cos(bank)) * p.xy;
  float heading = aFaunaPose.x;
  p.xz = mat2(cos(heading), -sin(heading), sin(heading), cos(heading)) * p.xz;
  return p;
}
`;
const vertexMotion = `
vec3 faunaCenter = aFaunaCenter.xyz;
vec3 faunaView = (viewMatrix * vec4(faunaCenter, 1.0)).xyz;
float faunaKind = aFaunaMeta.x;
float faunaPixels = aFaunaCenter.w * uFaunaHeight * 0.5 * projectionMatrix[1][1] / max(0.1, -faunaView.z);
// A far kite keeps a readable wingspan (a share of the frame height) instead of thinning into a two-pixel speck.
float faunaGrow = faunaKind < 0.5 ? max(1.0, uFaunaHeight * ${FAUNA.kitePixels.toFixed(6)} / max(faunaPixels, 0.001)) : 1.0;
float faunaFade = smoothstep(${FAUNA.minPixels.toFixed(6)}, ${FAUNA.fullPixels.toFixed(6)}, faunaPixels * faunaGrow)
  * smoothstep(${FAUNA.cameraNear.toFixed(6)}, ${FAUNA.cameraFull.toFixed(6)}, distance(faunaCenter, cameraPosition)) * aFaunaMeta.z;
float faunaPart = mix(1.0 - aFaunaMeta.w, aFaunaMeta.w, aFaunaPillar);
vec3 transformed = faunaCenter + kzFaunaTurn(position) * aFaunaCenter.w * faunaGrow * faunaFade * faunaPart;
vFaunaAlpha = faunaFade * faunaPart;
if (faunaKind < 0.5) vFaunaColor = vec3(0.055, 0.042, 0.03);
else if (faunaKind < 1.5) vFaunaColor = mix(vec3(0.25, 0.23, 0.21), vec3(0.40, 0.38, 0.37), aFaunaMeta.y) * (position.y < -0.01 ? 1.5 : abs(aFaunaWing) > 0.5 ? 0.8 : 1.0);
else if (faunaKind < 2.5) {
  vFaunaColor = aFaunaMeta.y < 0.5 ? vec3(0.86, 0.84, 0.72) : aFaunaMeta.y < 0.82 ? vec3(0.88, 0.70, 0.16) : vec3(0.80, 0.36, 0.10);
  if (abs(aFaunaWing) < 0.5) vFaunaColor = vec3(0.07, 0.06, 0.05);
} else if (faunaKind < 3.5) {
  float faunaRed = step(mix(0.55, 0.2, uFaunaEvening), aFaunaMeta.y);
  vFaunaColor = mix(aFaunaMeta.y < 0.25 ? vec3(0.34, 0.52, 0.62) : vec3(0.10, 0.16, 0.09), vec3(0.72, 0.13, 0.05), faunaRed);
  if (abs(aFaunaWing) > 0.5) {
    vec3 faunaNormal = normalize(kzFaunaTurn(vec3(0.0, 1.0, 0.0)));
    vec3 faunaRay = normalize(cameraPosition - faunaCenter + vec3(0.0, 0.00001, 0.0));
    float faunaGlint = pow(abs(dot(faunaNormal, normalize(faunaRay + uFaunaSun))), 12.0);
    vFaunaColor = vec3(0.62 + faunaGlint * 0.38);
    vFaunaAlpha *= 0.42 + 0.45 * faunaGlint;
  }
} else vFaunaColor = vec3(0.016, 0.016, 0.02);
if (uFaunaDebug > 0.5) {
  if (faunaKind < 0.5) vFaunaColor = vec3(0.2, 0.55, 0.95);
  else if (faunaKind < 1.5) vFaunaColor = vec3(0.95, 0.18, 0.12);
  else if (faunaKind < 2.5) vFaunaColor = vec3(0.95, 0.8, 0.1);
  else if (faunaKind < 3.5) vFaunaColor = vec3(0.1, 0.8, 0.6);
  else vFaunaColor = vec3(0.85, 0.2, 0.9);
}
`;

// Unit span 1 (wing tip to wing tip), nose toward -z. Wing vertices carry -1/+1 and beat about the body axis.
function makeGeometry(capacity, kind) {
  const positions = [], wings = [], pillars = [];
  const tri = (a, b, c, wing = 0, pillar = 0) => { positions.push(...a, ...b, ...c); wings.push(wing, wing, wing); pillars.push(pillar, pillar, pillar); };
  if (kind === 0) {
    // A bird with a body that has depth (a flat sliver vanished when seen level), a fanned tail and wings bent at the wrist:
    // the wrists are raised and pushed forward, which gives the shallow M of a soaring kite from any side.
    const nose = [0, 0, -.17], tail = [0, 0, .12], left = [-.07, 0, -.03], right = [.07, 0, -.03], top = [0, .07, -.03], belly = [0, -.06, -.03];
    tri(nose, left, top); tri(nose, top, right); tri(nose, right, belly); tri(nose, belly, left);
    tri(tail, top, left); tri(tail, right, top); tri(tail, belly, right); tri(tail, left, belly);
    tri([0, 0, .07], [-.07, 0, .27], [.07, 0, .27]);
    // Long narrow wings (about seven times as long as wide), the wrists raised and pushed forward.
    for (const s of [-1, 1]) {
      const a = [s * .04, .01, -.1], b = [s * .04, .01, .06], c = [s * .27, .045, -.14], d = [s * .27, .035, .02], e = [s * .5, 0, -.05], f = [s * .47, 0, .05];
      tri(a, c, b, s); tri(b, c, d, s); tri(c, e, d, s); tri(d, e, f, s);
    }
    tri([-.06, 0, 0], [.06, 0, 0], [.06, 3, 0], 0, 1);
    tri([-.06, 0, 0], [.06, 3, 0], [-.06, 3, 0], 0, 1);
  } else if (kind === 2) {
    tri([0, 0, -.16], [-.022, 0, 0], [0, 0, .2]); tri([0, 0, -.16], [0, 0, .2], [.022, 0, 0]);
    for (const s of [-1, 1]) {
      tri([s * .02, 0, -.1], [s * .5, 0, -.3], [s * .44, 0, .03], s); tri([s * .02, 0, -.1], [s * .44, 0, .03], [s * .02, 0, .05], s);
      tri([s * .02, 0, .02], [s * .38, 0, .08], [s * .24, 0, .36], s); tri([s * .02, 0, .02], [s * .24, 0, .36], [s * .02, 0, .16], s);
    }
  } else {
    // Head and thorax as a small wedge, then a long abdomen with some depth so that it does not vanish seen level.
    tri([0, 0, -.2], [-.055, 0, -.09], [0, .04, -.03]); tri([0, 0, -.2], [0, .04, -.03], [.055, 0, -.09]);
    tri([-.03, 0, -.06], [.03, 0, -.06], [0, 0, .5]); tri([0, .035, -.06], [0, -.02, -.06], [0, 0, .5]);
    for (const z of [-.15, -.01]) for (const s of [-1, 1]) tri([s * .03, 0, z], [s * .5, 0, z + .05], [s * .42, 0, z - .08], s);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute('aFaunaWing', new THREE.Float32BufferAttribute(wings, 1));
  g.setAttribute('aFaunaPillar', new THREE.Float32BufferAttribute(pillars, 1));
  for (const name of ['aFaunaCenter', 'aFaunaPose', 'aFaunaMeta']) g.setAttribute(name,
    new THREE.InstancedBufferAttribute(new Float32Array(capacity * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0; return g;
}
function makeMesh(capacity, kind, uniforms) {
  // Basic retains the global fog/tonemap path, with deliberate dark silhouettes and capped wing glints.
  const m = new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: true });
  m.forceSinglePass = true;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + vertexPars)
      .replace('#include <begin_vertex>', vertexMotion);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFaunaColor; varying float vFaunaAlpha;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vFaunaColor; diffuseColor.a *= vFaunaAlpha; if (diffuseColor.a < 0.003) discard;');
  };
  m.customProgramCacheKey = () => 'kz-fauna-v2';
  const mesh = new THREE.Mesh(makeGeometry(capacity, kind), m);
  mesh.name = kind === 0 ? 'kamakura-fauna-birds' : kind === 2 ? 'kamakura-fauna-butterflies' : 'kamakura-fauna-dragonflies';
  mesh.frustumCulled = false; mesh.castShadow = mesh.receiveShadow = false; mesh.renderOrder = 7; return mesh;
}
function write(mesh, i, p, size, kind, roll, phase, flap, pillar = 0) {
  const a = mesh.geometry.attributes;
  a.aFaunaCenter.setXYZW(i, p.x, p.y, p.z, size);
  a.aFaunaPose.setXYZW(i, p.yaw, p.bank, flap, phase);
  a.aFaunaMeta.setXYZW(i, kind, roll, p.fade, pillar);
}
function upload(mesh, count) {
  mesh.geometry.instanceCount = count;
  const a = mesh.geometry.attributes;
  a.aFaunaCenter.needsUpdate = a.aFaunaPose.needsUpdate = a.aFaunaMeta.needsUpdate = true;
}

export function createKamakuraFauna(context, options = {}) {
  const q = new URLSearchParams(context.search), requested = q.get('fauna'), parsed = Number(requested);
  if (requested !== null && requested.trim() !== '' && parsed === 0) return null;
  const multiplier = requested === null || requested.trim() === '' || !Number.isFinite(parsed) ? 1 : Math.max(.25, Math.min(4, parsed));
  const reduced = options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const debug = q.get('faunadebug') === '1', day = atmosphereOptions(context.search).time;
  const light = context.quality === 'light' ? .6 : 1;
  if (!context.lifeEvents) context.lifeEvents = [];
  const events = context.lifeEvents, terrain = context.terrain;
  const uniforms = { uFaunaTime: { value: 0 }, uFaunaHeight: { value: 720 }, uFaunaDebug: { value: debug ? 1 : 0 }, uFaunaEvening: { value: isEveningLike(day) ? 1 : 0 }, uFaunaSun: { value: new THREE.Vector3(0, 1, 0) } };
  const birdCapacity = FAUNA.kiteSlots + FAUNA.flockSlots * (FAUNA.flockBirds + 1) + FAUNA.crowCapacity;
  const birds = makeMesh(birdCapacity, 0, uniforms);
  const butterflies = makeMesh(FAUNA.butterflySlots, 2, uniforms), dragonflies = makeMesh(FAUNA.dragonflySlots, 3, uniforms);
  const meshes = [birds, butterflies, dragonflies]; context.scene.add(...meshes);
  const kites = Array.from({ length: FAUNA.kiteSlots }, () => ({ ...kiteCell(0, 0), probability: 0, ground: 0 }));
  const crows = Array.from({ length: FAUNA.crowSlots }, () => ({ ...crowCrossing(0, 0, 0), probability: 0, profile: new Float32Array(9), used: false }));
  const flocks = Array.from({ length: FAUNA.flockSlots }, createFlockState);
  const butterflySeeds = Array.from({ length: FAUNA.butterflySlots }, (_, i) => insectSeed(i, 0));
  const dragonflySeeds = Array.from({ length: FAUNA.dragonflySlots }, (_, i) => insectSeed(i, 1));
  const h = {}, target = {}, amounts = { butterflies: 0, dragonflies: 0 }, cell = {}, point = {}, viewport = new THREE.Vector2();
  const counts = { kites: 0, crows: 0, near: 0, flying: 0, butterflies: 0, dragonflies: 0 };
  let disposed = false, paused = false, step = 0, sinceSample = 1, kiteX = Infinity, kiteZ = Infinity;
  const seen = { x: 0, z: 0, time: 0, factor: 1 };
  // Debug only (never on the frame path): where to look for the nearest of each, as a compass bearing and an angle above the horizon.
  const where = (best, x, y, z) => {
    const dx = x - seen.x, dz = z - seen.z, flat = Math.hypot(dx, dz);
    if (best && best.distance <= flat) return best;
    const ndc = context.camera ? new THREE.Vector3(x, y, z).project(context.camera) : null;
    return { distance: Math.round(flat), bearing: Math.round((Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360), up: Math.round(Math.atan2(y - terrain.heightAt(seen.x, seen.z) - 1.6, flat) * 180 / Math.PI),
      screen: ndc && ndc.z < 1 ? [+(ndc.x * .5 + .5).toFixed(3), +(.5 - ndc.y * .5).toFixed(3)] : null, y: Math.round(y) };
  };
  const inspect = () => {
    let kite = null, crow = null, flock = null; const at = {};
    for (const s of kites) if (s.roll < s.probability * seen.factor) { kitePosition(s, seen.time, [1, 0], at); kite = where(kite, at.x, at.y + s.ground, at.z); }
    for (const s of crows) if (s.used && s.roll < s.probability * seen.factor && s.window === crowWindow(s.ix, s.iz, seen.time)) {
      crowPosition(s, 0, seen.time, at); if (at.fade > .5) crow = where(crow, at.x, at.y + s.profile[4], at.z); }
    for (const s of flocks) if (s.used && s.mode === 0 && s.roll < s.probability * seen.factor) flock = where(flock, s.x, s.y, s.z);
    return { kites: counts.kites, crows: counts.crows, flocks: { near: counts.near, flying: counts.flying }, butterflies: counts.butterflies, dragonflies: counts.dragonflies, nearest: { kite, crow, flock } };
  };
  if (q.get('debug') === '1') globalThis.__kzFauna = inspect;
  // Birds keep a level course above the highest ground on their way: following the ground under each bird made them
  // jump over every ridge and roof-high bank.
  const groundAlong = (x, z, dx, dz, reach, steps) => {
    let ground = 0;
    for (let i = 0; i <= steps; i++) { const a = (i / steps * 2 - 1) * reach; ground = Math.max(ground, terrain.heightAt(x + dx * a, z + dz * a)); }
    return ground;
  };
  function sample(pos, time) {
    context.habitat.at(pos.x, pos.z, h); faunaAmounts(h, day, target);
    const cx = Math.floor(pos.x / FAUNA.kiteCell), cz = Math.floor(pos.z / FAUNA.kiteCell);
    if (cx !== kiteX || cz !== kiteZ) {
      kiteX = cx; kiteZ = cz;
      let i = 0;
      for (let z = cz - 3; z <= cz + 3; z++) for (let x = cx - 3; x <= cx + 3; x++) {
        const s = kiteCell(x, z, kites[i++]);
        context.habitat.at(s.x, s.z, h); faunaAmounts(h, day, cell); s.probability = cell.kites;
        s.ground = Math.max(groundAlong(s.x, s.z, 1, 0, s.radius + 12, 4), groundAlong(s.x, s.z, 0, 1, s.radius + 12, 4));
      }
    }
    const kx = Math.floor(pos.x / FAUNA.crowCell), kz = Math.floor(pos.z / FAUNA.crowCell);
    let n = 0;
    for (let z = kz - 3; z <= kz + 3; z++) for (let x = kx - 3; x <= kx + 3; x++) {
      const s = crows[n++], window = crowWindow(x, z, time);
      if (s.used && s.ix === x && s.iz === z && s.window === window) continue;
      crowCrossing(x, z, window, s); s.used = true;
      context.habitat.at(s.x, s.z, h); faunaAmounts(h, day, cell);
      // No crossings that begin far out over the sea.
      s.probability = terrain.heightAt(s.x, s.z) <= 0 ? 0 : cell.crows;
      if (s.roll >= s.probability * 4) continue;
      // The group follows the lie of the land at a coarse scale (nine samples along its course, each taking the higher of its
      // neighbours so that a ridge between two samples is cleared), and keeps above the tree tops over a forest.
      const span = crowSpan(s), raw = s.profile;
      for (let i = 0; i < 9; i++) { const a = (i / 4 - 1) * span; raw[i] = Math.max(0, terrain.heightAt(s.x + s.dx * a, s.z + s.dz * a)); }
      let before = raw[0];
      for (let i = 0; i < 9; i++) { const here = raw[i], next = raw[Math.min(8, i + 1)]; raw[i] = Math.max(before, here, next) + 9 * (h.forest || 0); before = here; }
    }
    if (step >= 3) return;
    const fx = Math.floor(pos.x / FAUNA.flockCell), fz = Math.floor(pos.z / FAUNA.flockCell);
    for (let z = fz - 2; z <= fz + 2; z++) for (let x = fx - 2; x <= fx + 2; x++) {
      flockCell(x, z, cell);
      if (Math.hypot(cell.x - pos.x, cell.z - pos.z) > FAUNA.flockReach) continue;
      let known = false, free = null;
      for (const s of flocks) { if (s.used && s.ix === x && s.iz === z) known = true; if (!s.used) free = s; }
      if (known || !free) continue;
      context.habitat.at(cell.x, cell.z, h); faunaAmounts(h, day, point);
      if (cell.roll >= point.flocks * multiplier || !flockAllowed(cell, h, terrain)) continue;
      resetFlock(free, cell, terrain.heightAt(cell.x, cell.z)); free.probability = point.flocks;
    }
  }
  function insects(mesh, seeds, amount, kind, frame) {
    if (step >= 3) { upload(mesh, 0); return 0; }
    const n = Math.min(seeds.length, Math.ceil(amount)), fraction = amount % 1;
    let visible = 0;
    for (let i = 0; i < n; i++) {
      const s = seeds[i]; insectPosition(s, frame.time, frame.windDir, frame.pos, point);
      point.y += terrain.heightAt(point.x, point.z);
      if (i === n - 1 && fraction > 0) point.fade *= fraction;
      write(mesh, i, point, kind === 2 ? FAUNA.butterflySize : FAUNA.dragonflySize, kind, s.roll, s.phase, kind === 2 ? 1 : .08);
      if (point.fade > .05) visible++;
    }
    upload(mesh, n); return visible;
  }
  return {
    update(frame) {
      if (disposed || paused) return;
      const hero = context.hero, factor = multiplier * light * (step >= 2 ? .6 : 1);
      seen.x = frame.pos.x; seen.z = frame.pos.z; seen.time = frame.time; seen.factor = factor;
      // Retain disturbed flocks through the entire cooldown, including when outside the view.
      for (const s of flocks) if (s.used) {
        updateFlock(s, hero, frame.time, frame.flying || step >= 3 || s.roll >= s.probability * factor, reduced, events);
        if (s.mode === 0 && Math.hypot(s.x - frame.pos.x, s.z - frame.pos.z) > 60 && Math.hypot(s.x - hero.pos.x, s.z - hero.pos.z) >= FAUNA.returnRange) s.used = false;
      }
      sinceSample += frame.dt;
      if (sinceSample >= .25) { sinceSample = 0; sample(frame.pos, frame.time); }
      const blend = 1 - Math.exp(-frame.dt / 1.5);
      amounts.butterflies += (target.butterflies - amounts.butterflies) * blend;
      amounts.dragonflies += (target.dragonflies - amounts.dragonflies) * blend;
      uniforms.uFaunaTime.value = frame.time;
      if (context.sunDir) uniforms.uFaunaSun.value.copy(context.sunDir);
      if (context.renderer?.getDrawingBufferSize) { context.renderer.getDrawingBufferSize(viewport); uniforms.uFaunaHeight.value = viewport.y; }
      let n = 0; counts.kites = counts.crows = counts.near = counts.flying = 0;
      for (const s of kites) {
        const away = Math.hypot(s.x - frame.pos.x, s.z - frame.pos.z);
        if (s.roll >= s.probability * factor || away > FAUNA.kiteReach) continue;
        kitePosition(s, frame.time, frame.windDir, point); point.y += s.ground;
        point.fade *= 1 - Math.max(0, (away - (FAUNA.kiteReach - FAUNA.kiteFade)) / FAUNA.kiteFade);
        write(birds, n++, point, FAUNA.kiteSize, 0, s.roll, s.phase, .025); counts.kites++;
      }
      const crowLimit = n + FAUNA.crowCapacity;
      if (step < 3 && !reduced) for (const s of crows) {
        if (!s.used || s.roll >= s.probability * factor || s.window !== crowWindow(s.ix, s.iz, frame.time)) continue;
        let shown = false;
        for (let i = 0; i < s.count && n < crowLimit; i++) {
          crowPosition(s, i, frame.time, point);
          const along = Math.max(0, Math.min(7.999, (frame.time - s.start) / FAUNA.crowWindow * 8)), k = Math.floor(along);
          point.y += s.profile[k] + (s.profile[k + 1] - s.profile[k]) * (along - k);
          const away = Math.hypot(point.x - frame.pos.x, point.z - frame.pos.z);
          if (away > FAUNA.crowReach) continue;
          point.fade *= 1 - Math.max(0, (away - (FAUNA.crowReach - FAUNA.crowFade)) / FAUNA.crowFade);
          write(birds, n++, point, FAUNA.crowSize, 4, (s.roll * 7 + i * .23) % 1, s.phase + i * 1.9, 1); shown = true;
        }
        if (shown) counts.crows++;
      }
      if (step < 3) for (const s of flocks) if (s.used) {
        const distance = Math.hypot(s.x - frame.pos.x, s.z - frame.pos.z);
        if (distance > FAUNA.flockReach && s.mode !== 1) continue;
        if (s.roll >= s.probability * factor || s.mode === 2) continue;
        counts.near++; if (s.mode === 1) counts.flying++;
        for (let i = 0; i < s.count; i++) {
          flockBirdPosition(s, i, frame.time, point);
          if (s.mode === 0) point.y += terrain.heightAt(point.x, point.z) - s.y;
          if (s.mode === 0) point.fade *= 1 - Math.max(0, (distance - 22) / 3);
          write(birds, n++, point, FAUNA.birdSize, 1, (s.roll * 13 + i * .17) % 1, s.phase + i, point.flap);
        }
        if (debug) { point.x = s.x; point.y = s.y; point.z = s.z; point.fade = 1; point.yaw = 0; point.bank = 0;
          write(birds, n++, point, 1, 1, 0, 0, 0, 1); }
      }
      upload(birds, n);
      const insectFactor = factor * (reduced ? .4 : 1);
      counts.butterflies = insects(butterflies, butterflySeeds, amounts.butterflies * insectFactor, 2, frame);
      counts.dragonflies = insects(dragonflies, dragonflySeeds, amounts.dragonflies * insectFactor, 3, frame);
    },
    setAdapt(next) {
      if (disposed) return; step = next; butterflies.visible = dragonflies.visible = step < 3;
      if (step >= 3) { birds.geometry.instanceCount = counts.kites; butterflies.geometry.instanceCount = dragonflies.geometry.instanceCount = 0;
        counts.crows = counts.near = counts.flying = counts.butterflies = counts.dragonflies = 0; }
    },
    setPaused(on) { paused = !!on; },
    debugText() { return disposed ? '' : `生 鳶${counts.kites} 烏${counts.crows} 群${counts.flying}/${counts.near} 蝶${counts.butterflies} 蜻蛉${counts.dragonflies}`; },
    dispose() {
      if (disposed) return; disposed = true;
      for (const mesh of meshes) { context.scene.remove(mesh); mesh.geometry.dispose(); mesh.material.dispose(); }
      if (globalThis.__kzFauna === inspect) delete globalThis.__kzFauna;
    },
  };
}
