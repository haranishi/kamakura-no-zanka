// 回帰：抜刀・納刀の層（sword-layer.js → sword-rig.js）が、実際の人物の骨・鞘・刀で、毎コマ設計どおりに動くこと（8.2）。
// 層の出力を決まった時間刻み（1/60秒）で与え、描画に使う骨と物体の世界行列から、毎コマ測る（層の内部の診断は使わない）。
// 測るもの・合格の目安は tools/lib/draw-sheathe-metrics.mjs。実ゲームの主人公を通す検査は regress-draw-sheathe-game.mjs。
// 実行：KZ_OUT=<json> [KZ_TRACE=1（コマごとの記録も出す）] PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-draw-sheathe.mjs --strict
import fs from 'node:fs';
import { LIMITS, createMetrics, popScore } from '../lib/draw-sheathe-metrics.mjs';

async function pageMain(makeMetrics) {
  const { Character } = await import('/valley/characters.js');
  const { GRIP } = await import('/valley/config.js');
  const { createSwordLayer, LAYER } = await import('/valley/sword-layer.js');
  const newRun = await makeMetrics();
  const roster = __valley.game.roster, DT = 1 / 60;
  const mk = () => { const c = new Character(roster, 'hero'); c.setTachi(GRIP, false); return c; };

  // 主人公が実際に取る構え：納刀は relaxed、抜いた状態と、抜刀の後半（u≧0.6）は guard。
  const stance = out => (out.mode === 'drawn' || (out.mode === 'drawing' && out.u >= 0.6)) ? 'guard' : 'relaxed';
  const stanceFast = out => out.mode === 'sheathed' ? 'relaxed' : 'guard';       // 攻撃・受けで始めた抜刀は、すぐ guard
  const stanceGuard = () => 'guard';

  function drive(name, { speed = 0, style, frames, requests = {}, start = 'sheathed' }) {
    const ch = mk(), ctl = mk();
    const layer = createSwordLayer({ u: 0 });
    if (start === 'drawn') { layer.reset('drawn'); ch.setTachi(GRIP, true); ctl.setTachi(GRIP, true); }
    let st = start === 'drawn' ? 'guard' : 'relaxed';
    for (let w = 0; w < 40; w++) { ch.locomote(speed, st); ctl.locomote(speed, st); ch.update(DT); ctl.update(DT); }   // 助走（動作の混ざり）
    const run = newRun(ch), events = {};
    let out = { mode: start === 'drawn' ? 'drawn' : 'sheathed', u: start === 'drawn' ? 1 : 0 };
    for (let i = 0; i < frames; i++) {
      for (const [k, fn] of Object.entries(requests)) if (Number(k) === i) fn(layer);
      out = layer.tick(DT);
      for (const e of out.events) (events[e] ||= []).push(i);
      ch.sword.setFrame(out);
      st = style(out);
      ch.locomote(speed, st); ctl.locomote(speed, st);
      ch.update(DT); ctl.update(DT);
      run.sample(out);
    }
    const R = run.finish(ctl);
    R.name = name; R.frames = frames; R.events = events; R.endU = out.u;
    ch.dispose(); ctl.dispose();
    return R;
  }

  const out = {};
  out.calmDraw = drive('calmDraw', { style: stance, frames: 60, requests: { 3: l => l.requestDraw({ fast: false }) } });
  out.calmDrawFromGuard = drive('calmDrawFromGuard', { style: stanceGuard, frames: 60, requests: { 3: l => l.requestDraw({ fast: false }) } });
  out.calmSheathe = drive('calmSheathe', { style: o => o.mode === 'drawn' ? 'guard' : 'relaxed', frames: 72, start: 'drawn', requests: { 3: l => l.requestSheathe() } });
  out.fastDraw = drive('fastDraw', { style: stanceFast, frames: 40, requests: { 3: l => l.requestDraw({ fast: true }) } });
  out.snapDuringDraw = drive('snapDuringDraw', { style: stance, frames: 60, requests: { 3: l => l.requestDraw({ fast: false }), 20: l => l.requestDraw({ fast: true }) } });
  out.cancelSheathe = drive('cancelSheathe', { style: o => (o.mode === 'drawn' || o.mode === 'drawing') ? 'guard' : 'relaxed', frames: 72, start: 'drawn', requests: { 3: l => l.requestSheathe(), 26: l => l.requestDraw({ fast: true }) } });
  out.cancelSameFrame = drive('cancelSameFrame', { style: o => (o.mode === 'drawn' || o.mode === 'drawing') ? 'guard' : 'relaxed', frames: 40, start: 'drawn', requests: { 3: l => { l.requestSheathe(); l.requestDraw({ fast: true }); } } });
  out.drawWalking = drive('drawWalking', { speed: 1.5, style: stance, frames: 60, requests: { 3: l => l.requestDraw({ fast: false }) } });
  out.sheatheWalking = drive('sheatheWalking', { speed: 1.0, style: o => o.mode === 'drawn' ? 'guard' : 'relaxed', frames: 72, start: 'drawn', requests: { 3: l => l.requestSheathe() } });
  out.LAYER = LAYER;
  return out;
}

