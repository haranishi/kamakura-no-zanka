// life-view.js — 谷の暮らしの小物を置き、場面と選択で出し入れする（S7-A・view層）。
// 置く表は world-data.js の life、型は life-kit.js、出す物と状態は life-rules.js の lifeScene（game.js が配る）。
// 型ごとに batchParts で1回描き、出し入れは1つずつ（BatchedMesh.setVisibleAt）。描画の呼び出しは型の数で決まり、場面では増えない。
// 小さい物（足半・椀・菜・草むらなど）は、カメラから25mより遠くでは描かない（軽量15m）。俵・柵・板碑・ススキ・烏は遠くから読ませるので消さない。
import * as THREE from 'three';
import { batchParts } from './batch.js';
import { buildLifeKit, buildMarks } from './life-kit.js';
import { lifeItem } from './life-rules.js';

export const NEAR_SMALL = { standard: 25, light: 15 };
const MOSS = '#a3b088';                 // 苔の石の色（大岩の模型の色に掛ける）
const ROCK = { w: 2.9, l: 2.1, h: 1.48 };   // 大岩の模型（boulder_lo）の幅・奥行き・高さ（m）

// show（{ item, state?, min?, max? }）が、いまの場面で成り立つか。場面がまだ無いときは、show の無い物だけを出す。
export function shows(show, scene) {
  if (!show) return true;
  const it = scene ? lifeItem(scene, show.item) : null;
  if (!it || !it.show) return false;
  if (show.state && !show.state.includes(it.state)) return false;
  if (show.min != null && it.count < show.min) return false;
  if (show.max != null && it.count > show.max) return false;
  return true;
}

// 表の小石・草むら・ススキ（[x, z, 大きさ, 向き]）を、物の一覧と同じ形にする。
export function lifeEntries(life) {
  const out = (life.items || []).filter(d => d.kind !== 'hit');
  (life.stones || []).forEach(([x, z, s, r], i) => out.push({ id: 'stone_' + i, kind: 'stone', x, z, rotY: r, scale: [s, s * 0.7, s], lift: -ROCK.h * s * 0.7 * 0.3, tint: i % 3 === 0 ? MOSS : '#ffffff', bright: 1.45, small: true }));   // 小石は大岩の色のままだと夕日の逆光で黒い塊に見えたので明るくする
  (life.tufts || []).forEach(([x, z, s, r], i) => out.push({ id: 'tuft_' + i, kind: 'tuft', x, z, rotY: r, scale: s }));
  (life.susuki || []).forEach(([x, z, s, r], i) => out.push({ id: 'susuki_' + i, kind: 'susuki', x, z, rotY: r, scale: s }));
  return out;
}

