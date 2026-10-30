// 握り（8.6a）の前後を、ラボで寄りと戦闘の画角に撮る（コマ割り）。前＝この層を切った同じ版（ch.hands.enabled=false）。
// 実行：PLAYWRIGHT_MODULE=… node tools/lab-play.mjs tools/scenarios/capture-hand-grip.mjs --query "who=hero&weapon=drawn" --w 1800 --h 1500 --out reports/polish3/hand-grip
//   KZ_SHEET=guard|draw|walk|enemy（既定 guard）。人物は --query の who（hero・soldier・officer）。カメラは刀・鞘の枠に固定し、前後で同じ画角にする。
const SHEET = process.env.KZ_SHEET || 'guard';

async function pageMain(sheet) {
  const THREE = await import('three');
  const { poseAt } = await import('/valley/sword-layer.js');
  const { GRIP } = await import('/valley/config.js');
  const L = window.__lab; L.renderer.setAnimationLoop(null);
  const ch = L.character, cam = L.camera, R = L.renderer, scene = L.scene;
  const tw = 360, th = 360, tiles = [];
  R.setSize(tw, th); cam.aspect = tw / th; cam.updateProjectionMatrix();
  // 止めた動作を巻き戻した直後は、混ぜの重みが0のまま（mixer の時刻が進まないと、0秒のフェードが終わらない）。0.1ms だけ進めてから止める
  const settle = () => { ch.update(1e-4); ch.update(0); ch.update(0); ch.root.updateMatrixWorld(true); };
  const pose = (clip, t) => { const a = ch.play(clip, { fade: 0, restart: true }); a.paused = true; a.time = Math.min(t, ch.meta(clip).seconds - 0.001); };
  const fwd = () => new THREE.Vector3(0, 0, 1).transformDirection(ch.root.matrixWorld), left = () => new THREE.Vector3(1, 0, 0).transformDirection(ch.root.matrixWorld);
  // 刀の枠の点（柄の右手の所）と、そこから見る向き（柄に直角・少し上）
  const swordPoint = y => new THREE.Vector3(0, y, 0).applyMatrix4(ch.weapons.tachiDrawn.holder.matrixWorld);
  const sayaPoint = () => new THREE.Vector3(0, 0.26, 0.007).applyMatrix4(ch.weapons.tachiHip.holder.matrixWorld);
  const shoot = (label, center, dir, dist, fov = 30) => {
    cam.fov = fov; cam.updateProjectionMatrix();
    cam.position.copy(center).addScaledVector(dir.clone().normalize(), dist); cam.up.set(0, 1, 0); cam.lookAt(center);
    R.render(scene, cam); tiles.push({ label, url: R.domElement.toDataURL('image/jpeg', 0.9) });
  };
  const both = (label, setup, views) => {
    for (const on of [false, true]) {
      ch.hands.enabled = on; setup(); settle();
      for (const [vl, center, dir, dist, fov] of views()) shoot(`${label} ${vl} ${on ? '後' : '前'}`, center, dir, dist, fov);
    }
  };
  const side = (k = 1) => { const S = ch.weapons.tachiDrawn.holder.matrixWorld; return new THREE.Vector3().setFromMatrixColumn(S, 0).multiplyScalar(k).add(new THREE.Vector3(0, 0.35, 0)); };
  if (sheet === 'guard' || sheet === 'enemy') {
    ch.setTachi(GRIP, true);
    const clips = sheet === 'enemy' ? [['Katana_Guard_Idle', 1.0], ['Walk_Fight_Forward', 0.6], ['Katana_Kesa_Cut', 0.9], ['Katana_Thrust', 0.9]]
      : [['Katana_Guard_Idle', 1.0], ['Walk_Fight_Forward', 0.6], ['Katana_Kesa_Cut', 0.9], ['Katana_Yokonagi_Cut', 1.2], ['Katana_Karatake_Heavy', 1.4], ['Katana_Finisher', 1.6]];
    for (const [clip, t] of clips) {
      if (!ch.meta(clip)) continue;
      both(clip.replace('Katana_', '').slice(0, 12), () => pose(clip, t), () => [
        ['寄り', swordPoint(0.084), side(1), 0.42],
        ['寄り裏', swordPoint(0.084), side(-1), 0.42],
        ['戦闘', swordPoint(0.0), fwd().multiplyScalar(0.8).add(left().multiplyScalar(-0.6)).add(new THREE.Vector3(0, 0.45, 0)), 2.6, 32],
      ]);
    }
  }
  if (sheet === 'draw') {
    for (const u of [0.15, 0.3, 0.45, 0.6, 0.8]) {
      both('抜刀 u' + u, () => { ch.setTachi(GRIP, false); pose('Long_Breathe_and_Look_Around', 1.0); ch.sword.setFrame({ u, mode: 'drawing', pose: poseAt(u), events: [] }); }, () => [
        ['右手', swordPoint(0.06), fwd().add(left().multiplyScalar(0.5)).add(new THREE.Vector3(0, 0.6, 0)), 0.5],
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
  const div = document.createElement('div');
  div.style.cssText = 'position:fixed;inset:0;z-index:9;background:#111;display:grid;grid-template-columns:repeat(6,1fr);gap:2px;align-content:start';
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
