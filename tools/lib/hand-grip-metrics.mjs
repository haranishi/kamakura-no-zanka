// 握り（hand-rig.js・8.6a）の、毎コマの測定。ページ内で評価する（createHandMetrics.toString() を渡す）。
// 層の内部の値ではなく、描画に使う頂点（CPUで皮を骨に沿わせた位置）と骨の世界行列から測る:
//   指・親指の皮と柄（楕円の円筒）・鞘（曲がった管）の距離（すき間とめり込み）・手首と指の跳び・腕の写しの長さ・握っていないときの写しの戻り
//   ・動作の骨（刀が付く骨）と刀の先が、層を切った同じ人物と一致すること（刀の軌跡が変わらない）

// 合格の目安（design-hand-grip.md の契約）
// gapMm：指の付け根・中の節（4本×2節）の、柄にいちばん近い皮と柄の表面のすき間（目標3mm。板として曲げる方式の実測は構え4.5mm以下・
//   抜刀中は手を楕円の柄（16.5×14.2mm）のまわりに回すので細い側に当たり5.9mm以下。回帰の合格線は6mm）
// sinkMm：手の皮（手のひら・指・親指のすべての頂点）が柄・鞘へ入る深さ。reachMm：皮を測るのは、腕が握りの位置へ届いた（誤差 reachMm 以下の）コマだけ
// 破綻（評価の2周目の指摘1〜5）の再発を防ぐ測定：
//   stretchMm：見える腕・手の三角形の辺が、層を切った同じ人物より伸びる量の最大（袖が帯のように伸びる・針が出る。針や裂けは100mm以上になる）。
//     実測の最大は42.3mm（歩きながらの抜刀で、左手が鞘を持つ間の左脇の胴＝前腕の写しに15%付く頂点。1周目の版と同じ値）
//   tsubaCross：見える腕・袖・手の辺が鍔の円盤を横切るコマの数（鍔が袖を突き抜けて、袖に黒い四角が出た）。右の腕・手は0。
//     左の手は、動作そのものが鍔を通り抜けるコマがある（層を切った人物で、逆袈裟・横薙ぎ・止めで31〜54コマ）。層は両手持ちで減らす。
//     重みの移り目の数コマが残るので、層を切った人物より tsubaLeftExtra コマ以上増えないこと。
//     抜刀・納刀は、刃を構えへ振る u0.75〜0.89 で右の袖が鍔を横切るコマが残る（既知・design-hand-grip.md）。測ったコマ（2コマに1回）が tsubaCrossDraw まで
export const HAND_LIMITS = Object.freeze({
  gapMm: 6, sinkMm: 2, popRatio: 3.0, popFloorM: 0.03, popFloorRad: 0.25, leakRad: 1e-6, armLenMm: 1, tipMm: 1, reachMm: 0.5, unreachedFrames: 1, unreachedMm: 30,
  stretchMm: 45, tsubaCross: 0, tsubaLeftExtra: 6, tsubaCrossDraw: 5,
});

