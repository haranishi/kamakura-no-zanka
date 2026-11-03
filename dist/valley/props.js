// props.js — 里・廃寺の小道具（view層）。Meshy で作った井戸・荷車・灯籠・稲架・地蔵・焚き火の石組みと、Drive の柵・薪を、
// world-data の props / dress のとおりに置く。敵の幟（のぼり）は手続きで作り、風でなびかせる。当たりは world-colliders.js が同じ表から作る。
// 置き物・柵・薪・幟は、同じ形をまとめて1回で描く（batch.js。S7-0）。見た目は1つずつ複製していた頃と同じ。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { gradeModel } from './grade.js';
import { placementMatrix, batchParts, mergeIndexed } from './batch.js';

const DIR = new URL('../assets/valley/models/', import.meta.url).href;
// 石の小道具の色のそろえ。地蔵は赤い前掛けを残すので彩度の上限を高く、灯籠の黄色い地衣は強く抑える。
const GRADE = { well: { whiteMax: 0.26, mossFix: 0.65, satMax: 0.6 }, lantern: { whiteMax: 0.28, satMax: 0.42 }, firepit: { whiteMax: 0.3, satMax: 0.5 }, jizo: { whiteMax: 0.34, satMax: 0.85 }, kakashi: { whiteMax: 0.5 }, hokora: { whiteMax: 0.3, blueFix: 1, satMax: 0.5 } };
export const PROP_FILES = ['well', 'cart', 'lantern', 'hasa', 'jizo', 'firepit', 'gatehouse', 'fort', 'barricade', 'wara', 'kakashi', 'hokora'];

export async function loadPropModels({ anisotropy = 8 } = {}) {
  const loader = new GLTFLoader(), out = {};
  await Promise.all(PROP_FILES.map(async name => {
    try {
      const gltf = await loader.loadAsync(DIR + name + '.glb');
      gltf.scene.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = true; o.receiveShadow = true;
        const ms = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of ms) for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = anisotropy;
      });
      gradeModel(gltf.scene, GRADE[name] || { whiteMax: 0.34 });          // 真っ白な石を灰色へ、青い石を暖かい灰色へ、蛍光の苔・黄色い地衣を抑える
      // Meshy のモデルは原点が中心に寄っていることがある。底面の中心を原点に揃えた入れ物に包む（置くとき足もとが地面に付く）
      const box = new THREE.Box3().setFromObject(gltf.scene), c = box.getCenter(new THREE.Vector3());
      gltf.scene.position.set(-c.x, -box.min.y, -c.z);
      const wrap = new THREE.Group(); wrap.name = 'prop-' + name; wrap.add(gltf.scene);
      out[name] = wrap;
    } catch { /* 無くても遊べる。置かないだけ */ }
  }));
  return out;
}

// 幟の布の絵（色と紋）。
function bannerTexture({ color = '#7b1f1a', mark = '#e8dfc6' } = {}) {
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 128, 512);
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 3; for (let i = 0; i < 512; i += 6) { x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
  x.strokeStyle = mark; x.lineWidth = 7; x.beginPath(); x.arc(64, 150, 34, 0, Math.PI * 2); x.stroke();
  x.fillStyle = mark; for (const k of [-1, 0, 1]) x.fillRect(54 + k * 12, 215, 6, 130);
  x.fillStyle = '#e8dfc6'; x.fillRect(0, 0, 128, 10); x.fillRect(0, 502, 128, 10);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  return tex;
}

// 幟（のぼり）。上辺を横木に結び、下ほど風で大きくなびく。竿と横木（同じ木の材質）は1つの形にしてまとめ描き、
// 布は色ごとに1つの形へつなぐ（布は1本ずつ動くので、置き場所の行列でなく頂点を毎コマ書く）。
function buildBanners(list, terrain) {
  const group = new THREE.Group(); group.name = 'banners';
  const placements = list.map(d => placementMatrix(d.x, terrain.heightAt(d.x, d.z), d.z, d.rotY || 0, d.scale || 1));
  const sets = [];
  if (!list.length) return { group, sets };
  const pole = new THREE.CylinderGeometry(0.035, 0.045, 3.6, 8).translate(0, 1.8, 0);
  const bar = new THREE.CylinderGeometry(0.022, 0.022, 0.8, 6).rotateZ(Math.PI / 2).translate(0.4, 3.35, 0);
  const wood = new THREE.Mesh(mergeIndexed([pole, bar]), new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.85 }));
  wood.name = 'banner-wood'; wood.castShadow = true;
  group.add(...batchParts(wood, placements).children);
  const byLook = new Map();
  list.forEach((d, k) => {
    const look = (d.color || '#7b1f1a') + (d.mark || '#e8dfc6');
    if (!byLook.has(look)) byLook.set(look, { d, banners: [] });
    byLook.get(look).banners.push({ x: d.x, z: d.z, matrix: placements[k] });
  });
  for (const { d, banners } of byLook.values()) {
    const plane = new THREE.PlaneGeometry(0.7, 2.6, 4, 12).translate(0.4, 3.3 - 1.3, 0), n = plane.attributes.position.count;
    const geo = mergeIndexed(banners.map(b => plane.clone().applyMatrix4(b.matrix)));
    banners.forEach((b, i) => { b.start = i * n; });
    const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: bannerTexture(d), roughness: 0.95, side: THREE.DoubleSide }));
    cloth.name = 'banner-cloth'; cloth.castShadow = true;
    geo.computeBoundingSphere(); geo.boundingSphere.radius += 0.3;          // なびく分（最大約0.23m）を見込み、画面の端で布だけ消えないようにする
    group.add(cloth); sets.push({ cloth, base: Float32Array.from(plane.attributes.position.array), n, banners });
  }
  return { group, sets };
}

