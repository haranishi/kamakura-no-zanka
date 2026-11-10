export function createKamakuraHUD(meta, debug, flyControls = debug) {
  const root = document.createElement('section'); root.className = 'kamakura-ui';
  root.setAttribute('aria-label', '鎌倉散策');
  root.innerHTML = `<div class="kz-top"><span class="kz-north" aria-label="北の方向">↑ 北</span><span class="kz-place" role="status"></span><button class="kz-time" type="button" aria-label="時刻を変える">時刻</button><button class="kz-sound" type="button">音：入</button><button class="kz-pause">休止</button></div>
    <p class="kz-info">WASD／矢印：歩く · Shift：走る · C：ゆっくり歩く · クリック＋マウス／IJKL：視点 · P／Esc：休止<br>クリック：斬り · F：強斬り · Space：回避 · 右クリック：受け · 指：左半分で歩く・右半分で視点・右下のボタンで斬る／避ける</p>
    <div class="kz-flight"><button class="kz-fly">飛ぶ</button><button class="kz-top-view">全体</button><button class="kz-land">ここへ降りる</button><button class="kz-up">上昇</button><button class="kz-down">下降</button></div><p class="kz-state" role="status"></p><p class="kz-debug"></p><div class="kz-moves" hidden><button class="kz-cut" type="button">斬る</button><button class="kz-dodge" type="button">避ける</button></div><button class="kz-run">走る</button>`;
  document.body.append(root);
  const north = root.querySelector('.kz-north'), place = root.querySelector('.kz-place'), coords = root.querySelector('.kz-debug');
  coords.hidden = !debug;
  const info = root.querySelector('.kz-info'), walkHelp = info.innerHTML, run = root.querySelector('.kz-run');
  const controls = root.querySelector('.kz-flight'), toggle = root.querySelector('.kz-fly'), top = root.querySelector('.kz-top-view');
  const land = root.querySelector('.kz-land'), up = root.querySelector('.kz-up'), down = root.querySelector('.kz-down');
  // The sword buttons are for fingers (a tap on the picture does not cut); a mouse may press them too. Hidden while flying.
  const moveButtons = root.querySelector('.kz-moves'); let flying = false, movesOn = false;
  controls.hidden = !flyControls;
  return { root, toggle, top, land, up, down, setFlight(active, overview) {
      flying = active; controls.hidden = !flyControls;
      toggle.textContent = active ? '歩く' : '飛ぶ'; top.textContent = overview ? '元の飛行へ' : '全体';
      land.hidden = up.hidden = down.hidden = !active; run.textContent = active ? '加速' : '走る'; moveButtons.hidden = active || !movesOn;
      info.innerHTML = active ? '飛行：WASD 移動・Q/E 上下・Shift 加速・ホイール 速さ・M 全体図・G ここへ降りる・F 歩きへ<br>C／Space：下降／上昇・矢印／IJKL：視点・R：速さを戻す・P／Esc：休止<br>指：左ドラッグで移動・右で視点・上昇／下降は押している間' : walkHelp;
    }, setMoves(on) { movesOn = !!on; moveButtons.hidden = flying || !movesOn; }, cut: root.querySelector('.kz-cut'), dodge: root.querySelector('.kz-dodge'), run: root.querySelector('.kz-run'), pause: root.querySelector('.kz-pause'), sound: root.querySelector('.kz-sound'), time: root.querySelector('.kz-time'),
    status(text) { root.querySelector('.kz-state').textContent = text; },
    update(pos, yaw, terrain, perf, flight, audioText = '') {
      north.style.transform = `rotate(${yaw}rad)`;
      let nearest = null, distance = flying ? Infinity : 150;
      for (const p of meta.places) { const d = Math.hypot(p.x - pos.x, p.y + pos.z); if (d <= distance) { distance = d; nearest = p; } }
      place.textContent = nearest ? nearest.name : '鎌倉';
      if (debug) coords.textContent = `東 ${pos.x.toFixed(1)}m · 北 ${(-pos.z).toFixed(1)}m · 高さ ${pos.y.toFixed(1)}m · 勾配 ${terrain.slopeAt(pos.x, pos.z).toFixed(1)}° · 縦倍率 ${terrain.vscale}` + (flying && flight ? ` · 高度 ${(pos.y - terrain.heightAt(pos.x, pos.z)).toFixed(1)}m · 速さ ${flight.speed.toFixed(1)}m/秒 · 向き ${((-yaw * 180 / Math.PI % 360 + 360) % 360).toFixed(1)}° · ピッチ ${(flight.pose.pitch * 180 / Math.PI).toFixed(1)}°` : '') + (perf ? ` · 描 ${perf.calls}・三角 ${(perf.triangles / 1e6).toFixed(1)}M・${perf.averageMs.toFixed(1)}ms・段階${perf.step}` : '') + (audioText ? ` · ${audioText}` : '');
    }
  };
}
