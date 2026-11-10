// W2c-18i: three instanced batches x near/far (craft variants share a flagged rig); shared instance matrices limit motion to eight writes.
import * as THREE from '../vendor/three.module.min.js';
import { HARBOR, harborEnabled, harborRange, harborNear, harborKeep, harborMotion, harborPlacementBatches } from './kamakura-harbor.js';
import { HARBOR_ART, harborGeometry } from './kamakura-harbor-kit.js';

export const HARBOR_VERTEX_PARS = `
attribute float aHarborRank, aHarborBundle, aHarborBundleVertex;
attribute float aHarborRig, aHarborRigVertex;
uniform vec3 uHarborViewer;
uniform float uHarborNear, uHarborRange, uHarborKeep, uHarborFar;
uniform vec2 uHarborViewport;
uniform float uHarborRack;
varying float vHarborShown, vHarborNearWeight;
`;
export const HARBOR_BEGIN_VERTEX = `
vec3 transformed = vec3(position);
vec3 harborOrigin = (modelMatrix * instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
float harborDistance = distance(harborOrigin, uHarborViewer);
float harborNearSide = 1.0 - smoothstep(uHarborNear - ${ (HARBOR.lodBlend/2).toFixed(1) }, uHarborNear + ${ (HARBOR.lodBlend/2).toFixed(1) }, harborDistance);
vHarborNearWeight = harborNearSide;
vHarborShown = (1.0 - step(uHarborKeep, aHarborRank)) * step(harborDistance, uHarborRange);
vHarborShown *= step(0.000001, mix(harborNearSide, 1.0 - harborNearSide, uHarborFar));
transformed *= vHarborShown;
if (aHarborBundleVertex > 0.5 && aHarborBundle < 0.5) transformed = vec3(0.0);
if (aHarborRigVertex > 0.5 && aHarborRig < 0.5) transformed = vec3(0.0);
`;
export const HARBOR_PIXEL_VERTEX = `
// Expand only the far transverse silhouette in screen space, including edge-on hulls.
// Near/far masks share camera distance even in the light's depth pass.
if (uHarborFar > 0.5 && vHarborShown > 0.5) {
  vec4 harborAxis = modelViewMatrix * instanceMatrix * vec4(1.0, 0.0, 0.0, 0.0);
  vec4 harborCentre = viewMatrix * vec4(harborOrigin, 1.0);
  float harborDepth = max(0.1, -harborCentre.z);
  vec2 harborPixelAxis = vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * harborAxis.xy * uHarborViewport * 0.5 / harborDepth;
  float harborWidthPx = length(harborPixelAxis);
  float harborExtraPx = max(0.0, ${HARBOR.minPixels.toFixed(1)} - harborWidthPx);
  gl_Position.x += position.x * harborExtraPx * 2.0 / uHarborViewport.x * gl_Position.w;
  if (uHarborRack > 0.5) {
    vec4 harborUp = modelViewMatrix * instanceMatrix * vec4(0.0, 1.0, 0.0, 0.0);
    vec2 harborPixelUp = vec2(projectionMatrix[0][0], projectionMatrix[1][1]) * harborUp.xy * uHarborViewport * 0.5 / harborDepth;
    float harborExtraHeight = max(0.0, ${HARBOR.minPixels.toFixed(1)} - length(harborPixelUp) * ${HARBOR.rackHeight.toFixed(1)});
    gl_Position.y += (position.y / ${HARBOR.rackHeight.toFixed(1)} - 0.5) * harborExtraHeight * 2.0 / uHarborViewport.y * gl_Position.w;
  }
}
`;
function insert(source, hook, addition, replace = false) {
  if (!source.includes(hook)) throw new Error(`Harbor shader hook missing: ${hook}`);
  return source.replace(hook, replace ? addition : hook + '\n' + addition);
}
export function installHarborShader(material, uniforms, pixels = false) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = insert(shader.vertexShader, '#include <common>', HARBOR_VERTEX_PARS);
    shader.vertexShader = insert(shader.vertexShader, '#include <begin_vertex>', HARBOR_BEGIN_VERTEX, true);
    if (pixels) shader.vertexShader = insert(shader.vertexShader, '#include <project_vertex>', HARBOR_PIXEL_VERTEX);
    shader.fragmentShader = insert(shader.fragmentShader, '#include <common>', 'varying float vHarborShown, vHarborNearWeight; uniform float uHarborFar;');
    const hook = material.isMeshDepthMaterial ? '#include <clipping_planes_fragment>' : '#include <color_fragment>';
    shader.fragmentShader = insert(shader.fragmentShader, hook, `if (vHarborShown < 0.5) discard;
// Complementary opaque masks cross-fade geometry without transparent sorting or a brightness step.
float harborPattern = mod(floor(gl_FragCoord.x) + floor(gl_FragCoord.y) * 4.0, 16.0) / 16.0;
if (uHarborFar < 0.5) { if (harborPattern >= vHarborNearWeight) discard; }
else if (harborPattern < vHarborNearWeight) discard;`);
  };
  material.customProgramCacheKey = () => `kz-harbor-${pixels ? 'far' : 'near'}-${material.type}-1`;
}
const A = HARBOR_ART;
export function createKamakuraHarbor(context) {
  if (!harborEnabled(context.search)) return null;
  const query = new URLSearchParams(context.search), debug = query.get('harbordebug') === '1';
  const group = new THREE.Group(); group.name = 'kamakura-harbor'; context.scene.add(group);
  const viewer = new THREE.Vector3(), viewport = new THREE.Vector2(HARBOR.viewportWidth, HARBOR.viewportHeight);
  const shared = { uHarborViewer: { value: viewer }, uHarborViewport: { value: viewport }, uHarborNear: { value: harborNear(context.quality) },
    uHarborRange: { value: harborRange(context.quality) }, uHarborKeep: { value: harborKeep(context.quality) } };
  const job = harborPlacementBatches(context), sets = [], dummy = new THREE.Object3D(), color = new THREE.Color();
  const drawn = { near: 0, far: 0, triangles: 0, draws: 0, matrixWrites: 0, distanceTests: 0, shadowDraws: 0, drawsWithShadows: 0 };
  let result = null, ready = false, started = false, disposed = false, paused = false, step = 0, clock = 0, text = '';
  function matrix(p, mesh, index) {
    const pose = p.afloat ? p.pose : p;
    dummy.position.set(pose.x, pose.y, pose.z); dummy.rotation.set(pose.tiltX || 0, pose.yaw, pose.tiltZ || 0, 'YXZ');
    dummy.scale.set(p.kind === 'port' ? 1 : p.w, 1, p.kind === 'port' ? 1 : p.kind === 'rack' ? 1 : p.d);
    dummy.updateMatrix(); mesh.setMatrixAt(index, dummy.matrix);
  }
  function build() {
    const definitions = ['craft','rack','port'];
    for (const kind of definitions) {
      let items = result.items.filter(p => kind === 'craft' ? p.kind === 'beach' || p.kind === 'harbour' || p.kind === 'sail' : p.kind === kind);
      if (kind === 'port' && result.infra.length) {
        const anchor = result.infra[0];
        items = [{ kind: 'port', x: anchor.x, y: anchor.y, z: anchor.z, yaw: 0, w: 1, d: 1, brightness: 1, rank: 0 }];
      }
      if (!items.length) continue;
      const rank = new THREE.InstancedBufferAttribute(Float32Array.from(items,p => p.rank),1);
      const bundle = new THREE.InstancedBufferAttribute(Float32Array.from(items,p => +!!p.bundle),1);
      const rig = new THREE.InstancedBufferAttribute(Float32Array.from(items,p => +(p.kind === 'sail')),1);
      let nearMesh = null;
      for (let lod = 0; lod < 2; lod++) {
        const far = lod === 1, g = harborGeometry(kind,far,result.infra);
        if (!g.attributes.position.count) { g.dispose(); continue; }
        if (kind === 'port') { const at = items[0]; g.translate(-at.x,-at.y,-at.z); }
        g.setAttribute('aHarborRank',rank); g.setAttribute('aHarborBundle',bundle); g.setAttribute('aHarborRig',rig);
        const settings = { color: 0xffffff, vertexColors: !debug, fog: !debug, side: THREE.DoubleSide, toneMapped: !debug };
        const material = debug ? new THREE.MeshBasicMaterial(settings) : new THREE.MeshLambertMaterial(settings);
        material.forceSinglePass = true;
        const uniforms = { ...shared, uHarborFar: { value: lod }, uHarborRack: { value: +(kind === 'rack') } };
        installHarborShader(material,uniforms,far && kind !== 'port');
        const mesh = new THREE.InstancedMesh(g,material,items.length);
        mesh.name = `kamakura-harbor-${kind}-${far?'far':'near'}`;
        mesh.frustumCulled = false; mesh.castShadow = !far; mesh.receiveShadow = true; mesh.visible = false;
        if (!far) {
          mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); nearMesh = mesh;
          mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
          installHarborShader(mesh.customDepthMaterial,uniforms);
        } else mesh.instanceMatrix = nearMesh.instanceMatrix;
        for (let i=0;i<items.length;i++) {
          const p = items[i];
          if (p.afloat && !p.pose) p.pose = { x: p.x, y: p.y, z: p.z, yaw: p.yaw, tiltX: 0, tiltZ: 0 };
          if (!far) matrix(p,mesh,i);
          if (debug) color.set(p.kind === 'beach' ? A.beachDebug : p.kind === 'rack' ? A.rackDebug : p.kind === 'sail' ? A.sailDebug : A.portDebug).multiplyScalar(far ? A.farDebugGain : 1);
          else color.setScalar(p.brightness);
          mesh.setColorAt(i,color);
        }
        mesh.instanceMatrix.needsUpdate = true; mesh.instanceColor.needsUpdate = true;
        group.add(mesh); sets.push({ kind, far, mesh, items, triangles: g.attributes.position.count/3 });
      }
    }
    let near = 0, far = 0;
    for (const s of sets) { if (s.far) far += s.triangles*s.items.length; else near += s.triangles*s.items.length; }
    if (near > HARBOR.nearTriangles || far > HARBOR.farTriangles || sets.length > HARBOR.draws) throw new Error('Harbor geometry budget exceeded');
    const info = inspect(); text = `浜舟 ${info.boats.beach}・枠 ${info.racks}・帆 ${info.boats.sail}`;
  }
  function inspect() {
    const boats = { beach: 0, harbour: 0, sail: 0 }; let racks = 0, nearest = null;
    for (const p of result?.items || []) {
      if (p.kind === 'rack') racks++; else boats[p.kind]++;
      const at = p.afloat && p.pose ? p.pose : p, distance = Math.hypot(at.x-viewer.x,at.y-viewer.y,at.z-viewer.z);
      if (!nearest || distance < nearest.distance) nearest = { kind: p.kind, distance, bearing: (Math.atan2(at.x-viewer.x,viewer.z-at.z)*180/Math.PI+360)%360 };
    }
    for (const p of result?.infra || []) {
      if (p.kind==='rope') continue;
      const distance=Math.hypot(p.x-viewer.x,p.y-viewer.y,p.z-viewer.z);
      if (!nearest || distance<nearest.distance) nearest={kind:p.kind,distance,bearing:(Math.atan2(p.x-viewer.x,viewer.z-p.z)*180/Math.PI+360)%360};
    }
    return { boats, racks, pier: result?.infra.filter(p=>p.kind==='pier').length || 0, hut: result?.infra.filter(p=>p.kind==='hut').length || 0,
      groups: result?.groups.length || 0, drawn: { ...drawn }, nearest, skipped: { ...result?.skipped }, work: { ...result?.work }, ready };
  }
  if (query.get('debug') === '1') globalThis.__kzHarbor = inspect;
  return {
    update(frame) {
      if (disposed || paused) return;
      // The factory does no placement work. Let the world display once before starting the job.
      if (!started) { started = true; return; }
      if (!ready) {
        const start = performance.now(); let next;
        do { next = job.next(); result = next.value; } while (!next.done && performance.now()-start < HARBOR.budget);
        if (!next.done) return;
        build(); ready = true;
      }
      const camera = frame.camera || context.camera, pos = camera?.position || frame.pos;
      viewer.set(pos.x,pos.y,pos.z);
      context.renderer?.getDrawingBufferSize?.(viewport);
      clock = Number.isFinite(frame.time) ? frame.time : clock + frame.dt;
      drawn.near = 0; drawn.far = 0; drawn.triangles = 0; drawn.draws = 0; drawn.matrixWrites = 0; drawn.distanceTests = 0; drawn.shadowDraws = 0; drawn.drawsWithShadows = 0;
      for (const s of sets) {
        let count = 0, moved = false;
        for (let i=0;i<s.items.length;i++) {
          const p = s.items[i];
          if (!s.far && p.afloat) { harborMotion(p,clock,p.pose); matrix(p,s.mesh,i); moved = true; drawn.matrixWrites++; }
          const at = p.afloat ? p.pose : p;
          const distance = Math.hypot(at.x-viewer.x,at.y-viewer.y,at.z-viewer.z);
          drawn.distanceTests++;
          const inLod = s.far ? distance > shared.uHarborNear.value-HARBOR.lodBlend/2 : distance < shared.uHarborNear.value+HARBOR.lodBlend/2;
          if (p.rank < shared.uHarborKeep.value && distance <= shared.uHarborRange.value && inLod) count++;
        }
        if (moved) s.mesh.instanceMatrix.needsUpdate = true;
        s.mesh.visible = count > 0;
        if (s.far) drawn.far += count; else drawn.near += count;
        if (count) { drawn.draws++; if (s.mesh.castShadow) drawn.shadowDraws++; drawn.triangles += s.triangles*s.mesh.count; }
      }
      drawn.drawsWithShadows = drawn.draws + drawn.shadowDraws;
    },
    setAdapt(value) {
      if (disposed) return;
      step = Math.max(0,Math.min(3,value));
      shared.uHarborNear.value = harborNear(context.quality,step); shared.uHarborRange.value = harborRange(context.quality,step); shared.uHarborKeep.value = harborKeep(context.quality,step);
    },
    setPaused(on) { paused = !!on; },
    debugText() {
      if (disposed) return '';
      if (!ready) return '浜舟 配置中';
      return text;
    },
    dispose() {
      if (disposed) return; disposed = true; job.return(); group.removeFromParent();
      for (const s of sets) { s.mesh.dispose(); s.mesh.geometry.dispose(); s.mesh.material.dispose(); s.mesh.customDepthMaterial?.dispose(); }
      if (globalThis.__kzHarbor === inspect) delete globalThis.__kzHarbor;
    },
  };
}
