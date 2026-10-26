// fx.js — 粒子表現（火花・衝撃の光・土煙・焚き火の火の粉・煙・落ち葉）と、刃の軌跡（view層）。
// 粒子はCPUで更新する小さな点群2つ（加算／通常）。血の表現は使わず、火花と光と土煙で重さを出す（requirements 6.5）。
import * as THREE from 'three';

class PointCloud {
  constructor(max, additive) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 600 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute vec4 aColor; attribute float aSize; varying vec4 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = smoothstep(1.0, 0.0, r); a *= a; gl_FragColor = vec4(vC.rgb, vC.a * a); }',
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = additive ? 5 : 4;
    this.geometry = g;
  }

  emit(p) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set(p.pos, i * 3); this.vel.set(p.vel || [0, 0, 0], i * 3);
    this.life[i] = p.life; this.age[i] = 0; this.grav[i] = p.gravity ?? 0; this.drag[i] = p.drag ?? 0;
    this.s0[i] = p.size; this.s1[i] = p.sizeEnd ?? p.size; this.a0[i] = p.alpha ?? 1;
    this.base.set(p.color, i * 3);
    this.col.set([p.color[0], p.color[1], p.color[2], this.a0[i]], i * 4); this.size[i] = this.s0[i];
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.count;
        if (i !== j) this.move(j, i);
        continue;
      }
      const t = this.age[i] / this.life[i], k = i * 3, drag = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag + this.grav[i] * dt; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      this.col[i * 4] = this.base[k]; this.col[i * 4 + 1] = this.base[k + 1]; this.col[i * 4 + 2] = this.base[k + 2]; this.col[i * 4 + 3] = this.a0[i] * Math.max(0, fade);
      i++;
    }
    this.geometry.setDrawRange(0, this.count);
    for (const a of ['position', 'aColor', 'aSize']) this.geometry.attributes[a].needsUpdate = true;
  }

  move(from, to) {
    for (const [arr, n] of [[this.pos, 3], [this.vel, 3], [this.base, 3], [this.col, 4]]) for (let c = 0; c < n; c++) arr[to * n + c] = arr[from * n + c];
    for (const arr of [this.life, this.age, this.grav, this.drag, this.s0, this.s1, this.a0, this.size]) arr[to] = arr[from];
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

export class FX {
  constructor(scene) {
    this.add = new PointCloud(1800, true); this.norm = new PointCloud(1600, false);
    scene.add(this.add.points, this.norm.points);
    this.trails = [];
  }

  // 刃が当たった所の火花と光。dir は当たった向き（x,z）
  hit(pos, dir, { strong = false, blocked = false } = {}) {
    const n = blocked ? 12 : strong ? 18 : 10;
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2, sp = rnd(2.5, blocked ? 8 : 6.5), up = rnd(0.5, 3.5);
      this.add.emit({ pos: [pos.x, pos.y, pos.z], vel: [Math.cos(a) * sp + dir.x * 2, up, Math.sin(a) * sp + dir.z * 2], life: rnd(0.18, 0.42), size: rnd(0.05, 0.1), sizeEnd: 0.01, color: blocked ? [1.0, 0.9, 0.6] : [1.0, 0.62, 0.22], alpha: 1, gravity: -7, drag: 1.5 });
    }
    this.add.emit({ pos: [pos.x, pos.y, pos.z], vel: [0, 0, 0], life: 0.09, size: strong ? 1.1 : 0.7, sizeEnd: 0.2, color: blocked ? [1.0, 0.95, 0.8] : [1.0, 0.8, 0.5], alpha: 0.85 });
  }

  // 受け流し（弾き）の鋭い光
  parry(pos) {
    this.add.emit({ pos: [pos.x, pos.y, pos.z], vel: [0, 0, 0], life: 0.14, size: 1.6, sizeEnd: 0.3, color: [1, 1, 0.9], alpha: 1 });
    for (let i = 0; i < 16; i++) { const a = Math.random() * Math.PI * 2; this.add.emit({ pos: [pos.x, pos.y, pos.z], vel: [Math.cos(a) * 7, rnd(-1, 3), Math.sin(a) * 7], life: 0.3, size: 0.06, sizeEnd: 0.01, color: [1, 0.95, 0.7], gravity: -4 }); }
  }

  dust(pos, amount = 3, tint = [0.62, 0.52, 0.4]) {
    for (let i = 0; i < amount; i++) this.norm.emit({ pos: [pos.x + rnd(-0.15, 0.15), pos.y + 0.05, pos.z + rnd(-0.15, 0.15)], vel: [rnd(-0.4, 0.4), rnd(0.3, 0.9), rnd(-0.4, 0.4)], life: rnd(0.5, 0.9), size: 0.25, sizeEnd: 0.8, color: tint, alpha: 0.3, drag: 1.2 });
  }

  ember(pos) {
    this.add.emit({ pos: [pos.x + rnd(-0.25, 0.25), pos.y + 0.2, pos.z + rnd(-0.25, 0.25)], vel: [rnd(-0.25, 0.25), rnd(0.6, 1.6), rnd(-0.25, 0.25)], life: rnd(0.9, 2.2), size: rnd(0.04, 0.08), sizeEnd: 0.005, color: [1.0, rnd(0.4, 0.65), 0.1], alpha: 0.95, drag: 0.3 });
  }
  flame(pos) {
    this.add.emit({ pos: [pos.x + rnd(-0.18, 0.18), pos.y + 0.1, pos.z + rnd(-0.18, 0.18)], vel: [rnd(-0.12, 0.12), rnd(0.9, 1.6), rnd(-0.12, 0.12)], life: rnd(0.35, 0.7), size: rnd(0.32, 0.5), sizeEnd: 0.05, color: [1.0, rnd(0.45, 0.7), 0.12], alpha: 0.55, drag: 0.5 });
  }
  smoke(pos) {
    this.norm.emit({ pos: [pos.x, pos.y, pos.z], vel: [rnd(0.1, 0.5), rnd(0.7, 1.2), rnd(-0.2, 0.2)], life: rnd(3, 5.5), size: 0.5, sizeEnd: 2.8, color: [0.55, 0.55, 0.56], alpha: 0.22, drag: 0.2 });
  }

  update(dt, camera, viewportHeight) {
    const scale = viewportHeight * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    this.add.uniforms.uScale.value = this.norm.uniforms.uScale.value = scale;
    this.add.update(dt); this.norm.update(dt);
  }
}
