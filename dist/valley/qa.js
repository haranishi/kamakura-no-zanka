import { requestGuide } from './wind.js';
// qa.js — 検査用のフック window.__valley（?qa=1 のときだけ入る）。遊びの規則は変えず、状態の読み出し・1コマ送り・入力の注入だけ。
// 自動操作（Playwright）と固定画角の撮影が使う。見えない所で勝敗を書き換える口は置かない（god のみ明示の検査用）。
export function installQA(game, ctl) {
  let specimens = null, specimenRequest = 0;
  const input = game.input;
  const num = v => Math.round(v * 100) / 100;
  game.log = [];
  let recording = false, footRecords = [];
  const counters = { contacts: 0, played: 0, rejected: 0 };
  const timestamp = () => { const ctx = game.audio.context; return { perf: performance.now(), audioTime: ctx?.currentTime ?? null, outputTs: ctx?.getOutputTimestamp?.() ?? null }; };
  game.footQA = {
    contact(c) { counters.contacts++; if (!recording) return null; const record = { ...c, ...timestamp() }; footRecords.push(record); return record; },
    playTime() { return recording ? timestamp() : null; },
    played(record, time, details) {
      if (details.success) counters.played++;
      if (details.rejected) counters.rejected++;
      if (record) Object.assign(record, details, { playStep: time });
    },
  };
  const api = {
    footLog(on) {
      if (on === true) { recording = true; footRecords = []; for (const key of Object.keys(counters)) counters[key] = 0; }
      else if (on === false) recording = false;
      return footRecords.map(r => ({ ...r, playStep: r.playStep ? { ...r.playStep } : null }));
    },
    stepStats() { return { ...counters }; },
    game,
    state() {
      const h = game.hero, f = h.fighter;
      return {
        flow: game.flow, beat: game.quest.beat, objective: game.quest.story.beats[game.quest.beat].objective, time: num(game.time),
        hero: { x: num(h.pos.x), y: num(h.pos.y), z: num(h.pos.z), yaw: num(h.yaw), hp: Math.round(f.hp), posture: Math.round(f.posture), state: f.state, alive: f.alive, speed: num(h.speed), drawn: h.drawn, sword: h.swordLayer ? h.swordLayer.snapshot() : null, crouch: h.crouch, blocking: f.blocking, counter: num(f.counterT), move: f.move?.id || null, phase: f.move?.phase || null },
        camera: { x: num(game.camera.position.x), y: num(game.camera.position.y), z: num(game.camera.position.z), yaw: num(game.rig.yaw) },
        enemies: game.enemies.map(e => ({ id: e.id, kind: e.kind, brain: e.brain.state, state: e.fighter.state, hp: Math.round(e.fighter.hp), posture: Math.round(e.fighter.posture), x: num(e.pos.x), z: num(e.pos.z), mv: e.fighter.move ? { id: e.fighter.move.id, t: num(e.fighter.move.t), phase: e.fighter.move.phase } : null, aware: e.fighter.aware, dormant: !!e.dormant, alive: e.fighter.alive, reported: e.reported, departed: e.departed, morale: Math.round(e.brain.morale), awareness: num(e.brain.awareness) })),
        ally: game.ally ? { role: game.ally.role, mode: game.ally.companion.mode, state: game.ally.companion.state, x: num(game.ally.pos.x), z: num(game.ally.pos.z), hp: Math.round(game.ally.fighter.hp), down: game.ally.down } : null,
        npcs: [...game.npcs.values()].map(n => ({ id: n.id, mode: n.mode, x: num(n.pos.x), z: num(n.pos.z) })),
        resources: { ...game.quest.resources }, flags: { ...game.quest.flags }, checkpoint: game.quest.checkpoint, stats: { ...game.stats },
        talking: game.hud.talking, pending: game.pendingDialogue?.id || null, arrows: game.battle.arrows.length,
        render: { calls: game.renderer.info.render.calls, tris: game.renderer.info.render.triangles },
        opening: game.openingView(),
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
    // 固定カメラ。y は地面からの高さ（m）で渡す（abs=true なら世界の高さ）
    camera(pos, look, fov, abs = false) {
      if (!pos) { game.camOverride = null; return; }
      const h = (x, z) => abs ? 0 : game.terrain.heightAt(x, z);
      game.camOverride = { pos: [pos[0], pos[1] + h(pos[0], pos[2]), pos[2]], look: [look[0], look[1] + h(look[0], look[2]), look[2]], fov };
    },
    god(on = true) { game.god = on; },
    advanceDialogue(all = true) { let n = 0; while (game.hud.talking && n++ < 20) { game.hud.advanceDialogue(); if (!all) break; } },
    quality(q) { ctl.quality(q); },
    guideView() { return game.guideView(); },
    setGuidePlan(plan) { game.setGuidePlan(plan); return game.guideView(); },
    setWaymarks(level) { game.setWaymarks(level); return game.guideView(); },
    pressGuide() { return game.pressGuide(); },
    async treeSpecimens(opts = {}) {
      const request = ++specimenRequest;
      const [{ buildSpecimens }, { ATMOS }] = await Promise.all([import('./tree-view.js'), import('./atmosphere.js')]);
      if (request !== specimenRequest) return { items: [] };
      const next = buildSpecimens({ ...opts, terrain: game.terrain, wind: game.veg.wind, sunDir: ATMOS.sunDir, quality: game.post.quality });
      specimens?.dispose(); specimens = next; game.scene.add(next.group);
      return { items: next.items };
    },
    clearTreeSpecimens() { specimenRequest++; specimens?.dispose(); specimens = null; },
    treeStats() {
      const trees = game.veg.trees, bySpecies = {}, byShape = {}, tris = {};
      let total = 0;
      for (const set of trees.sets) {
        const key = ['cedar', 'zelkova', 'pine', 'maple', 'sapling', 'shrub'][set.species];
        bySpecies[key] ??= [0, 0, 0]; tris[key] ??= [0, 0, 0];
        bySpecies[key][set.level] += set.leaf.count;
        byShape[key] ??= {}; byShape[key][set.shape ?? 0] ??= [0, 0, 0];
        byShape[key][set.shape ?? 0][set.level] += set.leaf.count;
        let count = 0;
        for (const mesh of [set.leaf, set.wood]) if (mesh) count += mesh.count * (mesh.geometry.index ? mesh.geometry.index.count : mesh.geometry.attributes.position.count) / 3;
        tris[key][set.level] += count; total += count;
      }
      return { stats: { ...trees.stats }, bySpecies, byShape, tris, total };
    },
    meadowCover() { return ctl.meadowCover(); },
    grassStats() { return game.veg.grass.stats(); },
    windState() { return JSON.parse(JSON.stringify(game.wind)); },
    guideWind(dir) {
      if (dir === null) return { state: api.windState(), accepted: false, reason: '指定なし' };
      const result = requestGuide(game.wind, dir);
      game.wind = result.state;
      return { ...result, state: api.windState() };
    },
    // R14.8 の仕様の値：1800コマ・活動時間1/60秒。暖機・集計は呼出側が担う。
    perfSamples(frames = 1800, dt = 1 / 60) {
      if (!Number.isInteger(frames) || frames <= 0 || !Number.isFinite(dt) || dt <= 0) throw new RangeError('測定コマ数とdtは正の有限値が必要です');
      const renderer = game.renderer, gl = renderer.getContext(), px = new Uint8Array(4);
      const ms = new Float64Array(frames), calls = new Uint32Array(frames), tris = new Uint32Array(frames);
      for (let i = 0; i < frames; i++) {
        const start = performance.now();
        game.update(dt); game.render(dt);
        calls[i] = renderer.info.render.calls; tris[i] = renderer.info.render.triangles;
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        ms[i] = performance.now() - start;
      }
      return { frames, dt, ms: Array.from(ms), calls: Array.from(calls), tris: Array.from(tris),
        quality: game.post.quality, w: renderer.domElement.width, h: renderer.domElement.height, dpr: renderer.getPixelRatio() };
    },
    // 1コマの重さ（ms）。1画素を読み戻してGPUの完了まで待つので、描画の実コストに近い
    perf(n = 120, dt = 1 / 60) {
      const gl = game.renderer.getContext(), px = new Uint8Array(4); let tu = 0, tr = 0, tt = 0, worst = 0;
      for (let i = 0; i < n; i++) {
        const a = performance.now(); game.update(dt); const b = performance.now(); game.render(dt); const c = performance.now(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const d = performance.now();
        tu += b - a; tr += c - b; tt += d - a; worst = Math.max(worst, d - a);
      }
      const i = game.renderer.info.render, m = game.renderer.info.memory;
      return { updateMs: num(tu / n), renderSubmitMs: num(tr / n), frameMs: num(tt / n), worstMs: num(worst), fps: Math.round(1000 / (tt / n)), calls: i.calls, tris: i.triangles, geometries: m.geometries, textures: m.textures };
    },
  };
  window.__valley = api;
  return api;
}
