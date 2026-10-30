// 8.3a の実測：技ごとに、刀の根元・切先・右手首の世界位置を毎コマ記録し、切先の速さの山と判定の時間割の関係、
// 帯を出す区間の切先の道のりを測る。変更前と変更後を、それぞれの作業ツリーで同じ条件で流して比べる。
//   KZ_OUT=<json> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-combat-trail.mjs --seed 1333 --out <フォルダ>
// 主人公の技は空振り（相手を遠ざける）、敵の技は主人公から6m離して出させる。判定は成立させない（時間割だけを見る）。
// 敵の技は、規則の開始（startMove）を介さず、論理の状態を「その技の予備の始め」にして、表示の結線（beginMove）を呼ぶ。検査だけの近道。
// 速さはゲーム内の時刻の差で割る（命中の停止が無い空振りなので、1コマ=1/60秒）。帯の統計（変更後だけ）があれば一緒に残す。
// 8.3a 第2周：接触時刻（刃の中ほど〜切先が、相手の胴＝立ち位置の地面から1.1mの点へ最も近づく時刻）も測る（contact）。
//   相手は、技の開始の位置から、向いている前へ間合い（MOVES の reach）の距離に置いた動かない点（当てない：反応・停止で胴が動かない）。
//   とどめは、膝をついた相手の胸（Spine02）を点にする。1/240秒刻みで進め、最も近いサンプルの前後3点の放物線で時刻を詰める。
//   KZ_ONLY=contact で接触時刻だけを測る（速い）。
import fs from 'node:fs';
import { MOVES as MOVES_TIMING } from '../../dist/valley/combat.js';

const HERO_MOVES = [
  { name: 'light1', press: [[0, 'click']] },
  { name: 'light1-2-3', press: [[0, 'click'], [20, 'click'], [44, 'click']] },
  { name: 'heavy', press: [[0, 'heavy']] },
  { name: 'counter', press: [[0, 'counter']] },
];
const ENEMY_MOVES = [
  { who: 'road_scout', move: 'soldier_slash' }, { who: 'road_scout', move: 'soldier_thrust' },
  { who: 'officer', move: 'officer_a' }, { who: 'officer', move: 'officer_b' }, { who: 'officer', move: 'officer_c' },
];

