// 回帰（M4・design-locomotion-camera.md）：追従カメラ。実ゲームで、同じページの ?smooth=camera（M3 のカメラ）と比べる。物差しは tools/lib/smooth-metrics.mjs。
//  1. 台本（smooth-journey）：カメラ位置の加加速度p99（視点を回した窓を外す）が M3 より10%以上小さい。回転の角加速度は悪化させない。主人公の画面上の流れ（yRange）を
//     増やさない（遅れを増やして滑らかに見せる逃げを止める）。画角は既定で58度のまま（?fov=on では走りで+3度・立ちで58度）。論理の位置・速さ・歩容は M3 と全コマ同じ。
//  2. 場面（棚田の段の下り・登り、土手の斜面、壁から離れる、壁の角を走り抜ける）：カメラの1コマの動きが主人公の1コマの動き＋15cm を超えない（壁際で瞬間に寄せない。M3 は壁の角で1.18m。追いつく・寄せる動きは0.1m前後）、
//     棚田でカメラの上下の加速度が M3 の6割以下、各場面の加加速度の最大が M3 を超えない、画面の主人公が遮られない（注視点からカメラの線の当たり）、地面から0.55m下へ潜らない。
//  2b. 木の間（木が密な空き地を走る）：寄せの割合が下限（主人公から MIN_REACH）を割らない・1コマの寄せが旧版より大きくない。
//  3. 設定：画角は既定で広げない（58度のまま）。?fov=on でだけ走りで+3度。そのとき「画面の揺れ・衝撃」0・「動きを減らす」で広げない・揺れ0.5で半分まで・?smooth=camera は58度のまま。
//  4. 30・60・144コマ/秒で、走り→止まりのカメラ（画角・主人公との距離・止まった後の位置）が極端に変わらない。
// 門番の確かめ（2026-11-04）：先回りを切る（cfg.predict=0）と2の壁の角で、上下を1段に戻す（cfg.wy1=1e6）と2の棚田で、寄せの下限を外す（cfg.hold=0）と2bの木の間で、画角が揺れの設定を読まないと3で、それぞれ失敗する（KZ_MUTATE=predict|vertical|hold|fov で再現）。
// 使い方: PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-locomotion-camera.mjs --strict --out <dir>（KZ_OUT=… でJSON。KZ_MUTATE=predict|vertical|hold|fov で門番の確かめ）
import fs from 'node:fs';
import { prepare, recordJourney, OPTS } from './smooth-journey.mjs';
import { smoothMetrics, cameraView } from '../lib/smooth-metrics.mjs';

const fail = [];
const check = (ok, msg) => { if (!ok) fail.push(msg); };
const W = { KeyW: true, ShiftLeft: false }, RUN = { KeyW: true, ShiftLeft: true };
// 場所：棚田と土手は capture-ledge・regress-locomotion-ik と同じ。壁は家（house2）の南の面：背を壁に付けて走り去る／面から0.7mを角の外から走り抜ける
export const ROUTES = [
  { name: 'terrace_run', x: 0, z: 52, yaw: Math.PI, keys: RUN, secs: 3.0, steps: true },
  { name: 'terrace_up_run', x: 0, z: 62, yaw: 0, keys: RUN, secs: 3.0, steps: true },
  { name: 'bank_slope', x: -64.2, z: -25.0, yaw: -Math.PI / 2, keys: W, secs: 2.0 },
  { name: 'wall_away', x: 11.02, z: -13.6, yaw: 2.92, keys: RUN, secs: 2.5 },
  { name: 'wall_pass', x: 18.41, z: -12.27, yaw: 1.35, keys: RUN, secs: 3.0, wall: true },
];
const STEP_SLACK = 0.15, Y_ACC_RATIO = 0.6, JERK_RATIO = 0.9, DRIFT_SLACK = 0.005;