export default async function ({ v, log }) {
  const out = await v(`(${pageMain.toString()})(${createMetrics.toString()})`);
  const fails = [], rows = [], traces = {};
  for (const [name, r] of Object.entries(out)) {
    if (name === 'LAYER') continue;
    const p1 = popScore(r.stepPos, LIMITS.popFloorM), p2 = popScore(r.stepRot, LIMITS.popFloorRad), p3 = popScore(r.stepHand, LIMITS.popFloorM), p4 = popScore(r.stepHandRot, LIMITS.popFloorRad);
    r.pop = { sword: +p1.worst.toFixed(2), turn: +p2.worst.toFixed(2), hand: +p3.worst.toFixed(2), handTurn: +p4.worst.toFixed(2) };
    rows.push({ name, ...Object.fromEntries(Object.entries(r).filter(([k]) => !['trace', 'stepPos', 'stepRot', 'stepHand', 'stepHandRot'].includes(k))) }); traces[name] = r.trace;
    const chk = (cond, msg) => { if (!cond) fails.push(`${name}: ${msg}`); };
    chk(r.nan === 0, `NaN ${r.nan}`);
    chk(r.vis === 0, `刀と腰の柄の表示が食い違うコマ ${r.vis}`);
    chk(r.maxIkErrMm <= LIMITS.gripPosMm, `右腕のIKが届かない量 ${r.maxIkErrMm.toFixed(1)}mm（届かないコマ ${r.unreached}）`);
    chk(r.maxGripMm <= LIMITS.gripPosMm, `握りの誤差 ${r.maxGripMm.toFixed(1)}mm > ${LIMITS.gripPosMm}`);
    chk(r.maxGripDeg <= LIMITS.gripAngDeg, `握りの角度誤差 ${r.maxGripDeg.toFixed(1)}° > ${LIMITS.gripAngDeg}`);
    chk(r.maxCoaxMm <= LIMITS.coaxMm, `刃と鞘の差 ${r.maxCoaxMm.toFixed(1)}mm > ${LIMITS.coaxMm}`);
    chk(r.wallHits === 0, `刃の断面が鞘の管に収まらないコマ ${r.wallHits}（余裕の最小 ${r.minRoomMm.toFixed(1)}mm）`);
    chk(r.maxArmDevMm <= LIMITS.armLenMm, `腕の長さの変化 ${r.maxArmDevMm.toFixed(2)}mm > ${LIMITS.armLenMm}`);
    chk(p1.worst <= LIMITS.popRatio, `刀が1コマだけ跳ぶ（隣のコマの動きの ${p1.worst.toFixed(1)} 倍・コマ ${p1.at}）`);
    chk(p2.worst <= LIMITS.popRatio, `刀の向きが1コマだけ跳ぶ（${p2.worst.toFixed(1)} 倍・コマ ${p2.at}）`);
    chk(p3.worst <= LIMITS.popRatio, `右手が1コマだけ跳ぶ（${p3.worst.toFixed(1)} 倍・コマ ${p3.at}）`);
    chk(p4.worst <= LIMITS.popRatio, `右手の向きが1コマだけ跳ぶ（${p4.worst.toFixed(1)} 倍・コマ ${p4.at}）`);
    chk(r.leakRad <= LIMITS.leakRad, `層のあとに骨が戻らない ${r.leakBone} ${r.leakRad.toExponential(2)}rad`);
    chk(r.handHome < 1e-9 && r.hipHome < 1e-9, `刀の枠・鞘の位置が定位置へ戻らない（手 ${r.handHome}・腰 ${r.hipHome}）`);
    chk(r.saved === 0, `層が終わったのに、戻していない骨が残る ${r.saved}`);
    log(`${name}: grip ${r.maxGripMm.toFixed(1)}mm/${r.maxGripDeg.toFixed(1)}° ikErr ${r.maxIkErrMm.toFixed(0)}mm coax ${r.maxCoaxMm.toFixed(1)}mm room ${r.minRoomMm.toFixed(1)}mm wall ${r.wallHits} pop ${JSON.stringify(r.pop)} roll ${r.maxRollDeg.toFixed(0)}° arm ${r.maxArmDevMm.toFixed(2)}mm leak ${r.leakRad.toExponential(1)} events ${JSON.stringify(r.events)}`);
  }
  // 速い抜刀は、最初の攻撃の予備動作（0.17秒）に間に合うよう、要求から0.15秒（9コマ）以内に抜け切る
  const fast = out.fastDraw; if (!(fast.events.drawn && fast.events.drawn[0] - 3 <= 10)) fails.push(`fastDraw: 抜け切るまで ${fast.events.drawn && fast.events.drawn[0] - 3} コマ（要求から10コマ以内）`);
  // 納刀を要求した同じコマに抜刀を要求したら、納刀は取り消され、刀は手に残る
  const same = out.cancelSameFrame; if (same.endU !== 1 || same.events.seat || same.events.sheathed) fails.push(`cancelSameFrame: 納刀が取り消されない（u=${same.endU}・通知 ${JSON.stringify(same.events)}）`);
  if (process.env.KZ_OUT) { fs.mkdirSync(process.env.KZ_OUT.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ limits: LIMITS, fails, cases: rows, ...(process.env.KZ_TRACE ? { traces } : {}) }, null, 1) + '\n'); }
  if (fails.length) throw new Error('抜刀・納刀の回帰が不合格:\n  ' + fails.join('\n  '));
  log('OK: ' + rows.length + ' cases within limits');
}
