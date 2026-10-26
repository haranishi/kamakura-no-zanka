// qa.js — 検査用のフック window.__valley（?qa=1 のときだけ入る）。遊びの規則は変えず、状態の読み出し・1コマ送り・入力の注入だけ。
// 自動操作（Playwright）と固定画角の撮影が使う。見えない所で勝敗を書き換える口は置かない（god のみ明示の検査用）。
export function installQA(game, ctl) {
  const input = game.input;
  const num = v => Math.round(v * 100) / 100;
  game.log = [];
  const api = {
    game,
    state() {
      const h = game.hero, f = h.fighter;
      return {
        flow: game.flow, beat: game.quest.beat, objective: game.quest.story.beats[game.quest.beat].objective, time: num(game.time),
        hero: { x: num(h.pos.x), y: num(h.pos.y), z: num(h.pos.z), yaw: num(h.yaw), hp: Math.round(f.hp), posture: Math.round(f.posture), state: f.state, alive: f.alive, speed: num(h.speed), drawn: h.drawn, crouch: h.crouch, blocking: f.blocking, move: f.move?.id || null, phase: f.move?.phase || null },
        camera: { x: num(game.camera.position.x), y: num(game.camera.position.y), z: num(game.camera.position.z), yaw: num(game.rig.yaw) },
        enemies: game.enemies.map(e => ({ id: e.id, kind: e.kind, brain: e.brain.state, state: e.fighter.state, hp: Math.round(e.fighter.hp), posture: Math.round(e.fighter.posture), x: num(e.pos.x), z: num(e.pos.z), aware: e.fighter.aware, dormant: !!e.dormant, alive: e.fighter.alive, reported: e.reported, departed: e.departed, morale: Math.round(e.brain.morale), awareness: num(e.brain.awareness) })),
        ally: game.ally ? { role: game.ally.role, mode: game.ally.companion.mode, state: game.ally.companion.state, x: num(game.ally.pos.x), z: num(game.ally.pos.z), hp: Math.round(game.ally.fighter.hp), down: game.ally.down } : null,
        npcs: [...game.npcs.values()].map(n => ({ id: n.id, mode: n.mode, x: num(n.pos.x), z: num(n.pos.z) })),
        resources: { ...game.quest.resources }, flags: { ...game.quest.flags }, checkpoint: game.quest.checkpoint, stats: { ...game.stats },
        talking: game.hud.talking, pending: game.pendingDialogue?.id || null, arrows: game.battle.arrows.length,
        render: { calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles },
      };
    },
    step(n = 1, dt = 1 / 60) { for (let i = 0; i < n; i++) game.update(dt); game.render(dt); return api.state(); },
    freeze(on = true) { ctl.setFrozen(on); },
    start(mode = 'new') { ctl.start(mode); },
    key(code, down = true) { if (down) { input.pressed.add(code); input.held.add(code); } else input.held.delete(code); },
    tap(code, frames = 1) { input.pressed.add(code); input.held.add(code); api.step(frames); input.held.delete(code); },
    click(button = 0, hold = false) { input.mousePressed.add(button); input.mouse.add(button); if (!hold) { api.step(1); input.mouse.delete(button); } },
    release(button = 0) { input.mouse.delete(button); },
    look(yaw, pitch) { if (yaw != null) game.rig.yaw = yaw; if (pitch != null) game.rig.pitch = pitch; },
    teleport(x, z, yaw = game.hero.yaw) { game.hero.place(x, z, yaw); game.rig.yaw = yaw; game.rig.snap(); },
    dispatch(event) { game.dispatch(event); return api.state(); },
    camera(pos, look, fov) { game.camOverride = pos ? { pos, look, fov } : null; },
    god(on = true) { game.god = on; },
    advanceDialogue(all = true) { let n = 0; while (game.hud.talking && n++ < 20) { game.hud.advanceDialogue(); if (!all) break; } },
    quality(q) { ctl.quality(q); },
  };
  window.__valley = api;
  return api;
}
