// buildings.js — 建物・橋・岩・薪などのGLBを読み込み、world-data の配置どおりに置く（view層）。
// 当たりは world-data の足跡（footprint）から collision 側が作る。ここでは見た目だけ。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { patchGrade, gradeModel, makeStrawTexture } from './grade.js';

const DIR = new URL('../assets/valley/models/', import.meta.url).href;
const FILES = ['farmhouse', 'temple', 'bridge', 'fence', 'boulder', 'firewood'];
const EXTRA_FILES = ['dozo', 'naya', 'boulder_lo'];     // boulder_lo: 散らす岩用に三角形を約4割へ減らした版（1.1M→0.45M）            // 里の変化をつける建物（Meshy）。無くても遊べる（農家で代用）
// 水平の最大辺が 1m になるよう縮め、底面の中心を原点に置く。置くときの scale が、そのまま建物の幅（m）になる。
function fitToUnitWidth(scene) {
  const box = new THREE.Box3().setFromObject(scene), size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  scene.position.set(-c.x, -box.min.y, -c.z);
  const wrap = new THREE.Group(); wrap.add(scene); wrap.scale.setScalar(1 / Math.max(size.x, size.z));
  const outer = new THREE.Group(); outer.add(wrap);
  return outer;
}

export async function loadModels({ onProgress, anisotropy = 8 } = {}) {
  const loader = new GLTFLoader();
  const out = {};
  let done = 0;
  await Promise.all([...FILES, ...EXTRA_FILES].map(async name => {
    let gltf;
    try { gltf = await loader.loadAsync(DIR + name + '.glb'); } catch (e) { if (FILES.includes(name)) throw e; onProgress?.(++done / (FILES.length + EXTRA_FILES.length)); return; }
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of mats) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = anisotropy;
    });
    // 岩は暗い青に寄って見えるので、明るく少し暖かい灰色へ寄せる（夕日の下で他の地面と並ぶように）
    if (name === 'boulder' || name === 'boulder_lo') gltf.scene.traverse(o => { if (o.isMesh) { const ms = Array.isArray(o.material) ? o.material : [o.material]; for (const m of ms) { m.color.multiply(new THREE.Color(1.7, 1.55, 1.35)); m.roughness = Math.max(m.roughness ?? 0.9, 0.92); } } });
    if (name === 'farmhouse') {                                         // 草屋根の絵を、わらの束の筋のある絵へ（元はピントの外れた斑）
      const straw = makeStrawTexture(); straw.anisotropy = anisotropy;
      gltf.scene.traverse(o => { if (o.isMesh) for (const m of [].concat(o.material)) if (m.name === 'aged_thatch') { m.map = straw; m.needsUpdate = true; } });
    }
    if (name !== 'boulder' && name !== 'boulder_lo') gradeModel(gltf.scene, name === 'dozo' ? { whiteMax: 0.27, mossFix: 0.8, satMax: 0.7 } : { whiteMax: 0.46 });          // 青い礎石・白い壁の照り・蛍光の苔を、夕景の中で他と並ぶ色へ
    out[name] = EXTRA_FILES.includes(name) && name !== 'boulder_lo' ? fitToUnitWidth(gltf.scene) : gltf.scene;
    onProgress?.(++done / (FILES.length + EXTRA_FILES.length));
  }));
  return out;
}

function groundHeight(terrain, x, z, b) {
  // 足跡の四隅と中心の最低点に合わせる（斜面でも基礎が浮かない）
  let y = terrain.heightAt(x, z);
  if (b?.footprint) {
    const c = Math.cos(b.rotY), s = Math.sin(b.rotY), hw = b.footprint.w / 2, hd = b.footprint.d / 2;
    for (const [u, v] of [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]]) y = Math.min(y, terrain.heightAt(x + u * c + v * s, z - u * s + v * c));
  }
  return y;
}