// ---- ここから下は、ページ内で評価される（外の変数を使わない）
export async function createHandMetrics() {
  const THREE = await import('three');
  const { DIGIT_KEYS, groupName } = await import('/valley/hand-grip.js');
  const { sayaCenter } = await import('/valley/sword-path.js');
  // 柄（weapons.js の tsuka：半径16.5mm、刀の z 方向に0.86倍。長さ0.25m）・鞘（半径22.5mm、反りの中心線）の表面からの符号つき距離（外が正）
  const tsukaDist = p => { if (p.y < -0.125 || p.y > 0.125) return null; const rho = Math.hypot(p.x, p.z), a = 0.0165, b = 0.0142; if (rho < 1e-9) return -b; return rho - a * b / Math.hypot(b * p.x / rho, a * p.z / rho); };
  const sayaDist = p => (p.y < 0.19 || p.y > 0.95) ? null : Math.hypot(p.x, p.z - sayaCenter(p.y)) - 0.0225;
  const tip = new THREE.Vector3(0, 0.88, 0);   // 切先（握りの原点から刃の根元0.16＋刃0.72）

  return function newRun(ch) {
    const hr = ch.hands, mesh = hr.mesh, geo = mesh.geometry, J = geo.attributes.skinIndex, W = geo.attributes.skinWeight, P = geo.attributes.position;
    const bones = mesh.skeleton.bones;
    // 頂点の組：手の全頂点、指・親指の骨ごと（最も重い骨。名前は 'f' + 関節 + '/' + 指）
    const groups = {};
    for (const side of ['Right', 'Left']) {
      const s = hr.sides[side], handIdx = bones.indexOf(s.vis[2]), dig = new Map(s.dig.map((b, k) => [bones.indexOf(b), groupName(DIGIT_KEYS[k])]));
      const g = { all: [] };
      for (let i = 0; i < J.count; i++) {
        let on = 0, best = -1, bw = 0;
        for (let k = 0; k < 4; k++) { const j = J.getComponent(i, k), w = W.getComponent(i, k); if (j === handIdx || dig.has(j)) on += w; if (w > bw) { bw = w; best = j; } }
        if (on < 0.5) continue;
        g.all.push(i);
        if (!dig.has(best) || bw < 0.5) continue;
        (g[dig.get(best)] ||= []).push(i);
      }
      groups[side] = g;
    }
    // 結果の側：Right＝右手と柄、Left＝左手と鞘（抜刀の間）、LeftT＝左手と柄（両手持ち）
    const R = { n: 0, nan: 0, contact: { Right: {}, Left: {}, LeftT: {} }, contactFrames: { Right: 0, Left: 0, LeftT: 0 }, sinkAll: { Right: 0, Left: 0, LeftT: 0 }, unreached: 0, maxReachErrMm: 0, unreachedL: 0, maxReachErrLMm: 0,
      maxArmDevMm: 0, copyLeakRad: 0, steps: { wristR: [], wristRotR: [], tipR: [], wristL: [], wristRotL: [], tipL: [] }, tipTrace: [], maxStretchMm: 0, stretchAt: null, tsubaCross: 0, tsubaLeft: 0, tsubaLeftCtl: 0 };
    // 見える腕の写し・指の骨に少しでも付く頂点と、その頂点だけでできた三角形の辺（層を切った人物とは、この頂点だけが違う）
    const viewBones = new Map(); for (const side of ['Right', 'Left']) for (const b of [...hr.sides[side].vis, ...hr.sides[side].dig]) viewBones.set(bones.indexOf(b), side);
    const viewIdx = [], local = new Map(), sideOf = [];
    for (let i = 0; i < J.count; i++) {
      let r = 0, l = 0; for (let k = 0; k < 4; k++) { const sd = viewBones.get(J.getComponent(i, k)), w = W.getComponent(i, k); if (sd === 'Right') r += w; else if (sd === 'Left') l += w; }
      if (r + l > 0) { local.set(i, viewIdx.length); viewIdx.push(i); sideOf.push(r >= l ? 'R' : 'L'); }
    }
    const edges = [], idx = geo.index ? geo.index.array : null, seen = new Set();
    for (let t = 0; idx && t < idx.length; t += 3) for (const [a, b] of [[idx[t], idx[t + 1]], [idx[t + 1], idx[t + 2]], [idx[t + 2], idx[t]]]) {
      if (!local.has(a) || !local.has(b)) continue;
      const key = a < b ? a * 1e6 + b : b * 1e6 + a; if (seen.has(key)) continue; seen.add(key); edges.push(local.get(a), local.get(b));
    }
    // 鍔の円盤（weapons.js：半径41mm・z に0.92倍、中心 y=0.128）を、右・左それぞれの辺が横切るか（pos は世界、frame は柄の枠への逆行列）
    const tA = new THREE.Vector3(), tB = new THREE.Vector3();
    const crosses = (pos, frame, side) => {
      for (let e = 0; e < edges.length; e += 2) {
        if (sideOf[edges[e]] !== side) continue;
        tA.fromArray(pos, edges[e] * 3).applyMatrix4(frame); tB.fromArray(pos, edges[e + 1] * 3).applyMatrix4(frame);
        if ((tA.y - 0.128) * (tB.y - 0.128) >= 0) continue;
        const t = (0.128 - tA.y) / (tB.y - tA.y), x = tA.x + (tB.x - tA.x) * t, z = tA.z + (tB.z - tA.z) * t;
        if (Math.hypot(x / 0.041, z / (0.041 * 0.92)) < 1) return true;
      }
      return false;
    };
    const posOn = new Float32Array(viewIdx.length * 3), posOff = new Float32Array(viewIdx.length * 3), tv = new THREE.Vector3();
    const skinView = (c, out) => {
      const m = c.hands.mesh; c.root.updateMatrixWorld(true);
      for (let n = 0; n < viewIdx.length; n++) { m.getVertexPosition(viewIdx[n], tv); tv.applyMatrix4(m.matrixWorld); out[n * 3] = tv.x; out[n * 3 + 1] = tv.y; out[n * 3 + 2] = tv.z; }
    };
    const prev = {};
    const p = new THREE.Vector3(), q = new THREE.Quaternion(), inv = new THREE.Matrix4();
    const lenOf = (a, b) => a.getWorldPosition(new THREE.Vector3()).distanceTo(b.getWorldPosition(new THREE.Vector3()));
    // 1つの組の、円筒の表面からの距離の最小（＝その組で、いちばん柄に近い皮）
    const minDist = (side, key, frame, dist) => {
      let m = Infinity;
      for (const i of groups[side][key]) { mesh.getVertexPosition(i, p); p.applyMatrix4(mesh.matrixWorld).applyMatrix4(frame); const d = dist(p); if (d != null && d < m) m = d; }
      return m;
    };
    const measureContact = (side, frame, dist, as = side) => {
      R.contactFrames[as]++;
      for (const key of Object.keys(groups[side])) {
        const m = minDist(side, key, frame, dist);
        if (!Number.isFinite(m)) continue;
        if (key === 'all') { R.sinkAll[as] = Math.max(R.sinkAll[as], -m * 1000); continue; }
        const c = R.contact[as][key] ||= { gapMm: -Infinity, sinkMm: 0, frames: 0 };
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
        // 左手：両手持ちで柄を握り切っているコマの、皮と柄（腕が届かないコマは数だけ）
        if (holder && holder.visible && Ls.last.g2 >= 0.999) {
          if (!Ls.last.reached) R.unreachedL++;
          R.maxReachErrLMm = Math.max(R.maxReachErrLMm, Ls.last.error * 1000);
          if (Ls.last.error * 1000 <= 0.5) measureContact('Left', inv.copy(holder.matrixWorld).invert(), tsukaDist, 'LeftT');
        }
        // 跳び（見える手首の位置・向き、指先の骨の位置）
        for (const [side, s] of [['R', Rs], ['L', Ls]]) {
          s.vis[2].getWorldPosition(p); s.vis[2].getWorldQuaternion(q);
          if (![p.x, p.y, p.z, q.x, q.y, q.z, q.w].every(Number.isFinite)) R.nan++;
          step('wrist' + side, p, false); step('wristRot' + side, q.clone().normalize(), true);
          step('tip' + side, s.dig[2].getWorldPosition(new THREE.Vector3()), false);
          // 腕の写しの長さ（動作の骨と同じ）
          R.maxArmDevMm = Math.max(R.maxArmDevMm, Math.abs(lenOf(s.vis[0], s.vis[1]) - lenOf(s.real[0], s.real[1])) * 1000, Math.abs(lenOf(s.vis[1], s.vis[2]) - lenOf(s.real[1], s.real[2])) * 1000);
          // 握っていない手は、写しが動作の骨と同じ（後処理が残らない）
          if (s.last.g === 0 && s.last.gSaya === 0 && !(s.last.g2 > 0)) for (let k = 0; k < 3; k++) R.copyLeakRad = Math.max(R.copyLeakRad, s.vis[k].quaternion.clone().normalize().angleTo(s.real[k].quaternion.clone().normalize()));
        }
        // 袖・腕・手の辺の伸び（層を切った人物と比べる）と、鍔の円盤を横切る辺
        if (ctl && R.n % 2 === 1) {
          skinView(ch, posOn); skinView(ctl, posOff);
          const len = (A, a, b) => Math.hypot(A[a * 3] - A[b * 3], A[a * 3 + 1] - A[b * 3 + 1], A[a * 3 + 2] - A[b * 3 + 2]);
          for (let e = 0; e < edges.length; e += 2) { const g = len(posOn, edges[e], edges[e + 1]) - len(posOff, edges[e], edges[e + 1]); if (g * 1000 > R.maxStretchMm) { R.maxStretchMm = g * 1000; R.stretchAt = viewIdx[edges[e]]; } }
          if (holder && holder.visible) {
            inv.copy(holder.matrixWorld).invert();
            if (crosses(posOn, inv, 'R')) R.tsubaCross++;
            if (crosses(posOn, inv, 'L')) R.tsubaLeft++;
            ctl.root.updateMatrixWorld(true);
            if (crosses(posOff, new THREE.Matrix4().copy(ctl.weapons.tachiDrawn.holder.matrixWorld).invert(), 'L')) R.tsubaLeftCtl++;
          }
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
