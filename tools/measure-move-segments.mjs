// R18・8.0: 表示側の対応表と現行の純粋関数を使う。ゲームの規則は変更しない。
// 8.3a: 振りの山を判定へ合わせ直す技（MOVE_SYNC）は3区間の速さで切り出すので、その区間・速さ・山の時刻も記録する。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOVES } from '../dist/valley/combat.js';
import { MOVE_CLIPS, CLIP_SEGMENTS, MOVE_SYNC, segmentFor, syncedSegment } from '../dist/valley/anim-data.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const round = (value, digits = 2) => Number(value.toFixed(digits));

// actors.js は Three.js を参照するので実行せず、確認できる式だけを読む。
export function actorRates(actors, characters) {
  const enemy = actors.match(/export class EnemyActor extends Actor \{([\s\S]*?)\n  get alive\(\)/)?.[1];
  const formula = enemy?.match(/this\.character\.rate\s*=\s*(\d*\.?\d+)\s*\+\s*\(h\s*%\s*(\d+)\)\s*\*\s*(\d*\.?\d+)\s*;/);
  const assignments = actors.match(/\.rate\s*=(?!=)/g) || [];
  if (!formula || assignments.length !== 1 || !/return h >>> 0;/.test(actors) ||
      !/h = hashId\(def\.id\)/.test(enemy) || !/this\.rate = 1;/.test(characters) ||
      !/this\.mixer\.update\(dt \* this\.rate\)/.test(characters)) {
    return { enemy: null, other: null, notes: ['actors.js の個体倍率式または characters.js の初期倍率・適用経路を確認できないため、実効倍率は null。'] };
  }
  const base = Number(formula[1]), count = Number(formula[2]), step = Number(formula[3]);
  if (count < 1 || base <= 0) throw new Error('敵の個体倍率式が不正です');
  return {
    enemy: [base, base + (count - 1) * step], other: [1, 1],
    notes: [`actors.js の EnemyActor: ${formula[0]} / hashId は符号なし整数。余り0〜${count - 1}の理論範囲であり、配置済み個体の実測ではない。`,
      'characters.js は rate=1 で初期化し、mixer.update(dt * this.rate) で全動作へ適用。敵技 soldier_・officer_・archer_shot に個体差を適用し、主人公と ally_shot は1倍。'],
  };
}

// 技の切り出し（characters.js の playMove と同じ選び方）
export function segmentOf(meta, id, timing) {
  return MOVE_SYNC[id] ? syncedSegment(meta, timing, MOVE_SYNC[id]) : segmentFor(meta, timing, CLIP_SEGMENTS[MOVE_CLIPS[id].clip]);
}
// 手首の速さの山（meta.active）が再生される時刻（技の開始からの秒）。3区間の技は折れ線の点、1つの速さの技は (山 − from) ÷ 速さ。
// 弓（放ちを決め打ち）と、山の記録が無い動作は null。
export function peakTimes(meta, segment, fixed) {
  if (fixed || !meta.active) return null;
  if (segment.knots) return [segment.knots[1][0], segment.knots[2][0]];
  return [(meta.active[0] - segment.from) / segment.speed, (meta.active[1] - segment.from) / segment.speed];
}

export function measureMoveSegments() {
  const { clips } = JSON.parse(read('dist/assets/characters/clips.json'));
  const rates = actorRates(read('dist/valley/actors.js'), read('dist/valley/characters.js'));
  const exceptions = [];
  const moves = Object.entries(MOVE_CLIPS).map(([id, { clip }]) => {
    const meta = clips[clip], timing = MOVES[id];
    if (!meta) throw new Error(`clips.json に動作がありません: ${id} / ${clip}`);
    if (!timing) throw new Error(`MOVES に技がありません: ${id}`);
    const override = CLIP_SEGMENTS[clip];
    const segment = segmentOf(meta, id, timing);
    const usedSeconds = segment.to - segment.from, ratio = usedSeconds / meta.seconds;
    const reasons = [];
    if (ratio < 0.60) reasons.push('ratio');
    if (segment.speed > 1.8) reasons.push('speed');
    if (reasons.length) exceptions.push({ id, reasons });
    // 3区間の技は、ゲームの時刻で動作を進めるので個体の速さが掛からない（characters.js の followWarp）
    const rate = segment.knots ? [1, 1] : /^(soldier_|officer_)/.test(id) || id === 'archer_shot' ? rates.enemy : rates.other;
    const peak = peakTimes(meta, segment, !!override), end = timing.windup + timing.active;
    return { id, clip, clipSeconds: round(meta.seconds),
      moveSeconds: round(timing.windup + timing.active + timing.recover),
      from: round(segment.from), to: round(segment.to), usedSeconds: round(usedSeconds),
      speed: round(segment.speed), ratio: round(ratio, 3), approximate: segment.approximate,
      fixedSegment: !!override, effectiveSpeedMin: rate ? round(segment.speed * rate[0]) : null,
      effectiveSpeedMax: rate ? round(segment.speed * rate[1]) : null, meetsTarget: reasons.length === 0,
      speeds: segment.speeds ? segment.speeds.map(x => round(x)) : null,
      peakStart: peak ? round(peak[0], 3) : null, peakEnd: peak ? round(peak[1], 3) : null,
      peakStartVsJudgeMs: peak ? Math.round((peak[0] - timing.windup) * 1000) : null, peakEndVsJudgeEndMs: peak ? Math.round((peak[1] - end) * 1000) : null };
  });
  return { target: { minRatio: 0.60, maxSpeed: 1.8 },
    notes: ['MOVES の時間割と MOVE_CLIPS を、characters.js の playMove と同じ選び方（MOVE_SYNC の技は syncedSegment、ほかは segmentFor）で切り出した静的計算。目標判定は丸め前の使用割合と基準倍率（3区間の技は最大の速さ）で行う。',
      ...rates.notes,
      '3区間の技（MOVE_SYNC）は、ゲームの時刻で動作を進めるので個体の速さが掛からない。実効倍率は基準倍率と同じ。',
      '山（peakStart・peakEnd）は手首の速さの山（clips.json の active）が再生される時刻（技の開始からの秒）。弓は放ちを決め打ちするので null。',
      '実プレイの割り込み・混合・停止は未測定。actors.js の tryInteract は闇討ちで finisher に別時間割を渡すため、その演出の区間も対象外。'],
    moves, exceptions };
}

// 変更前の記録（8.0 の前値など）と比べる。前値に山の時刻が無いとき：8.0 の切り出しは segmentFor だけで決まるので、
// segmentFor が前値の from・to・速さ（丸めた値）を再現できれば、丸める前の値で山を計算する。再現できなければ丸めた値から計算し、approx に印を付ける。
export function compareMoveSegments(before, after) {
  const { clips } = JSON.parse(read('dist/assets/characters/clips.json'));
  const peakOf = m => {
    if (m.peakStart !== undefined) return [m.peakStartVsJudgeMs, m.peakEndVsJudgeEndMs, false];
    const meta = clips[m.clip], t = MOVES[m.id], exact = segmentFor(meta, t, CLIP_SEGMENTS[m.clip]);
    const same = round(exact.from) === m.from && round(exact.to) === m.to && round(exact.speed) === m.speed;
    const p = peakTimes(meta, same ? exact : { from: m.from, speed: m.speed }, m.fixedSegment);
    return p ? [Math.round((p[0] - t.windup) * 1000), Math.round((p[1] - t.windup - t.active) * 1000), !same] : [null, null, !same];
  };
  const shared = ['clip', 'clipSeconds', 'moveSeconds', 'from', 'to', 'usedSeconds', 'speed', 'ratio', 'approximate', 'fixedSegment', 'effectiveSpeedMin', 'effectiveSpeedMax', 'meetsTarget'];
  return after.moves.map(a => {
    const b = before.moves.find(m => m.id === a.id), [bs, be, approx] = peakOf(b), [as, ae] = peakOf(a);
    return { id: a.id, changed: shared.filter(k => JSON.stringify(a[k]) !== JSON.stringify(b[k])),
      ratio: [b.ratio, a.ratio], speed: [b.speed, a.speed], peakStartVsJudgeMs: [bs, as], peakEndVsJudgeEndMs: [be, ae], approx };
  });
}

function markdown(report) {
  const columns = ['id', 'clip', '動作秒', '技秒', 'from', 'to', '使用秒', '倍速', '使用割合', 'approximate', '決め打ち', '実効最小', '実効最大', 'meetsTarget', '3区間の速さ', '山の始め−判定の始め(ms)', '山の終わり−判定の終わり(ms)'];
  const n = value => value === null ? 'null' : value.toFixed(2);
  const rows = report.moves.map(m => [m.id, m.clip, n(m.clipSeconds), n(m.moveSeconds), n(m.from), n(m.to),
    n(m.usedSeconds), n(m.speed), m.ratio.toFixed(3), m.approximate, m.fixedSegment,
    n(m.effectiveSpeedMin), n(m.effectiveSpeedMax), m.meetsTarget, m.speeds ? m.speeds.map(n).join('/') : '-', m.peakStartVsJudgeMs ?? '-', m.peakEndVsJudgeEndMs ?? '-']);
  return ['# 技の使用区間', '', '| ' + columns.join(' | ') + ' |', '| ' + columns.map(() => '---').join(' | ') + ' |',
    ...rows.map(row => '| ' + row.join(' | ') + ' |'), '',
    '目標: 使用割合 ≥ 0.60、基準倍率 ≤ 1.8（丸め前に判定）。', '', '例外:',
    ...report.exceptions.map(e => `- ${e.id}: ${e.reasons.join(' + ')}`), '',
    ...report.notes.map(note => `- ${note}`), ''].join('\n');
}

function compareMarkdown(rows) {
  const v = x => x ?? '-';
  return ['# 技の使用区間：変更前と変更後', '', '| id | 変わった項目 | 使用割合 前→後 | 倍速 前→後 | 山の始め−判定の始め(ms) 前→後 | 山の終わり−判定の終わり(ms) 前→後 |', '| --- | --- | --- | --- | --- | --- |',
    ...rows.map(r => `| ${r.id} | ${r.changed.join(', ') || 'なし'} | ${r.ratio.join(' → ')} | ${r.speed.join(' → ')} | ${r.peakStartVsJudgeMs.map(v).join(' → ')} | ${r.peakEndVsJudgeEndMs.map(v).join(' → ')} |`), ''].join('\n');
}

function main(args) {
  let json = false, output = null, compare = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json' && !json) json = true;
    else if (args[i] === '--write' && output === null && args[i + 1] && !args[i + 1].startsWith('-')) output = args[++i];
    else if (args[i] === '--compare' && compare === null && args[i + 1] && !args[i + 1].startsWith('-')) compare = args[++i];
    else { console.error('使い方: node tools/measure-move-segments.mjs [--json] [--write <path>] [--compare <変更前.json>]'); return 2; }
  }
  try {
    if (compare !== null) {
      const rows = compareMoveSegments(JSON.parse(fs.readFileSync(compare, 'utf8')), measureMoveSegments());
      process.stdout.write(json ? JSON.stringify(rows, null, 2) + '\n' : compareMarkdown(rows));
      return 0;
    }
    const report = measureMoveSegments(), serialized = JSON.stringify(report, null, 2) + '\n';
    if (output !== null) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, serialized); }
    else process.stdout.write(json ? serialized : markdown(report));
    return 0;
  } catch (error) { console.error(error.message); return 1; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
