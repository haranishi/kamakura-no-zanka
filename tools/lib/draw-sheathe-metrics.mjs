// 抜刀・納刀の層（sword-layer.js → sword-rig.js）の、毎コマの測定。ページ内で評価する（createMetrics.toString() を渡す）。
// 層だけを駆動する regress-draw-sheathe.mjs と、実ゲームの主人公を通す regress-draw-sheathe-game.mjs が共用する。
// 層の内部の診断は使わず、描画に使う骨と物体の世界行列から測る:
//   握りの誤差・刃の鞘への収まり・刀と右手の跳び・腕の長さ・表示の食い違い・値の健全性・層のあとの骨の戻り・向きの混ぜの危険な境界

// 合格の目安（design-draw-sheathe.md の「合否」。見た目の最終確認は本人）
export const LIMITS = {
  gripPosMm: 15, gripAngDeg: 6, coaxMm: 7.5, roomMm: 0.5, armLenMm: 1, popRatio: 3.0, popFloorM: 0.04, popFloorRad: 0.25, leakRad: 1e-3,
};

// 1コマだけ飛び抜けた動き（隣のコマの動きの何倍か）。速い抜刀の速さそのものは違反にしない。steps は null（見えないコマ）を含む。
export function popScore(steps, floor) {
  let worst = 0, at = -1;
  steps.forEach((v, i) => {
    if (v == null || v <= floor) return;
    const near = Math.max(steps[i - 1] ?? 0, steps[i + 1] ?? 0, floor / LIMITS.popRatio);
    if (v / near > worst) { worst = v / near; at = i; }
  });
  return { worst, at };
}

