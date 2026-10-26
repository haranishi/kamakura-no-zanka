// ridges.js — 谷の外に重なる山並み（view層）。地形（±640m）の先に、霧で霞む稜線を3枚、輪にして立てる。
// 空気遠近は installFog の霧が自動でかける（遠いほど霧の色に近づく）。地形より高く見えるよう、稜線は高め。
import * as THREE from 'three';
import { mulberry32 } from './scatter.js';

function ridge({ radius, base, amp, seed, color, cx, cz }) {
  const rnd = mulberry32(seed), N = 360, K = 24, phase = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const profile = i => {
    const a = i / N * Math.PI * 2;
    return base + amp * (0.55 + 0.28 * Math.sin(a * 3 + phase[0]) + 0.18 * Math.sin(a * 7 + phase[1]) + 0.10 * Math.sin(a * 17 + phase[2]) + 0.06 * Math.sin(a * 41 + phase[0] * 2));
  };
  const pos = [], col = [], idx = [], c = new THREE.Color(color);
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius, h = profile(i % N);
    for (let k = 0; k <= 1; k++) {
      pos.push(x, k === 0 ? -120 : h, z);
      const shade = k === 0 ? 0.55 : 1;                    // 麓は暗く、稜線は明るく
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true, depthWrite: true }));
  m.frustumCulled = false; m.renderOrder = -5;
  return m;
}

export function buildRidges({ center = [22, -8] } = {}) {
  const group = new THREE.Group(); group.name = 'ridges';
  const [cx, cz] = center;
  group.add(ridge({ radius: 1050, base: 120, amp: 520, seed: 71, color: '#3d4a62', cx, cz }));
  group.add(ridge({ radius: 1500, base: 200, amp: 760, seed: 73, color: '#52607a', cx, cz }));
  group.add(ridge({ radius: 1950, base: 300, amp: 980, seed: 79, color: '#6b7791', cx, cz }));
  return group;
}
