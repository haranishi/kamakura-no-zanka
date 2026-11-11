// W2c-16: two instanced draws; particles have no CPU simulation state or textures.
// Same vendored module as the browser import map; also keeps the layer list importable in Node.
import * as THREE from '../vendor/three.module.min.js';
import { atmosphereOptions } from './kamakura-atmosphere.js';
import { DRIFT, DRIFT_KINDS, DRIFT_GLSL, driftSeeds, driftAmounts } from './kamakura-drift.js';

const vertexPars = `
uniform float uDriftTime, uDriftMotion, uDriftWind, uDriftHeight;
uniform vec2 uDriftDir;
uniform vec3 uDriftViewer, uDriftSun;
uniform vec4 uDriftAmounts;
attribute vec3 aDriftBase, aDriftAxis, aDriftColor;
attribute vec4 aDriftShape;
varying vec2 vDriftUv;
varying vec3 vDriftColor;
varying float vDriftAlpha, vDriftKind, vDriftLight;
${DRIFT_GLSL}
`;
const fragmentPars = `
uniform float uDriftDebug;
varying vec2 vDriftUv;
varying vec3 vDriftColor;
varying float vDriftAlpha, vDriftKind, vDriftLight;
`;
const vertexMotion = `
int driftKind = int(aDriftShape.y + 0.5);
float driftFade;
vec3 driftCenter = kzDriftPosition(aDriftBase, driftKind, aDriftShape.z, driftFade);
vec3 driftView = (viewMatrix * vec4(driftCenter, 1.0)).xyz;
float driftPixels = aDriftShape.x * uDriftHeight * 0.5 * projectionMatrix[1][1] / max(0.1, -driftView.z);
float driftNear = smoothstep(${DRIFT.cameraNear.toFixed(2)}, ${DRIFT.cameraFull.toFixed(2)}, distance(driftCenter, cameraPosition));
float driftSizeFade = smoothstep(${DRIFT.minPixels.toFixed(2)}, ${DRIFT.fullPixels.toFixed(2)}, driftPixels) * driftNear;
float driftBand = kzGustBand(driftCenter.xz, uDriftTime, uDriftDir);
float driftAmount = clamp(uDriftAmounts[driftKind] * (${DRIFT.calm.toFixed(2)} + ${(1 - DRIFT.calm).toFixed(2)} * driftBand), 0.0, 1.0);
// The random threshold also drives scale: births fade in instead of popping on.
float driftShow = smoothstep(aDriftShape.w, aDriftShape.w + 0.04, driftAmount);
float driftScale = aDriftShape.x * driftFade * driftSizeFade * driftShow;
vDriftAlpha = driftFade * driftSizeFade * driftShow;
vDriftUv = position.xy * 2.0;
vDriftColor = aDriftColor;
vDriftKind = aDriftShape.y;
vec3 driftRay = normalize(driftCenter - cameraPosition + vec3(0.0, 0.00001, 0.0));
vDriftLight = pow(max(0.0, dot(driftRay, uDriftSun)), 6.0);
`;
const organicVertex = `
${vertexMotion}
// A leaf is slender, a petal rounder.
vec3 transformed = driftCenter + kzDriftRotate(vec3(position.x * mix(0.65, 0.88, step(0.5, aDriftShape.y)), position.y, 0.0)) * driftScale;
`;
const glowVertex = `
${vertexMotion}
// Glow points are never culled by size: far ones are widened to a soft two-pixel disc and dimmed by the same area, so they
// twinkle without becoming one-pixel sparks. Toward the sun the dust exceeds 1.0 and feeds the bloom.
float driftGrow = max(1.0, ${DRIFT.glowPixels.toFixed(2)} / max(driftPixels, 0.05));
driftScale = aDriftShape.x * driftFade * driftShow * driftNear * driftGrow;
vDriftAlpha = driftFade * driftShow * driftNear / (driftGrow * driftGrow);
vec3 driftRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 driftUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
vec3 transformed = driftCenter + (driftRight * position.x + driftUp * position.y) * driftScale;
if (driftKind == 2) vDriftAlpha *= 0.45 + 1.10 * vDriftLight;
else {
  float driftPulse = 0.5 + 0.5 * sin(uDriftTime * 6.283185 / (2.0 + aDriftShape.w * 2.0) + aDriftShape.z);
  vDriftAlpha *= 0.15 + 1.60 * pow(driftPulse, 3.0);
}
`;
const organicFragment = `
vec2 driftUv = vDriftUv;
float driftShape = vDriftKind < 0.5
  ? length(vec2(driftUv.x * (1.0 + 0.6 * abs(driftUv.y)), driftUv.y))
  : length(vec2(driftUv.x * (1.0 + 0.3 * driftUv.y), driftUv.y));
float driftAa = max(fwidth(driftShape), 0.015);
diffuseColor.a *= vDriftAlpha * (1.0 - smoothstep(1.0 - driftAa, 1.0, driftShape));
diffuseColor.rgb *= vDriftColor;
if (diffuseColor.a < 0.003) discard;
`;
const glowFragment = `
float driftRadial = dot(vDriftUv, vDriftUv);
diffuseColor.a *= vDriftAlpha * pow(max(0.0, 1.0 - driftRadial), 2.0);
diffuseColor.rgb *= vDriftColor;
if (diffuseColor.a < 0.003) discard;
`;

