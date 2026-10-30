// 握り（hand-rig.js・8.6a）の、毎コマの測定。ページ内で評価する（createHandMetrics.toString() を渡す）。
// 層の内部の値ではなく、描画に使う頂点（CPUで皮を骨に沿わせた位置）と骨の世界行列から測る:
//   指・親指の皮と柄（楕円の円筒）・鞘（曲がった管）の距離（すき間とめり込み）・手首と指の跳び・腕の写しの長さ・握っていないときの写しの戻り
//   ・動作の骨（刀が付く骨）と刀の先が、層を切った同じ人物と一致すること（刀の軌跡が変わらない）

// 合格の目安（design-hand-grip.md の契約）
// gapMm：指の付け根・中の節（4本×2節）の、柄にいちばん近い皮と柄の表面のすき間（目標3mm。板として曲げる方式の実測は構え4.5mm以下・
//   抜刀中は手を楕円の柄（16.5×14.2mm）のまわりに回すので細い側に当たり5.9mm以下。回帰の合格線は6mm）
// sinkMm：手の皮（手のひら・指・親指のすべての頂点）が柄・鞘へ入る深さ。reachMm：皮を測るのは、腕が握りの位置へ届いた（誤差 reachMm 以下の）コマだけ
export const HAND_LIMITS = Object.freeze({
  gapMm: 6, sinkMm: 2, popRatio: 3.0, popFloorM: 0.03, popFloorRad: 0.25, leakRad: 1e-6, armLenMm: 1, tipMm: 1, reachMm: 0.5, unreachedFrames: 1, unreachedMm: 30,
});

