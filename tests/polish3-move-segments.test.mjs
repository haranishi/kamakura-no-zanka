import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { MOVES } from '../dist/valley/combat.js';
import { MOVE_CLIPS, CLIP_SEGMENTS, segmentFor } from '../dist/valley/anim-data.js';
import { actorRates } from '../tools/measure-move-segments.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const clips = JSON.parse(read('dist/assets/characters/clips.json')).clips;
const run = (args = [], cwd = root, tool = 'measure-move-segments.mjs') =>
  spawnSync(process.execPath, [path.join(cwd, 'tools', tool), ...args], { cwd, encoding: 'utf8' });
const result = run(['--json']);
assert.equal(result.status, 0, result.stderr);
const report = JSON.parse(result.stdout);
const rounded = (v, digits = 2) => Number(v.toFixed(digits));
const temporary = fn => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'polish3-measure-'));
  try { fn(dir); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
};

test('MOVE_CLIPS の13技が揃い、区間と使用割合が有効', () => {
  assert.equal(report.moves.length, 13);
  assert.deepEqual(report.moves.map(m => m.id), Object.keys(MOVE_CLIPS));
  for (const m of report.moves) {
    assert(m.to > m.from, m.id);
    assert(m.ratio >= 0 && m.ratio <= 1, m.id);
  }
});

test('segmentFor の戻り値から秒・倍率・割合・決め打ちを記録する', () => {
  for (const m of report.moves) {
    const meta = clips[m.clip], override = CLIP_SEGMENTS[m.clip];
    const seg = segmentFor(meta, MOVES[m.id], override);
    assert.equal(m.speed, rounded(seg.speed), m.id);
    assert.equal(m.from, rounded(seg.from), m.id);
    assert.equal(m.to, rounded(seg.to), m.id);
    assert.equal(m.usedSeconds, rounded(seg.to - seg.from), m.id);
    assert.equal(m.ratio, rounded((seg.to - seg.from) / meta.seconds, 3), m.id);
    assert.equal(m.approximate, seg.approximate, m.id);
    assert.equal(m.fixedSegment, !!override, m.id);
  }
});

test('research-polish3 の表の全12行と一致し、味方射撃は弓兵と同値', () => {
  const source = read('.kiro/specs/hidden-valley-slice/research-polish3.md');
  const rows = source.split('\n').filter(line => /^\| \w+ \| \w+ \| \d/.test(line));
  assert.equal(rows.length, 12);
  for (const row of rows) {
    const [id, clip, seconds, moveSeconds, interval, speed, percent] = row.split('|').slice(1, -1).map(s => s.trim());
    const m = report.moves.find(m => m.id === id);
    const [from, to] = interval.split('–').map(Number);
    assert.deepEqual([m.clip, m.clipSeconds, m.moveSeconds, m.from, m.to, m.speed, Math.round(m.ratio * 100)],
      [clip, +seconds, +moveSeconds, from, to, +speed, parseInt(percent)], id);
  }
  const shot = id => {
    const { clip, clipSeconds, moveSeconds, from, to, usedSeconds, speed, ratio } = report.moves.find(m => m.id === id);
    return { clip, clipSeconds, moveSeconds, from, to, usedSeconds, speed, ratio };
  };
  assert.deepEqual(shot('ally_shot'), shot('archer_shot'));
});

test('敵だけにコードで確認した0.94〜1.06倍を適用し、丸め前の速度で計算する', () => {
  const rates = actorRates(read('dist/valley/actors.js'), read('dist/valley/characters.js'));
  assert.deepEqual(rates.enemy, [0.94, 1.06]);
  for (const m of report.moves) {
    const enemy = /^(soldier_|officer_)/.test(m.id) || m.id === 'archer_shot';
    const speed = segmentFor(clips[m.clip], MOVES[m.id], CLIP_SEGMENTS[m.clip]).speed;
    assert.equal(m.effectiveSpeedMin, rounded(speed * (enemy ? 0.94 : 1)), m.id);
    assert.equal(m.effectiveSpeedMax, rounded(speed * (enemy ? 1.06 : 1)), m.id);
  }
});