function geometry(seeds, glow, debug) {
  const list = seeds.filter(s => (s.kind >= 2) === glow), n = list.length;
  const g = new THREE.InstancedBufferGeometry();
  g.setIndex([0, 1, 2, 0, 2, 3]);
  g.setAttribute('position', new THREE.Float32BufferAttribute([-.5, -.5, 0, .5, -.5, 0, .5, .5, 0, -.5, .5, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  const base = new Float32Array(n * 3), shape = new Float32Array(n * 4), axis = new Float32Array(n * 3), tint = new Float32Array(n * 3);
  // Leaves in the air are thin and catch the light: fresh yellow-green to gold reads against a dark wood, olive did not (real Chrome).
  const palette = [['#9db24a', '#d8b24c'], ['#f3ecdc', '#f0c2bd'], ['#e6dcae', '#f4e9c8'], ['#b9d24a', '#d2e36a']].map(pair => pair.map(c => new THREE.Color(c)));
  const debugColors = ['#28c957', '#ed618b', '#53a5d9', '#c7cf42'].map(c => new THREE.Color(c));
  const color = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const s = list[i];
    base.set([s.x, s.y, s.z], i * 3); shape.set([s.size, s.kind, s.phase, s.roll], i * 4); axis.set([s.ax, s.ay, s.az], i * 3);
    if (debug) color.copy(debugColors[s.kind]); else color.copy(palette[s.kind][0]).lerp(palette[s.kind][1], s.tint);
    color.toArray(tint, i * 3);
  }
  g.setAttribute('aDriftBase', new THREE.InstancedBufferAttribute(base, 3));
  g.setAttribute('aDriftShape', new THREE.InstancedBufferAttribute(shape, 4));
  g.setAttribute('aDriftAxis', new THREE.InstancedBufferAttribute(axis, 3));
  g.setAttribute('aDriftColor', new THREE.InstancedBufferAttribute(tint, 3));
  g.instanceCount = n;
  return g;
}

function material(uniforms, glow) {
  const settings = { color: 0xffffff, side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: true };
  const m = glow ? new THREE.MeshBasicMaterial({ ...settings, blending: THREE.AdditiveBlending }) : new THREE.MeshLambertMaterial(settings);
  // Transparent DoubleSide normally takes two draws; these small cards need one.
  m.forceSinglePass = true;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + vertexPars)
      .replace('#include <begin_vertex>', glow ? glowVertex : organicVertex);
    if (!glow) shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nobjectNormal = kzDriftRotate(objectNormal);');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\n' + fragmentPars)
      .replace('#include <color_fragment>', '#include <color_fragment>\n' + (glow ? glowFragment : organicFragment));
    if (!glow) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      // Modest transmission keeps backlit cards legible while Lambert still receives shadows.
      // Petals are thin and pale: they keep a higher floor than leaves, or they vanish against sunlit grass (real Chrome).
      outgoingLight = min(max(outgoingLight, vDriftColor * (mix(0.16, 0.5, step(0.5, vDriftKind)) + 0.30 * vDriftLight)), vec3(0.9));
      if (uDriftDebug > 0.5) outgoingLight = vDriftColor;
      #include <opaque_fragment>`);
    else shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
      outgoingLight = min(outgoingLight, vec3(0.85));
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => glow ? 'kz-drift-glow-v1' : 'kz-drift-organic-v1';
  return m;
}