// 場面を1回：KZ_PRE 相当の立ち時間のあと、keys を secs 秒押して離し、1秒待つ。毎コマの論理の位置・カメラ・遮られ方・カメラの下の地面を返す
export function recordRoute(v, r, hz = 60, pre = 150) {
  return v(`(() => {
    const g = __valley.game, h = g.hero, r = ${JSON.stringify(r)}, dt = 1 / ${hz};
    for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) __valley.key(k, false);
    h.crouch = false; h.place(r.x, r.z, r.yaw); h.speed = 0; g.rig.yaw = r.yaw; g.rig.pitch = 0.2; g.rig.snap();
    for (let i = 0; i < Math.round(${pre} * ${hz} / 60); i++) __valley.step(1, dt);
    for (const [k, on] of Object.entries(r.keys)) __valley.key(k, on);
    const frames = [], c = g.camera, n = Math.round(r.secs * ${hz});
    for (let i = 0; i < n + ${hz}; i++) {
      if (i === n) for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) __valley.key(k, false);
      __valley.step(1, dt);
      const f = g.rig.focus, p = c.position;
      frames.push({ t: i * dt, tag: r.name, pos: [h.pos.x, h.pos.y ?? 0, h.pos.z], speed: h.speed,
        cam: [p.x, p.y, p.z, c.quaternion.x, c.quaternion.y, c.quaternion.z, c.quaternion.w, c.fov],
        ground: g.terrain.heightAt(p.x, p.z), clear: __valley.rayClear ? __valley.rayClear([f.x, f.y, f.z], [p.x, p.y, p.z]) : null, clipped: g.rig.clipped, tMin: g.rig.tMin ?? null });
    }
    for (const k of ['KeyW', 'KeyS', 'ShiftLeft']) __valley.key(k, false);
    return { dt, aspect: c.aspect, frames };
  })()`);
}

// 1コマの動き（m）の最大と、主人公の1コマの動きを超えた分の最大
function stepStats(frames) {
  let camMax = 0, over = 0;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i].cam, b = frames[i - 1].cam, d = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    const hp = Math.hypot(frames[i].pos[0] - frames[i - 1].pos[0], frames[i].pos[1] - frames[i - 1].pos[1], frames[i].pos[2] - frames[i - 1].pos[2]);
    camMax = Math.max(camMax, d); over = Math.max(over, d - hp);
  }
  return { camMax, over };
}
function jerkMax(frames, dt) {
  let m = 0; for (let i = 3; i < frames.length; i++) { const P = k => frames[i - k].cam; m = Math.max(m, Math.hypot(...[0, 1, 2].map(j => P(0)[j] - 3 * P(1)[j] + 3 * P(2)[j] - P(3)[j])) / dt ** 3); }
  return m;
}
const r3 = x => Math.round(x * 1000) / 1000;

