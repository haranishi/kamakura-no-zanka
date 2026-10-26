// camera-rig.js — 肩越しの三人称カメラ（app層）。ばね・遮蔽で手前へ寄せる・ロックオン・命中の揺れと視野角の押し。
// 遮蔽は collision.js の rayClip に任せる。地形や木・壁の裏で主人公を見失わない（requirements 2.4）。
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));

export class CameraRig {
  constructor(camera, { fov = 58, distance = 3.6, shoulder = 0.55, height = 1.55 } = {}) {
    this.camera = camera; this.baseFov = fov; this.fovPunch = 0;
    this.yaw = 0; this.pitch = 0.2; this.distance = distance; this.shoulder = shoulder; this.height = height;
    this.focus = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.initialized = false;
    this.shake = 0; this.shakeSeed = 0; this.sensitivity = 1; this.invert = false; this.shakeScale = 1;
    this.lockYaw = null; this.clipped = 1;
    this._f = new THREE.Vector3(); this._d = new THREE.Vector3();
  }

  kick(amount) { this.shake = Math.min(1.2, this.shake + amount * this.shakeScale); }
  punchFov(deg) { this.fovPunch = Math.max(this.fovPunch, deg * this.shakeScale); }
  snap() { this.initialized = false; }

  update(dt, target, { lookDx = 0, lookDy = 0, lockTarget = null, rayClip = null, groundAt = null, zoom = 0 } = {}) {
    const k = 0.0024 * this.sensitivity;
    if (lockTarget) {
      const want = Math.atan2(-(lockTarget.x - target.x), -(lockTarget.z - target.z));
      let diff = want - this.yaw; diff = Math.atan2(Math.sin(diff), Math.cos(diff));
      this.yaw += diff * (1 - Math.exp(-7 * dt)) - lookDx * k * 0.35;
      this.pitch = damp(this.pitch, 0.16, 4, dt);
    } else {
      this.yaw -= lookDx * k;
      this.pitch = clamp(this.pitch + lookDy * k * (this.invert ? -1 : 1), -0.5, 1.0);
    }
    this.distance = clamp(this.distance + zoom * 0.002, 2.4, 6.0);
    const f = this._f.set(target.x, target.y + this.height, target.z);
    if (!this.initialized) { this.focus.copy(f); this.initialized = true; this.pos.set(0, 0, 0); }
    // 注視点は少し遅れてついてくる（走り出し・停止の揺れを和らげる）
    this.focus.x = damp(this.focus.x, f.x, 16, dt); this.focus.z = damp(this.focus.z, f.z, 16, dt); this.focus.y = damp(this.focus.y, f.y, 9, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const forward = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }, right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const desired = this._d.set(
      this.focus.x - forward.x * cp * this.distance + right.x * this.shoulder,
      this.focus.y + sp * this.distance + 0.25,
      this.focus.z - forward.z * cp * this.distance + right.z * this.shoulder);
    if (groundAt) desired.y = Math.max(desired.y, groundAt(desired.x, desired.z) + 0.55);
    let t = 1;
    if (rayClip) t = rayClip({ x: this.focus.x, y: this.focus.y, z: this.focus.z }, { x: desired.x, y: desired.y, z: desired.z });
    // 手前へ寄せるときは即座に、戻すときはゆっくり
    this.clipped = t < this.clipped ? t : damp(this.clipped, t, 5, dt);
    const px = this.focus.x + (desired.x - this.focus.x) * this.clipped, py = this.focus.y + (desired.y - this.focus.y) * this.clipped, pz = this.focus.z + (desired.z - this.focus.z) * this.clipped;
    this.camera.position.set(px, py, pz);
    // 揺れ（減衰する）
    this.shake = damp(this.shake, 0, 7, dt); this.shakeSeed += dt * 60;
    if (this.shake > 0.002) {
      const s = this.shake * 0.09;
      this.camera.position.x += Math.sin(this.shakeSeed * 1.7) * s; this.camera.position.y += Math.cos(this.shakeSeed * 2.3) * s * 0.7; this.camera.position.z += Math.sin(this.shakeSeed * 1.1 + 2) * s;
    }
    this.camera.lookAt(this.focus.x + right.x * this.shoulder * 0.4 + forward.x * 2.0, this.focus.y - 0.1 - sp * 0.5, this.focus.z + right.z * this.shoulder * 0.4 + forward.z * 2.0);
    this.fovPunch = damp(this.fovPunch, 0, 8, dt);
    const fov = this.baseFov + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}
