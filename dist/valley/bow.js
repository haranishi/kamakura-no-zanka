// bow.js — 弓の構え（view層）。構え〜引き〜放ちのあいだ、弓の向き・弦・つがえた矢を、両手の位置から毎フレーム作る。
// 持ち歩くあいだは、左手の骨に付けた弓がそのまま手についていく（characters.js の attach）。
// 焼き込んだ Archery_Shot は、矢筒から矢を取り（〜1.8s）つがえて引き（〜2.45s）構え続け、4.0s あたりで放つ。その秒を AIM に置く。
import * as THREE from 'three';

export const AIM = { from: 2.0, full: 2.45, release: 4.0, off: 4.35 };
const UP = new THREE.Vector3(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const L = new THREE.Vector3(), R = new THREE.Vector3(), X = new THREE.Vector3(), Y = new THREE.Vector3(), Z = new THREE.Vector3();
const A = new THREE.Vector3(), B = new THREE.Vector3(), M = new THREE.Matrix4(), INV = new THREE.Matrix4(), QW = new THREE.Quaternion(), BQ = new THREE.Quaternion(), QL = new THREE.Quaternion(), ONE = new THREE.Vector3(1, 1, 1), S = new THREE.Vector3();

export class BowRig {
  constructor(character) {
    this.ch = character;
    const w = character.weapons.yumi;
    this.holder = w.holder; this.yumi = w.object; this.yumi.scale.setScalar(0.88);   // 和弓は丈が高い。画面で見切れないよう少し縮める
    this.base = { pos: this.holder.position.clone(), quat: this.holder.quaternion.clone() };
    this.staticString = this.yumi.getObjectByName('string');
    const geo = new THREE.CylinderGeometry(0.0024, 0.0024, 1, 4);
    this.strings = [0, 1].map(() => { const m = new THREE.Mesh(geo, this.staticString.material); m.visible = false; m.matrixAutoUpdate = false; m.frustumCulled = false; character.root.add(m); return m; });
    this.arrow = null; this.t = -1;
  }
  setArrow(object) { this.arrow = object; object.visible = false; object.matrixAutoUpdate = false; this.ch.root.add(object); }

  // 構えの重み（0〜1）。Archery_Shot の再生位置から決める
  weight() {
    const ch = this.ch, a = ch.current;
    this.t = ch.currentName === 'Archery_Shot' && a ? a.time : -1;
    if (this.t < 0) return 0;
    return smooth(AIM.from, AIM.full, this.t) * (1 - smooth(AIM.release, AIM.off, this.t));
  }

  update() {
    const ch = this.ch, w = this.weight();
    if (w < 0.002) { this.rest(); return; }
    ch.model.updateMatrixWorld(true);
    const lb = ch.bone('LeftHand'), rb = ch.bone('RightHand');
    if (!lb || !rb) return;
    lb.getWorldPosition(L); rb.getWorldPosition(R);
    Z.copy(L).sub(R);
    const len = Z.length(); if (len < 0.05) { this.rest(); return; }
    Z.divideScalar(len);                         // 的の向き（弦を引く手 → 弓を持つ手）
    X.crossVectors(UP, Z); if (X.lengthSq() < 1e-6) X.set(1, 0, 0); X.normalize();
    Y.crossVectors(Z, X);                        // 弓の長い軸は上
    // 弓：長い軸 = 上、弦の側（-Z）= 引く手の側。握りは左手の位置
    QW.setFromRotationMatrix(M.makeBasis(X, Y, Z));
    lb.getWorldQuaternion(BQ); QL.copy(BQ).invert().multiply(QW);
    A.copy(L); lb.worldToLocal(A);
    this.holder.position.lerpVectors(this.base.pos, A, w);
    this.holder.quaternion.slerpQuaternions(this.base.quat, QL, w);
    this.holder.updateMatrixWorld(true);
    this.ch.root.updateMatrixWorld(true);
    INV.copy(this.ch.root.matrixWorld).invert();
    // 弦：弓の先から、引く手へ。引く手は弓の握りより少し手前の位置（弦をつまむ所）
    const top = this.yumi.localToWorld(this.yumi.userData.stringTop.clone()), bottom = this.yumi.localToWorld(this.yumi.userData.stringBottom.clone());
    this.staticString.visible = w < 0.35;
    const nockAt = R.clone();
    this.strings.forEach((m, i) => {
      A.copy(i === 0 ? top : bottom); B.copy(nockAt);
      const d = B.clone().sub(A), l = d.length();
      m.visible = w >= 0.35 && l > 0.05;
      if (!m.visible) return;
      QW.setFromUnitVectors(UP, d.divideScalar(l));
      M.compose(A.clone().add(B).multiplyScalar(0.5), QW, S.set(1, l, 1)); m.matrix.copy(INV).multiply(M); m.matrixWorldNeedsUpdate = true;
    });
    // つがえた矢：弦のつまみ位置から的の向きへ。放つ瞬間まで見せる
    if (this.arrow) {
      const on = this.t >= AIM.from + 0.15 && this.t < AIM.release && w >= 0.35;
      this.arrow.visible = on;
      if (on) { QW.setFromUnitVectors(UP, Z); M.compose(nockAt, QW, ONE); this.arrow.matrix.copy(INV).multiply(M); this.arrow.matrixWorldNeedsUpdate = true; }
    }
  }

  rest() {
    this.holder.position.copy(this.base.pos); this.holder.quaternion.copy(this.base.quat);
    this.staticString.visible = true;
    for (const m of this.strings) m.visible = false;
    if (this.arrow) this.arrow.visible = false;
  }

  dispose() { for (const m of this.strings) m.removeFromParent(); this.arrow?.removeFromParent(); }
}
