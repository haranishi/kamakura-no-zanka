// relic-view.js — 調べられる物の見た目（view層）。焼け焦げた袖印と、物見の落とした書き付けを、地面に置く小さな板で描く。
// 絵はその場で描く（外の素材は使わない。袖印は無地の布に朱の線。実在の家紋は描かない）。
// 目に留まるよう、上にごく淡い光を置く（明滅は約0.5回/秒。動きを減らす設定では明滅しない）。
import * as THREE from 'three';

function canvas(w, h, draw) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
// 決まった並びの擬似乱数（見た目だけ。毎回同じ焦げ方にする）
const noise = seed => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const clothTexture = () => canvas(128, 160, (g, w, h) => {
  const r = noise(7);
  g.clearRect(0, 0, w, h);
  g.fillStyle = '#d6ccb4'; g.beginPath();
  // 焼けて欠けた縁：四辺を不規則に削る
  const pts = [];
  for (let i = 0; i <= 12; i++) pts.push([8 + (w - 16) * i / 12, 6 + r() * 14]);
  for (let i = 0; i <= 14; i++) pts.push([w - 6 - r() * 16, 8 + (h - 16) * i / 14]);
  for (let i = 12; i >= 0; i--) pts.push([8 + (w - 16) * i / 12, h - 6 - r() * 22]);
  for (let i = 14; i >= 0; i--) pts.push([6 + r() * 10, 8 + (h - 16) * i / 14]);
  g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.closePath(); g.fill();
  g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#a3272066'; g.fillRect(0, h * 0.34, w, h * 0.12);                      // 朱の線（無地の袖印）
  const burn = g.createRadialGradient(w * 0.7, h * 0.85, 4, w * 0.6, h * 0.8, w * 0.9);
  burn.addColorStop(0, '#1a0f0aee'); burn.addColorStop(0.35, '#3b2416aa'); burn.addColorStop(1, '#3b241600');
  g.fillStyle = burn; g.fillRect(0, 0, w, h);
  g.strokeStyle = '#2a1a10cc'; g.lineWidth = 5; g.beginPath(); g.moveTo(...pts[0]); for (const p of pts) g.lineTo(...p); g.closePath(); g.stroke();
});
const paperTexture = () => canvas(128, 96, (g, w, h) => {
  g.fillStyle = '#e8e0cc'; g.fillRect(4, 4, w - 8, h - 8);
  g.strokeStyle = '#3a332c'; g.lineWidth = 3;
  for (let x = w - 24; x > 16; x -= 18) { g.beginPath(); g.moveTo(x, 14); g.lineTo(x + 2, h - 18 - (x % 20)); g.stroke(); }   // 縦書きの墨の行（読めない筆の跡）
  g.strokeStyle = '#b9ad94'; g.lineWidth = 2; g.strokeRect(4, 4, w - 8, h - 8);
});
const glintTexture = () => canvas(64, 64, (g, w) => {
  const grd = g.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
  grd.addColorStop(0, '#fff3d6ff'); grd.addColorStop(0.25, '#ffd9958c'); grd.addColorStop(1, '#ffd99500'); g.fillStyle = grd; g.fillRect(0, 0, w, w);
});

export class RelicView {
  constructor(scene, terrain) {
    this.terrain = terrain; this.group = new THREE.Group(); scene.add(this.group); this.items = new Map();
    this.mats = {
      sode: new THREE.MeshStandardMaterial({ map: clothTexture(), transparent: true, alphaTest: 0.4, roughness: 0.95, side: THREE.DoubleSide }),
      note: new THREE.MeshStandardMaterial({ map: paperTexture(), roughness: 0.9, side: THREE.DoubleSide }),
    };
    this.geos = { sode: new THREE.PlaneGeometry(0.3, 0.38), note: new THREE.PlaneGeometry(0.22, 0.16) };
    this.glintMap = glintTexture();
  }
  make(it) {
    const root = new THREE.Group(), mesh = new THREE.Mesh(this.geos[it.kind], this.mats[it.kind]);
    mesh.rotation.x = -Math.PI / 2 + 0.06; mesh.rotation.z = it.yaw || 0; mesh.position.y = 0.025; mesh.receiveShadow = true;
    const glint = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glintMap, color: 0xffe0a6, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0 }));
    glint.scale.setScalar(0.34); glint.position.y = 0.16;
    root.add(mesh, glint); root.position.set(it.x, this.terrain.heightAt(it.x, it.z), it.z);
    this.group.add(root);
    return { root, glint };
  }
  // list：いま地面にある物 [{ id, kind: 'sode'|'note', x, z, yaw }]。無くなった物は片づける
  update(list, t, camera, reduced) {
    const seen = new Set();
    for (const it of list) {
      seen.add(it.id);
      let v = this.items.get(it.id);
      if (!v || v.x !== it.x || v.z !== it.z) { if (v) this.drop(it.id); v = { ...this.make(it), x: it.x, z: it.z }; this.items.set(it.id, v); }
      const d = camera.position.distanceTo(v.root.position);
      v.glint.material.opacity = d > 22 ? 0 : (reduced ? 0.32 : 0.22 + 0.2 * (0.5 + 0.5 * Math.sin(t * Math.PI))) * Math.min(1, (22 - d) / 6);
    }
    for (const id of [...this.items.keys()]) if (!seen.has(id)) this.drop(id);
  }
  drop(id) { const v = this.items.get(id); if (!v) return; v.root.removeFromParent(); v.glint.material.dispose(); this.items.delete(id); }
}