const PROP_KEYS = { well: 'well', cart: 'cart', stone_lantern: 'lantern', drying_rack: 'hasa', bonfire: 'firepit', jizo: 'jizo', haystack: 'wara', scarecrow: 'kakashi', shrine: 'hokora' };

export function buildProps({ world, terrain, models }) {
  const group = new THREE.Group(); group.name = 'props';
  const lights = [];
  const at = (x, z, rotY = 0, scale = 1, lift = 0) => placementMatrix(x, terrain.heightAt(x, z) + lift, z, rotY, scale);
  const place = (obj, x, z, rotY = 0, scale = 1, lift = 0) => {
    obj.position.set(x, terrain.heightAt(x, z) + lift, z); obj.rotation.y = rotY; obj.scale.setScalar(scale); group.add(obj); return obj;
  };
  const cloneOf = key => models[key]?.clone(true);

  // 置き物（Meshy）：種類ごとに1つのまとめ描き
  const yard = new Map();
  for (const p of world.props) {
    const key = PROP_KEYS[p.kind];
    if (!key || !models[key]) continue;
    // 足もとを地面へ。モデルの底（原点）が地面に付く前提で、少し沈めて浮きを防ぐ
    if (!yard.has(key)) yard.set(key, []);
    yard.get(key).push(at(p.x, p.z, p.rotY || 0, p.scale || 1, p.kind === 'shrine' ? -0.06 : -0.04));
    if (p.kind === 'bonfire') {
      const light = new THREE.PointLight(0xffb070, 9, 16, 1.6); light.position.set(p.x, terrain.heightAt(p.x, p.z) + 0.9, p.z); light.castShadow = false; group.add(light); lights.push({ light, base: 9, seed: p.x });
    }
  }
  const yardGroup = new THREE.Group(); yardGroup.name = 'yard-props';
  for (const [key, placements] of yard) yardGroup.add(batchParts(models[key], placements, { name: key }));
  group.add(yardGroup);
  // 遠景（関所・砦・馬防柵）。1つずつで、影の扱いが違うので複製のまま。橋は buildings.js が置く
  for (const d of world.distant || []) {
    const o = ['gatehouse', 'fort', 'barricade'].includes(d.kind) && cloneOf(d.kind);
    if (!o) continue;
    place(o, d.x, d.z, d.rotY || 0, d.scale || 1, d.lift ?? -0.15);
    o.traverse(m => { if (m.isMesh) { m.castShadow = d.kind === 'barricade'; m.receiveShadow = d.kind !== 'fort'; } });
  }
  // 飾り（柵・薪・幟）
  const fences = [], firewood = [], bannerDefs = [];
  for (const d of world.dress || []) {
    if (d.kind === 'fence_line') {
      if (!models.fence) continue;
      const [x0, z0] = d.from, [x1, z1] = d.to, len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5)), rot = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, s = (len / n) / 2.63;
        fences.push(at(x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rot, [s, 0.9, s], -0.05));
      }
    } else if (d.kind === 'firewood') { if (models.firewood) firewood.push(at(d.x, d.z, d.rotY || 0, d.scale || 1.2, -0.03)); }
    else if (d.kind === 'banner') bannerDefs.push(d);
  }
  group.add(batchParts(models.fence, fences, { name: 'fences' }), batchParts(models.firewood, firewood, { name: 'firewood' }));
  const banners = buildBanners(bannerDefs, terrain); group.add(banners.group);
  const v = new THREE.Vector3();
  return {
    group,
    update(time) {
      for (const s of banners.sets) {
        const pos = s.cloth.geometry.attributes.position, base = s.base;
        for (const b of s.banners) {
          for (let i = 0; i < s.n; i++) {
            const y = base[i * 3 + 1], down = Math.max(0, (3.3 - y) / 2.6);      // 上辺は結ばれている。下ほど大きく
            v.set(base[i * 3] - 0.04 * down * Math.sin(time * 1.3 + b.z), y,
              Math.sin(time * 2.1 + down * 3.2 + b.x) * 0.16 * down * down + Math.sin(time * 5.3 + down * 6) * 0.03 * down).applyMatrix4(b.matrix);
            pos.setXYZ(b.start + i, v.x, v.y, v.z);
          }
        }
        pos.needsUpdate = true; s.cloth.geometry.computeVertexNormals();
      }
      for (const l of lights) l.light.intensity = l.base * (0.82 + 0.18 * Math.sin(time * 9 + l.seed) * Math.sin(time * 5.7 + 1.3) + 0.08 * Math.sin(time * 23 + l.seed * 2));
    },
  };
}