// ---- ここから下は、ページ内で評価される（外の変数を使わない）
export async function createHandMetrics() {
  const THREE = await import('three');
  const { palmCoords } = await import('/valley/hand-grip.js');
  const { sayaCenter } = await import('/valley/sword-path.js');
  const DIG = ['f0', 'f1', 'f2', 't0', 't1'];
  // 柄（weapons.js の tsuka：半径16.5mm、刀の z 方向に0.86倍。長さ0.25m）・鞘（半径22.5mm、反りの中心線）の表面からの符号つき距離（外が正）
  const tsukaDist = p => { if (p.y < -0.125 || p.y > 0.125) return null; const rho = Math.hypot(p.x, p.z), a = 0.0165, b = 0.0142; if (rho < 1e-9) return -b; return rho - a * b / Math.hypot(b * p.x / rho, a * p.z / rho); };
  const sayaDist = p => (p.y < 0.19 || p.y > 0.95) ? null : Math.hypot(p.x, p.z - sayaCenter(p.y)) - 0.0225;
  const tip = new THREE.Vector3(0, 0.88, 0);   // 切先（握りの原点から刃の根元0.16＋刃0.72）

  return function newRun(ch) {
    const hr = ch.hands, mesh = hr.mesh, geo = mesh.geometry, J = geo.attributes.skinIndex, W = geo.attributes.skinWeight, P = geo.attributes.position;
    const bones = mesh.skeleton.bones;
    // 頂点の組：手の全頂点、骨ごと（指は板の幅を4つに分けて「4本」に見立てる）
    const groups = {};
    for (const side of ['Right', 'Left']) {
      const s = hr.sides[side], handIdx = bones.indexOf(s.vis[2]), dig = new Map(s.dig.map((b, k) => [bones.indexOf(b), DIG[k]]));
      const bind = mesh.skeleton.boneInverses[handIdx].clone().multiply(mesh.bindMatrix), v = new THREE.Vector3();
      const g = { all: [] };
      for (let i = 0; i < J.count; i++) {
        let on = 0, best = -1, bw = 0;
        for (let k = 0; k < 4; k++) { const j = J.getComponent(i, k), w = W.getComponent(i, k); if (j === handIdx || dig.has(j)) on += w; if (w > bw) { bw = w; best = j; } }
        if (on < 0.5) continue;
        g.all.push(i);
        if (!dig.has(best) || bw < 0.5) continue;
        let key = dig.get(best);
        if (key[0] === 'f') {
          const [pw] = palmCoords(s.model, v.fromBufferAttribute(P, i).applyMatrix4(bind).toArray());
          key += '/' + Math.max(0, Math.min(3, Math.floor((pw - s.model.wLo) / (s.model.wHi - s.model.wLo) * 4)));
        }
        (g[key] ||= []).push(i);
      }
      groups[side] = g;
    }
    const R = { n: 0, nan: 0, contact: { Right: {}, Left: {} }, contactFrames: { Right: 0, Left: 0 }, sinkAll: { Right: 0, Left: 0 }, unreached: 0, maxReachErrMm: 0,
      maxArmDevMm: 0, copyLeakRad: 0, steps: { wristR: [], wristRotR: [], tipR: [], wristL: [], wristRotL: [], tipL: [] }, tipTrace: [] };
    const prev = {};
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), inv = new THREE.Matrix4();
    const lenOf = (a, b) => a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));
    // 1つの組の、円筒の表面からの距離の最小（＝その組で、いちばん柄に近い皮）
    const minDist = (side, key, frame, dist) => {
      let m = Infinity;
      for (const i of groups[side][key]) { mesh.getVertexPosition(i, p); p.applyMatrix4(mesh.matrixWorld).applyMatrix4(frame); const d = dist(p); if (d != null && d < m) m = d; }
      return m;
    };
    const measureContact = (side, frame, dist) => {
      R.contactFrames[side]++;
      for (const key of Object.keys(groups[side])) {
        const m = minDist(side, key, frame, dist);
        if (!Number.isFinite(m)) continue;
        if (key === 'all') { R.sinkAll[side] = Math.max(R.sinkAll[side], -m * 1000); continue; }
        const c = R.contact[side][key] ||= { gapMm: -Infinity, sinkMm: 0, frames: 0 };
        c.gapMm = Math.max(c.gapMm, m * 1000); c.sinkMm = Math.max(c.sinkMm, -m * 1000); c.frames++;
      }
    };
    const step = (key, cur, isQuat) => { const a = prev[key]; R.steps[key].push(a ? (isQuat ? a.angleTo(cur) : a.distanceTo(cur)) : null); prev[key] = cur.clone(); };
    return {
      R, groups,
      // 毎コマ（人物の update のあと）に呼ぶ。ctl は層を切った同じ人物（同じ動作・同じ時間）
      sample(ctl) {
        R.n++;
        ch.root.updateMatrixWorld(true);
        const Rs = hr.sides.Right, Ls = hr.sides.Left, holder = ch.weapons.tachiDrawn?.holder;
        // 右手：柄を握り切っている（重み1・腕が届いた）コマの、皮と柄
        if (holder && holder.visible && Rs.last.g >= 0.999) {
          if (!Rs.last.reached) R.unreached++;
          R.maxReachErrMm = Math.max(R.maxReachErrMm, Rs.last.error * 1000);
          if (Rs.last.error * 1000 <= 0.5) measureContact('Right', inv.copy(holder.matrixWorld).invert(), tsukaDist);
        }
        // 左手：鞘を持ち切っている（重み1）コマの、皮と鞘
        const hip = ch.weapons.tachiHip?.holder;
        if (hip && Ls.last.gSaya >= 0.999 && Ls.last.error * 1000 <= 0.5) measureContact('Left', inv.copy(hip.matrixWorld).invert(), sayaDist);
        // 跳び（見える手首の位置・向き、指先の骨の位置）
        for (const [side, s] of [['R', Rs], ['L', Ls]]) {
          s.vis[2].getWorldPosition(p); s.vis[2].getWorldQuaternion(q);
          if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) R.nan++;
          step('wrist' + side, p, false); step('wristRot' + side, q.clone().normalize(), true);
          step('tip' + side, s.dig[2].getWorldPosition(new THREE.Vector3()), false);
          // 腕の写しの長さ（動作の骨と同じ）
          R.maxArmDevMm = Math.max(R.maxArmDevMm, Math.abs(lenOf(s.vis[0], s.vis[1]) - lenOf(s.real[0], s.real[1])) * 1000, Math.abs(lenOf(s.vis[1], s.vis[2]) - lenOf(s.real[1], s.real[2])) * 1000);
          // 握っていない手は、写しが動作の骨と同じ（後処理が残らない）
          if (s.last.g === 0 && s.last.gSaya === 0) for (let k = 0; k < 3; k++) R.copyLeakRad = Math.max(R.copyLeakRad, s.vis[k].quaternion.clone().normalize().angleTo(s.real[k].quaternion.clone().normalize()));
        }
        // 刀の先：層を切った同じ人物と比べる
        if (ctl && holder) {
          const a = tip.clone().applyMatrix4(holder.matrixWorld);
          ctl.root.updateMatrixWorld(true);
          const b = tip.clone().applyMatrix4(ctl.weapons.tachiDrawn.holder.matrixWorld);
          R.tipTrace.push(a.distanceTo(b));
        }
      },
      // 動作の骨（ch.bones）が、層を切った同じ人物と一致するか。動作の補間は単位化しないので、単位化してから比べる
      finish(ctl) {
        let leak = 0, leakBone = null;
        if (ctl) {
          ch.root.updateMatrixWorld(true); ctl.root.updateMatrixWorld(true);
          for (const [n, b] of ch.bones) { const c = ctl.bones.get(n); if (!c) continue; const a = b.quaternion.clone().normalize().angleTo(c.quaternion.clone().normalize()); if (a > leak) { leak = a; leakBone = n; } }
        }
        R.realLeakRad = leak; R.realLeakBone = leakBone;
        R.maxTipDiffMm = R.tipTrace.length ? Math.max(...R.tipTrace) * 1000 : 0;
        return R;
      },
    };
  };
}
