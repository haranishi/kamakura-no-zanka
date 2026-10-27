import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY } from '../dist/valley/story-data.js';
import { measureGuideStarts } from '../tools/measure-guide-starts.mjs';
test('guide starts cover every beat and all three village entrances, deterministically', () => {
  const a = measureGuideStarts();
  assert.deepEqual(a, measureGuideStarts());
  assert.deepEqual([...new Set(a.rows.map(r => r.beat))].sort(), Object.keys(STORY.beats).filter(k => k !== 'done').sort());
  for (const beat of ['b3_viewpoint', 'b4_village']) assert.deepEqual(a.rows.filter(r => r.beat === beat).map(r => r.variant), ['front', 'north', 'south']);
});
test('guide distances, endpoints and first direction are finite and consistent', () => {
  for (const r of measureGuideStarts().rows) {
    assert.equal(r.objective, STORY.beats[r.beat].objective);
    for (const key of ['straightM', 'roadM', 'angleDeg', 'correctionM']) assert(Number.isFinite(r[key]) && r[key] >= 0, `${r.beat} ${key}`);
    assert(r.angleDeg <= 180);
    for (const p of [r.start, r.destination, r.navEnd, r.firstTurn, ...r.path, ...(r.marker ? [r.marker] : [])]) assert(Number.isFinite(p.x) && Number.isFinite(p.z));
    const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    assert.equal(r.straightM, dist(r.start, r.destination));
    assert.equal(r.roadM, r.path.slice(1).reduce((n, p, i) => n + dist(r.path[i], p), 0));
    assert.deepEqual(r.path.at(-1), r.navEnd);
    assert(r.roadM + r.correctionM + 1e-8 >= r.straightM); // 未測定の検査設計：浮動小数の丸め余裕
  }
  assert.equal(measureGuideStarts().rows.find(r => r.beat === 'b7_result').marker, null);
});