export default async function ({ st, step, call, v, freeze, start, log }) {
  await start('new'); await freeze(true); await step(40); await call('god', true);
  const adv = async () => { for (let i = 0; i < 60; i++) { const s = await st(); if (s.talking) { await call('advanceDialogue', true); await step(10); } else if (s.pending) await step(30); else break; } };
  for (const e of [{ type: 'enter_zone', zone: 'temple_yard' }, { type: 'dialogue_end', id: 'boy_arrives' }]) await call('dispatch', e);
  await adv(); await step(20);
  const ok = await v(`(async () => {
    const g = __valley.game, { MOVES } = await import('/valley/combat.js');
    const at = (holder, y) => { holder.updateWorldMatrix(true, false); const e = holder.matrixWorld.elements; return [e[4] * y + e[12], e[5] * y + e[13], e[6] * y + e[14]]; };
    const bonePos = (ch, name) => { const b = ch.bones.get(name); b.updateWorldMatrix(true, false); const e = b.matrixWorld.elements; return [e[12], e[13], e[14]]; };
    window.__ct = {
      MOVES,
      sample(actor) {
        const ch = actor.character, w = ch.weapons.tachiDrawn, f = actor.fighter;
        const trails = g.fx.trails?.stats ? g.fx.trails.stats() : null;
        return { time: g.time, move: f.move ? f.move.id : null, mt: f.move ? f.move.t : null, phase: f.move ? f.move.phase : null, state: f.state,
          shown: !!w && w.holder.visible, root: w ? at(w.holder, 0.16) : null, tip: w ? at(w.holder, 0.88) : null, wrist: bonePos(ch, 'RightHand'),
          clip: ch.currentName, clipTime: ch.current ? ch.current.time : null, trails };
      },
      // 主人公を開けた所へ置き、抜いた状態で待たせる（自動の納刀を遠ざける）
      placeHero() { const h = g.hero; h.place(-30, -6, -Math.PI / 2); h.fighter.yaw = h.yaw; g.rig.yaw = h.yaw; g.rig.snap(); h.sheatheIn = 30; },
      placeEnemy(id, dx, dz, yaw) {
        const e = g.enemies.find(e => e.id === id), h = g.hero.pos;
        e.place(h.x + dx, h.z + dz, yaw); e.dormant = false; e.brain.state = 'combat'; e.brain.awareness = 1; e.fighter.aware = true;
        e.fighter.state = 'idle'; e.fighter.move = null; e.lunge = null; e.speedNow = 0; e.recoverT = 0;
        return e;
      },
      forceEnemyMove(id, moveId) {
        const e = g.enemies.find(e => e.id === id), f = e.fighter;
        f.move = { id: moveId, t: 0, phase: 'windup', struck: [], targetId: null }; f.state = 'attack';
        f.telegraphing = MOVES[moveId].telegraph > 0; f.noRegenT = 1.2;
        f.pendingEvents.push({ type: 'phase', id: f.id, moveId, phase: 'windup' });
        e.beginMove(moveId); e.chainRoll = 9;   // 連続技へ続けない
        return true;
      },
    };
    g.makeEnemies('village_enemies', { alert: 'unaware', dormant: true });
    return !!g.enemies.find(e => e.id === 'officer') && !!g.enemies.find(e => e.id === 'road_scout');
  })()`);
  if (!ok) throw new Error('officer / road_scout not found');
  // 抜刀して待つ（主人公の技は、抜いた状態から測る）
  await v(`(() => { const g = __valley.game; __ct.placeHero(); for (const e of g.enemies) { e.dormant = true; e.place(e.pos.x + 40, e.pos.z + 40, 0); } g.hero.drawSword({ fast: false }); return true; })()`);
  await step(80);
  const contact = await measureContacts({ v, step, log });
  if (process.env.KZ_ONLY === 'contact') {
    for (const c of contact) log(JSON.stringify(c));
    if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ seed: 1333, contact }, null, 1) + '\n');
    return;
  }
  const runs = [];
  const press = kind => v(`(() => { const g = __valley.game, i = g.input;
    if (${JSON.stringify(kind)} === 'click') { i.mousePressed.add(0); i.mouse.add(0); }
    else if (${JSON.stringify(kind)} === 'heavy') { i.pressed.add('KeyF'); i.held.add('KeyF'); }
    else if (${JSON.stringify(kind)} === 'counter') { g.hero.fighter.counterT = 0.9; i.mousePressed.add(0); i.mouse.add(0); }
    return true; })()`);
  const unpress = () => v(`(() => { const i = __valley.game.input; i.mouse.delete(0); i.held.delete('KeyF'); return true; })()`);
  for (const m of HERO_MOVES) {
    await v(`(() => { __ct.placeHero(); return true; })()`); await step(30);
    const frames = [];
    for (let f = 0; f < 120; f++) {
      for (const [at, kind] of m.press) if (at === f) await press(kind);
      await step(1);
      if (m.press.some(([at]) => at === f)) await unpress();
      frames.push(await v(`__ct.sample(__valley.game.hero)`));
    }
    runs.push({ actor: 'hero', name: m.name, frames });
    log(`${m.name}: ${[...new Set(frames.map(x => x.move).filter(Boolean))].join(' → ')}`);
  }
  for (const m of ENEMY_MOVES) {
    await v(`(() => { __ct.placeHero(); const e = __ct.placeEnemy(${JSON.stringify(m.who)}, 0, -6, Math.PI / 2); return true; })()`);
    await step(20);
    await v(`__ct.forceEnemyMove(${JSON.stringify(m.who)}, ${JSON.stringify(m.move)})`);
    const frames = [];
    for (let f = 0; f < 150; f++) {
      await step(1);
      const s = await v(`__ct.sample(__valley.game.enemies.find(e => e.id === ${JSON.stringify(m.who)}))`);
      frames.push(s);
      if (f > 10 && !s.move) break;
    }
    await v(`(() => { const e = __valley.game.enemies.find(e => e.id === ${JSON.stringify(m.who)}); e.dormant = true; e.place(e.pos.x + 40, e.pos.z + 40, 0); return true; })()`);
    runs.push({ actor: m.who, name: m.move, rate: await v(`__valley.game.enemies.find(e => e.id === ${JSON.stringify(m.who)}).character.rate`), frames });
    log(`${m.move}: ${frames.length} frames`);
  }
  const report = { seed: 1333, contact, runs, summary: runs.map(summarize) };
  for (const s of report.summary) log(JSON.stringify(s));
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(report) + '\n');
}

