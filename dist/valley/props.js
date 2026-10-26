// props.js — 里・廃寺の小道具（view層）。Meshy で作った井戸・荷車・灯籠・稲架・地蔵・焚き火の石組みと、Drive の柵・薪を、
// world-data の props / dress のとおりに置く。敵の幟（のぼり）は手続きで作り、風でなびかせる。当たりの円・箱も同じ表から作る。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const DIR = new URL('../assets/valley/models/', import.meta.url).href;
export const PROP_FILES = ['well', 'cart', 'lantern', 'hasa', 'jizo', 'firepit', 'gatehouse', 'fort', 'barricade'];

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
      // Meshy のモデルは原点が中心に寄っていることがある。底面の中心を原点に揃えた入れ物に包む（置くとき足もとが地面に付く）
      const box = new THREE.Box3().setFromObject(gltf.scene), c = box.getCenter(new THREE.Vector3());
      gltf.scene.position.set(-c.x, -box.min.y, -c.z);
      const wrap = new THREE.Group(); wrap.name = 'prop-' + name; wrap.add(gltf.scene);
      out[name] = wrap;
    } catch { /* 無くても遊べる。置かないだけ */ }
  }));
  return out;
}

// 幅 w・高さ h の幟。上辺を横木に結び、下ほど風で大きくなびく。
function makeBanner({ color = '#7b1f1a', mark = '#e8dfc6' } = {}) {
  const g = new THREE.Group(); g.name = 'banner';
  const wood = new THREE.MeshStandardMaterial({ color: '#4a3a2a', roughness: 0.85 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, 3.6, 8), wood); pole.position.y = 1.8; pole.castShadow = true;
  const bar = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.8, 6), wood); bar.rotation.z = Math.PI / 2; bar.position.set(0.4, 3.35, 0); bar.castShadow = true;
  const c = document.createElement('canvas'); c.width = 128; c.height = 512;
  const x = c.getContext('2d');
  x.fillStyle = color; x.fillRect(0, 0, 128, 512);
  x.strokeStyle = 'rgba(0,0,0,0.25)'; x.lineWidth = 3; for (let i = 0; i < 512; i += 6) { x.beginPath(); x.moveTo(0, i); x.lineTo(128, i); x.stroke(); }
  x.strokeStyle = mark; x.lineWidth = 7; x.beginPath(); x.arc(64, 150, 34, 0, Math.PI * 2); x.stroke();
  x.fillStyle = mark; for (const k of [-1, 0, 1]) x.fillRect(54 + k * 12, 215, 6, 130);
  x.fillStyle = '#e8dfc6'; x.fillRect(0, 0, 128, 10); x.fillRect(0, 502, 128, 10);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const geo = new THREE.PlaneGeometry(0.7, 2.6, 4, 12); geo.translate(0.4, 3.3 - 1.3, 0);
  const cloth = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, roughness: 0.95, side: THREE.DoubleSide }));
  cloth.castShadow = true; cloth.userData.base = Float32Array.from(geo.attributes.position.array);
  g.add(pole, bar, cloth); g.userData.cloth = cloth;
  return g;
}