export default async function (ctx) {
  await prepare(ctx);
  const { v, log } = ctx, out = {};
  const search = await v('location.search');
  const toggle = q => v(`(async () => { const A = await import('/valley/actors.js'); A.configureLoco(${JSON.stringify(q)}); })()`);
  const OLD = '?loco=a&smooth=camera', NEW = search || '', NEWFOV = (search ? search + '&' : '?') + 'fov=on';   // 画角の広がりは既定オフ。?fov=on の版は NEWFOV
  // 遮られ方：注視点からカメラへの線の当たり（1＝遮られていない）。ゲームの rayClip と同じ半径
  await v(`(async () => { const C = await import('/valley/collision.js'); const g = __valley.game;
    __valley.rayClear = (a, b) => C.rayClip(g.col, g.terrain, { x: a[0], y: a[1], z: a[2] }, { x: b[0], y: b[1], z: b[2] }, 0.3, { ignoreThin: 0.2 }); })()`);
  const mutate = process.env.KZ_MUTATE || (process.argv.includes('--mutate') ? process.argv[process.argv.indexOf('--mutate') + 1] : '');
  if (mutate) {
    // fov：画角が「画面の揺れ・衝撃」の倍率を読まない不具合を作る（倍率を1に固定）
    if (mutate === 'fov') await v("Object.defineProperty(__valley.game.rig, 'shakeScale', { get: () => 1, set() {} })");
    else await v(`(() => { const r = __valley.game.rig; r.cfg = { ...r.cfg, ...${{ predict: '{ predict: 0 }', vertical: '{ wy1: 1e6 }', hold: '{ hold: 0 }' }[mutate]} }; })()`);
    log('門番の確かめ：数値の表を差し替えた', mutate);
  }
  // 0. 空で1回（1回目は前の状態を引きずる。M3 の落とし穴）
  await recordJourney(v);
  // 1. 台本：M3 のカメラ → 新しいカメラ
  await toggle(OLD); const runOld = await recordJourney(v); await toggle(NEW); const runNew = await recordJourney(v);
  const mo = smoothMetrics(runOld, OPTS), mn = smoothMetrics(runNew, OPTS);
  out.journey = { old: { ...mo.camera, byTag: undefined, view: { ...mo.view, byTag: undefined } }, new: { ...mn.camera, byTag: undefined, view: { ...mn.view, byTag: undefined } } };
  log(`台本 加加速度p99（窓を外す） ${mo.camera.posJerkP99Clean} → ${mn.camera.posJerkP99Clean}・角加速度p99 ${mo.camera.rotAccelP99Clean} → ${mn.camera.rotAccelP99Clean}・画面の流れ ${mo.view.yRange} → ${mn.view.yRange}・画角 ${JSON.stringify(mo.camera.fovRange)} → ${JSON.stringify(mn.camera.fovRange)}`);
  check(mn.camera.posJerkP99Clean <= JERK_RATIO * mo.camera.posJerkP99Clean, `journey: camera jerk p99 ${mn.camera.posJerkP99Clean} not 10% below ${mo.camera.posJerkP99Clean}`);
  check(mn.camera.rotAccelP99Clean <= mo.camera.rotAccelP99Clean * 1.1 + 0.05, `journey: rotation accel p99 ${mn.camera.rotAccelP99Clean} worse than ${mo.camera.rotAccelP99Clean}`);
  check(mn.view.yRange <= mo.view.yRange * 1.1 + DRIFT_SLACK, `journey: hero drifts more on screen ${mn.view.yRange} vs ${mo.view.yRange}`);
  // 画角は既定ではオフ：台本のどこでも58度のまま。?fov=on の版でだけ、走りで+3度（見た目の投影だけなので位置は同じ）
  check(Math.max(...runNew.frames.map(f => f.cam[7])) <= 58.02, `journey: the default widened the FOV ${JSON.stringify(mn.camera.fovRange)} (it is opt-in: ?fov=on)`);
  await toggle(NEWFOV); const runWide = await recordJourney(v); await toggle(NEW);
  const mw = smoothMetrics(runWide, OPTS);
  const runFov = runWide.frames.filter(f => f.tag === 'run').map(f => f.cam[7]), standFov = runWide.frames.filter(f => f.tag === 'stand').map(f => f.cam[7]);
  log(`台本（?fov=on） 画角 ${JSON.stringify(mw.camera.fovRange)}・画角の変化の速さ ${mw.view.fovRateMax}度/秒`);
  check(Math.max(...runFov) >= 60.5 && Math.max(...runFov) <= 61.001, `journey ?fov=on: sprint FOV ${Math.max(...runFov)} not in 60.5..61`);
  check(Math.max(...standFov) <= 58.2, `journey ?fov=on: standing FOV ${Math.max(...standFov)}`);
  check(mw.view.fovRateMax <= 6, `journey ?fov=on: FOV changes ${mw.view.fovRateMax} deg/s`);
  check(mo.camera.fovRange[1] <= 58.02, `journey: ?smooth=camera changed the FOV ${mo.camera.fovRange}`);
  let logical = 0; for (let i = 0; i < runNew.frames.length; i++) { const a = runNew.frames[i], b = runOld.frames[i]; if (!b || JSON.stringify([a.pos, a.yaw, a.speed, a.gait]) !== JSON.stringify([b.pos, b.yaw, b.speed, b.gait])) logical++; }
  check(logical === 0 && runNew.frames.length === runOld.frames.length, `journey: ${logical} frames differ in position/yaw/speed/gait from ?smooth=camera`);
  // 2. 場面
  out.routes = {};
  for (const r of ROUTES) {
    await toggle(OLD); const ro = await recordRoute(v, r); await toggle(NEW); const rn = await recordRoute(v, r);
    const vo = cameraView(ro.frames, ro.dt, ro.aspect), vn = cameraView(rn.frames, rn.dt, rn.aspect), so = stepStats(ro.frames), sn = stepStats(rn.frames);
    const jo = jerkMax(ro.frames, ro.dt), jn = jerkMax(rn.frames, rn.dt);
    const clearMin = fr => Math.min(...fr.map(f => f.clear ?? 1)), floorMin = fr => Math.min(...fr.map(f => f.cam[1] - f.ground));
    const res = { old: { yAcc: vo.camYAccMax, jerkMax: r3(jo), step: r3(so.camMax), over: r3(so.over), clear: r3(clearMin(ro.frames)), floor: r3(floorMin(ro.frames)), yRange: vo.yRange },
      new: { yAcc: vn.camYAccMax, jerkMax: r3(jn), step: r3(sn.camMax), over: r3(sn.over), clear: r3(clearMin(rn.frames)), floor: r3(floorMin(rn.frames)), yRange: vn.yRange } };
    out.routes[r.name] = res;
    log(`場面 ${r.name.padEnd(14)} 上下の加速度 ${res.old.yAcc} → ${res.new.yAcc}・加加速度の最大 ${Math.round(jo)} → ${Math.round(jn)}・1コマの動きの超過 ${res.old.over} → ${res.new.over}m・遮られ ${res.old.clear} → ${res.new.clear}・地面から ${res.old.floor} → ${res.new.floor}m・画面の流れ ${res.old.yRange} → ${res.new.yRange}`);
    check(sn.over <= STEP_SLACK, `${r.name}: the camera jumps ${r3(sn.over)} m more than the hero in one frame`);
    check(jn <= jo * 1.0 + 1, `${r.name}: camera jerk max ${Math.round(jn)} above ${Math.round(jo)}`);
    if (r.steps) check(vn.camYAccMax <= Y_ACC_RATIO * vo.camYAccMax, `${r.name}: vertical camera accel ${vn.camYAccMax} not below ${Y_ACC_RATIO} x ${vo.camYAccMax}`);
    check(res.new.clear >= Math.min(res.old.clear, 0.95) - 0.02, `${r.name}: the view to the hero is blocked (${res.new.clear} vs ${res.old.clear})`);
    check(res.new.floor >= Math.min(0.55, res.old.floor) - 0.02, `${r.name}: the camera goes ${res.new.floor} m above the ground`);
    if (r.wall) check(so.over > 0.3, `${r.name}: the place no longer pulls the camera in (old over ${r3(so.over)} m) — the route does not test the wall`);
  }
  // 2b. 木の間（寄せの下限）：木が間に入って今のコマの当たりへ1コマで寄せたあとも、寄せの割合が下限（主人公から MIN_REACH）を割らない。
  //     M4 の初版は、そのとき下向きの速さが残って約25%（主人公から約1.0m）まで行き過ぎた（木が密な空き地・−88,84 から北へ走る。旧版は1コマで下限へ寄せて止まる）。
  //     ここで1コマの寄せは安全のために許す（壁の中は映さない）。見るのは、旧版より大きく跳ばないことと、下限を割らないこと。
  const FOREST = { name: 'forest_run', x: -88, z: 84, yaw: 0, keys: RUN, secs: 3.0 };
  await toggle(OLD); const fo = await recordRoute(v, FOREST); await toggle(NEW); const fn = await recordRoute(v, FOREST);
  const gapMin = Math.min(...fn.frames.map(f => f.clipped - f.tMin)), sf = stepStats(fn.frames), sfo = stepStats(fo.frames);
  out.forest = { gapMin: r3(gapMin), over: r3(sf.over), overOld: r3(sfo.over) };
  log(`木の間 寄せの割合−下限の最小 ${r3(gapMin)}（0以上・0.01以下）・1コマの動きの超過 ${r3(sfo.over)} → ${r3(sf.over)}m`);
  check(gapMin >= -0.005, `forest_run: the camera goes ${r3(-gapMin)} (fraction of the boom) closer than the minimum reach`);
  check(gapMin <= 0.01, `forest_run: the camera never reaches the minimum reach (gap ${r3(gapMin)}) — the route does not test the floor`);
  check(sf.over <= sfo.over + 0.05, `forest_run: the camera jumps ${r3(sf.over)} m more than the hero in one frame (old ${r3(sfo.over)})`);
  // 3. 設定：揺れ0・揺れ0.5・動きを減らす・?smooth=camera（上限の0.02度は、前の場面の画角が0.01度の差では投影を更新しない分の残り）
  const SPRINT = { name: 'sprint', x: 2, z: 4, yaw: 0, keys: RUN, secs: 2.5 };
  out.settings = {};
  for (const [name, q, shake, reduced, lim] of [['default', NEW, 1, false, [58, 58.02]], ['fov', NEWFOV, 1, false, [60.5, 61.001]], ['fovShake0', NEWFOV, 0, false, [58, 58.02]], ['fovShake05', NEWFOV, 0.5, false, [59.2, 59.501]], ['fovReduced', NEWFOV, 1, true, [58, 58.02]], ['smoothCamera', OLD + '&fov=on', 1, false, [58, 58.02]]]) {
    await toggle(q);
    await v(`(() => { const g = __valley.game; g.rig.shakeScale = ${shake}; g.settings.shake = ${shake}; g.settings.reducedMotion = ${reduced}; })()`);
    const rs = await recordRoute(v, SPRINT), fov = Math.max(...rs.frames.map(f => f.cam[7]));
    await v('(() => { const g = __valley.game; g.rig.shakeScale = 1; g.settings.shake = 1; g.settings.reducedMotion = false; })()');
    out.settings[name] = r3(fov); log(`設定 ${name.padEnd(13)} 走りの画角の最大 ${r3(fov)}（${lim[0]}〜${lim[1]}）`);
    check(fov >= lim[0] && fov <= lim[1], `settings ${name}: sprint FOV ${fov} not in ${lim}`);
  }
  await toggle(NEWFOV);   // コマ速度の確認は画角を広げた版で（止まる瞬間の画角も30・60・144で揃うこと）
  // 4. 30・60・144コマ/秒
  out.hz = {};
  const STOP = { name: 'hz', x: 2, z: 4, yaw: 0, keys: RUN, secs: 2.0 };
  for (const hz of [30, 60, 144]) {
    const rh = await recordRoute(v, STOP, hz), f = rh.frames, end = f[Math.round(2.0 * hz) - 1], last = f[f.length - 1];
    out.hz[hz] = { fovAtStop: r3(end.cam[7]), lagAtStop: r3(Math.hypot(end.cam[0] - end.pos[0], end.cam[2] - end.pos[2])), restDist: r3(Math.hypot(last.cam[0] - last.pos[0], last.cam[2] - last.pos[2])) };
  }
  log('コマ速度 30・60・144:', JSON.stringify(out.hz));
  await toggle(OLD); out.hzOld = {};
  for (const hz of [30, 144]) { const f = (await recordRoute(v, STOP, hz)).frames, end = f[Math.round(2.0 * hz) - 1]; out.hzOld[hz] = r3(Math.hypot(end.cam[0] - end.pos[0], end.cam[2] - end.pos[2])); }
  await toggle(NEW); log('（参考）M3 のカメラの止まる瞬間の距離 30・144:', JSON.stringify(out.hzOld));
  for (const hz of [30, 144]) {
    const a = out.hz[hz], b = out.hz[60];
    // 遅れの許容0.08m：ばねは目標をコマの頭で止まったものとして解くので、走り5m/秒で30と144コマ/秒の遅れが約7cm違う（M3 のカメラも同じ。
    // 目標を一定の速さで動かして厳密に解く版は差0だったが、台本の止まりの加加速度が10%上がったので採らなかった。design-locomotion-camera.md §4）
    check(Math.abs(a.fovAtStop - b.fovAtStop) <= 0.05 && Math.abs(a.lagAtStop - b.lagAtStop) <= 0.08 && Math.abs(a.restDist - b.restDist) <= 0.03, `${hz} fps camera differs from 60: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`);
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ out, fail }, null, 1) + '\n');
  if (fail.length) throw new Error('camera regressions:\n' + fail.join('\n'));
  log('OK: camera (journey, steps, slope, walls, settings, 30/60/144 fps)');
}