export function buildBuildings({ world, terrain, models }) {
  const group = new THREE.Group(); group.name = 'buildings';
  const placed = [];
  const place = (key, def, { scale = 1, tint = null, lift = 0 } = {}) => {
    const src = models[key];
    if (!src) return null;
    const obj = src.clone(true);
    obj.position.set(def.x, groundHeight(terrain, def.x, def.z, def) + lift, def.z);
    obj.rotation.y = def.rotY || 0;
    obj.scale.setScalar(scale);
    obj.name = def.id;
    if (tint) obj.traverse(o => { if (o.isMesh) { o.material = o.material.clone(); o.material.color.multiply(new THREE.Color(tint)); patchGrade(o.material, { whiteMax: 0.46 }); } });
    group.add(obj); placed.push(obj);
    return obj;
  };
  const tints = [null, '#e8e0d0', '#d8d2c4'];
  for (const b of world.buildings) {
    if (b.kind === 'temple') place('temple', b, { scale: 1.45 });
    else if (b.kind === 'farmhouse') place('farmhouse', b, { scale: 0.98 + (b.variant || 0) * 0.04, tint: tints[(b.variant || 0) % 3] });
    else if (b.kind === 'granary') { if (models.dozo) place('dozo', b, { scale: 6.4, lift: -0.15 }); else place('farmhouse', b, { scale: 0.82, tint: '#bfae92' }); }
    else if (b.kind === 'naya') { if (models.naya) place('naya', b, { scale: b.width || 6.4, lift: -0.15, tint: '#e8d2a8' }); /* 板壁の青みを、暖かい色の掛け合わせで打ち消す */ else place('farmhouse', b, { scale: 0.7, tint: '#bfae92' }); }
  }
  for (const d of world.distant) {
    if (d.kind === 'bridge') {
      // 橋は川を横切る。両岸の高い方に床を合わせ、足は川の中へ伸びる
      const o = place('bridge', d, { scale: 1 }), sc = d.scale || [2.3, 2.3, 2.3];
      if (o) {
        o.scale.set(sc[0], sc[1], sc[2]);
        const half = 6.06 * sc[0] / 2, ax = [Math.cos(d.rotY), -Math.sin(d.rotY)];
        const ends = [-1, 1].map(k => terrain.heightAt(d.x + ax[0] * half * k * 0.92, d.z + ax[1] * half * k * 0.92));
        o.position.y = Math.max(...ends) - 0.45;
      }
    }
  }
  for (const p of world.props) {
    if (p.kind === 'boulder_big') {
      const o = place('boulder', { ...p, rotY: (p.x * 7.13) % 6.28 }, { scale: (p.vr ?? p.r) * 0.72, lift: -0.35 });
      if (o) { o.scale.y *= 0.8; }
    }
  }
  return { group, placed };
}

// 岩を配置どおりに。空間の区画ごとに InstancedMesh を分け、視錐台の外は描かない（影の描画も同じ）。
export function buildRocks({ data, model, chunk = 48 }) {
  let geometry = null, material = null;
  model.traverse(o => { if (o.isMesh && !geometry) { geometry = o.geometry; material = o.material; } });
  const buckets = new Map();
  for (let i = 0; i < data.x.length; i++) {
    const key = Math.floor(data.x[i] / chunk) + ',' + Math.floor(data.z[i] / chunk);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }
  const group = new THREE.Group(); group.name = 'rocks';
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  for (const idx of buckets.values()) {
    const mesh = new THREE.InstancedMesh(geometry, material, idx.length);
    idx.forEach((i, k) => {
      q.setFromAxisAngle(up, data.rot[i]); s.set(data.s[i] * data.sx[i], data.s[i] * 0.8, data.s[i] * data.sz[i]);
      p.set(data.x[i], data.y[i] - data.sink[i] * data.s[i], data.z[i]);
      m.compose(p, q, s); mesh.setMatrixAt(k, m);
    });
    mesh.instanceMatrix.needsUpdate = true; mesh.castShadow = true; mesh.receiveShadow = true; mesh.frustumCulled = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
  }
  return group;
}