export function buildProps({ world, terrain, models }) {
  const group = new THREE.Group(); group.name = 'props';
  const banners = [], lights = [];
  const place = (obj, x, z, rotY = 0, scale = 1, lift = 0) => {
    obj.position.set(x, terrain.heightAt(x, z) + lift, z); obj.rotation.y = rotY; obj.scale.setScalar(scale); group.add(obj); return obj;
  };
  const cloneOf = key => models[key]?.clone(true);

  for (const p of world.props) {
    const key = { well: 'well', cart: 'cart', stone_lantern: 'lantern', drying_rack: 'hasa', bonfire: 'firepit', jizo: 'jizo' }[p.kind];
    const o = key && cloneOf(key);
    if (!o) continue;
    // 足もとを地面へ。モデルの底（原点）が地面に付く前提で、少し沈めて浮きを防ぐ
    place(o, p.x, p.z, p.rotY || 0, p.scale || 1, -0.04);
    if (p.kind === 'bonfire') {
      const light = new THREE.PointLight(0xff9a4a, 9, 16, 1.6); light.position.set(p.x, terrain.heightAt(p.x, p.z) + 0.9, p.z); light.castShadow = false; group.add(light); lights.push({ light, base: 9, seed: p.x });
    }
  }
  // 遠景（関所・砦・馬防柵）。橋は buildings.js が置く
  for (const d of world.distant || []) {
    const o = ['gatehouse', 'fort', 'barricade'].includes(d.kind) && cloneOf(d.kind);
    if (!o) continue;
    place(o, d.x, d.z, d.rotY || 0, d.scale || 1, d.lift ?? -0.15);
    o.traverse(m => { if (m.isMesh) { m.castShadow = d.kind === 'barricade'; m.receiveShadow = d.kind !== 'fort'; } });
  }
  // 飾り（柵・薪・幟）
  for (const d of world.dress || []) {
    if (d.kind === 'fence_line') {
      const model = models.fence; if (!model) continue;
      const [x0, z0] = d.from, [x1, z1] = d.to, len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5)), rot = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n, o = model.clone(true), s = (len / n) / 2.63;
        place(o, x0 + (x1 - x0) * t, z0 + (z1 - z0) * t, rot, s, -0.05); o.scale.set(s, 0.9, s);
      }
    } else if (d.kind === 'firewood') { if (models.firewood) place(models.firewood.clone(true), d.x, d.z, d.rotY || 0, d.scale || 1.2, -0.03); }
    else if (d.kind === 'banner') {
      const b = makeBanner(d); place(b, d.x, d.z, d.rotY || 0, d.scale || 1); banners.push(b);
    }
  }
  return {
    group,
    update(time) {
      for (const b of banners) {
        const cloth = b.userData.cloth, pos = cloth.geometry.attributes.position, base = cloth.userData.base;
        for (let i = 0; i < pos.count; i++) {
          const y = base[i * 3 + 1], down = Math.max(0, (3.3 - y) / 2.6);      // 上辺は結ばれている。下ほど大きく
          pos.setZ(i, Math.sin(time * 2.1 + down * 3.2 + b.position.x) * 0.16 * down * down + Math.sin(time * 5.3 + down * 6) * 0.03 * down);
          pos.setX(i, base[i * 3] - 0.04 * down * Math.sin(time * 1.3 + b.position.z));
        }
        pos.needsUpdate = true; cloth.geometry.computeVertexNormals();
      }
      for (const l of lights) l.light.intensity = l.base * (0.82 + 0.18 * Math.sin(time * 9 + l.seed) * Math.sin(time * 5.7 + 1.3) + 0.08 * Math.sin(time * 23 + l.seed * 2));
    },
  };
}

// 小道具・飾りの当たり（円と箱）。buildColliders の extraCircles / extraBoxes へ渡す
export function propColliders(world) {
  const circles = [], boxes = [];
  for (const d of world.dress || []) {
    if (d.kind === 'fence_line') {
      const [x0, z0] = d.from, [x1, z1] = d.to, len = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(len / 2.5)), rot = Math.atan2(-(z1 - z0), x1 - x0);
      for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; boxes.push({ x: x0 + (x1 - x0) * t, z: z0 + (z1 - z0) * t, rotY: rot, w: len / n, d: 0.3, height: 1.2, id: 'fence' }); }
    } else if (d.kind === 'firewood') circles.push({ x: d.x, z: d.z, r: 0.55, height: 0.6, id: 'firewood' });
    else if (d.kind === 'banner') circles.push({ x: d.x, z: d.z, r: 0.12, height: 3.6, id: 'banner' });
  }
  for (const d of world.distant || []) if (d.collider) boxes.push({ x: d.x, z: d.z, rotY: d.rotY || 0, w: d.collider.w, d: d.collider.d, height: d.collider.height, id: d.id });
  return { circles, boxes };
}