// 1本の記録から、技ごとに：切先・手首の速さの山（技の開始からの秒）と、山の前後で速さが最大の半分以上つづく区間、
// 判定の区間（予備の終わり〜当たりの終わり）との差（ms）、帯の区間（判定−0.04秒〜戻りの始め＋0.10秒）の切先の道のり、1コマの最大移動を出す。
// 山は「判定の0.25秒前〜判定の0.25秒後」かつ「技の開始0.1秒以降」で探す。技の開始の混ぜ（0.06〜0.1秒）で、前の姿勢から刀が一気に動く分（fadePopM）を山と取り違えないため。
export function summarize(run) {
  const out = [], frames = run.frames;
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i];
    if (!b.move || !a.tip || !b.tip) continue;
    const id = b.move, start = b.time - b.mt;
    let item = out.find(o => o.id === id && Math.abs(o.start - start) < 1e-3);
    if (!item) out.push(item = { id, start, samples: [] });
    const dt = b.time - a.time; if (dt <= 0) continue;
    const d = Math.hypot(b.tip[0] - a.tip[0], b.tip[1] - a.tip[1], b.tip[2] - a.tip[2]);
    const dw = Math.hypot(b.wrist[0] - a.wrist[0], b.wrist[1] - a.wrist[1], b.wrist[2] - a.wrist[2]);
    item.samples.push({ t: b.mt - dt / 2, tipSpeed: d / dt, wristSpeed: dw / dt, step: d, shown: b.shown, trails: b.trails });
  }
  const r = x => Math.round(x * 1000) / 1000, ms = x => Math.round(x * 1000);
  return { actor: run.actor, name: run.name, rate: run.rate ?? 1, moves: out.map(({ id, samples }) => {
    const m = MOVES_TIMING[id]; if (!m || !samples.length) return { id, n: samples.length };
    const lo = Math.max(0.1, m.windup - 0.25), hi = m.windup + m.active + 0.25, win = samples.filter(s => s.t >= lo && s.t <= hi);
    const peakOf = key => {
      let k = 0; for (let i = 1; i < win.length; i++) if (win[i][key] > win[k][key]) k = i;
      let a = k, b = k; while (a > 0 && win[a - 1][key] >= win[k][key] / 2) a--; while (b < win.length - 1 && win[b + 1][key] >= win[k][key] / 2) b++;
      return { at: win[k].t, max: win[k][key], from: win[a].t, to: win[b].t };
    };
    const tip = peakOf('tipSpeed'), wrist = peakOf('wristSpeed');
    const w0 = m.windup - 0.04, w1 = m.windup + m.active + 0.10, end = m.windup + m.active;
    const path = samples.filter(s => s.t >= w0 && s.t <= w1).reduce((sum, s) => sum + s.step, 0);
    const pop = samples.filter(s => s.t < 0.1).reduce((x, s) => Math.max(x, s.step), 0);
    const trails = samples.map(s => s.trails).filter(Boolean);
    return { id, judge: [r(m.windup), r(end)], tipPeakAt: r(tip.at), tipPeakMax: r(tip.max), tipHalf: [r(tip.from), r(tip.to)],
      wristPeakAt: r(wrist.at), wristPeakMax: r(wrist.max), wristHalf: [r(wrist.from), r(wrist.to)],
      tipPeakVsJudgeStartMs: ms(tip.at - m.windup), wristPeakVsJudgeStartMs: ms(wrist.at - m.windup),
      wristHalfStartVsJudgeStartMs: ms(wrist.from - m.windup), wristHalfEndVsJudgeEndMs: ms(wrist.to - end),
      trailWindowPathM: r(path), maxStepM: r(Math.max(...win.map(s => s.step))), fadePopM: r(pop),
      ...(trails.length ? { trailMaxVerts: Math.max(...trails.map(t => t.vertices)), trailMaxActive: Math.max(...trails.map(t => t.active)) } : {}) };
  }) };
}

// ---------------------------------------------------------------------------------------------------- 接触時刻（8.3a 第2周）
// 技ごとの始め方。主人公の三連は本物の入力（秒）で出し、ほかは論理の状態を技の予備の始めにして結線を呼ぶ（検査だけの近道）。
export const CONTACT_MOVES = [
  { actor: 'hero', move: 'light1', press: [[0, 'click']] },
  { actor: 'hero', move: 'light2', press: [[0, 'click'], [0.333, 'click']] },
  { actor: 'hero', move: 'light3', press: [[0, 'click'], [0.333, 'click'], [0.733, 'click']] },
  { actor: 'hero', move: 'heavy', press: [[0, 'heavy']] },
  { actor: 'hero', move: 'counter', force: true },
  { actor: 'hero', move: 'finisher', force: true, kneel: 'road_scout' },
  { actor: 'road_scout', move: 'soldier_slash', force: true },
  { actor: 'road_scout', move: 'soldier_thrust', force: true },
  { actor: 'officer', move: 'officer_a', force: true },
  { actor: 'officer', move: 'officer_b', force: true },
  { actor: 'officer', move: 'officer_c', force: true },
];
export const CONTACT_DT = 1 / 240, TORSO_HEIGHT = 1.1, BLADE_MID = 0.52, BLADE_TIP = 0.88;

