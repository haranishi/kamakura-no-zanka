// Kamakura-only late upper-body pose and four ribbons, sharing one geometry/material/draw.
import { gustLevel } from './kamakura-gust.js';
import { createHeroLife, stepHeroLife, createClothChain, stepCloth } from './kamakura-hero-life.js';

// Fractions of character.height, in the attachment bone's frame (+Z front). Tune only here
// after the parent checks the animated model. No forehead band until that check.
export const HERO_CLOTH = Object.freeze({
  // Parent (real Chrome): at y .045 the tails left the nape; raised to the tie of the topknot so they read as its cords.
  // Blind critique of stills (R10): 3 cm pale cords read as a strap across the back, even as a display fault. They are cords now:
  // half as wide, a little shorter, and a duller colour than the collar.
  band: Object.freeze({ x: 0, y: .088, z: -.066, separation: .018, length: .38, width: .016 }),
  sash: Object.freeze({ x: .105, y: .02, z: -.077, separation: .021, length: .30, width: .022 }),
  head: Object.freeze({ y: .042, radius: .074 }), torsoRadius: .087, knotWidth: .024, knotHeight: .016,
});
const RAD = Math.PI / 180, SHARE = [.3, .35, .35];

export function createKamakuraHeroLife(context, options = {}) {
  if (new URLSearchParams(context.search).get('herolife') === '0') return null;
  return buildHeroLife(context, options);
}

