// W2c-16g: spatial selection on 60m movement, shader-only smoke/cloth/fade.
import * as THREE from '../vendor/three.module.min.js';
import { atmosphereOptions } from './kamakura-atmosphere.js';
import { GUST_GLSL } from './kamakura-gust.js';
import { PROPS, PROP_KINDS, propCounts, propRange, propPlacementBatches } from './kamakura-props.js';
import { propGeometry } from './kamakura-props-kit.js';

const vertexPars = `
uniform vec3 uPropViewer;
uniform float uPropRange, uPropTime, uPropMotion, uPropWind, uPropViewport;
uniform vec2 uPropDir;
varying float vPropFade;
${GUST_GLSL}
`;
const glowPixels = `
vec3 propView = (viewMatrix * vec4(propOrigin, 1.0)).xyz;
float propPixels = 0.16 * uPropViewport * 0.5 * projectionMatrix[1][1] / max(0.1, -propView.z);
vPropFade *= smoothstep(1.2, 2.0, propPixels);
`;
const beginVertex = `
vec3 propOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float propDistance = distance(propOrigin.xz, uPropViewer.xz);
vPropFade = 1.0 - smoothstep(uPropRange - ${PROPS.fade.toFixed(1)}, uPropRange, propDistance);
vec3 transformed = vec3(position);
`;
const clothMotion = `
float propFree = clamp((position.x - 0.04) / 0.45, 0.0, 1.0);
float propGust = kzGustBand(propOrigin.xz, uPropTime, uPropDir);
float propBend = propFree * propFree * uPropMotion * uPropWind * (0.07 + 0.26 * propGust);
vec3 propLocalDir = vec3(dot(uPropDir, instanceMatrix[0].xz), 0.0, dot(uPropDir, instanceMatrix[2].xz));
transformed += propLocalDir * propBend;
transformed.z += sin(position.y * 6.0 - uPropTime * 4.0 + propOrigin.x * 0.13) * propFree * 0.045 * uPropMotion;
`;
const smokePars = `
attribute float aPropLayer;
varying vec2 vPropDisc;
varying float vPropSmoke;
`;
const smokeMotion = `
float propSeed = fract(sin(dot(propOrigin.xz, vec2(12.9898, 78.233))) * 43758.5453);
float propLife = fract(aPropLayer + propSeed + uPropTime * 0.065);
float propGust = kzGustBand(propOrigin.xz, uPropTime, uPropDir);
float propRise = propLife * mix(6.0, 14.0, propSeed);
float propDrift = propLife * propLife * (2.0 + 5.0 * propGust) * uPropWind * uPropMotion;
vec3 propRight = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
vec3 propUp = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
float propWidth = 0.35 + propLife * 2.2;
transformed = vec3(uPropDir.x * propDrift, propRise, uPropDir.y * propDrift) + (propRight * position.x + propUp * position.y) * propWidth;
vPropDisc = position.xy * 2.0;
vPropSmoke = smoothstep(0.0, 0.10, propLife) * (1.0 - smoothstep(0.55, 1.0, propLife)) * uPropMotion;
`;
function material(type, uniforms, time) {
  const smoke = type === 'smoke', cloth = type === 'cloth', basic = smoke || type === 'glow' || type === 'debug';
  const settings = { color: smoke ? (time === 'evening' || time === 'golden' ? '#cdb79a' : '#c4c1b8') : 0xffffff, vertexColors: !smoke, fog: true, side: THREE.DoubleSide };
  const m = basic ? new THREE.MeshBasicMaterial({ ...settings, transparent: smoke, opacity: smoke ? .26 : 1, depthWrite: !smoke }) : new THREE.MeshLambertMaterial(settings);
  m.forceSinglePass = true;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + vertexPars + (smoke ? smokePars : ''))
      .replace('#include <begin_vertex>', beginVertex + (smoke ? smokeMotion : cloth ? clothMotion : type === 'glow' ? glowPixels : '') + '\ntransformed *= vPropFade;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vPropFade;\n' + (smoke ? 'varying vec2 vPropDisc; varying float vPropSmoke;\n' : ''))
      .replace('#include <color_fragment>', '#include <color_fragment>\nif (vPropFade < 0.001) discard;\n' + (smoke ? 'diffuseColor.a *= vPropFade * vPropSmoke * pow(max(0.0, 1.0 - dot(vPropDisc, vPropDisc)), 2.0);\nif (diffuseColor.a < 0.001) discard;\n' : ''));
  };
  m.customProgramCacheKey = () => `kz-props-${type}-v1`;
  return m;
}
const definitions = [
  ['lantern', 'lantern', 0], ['gorinto', 'gorinto', 0], ['gorinto', 'gorinto', 1], ['jizo', 'jizo', 0],
  ['nobori', 'pole', 0], ['nobori', 'cloth', 0], ['smoke', 'smoke', 0], ['yard', 'yard', 0], ['yard', 'yard', 1], ['boat', 'boat', 0], ['lantern', 'glow', 0], ['paver', 'paver', 0],
];
export function createKamakuraProps(context, options = {}) {
  const q = new URLSearchParams(context.search), requested = q.get('props');
  if (requested === '0') return null;
  const only = PROP_KINDS.includes(requested) ? requested : null, time = atmosphereOptions(context.search).time;
  const reduced = options.reducedMotion ?? globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  const light = context.quality === 'light', debug = q.get('propsdebug') === '1';
  const job = propPlacementBatches(context, { time, only }), viewer = new THREE.Vector3(), dir = new THREE.Vector2(1, 0), viewport = new THREE.Vector2();
  const shared = { uPropViewer: { value: viewer }, uPropDir: { value: dir }, uPropTime: { value: 0 }, uPropViewport: { value: 720 }, uPropWind: { value: 1 }, uPropMotion: { value: (reduced ? .35 : 1) * (light ? .7 : 1) } };
  const group = new THREE.Group(); group.name = 'kamakura-props'; context.scene.add(group);
  const sets = [], dummy = new THREE.Object3D(), color = new THREE.Color(), visible = propCounts(), buffered = propCounts(), reported = propCounts();
  const selected = [], palette = ['#d59948', '#69b35c', '#d04f46', '#cb674a', '#b8bcc0', '#90745a', '#4d9cbd', '#e12ae8'];
  let result = null, ready = false, disposed = false, paused = false, step = 0, cx = Infinity, cz = Infinity, revisions = 0, text = '';
  function build() {
    const defs = debug ? [...definitions, ['debug', 'debug', 0]] : definitions;
    for (const [kind, type, variant] of defs) {
      if (kind !== 'debug' && only && kind !== only) continue;
      if (type === 'glow' && time !== 'evening' && time !== 'golden') continue;
      let capacity = 0;
      for (const p of result.items) if (kind === 'debug' && (p.kind !== 'paver' || p.row % 20 === 1 && p.col === 0) || p.kind === kind && (!['gorinto', 'yard'].includes(kind) || p.variant === variant)) capacity++;
      if (!capacity) continue;
      const g = propGeometry(type, variant), uniforms = { ...shared, uPropRange: { value: propRange(kind, context.quality, step) } }, m = material(type, uniforms, time);
      if (type === 'paver' && debug) m.vertexColors = false;
      if (type === 'glow') { m.color.setScalar(time === 'golden' ? .42 : 1.2); }
      const mesh = new THREE.InstancedMesh(g, m, capacity); mesh.count = 0; mesh.name = `kamakura-props-${type}-${variant}`;
      mesh.frustumCulled = false; mesh.castShadow = !['cloth', 'smoke', 'glow', 'debug', 'paver'].includes(type); mesh.receiveShadow = !['smoke', 'glow', 'debug'].includes(type);
      mesh.renderOrder = type === 'smoke' ? 1 : 0; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // Shrinking distant silhouettes must shrink their shadows by the same amount.
      if (mesh.castShadow) {
        mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
        mesh.customDepthMaterial.onBeforeCompile = shader => {
          Object.assign(shader.uniforms, uniforms);
          shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\n' + vertexPars).replace('#include <begin_vertex>', beginVertex + '\ntransformed *= vPropFade;');
        };
        mesh.customDepthMaterial.customProgramCacheKey = () => 'kz-props-depth-v1';
      }
      group.add(mesh); sets.push({ kind, type, variant, mesh, uniforms, triangles: (g.index?.count ?? g.attributes.position.count) / 3 });
    }
  }
  function select(pos) {
    cx = pos.x; cz = pos.z; revisions++; selected.length = 0;
    for (const s of sets) s.mesh.count = 0;
    for (const k of PROP_KINDS) buffered[k] = 0;
    // Sorting happens only on the 60m boundary, never in the steady-state frame path.
    const nearby = result.items.slice().sort((a, b) => (a.x - cx) ** 2 + (a.z - cz) ** 2 - (b.x - cx) ** 2 - (b.z - cz) ** 2);
    let triangles = 0;
    for (const p of nearby) {
      if (step >= 3 && (p.kind === 'smoke' || p.kind === 'yard')) continue;
      if (Math.hypot(p.x - cx, p.z - cz) > propRange(p.kind, context.quality, step) + PROPS.refresh) continue;
      let cost = 0;
      for (const s of sets) if (s.kind === 'debug' && (p.kind !== 'paver' || p.row % 20 === 1 && p.col === 0) || s.kind === p.kind && (!['gorinto', 'yard'].includes(p.kind) || s.variant === p.variant)) cost += s.triangles;
      // Paving has its own 9,000-slab cap; it must not displace the existing 60k-triangle props.
      if (p.kind !== 'paver') { if (triangles + cost > PROPS.triangles) continue; triangles += cost; }
      selected.push(p); buffered[p.kind]++;
      for (const s of sets) {
        if (s.kind === 'debug' && p.kind === 'paver' && !(p.row % 20 === 1 && p.col === 0)) continue;
        if (s.kind !== 'debug' && (s.kind !== p.kind || ['gorinto', 'yard'].includes(p.kind) && s.variant !== p.variant)) continue;
        dummy.position.set(p.x, p.y, p.z); dummy.rotation.set(p.tiltX, p.yaw, p.tiltZ, 'YXZ'); dummy.scale.setScalar(p.scale);
        if (s.type === 'paver') dummy.scale.set(p.w, 1, p.d);
        dummy.updateMatrix();
        s.mesh.setMatrixAt(s.mesh.count, dummy.matrix);
        if (s.kind === 'debug') color.set(palette[PROP_KINDS.indexOf(p.kind)]);
        else if (s.type === 'paver') {
          if (debug) color.set('#e12ae8');
          // The instance colour multiplies the slab's own grey. Parent (real Chrome): a moss colour written here as a colour of
          // its own came out near black (a grey-green times a grey), and one edge slab in six read as a hole in the paving.
          // A tint relative to the stone instead: less red and blue, a little more green. The first tint (.75, 1.06, .65)
          // then read as whole slabs painted green, in a checker with the grey ones; moss is a cast on the stone, so it is weaker.
          // A second review (real Chrome, a temple court in the low sun): slabs from .8 to 1.14 of the stone's grey, the mossy ones
          // greener still, read as a board of coloured squares. The wear is a narrower spread now, and the moss a fainter cast.
          else if (p.edge && p.age < .3) color.setRGB(.94, 1, .86).multiplyScalar(.93 + p.age * .14);
          else color.setScalar(.9 + p.age * .16);   // each slab its own wear
        }
        else if (s.type === 'cloth') color.set(p.variant ? '#a84734' : '#e0d8c5');
        else color.setScalar(.9 + p.age * .2);
        s.mesh.setColorAt(s.mesh.count++, color);
      }
    }
    for (const s of sets) { s.mesh.instanceMatrix.needsUpdate = true; if (s.mesh.instanceColor) s.mesh.instanceColor.needsUpdate = true; }
    text = ''; // Rebuilt lazily by debugText, outside the steady frame path.
  }
  // Debug only, computed on call: the closest prop of each kind, its bearing (degrees clockwise from north) and screen position (0–1).
  const nearest = () => {
    const out = {}, at = new THREE.Vector3(), seaAt = context.terrain?.seaDistanceAt;
    for (const p of result?.items || []) {
      const d = Math.hypot(p.x - viewer.x, p.z - viewer.z);
      if (out[p.kind] && out[p.kind].distance <= d) continue;
      const bearing = ((Math.atan2(p.x - viewer.x, -(p.z - viewer.z)) * 180 / Math.PI) + 360) % 360;
      let screen = null;
      if (context.camera) { at.set(p.x, p.y + .8, p.z).project(context.camera); if (at.z < 1) screen = [+((at.x + 1) / 2).toFixed(3), +((1 - at.y) / 2).toFixed(3)]; }
      out[p.kind] = { distance: +d.toFixed(1), bearing: +bearing.toFixed(0), screen, facing: +(((180 - p.yaw * 180 / Math.PI) % 360 + 360) % 360).toFixed(0), sea: seaAt ? +(+seaAt(p.x, p.z)).toFixed(1) : null, seaward: seaAt ? +(((Math.atan2(seaAt(p.x - 10, p.z) - seaAt(p.x + 10, p.z), seaAt(p.x, p.z + 10) - seaAt(p.x, p.z - 10)) * 180 / Math.PI) + 360) % 360).toFixed(0) : null };
    }
    return out;
  };
  const nearestSando = () => {
    let nearest = null;
    for (const [id, line] of Object.entries(context.data?.sando || {})) for (let i = 1; i < line.xyz_m.length; i++) {
      const a = line.xyz_m[i - 1], b = line.xyz_m[i], dx = b[0] - a[0], dz = a[1] - b[1];
      const t = Math.max(0, Math.min(1, ((viewer.x - a[0]) * dx + (viewer.z + a[1]) * dz) / (dx * dx + dz * dz)));
      const x = a[0] + t * dx, z = -a[1] + t * dz, distance = Math.hypot(x - viewer.x, z - viewer.z);
      if (!nearest || distance < nearest.distance) nearest = { id, kind: 'sando', distance, bearing: (Math.atan2(x - viewer.x, viewer.z - z) * 180 / Math.PI + 360) % 360 };
    }
    return nearest;
  };
  const inspect = () => ({ placed: { ...(result?.placed || propCounts()) }, skipped: { ...(result?.skipped || propCounts()) }, visible: { ...visible }, buffered: { ...buffered }, ready, revisions, nearestSando: nearestSando(), nearest: nearest() });
  if (q.get('debug') === '1') globalThis.__kzProps = inspect;
  return {
    update(frame) {
      if (disposed || paused) return;
      // Bounded startup work: a facility, one path, 64 houses, or one boat search per frame.
      if (!ready) {
        // A few milliseconds of placement per frame: one step per frame took seconds to fill the town.
        const start = performance.now(); let next;
        do { next = job.next(); result = next.value; } while (!next.done && performance.now() - start < PROPS.budget);
        if (!next.done) return;
        ready = true; build();
      }
      viewer.set(frame.pos.x, frame.pos.y, frame.pos.z); dir.set(frame.windDir[0], frame.windDir[1]);
      shared.uPropTime.value = frame.time; shared.uPropWind.value = frame.wind;
      if (context.renderer?.getDrawingBufferSize) { context.renderer.getDrawingBufferSize(viewport); shared.uPropViewport.value = viewport.y; }
      if (Math.hypot(frame.pos.x - cx, frame.pos.z - cz) >= PROPS.refresh) select(frame.pos);
      for (const k of PROP_KINDS) visible[k] = 0;
      for (const p of selected) if (Math.hypot(p.x - frame.pos.x, p.z - frame.pos.z) < propRange(p.kind, context.quality, step)) visible[p.kind]++;
    },
    setAdapt(next) {
      if (disposed) return; step = Math.max(0, Math.min(3, next)); cx = Infinity;
      for (const s of sets) s.uniforms.uPropRange.value = propRange(s.kind, context.quality, step);
    },
    setPaused(on) { paused = !!on; },
    debugText() {
      if (disposed) return '';
      if (!ready) return '物 配置中';
      let changed = !text;
      for (const k of PROP_KINDS) if (reported[k] !== visible[k]) { changed = true; reported[k] = visible[k]; }
      if (changed) text = `物 灯${visible.lantern} 塔${visible.gorinto} 蔵${visible.jizo} 幟${visible.nobori} 煙${visible.smoke} 薪${visible.yard} 舟${visible.boat} 敷石${visible.paver}`;
      return text;
    },
    dispose() {
      if (disposed) return; disposed = true; job.return(); group.removeFromParent();
      for (const s of sets) { s.mesh.dispose(); s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.mesh.customDepthMaterial?.dispose(); }
      if (globalThis.__kzProps === inspect) delete globalThis.__kzProps;
    },
  };
}