async function measureContacts({ v, step, log }) {
  await v(`(() => {
    const g = __valley.game, MOVES = __ct.MOVES;
    __ct.contactRun = spec => {
      const DT = ${CONTACT_DT}, hero = g.hero;
      const actor = spec.actor === 'hero' ? hero : g.enemies.find(e => e.id === spec.actor);
      const f = actor.fighter, ch = actor.character, w = ch.weapons.tachiDrawn, m = MOVES[spec.move];
      const at = y => { w.holder.updateWorldMatrix(true, false); const e = w.holder.matrixWorld.elements; return [e[4] * y + e[12], e[5] * y + e[13], e[6] * y + e[14]]; };
      const input = g.input;
      const press = kind => { if (kind === 'click') { input.mousePressed.add(0); input.mouse.add(0); } else if (kind === 'heavy') { input.pressed.add('KeyF'); input.held.add('KeyF'); } };
      let torso = null;
      if (spec.kneel) {                     // とどめ：膝をついた相手の胸を点にする（当てない）
        const k = g.enemies.find(e => e.id === spec.kneel), fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
        k.place(actor.pos.x + fx * 1.35, actor.pos.z + fz * 1.35, actor.yaw + Math.PI); k.dormant = false; k.brain.state = 'combat'; k.brain.awareness = 1;
        const kf = k.fighter; kf.state = 'stagger'; kf.staggerT = 2.2; kf.posture = 0; kf.move = null;   // 崩れの論理の状態（動作は膝つき）
        k.onCombatEvent({ type: 'stagger_start' });
        for (let i = 0; i < 200; i++) g.update(DT);
        const b = k.character.bones.get('Spine02'); b.updateWorldMatrix(true, false); const e = b.matrixWorld.elements;
        torso = [e[12], e[13], e[14]];
      }
      if (spec.force) {
        f.move = { id: spec.move, t: 0, phase: 'windup', struck: [], targetId: null }; f.state = 'attack';
        f.telegraphing = m.telegraph > 0; f.noRegenT = 1.2;
        f.pendingEvents.push({ type: 'phase', id: f.id, moveId: spec.move, phase: 'windup' });
        if (actor === hero) hero.beginMove(spec.move, { aim: false }); else { actor.beginMove(spec.move); actor.chainRoll = 9; }
      }
      const out = [], steps = Math.ceil((((spec.press || []).at(-1)?.[0] || 0) + m.windup + m.active + m.recover + 0.15) / DT);
      for (let i = 0; i < steps; i++) {
        for (const [pt, kind] of spec.press || []) if (Math.abs(pt - i * DT) < DT / 2) press(kind);
        g.update(DT);
        input.mouse.delete(0); input.held.delete('KeyF');
        const mv = f.move;
        if (mv && mv.id === spec.move) {
          if (!torso) {                     // 技の始めの位置から、前へ間合いの距離。地面から1.1m
            const fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw), x = actor.pos.x + fx * m.reach, z = actor.pos.z + fz * m.reach;
            torso = [x, g.terrain.heightAt(x, z) + ${TORSO_HEIGHT}, z];
          }
          out.push({ t: mv.t, phase: mv.phase, clip: ch.currentName, ct: ch.current ? ch.current.time : null, tip: at(${BLADE_TIP}), mid: at(${BLADE_MID}), pos: [actor.pos.x, actor.pos.y, actor.pos.z], stop: g.stopT > 0 });
        } else if (out.length) break;
      }
      return { torso, samples: out, yaw: actor.yaw };
    };
    return true;
  })()`);
  const results = [];
  for (const spec of CONTACT_MOVES) {
    // 毎回、主人公を開けた所へ戻し、相手は遠ざける（敵の技は、主人公から6m離した所で出させる）
    await v(`(() => { const g = __valley.game; __ct.placeHero(); for (const e of g.enemies) { e.dormant = true; e.place(-80 + Math.random() * 0.01, -80, 0); }
      ${spec.actor !== 'hero' ? `__ct.placeEnemy(${JSON.stringify(spec.actor)}, 0, -6, Math.PI / 2);` : ''} return true; })()`);
    await step(30);
    const run = await v(`__ct.contactRun(${JSON.stringify(spec)})`);
    const c = contactOf(run, MOVES_TIMING[spec.move]);
    results.push({ actor: spec.actor, ...c, ...(process.env.KZ_RAW ? { torso: run.torso, yaw: run.yaw, raw: run.samples } : {}) });
    log(`contact ${spec.move}: ${c.contactT ?? '-'}s (judge ${c.judgeStart}s, ${c.diffMs ?? '-'}ms) clip ${c.clip}@${c.clipTime ?? '-'} min ${c.minDist}m${c.reached ? '' : ' (届かない)'}`);
  }
  return results;
}

