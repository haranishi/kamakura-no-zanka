// 握り（8.6a）の前後を、ラボで寄りと戦闘の画角に撮る（コマ割り）。前＝この層を切った同じ版（ch.hands.enabled=false）。
// 実行：PLAYWRIGHT_MODULE=… node tools/lab-play.mjs tools/scenarios/capture-hand-grip.mjs --query "who=hero&weapon=drawn" --w 1800 --h 1500 --out reports/polish3/hand-grip
//   KZ_SHEET=guard|draw|walk|enemy|twohand（既定 guard）。人物は --query の who（hero・soldier・officer）。カメラは刀・鞘の枠に固定し、前後で同じ画角にする。
// 寄りのカメラの近い面は2cm（ラボの既定10cmのままだと、柄へ寄せて動いた袖がカメラから6〜9cmに来たとき、袖が切られて黒い板・針・膜に見えた。
// ゲームのカメラは2m以上離れ、近い面は15cm）。寄り裏は、柄からカメラへの線が前後どちらでも人物に遮られない向きを、柄のまわりに回して選ぶ（ラベルに角度）。
const SHEET = process.env.KZ_SHEET || 'guard';

async function pageMain(sheet) {
  const THREE = await import('three');
  const { poseAt } = await import('/valley/sword-layer.js');
  const { GRIP } = await import('/valley/config.js');
  const L = window.__lab; L.renderer.setAnimationLoop(null);
  const ch = L.character, cam = L.camera, R = L.renderer, scene = L.scene, mesh = ch.hands.mesh;
  const tw = 360, th = 360, tiles = [];
  R.setSize(tw, th); cam.aspect = tw / th; cam.updateProjectionMatrix();
  // 止めた動作を巻き戻した直後は、混ぜの重みが0のまま（mixer の時刻が進まないと、0秒のフェードが終わらない）。0.1ms だけ進めてから止める。
  // 両手持ちの重みは時間で追うので、止めた絵では、そのコマの目標（重みを空にして入れ直す）にする
  const settle = () => { ch.hands.sides.Left.g2 = null; ch.update(1e-4); ch.update(0); ch.update(0); ch.root.updateMatrixWorld(true); };
  const pose = (clip, t) => { const a = ch.play(clip, { fade: 0, restart: true }); a.paused = true; a.time = Math.min(t, ch.meta(clip).seconds - 0.001); };
  const fwd = () => new THREE.Vector3(0, 0, 1).transformDirection(ch.root.matrixWorld), left = () => new THREE.Vector3(1, 0, 0).transformDirection(ch.root.matrixWorld);
  // 刀の枠の点（柄の右手の所）と、そこから見る向き（柄に直角・少し上）
  const swordPoint = y => new THREE.Vector3(0, y, 0).applyMatrix4(ch.weapons.tachiDrawn.holder.matrixWorld);
  const sayaPoint = () => new THREE.Vector3(0, 0.26, 0.007).applyMatrix4(ch.weapons.tachiHip.holder.matrixWorld);
  const shoot = (label, center, dir, dist, fov = 30) => {
    cam.fov = fov; cam.near = dist < 1 ? 0.02 : 0.1; cam.updateProjectionMatrix();
    cam.position.copy(center).addScaledVector(dir.clone().normalize(), dist); cam.up.set(0, 1, 0); cam.lookAt(center);
    R.render(scene, cam); tiles.push({ label, url: R.domElement.toDataURL('image/jpeg', 0.9) });
  };
  // 柄の点からカメラへの線が人物に遮られないか（手そのものを越えた6cm先から、カメラの手前まで）。中心と、まわり4本（画角の中ほど）の5本で見る
  const ray = new THREE.Raycaster();
  const clear = (center, dir, dist) => {
    mesh.computeBoundingSphere();
    const d = dir.clone().normalize(), a = new THREE.Vector3().crossVectors(d, new THREE.Vector3(0, 1, 0)).normalize(), b = new THREE.Vector3().crossVectors(a, d);
    let blocked = 0;
    for (const [x, y] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const o = center.clone().addScaledVector(a, x * 0.03).addScaledVector(b, y * 0.03).addScaledVector(d, 0.06);
      ray.set(o, d); ray.near = 0; ray.far = dist - 0.06 - 0.03;
      if (ray.intersectObject(mesh, false).length) blocked++;
    }
    return blocked;
  };
  const both = (label, setup, views) => {
    // views(): [名前, 中心, 向き, 距離, 画角, 遮りを避けるか]。避ける向きは、前後の両方で遮られない最初の候補（柄の軸のまわりに±25°ずつ）
    const pick = {};
    for (const on of [false, true]) {
      ch.hands.enabled = on; setup(); settle();
      views().forEach(([vl, center, dir, dist, , avoid], i) => {
        if (!avoid) return;
        const S = ch.weapons.tachiDrawn.holder.matrixWorld, axis = new THREE.Vector3().setFromMatrixColumn(S, 1).normalize();
        const ok = (pick[i] ||= [0, 25, -25, 50, -50, 75, -75, 100, -100, 125, -125].map(a => ({ a, blocked: 0 })));
        for (const c of ok) c.blocked += clear(center, dir.clone().applyAxisAngle(axis, c.a * Math.PI / 180), dist);
      });
    }
    for (const on of [false, true]) {
      ch.hands.enabled = on; setup(); settle();
      views().forEach(([vl, center, dir, dist, fov, avoid], i) => {
        let d = dir, tag = '';
        if (avoid) {
          // 前後とも遮られない最初の候補。無ければ、遮る線の最も少ない候補（ラベルに「遮り」）
          const c = pick[i].find(x => x.blocked === 0) || pick[i].reduce((m, x) => (x.blocked < m.blocked ? x : m));
          const S = ch.weapons.tachiDrawn.holder.matrixWorld, axis = new THREE.Vector3().setFromMatrixColumn(S, 1).normalize();
          d = dir.clone().applyAxisAngle(axis, c.a * Math.PI / 180); tag = (c.a ? `(${c.a > 0 ? '+' : ''}${c.a}°)` : '') + (c.blocked ? '(遮り)' : '');
        }
        shoot(`${label} ${vl}${tag} ${on ? '後' : '前'}`, center, d, dist, fov);
      });
    }
  };
  const side = (k = 1) => { const S = ch.weapons.tachiDrawn.holder.matrixWorld; return new THREE.Vector3().setFromMatrixColumn(S, 0).multiplyScalar(k).add(new THREE.Vector3(0, 0.35, 0)); };
  if (sheet === 'guard' || sheet === 'enemy') {
    ch.setTachi(GRIP, true);
    const clips = sheet === 'enemy' ? [['Katana_Guard_Idle', 1.0], ['Walk_Fight_Forward', 0.6], ['Katana_Kesa_Cut', 0.9], ['Katana_Thrust', 0.9]]
      : [['Katana_Guard_Idle', 1.0], ['Walk_Fight_Forward', 0.6], ['Katana_Kesa_Cut', 0.9], ['Katana_Yokonagi_Cut', 1.2], ['Katana_Karatake_Heavy', 1.4], ['Katana_Finisher', 1.6]];
    for (const [clip, t] of clips) {
      if (!ch.meta(clip) || !ch.tpl.clips.has(clip)) continue;
      both(clip.replace('Katana_', '').slice(0, 12), () => pose(clip, t), () => [
        ['寄り', swordPoint(0.084), side(1), 0.42],
        ['寄り裏', swordPoint(0.084), side(-1), 0.42, 30, true],
        ['戦闘', swordPoint(0.0), fwd().multiplyScalar(0.8).add(left().multiplyScalar(-0.6)).add(new THREE.Vector3(0, 0.45, 0)), 2.6, 32],
      ]);
    }
  }
  if (sheet === 'twohand') {
    ch.setTachi(GRIP, true);
    for (const [clip, t] of [['Katana_Guard_Idle', 1.0], ['Katana_Kesa_Cut', 0.9], ['Katana_Yokonagi_Cut', 1.2], ['Katana_Karatake_Heavy', 1.4]]) {
      if (!ch.meta(clip) || !ch.tpl.clips.has(clip)) continue;
      both(clip.replace('Katana_', '').slice(0, 12), () => pose(clip, t), () => [
        ['両手', swordPoint(-0.02), side(1), 0.55, 34],
        ['両手裏', swordPoint(-0.02), side(-1), 0.55, 34, true],
        ['左手', swordPoint(-0.08), side(1).add(fwd().multiplyScalar(0.5)), 0.4, 30, true],
      ]);
    }
  }
  if (sheet === 'draw') {
    for (const u of [0.15, 0.3, 0.45, 0.6, 0.8]) {
      both('抜刀 u' + u, () => { ch.setTachi(GRIP, false); pose('Long_Breathe_and_Look_Around', 1.0); ch.sword.setFrame({ u, mode: 'drawing', pose: poseAt(u), events: [] }); }, () => [
        ['右手', swordPoint(0.06), fwd().add(left().multiplyScalar(0.5)).add(new THREE.Vector3(0, 0.6, 0)), 0.5],
        ['右手横', swordPoint(0.06), left().multiplyScalar(-1).add(new THREE.Vector3(0, 0.3, 0)), 0.5, 30, true],
        ['左手', sayaPoint(), left().add(fwd().multiplyScalar(0.8)).add(new THREE.Vector3(0, 0.35, 0)), 0.5],
        ['戦闘', sayaPoint(), fwd().add(left().multiplyScalar(0.9)).add(new THREE.Vector3(0, 0.45, 0)), 2.4, 32],
      ]);
    }
    ch.sword.setFrame(null); settle();
  }
  if (sheet === 'walk') {
    ch.setTachi(GRIP, false);
    for (const [clip, t] of [['Samurai_Walk', 0.3], ['Samurai_Walk', 0.9], ['Long_Breathe_and_Look_Around', 3.0]]) {
      both(clip.slice(0, 12) + ' ' + t, () => pose(clip, t), () => {
        const rh = ch.hands.sides.Right.vis[2], c = new THREE.Vector3(0, 0.1, 0).applyMatrix4(rh.matrixWorld);
        return [['右手', c, left().multiplyScalar(-1).add(fwd().multiplyScalar(0.8)), 0.5], ['全身', new THREE.Vector3(0, ch.height * 0.55, 0).applyMatrix4(ch.root.matrixWorld), fwd().add(left().multiplyScalar(-0.5)), 3.4, 32]];
      });
    }
  }
  ch.hands.enabled = true;
  const cols = sheet === 'draw' ? 8 : 6;
  const div = document.createElement('div');
  div.style.cssText = `position:fixed;inset:0;z-index:9;background:#111;display:grid;grid-template-columns:repeat(${cols},1fr);gap:2px;align-content:start`;
  for (const t of tiles) { const f = document.createElement('figure'); f.style.cssText = 'margin:0;position:relative'; f.innerHTML = '<img style="width:100%;display:block" src="' + t.url + '"><figcaption style="position:absolute;left:3px;top:2px;color:#fff;background:#000a;font:12px sans-serif;padding:1px 4px">' + t.label + '</figcaption>'; div.append(f); }
  document.body.append(div);
  await new Promise(r => setTimeout(r, 300));
  return tiles.length;
}

export default async function ({ v, shot, log }) {
  const n = await v(`(${pageMain.toString()})(${JSON.stringify(SHEET)})`);
  log(SHEET + ': ' + n + ' tiles');
  await shot(process.env.KZ_NAME || SHEET);
}
