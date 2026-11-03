// 節目の演出の枠をゲームへつなぐ純粋な部品（C0a後半）。画面・時計・保存先に触れず、渡された値だけで答える。
// 再生の状態は cinematics.js の createCinematicPlayer/stepCinematic が持つ。ここは「名前の解決・入力の読み方・見え方」だけ。

// 復帰先の名前と処理。表の returnTarget は、ここに登録された名前だけを通す（validateCinematicTable の returnTargets）。
export function createReturnRegistry() {
  const map = new Map();
  const api = {
    register(name, fn) {
      if (typeof name !== 'string' || !name || typeof fn !== 'function') throw new TypeError('invalid return target');
      map.set(name, fn); return api;
    },
    resolve: name => map.get(name) ?? null,
    names: () => [...map.keys()],
  };
  return api;
}

// 飛ばしの3操作の「いま押している」。コマの間で押して離した短い押下も、そのコマは押した扱いにする（取りこぼさない）。
// held/mouse は押し続け、pressed/mousePressed はこのコマの押した瞬間（input.js の集合）。
export function skipDown({ held, mouse, pressed, mousePressed }) {
  return { KeyE: held.has('KeyE') || pressed.has('KeyE'), Space: held.has('Space') || pressed.has('Space'),
    Mouse0: mouse.has(0) || mousePressed.has(0) };
}

const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = k => k * k * (3 - 2 * k);
const lerp3 = (a, b, k) => [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];

// いまの見え方。weight は遊びのカメラ（0）とショット（1）の混ぜ具合（直線。なめらかにするのは game.applyCine）：準備と移行で0→1、再生中1、復帰で1→0。
// pos/lookAt は anchor からの相対（m）。reduced（OSの動きを減らす）では静止版の画角へ切り替えるだけで、混ぜも移動もしない。
// 字幕は再生中だけ（同じショットの識別子を textById で解決し、空白でつなぐ）。案内は出した後、飛ばし・復帰まで。
export function cinematicView(state, { reduced = false, textById = {} } = {}) {
  const e = state.entry, shots = e.shots, i = Math.min(Math.max(0, state.shotIndex), shots.length - 1), shot = shots[i];
  const lead = e.prepareSec + e.transitionSec;
  let weight = 1;
  if (state.phase === 'ended') weight = 0;
  else if (state.phase === 'returning') weight = e.returnSec > 0 ? clamp01(1 - state.returnElapsedSec / e.returnSec) : 0;
  else if (state.phase === 'preparing') weight = lead > 0 ? clamp01(state.elapsedSec / lead) : 1;
  if (reduced) weight = state.phase === 'returning' || state.phase === 'ended' ? 0 : 1;
  const cam = reduced ? shot.still.camera : shot.camera;
  const k = reduced || state.phase === 'preparing' ? 0 : state.phase === 'playing' ? smooth(clamp01(state.shotTimeSec / shot.durationSec)) : 1;
  const playing = state.phase === 'playing';
  const ids = playing ? shot.subtitleIds : [];
  return {
    weight, anchor: cam.anchor, pos: lerp3(cam.from, cam.to, k), lookAt: cam.lookAt.slice(), fov: cam.fov,
    shotIndex: playing ? i : -1, subtitleKey: ids.join('+'), subtitle: ids.map(id => textById[id] ?? '').join(' '),
    gestures: playing ? (reduced ? shot.still.gestures : shot.gestures) : [],
    hint: state.hintSent && (state.phase === 'preparing' || state.phase === 'playing'),
  };
}
