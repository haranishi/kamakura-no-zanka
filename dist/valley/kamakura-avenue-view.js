// Static merged meshes; the frame path only measures distances and changes draw ranges.
import * as THREE from '../vendor/three.module.min.js';
import { addColliderCircles } from './collision.js';
import { AVENUE, avenueEnabled, avenueRange, prepareAvenue, avenueBerm, avenueToriiColor, avenueToriiGeometry } from './kamakura-avenue.js';
export function createKamakuraAvenue(context) {
  if (!avenueEnabled(context.search) || context.data?.sandoNotice) return null;
  const plan = context.data.avenue || prepareAvenue(context.data, { terrain: context.terrain });
  if (!plan) return null;
  const q = new URLSearchParams(context.search), debug = q.get('avenuedebug') === '1', group = new THREE.Group(), resources = [];
  group.name = 'kamakura-avenue';
  const fallback = new THREE.Color(AVENUE.fallbackTorii), pigment = avenueToriiColor(context.data) || [fallback.r, fallback.g, fallback.b];
  const toriiData = avenueToriiGeometry(plan, pigment), bermData = avenueBerm(plan, context.terrain);
  function mesh(buffers, name, color, shadow) {
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(buffers.positions, 3));
    g.setAttribute('color', new THREE.BufferAttribute(buffers.colors, 3)); g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere();
    const settings = { vertexColors: !debug, side: THREE.DoubleSide, fog: !debug };
    const m = debug ? new THREE.MeshBasicMaterial({ ...settings, color, toneMapped: false }) : new THREE.MeshLambertMaterial(settings);
    m.forceSinglePass = true;
    const result = new THREE.Mesh(g, m); result.name = name; result.castShadow = shadow && !debug; result.receiveShadow = !debug;
    group.add(result); resources.push(g, m); return result;
  }
  const torii = mesh(toriiData, 'avenue-torii', AVENUE.debugTorii, true), berm = mesh(bermData, 'avenue-berm', AVENUE.debugBerm, false);
  let markers = null;
  if (debug && plan.pines.length) {
    const g = new THREE.BoxGeometry(AVENUE.markerWidth, AVENUE.markerHeight, AVENUE.markerWidth), m = new THREE.MeshBasicMaterial({ color: AVENUE.debugPine, fog: false, toneMapped: false });
    markers = new THREE.InstancedMesh(g, m, plan.pines.length); markers.name = 'avenue-pines'; markers.frustumCulled = false;
    const dummy = new THREE.Object3D();
    for (let i = 0; i < plan.pines.length; i++) { const p = plan.pines[i]; dummy.position.set(p.x, context.terrain.heightAt(p.x, p.z) + AVENUE.markerHeight / 2, p.z); dummy.updateMatrix(); markers.setMatrixAt(i, dummy.matrix); }
    markers.instanceMatrix.needsUpdate = true; group.add(markers); resources.push(g, m);
  }
  const release = context.colliders ? addColliderCircles(context.colliders, plan.torii.flatMap(t => t.posts)) : null;
  const viewer = new THREE.Vector3(), visible = new Uint8Array(plan.torii.length), distances = new Float64Array(plan.torii.length);
  let step = 0, disposed = false, paused = false, draws = 0, triangles = 0;
  const text = `松 ${plan.pines.length}・鳥居 ${plan.torii.length}`;
  context.scene.add(group);
  const inspect = () => ({
    axis: { length: plan.axis.length, width: plan.axis.width, pieces: plan.axis.pieces },
    pines: { added: plan.pines.length, skipped: { ...plan.skipped } },
    torii: plan.torii.map((t, i) => ({ along: t.along, distance: distances[i], bearing: (Math.atan2(t.x - viewer.x, viewer.z - t.z) * 180 / Math.PI + 360) % 360, visible: !!visible[i] })),
    berm: { length: bermData.length, gaps: bermData.gaps, triangles: bermData.triangles }, draws, triangles,
    work: { distanceChecks: plan.torii.length + 1, ...plan.work }, colliders: release ? plan.torii.length * 2 : 0,
  });
  if (q.get('debug') === '1') globalThis.__kzAvenue = inspect;
  return {
    update(frame) {
      if (disposed || paused) return;
      viewer.copy(frame.camera?.position || context.camera?.position || frame.pos);
      const range = avenueRange(context.quality, step); let first = -1, last = -1;
      triangles = 0; draws = 0;
      for (let i = 0; i < plan.torii.length; i++) {
        const t = plan.torii[i], r = toriiData.ranges[i];
        distances[i] = Math.hypot(t.x - viewer.x, t.y - viewer.y, t.z - viewer.z); visible[i] = distances[i] <= range ? 1 : 0;
        if (visible[i]) { if (first < 0) first = i; last = i; triangles += r.count / 3; }
      }
      torii.visible = first >= 0;
      if (first >= 0) { torii.geometry.setDrawRange(toriiData.ranges[first].start, toriiData.ranges[last].start + toriiData.ranges[last].count - toriiData.ranges[first].start); draws++; }
      berm.visible = bermData.triangles > 0 && berm.geometry.boundingBox.distanceToPoint(viewer) <= range;
      if (berm.visible) { draws++; triangles += bermData.triangles; }
      if (markers) { markers.visible = torii.visible || berm.visible; if (markers.visible) { draws++; triangles += plan.pines.length * 12; } }
    },
    setAdapt(next) { step = Math.max(0, Math.min(3, next)); torii.castShadow = !debug && step < 3; },
    setPaused(on) { paused = !!on; },
    debugText() { return disposed ? '' : text; },
    dispose() {
      if (disposed) return; disposed = true; group.removeFromParent(); release?.(); markers?.dispose();
      for (const r of resources) r.dispose();
      if (globalThis.__kzAvenue === inspect) delete globalThis.__kzAvenue;
    },
  };
}
