// B2/B5/B6: fixed geometry and uniforms only during steady frames. No texture or external asset.
import * as THREE from '../vendor/three.module.min.js';
import { BRIDGES, bridgeSites, bridgesEnabled, bridgeRange, bridgeAt, addBridgeRails } from './kamakura-bridges.js';
import { RIVER_ROCKS, riverRocks, rocksEnabled, rockCircles } from './kamakura-river-rocks.js';
import { RIVERLIFE_ART as ART, bridgeGeometry, rocksGeometry, foamGeometry } from './kamakura-riverlife-kit.js';
import { addColliderCircles } from './collision.js';
export const RIVERLIFE_VERTEX_PARS = `
attribute vec3 aRiverlifeCenter;
uniform vec3 uRiverlifeViewer;
uniform float uRiverlifeNear, uRiverlifeFar;
`;
export const RIVERLIFE_BEGIN_VERTEX = `
float riverlifeDistance = distance(aRiverlifeCenter, uRiverlifeViewer);
vec3 transformed = position * step(uRiverlifeNear, riverlifeDistance) * (1.0 - step(uRiverlifeFar, riverlifeDistance));
`;
export const FOAM_VERTEX_PARS = `
attribute vec3 aFoamOrigin;
attribute vec4 aFoamShape;
attribute vec3 aFoamMotion;
uniform vec3 uRiverlifeViewer;
uniform float uRiverlifeFar;
varying vec2 vFoamUV, vFoamMeters, vFoamMotion;
`;
export const FOAM_BEGIN_VERTEX = `
vFoamUV = position.xz;
vFoamMeters = position.xz * aFoamShape.xy;
vFoamMotion = aFoamMotion.xy;
vec3 transformed = aFoamOrigin + vec3(aFoamShape.w * position.x * aFoamShape.x + aFoamShape.z * position.z * aFoamShape.y, position.z * aFoamShape.y * aFoamMotion.z,
  -aFoamShape.z * position.x * aFoamShape.x + aFoamShape.w * position.z * aFoamShape.y);
transformed *= 1.0 - step(uRiverlifeFar, distance(aFoamOrigin, uRiverlifeViewer));
`;
export const FOAM_FRAGMENT_PARS = `
uniform float uRiverlifeTime, uRiverlifeDebug;
varying vec2 vFoamUV, vFoamMeters, vFoamMotion;
float riverlifeHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float riverlifeNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(riverlifeHash(i), riverlifeHash(i + vec2(1.0, 0.0)), f.x),
    mix(riverlifeHash(i + vec2(0.0, 1.0)), riverlifeHash(i + vec2(1.0)), f.x), f.y);
}
`;
export const FOAM_COLOR_FRAGMENT = `
vec2 riverlifeP = vFoamMeters - vec2(0.0, uRiverlifeTime * vFoamMotion.x);
float riverlifeNoiseValue = riverlifeNoise(riverlifeP * ${ART.noiseScale.toFixed(3)});
float riverlifeEdge = max(abs(vFoamUV.x), abs(vFoamUV.y));
float riverlifeAlpha = (1.0 - smoothstep(0.5 - ${ART.noiseEdge.toFixed(3)}, 0.5, riverlifeEdge + riverlifeNoiseValue * ${ART.noiseEdge.toFixed(3)}));
if (vFoamMotion.y > 0.5 && vFoamMotion.y < 1.5) {
  float riverlifeArc = length(vFoamUV * 2.0);
  riverlifeAlpha *= (1.0 - smoothstep(${ART.arcThickness.toFixed(3)}, ${(ART.arcThickness * 2).toFixed(3)}, abs(riverlifeArc - 0.65))) * (1.0 - step(0.0, vFoamUV.y));
}
riverlifeAlpha *= 0.35 + 0.65 * riverlifeNoiseValue;
if (uRiverlifeDebug > 0.5) riverlifeAlpha = 1.0;
diffuseColor.a *= riverlifeAlpha;
if (diffuseColor.a < 0.01) discard;
`;
export function installRiverlifeShader(material, uniforms, foam = false) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + (foam ? FOAM_VERTEX_PARS : RIVERLIFE_VERTEX_PARS))
      .replace('#include <begin_vertex>', foam ? FOAM_BEGIN_VERTEX : RIVERLIFE_BEGIN_VERTEX);
    if (foam) shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + FOAM_FRAGMENT_PARS)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + FOAM_COLOR_FRAGMENT);
  };
  material.customProgramCacheKey = () => `riverlife-${foam ? 'foam' : 'solid'}-1`;
}
export function createKamakuraRiverlife(context) {
  const search = context.search || '', bridgeOn = bridgesEnabled(search), rockOn = rocksEnabled(search);
  if (!bridgeOn && !rockOn) return null;
  const q = new URLSearchParams(search), debug = q.get('riverlifedebug') === '1';
  // Post fog would recolour the masks even on fog-free Basic materials. The debug URL
  // deliberately latches the existing no-post route for this world owner.
  if (debug) context.post?.setAdapt?.(2);
  const sites = bridgeOn ? bridgeSites(context.data, context.terrain) : [];
  const placed = rockOn ? riverRocks(context.data, context.terrain, sites, context.quality) : { rocks: [], foam: [], groups: [], cap: 0 };
  const group = new THREE.Group(); group.name = 'kamakura-riverlife'; context.scene.add(group);
  const viewer = new THREE.Vector3(), shared = { uRiverlifeViewer: { value: viewer } }, sets = [];
  let disposed = false, paused = false, step = 0, heroPos = context.hero?.pos, bridges = 0, rocks = 0, foam = 0, triangles = 0, draws = 0;
  const time = { value: 0 }, enabledDebug = { value: +debug };
  function add(name, geometry, lo, hi, isFoam = false) {
    const uniforms = { ...shared, uRiverlifeNear: { value: lo }, uRiverlifeFar: { value: hi }, uRiverlifeTime: time, uRiverlifeDebug: enabledDebug };
    const material = isFoam || debug ? new THREE.MeshBasicMaterial({ vertexColors: !isFoam, color: isFoam ? (debug ? ART.foamDebug : new THREE.Color(...ART.foamColor)) : 0xffffff,
      toneMapped: !debug, transparent: isFoam && !debug, opacity: isFoam && !debug ? ART.foamOpacity : 1, depthWrite: !isFoam || debug, fog: !debug }) : new THREE.MeshLambertMaterial({ vertexColors: true });
    installRiverlifeShader(material, uniforms, isFoam);
    const mesh = new THREE.Mesh(geometry, material); mesh.name = name; mesh.frustumCulled = false; mesh.visible = false;
    mesh.castShadow = !isFoam && name !== 'collision'; mesh.receiveShadow = !isFoam;
    const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    if (!isFoam) { installRiverlifeShader(depth, uniforms); mesh.customDepthMaterial = depth; }
    group.add(mesh);
    const count = geometry.index ? geometry.index.count / 3 : geometry.attributes.position.count / 3;
    const tris = count * (isFoam ? geometry.instanceCount : 1);
    sets.push({ name, mesh, geometry, material, depth, uniforms, triangles: tris });
  }
  if (sites.length) {
    const shapes = bridgeGeometry(sites, context.terrain, debug);
    for (const name of ['deck', 'rail', 'pier', 'far', 'collision']) {
      if (name === 'collision' && !debug) { shapes[name].dispose(); continue; }
      add(name, shapes[name], name === 'far' ? BRIDGES.nearRange : 0, name === 'far' ? bridgeRange(context.quality) : BRIDGES.nearRange);
    }
  }
  if (placed.rocks.length) add('rocks', rocksGeometry(placed.rocks, debug), 0, RIVER_ROCKS.range);
  if (placed.foam.length) add('foam', foamGeometry(placed.foam), 0, RIVER_ROCKS.foamRange, true);
  const releaseRails = context.colliders && sites.length ? addBridgeRails(context.colliders, sites, context.terrain) : null;
  const releaseRocks = context.colliders && placed.rocks.length ? addColliderCircles(context.colliders, rockCircles(placed.rocks)) : null;
  function stats() {
    const range = bridgeRange(context.quality, step), hero = heroPos;
    const records = sites.map(s => ({ road: s.road, river: s.river, span: s.span, width: s.width, deck: s.deck,
      distance: Math.hypot(s.x - viewer.x, s.deck - viewer.y, s.z - viewer.z), bearing: (Math.atan2(s.x - viewer.x, viewer.z - s.z) * 180 / Math.PI + 360) % 360 }));
    let nearest = null;
    for (const b of records) if (b.distance < range && (!nearest || b.distance < nearest.distance)) nearest = { kind: 'bridge', distance: b.distance, bearing: b.bearing };
    for (const r of placed.rocks) {
      const d = Math.hypot(r.x - viewer.x, r.y - viewer.y, r.z - viewer.z);
      if (d < RIVER_ROCKS.range * (1 - step * RIVER_ROCKS.adaptFactor) && (!nearest || d < nearest.distance)) nearest = { kind: 'rock', distance: d, bearing: (Math.atan2(r.x - viewer.x, viewer.z - r.z) * 180 / Math.PI + 360) % 360 };
    }
    return { bridges: records, rocks: { count: rocks, groups: placed.groups.length }, foam: { count: foam }, deckUnderHero: !!(hero && bridgeAt(sites, hero.x, hero.z)),
      drawn: { bridges, triangles, draws }, range, nearest, work: { distanceTests: sites.length + placed.rocks.length + placed.foam.length, bufferWrites: 0 } };
  }
  if (q.get('debug') === '1') globalThis.__kzRiverlife = stats;
  return {
    update(frame) {
      if (disposed) return;
      heroPos = frame.hero?.pos || heroPos; viewer.set(frame.pos.x, frame.pos.y ?? 0, frame.pos.z);
      if (!paused) time.value += frame.dt;
      const range = bridgeRange(context.quality, step), rockRange = RIVER_ROCKS.range * (1 - step * RIVER_ROCKS.adaptFactor), foamRange = RIVER_ROCKS.foamRange * (1 - step * RIVER_ROCKS.adaptFactor);
      let near = 0, far = 0; rocks = foam = bridges = triangles = draws = 0;
      for (const s of sites) {
        const d = Math.hypot(s.x - viewer.x, s.deck - viewer.y, s.z - viewer.z);
        if (d >= range) continue; bridges++; if (d < BRIDGES.nearRange) near++; else far++;
      }
      for (const r of placed.rocks) if (Math.hypot(r.x - viewer.x, r.y - viewer.y, r.z - viewer.z) < rockRange) rocks++;
      for (const f of placed.foam) if (Math.hypot(f.x - viewer.x, f.y - viewer.y, f.z - viewer.z) < foamRange) foam++;
      for (const s of sets) {
        const isRock = s.name === 'rocks', isFoam = s.name === 'foam', isFar = s.name === 'far';
        s.uniforms.uRiverlifeFar.value = isRock ? rockRange : isFoam ? foamRange : isFar ? range : BRIDGES.nearRange;
        s.mesh.visible = isRock ? rocks > 0 : isFoam ? foam > 0 : isFar ? far > 0 : near > 0;
        if (s.mesh.visible) { draws++; triangles += s.triangles; }
      }
    },
    setAdapt(value) { step = Math.max(0, Math.min(3, value)); },
    setPaused(on) { paused = !!on; },
    debugText() { return `橋 ${bridges}・岩 ${rocks}`; },
    dispose() {
      if (disposed) return; disposed = true; releaseRails?.(); releaseRocks?.(); group.removeFromParent();
      for (const s of sets) { s.geometry.dispose(); s.material.dispose(); s.depth.dispose(); }
      if (globalThis.__kzRiverlife === stats) delete globalThis.__kzRiverlife;
    },
  };
}
