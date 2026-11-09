import { KamakuraAudio } from './kamakura-sea-audio.js';
import { kamakuraStepSurface, STEP_NAMES } from './kamakura-step-rules.js';
import { STEP_TABLE } from './audio-rules.js';
import { mulberry32 } from './scatter.js';
const MUTE_KEY = 'kamakura-audio-muted';
const RIVER_HEARING_M = 300;
// W2c-9a: own Kamakura controls and surf; inherited valley synthesis is unchanged.
export function createKamakuraAudio({ search = '', terrain, button, onUnavailable = () => {},
  target = globalThis, storage = () => globalThis.localStorage, flying = () => false } = {}) {
  const params = new URLSearchParams(search), enabled = params.get('audio') !== '0';
  const steps9 = params.get('steps9') !== '0';
  const audio = enabled ? new KamakuraAudio(onUnavailable, { steps9, sea: params.get('sea') !== '0', gainScale: params.has('seagain') ? Number(params.get('seagain')) : 1 }) : null;
  const events = new AbortController(), gestures = new AbortController();
  let disposed = false, paused = false, steps = 0, elapsed = 0;
  let attached = null, currentSurface = null, lastSurface = null;
  const surfaceAt = pos => pos && terrain?.surfaceAt && terrain?.waterAt
    ? kamakuraStepSurface(terrain.surfaceAt(pos.x, pos.z), { water: terrain.waterAt(pos.x, pos.z),
      ...(typeof terrain.grassDensityAt === 'function' ? { density: terrain.grassDensityAt(pos.x, pos.z) } : {}) }) : null;
  let savedMute = false;
  try { savedMute = storage()?.getItem(MUTE_KEY) === '1'; } catch {}
  if (audio) {
    audio.setMuted(params.has('mute') ? params.get('mute') === '1' : savedMute);
    audio.setPaused(false); // No context exists until a gesture; resume stays inside that gesture.
    const playStep = audio.playStep.bind(audio), startAmbient = audio.startAmbient.bind(audio);
    audio.playStep = (...args) => {
      if (disposed || flying()) return false;
      if (steps9 && attached?.hero?.pos) {
        currentSurface = surfaceAt(attached.hero.pos);
        if (currentSurface) {
          const step = args[0], surface = currentSurface.surface;
          args[0] = { ...step, recipe: { ...step.recipe, surface, material: STEP_TABLE.surfaces[surface] } };
          audio.grassMix = currentSurface.grassMix;
        }
      }
      const played = playStep(...args); if (played) { steps++; lastSurface = args[0].recipe.surface; }
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
      attached = g;
      Object.assign(g, { audio: audio || silent, rng: mulberry32(0x6b7a7374),
        world: { buildings: [] }, emitNoise: () => {}, fx: { dust: () => {} }, pan: () => 0 });
    },
    setPaused(on) { paused = !!on; if (!disposed) audio?.setPaused(paused); },
    update(dt, pos) {
      if (disposed || !audio || paused) return;
      elapsed += dt;
      if (elapsed + 1e-9 < .1) return;
      elapsed = Math.max(0, elapsed - Math.floor((elapsed + 1e-9) / .1) * .1);
      if (steps9) currentSurface = surfaceAt(attached?.hero?.pos || pos);
      // The river falls off as 1/(1+(d/14)^2.2) (about 0.001 at 300 m), so a farther bank is the same as none: cap the search.
      audio.updateListener({ river: terrain.riverDistanceAt(pos.x, pos.z, RIVER_HEARING_M), fire: Infinity, sea: terrain.seaDistanceAt?.(pos.x, pos.z) ?? Infinity });
    },
    get state() {
      return { enabled, ...audio?.state, steps, surface: currentSurface?.surface ?? null, lastSurface, ambient: !!audio?.ambient.size && !audio?.paused && !audio?.muted,
        sea: audio?.seaDistance ?? Infinity, seaGain: audio?.seaGain ?? 0,
        wave: !!audio?.ambient.has('sea') && audio.seaGain > 0 && !audio.paused && !audio.muted,
        river: audio?.listener.river ?? Infinity };
    },
    debugText() {
      if (!enabled) return '音：無効';
      const state = audio.reported ? '利用不可' : !audio.context ? '未解錠' : audio.muted ? 'ミュート' : audio.paused ? '休止' : '解錠済';
      const d = audio.seaDistance, sea = d < 1000 ? `${Math.round(d)}m` : '−';
      const active = !audio.paused && !audio.muted;
      const foot = steps9 ? `・足元${STEP_NAMES[currentSurface?.surface] || '−'}・直近${STEP_NAMES[lastSurface] || '−'}` : '';
      return `音：${state}・足音${steps}・環境音${audio.ambient.size && active ? 'on' : 'off'}・海 ${sea}・波${audio.ambient.has('sea') && audio.seaGain > 0 && active ? 'on' : 'off'}${foot}`;
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
