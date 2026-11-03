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
  // 材質：半透明・切り抜き・両面・深度の書き込みなしの面が無いこと、手の補正（袖口の裏地・肌の照り）が入っていること（評価の指摘5は不透明だった。測って残す）
  const materialIssues = who => {
    const c = mk(who, true, true), m = c.hands.mesh.material, issues = [];
    if (m.transparent || m.opacity !== 1 || m.alphaTest !== 0 || !m.depthWrite || !m.depthTest || m.side !== 0 || m.alphaHash || m.transmission > 0) issues.push(`${who}: 材質が不透明でない ${JSON.stringify({ t: m.transparent, o: m.opacity, a: m.alphaTest, side: m.side })}`);
    if (!m.userData.kzHand) issues.push(`${who}: 手の補正が材質に入っていない`);
    c.dispose();
    return issues;
  };

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
  out.materialIssues = ['hero', 'soldier', 'officer'].flatMap(materialIssues);
  return { cases: out, materialIssues: out.materialIssues };
}

export default async function ({ v, log }) {
  const { cases, materialIssues } = await v(`(${pageMain.toString()})(${createHandMetrics.toString()})`);
  const fails = [...materialIssues], rows = [];
  for (const r of cases) {
    const pops = {};
    for (const [k, steps] of Object.entries(r.steps)) pops[k] = +popScore(steps, /Rot/.test(k) ? HAND_LIMITS.popFloorRad : HAND_LIMITS.popFloorM).worst.toFixed(2);
    const contact = {};
    for (const side of ['Right', 'Left', 'LeftT']) for (const [k, c] of Object.entries(r.contact[side])) contact[(side === 'LeftT' ? 'LT' : side[0]) + ':' + k] = [+c.gapMm.toFixed(1), +c.sinkMm.toFixed(1), c.frames];
    rows.push({ name: r.name, frames: r.frames, contactFrames: r.contactFrames, sinkAll: { R: +r.sinkAll.Right.toFixed(1), L: +r.sinkAll.Left.toFixed(1), LT: +r.sinkAll.LeftT.toFixed(1) }, unreached: r.unreached, maxReachErrMm: +r.maxReachErrMm.toFixed(1), unreachedL: r.unreachedL, maxReachErrLMm: +r.maxReachErrLMm.toFixed(1), pops, stretchMm: +r.maxStretchMm.toFixed(1), tsubaCross: r.tsubaCross, tsubaLeft: r.tsubaLeft, tsubaLeftCtl: r.tsubaLeftCtl, armDevMm: +r.maxArmDevMm.toFixed(3), copyLeakRad: r.copyLeakRad, realLeakRad: r.realLeakRad, realLeakBone: r.realLeakBone, maxTipDiffMm: r.maxTipDiffMm, nan: r.nan, contact });
    const chk = (cond, msg) => { if (!cond) fails.push(`${r.name}: ${msg}`); };
    chk(r.nan === 0, `NaN ${r.nan}`);
    chk(r.realLeakRad <= HAND_LIMITS.leakRad, `動作の骨が層を切った人物と違う ${r.realLeakBone} ${r.realLeakRad}`);
    chk(r.maxTipDiffMm <= HAND_LIMITS.tipMm, `刀の先が層を切った人物と違う ${r.maxTipDiffMm.toFixed(3)}mm`);
    chk(r.maxArmDevMm <= HAND_LIMITS.armLenMm, `腕の写しの長さが変わる ${r.maxArmDevMm.toFixed(3)}mm`);
    chk(r.maxStretchMm <= HAND_LIMITS.stretchMm, `袖・腕・手の辺が伸びる ${r.maxStretchMm.toFixed(1)}mm（頂点 ${r.stretchAt}）`);
    chk(r.tsubaCross <= (r.name.includes(':') ? HAND_LIMITS.tsubaCross : HAND_LIMITS.tsubaCrossDraw), `鍔が右の袖・腕・手を横切るコマ ${r.tsubaCross}`);
    chk(r.tsubaLeft <= r.tsubaLeftCtl + HAND_LIMITS.tsubaLeftExtra, `鍔が左手を横切るコマ ${r.tsubaLeft}（層を切った人物 ${r.tsubaLeftCtl}）`);
    chk(r.copyLeakRad <= HAND_LIMITS.leakRad, `握っていない手の写しが動作の骨と違う ${r.copyLeakRad}`);
    for (const [k, p] of Object.entries(pops)) chk(p <= HAND_LIMITS.popRatio, `${k} が1コマだけ跳ぶ（隣の動きの ${p} 倍）`);
    for (const side of ['Right', 'Left', 'LeftT']) chk(r.sinkAll[side] <= HAND_LIMITS.sinkMm, `${side} の手の皮が円筒へめり込む ${r.sinkAll[side].toFixed(1)}mm`);
    chk(r.unreached <= HAND_LIMITS.unreachedFrames && r.maxReachErrMm <= HAND_LIMITS.unreachedMm, `腕が握りの位置へ届かないコマ ${r.unreached}（最大 ${r.maxReachErrMm.toFixed(1)}mm）`);
    chk(r.unreachedL <= HAND_LIMITS.unreachedFrames && r.maxReachErrLMm <= HAND_LIMITS.unreachedMm, `両手持ちの左腕が握りの位置へ届かないコマ ${r.unreachedL}（最大 ${r.maxReachErrLMm.toFixed(1)}mm）`);
    // 指の付け根・中の節のすき間（右手と、両手持ちの左手。主人公・兵・侍大将とも）
    for (const side of ['Right', 'LeftT']) for (const [k, c] of Object.entries(r.contact[side])) if (/^f[01]\//.test(k)) chk(c.gapMm <= HAND_LIMITS.gapMm, `${side} ${k} のすき間 ${c.gapMm.toFixed(1)}mm`);
    log(`${r.name}: contact R ${r.contactFrames.Right} L ${r.contactFrames.Left} LT ${r.contactFrames.LeftT} sink R ${r.sinkAll.Right.toFixed(1)} L ${r.sinkAll.Left.toFixed(1)} LT ${r.sinkAll.LeftT.toFixed(1)}mm unreached ${r.unreached}/${r.unreachedL} reachErr ${r.maxReachErrMm.toFixed(1)}/${r.maxReachErrLMm.toFixed(1)}mm pops ${JSON.stringify(pops)} stretch ${r.maxStretchMm.toFixed(1)}mm tsuba R ${r.tsubaCross} L ${r.tsubaLeft}/${r.tsubaLeftCtl} tip ${r.maxTipDiffMm.toFixed(4)}mm leak ${r.realLeakRad.toExponential(1)}`);
  }
  if (process.env.KZ_OUT) { fs.mkdirSync(process.env.KZ_OUT.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ limits: HAND_LIMITS, fails, materialIssues, cases: rows }, null, 1) + '\n'); }
  if (fails.length) throw new Error('握りの回帰が不合格:\n  ' + fails.join('\n  '));
  log('OK: ' + rows.length + ' cases within limits');
}
