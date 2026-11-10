// Kamakura-only practice swings. Reuse the chapter actor, collision and trail renderer.
import { SlashTrails } from './fx.js';
import { MOVES } from './combat.js';
import { inTrailWindow, trailStyleFor } from './slash-trail.js';

export function createKamakuraHeroMoves({ game: g, hero, input, flight, search = '' }, { eventTarget = globalThis } = {}) {
  const params = new URLSearchParams(search);
  if (params.get('moves') === '0') return null;
  const trails = new SlashTrails(g.scene), saved = [];
  const calls = { alertedEnemies: 0, 'hud.toast': 0, emitNoise: 0, 'battle.onStrike': 0, hitStop: 0, 'rig.kick': 0, 'rig.punchFov': 0 };
  const stub = (name, result) => () => { calls[name]++; return result; };
  function install(object, key, value) {
    saved.push([object, key, Object.getOwnPropertyDescriptor(object, key)]);
    Object.defineProperty(object, key, { configurable: true, writable: true, enumerable: true, value });
  }
  // No Battle is constructed: there are no targets, story, damage or save state.
  install(g, 'alertedEnemies', stub('alertedEnemies', 0));
  install(g.hud, 'toast', stub('hud.toast'));
  install(g, 'emitNoise', stub('emitNoise'));
  install(g, 'battle', { onStrike: stub('battle.onStrike') });
  install(g, 'hitStop', stub('hitStop'));
  install(g, 'rig', { kick: stub('rig.kick'), punchFov: stub('rig.punchFov') });
  let paused = false, flying = !!flight?.active, disposed = false, resetting = false, heavy = false, time = 0;
  const filtered = {
    down: code => !paused && !flying && input.down(code),
    wasPressed: code => !paused && !flying && ((code === 'KeyF' && (heavy || input.wasPressed(code))) || (code === 'Space' && input.wasPressed(code))),
    mouseWasPressed: button => !paused && !flying && button === 0 && input.mouseWasPressed(button),
    mouseDown: button => !paused && !flying && button === 2 && input.mouseDown(button),
  };
  const ctl = { input: filtered, axis: null, moveYaw: 0, talking: false, frozen: false };
  function reset() {
    if (resetting) return;
    resetting = true;
    try {
      hero.reset(hero.pos.x, hero.pos.z, hero.yaw);
      hero.foe = null; hero.ctl = null; hero.character.locomote(0, 'relaxed');
      trails.clear(); heavy = false;
    } finally { resetting = false; }
  }
  const place = hero.place;
  install(hero, 'place', function (x, z, yaw = this.yaw) {
    if (!resetting) reset();
    return place.call(this, x, z, yaw);
  });
  // The existing flight binding uses F even on foot. Reserve its keyboard event for
  // heavy swings on foot; the flight button and F while flying keep their meaning.
  function heavyKey(event) {
    if (disposed || paused || input.base?.enabled === false || flight?.active || event.code !== 'KeyF' || event.target?.closest?.('button,input,select,textarea,dialog,[contenteditable="true"]')) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!event.repeat) heavy = true;
  }
  eventTarget.addEventListener?.('keydown', heavyKey, true);
  const debug = () => ({ calls: { ...calls }, state: hero.fighter.state, drawn: hero.drawn });
  if (params.get('debug') === '1') globalThis.__kzMoves = debug;
  return {
    update(dt, axis, moveYaw) {
      if (disposed || paused || flying) return;
      ctl.axis = axis; ctl.moveYaw = moveYaw;
      time += dt;
      hero.update(dt, ctl); heavy = false;
    },
    // Called after finishPose: the sword holder must include legs, sword IK and grip.
    afterPose(camera) {
      if (disposed || paused || flying) return;
      trails.clock[0] = time;
      const f = hero.fighter, ch = hero.character, w = ch.weapons.tachiDrawn;
      if (w && f.alive && !hero.departed && w.holder.visible && !ch.sword?.active && f.state === 'attack' && f.move) {
        const m = MOVES[f.move.id];
        if (m.kind === 'melee' && inTrailWindow(m, f.move.t)) trails.sample(f.move, trailStyleFor(m.id, f.team), w.holder);
      }
      trails.update(camera);
    },
    setPaused(on) { if (!disposed) { paused = !!on; if (on) reset(); } },
    setFlying(on) { if (!disposed && flying !== !!on) { flying = !!on; reset(); } },
    dispose() {
      if (disposed) return; disposed = true;
      eventTarget.removeEventListener?.('keydown', heavyKey, true);
      trails.clear(); trails.mesh.removeFromParent(); trails.geometry.dispose(); trails.mesh.material.dispose();
      for (let i = saved.length - 1; i >= 0; i--) {
        const [object, key, descriptor] = saved[i];
        if (descriptor) Object.defineProperty(object, key, descriptor); else delete object[key];
      }
      if (globalThis.__kzMoves === debug) delete globalThis.__kzMoves;
    },
  };
}
