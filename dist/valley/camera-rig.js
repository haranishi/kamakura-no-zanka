// camera-rig.js — 肩越しの三人称カメラ（app層）。ばね・遮蔽で手前へ寄せる・ロックオン・命中の揺れと視野角の押し。
// 遮蔽は collision.js の rayClip に任せる。地形や木・壁の裏で主人公を見失わない（requirements 2.4）。
import * as THREE from 'three';
import { LOCO } from './loco.js';
import { CAM, spring as springM4, springAsym, trackVelocity, speedFov, clipTarget, softMax } from './camera-follow.js';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * (1 - Math.exp(-rate * dt));
// 臨界減衰のばね（位置と速さを持つ）。1次の遅れ（damp）は、主人公が1コマで止まると、その瞬間にカメラが最大の減速を受けて「がくっ」と止まった
// （走り5m/秒の停止で約70m/秒²）。ばねは止まった瞬間の減速が0から立ち上がり、最大でも ω×速さ÷e。dt によらず厳密に解く（コマの速さで変わらない）。
// s は [位置, 速さ] の2要素。戻り値は新しい位置。
const spring = (s, target, w, dt) => {
  const e = s[0] - target, k = Math.exp(-w * dt), tmp = (s[1] + w * e) * dt;
  s[1] = (s[1] - w * tmp) * k; s[0] = target + (e + tmp) * k;
  return s[0];
};
const FOLLOW_W = 18, FOLLOW_WY = 12;   // 注視点の追従の強さ（1/秒）。走り5m/秒で遅れ約0.56m（前は1次の遅れで0.31m）。上下は段差・斜面をなめらかに
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
    this.fx = [0, 0]; this.fy = [0, 0]; this.fz = [0, 0];   // 注視点のばねの状態（位置・速さ）
    // M4（camera-follow.js）の状態：上下の前段のばね・速さの推定・遮蔽と持ち上げと画角のばね。?smooth=camera では使わない
    this.fy0 = [0, 0]; this.gx = [0, 0]; this.gy = [0, 0]; this.gz = [0, 0]; this.vx = [0, 0]; this.vz = [0, 0]; this.prevT = [0, 0]; this.clipS = [1, 0]; this.clipP = [1, 0]; this.liftS = [0, 0]; this.fovS = [0, 0];
    this._pf = { x: 0, y: 0, z: 0 }; this._pd = { x: 0, y: 0, z: 0 }; this.speedFov = 0;
    this.cfg = CAM;   // 数値の表（検査で一時的に差し替えて、門番が効くことを確かめる）
  }

  kick(amount) { this.shake = Math.min(1.2, this.shake + amount * this.shakeScale); }
  punchFov(deg) { this.fovPunch = Math.max(this.fovPunch, deg * this.shakeScale); }
  snap() { this.initialized = false; }

  update(dt, target, opts = {}) { return LOCO.smoothCamera ? this.updateSmooth(dt, target, opts) : this.updateLegacy(dt, target, opts); }

  // M3 までのカメラ（?smooth=camera・?smooth=off・?loco=old）。記録の指紋が一致するよう、ここは書き換えない
  updateLegacy(dt, target, { lookDx = 0, lookDy = 0, lockTarget = null, rayClip = null, groundAt = null, zoom = 0 } = {}) {
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
    if (!this.initialized) { this.focus.copy(f); this.initialized = true; this.pos.set(0, 0, 0); this.fx[0] = f.x; this.fy[0] = f.y; this.fz[0] = f.z; this.fx[1] = this.fy[1] = this.fz[1] = 0; }
    // 注視点は少し遅れてついてくる（走り出し・停止の揺れを和らげる）。臨界減衰のばねで、止まり・動き出しの加速度を連続にする
    this.focus.x = spring(this.fx, f.x, FOLLOW_W, dt); this.focus.z = spring(this.fz, f.z, FOLLOW_W, dt); this.focus.y = spring(this.fy, f.y, FOLLOW_WY, dt);
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
    const px = this.focus.x + (desired.x - this.focus.x) * this.clipped, py = this.focus.y + (desired.y - this.focus.y) * this.clipped + this.lift * LIFT * (1 - 0.4 * lb), pz = this.focus.z + (desired.z - this.focus.z) * this.clipped;
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
    // 上へ逃げているときは視線を主人公の頭へ寄せる。狙っている敵がいるなら、主人公と敵のあいだへ寄せる（頭だけだと、敵が画面の端へ追いやられた）
    const toHero = Math.min(1, this.lift) * 0.7;
    if (toHero > 0.001) {
      const ax = lockTarget ? (this.focus.x + lockTarget.x) / 2 : this.focus.x, az = lockTarget ? (this.focus.z + lockTarget.z) / 2 : this.focus.z;
      lx += (ax - lx) * toHero; lz += (az - lz) * toHero; ly += (this.focus.y - ly) * toHero;
    }
    this.camera.lookAt(lx, ly, lz);
    this.fovPunch = damp(this.fovPunch, 0, 8, dt);
    const fov = this.baseFov + this.fovPunch;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
  // M4（design-locomotion-camera.md）：見た目のカメラ（位置・注視点・画角）だけをばねで動かす。向き（yaw・pitch）は操作のまま遅らせない
  // （移動の向きは rig.yaw から作るので、ここを遅らせると論理の位置が変わる）。違いは5つ：
  //  ① 注視点の水平は ω15＋ならした速さの先回り ② 上下は2段のばね ③ 遮蔽は0.4秒先の線でも当たりを見て、ばねで先に寄せる（今のコマの当たりは常に守る）
  //  ④ 寄せの戻り・持ち上げを速さの続くばねに、地面からの下限を折れ目のない最大に ⑤ 走りの速さで画角を最大+3度（「画面の揺れ・衝撃」0・「動きを減らす」で広げない）
  updateSmooth(dt, target, { lookDx = 0, lookDy = 0, lockTarget = null, rayClip = null, groundAt = null, zoom = 0, reduced = false } = {}) {
    const k = 0.0024 * this.sensitivity, c = this.cfg;
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
    this.lockBlend = damp(this.lockBlend, lockTarget ? 1 : 0, 5, dt);
    const closeness = lockTarget ? clamp((4.2 - Math.hypot(lockTarget.x - target.x, lockTarget.z - target.z)) / 1.6, 0, 1) : 0;
    const lb = this.lockBlend, dist = this.distance * (1 + 0.18 * lb), shoulder = this.shoulder + (0.5 + 0.55 * closeness) * lb;
    const f = this._f.set(target.x, target.y + this.height, target.z);
    if (!this.initialized) {
      this.focus.copy(f); this.initialized = true; this.pos.set(0, 0, 0);
      this.gx[0] = f.x; this.gy[0] = this.fy0[0] = f.y; this.gz[0] = f.z; this.gx[1] = this.gy[1] = this.gz[1] = this.fy0[1] = 0;
      this.vx[0] = this.vx[1] = this.vz[0] = this.vz[1] = 0; this.prevT[0] = target.x; this.prevT[1] = target.z;
      this.clipS[0] = this.clipP[0] = this.clipped; this.clipS[1] = this.clipP[1] = 0; this.liftS[0] = this.lift; this.liftS[1] = 0; this.fovS[1] = 0;
    }
    trackVelocity(this.vx, this.vz, this.prevT, target.x, target.z, dt, c);
    const vx = this.vx[0], vz = this.vz[0], speed = Math.hypot(vx, vz);
    this.focus.x = springM4(this.gx, f.x + vx * c.lead, c.w, dt); this.focus.z = springM4(this.gz, f.z + vz * c.lead, c.w, dt);
    this.focus.y = springM4(this.gy, springM4(this.fy0, f.y, c.wy1, dt), c.wy2, dt);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const forward = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }, right = { x: Math.cos(this.yaw), z: -Math.sin(this.yaw) };
    const desired = this._d.set(
      this.focus.x - forward.x * cp * dist + right.x * shoulder,
      this.focus.y + sp * dist + 0.25 + 0.25 * lb,
      this.focus.z - forward.z * cp * dist + right.z * shoulder);
    if (groundAt) desired.y = softMax(desired.y, groundAt(desired.x, desired.z) + 0.55, c.floorSoft);
    let t = 1, ahead = null;
    if (rayClip) {
      t = rayClip({ x: this.focus.x, y: this.focus.y, z: this.focus.z }, { x: desired.x, y: desired.y, z: desired.z });
      // 先回り：注視点とカメラを、ならした速さで predict 秒ずらした線でも見る（止まっているときは見ない）
      const ox = vx * c.predict, oz = vz * c.predict;
      if (Math.hypot(ox, oz) > 0.05) {
        const pf = this._pf, pd = this._pd; pf.x = this.focus.x + ox; pf.y = this.focus.y; pf.z = this.focus.z + oz; pd.x = desired.x + ox; pd.y = desired.y; pd.z = desired.z + oz;
        ahead = rayClip(pf, pd);
      }
    }
    const reach = Math.hypot(desired.x - this.focus.x, desired.y - this.focus.y, desired.z - this.focus.z) || 1, tMin = Math.min(1, MIN_REACH / reach);
    const lift = t < tMin ? (tMin - t) / tMin : 0;
    const hard = Math.max(t, tMin);
    // 寄せは速く・戻しはゆっくり（どちらも速さの続くばね）。今のコマの当たりより遠くへは出さない（先回りが外れたときだけ、その分を即座に寄せる）
    springAsym(this.clipS, springM4(this.clipP, clipTarget(hard, ahead, tMin), c.clipPre, dt), c.clipOut, c.clipIn, dt);
    if (this.clipS[0] > hard) { this.clipS[0] = hard; this.clipS[1] = Math.min(0, this.clipS[1]); }
    if (this.clipP[0] > hard) { this.clipP[0] = hard; this.clipP[1] = Math.min(0, this.clipP[1]); }
    if (this.clipS[0] > 1) { this.clipS[0] = 1; this.clipS[1] = 0; }
    this.clipped = this.clipS[0];
    this.lift = Math.max(0, springAsym(this.liftS, lift, c.liftUp, c.liftDown, dt));
    const px = this.focus.x + (desired.x - this.focus.x) * this.clipped, py = this.focus.y + (desired.y - this.focus.y) * this.clipped + this.lift * LIFT * (1 - 0.4 * lb), pz = this.focus.z + (desired.z - this.focus.z) * this.clipped;
    this.camera.position.set(px, py, pz);
    this.shake = damp(this.shake, 0, 7, dt); this.shakeSeed += dt * 60;
    if (this.shake > 0.002) {
      const s = this.shake * 0.09;
      this.camera.position.x += Math.sin(this.shakeSeed * 1.7) * s; this.camera.position.y += Math.cos(this.shakeSeed * 2.3) * s * 0.7; this.camera.position.z += Math.sin(this.shakeSeed * 1.1 + 2) * s;
    }
    let lx = this.focus.x + right.x * shoulder * 0.4 + forward.x * 2.0, lz = this.focus.z + right.z * shoulder * 0.4 + forward.z * 2.0;
    if (lockTarget) { const m = 0.55 * lb; lx += ((this.focus.x + lockTarget.x) / 2 - lx) * m; lz += ((this.focus.z + lockTarget.z) / 2 - lz) * m; }
    let ly = this.focus.y - 0.1 - sp * 0.5;
    const toHero = Math.min(1, this.lift) * 0.7;
    if (toHero > 0.001) {
      const ax = lockTarget ? (this.focus.x + lockTarget.x) / 2 : this.focus.x, az = lockTarget ? (this.focus.z + lockTarget.z) / 2 : this.focus.z;
      lx += (ax - lx) * toHero; lz += (az - lz) * toHero; ly += (this.focus.y - ly) * toHero;
    }
    this.camera.lookAt(lx, ly, lz);
    this.fovPunch = damp(this.fovPunch, 0, 8, dt);
    this.speedFov = springAsym(this.fovS, speedFov(speed, this.shakeScale, reduced, lb, c), c.fovUp, c.fovDown, dt);
    const fov = this.baseFov + this.fovPunch + this.speedFov;
    if (Math.abs(this.camera.fov - fov) > 0.01) { this.camera.fov = fov; this.camera.updateProjectionMatrix(); }
  }
}
