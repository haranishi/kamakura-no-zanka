export function createKamakuraHUD(meta, debug, flyControls = debug) {
  const root = document.createElement('section'); root.className = 'kamakura-ui';
  root.setAttribute('aria-label', '鎌倉散策');
  root.innerHTML = `<div class="kz-top"><span class="kz-north" aria-label="北の方向">↑ 北</span><span class="kz-place" role="status"></span><button class="kz-pause">休止</button></div>
    <p class="kz-info">WASD／矢印：歩く · Shift：走る · クリック＋マウス／IJKL：視点 · P／Esc：休止<br>指：左半分をドラッグで歩く・右半分で視点</p>
    <div class="kz-flight"><button class="kz-fly">飛ぶ</button><button class="kz-top-view">全体</button><button class="kz-land">ここへ降りる</button><button class="kz-up">上昇</button><button class="kz-down">下降</button></div><p class="kz-state" role="status"></p><p class="kz-debug"></p><button class="kz-run">走る</button>`;
  document.body.append(root);
  const north = root.querySelector('.kz-north'), place = root.querySelector('.kz-place'), coords = root.querySelector('.kz-debug');
  coords.hidden = !debug;
  const info = root.querySelector('.kz-info'), walkHelp = info.innerHTML, run = root.querySelector('.kz-run');
  const controls = root.querySelector('.kz-flight'), toggle = root.querySelector('.kz-fly'), top = root.querySelector('.kz-top-view');
  const land = root.querySelector('.kz-land'), up = root.querySelector('.kz-up'), down = root.querySelector('.kz-down');
  let flying = false;
  controls.hidden = !flyControls;
  return { root, toggle, top, land, up, down, setFlight(active, overview) {
      flying = active; controls.hidden = !flyControls;
      toggle.textContent = active ? '歩く' : '飛ぶ'; top.textContent = overview ? '元の飛行へ' : '全体';
      land.hidden = up.hidden = down.hidden = !active; run.textContent = active ? '加速' : '走る';
      info.innerHTML = active ? '飛行：WASD 移動・Q/E 上下・Shift 加速・ホイール 速さ・M 全体図・G ここへ降りる・F 歩きへ<br>C／Space：下降／上昇・矢印／IJKL：視点・R：速さを戻す・P／Esc：休止<br>指：左ドラッグで移動・右で視点・上昇／下降は押している間' : walkHelp;
    }, run: root.querySelector('.kz-run'), pause: root.querySelector('.kz-pause'),
    status(text) { root.querySelector('.kz-state').textContent = text; },
    update(pos, yaw, terrain, perf, flight) {
      north.style.transform = `rotate(${yaw}rad)`;
      let nearest = null, distance = flying ? Infinity : 150;
      for (const p of meta.places) { const d = Math.hypot(p.x - pos.x, p.y + pos.z); if (d <= distance) { distance = d; nearest = p; } }
      place.textContent = nearest ? nearest.name : '鎌倉';
      if (debug) coords.textContent = `東 ${pos.x.toFixed(1)}m · 北 ${(-pos.z).toFixed(1)}m · 高さ ${pos.y.toFixed(1)}m · 勾配 ${terrain.slopeAt(pos.x, pos.z).toFixed(1)}° · 縦倍率 ${terrain.vscale}` + (flying && flight ? ` · 高度 ${(pos.y - terrain.heightAt(pos.x, pos.z)).toFixed(1)}m · 速さ ${flight.speed.toFixed(1)}m/秒 · 向き ${((-yaw * 180 / Math.PI % 360 + 360) % 360).toFixed(1)}° · ピッチ ${(flight.pose.pitch * 180 / Math.PI).toFixed(1)}°` : '') + (perf ? ` · 描 ${perf.calls}・三角 ${(perf.triangles / 1e6).toFixed(1)}M・${perf.averageMs.toFixed(1)}ms・段階${perf.step}` : '');
    }
  };
}
