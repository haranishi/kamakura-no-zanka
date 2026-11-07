// Read private data only at execution time. Never persist geographical samples.
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { decodeRivers, prepareRivers } from '../../dist/valley/kamakura-rivers.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
export async function verifyRivers(data, dir) {
  if (!data.meta.rivers) return { skip: 'meta.rivers のない旧版' };
  assert.equal(data.meta.rivers.file, 'rivers.json');
  const rivers = decodeRivers(JSON.parse(await fs.readFile(path.join(dir, 'rivers.json'), 'utf8')));
  assert.equal(rivers.points, data.meta.rivers.points);
  const prepared = prepareRivers(rivers);
  const report = { rivers: rivers.rivers.length, points: rivers.points, vertices: prepared.chunks.reduce((n, c) => n + c.positions.length / 3, 0),
    ribbonVertices: prepared.ribbons.reduce((n, r) => n + r.positions.length / 3, 0), chunks: prepared.chunks.length,
    seaClipped: prepared.ribbons.filter(r => r.seaClipped).length, excludedSegments: prepared.ribbons.reduce((n, r) => n + r.excludedSegments, 0), scales: [] };
  for (const scale of [1, 1.8]) {
    const t = createKamakuraTerrain(data, scale), values = [], outliers = []; let hidden = 0;
    for (const r of rivers.rivers) {
      let outside = 0;
      r.xy_m.forEach(([x, north], i) => {
        const delta = r.water_elev_m[i] * scale - t.heightAt(x, -north);
        values.push(delta); if (delta < 0) hidden++;
        if (Math.abs(delta / scale - .5) > .15) outside++;
      });
      if (outside) outliers.push({ id: r.id, points: outside });
    }
    values.sort((a, b) => a - b);
    const outside = outliers.reduce((n, r) => n + r.points, 0), fraction = 1 - outside / values.length;
    const distribution = { min: values[0], p01: values[Math.floor(values.length * .01)], median: values[Math.floor(values.length / 2)],
      p99: values[Math.floor(values.length * .99)], max: values.at(-1), mean: values.reduce((a, b) => a + b, 0) / values.length };
    report.scales.push({ scale, distribution, fraction, outside, outliers, hidden });
  }
  for (const chunk of prepared.chunks) {
    assert(chunk.positions.every(Number.isFinite) && chunk.uvs.every(Number.isFinite));
    for (let i = 0; i < chunk.indices.length; i += 3) {
      const [a, b, c] = chunk.indices.slice(i, i + 3).map(n => chunk.positions.slice(n * 3, n * 3 + 3));
      assert((b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]) > 1e-6, 'Private river triangle is inverted or degenerate');
    }
  }
  // Emit the measured report before assertions so failures also show counts and IDs.
  console.log(JSON.stringify({ rivers: report }, null, 2));
  assert(report.vertices <= 40000, 'River vertex budget exceeded');
  assert(report.scales.every(s => s.fraction >= .98), 'River water/terrain acceptance below 98%');
  return report;
}
