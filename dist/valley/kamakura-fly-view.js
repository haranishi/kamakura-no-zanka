// Kamakura-only camera/view adapter. Owns no GPU resources.
import { createFly, flyAction, stepFly, topFov } from './kamakura-fly.js';
export function createKamakuraFlight({ search, terrain, spawn, camera, rig, hero, chunks, houses, trees, stands, water, atmosphere, hud, hint }) {
  let state = createFly(search, terrain, spawn), disposed = false, shownMode = null;
  const walkFar = camera.far, walkFov = camera.fov, walkNear = camera.near;
  function apply() {
    const active = state.mode !== 'walk';
    hero.character.root.visible = !active; chunks.setFlying(active);
    const far = active ? 30000 : walkFar;
    const fov = state.mode === 'top' ? topFov(terrain.bounds, camera.aspect, Math.max(0, terrain.meta.height.max_m * terrain.vscale)) : (state.mode === 'fly' && state.fov) || walkFov;
    // High up, a 0.15m near plane leaves too little depth precision (the sea plane flickers against the sea floor).
    // The near plane grows with the height above the ground: 0.4% of it, at most 60m. Walking keeps the original value.
    const near = active ? Math.min(60, Math.max(walkNear, Math.max(0, state.pose.pos.y - terrain.heightAt(state.pose.pos.x, state.pose.pos.z)) * .004)) : walkNear;
    if (camera.far !== far || camera.fov !== fov || Math.abs(camera.near - near) > near * .05) { camera.far = far; camera.fov = fov; camera.near = near; camera.updateProjectionMatrix(); }
    if (active) {
      const p = state.pose; camera.position.copy(p.pos);
      camera.rotation.set(-p.pitch, p.yaw, 0, 'YXZ'); camera.updateMatrixWorld(true);
    }
    if (shownMode !== state.mode) { hud.setFlight(active, state.mode === 'top'); shownMode = state.mode; }
  }
  function action(key) {
    if (disposed) return;
    // Read the rendered orientation, including the walking rig's actual look target.
    const e = camera.rotation.clone(); e.reorder('YXZ');
    const eye = { pos: { x: camera.position.x, y: camera.position.y, z: camera.position.z }, yaw: e.y, pitch: -e.x };
    const old = state; state = flyAction(state, key, terrain, eye);
    if (key === 'G' && old.mode !== 'walk') {
      if (state.mode !== 'walk') hint('ここは歩けません');
      else { hero.place(state.landing.x, state.landing.z, state.landing.yaw); rig.yaw = state.landing.yaw; rig.pitch = .2; }
    }
    if (old.mode !== state.mode) {
      hero.speed = hero.locoV = hero.locoA = 0;
      if (state.mode === 'walk') rig.snap();
    }
    apply();
  }
  apply();
  return {
    action, get state() { return state; }, get active() { return state.mode !== 'walk'; },
    get pos() { return state.mode === 'walk' ? hero.pos : camera.position; },
    get yaw() { return state.mode === 'walk' ? rig.yaw : state.pose.yaw; },
    step(input, dt) { if (!disposed) { state = stepFly(state, input, dt, terrain.heightAt); apply(); } },
    resize() { if (!disposed) apply(); },
    updateViews(time, dt) {
      if (disposed) return;
      const pos = state.mode === 'walk' ? hero.pos : camera.position, yaw = state.mode === 'walk' ? rig.yaw : state.pose.yaw;
      chunks.update(pos); houses?.update(pos); trees?.update(camera); stands?.update(camera);
      water?.update(time); // Rivers are static ribbons; camera frustum/far handles culling.
      atmosphere.update(camera, dt, pos, yaw);
    },
    dispose() { if (disposed) return; disposed = true; state = { ...state, mode: 'walk' }; apply(); }
  };
}

export function bindKamakuraFlight({ flight, input, hud, element, paused, signal }) {
  const act = key => { if (!paused()) { flight.action(key); input.clear(); input.base.wheel = 0; } };
  for (const [button, key] of [[hud.toggle, 'F'], [hud.top, 'M'], [hud.land, 'G']]) button.addEventListener('click', () => act(key), { signal });
  globalThis.addEventListener('keydown', e => {
    if (e.target?.closest?.('input,select,textarea,dialog,[contenteditable="true"]')) return;
    const key = { KeyF: 'F', KeyM: 'M', KeyG: 'G', KeyR: 'R' }[e.code];
    if (key && !e.repeat) { e.preventDefault(); act(key); }
  }, { signal });
  element.addEventListener('wheel', e => {
    if (flight.active && !paused()) { e.preventDefault(); flight.step({ speedSteps: -Math.sign(e.deltaY) }, 0); }
  }, { passive: false, signal });
}
