// R18・8.0: 表示側の対応表と現行の純粋関数を使う。ゲームの規則は変更しない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOVES } from '../dist/valley/combat.js';
import { MOVE_CLIPS, CLIP_SEGMENTS, segmentFor } from '../dist/valley/anim-data.js';

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

export function measureMoveSegments() {
  const { clips } = JSON.parse(read('dist/assets/characters/clips.json'));
  const rates = actorRates(read('dist/valley/actors.js'), read('dist/valley/characters.js'));
  const exceptions = [];
  const moves = Object.entries(MOVE_CLIPS).map(([id, { clip }]) => {
    const meta = clips[clip], timing = MOVES[id];
    if (!meta) throw new Error(`clips.json に動作がありません: ${id} / ${clip}`);
    if (!timing) throw new Error(`MOVES に技がありません: ${id}`);
    const override = CLIP_SEGMENTS[clip];
    const segment = segmentFor(meta, timing, override);
    const usedSeconds = segment.to - segment.from, ratio = usedSeconds / meta.seconds;
    const reasons = [];
    if (ratio < 0.60) reasons.push('ratio');
    if (segment.speed > 1.8) reasons.push('speed');
    if (reasons.length) exceptions.push({ id, reasons });
    const rate = /^(soldier_|officer_)/.test(id) || id === 'archer_shot' ? rates.enemy : rates.other;
    return { id, clip, clipSeconds: round(meta.seconds),
      moveSeconds: round(timing.windup + timing.active + timing.recover),
      from: round(segment.from), to: round(segment.to), usedSeconds: round(usedSeconds),
      speed: round(segment.speed), ratio: round(ratio, 3), approximate: segment.approximate,
      fixedSegment: !!override, effectiveSpeedMin: rate ? round(segment.speed * rate[0]) : null,
      effectiveSpeedMax: rate ? round(segment.speed * rate[1]) : null, meetsTarget: reasons.length === 0 };
  });
  return { target: { minRatio: 0.60, maxSpeed: 1.8 },
    notes: ['MOVES の時間割と MOVE_CLIPS を segmentFor に渡した静的計算。目標判定は丸め前の使用割合と基準倍率で行う。',
      ...rates.notes,
      '実プレイの割り込み・混合・停止は未測定。actors.js の tryInteract は闇討ちで finisher に別時間割を渡すため、その演出の区間も対象外。'],
    moves, exceptions };
}

function markdown(report) {
  const columns = ['id', 'clip', '動作秒', '技秒', 'from', 'to', '使用秒', '倍速', '使用割合', 'approximate', '決め打ち', '実効最小', '実効最大', 'meetsTarget'];
  const n = value => value === null ? 'null' : value.toFixed(2);
  const rows = report.moves.map(m => [m.id, m.clip, n(m.clipSeconds), n(m.moveSeconds), n(m.from), n(m.to),
    n(m.usedSeconds), n(m.speed), m.ratio.toFixed(3), m.approximate, m.fixedSegment,
    n(m.effectiveSpeedMin), n(m.effectiveSpeedMax), m.meetsTarget]);
  return ['# 技の使用区間', '', '| ' + columns.join(' | ') + ' |', '| ' + columns.map(() => '---').join(' | ') + ' |',
    ...rows.map(row => '| ' + row.join(' | ') + ' |'), '',
    '目標: 使用割合 ≥ 0.60、基準倍率 ≤ 1.8（丸め前に判定）。', '', '例外:',
    ...report.exceptions.map(e => `- ${e.id}: ${e.reasons.join(' + ')}`), '',
    ...report.notes.map(note => `- ${note}`), ''].join('\n');
}

function main(args) {
  let json = false, output = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json' && !json) json = true;
    else if (args[i] === '--write' && output === null && args[i + 1] && !args[i + 1].startsWith('-')) output = args[++i];
    else { console.error('使い方: node tools/measure-move-segments.mjs [--json] [--write <path>]'); return 2; }
  }
  try {
    const report = measureMoveSegments(), serialized = JSON.stringify(report, null, 2) + '\n';
    if (output !== null) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, serialized); }
    else process.stdout.write(json ? serialized : markdown(report));
    return 0;
  } catch (error) { console.error(error.message); return 1; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