// ---- ここから下は、ページ内で評価される（外の変数を使わない）
export async function createMetrics() {
  const THREE = await import('three');
  const { bladeHalfSection } = await import('/valley/sword-path.js');
  const { Matrix4, Vector3, Quaternion } = THREE;
  const sayaZ = y => { const t = (y - 0.17) / 0.78; return 0.018 * 4 * t * (1 - t); };
  const bladeZ = y => { const t = (y - 0.16) / 0.72; return 0.018 * 4 * t * (1 - t); };
  const finite = a => a.every(Number.isFinite);
  const BLADE_PTS = Array.from({ length: 49 }, (_, i) => { const y = 0.16 + 0.72 * i / 48; return new Vector3(0, y, bladeZ(y)); });
  const armLen = ch => ['Right', 'Left'].map(s => {
    const a = ch.bone(s + 'Arm').getWorldPosition(new Vector3()), f = ch.bone(s + 'ForeArm').getWorldPosition(new Vector3()), h = ch.bone(s + 'Hand').getWorldPosition(new Vector3());
    return [a.distanceTo(f), f.distanceTo(h)];
  });

  // 1人の人物の測定を始める。sample(out) を毎コマ（人物の update のあとに）呼ぶ。out = { u, mode, pose }（sword-layer の tick の戻りと同じ形）
  return function newRun(ch) {
    const len0 = armLen(ch);
    const R = { n: 0, nan: 0, vis: 0, unreached: 0, maxIkErrMm: 0, maxGripMm: 0, maxGripDeg: 0, maxCoaxMm: 0, minRoomMm: 1e9, wallHits: 0, maxArmDevMm: 0, maxRollDeg: 0, liveFrames: 0, stepPos: [], stepRot: [], stepHand: [], stepHandRot: [], liveFlags: [], trace: [] };
    let prevSword = null, prevSwordQ = null, prevHand = null, prevHandQ = null, prevShown = false;
    return {
      R,
      sample(out) {
        R.n++;
        const drawn = ch.weapons.tachiDrawn.holder, hipHolder = ch.weapons.tachiHip.holder, hipHilt = ch.weapons.tachiHipHilt.object, hand = ch.bone('RightHand');
        ch.root.updateMatrixWorld(true);
        // 表示：u>0 は手の刀だけ、u=0 は腰の柄だけ（u=1 も手の刀だけ）
        const swordShown = drawn.visible, hiltShown = hipHilt.visible;
        if (out.u > 0 ? !(swordShown && !hiltShown) : !(!swordShown && hiltShown)) R.vis++;
        const sw = new Vector3().setFromMatrixPosition(drawn.matrixWorld), sq = new Quaternion().setFromRotationMatrix(drawn.matrixWorld);
        const hp = new Vector3().setFromMatrixPosition(hand.matrixWorld), hq = new Quaternion().setFromRotationMatrix(hand.matrixWorld);
        if (!finite([...sw.toArray(), ...sq.toArray(), ...hp.toArray()])) R.nan++;
        const live = out.u > 0 && out.u < 1;
        if (live) R.liveFrames++;
        const onAxis = live && out.pose.handBlend <= 0;
        // 握りの誤差（鞘の上にある間＝手の枠の定位置から見た差）
        if (onAxis && out.pose.ikRight >= 0.99) {
          const grip = hand.matrixWorld.clone().multiply(new Matrix4().compose(ch.sword.home.drawn.position, ch.sword.home.drawn.quaternion, ch.sword.home.drawn.scale));
          const gp = new Vector3().setFromMatrixPosition(grip), gq = new Quaternion().setFromRotationMatrix(grip);
          R.maxGripMm = Math.max(R.maxGripMm, gp.distanceTo(sw) * 1000);
          R.maxGripDeg = Math.max(R.maxGripDeg, gq.angleTo(sq) * 180 / Math.PI);
          const ik = ch.sword.lastIk.Right;
          if (ik && !ik.reached) R.unreached++;
          if (ik) R.maxIkErrMm = Math.max(R.maxIkErrMm, ik.error * 1000);
        }
        // 刃と鞘：鞘の枠から見た刃の中心線と断面
        if (live) {
          const rel = hipHolder.matrixWorld.clone().invert().multiply(drawn.matrixWorld);
          let coax = 0, wall = false;
          for (const p of BLADE_PTS) {
            const q = p.clone().applyMatrix4(rel);
            if (q.y < 0.17 || q.y > 0.95) continue;
            const lateral = Math.hypot(q.x, q.z - sayaZ(q.y)), h = bladeHalfSection(p.y), ext = Math.hypot(h.halfThickness, h.halfWidth);
            if (onAxis) coax = Math.max(coax, lateral);
            const room = 0.0225 - Math.hypot(Math.abs(q.x) + h.halfThickness, Math.abs(q.z - sayaZ(q.y)) + h.halfWidth);
            if (lateral + ext <= 0.0225) R.minRoomMm = Math.min(R.minRoomMm, room * 1000);        // 管の中に収まっている点の余裕
            if (lateral - ext < 0.0225 && lateral + ext > 0.0225 - 0.0005) wall = true;           // 断面が管の壁をまたぐ（収まりきらない）
          }
          if (onAxis) R.maxCoaxMm = Math.max(R.maxCoaxMm, coax * 1000);
          if (wall) R.wallHits++;
        }
        // 連続性（刀は、前のコマでも見えていたときだけ。見え始めのコマの位置の違いは、見えない物体の移動）
        if (prevSword && prevShown && swordShown) { const d = sw.distanceTo(prevSword), a = sq.angleTo(prevSwordQ); R.stepPos.push(d); R.stepRot.push(a); } else { R.stepPos.push(null); R.stepRot.push(null); }
        R.liveFlags.push(live);
        R.stepHand.push(prevHand ? hp.distanceTo(prevHand) : null); R.stepHandRot.push(prevHandQ ? hq.angleTo(prevHandQ) : null);
        prevSword = sw; prevSwordQ = sq; prevHand = hp; prevHandQ = hq; prevShown = swordShown;
        // 腕の長さ
        const len = armLen(ch);
        for (let a = 0; a < 2; a++) for (let b = 0; b < 2; b++) R.maxArmDevMm = Math.max(R.maxArmDevMm, Math.abs(len[a][b] - len0[a][b]) * 1000);
        R.maxRollDeg = ch.sword.diag.maxRollDeg;
        R.trace.push([R.n - 1, +out.u.toFixed(3), ...sw.toArray().map(x => +x.toFixed(3)), ...hp.toArray().map(x => +x.toFixed(3)), (live && ch.sword.lastIk.Right) ? +(ch.sword.lastIk.Right.error * 1000).toFixed(1) : -1, swordShown ? 1 : 0]);
      },
      // 層のあとの骨の戻り：層を使わない同じ人物 ctl（あれば）と、全骨の向きが一致するか。動作の補間は単位化しないので、単位化してから比べる
      finish(ctl) {
        let leak = 0, leakBone = null;
        if (ctl) {
          ch.root.updateMatrixWorld(true); ctl.root.updateMatrixWorld(true);
          for (const [n, b] of ch.bones) { const c = ctl.bones.get(n); if (!c) continue; const a = b.quaternion.clone().normalize().angleTo(c.quaternion.clone().normalize()); if (a > leak) { leak = a; leakBone = n; } }
        }
        R.leakRad = leak; R.leakBone = leakBone;
        R.handHome = ch.weapons.tachiDrawn.holder.position.distanceTo(ch.sword.home.drawn.position);
        R.hipHome = ch.weapons.tachiHip.holder.position.distanceTo(ch.sword.home.hip.position);
        R.saved = ch.sword.saved.size;
        return R;
      },
    };
  };
}
