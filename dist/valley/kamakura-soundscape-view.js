import { atmosphereOptions } from './kamakura-atmosphere.js';
import { HABITAT_KEYS } from './kamakura-habitat.js';
import { gustLevel } from './kamakura-gust.js';
import { VOICE_NAMES, renderVoice } from './kamakura-voices.js';
import { SOUNDSCAPE_LEVELS, BIRDS, createSoundscapeState, stepSoundscape,
  sourceSpatial, soundscapeLimit, startSoundscapeVoice } from './kamakura-soundscape.js';

const LABELS = { higurashi: 'ヒグラシ', aburazemi: 'アブラゼミ', minmin: 'ミンミン', uguisu: 'ウグイス',
  tobi: 'トビ', suzume: 'スズメ', karasu: 'カラス', kaeru: '蛙', koorogi: '虫', kane: '鐘', flockBurst: '羽' };

export function createKamakuraSoundscape(context) {
  const params = new URLSearchParams(context.search);
  if (params.get('soundscape') === '0' || params.get('audio') === '0') return null;
  const audio = context.audioView?.audio, state = createSoundscapeState();
  const requested = params.get('soundtest'), soundtest = requested === 'all' || VOICE_NAMES.includes(requested) ? requested : '';
  const time = atmosphereOptions(context.search).time;
  const weights = Object.fromEntries(HABITAT_KEYS.map(k => [k, 0]));
  const listener = { x: 0, y: 0, z: 0, yaw: 0, ground: 0, high: false, flying: false };
  const options = { limit: soundscapeLimit(context.quality, 0), soundtest }, spatial = {};
  const voices = new Array(7).fill(null);
  let disposed = false, paused = false, running = false, elapsed = 0, habitatElapsed = .5, temple = null;

  function release(v) {
    if (!v || v.released) return;
    v.released = true;
    if (v.source) { v.source.onended = null; if (v.started) v.source.stop(); }
    for (const node of v.nodes) node.disconnect();
    if (v.source) v.source.buffer = null;
    if (voices[v.index] === v) voices[v.index] = null;
    const slot = state.slots[v.index]; if (slot.id === v.id) slot.active = false;
  }
  function stopAll() { for (let i = 0; i < voices.length; i++) release(voices[i]); }
  function silence() {
    stopAll();
    // Preserve natural due times: a mute/pause freezes the schedule instead of rolling it again.
    for (const slot of state.slots) slot.active = false;
    state.quietUntil = state.time + 1.5; state.testDue = state.quietUntil; state.lastX = NaN;
    state.started.length = 0; elapsed = 0; habitatElapsed = .5;
  }
  function consumeEvents(play) {
    const events = context.lifeEvents;
    if (!events) return;
    for (let i = events.length - 1; i >= 0; i--) {
      const event = events[i]; if (event.type !== 'flockBurst') continue;
      if (play && !soundtest && !listener.high && state.time >= state.quietUntil
        && Number.isFinite(event.x) && Number.isFinite(event.y) && Number.isFinite(event.z)) {
        startSoundscapeVoice(state, 'flockBurst', listener, temple, options.limit, false, event);
      }
      events.splice(i, 1);
    }
  }
  function play(slot) {
    release(voices[slot.index]);
    // release of a previous serial cannot invalidate the newly scheduled slot.
    slot.active = true;
    const ctx = audio.context, rate = slot.name === 'kane' ? 12000 : 24000;
    const samples = renderVoice(slot.parts, rate), buffer = ctx.createBuffer(1, samples.length, rate);
    buffer.getChannelData(0).set(samples);
    const v = { index: slot.index, id: slot.id, nodes: [], source: null, released: false, started: false, end: 0 };
    voices[slot.index] = v;
    // Register each acquired node before the next allocation: layer teardown also cleans partial failures.
    const source = ctx.createBufferSource(); v.source = source; v.nodes.push(source); source.buffer = buffer;
    const gain = ctx.createGain(); v.nodes.push(gain); v.gain = gain;
    const filter = ctx.createBiquadFilter(); v.nodes.push(filter); v.filter = filter; filter.type = 'lowpass'; filter.Q.value = .6;
    const pan = ctx.createStereoPanner(); v.nodes.push(pan); v.pan = pan;
    source.connect(gain); gain.connect(filter); filter.connect(pan); pan.connect(audio.ensureBuses().life);
    const t = ctx.currentTime; v.end = t + samples.length / rate + .01;
    sourceSpatial(slot, listener, 0, listener.high, spatial);
    gain.gain.value = SOUNDSCAPE_LEVELS[slot.name] * spatial.gain;
    filter.frequency.value = spatial.hz; pan.pan.value = spatial.pan;
    source.onended = () => release(v);
    source.start(t + .01); v.started = true; source.stop(v.end);
  }
  function trim() {
    let count = 0;
    for (let i = 0; i < voices.length; i++) {
      const v = voices[i]; if (!v) continue;
      const slot = state.slots[i];
      if (slot.name !== 'kane' && (++count > options.limit || (!soundtest && listener.high && !BIRDS.includes(slot.name)))) release(v);
    }
  }
  const debug = () => ({ time: state.time, likelihood: { ...state.likelihood },
    playing: state.slots.filter(s => s.active).map(s => ({ id: s.id, name: s.name, x: s.x, y: s.y, z: s.z, end: s.end })),
    next: Object.fromEntries(VOICE_NAMES.map(name => [name, state.tracks[name].due])) });
  if (params.get('debug') === '1') globalThis.__kzSoundscape = debug;
  return {
    update(frame) {
      if (disposed) return;
      const ctx = audio?.context;
      const ready = !paused && audio?.mix10 && ctx?.state === 'running' && !audio.paused && !audio.muted && audio.listening?.received;
      if (!ready) {
        if (running) silence();
        running = false; consumeEvents(false); return;
      }
      if (!running) { silence(); running = true; }
      elapsed += frame.dt;
      if (elapsed + 1e-8 < .1) return;
      const dt = elapsed; elapsed = 0;
      listener.x = frame.pos.x; listener.y = frame.pos.y; listener.z = frame.pos.z; listener.yaw = frame.yaw;
      listener.flying = frame.flying;
      listener.ground = context.terrain?.heightAt(listener.x, listener.z) ?? listener.y;
      listener.high = frame.flying && listener.y - listener.ground >= 60;
      // Read habitat twice a second, and immediately after a position/camera jump.
      const jump = Number.isFinite(state.lastX) && (Math.hypot(listener.x - state.lastX, listener.y - state.lastY, listener.z - state.lastZ) > 40 || listener.flying !== state.lastFlying);
      habitatElapsed += dt;
      if (habitatElapsed >= .5 - 1e-8 || jump) {
        habitatElapsed = 0;
        context.habitat?.at(listener.x, listener.z, weights);
        temple = context.habitat?.nearestPlace(listener.x, listener.z) ?? null;
        if (temple) temple.y = (context.terrain?.heightAt(temple.x, temple.z) ?? listener.ground) + 3;
      }
      if (jump) stopAll();
      stepSoundscape(state, dt, listener, weights, time, temple, options);
      consumeEvents(true);
      // Sweep before starting: a reused slot is identified by serial, not by object identity.
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i];
        if (v && (!state.slots[i].active || v.id !== state.slots[i].id || v.end <= ctx.currentTime)) release(v);
      }
      for (const slot of state.started) play(slot);
      trim();
      const wind = gustLevel(listener.x, listener.z, frame.time, frame.windDir[0], frame.windDir[1]);
      for (let i = 0; i < voices.length; i++) {
        const v = voices[i]; if (!v) continue;
        const slot = state.slots[i]; sourceSpatial(slot, listener, wind, listener.high, spatial);
        v.gain.gain.setTargetAtTime(SOUNDSCAPE_LEVELS[slot.name] * spatial.gain, ctx.currentTime, .15);
        v.filter.frequency.setTargetAtTime(spatial.hz, ctx.currentTime, .15);
        v.pan.pan.setTargetAtTime(spatial.pan, ctx.currentTime, .08);
      }
    },
    setPaused(on) { paused = !!on; if (paused) { silence(); running = false; consumeEvents(false); } },
    setAdapt(step) { options.limit = soundscapeLimit(context.quality, step); trim(); },
    debugText() {
      let text = '声';
      for (const slot of state.slots) if (slot.active) text += ` ${LABELS[slot.name]}`;
      return text === '声' ? '声 −' : text;
    },
    dispose() {
      if (disposed) return; disposed = true; stopAll();
      if (globalThis.__kzSoundscape === debug) delete globalThis.__kzSoundscape;
    }
  };
}
