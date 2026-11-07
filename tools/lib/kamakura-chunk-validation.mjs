import assert from 'node:assert/strict';
import { LODS, chunkGeometry } from '../../dist/valley/kamakura-chunks.js';
import { createChunkJobs } from '../../dist/valley/kamakura-chunk-jobs.js';
function boundary(g, axis, value) {
  const out = new Map();
  for (let k = 0; k < g.positions.length; k += 3) if (Math.abs(g.positions[k + axis] - value) < 1e-7) {
    out.set(g.positions[k + (axis === 0 ? 2 : 0)], [g.positions[k + 1], ...g.normals.slice(k, k + 3), ...(g.colors?.slice(k, k + 3) || [])]);
  }
  return out;
}
// The same geometry and transaction path used by the view, with no GPU objects.
export function verifyScheduledSeams(t, i = 0, j = 0, size = 64) {
  let cases = 0;
  for (const a of LODS) for (const b of LODS) for (const axis of [0, 2]) {
    const left = { i, j, x: 0, z: 0, step: a, loaded: true };
    const right = { i: i + (axis === 0 ? size : 0), j: j + (axis === 2 ? size : 0), x: 1, z: 1, step: b, loaded: true };
    const side = axis === 0 ? ['east', 'west'] : ['south', 'north'];
    const neighbors = ch => ({ [side[ch === left ? 0 : 1]]: ch === left ? right : left });
    const geometry = job => chunkGeometry(t, job.ch.i, job.ch.j, job.ch.i + size, job.ch.j + size, job.step, job.edges);
    const current = new Map([left, right].map(ch => [ch, geometry({ ch, step: ch.step, edges: { [side[ch === left ? 0 : 1]]: ch === left ? b : a } })]));
    const value = axis === 0 ? t.x0 + (i + size) * t.cell : t.z0 + (j + size) * t.cell;
    const verify = () => {
      const l = boundary(current.get(left), axis, value), r = boundary(current.get(right), axis, value);
      assert.equal(l.size, size * (t.patches ? 4 : 1) + 1); assert.equal(r.size, l.size);
      for (const [key, values] of l) { assert(r.has(key)); values.forEach((v, k) => assert(Math.abs(v - r.get(key)[k]) < 1e-8, 'Scheduled seam mismatch (values withheld)')); }
    };
    verify();
    const jobs = createChunkJobs([left, right], neighbors, ch => ch === left ? LODS[(LODS.indexOf(a) + 1) % 4] : b);
    jobs.plan(left); const batch = jobs.next(), pending = new Map();
    for (const job of batch.jobs) {
      pending.set(job.ch, geometry(job)); jobs.prepared(batch.generation, job);
      if (pending.size < batch.jobs.length) { assert.equal(jobs.commit(batch.generation), null); verify(); }
    }
    for (const job of jobs.commit(batch.generation)) current.set(job.ch, pending.get(job.ch)); verify(); cases++;
  }
  return { combinations: cases, stages: ['before', 'preparing', 'committed'] };
}