// Keep the layer registry importable by pure Node tests. Existing bundled browser modules are
// loaded only for an enabled instance; the layer seam already awaits asynchronous factories.
async function buildHeroLife(context, { reducedMotion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false }) {
  const [THREE, { SPEED }] = await Promise.all([import('three'), import('./actors.js')]);
  const params = new URLSearchParams(context.search);
  const { hero, scene, terrain, keys, flight } = context, ch = hero.character, height = ch.height || 1.7;
  const state = createHeroLife(), bones = [ch.bone('Spine'), ch.bone('Spine01'), ch.bone('Spine02'), ch.bone('neck') || ch.bone('Neck'), ch.bone('Head')];
  const saved = bones.map(() => new THREE.Quaternion()), q = new THREE.Quaternion(), euler = new THREE.Euler();
  const head = bones[4], hips = ch.bone('Hips'), chest = bones[2] || bones[0];
  let applied = false, paused = false, disposed = false, dtPose = 0, stepped = false, adapt = 0, stroll = false, oldWalk = null;
  const debug = params.get('debug') === '1', clothMode = params.get('cloth'), cloth = [];
  for (let i = 0; i < 4; i++) {
    const band = i < 2, cfg = band ? HERO_CLOTH.band : HERO_CLOTH.sash;
    if (clothMode === '0' || (clothMode === 'band' && !band) || (clothMode === 'sash' && band) || !(band ? head : hips)) continue;
    cloth.push({ chain: createClothChain(cfg.length * height / 1.7), bone: band ? head : hips, band,
      offset: new THREE.Vector3((cfg.x + (i % 2 ? 1 : -1) * cfg.separation / 2) * height, cfg.y * height, cfg.z * height),
      root: new Float64Array(3), width: cfg.width * height / 1.7, side: new THREE.Vector3(), rotation: new THREE.Quaternion() });
  }
  const vector = new THREE.Vector3(), position = new THREE.Vector3(), rotation = new THREE.Quaternion();
  const sphere = new Float64Array(4), capsule = new Float64Array(7);
  const ground = terrain?.heightAt ? (x, z) => terrain.heightAt(x, z) : null;
  const hasKnot = cloth.some(c => c.band), vertexCount = cloth.length * 16 + (hasKnot ? 4 : 0);
  const vertices = new Float32Array(vertexCount * 3), normals = new Float32Array(vertexCount * 3), indices = [];
  for (let c = 0; c < cloth.length; c++) for (let i = 0; i < 7; i++) {
    const a = c * 16 + i * 2; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  if (hasKnot) { const a = cloth.length * 16; indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  let mesh = null, geometry = null, material = null, lines = null;
  if (cloth.length) {
    geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(vertices, 3).setUsage(THREE.DynamicDrawUsage));
    geometry.setAttribute('normal', new THREE.BufferAttribute(normals, 3).setUsage(THREE.DynamicDrawUsage)); geometry.setIndex(indices);
    material = new THREE.MeshLambertMaterial({ color: 0x9a8f78, side: THREE.DoubleSide });
    mesh = new THREE.Mesh(geometry, material); mesh.name = 'kamakura-hero-cloth';
    mesh.receiveShadow = true; mesh.castShadow = false; mesh.frustumCulled = false; mesh.visible = false; scene.add(mesh);
    if (params.get('herodebug') === '1') {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(2400), 3).setUsage(THREE.DynamicDrawUsage));
      lines = new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: 0xe5b456, depthTest: false }));
      lines.name = 'kamakura-hero-cloth-debug'; lines.frustumCulled = false; lines.visible = false; scene.add(lines);
    }
  }
  function undo() {
    if (!applied) return;
    for (let i = 0; i < bones.length; i++) if (bones[i]) bones[i].quaternion.copy(saved[i]);
    applied = false;
  }
  function allowed() {
    const f = hero.fighter;
    return !hero.scripted && hero.alive !== false && !hero.down && (!f || (f.alive !== false && f.state === 'idle')) &&
      ch.style !== 'crouch' && (!ch.currentName || ch.currentName === ch.locoName) &&
      !(ch.sword?.frame?.u > 0 && ch.sword.frame.u < 1);
  }
  function pose() {
    if (disposed || paused) return;
    const active = allowed();
    stepHeroLife(state, dtPose, hero.speed || 0, active, reducedMotion); stepped = true;
    if (!active) return;
    undo();
    for (let i = 0; i < bones.length; i++) if (bones[i]) saved[i].copy(bones[i].quaternion);
    applied = true;
    for (let i = 0; i < 3; i++) if (bones[i]) {
      euler.set(state.breath * SHARE[i] * RAD, 0, state.sway * SHARE[i] * RAD);
      bones[i].quaternion.multiply(q.setFromEuler(euler));
    }
    if (bones[3]) { euler.set(state.pitch * .4 * RAD, state.look * .4 * RAD, 0); bones[3].quaternion.multiply(q.setFromEuler(euler)); }
    if (head) { const share = bones[3] ? .6 : 1; euler.set(state.pitch * share * RAD, state.look * share * RAD, 0); head.quaternion.multiply(q.setFromEuler(euler)); }
  }
  // UpperRig treats cinePose as a cinematic. Hide ONLY our callback during its existing legIk
  // pass; finishPose clears legIk before reading the late hook. External cinematic assignments
  // retain their usual meaning. This preserves M3 without editing any shared character code.
  const descriptor = Object.getOwnPropertyDescriptor(ch, 'cinePose');
  let currentPose = ch.cinePose || pose;
  Object.defineProperty(ch, 'cinePose', { configurable: true, enumerable: true,
    get() { return currentPose === pose && ch.legIk ? null : currentPose; }, set(value) { currentPose = value; } });

  function worldPoint(bone, offset, out) {
    bone.getWorldPosition(position); bone.getWorldQuaternion(rotation);
    vector.copy(offset).applyQuaternion(rotation).add(position);
    out[0] = vector.x; out[1] = vector.y; out[2] = vector.z;
  }
  function bodyShapes() {
    if (head) {
      head.getWorldPosition(position); head.getWorldQuaternion(rotation);
      vector.set(0, HERO_CLOTH.head.y * height, 0).applyQuaternion(rotation).add(position);
      sphere[0] = vector.x; sphere[1] = vector.y; sphere[2] = vector.z; sphere[3] = HERO_CLOTH.head.radius * height;
    }
    if (hips && chest) {
      hips.getWorldPosition(position); capsule[0] = position.x; capsule[1] = position.y; capsule[2] = position.z;
      chest.getWorldPosition(position); capsule[3] = position.x; capsule[4] = position.y; capsule[5] = position.z;
      capsule[6] = HERO_CLOTH.torsoRadius * height;
    }
  }
  function writeRibbons() {
    for (let c = 0; c < cloth.length; c++) {
      const ribbon = cloth[c], p = ribbon.chain.p, side = ribbon.side;
      for (let i = 0; i < 8; i++) {
        const k = i * 3, a = Math.max(0, i - 1) * 3, b = Math.min(7, i + 1) * 3;
        let tx = p[b] - p[a], ty = p[b + 1] - p[a + 1], tz = p[b + 2] - p[a + 2];
        const tl = Math.hypot(tx, ty, tz) || 1; tx /= tl; ty /= tl; tz /= tl;
        const dot = tx * side.x + ty * side.y + tz * side.z;
        let sx = side.x - tx * dot, sy = side.y - ty * dot, sz = side.z - tz * dot, sl = Math.hypot(sx, sy, sz);
        if (sl < 1e-6) { sx = -ty; sy = tx; sz = 0; sl = Math.hypot(sx, sy) || 1; }
        sx /= sl; sy /= sl; sz /= sl;
        const width = ribbon.width * .5 * (1 - .25 * i / 7), v = (c * 16 + i * 2) * 3;
        for (let j = 0; j < 2; j++) {
          const sign = j ? 1 : -1, o = v + j * 3;
          vertices[o] = p[k] + sx * width * sign; vertices[o + 1] = p[k + 1] + sy * width * sign; vertices[o + 2] = p[k + 2] + sz * width * sign;
          normals[o] = sy * tz - sz * ty; normals[o + 1] = sz * tx - sx * tz; normals[o + 2] = sx * ty - sy * tx;
        }
      }
    }
    if (hasKnot) {
      const o = cloth.length * 16 * 3, cfg = HERO_CLOTH.band;
      head.getWorldPosition(position); head.getWorldQuaternion(rotation);
      for (let i = 0; i < 4; i++) {
        vector.set((cfg.x + (i % 2 ? 1 : -1) * HERO_CLOTH.knotWidth / 2) * height,
          (cfg.y + (i < 2 ? 1 : -1) * HERO_CLOTH.knotHeight / 2) * height, cfg.z * height).applyQuaternion(rotation).add(position);
        const k = o + i * 3; vertices[k] = vector.x; vertices[k + 1] = vector.y; vertices[k + 2] = vector.z;
      }
      vector.set(0, 0, -1).applyQuaternion(rotation);
      for (let i = 0; i < 4; i++) { const k = o + i * 3; normals[k] = vector.x; normals[k + 1] = vector.y; normals[k + 2] = vector.z; }
    }
    geometry.attributes.position.needsUpdate = geometry.attributes.normal.needsUpdate = true;
  }
  let debugIndex = 0;
  function segment(ax, ay, az, bx, by, bz) {
    const a = lines.geometry.attributes.position.array, i = debugIndex;
    a[i] = ax; a[i + 1] = ay; a[i + 2] = az; a[i + 3] = bx; a[i + 4] = by; a[i + 5] = bz; debugIndex += 6;
  }
  function wireSphere(x, y, z, r) {
    for (let plane = 0; plane < 3; plane++) for (let i = 0; i < 24; i++) {
      const a = i * Math.PI / 12, b = (i + 1) * Math.PI / 12;
      segment(x + (plane === 1 ? 0 : Math.cos(a) * r), y + (plane === 2 ? 0 : (plane === 1 ? Math.cos(a) : Math.sin(a)) * r), z + (plane === 0 ? 0 : Math.sin(a) * r),
        x + (plane === 1 ? 0 : Math.cos(b) * r), y + (plane === 2 ? 0 : (plane === 1 ? Math.cos(b) : Math.sin(b)) * r), z + (plane === 0 ? 0 : Math.sin(b) * r));
    }
  }
  function writeDebug() {
    debugIndex = 0;
    for (let c = 0; c < cloth.length; c++) {
      const p = cloth[c].chain.p;
      for (let k = 3; k < p.length; k += 3) segment(p[k - 3], p[k - 2], p[k - 1], p[k], p[k + 1], p[k + 2]);
      for (let k = 0; k < p.length; k += 3) segment(p[k] - .006, p[k + 1], p[k + 2], p[k] + .006, p[k + 1], p[k + 2]);
    }
    if (head) wireSphere(sphere[0], sphere[1], sphere[2], sphere[3]);
    if (hips && chest) {
      wireSphere(capsule[0], capsule[1], capsule[2], capsule[6]); wireSphere(capsule[3], capsule[4], capsule[5], capsule[6]);
      for (let i = 0; i < 4; i++) { const x = Math.cos(i * Math.PI / 2) * capsule[6], z = Math.sin(i * Math.PI / 2) * capsule[6]; segment(capsule[0] + x, capsule[1], capsule[2] + z, capsule[3] + x, capsule[4], capsule[5] + z); }
    }
    lines.geometry.setDrawRange(0, debugIndex / 3); lines.geometry.attributes.position.needsUpdate = true;
  }
  const stats = () => {
    let maxStretch = 0, nan = false;
    for (let i = 0; i < cloth.length; i++) { maxStretch = Math.max(maxStretch, cloth[i].chain.maxStretch); nan ||= cloth[i].chain.nan; }
    return { breath: state.breath, look: state.look, sway: state.sway, stroll, cloth: { maxStretch, nan } };
  };
  if (debug) globalThis.__kzHeroLife = stats;
  return {
    beforeHero(dt) {
      if (disposed) return;
      undo(); dtPose = paused ? 0 : dt; stepped = false;
      if (!currentPose) currentPose = pose;
      if (!paused && !flight?.active && keys?.wasPressed('KeyC')) {
        if (!stroll) { oldWalk = SPEED.walk; stroll = true; SPEED.walk = 1.35; }
        else { stroll = false; SPEED.walk = oldWalk; }
        context.game?.hud?.hint('stroll', stroll ? 'ゆっくり歩き：入（C で戻す）' : 'ゆっくり歩き：切', 1800);
      }
    },
    update(frame) {
      if (disposed || paused) return;
      if (frame.flying) { undo(); dtPose = 0; }
      if (!stepped) stepHeroLife(state, frame.dt, hero.speed || 0, allowed() && !frame.flying && currentPose === pose, reducedMotion);
      stepped = false;
      if (!mesh) return;
      const show = !hero.scripted && hero.alive !== false && ch.root.visible !== false;
      mesh.visible = show; if (lines) lines.visible = show;
      if (!show) return;
      ch.root.updateWorldMatrix(true, true); bodyShapes();
      const dir = frame.windDir, wind = (.3 + .7 * gustLevel(hero.pos.x, hero.pos.z, frame.time, dir[0], dir[1])) * frame.wind * 8 *
        (reducedMotion ? .3 : 1) * (context.quality === 'light' || adapt >= 2 ? .7 : 1);
      const iterations = adapt >= 3 ? 10 : context.quality === 'light' || adapt >= 2 ? 12 : 16;
      for (let i = 0; i < cloth.length; i++) {
        const ribbon = cloth[i]; worldPoint(ribbon.bone, ribbon.offset, ribbon.root);
        ribbon.bone.getWorldQuaternion(ribbon.rotation); ribbon.side.set(1, 0, 0).applyQuaternion(ribbon.rotation);
        stepCloth(ribbon.chain, frame.dt, ribbon.root, dir[0] * wind, dir[1] * wind, head ? sphere : null, hips && chest ? capsule : null, ground, iterations);
      }
      writeRibbons(); if (lines) writeDebug();
    },
    setAdapt(step) { adapt = Math.max(0, Math.min(3, step)); },
    setPaused(on) {
      if (disposed) return;
      paused = !!on; if (paused) undo();
      else for (let i = 0; i < cloth.length; i++) cloth[i].chain.ready = false;
    },
    debugText() { return debug && !disposed ? `姿 息${state.breath.toFixed(1)}° 見${state.look.toFixed(0)}° 布${cloth.length} 歩:${stroll ? '遅' : '速'}` : ''; },
    dispose() {
      if (disposed) return; disposed = true; undo();
      if (stroll) SPEED.walk = oldWalk;
      const restore = currentPose === pose ? null : currentPose;
      Object.defineProperty(ch, 'cinePose', descriptor ? { ...descriptor, value: restore } : { value: restore, writable: true, configurable: true, enumerable: true });
      if (globalThis.__kzHeroLife === stats) delete globalThis.__kzHeroLife;
      if (mesh) { scene.remove(mesh); geometry.dispose(); material.dispose(); }
      if (lines) { scene.remove(lines); lines.geometry.dispose(); lines.material.dispose(); }
    },
  };
}
