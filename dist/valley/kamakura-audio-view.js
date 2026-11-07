import { ValleyAudio } from './audio-valley.js';
import { mulberry32 } from './scatter.js';
const MUTE_KEY = 'kamakura-audio-muted';
// Own only Kamakura's lifetime and controls; synthesis stays in ValleyAudio.
export function createKamakuraAudio({ search = '', terrain, button, onUnavailable = () => {},
  target = globalThis, storage = () => globalThis.localStorage, flying = () => false } = {}) {
  const params = new URLSearchParams(search), enabled = params.get('audio') !== '0';
  const audio = enabled ? new ValleyAudio(onUnavailable) : null;
  const events = new AbortController(), gestures = new AbortController();
  let disposed = false, paused = false, steps = 0, elapsed = 0;
  let savedMute = false;
  try { savedMute = storage()?.getItem(MUTE_KEY) === '1'; } catch {}
  if (audio) {
    audio.setMuted(params.has('mute') ? params.get('mute') === '1' : savedMute);
    audio.setPaused(false); // No context exists until a gesture; resume stays inside that gesture.
    const playStep = audio.playStep.bind(audio), startAmbient = audio.startAmbient.bind(audio);
    audio.playStep = (...args) => {
      if (disposed || flying()) return false;
      const played = playStep(...args); if (played) steps++;
      return played;
    };
    audio.startAmbient = () => { if (!disposed) startAmbient(); };
    const unlock = () => {
      gestures.abort();
      audio.unlock().then(() => { if (!disposed) audio.setPaused(paused); });
    };
    for (const name of ['pointerup', 'touchend', 'click', 'keydown']) target.addEventListener(name, unlock, { signal: gestures.signal });
  }
  function refreshButton() {
    if (!button) return;
    button.disabled = !enabled;
    button.textContent = !enabled ? '音：無効' : audio.muted ? '音：切' : '音：入';
    button.setAttribute('aria-label', !enabled ? '音はURLで無効です' : audio.muted ? '音を入れる' : '音を切る');
    button.setAttribute('aria-pressed', String(enabled && !audio.muted));
  }
  button?.addEventListener('click', () => {
    if (!audio || disposed) return;
    audio.setMuted(!audio.muted);
    try { storage()?.setItem(MUTE_KEY, audio.muted ? '1' : '0'); } catch {}
    refreshButton();
  }, { signal: events.signal });
  refreshButton();
  // HeroActor always uses the same contact handler, including in audio=0 mode.
  const silent = { playStep: () => false };
  return {
    audio: audio || silent,
    attach(g) {
      Object.assign(g, { audio: audio || silent, rng: mulberry32(0x6b7a7374),
        world: { buildings: [] }, emitNoise: () => {}, fx: { dust: () => {} }, pan: () => 0 });
    },
    setPaused(on) { paused = !!on; if (!disposed) audio?.setPaused(paused); },
    update(dt, pos) {
      if (disposed || !audio || paused) return;
      elapsed += dt;
      if (elapsed + 1e-9 < .1) return;
      elapsed = Math.max(0, elapsed - Math.floor((elapsed + 1e-9) / .1) * .1);
      audio.updateListener({ river: terrain.riverDistanceAt(pos.x, pos.z), fire: Infinity });
    },
    get state() {
      return { enabled, ...audio?.state, steps, ambient: !!audio?.ambient.size && !audio?.paused && !audio?.muted,
        river: audio?.listener.river ?? Infinity };
    },
    debugText() {
      if (!enabled) return '音：無効';
      const state = audio.reported ? '利用不可' : !audio.context ? '未解錠' : audio.muted ? 'ミュート' : audio.paused ? '休止' : '解錠済';
      return `音：${state}・足音${steps}・環境音${this.state.ambient ? 'on' : 'off'}`;
    },
    dispose() {
      if (disposed) return; disposed = true; events.abort(); gestures.abort();
      if (!audio) return;
      audio.setPaused(true);
      // Pending resume/suspend completions must not revive a closed world.
      audio.sync = () => Promise.resolve();
      const ctx = audio.context;
      for (const node of [audio.master, audio.comp, audio.limiter]) { try { node?.disconnect(); } catch {} }
      if (ctx) { try { Promise.resolve(ctx.close()).catch(() => {}); } catch {} }
    }
  };
}