test('個体倍率をコードから確認できなければ null と理由を残す', () => {
  const rates = actorRates('', '');
  assert.equal(rates.enemy, null);
  assert.equal(rates.other, null);
  assert.match(rates.notes.join(' '), /確認できない.*null/);
});

test('目標判定・例外理由は丸め前の値と一致する', () => {
  assert.deepEqual(report.target, { minRatio: 0.6, maxSpeed: 1.8 });
  const expected = [];
  for (const m of report.moves) {
    const seg = segmentFor(clips[m.clip], MOVES[m.id], CLIP_SEGMENTS[m.clip]);
    const reasons = [];
    if ((seg.to - seg.from) / clips[m.clip].seconds < 0.6) reasons.push('ratio');
    if (seg.speed > 1.8) reasons.push('speed');
    assert.equal(m.meetsTarget, reasons.length === 0, m.id);
    if (reasons.length) expected.push({ id: m.id, reasons });
  }
  assert.deepEqual(report.exceptions, expected);
});

test('JSONとMarkdownは2回実行して同一バイト列', () => {
  const json = run(['--json']);
  assert.equal(json.status, 0, json.stderr);
  assert.equal(json.stdout, result.stdout);
  const first = run(), second = run();
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(first.stdout, second.stdout);
  assert.match(first.stdout, /\| ally_shot \|/);
});

test('--write は親を作り、保存済みの前値とstdoutのJSONにバイト単位で一致', () => temporary(dir => {
  const output = path.join(dir, 'nested', 'moves.json');
  const written = run(['--write', output]);
  assert.equal(written.status, 0, written.stderr);
  assert.equal(written.stdout, '');
  assert.equal(fs.readFileSync(output, 'utf8'), result.stdout);
  assert.equal(read('reports/polish3/baseline/move-segments-before.json'), result.stdout);
}));

test('不正な引数は終了コード2', () => {
  for (const args of [['--missing'], ['--write'], ['--write', '--json'], ['--json', '--json'], ['extra']]) {
    assert.equal(run(args).status, 2, args.join(' '));
  }
});

test('対応する動作が clips.json に無ければ終了コード1', () => temporary(dir => {
  // 本物のdistは変更せず、Nodeのimport解決に必要な最小の入力だけ隔離する。
  for (const name of ['tools/measure-move-segments.mjs', 'dist/valley/combat.js', 'dist/valley/anim-data.js',
    'dist/valley/actors.js', 'dist/valley/characters.js']) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.copyFileSync(path.join(root, name), path.join(dir, name));
  }
  fs.writeFileSync(path.join(dir, 'package.json'), '{"type":"module"}\n');
  const input = JSON.parse(read('dist/assets/characters/clips.json'));
  delete input.clips.Archery_Shot;
  fs.mkdirSync(path.join(dir, 'dist/assets/characters'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'dist/assets/characters/clips.json'), JSON.stringify(input));
  const failed = run(['--json'], dir);
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /archer_shot.*Archery_Shot/);
  assert.equal(failed.stdout, '');
}));

test('出所は69動作・カテゴリ3/66・全件未確認で、保存済みの前値と一致', () => temporary(dir => {
  const tool = 'measure-clip-provenance.mjs', first = run(['--json'], root, tool);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(run(['--json'], root, tool).stdout, first.stdout);
  const provenance = JSON.parse(first.stdout);
  assert.equal(provenance.clips.length, 69);
  assert.deepEqual(provenance.clips.map(c => c.clip), Object.keys(clips).sort());
  assert.deepEqual(provenance.counts, { 'cmu-mocap': 3, 'meshy-motion-library-or-text-to-motion': 66 });
  for (const c of provenance.clips) {
    assert.equal(c.status, 'unconfirmed');
    assert.equal(c.seconds, rounded(clips[c.clip].seconds));
    assert.equal(c.category, c.clip.startsWith('CMU_') ? 'cmu-mocap' : 'meshy-motion-library-or-text-to-motion');
  }
  const output = path.join(dir, 'nested', 'clips.json');
  assert.equal(run(['--write', output], root, tool).status, 0);
  assert.equal(fs.readFileSync(output, 'utf8'), first.stdout);
  assert.equal(read('reports/polish3/baseline/clip-provenance-before.json'), first.stdout);
  assert.equal(run(['--missing'], root, tool).status, 2);
}));
