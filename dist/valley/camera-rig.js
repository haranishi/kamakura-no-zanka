// camera-rig.js — 肩越しの三人称カメラ（app層）。ばね・遮蔽で手前へ寄せる・ロックオン・命中の揺れと視野角の押し。
// 遮蔽は collision.js の rayClip に任せる。地形や木・壁の裏で主人公を見失わない（requirements 2.4）。
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
const MIN_REACH = 1.35;            // 壁際でもカメラは主人公からこれ以上寄らない（寄ると頭の中が映った）
const LIFT = 1.1;                  // 寄せきれないぶん、カメラを上へ逃がして見下ろす（視線も主人公の頭へ寄せ、画面の端に追いやらない）

export class CameraRig {
  constructor(camera, { fov = 58, distance = 3.6, shoulder = 0.55, height = 1.55 } = {}) {
    this.camera = camera; this.baseFov = fov; this.fovPunch = 0;
    this.yaw = 0; this.pitch = 0.2; this.distance = distance; this.shoulder = shoulder; this.height = height;
    this.focus = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.initialized = false;
    this.shake = 0; this.shakeSeed = 0; this.sensitivity = 1; this.invert = false; this.shakeScale = 1;
    this.lockYaw = null; this.clipped = 1; this.lockBlend = 0; this.lift = 0;
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
    // 狙い固定のあいだは、肩を大きく外し・少し引き・高くして、主人公の陰に敵が隠れないようにする（カメラ・主人公・敵が一直線に並ばない）
    this.lockBlend = damp(this.lockBlend, lockTarget ? 1 : 0, 5, dt);
    // 敵が近いほど肩を大きく外す（2.6m以内で合計約1.6m）。1.05m程度だと、2.8m先の敵の体の7割が主人公の陰に入った（第2周の評価）
    const closeness = lockTarget ? clamp((4.2 - Math.hypot(lockTarget.x - target.x, lockTarget.z - target.z)) / 1.6, 0, 1) : 0;
    const lb = this.lockBlend, dist = this.distance * (1 + 0.18 * lb), shoulder = this.shoulder + (0.5 + 0.55 * closeness) * lb;
    const f = this._f.set(target.x, target.y + this.height, target.z);
    if (!this.initialized) { this.focus.copy(f); this.initialized = true; this.pos.set(0, 0, 0); }
    // 注視点は少し遅れてついてくる（走り出し・停止の揺れを和らげる）
    this.focus.x = damp(this.focus.x, f.x, 16, dt); this.focus.z = damp(this.focus.z, f.z, 16, dt); this.focus.y = damp(this.focus.y, f.y, 9, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const forward = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }, right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const desired = this._d.set(
      this.focus.x - forward.x * cp * dist + right.x * shoulder,
      this.focus.y + sp * dist + 0.25 + 0.25 * lb,
      this.focus.z - forward.z * cp * dist + right.z * shoulder);
    if (groundAt) desired.y = Math.max(desired.y, groundAt(desired.x, desired.z) + 0.55);
    let t = 1;
    if (rayClip) t = rayClip({ x: this.focus.x, y: this.focus.y, z: this.focus.z }, { x: desired.x, y: desired.y, z: desired.z });
    // 寄せる量には下限を置く。詰まったぶんだけカメラを上げ、壁や竿の際でも主人公を見下ろす形にする
    const reach = Math.hypot(desired.x - this.focus.x, desired.y - this.focus.y, desired.z - this.focus.z) || 1, tMin = Math.min(1, MIN_REACH / reach);
    const lift = t < tMin ? (tMin - t) / tMin : 0;
    t = Math.max(t, tMin);
    // 手前へ寄せるときは即座に、戻すときはゆっくり
    this.clipped = t < this.clipped ? t : damp(this.clipped, t, 5, dt);
    this.lift = damp(this.lift, lift, lift > this.lift ? 18 : 4, dt);
    const px = this.focus.x + (desired.x - this.focus.x) * this.clipped, py = this.focus.y + (desired.y - this.focus.y) * this.clipped + this.lift * LIFT, pz = this.focus.z + (desired.z - this.focus.z) * this.clipped;
    this.camera.position.set(px, py, pz);
    // 揺れ（減衰する）
    this.shake = damp(this.shake, 0, 7, dt); this.shakeSeed += dt * 60;
    if (this.shake > 0.002) {
      const s = this.shake * 0.09;
      this.camera.position.x += Math.sin(this.shakeSeed * 1.7) * s; this.camera.position.y += Math.cos(this.shakeSeed * 2.3) * s * 0.7; this.camera.position.z += Math.sin(this.shakeSeed * 1.1 + 2) * s;
    }
    let lx = this.focus.x + right.x * shoulder * 0.4 + forward.x * 2.0, lz = this.focus.z + right.z * shoulder * 0.4 + forward.z * 2.0;
    if (lockTarget) { const m = 0.55 * lb; lx += ((this.focus.x + lockTarget.x) / 2 - lx) * m; lz += ((this.focus.z + lockTarget.z) / 2 - lz) * m; }   // 注視点を主人公と敵のあいだへ
    let ly = this.focus.y - 0.1 - sp * 0.5;
    const toHero = Math.min(1, this.lift) * 0.7;
    if (toHero > 0.001) { lx += (this.focus.x - lx) * toHero; lz += (this.focus.z - lz) * toHero; ly += (this.focus.y - ly) * toHero; }
    this.camera.lookAt(lx, ly, lz);
    this.fovPunch = damp(this.fovPunch, 0, 8, dt);
    const fov = this.baseFov + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}