// reducedMotion can be injected in Node; the default reads the OS once on creation.
export function createKamakuraDrift(context, options = {}) {
  const q = new URLSearchParams(context.search), requested = q.get('drift');
  if (requested !== null && requested.trim() !== '' && Number(requested) === 0) return null;
  const parsed = Number(requested), multiplier = requested === null || requested.trim() === '' || !Number.isFinite(parsed) ? 1 : Math.max(.25, Math.min(4, parsed));
  const reduced = options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const light = context.quality === 'light', debug = q.get('driftdebug') === '1', debugEnabled = q.get('debug') === '1';
  const seeds = driftSeeds(light ? DRIFT.light : DRIFT.standard);
  const amounts = { leaf: 0, petal: 0, dust: 0, firefly: 0 }, target = { ...amounts }, habitat = {};
  const uniforms = {
    uDriftTime: { value: 0 }, uDriftMotion: { value: reduced ? .5 : 1 }, uDriftWind: { value: 1 },
    uDriftHeight: { value: 720 }, uDriftDir: { value: new THREE.Vector2(1, 0) },
    uDriftViewer: { value: new THREE.Vector3() }, uDriftSun: { value: new THREE.Vector3(0, 1, 0) },
    uDriftAmounts: { value: new THREE.Vector4() }, uDriftDebug: { value: debug ? 1 : 0 },
  };
  const organic = new THREE.Mesh(geometry(seeds, false, debug), material(uniforms, false));
  const glow = new THREE.Mesh(geometry(seeds, true, debug), material(uniforms, true));
  organic.name = 'kamakura-drift-organic'; glow.name = 'kamakura-drift-glow';
  organic.receiveShadow = true;
  organic.castShadow = glow.castShadow = false;
  organic.frustumCulled = glow.frustumCulled = false;
  organic.renderOrder = 5; glow.renderOrder = 6;   // after the river (2) and the splash rings (3, 4): they blend without writing depth and would paint over the air
  context.scene.add(organic, glow);
  const counts = { leaf: 0, petal: 0, dust: 0, firefly: 0 };
  for (const s of seeds) counts[DRIFT_KINDS[s.kind]]++;
  let disposed = false, paused = false, step = 0, sinceSample = DRIFT.sampleSeconds;
  const timeOfDay = atmosphereOptions(context.search).time, viewport = new THREE.Vector2();
  const qualityScale = light ? .75 : 1;
  const applyAmounts = () => {
    const factor = multiplier * qualityScale * (reduced ? .4 : 1) * (step >= 2 ? .6 : 1);
    uniforms.uDriftAmounts.value.set(Math.min(1, amounts.leaf * factor), Math.min(1, amounts.petal * factor), Math.min(1, amounts.dust * factor), Math.min(1, amounts.firefly * factor));
  };
  const inspect = () => ({ counts: { ...counts }, amounts: {
    leaf: uniforms.uDriftAmounts.value.x, petal: uniforms.uDriftAmounts.value.y,
    dust: uniforms.uDriftAmounts.value.z, firefly: uniforms.uDriftAmounts.value.w,
  }, visible: organic.visible });
  if (debugEnabled) globalThis.__kzDrift = inspect;
  return {
    update(frame) {
      if (disposed || paused) return;
      sinceSample += frame.dt;
      if (sinceSample >= DRIFT.sampleSeconds) {
        sinceSample %= DRIFT.sampleSeconds;
        context.habitat.at(frame.pos.x, frame.pos.z, habitat);
        driftAmounts(habitat, timeOfDay, target);
        // From the flying camera a leaf two metres away is a hand-sized card across the view (confetti over the overlook).
        if (frame.flying) { target.leaf *= DRIFT.flyKeep; target.petal *= DRIFT.flyKeep; }
      }
      const blend = 1 - Math.exp(-frame.dt / DRIFT.smoothSeconds);
      amounts.leaf += (target.leaf - amounts.leaf) * blend;
      amounts.petal += (target.petal - amounts.petal) * blend;
      amounts.dust += (target.dust - amounts.dust) * blend;
      amounts.firefly += (target.firefly - amounts.firefly) * blend;
      applyAmounts();
      uniforms.uDriftTime.value = frame.time;
      uniforms.uDriftWind.value = frame.wind;
      uniforms.uDriftDir.value.set(frame.windDir[0], frame.windDir[1]);
      uniforms.uDriftViewer.value.set(frame.pos.x, frame.pos.y, frame.pos.z);
      if (context.sunDir) uniforms.uDriftSun.value.copy(context.sunDir);
      if (context.renderer?.getDrawingBufferSize) {
        context.renderer.getDrawingBufferSize(viewport); uniforms.uDriftHeight.value = viewport.y;
      }
    },
    setAdapt(next) {
      if (disposed) return;
      step = next;
      organic.visible = glow.visible = step < 3;
      applyAmounts();
    },
    setPaused(on) { paused = !!on; },
    debugText() {
      if (disposed) return '';
      const a = uniforms.uDriftAmounts.value;
      return `粒 葉${Math.round(a.x * 100)} 花${Math.round(a.y * 100)} 塵${Math.round(a.z * 100)} 蛍${Math.round(a.w * 100)}${step >= 3 ? ' 停止' : ''}`;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      context.scene.remove(organic, glow);
      organic.geometry.dispose(); organic.material.dispose();
      glow.geometry.dispose(); glow.material.dispose();
      if (globalThis.__kzDrift === inspect) delete globalThis.__kzDrift;
    },
  };
}
