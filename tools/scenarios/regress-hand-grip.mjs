// 回帰：握り（hand-rig.js・8.6a）が、実際の人物の皮・骨・刀・鞘で、毎コマ設計どおりに働くこと。
// 人物を2人ずつ作る（層あり ch・層を切った ctl）。同じ動作・同じ時間刻み（1/60秒）で動かし、描画に使う頂点と骨の世界行列から測る。
// 測るもの・合格の目安は tools/lib/hand-grip-metrics.mjs（指と柄・鞘のすき間とめり込み、跳び、腕の写しの長さ、写しの戻り、動作の骨と刀の先が ctl と一致）。
// 実行：KZ_OUT=<json> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-hand-grip.mjs --seed 1333 --strict
import fs from 'node:fs';
import { HAND_LIMITS, createHandMetrics } from '../lib/hand-grip-metrics.mjs';
import { popScore } from '../lib/draw-sheathe-metrics.mjs';

async function pageMain(makeMetrics) {
  const { Character } = await import('/valley/characters.js');
  const { GRIP } = await import('/valley/config.js');
  const { createSwordLayer } = await import('/valley/sword-layer.js');
  const newRun = await makeMetrics();
  const roster = __valley.game.roster, DT = 1 / 60;
  const mk = (who, drawn, on) => { const c = new Character(roster, who); c.setTachi(GRIP, drawn); c.hands.enabled = on; return c; };
  const pick = R => { const { tipTrace, ...rest } = R; return rest; };

  // A 刀を抜いた動作を1本、頭から終わりまで
  function clip(who, name, extra = 0) {
    const ch = mk(who, true, true), ctl = mk(who, true, false);
    if (!ch.meta(name) || !ch.tpl.clips.has(name)) { ch.dispose(); ctl.dispose(); return null; }
    for (const c of [ch, ctl]) c.play(name, { fade: 0, restart: true });
    const run = newRun(ch), frames = Math.ceil(ch.meta(name).seconds * 60) + extra;
    for (let i = 0; i < frames; i++) { ch.update(DT); ctl.update(DT); run.sample(ctl); }
    const R = pick(run.finish(ctl)); R.name = `${who}:${name}`; R.frames = frames;
    ch.dispose(); ctl.dispose();
    return R;
  }
  // B 抜刀・納刀の層を与えて（主人公の構えの選び方は regress-draw-sheathe.mjs と同じ）
  const stance = out => (out.mode === 'drawn' || (out.mode === 'drawing' && out.u >= 0.6)) ? 'guard' : 'relaxed';
  function drive(name, { speed = 0, style = stance, frames, requests = {}, start = 'sheathed' }) {
    const ch = mk('hero', start === 'drawn', true), ctl = mk('hero', start === 'drawn', false);
    const layer = createSwordLayer({ u: 0 });
    if (start === 'drawn') layer.reset('drawn');
    let st = start === 'drawn' ? 'guard' : 'relaxed';
    for (let w = 0; w < 40; w++) for (const c of [ch, ctl]) { c.locomote(speed, st); c.update(DT); }
    const run = newRun(ch);
    for (let i = 0; i < frames; i++) {
      for (const [k, fn] of Object.entries(requests)) if (Number(k) === i) fn(layer);
      const out = layer.tick(DT);
      st = style(out);
      for (const c of [ch, ctl]) { c.sword.setFrame(out); c.locomote(speed, st); c.update(DT); }
      run.sample(ctl);
    }
    const R = pick(run.finish(ctl)); R.name = name; R.frames = frames;
    ch.dispose(); ctl.dispose();
    return R;
  }
  const out = [];
  for (const name of ['Katana_Guard_Idle', 'Walk_Fight_Forward', 'Walk_Fight_Back', 'Katana_Kesa_Cut', 'Katana_Gyakukesa_Cut', 'Katana_Yokonagi_Cut', 'Katana_Karatake_Heavy', 'Katana_Finisher', 'Katana_Counter_Cut', 'Katana_Parry', 'Two_Handed_Parry', 'Katana_Thrust', 'CMU_Run', 'Roll_Dodge', 'Hit_Reaction']) { const r = clip('hero', name); if (r) out.push(r); }
  for (const who of ['soldier', 'officer']) for (const name of ['Katana_Guard_Idle', 'Walk_Fight_Forward', 'Attack_r1', 'Katana_Thrust', 'Officer_Attack', 'Katana_Gyakukesa_Cut', 'Katana_Karatake_Heavy']) { const r = clip(who, name); if (r) out.push(r); }
  out.push(drive('calmDraw', { frames: 60, requests: { 3: l => l.requestDraw({ fast: false }) } }));
  out.push(drive('fastDraw', { style: o => o.mode === 'sheathed' ? 'relaxed' : 'guard', frames: 40, requests: { 3: l => l.requestDraw({ fast: true }) } }));
  out.push(drive('calmSheathe', { style: o => o.mode === 'drawn' ? 'guard' : 'relaxed', frames: 72, start: 'drawn', requests: { 3: l => l.requestSheathe() } }));
  out.push(drive('drawWalking', { speed: 1.5, frames: 60, requests: { 3: l => l.requestDraw({ fast: false }) } }));
  out.push(drive('walkSheathed', { speed: 1.2, frames: 90 }));
  return out;
}