// 点 p から線分 ab への距離
export function segmentDistance(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
  const L = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2], k = L > 0 ? Math.max(0, Math.min(1, (ab[0] * ap[0] + ab[1] * ap[1] + ab[2] * ap[2]) / L)) : 0;
  return { d: Math.hypot(ap[0] - ab[0] * k, ap[1] - ab[1] * k, ap[2] - ab[2] * k), k, at: [a[0] + ab[0] * k, a[1] + ab[1] * k, a[2] + ab[2] * k] };
}
// 接触時刻：判定の0.35秒前〜判定の終わり0.35秒後（技の開始0.06秒以降）で、切先が動いている（毎秒3m以上）サンプルのうち、
// 刃の中ほど〜切先の線分の、胴に最も近い点が胴の高さ±0.35m（BAND）にあるもの（＝刃が胴の高さを通っている）の中で、胴の点へ最も近いもの。
// 胴の高さを通らない技（無ければ）は、高さを問わず最も近いもの。前後のサンプルとの放物線で時刻・動作の時刻・距離を詰める。
// 届いた＝最短0.2m以内（胴の半径）。袈裟（Katana_Kesa_Cut）は正面を頭の上（約2.0m）で横切り、左の胴の高さへ降りるので、高さで絞らないと頭上のコマを選ぶ。
export const REACH_RADIUS = 0.2, BAND = 0.35;
export function contactOf(run, m) {
  const s = run.samples, T = run.torso, r3 = x => Math.round(x * 1000) / 1000;
  const lo = Math.max(0.06, m.windup - 0.35), hi = m.windup + m.active + 0.35;
  const rows = s.map((x, i) => {
    const prev = s[Math.max(0, i - 1)], dt = x.t - prev.t;
    const speed = i > 0 && dt > 0 ? Math.hypot(x.tip[0] - prev.tip[0], x.tip[1] - prev.tip[1], x.tip[2] - prev.tip[2]) / dt : 0;
    return { ...x, speed, ...segmentDistance(T, x.mid, x.tip) };
  });
  const pick = band => { let k = -1;
    for (let i = 1; i < rows.length - 1; i++) if (rows[i].t >= lo && rows[i].t <= hi && rows[i].speed >= 3 && (!band || Math.abs(rows[i].at[1] - T[1]) <= BAND) && (k < 0 || rows[i].d < rows[k].d)) k = i;
    return k; };
  let k = pick(true); const inBand = k >= 0; if (!inBand) k = pick(false);
  if (k < 0) return { move: m.id, judgeStart: m.windup, contactT: null };
  // 放物線（等間隔でないので、時刻を軸に3点で）。頂点が外れたら、そのサンプルのまま
  const [a, b, c] = [rows[k - 1], rows[k], rows[k + 1]];
  const fit = (x0, y0, x1, y1, x2, y2) => { const d = (x0 - x1) * (x0 - x2) * (x1 - x2); if (Math.abs(d) < 1e-12) return null;
    const A = (x2 * (y1 - y0) + x1 * (y0 - y2) + x0 * (y2 - y1)) / d, B = (x2 * x2 * (y0 - y1) + x1 * x1 * (y2 - y0) + x0 * x0 * (y1 - y2)) / d; return A > 0 ? -B / (2 * A) : null; };
  let t = b.t; const v = fit(a.t, a.d, b.t, b.d, c.t, c.d); if (v !== null && v >= a.t && v <= c.t) t = v;
  const lerp = (p, q, key) => p[key] + (q[key] - p[key]) * (t - p.t) / (q.t - p.t || 1);
  const [p, q] = t <= b.t ? [a, b] : [b, c];
  const clipTime = p.ct !== null && q.ct !== null && p.clip === q.clip ? lerp(p, q, 'ct') : b.ct;
  const height = b.at[1] - (T[1] - TORSO_HEIGHT);
  return { move: m.id, judgeStart: m.windup, contactT: r3(t), diffMs: Math.round((t - m.windup) * 1000), clip: b.clip, clipTime: r3(clipTime),
    minDist: r3(b.d), reached: b.d <= REACH_RADIUS, inBand, bladeAt: r3(b.k), heightAboveGround: r3(height), tipSpeed: r3(b.speed), samples: rows.length,
    distanceToTorso: r3(Math.hypot(T[0] - b.pos[0], T[2] - b.pos[2])) };
}