export function buildLifeView({ world, terrain, models = {}, quality = () => 'standard' }) {
  const group = new THREE.Group(); group.name = 'life';
  const L = world.life;
  if (!L) return { group, apply() {}, update() {} };
  const kit = buildLifeKit();
  const e = new THREE.Euler(), q = new THREE.Quaternion(), qa = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), n = new THREE.Vector3(), p = new THREE.Vector3(), s = new THREE.Vector3();
  // 置き場所の行列：傾き（tilt）を物の向きの中で掛けてから、向き（rotY）で回す。align（0〜1）は、その割合だけ斜面の向きに合わせる。
  const matrixOf = d => {
    e.set(d.tilt?.[0] || 0, d.rotY || 0, d.tilt?.[1] || 0, 'YXZ'); q.setFromEuler(e);
    if (d.align) { const t = terrain.normalAt(d.x, d.z); n.set(t.x, t.y, t.z).lerp(up, 1 - d.align).normalize(); q.premultiply(qa.setFromUnitVectors(up, n)); }
    p.set(d.x, terrain.heightAt(d.x, d.z) + (d.lift || 0), d.z);
    const sc = d.scale ?? 1; if (Array.isArray(sc)) s.set(sc[0], sc[1], sc[2]); else s.setScalar(sc);
    return new THREE.Matrix4().compose(p, q, s);
  };
  const modelOf = kind => kit.models[kind] || (kind === 'stone' ? models.boulder_lo || models.boulder : kind === 'fence' ? models.fence : null) || null;

  // 1 物：型ごとに1つのまとめ描き。インスタンスの番号＝一覧の順。
  const entries = lifeEntries(L), byKind = new Map();
  for (const d of entries) { if (!byKind.has(d.kind)) byKind.set(d.kind, []); byKind.get(d.kind).push(d); }
  const sets = [];
  for (const [kind, list] of byKind) {
    const model = modelOf(kind);
    if (!model) continue;
    const colors = list.some(d => d.tint) ? list.map(d => new THREE.Color(d.tint || '#ffffff').multiplyScalar(d.bright || 1)) : null;
    const g = batchParts(model, list.map(matrixOf), { name: kind, colors });
    group.add(g);
    sets.push({ kind, meshes: g.children, list, small: list.map(d => d.small ?? kit.info[kind]?.small === true), state: list.map(d => !d.show), on: list.map(() => true) });
  }
  // 2 地面の跡と、小物の足もとの暗い円（積んだ物・立てかけた物には敷かない）
  const blobs = [];
  for (const d of entries) {
    if ((d.lift || 0) > 0.2) continue;
    const k = Array.isArray(d.scale) ? d.scale[0] : d.scale ?? 1, b = d.kind === 'stone' ? [ROCK.w * 1.15, ROCK.l * 1.15] : kit.info[d.kind]?.blob;
    if (b) blobs.push({ mark: 'blob', x: d.x, z: d.z, w: b[0] * k, l: b[1] * k, rotY: d.rotY || 0, show: d.show });
  }
  const marks = buildMarks([...(L.marks || []), ...blobs], terrain, kit.materials.marks);
  for (const m of marks) group.add(m.mesh);
  // 3 烏（見5）：南の棚田の上を回る。結末（to_peak）では烏峰の方へ去り、見えなくなったら描かない。
  let crows = null;
  if (L.crows) {
    const g = batchParts(kit.models.crow, Array.from({ length: L.crows.count }, () => new THREE.Matrix4()), { name: 'crows' });
    g.children[0].frustumCulled = false;                                                        // 群れは動くので、まとめの外枠では切らない（1羽ずつは切る）
    group.add(g); crows = { c: L.crows, mesh: g.children[0], ground: terrain.heightAt(L.crows.x, L.crows.z), leaveAt: null, gone: 0 };
  }

  let scene = null, time = 0, lastQuality = null;
  const lastCam = new THREE.Vector3(1e9, 0, 1e9);
  // 出す・出さないを1つずつ決める：場面で出す物で、小さい物はカメラに近いときだけ。
  function refresh(cam) {
    const far = NEAR_SMALL[quality()] ?? NEAR_SMALL.standard;
    for (const st of sets) st.list.forEach((d, k) => {
      const on = st.state[k] && (!st.small[k] || !cam || Math.hypot(d.x - cam.x, d.z - cam.z) < far);
      if (on !== st.on[k]) { st.on[k] = on; for (const m of st.meshes) m.setVisibleAt(k, on); }
    });
  }
  const cm = new THREE.Matrix4(), ce = new THREE.Euler(), cq = new THREE.Quaternion(), cp = new THREE.Vector3(), one = new THREE.Vector3(1, 1, 1);
  function flyCrows(t) {
    const { c, mesh, ground } = crows;
    let cx = c.x, cz = c.z;
    if (crows.leaveAt != null) { const k = Math.max(0, t - crows.leaveAt) * 9, dx = c.peak[0] - c.x, dz = c.peak[1] - c.z, d = Math.hypot(dx, dz) || 1; cx += dx / d * k; cz += dz / d * k; crows.gone = k; }
    for (let i = 0; i < c.count; i++) {
      const dir = i % 5 === 0 ? -1 : 1;                                                         // 5羽に1羽は逆回り（群れの乱れ）
      const a = dir * t * (0.3 + 0.08 * Math.sin(i * 2.3)) + i * 2.399, r = c.r * (0.5 + 0.5 * Math.abs(Math.sin(i * 1.7))) * (1 - Math.min(0.6, crows.gone / 300));
      cp.set(cx + Math.cos(a) * r, ground + c.y + Math.sin(t * 0.5 + i) * 2.5 + (i % 3) * 1.6 + crows.gone * 0.08, cz + Math.sin(a) * r);
      const tx = -Math.sin(a) * dir, tz = Math.cos(a) * dir;                                    // 進む向き（円の接線）。内へ少し傾ける
      ce.set(-0.3 * dir, Math.atan2(-tz, tx), 0, 'YXZ'); cq.setFromEuler(ce);
      mesh.setMatrixAt(i, cm.compose(cp, cq, one));
    }
    if (crows.gone > 320) mesh.visible = false;
  }

  // 場面（lifeScene の戻り値）を受けて、出す物を決め直す。
  function apply(next) {
    scene = next;
    for (const st of sets) st.list.forEach((d, k) => { st.state[k] = shows(d.show, scene); });
    for (const m of marks) m.mesh.visible = shows(m.show, scene);
    if (crows) {
      const it = scene ? lifeItem(scene, 'crows') : null, leaving = it?.state === 'to_peak';
      if (leaving && crows.leaveAt == null) crows.leaveAt = time;
      if (!leaving) { crows.leaveAt = null; crows.gone = 0; }
      crows.mesh.visible = !it || it.show;
    }
    refresh(lastCam.x < 1e8 ? lastCam : null);
  }
  apply(null);

  return {
    group, apply, refresh,
    // 毎コマ：草の揺れ（草木と同じ風）・燠の明滅・烏。カメラが1m動くか品質が変わったら、小さい物の出し入れを決め直す。
    update(t, camera, wind) {
      time = t;
      const u = kit.uniforms;
      u.sway.uTime.value = wind ? wind.uTime.value : t; u.sway.uWind.value = wind ? wind.uWind.value : 1; u.flap.uTime.value = t;
      kit.materials.ember.emissiveIntensity = 1.0 + 0.35 * Math.sin(t * 2.1) * Math.sin(t * 3.7 + 1.2) + 0.12 * Math.sin(t * 13);
      if (crows && crows.mesh.visible) flyCrows(t);
      const qn = quality();
      if (camera && (camera.position.distanceToSquared(lastCam) > 1 || qn !== lastQuality)) { lastCam.copy(camera.position); lastQuality = qn; refresh(lastCam); }
    },
    debug: { sets, marks, crows, kit },
  };
}
