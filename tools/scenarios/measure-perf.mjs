import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { summarize, judgeRun } from '../../dist/valley/perf-stats.js';

export default async function ({ page, out, start, freeze, log }) {
  const scene = process.env.PERF_SCENE || 'move', run = Number(process.env.PERF_RUN || 1);
  // 8.3a：PERF_TRAILS=off で刃の軌跡を止めて比べる（同じ手順の前後比較用）。軌跡の処理時間（毎コマのms）は常に測って残す
  const trails = process.env.PERF_TRAILS === 'off' ? 'off' : 'on';
  if (!['move', 'combat'].includes(scene) || ![1, 2].includes(run)) throw Error('PERF_SCENE=move|combat PERF_RUN=1|2 required');
  let power = '取得不可（macOS以外）';
  if (process.platform === 'darwin') {
    // 電池の個体ID（id=数字）は機器の識別子なので、記録から除く。
    try { power = execFileSync('pmset', ['-g', 'batt'], { encoding: 'utf8' }).trim().replace(/\(id=\d+\)/g, '(id=省略)'); }
    catch { power = 'pmset -g batt 失敗（測定は続行）'; }
  }
  await start('new'); await freeze(true);
  const result = await page.evaluate(async ({ scene, run, trails }) => {
    const qa = window.__valley, g = qa.game;
    const [{ mulberry32 }, { createWind }, { createQuest, reduce }, { MOVES }] = await Promise.all([
      import('/valley/scatter.js'), import('/valley/wind.js'), import('/valley/quest.js'), import('/valley/combat.js')]);
    // design-validation.md「性能」の仕様値。
    const DT = 1 / 60, WARM = 600, FRAMES = 1800, SEED = 1333;
    // 未測定の検査設計：折れ点通過半径.6m、受け時間.6秒、停止検出180コマ。
    const ARRIVAL = 0.6, BLOCK_SECONDS = 0.6, STALL_FRAMES = 180;
    const gl = g.renderer.getContext(), ext = gl.getExtension('WEBGL_debug_renderer_info');
    const environment = { chrome: navigator.userAgent, gpu: ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : 'UNMASKED_RENDERER unavailable',
      viewport: { width: innerWidth, height: innerHeight }, css: { width: g.renderer.domElement.clientWidth, height: g.renderer.domElement.clientHeight },
      dpr: devicePixelRatio, query: location.search };
    if (innerWidth !== 1280 || innerHeight !== 720 || devicePixelRatio !== 1 || !new URLSearchParams(location.search).has('w')) throw Error('fixed viewport/DPR/autoscale contract violated');
    const originalUpdate = g.update, originalZones = g.updateZones, originalReport = g.reportDown, originalRandom = Math.random;
    let frame, target, direction, combo, blockingSince, previousMove, stalled, previousPos, previousVisible, swaps, laps, inputs, positions, refills, enemyInitial;
    const road = g.world.roads.forest.points.map(([x, z]) => ({ x, z }));
    const route = [g.world.zones.temple_steps, ...road, g.world.zones.village_front].map(p => ({ x: p.x, z: p.z }));
    const initialIndex = run === 1 ? 0 : Math.floor(route.length / 2);
    const initialHero = scene === 'move' ? route[initialIndex] : run === 1 ? g.world.zones.village_front : { x: -32, z: -8 }; // 2回目位置は未測定の設計値（正面入口の内側）
    function reset() {
      g.update = originalUpdate; g.updateZones = originalZones; g.reportDown = originalReport;
      g.input.clear(); qa.advanceDialogue(true);
      for (const timer of g.hud.timers.values()) timer.fn();
      g.hud.timers.clear(); g.hud.hintsShown.clear(); g.hud.updateMarkers([]);
      g.hud.hideResult(); g.flow = 'idle'; g.startNew();
      qa.advanceDialogue(true); g.pendingDialogue = null; g.timers = []; g.cine = null; g.intro = null;
      // Battleの初期値は現行constructorを継承（barkAt=-9, lastAlertAt=-99）。
      g.battle.barkAt = -9; g.battle.lastAlertAt = -99;
      g.time = 0; g.stopT = 0; g.noises = []; g.fxT = 0; g.chimneyT = 0; g.pillageT = 0;
      g.rng = mulberry32(SEED); Math.random = mulberry32(SEED); g.wind = createWind();
      // 暖機中の粒・軌跡を残さず、GPU側の作成済み資源は保持。
      for (const cloud of [g.fx.add, g.fx.norm]) { cloud.count = 0; cloud.geometry.setDrawRange(0, 0); }
      g.fx.trails?.clear?.(); trailMs.length = 0;
      g.quest = createQuest();
      for (const event of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' },
        ...(scene === 'combat' ? [{ type: 'arrived', place: 'viewpoint' }, { type: 'choose_plan', plan: 'front' }, { type: 'enter_zone', zone: 'village_front' }] : [])]) g.quest = reduce(g.quest, event).state;
      // CameraRigと主人公の動作時計も初期化。人物のGPU資源はそのまま暖機を保つ。
      g.rig = new g.rig.constructor(g.camera);
      const ch = g.hero.character;
      ch.mixer.stopAllAction(); ch.mixer.time = 0; ch.current = null; ch.currentName = null;
      ch.segment = null; ch.onSegmentEnd = null; ch.time = 0;
      g.placeHeroAt({ ...initialHero, yaw: scene === 'move' ? 0 : -Math.PI / 2 });
      g.buildWorld(); // 敵のlastSeenを同じ初期主人公位置から作る
      g.lastLookT = -Infinity; g.log = []; g.markerT = 0; g.listenerT = 0; g.promptKey = ''; g.enemySnaps = null; g.enemySnapsAt = -1;
      g.flow = 'play'; g.paused = false; qa.camera(null); qa.god(true); qa.look(g.hero.yaw, 0.2); // pitch=.2は現行placeHeroAtの値
      g.updateZones = () => {}; // 測定中はb2/b4を固定。任務完走試験とは分ける（仕様）。
      g.reportDown = e => { e.reported = 'measurement'; g.tokens.release(e.id); g.aiWorld.forget(e.id); };
      frame = 0; target = initialIndex; direction = run === 1 ? 1 : -1; combo = 0; blockingSince = null; previousMove = null;
      stalled = 0; previousPos = { ...g.hero.pos }; previousVisible = new Set(); swaps = { entered: 0, exited: 0 }; laps = 0;
      inputs = []; positions = []; refills = [];
      enemyInitial = g.enemies.filter(e => e.group === 'village_enemies').map(e => ({ def: structuredClone(e.def), fighter: structuredClone(e.fighter), brain: structuredClone(e.brain) }));
      g.veg.trees.last.set(Infinity, Infinity); g.updateWorld(0); // LODも初期位置へ戻す
    }
    const input = (kind, detail = {}) => inputs.push({ frame, kind, ...detail });
    // 刃の軌跡の処理時間（battle.updateTrails の1コマぶん）。止めるときは、何もしない関数に替える
    const trailMs = [], realTrails = g.battle.updateTrails?.bind(g.battle);
    if (realTrails) g.battle.updateTrails = trails === 'off' ? () => {} : () => { const t0 = performance.now(); realTrails(); trailMs.push(performance.now() - t0); };
    function driveMove() {
      let p = route[target], h = g.hero.pos;
      if (Math.hypot(p.x - h.x, p.z - h.z) < ARRIVAL) {
        if (target + direction < 0 || target + direction >= route.length) { direction *= -1; laps++; }
        target += direction; p = route[target]; input('waypoint', { target, direction });
      }
      const yaw = Math.atan2(-(p.x - h.x), -(p.z - h.z));
      qa.look(yaw, 0.2); g.input.held.add('KeyW'); g.input.held.add('ShiftLeft');
      if (frame === 0) input('run', { held: ['KeyW', 'ShiftLeft'] });
    }
    function replenish() {
      for (const e of [...g.enemies]) if (e.group === 'village_enemies' && (!e.fighter.alive || e.departed || ['retreat', 'surrendered'].includes(e.brain.state))) {
        const initial = enemyInitial.find(s => s.def.id === e.id);
        g.tokens.release(e.id); g.aiWorld.forget(e.id); e.remove(); g.enemies.splice(g.enemies.indexOf(e), 1);
        const fresh = new e.constructor(g, structuredClone(initial.def), { alert: 'high' });
        fresh.fighter = structuredClone(initial.fighter); fresh.brain = structuredClone(initial.brain); fresh.dormant = false;
        g.enemies.push(fresh); refills.push({ frame, id: e.id });
      }
    }
    function driveCombat() {
      replenish();
      const enemies = g.enemies.filter(e => e.group === 'village_enemies' && e.fighter.alive && !e.dormant);
      if (enemies.length !== 5) throw Error('combat must retain five active enemies'); // 仕様の値
      const nearest = [...enemies].sort((a, b) => Math.hypot(a.pos.x - g.hero.pos.x, a.pos.z - g.hero.pos.z) - Math.hypot(b.pos.x - g.hero.pos.x, b.pos.z - g.hero.pos.z))[0];
      const yaw = Math.atan2(-(nearest.pos.x - g.hero.pos.x), -(nearest.pos.z - g.hero.pos.z));
      g.hero.yaw = yaw; qa.look(yaw, 0.2);
      const f = g.hero.fighter;
      if (blockingSince !== null) {
        if (frame - blockingSince >= BLOCK_SECONDS / DT && f.counterT <= 0) { g.input.mouse.delete(2); blockingSince = null; combo = 0; input('block-release'); }
        return;
      }
      const m = f.move;
      if (m?.id !== previousMove) { if (m) input('move-started', { move: m.id }); previousMove = m?.id; }
      if (combo === 0 && f.state === 'idle' && !f.blocking) { g.input.mousePressed.add(0); combo = 1; input('light1'); }
      else if (m && ['light1', 'light2'].includes(m.id)) {
        const next = m.id === 'light1' ? 'light2' : 'light3', n = m.id === 'light1' ? 2 : 3, move = MOVES[m.id];
        // 現行combatの仕様：三連の次段は終了後でなくrecoverのchainWindow内に入力する。
        if (combo < n && m.phase === 'recover' && m.t >= move.windup + move.active + move.recover - MOVES[next].chainWindow) {
          g.input.mousePressed.add(0); combo = n; input(next);
        }
      } else if (combo > 0 && f.state === 'idle') { g.input.mouse.add(2); blockingSince = frame; input('block'); }
    }
    function install() {
      g.update = function (dt) {
        if (scene === 'move') driveMove(); else driveCombat();
        originalUpdate.call(g, dt);
        if (scene === 'combat') replenish(); // 死亡したコマの描画前にも5体へ戻す
        const h = g.hero.pos, moved = Math.hypot(h.x - previousPos.x, h.z - previousPos.z);
        if (scene === 'move') { stalled = moved < 0.001 ? stalled + 1 : 0; if (stalled >= STALL_FRAMES) throw Error(`movement stalled at waypoint ${target}`); }
        previousPos = { ...h };
        const visible = new Set((g.veg.grass.group ?? g.veg.grass).children.filter(m => m.visible).map(m => m.id));
        if (frame > 0) { for (const id of visible) if (!previousVisible.has(id)) swaps.entered++; for (const id of previousVisible) if (!visible.has(id)) swaps.exited++; }
        previousVisible = visible;
        positions.push({ frame, x: h.x, y: h.y, z: h.z, target, direction, activeEnemies: g.enemies.filter(e => e.group === 'village_enemies' && e.fighter.alive && !e.dormant).length });
        frame++;
      };
    }
    try {
      reset(); install();
      const warmStart = performance.now(); qa.perfSamples(WARM, DT); const warmSeconds = (performance.now() - warmStart) / 1000;
      reset(); install();
      const initial = { hero: { ...g.hero.pos }, beat: g.quest.beat, route, initialIndex, direction, enemies: enemyInitial };
      const begin = performance.now(), samples = qa.perfSamples(FRAMES, DT), seconds = (performance.now() - begin) / 1000;
      if (scene === 'combat' && (!inputs.some(i => i.kind === 'move-started' && i.move === 'light3') || !inputs.some(i => i.kind === 'block'))) throw Error('weak triple/block cycle not observed');
      const sortedTrail = [...trailMs].sort((a, b) => a - b), q = p => sortedTrail.length ? sortedTrail[Math.max(0, Math.ceil(p * sortedTrail.length) - 1)] : null;
      const trailCost = { trails, frames: trailMs.length, meanMs: trailMs.length ? trailMs.reduce((a, b) => a + b, 0) / trailMs.length : null, p95Ms: q(0.95), maxMs: q(1) };
      if (samples.w !== 1280 || samples.h !== 720 || samples.dpr !== 1) throw Error('render resolution contract violated');
      return { scene, run, seed: SEED, environment, initial, trailCost, variation: run === 1 ? '基準開始点・正順' : scene === 'move' ? '道筋の中点・逆順開始' : '正面入口内側(-32,-8)開始',
        warmup: { frames: WARM, seconds: warmSeconds, excluded: true }, seconds, samples, inputs, positions, refills, chunkSwaps: swaps, endpointTurns: laps,
        instrumentation: 'game.update内に入力制御・記録・補充を含む。grass.children.visibleの入替を計数（視錐台除外・新規生成の回数ではない）。',
        scope: 'このOS・Chrome・GPU・電源・ヘッドレスの条件だけ。他端末へ当てはめない。' };
    } finally { g.update = originalUpdate; g.updateZones = originalZones; g.reportDown = originalReport; Math.random = originalRandom; g.input.clear(); if (realTrails) delete g.battle.updateTrails; }
  }, { scene, run, trails });
  result.environment.os = { platform: os.platform(), release: os.release(), arch: os.arch(), cpu: os.cpus()[0]?.model || 'unknown' };
  result.environment.chromeVersion = page.context().browser().version(); result.environment.power = power;
  result.quality = result.samples.quality;
  result.summary = { ms: summarize(result.samples.ms), calls: summarize(result.samples.calls), tris: summarize(result.samples.tris) };
  result.judgement = judgeRun(result.samples, result.quality);
  await fs.writeFile(path.join(out, 'samples.json'), JSON.stringify(result, null, 2) + '\n');
  log(JSON.stringify({ scene, run, quality: result.quality, seconds: result.seconds, ...result.judgement, trailCost: result.trailCost }));
}