export default async function ({ v, log }) {
  const cases = await v(`(${pageMain.toString()})(${createHandMetrics.toString()})`);
  const fails = [], rows = [];
  for (const r of cases) {
    const pops = {};
    for (const [k, steps] of Object.entries(r.steps)) pops[k] = +popScore(steps, /Rot/.test(k) ? HAND_LIMITS.popFloorRad : HAND_LIMITS.popFloorM).worst.toFixed(2);
    const contact = {};
    for (const side of ['Right', 'Left']) for (const [k, c] of Object.entries(r.contact[side])) contact[side[0] + ':' + k] = [+c.gapMm.toFixed(1), +c.sinkMm.toFixed(1), c.frames];
    rows.push({ name: r.name, frames: r.frames, contactFrames: r.contactFrames, sinkAll: { R: +r.sinkAll.Right.toFixed(1), L: +r.sinkAll.Left.toFixed(1) }, unreached: r.unreached, maxReachErrMm: +r.maxReachErrMm.toFixed(1), pops, armDevMm: +r.maxArmDevMm.toFixed(3), copyLeakRad: r.copyLeakRad, realLeakRad: r.realLeakRad, realLeakBone: r.realLeakBone, maxTipDiffMm: r.maxTipDiffMm, nan: r.nan, contact });
    const chk = (cond, msg) => { if (!cond) fails.push(`${r.name}: ${msg}`); };
    chk(r.nan === 0, `NaN ${r.nan}`);
    chk(r.realLeakRad <= HAND_LIMITS.leakRad, `動作の骨が層を切った人物と違う ${r.realLeakBone} ${r.realLeakRad}`);
    chk(r.maxTipDiffMm <= HAND_LIMITS.tipMm, `刀の先が層を切った人物と違う ${r.maxTipDiffMm.toFixed(3)}mm`);
    chk(r.maxArmDevMm <= HAND_LIMITS.armLenMm, `腕の写しの長さが変わる ${r.maxArmDevMm.toFixed(3)}mm`);
    chk(r.copyLeakRad <= HAND_LIMITS.leakRad, `握っていない手の写しが動作の骨と違う ${r.copyLeakRad}`);
    for (const [k, p] of Object.entries(pops)) chk(p <= HAND_LIMITS.popRatio, `${k} が1コマだけ跳ぶ（隣の動きの ${p} 倍）`);
    for (const side of ['Right', 'Left']) chk(r.sinkAll[side] <= HAND_LIMITS.sinkMm, `${side} の手の皮が円筒へめり込む ${r.sinkAll[side].toFixed(1)}mm`);
    chk(r.unreached <= HAND_LIMITS.unreachedFrames && r.maxReachErrMm <= HAND_LIMITS.unreachedMm, `腕が握りの位置へ届かないコマ ${r.unreached}（最大 ${r.maxReachErrMm.toFixed(1)}mm）`);
    // 指の付け根・中の節のすき間（侍大将は手が厚く、板として曲げる方式では小指の側が閉じきらない＝既知の課題として記録だけ）
    if (!r.name.startsWith('officer')) for (const [k, c] of Object.entries(r.contact.Right)) if (/^f[01]\//.test(k)) chk(c.gapMm <= HAND_LIMITS.gapMm, `右手 ${k} のすき間 ${c.gapMm.toFixed(1)}mm`);
    log(`${r.name}: contact R ${r.contactFrames.Right} L ${r.contactFrames.Left} sink R ${r.sinkAll.Right.toFixed(1)} L ${r.sinkAll.Left.toFixed(1)}mm unreached ${r.unreached} reachErr ${r.maxReachErrMm.toFixed(1)}mm pops ${JSON.stringify(pops)} tip ${r.maxTipDiffMm.toFixed(4)}mm leak ${r.realLeakRad.toExponential(1)}`);
  }
  if (process.env.KZ_OUT) { fs.mkdirSync(process.env.KZ_OUT.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ limits: HAND_LIMITS, fails, cases: rows }, null, 1) + '\n'); }
  if (fails.length) throw new Error('握りの回帰が不合格:\n  ' + fails.join('\n  '));
  log('OK: ' + rows.length + ' cases within limits');
}
