// Pure scheduling: committed steps remain unchanged until the whole seam-safe batch is ready.
export const chunkBudget = quality => quality === 'light' ? 2 : 3;
export const withinChunkBudget = (start, now, count, budget) => count === 0 || now - start < budget;
export function shouldPlanChunks(last, pos, frame) {
  return !last || frame % 4 === 0 || (pos.x - last.x) ** 2 + (pos.z - last.z) ** 2 >= 9;
}
export function createChunkJobs(chunks, neighbors, wantLOD) {
  let generation = 0, active = null, queue = [], cursor = 0, targets = new Map(), ranks = new Map();
  const distance2 = (ch, pos) => (ch.x - pos.x) ** 2 + (ch.z - pos.z) ** 2;
  function cancel() { generation++; active = null; }
  function plan(pos) {
    const ordered = chunks.map(ch => {
      const d2 = distance2(ch, pos); return { ch, d2, want: wantLOD(ch, Math.sqrt(d2)) };
    }).sort((a, b) => a.d2 - b.d2);
    targets = new Map(ordered.map(v => [v.ch, v.want]));
    ranks = new Map(ordered.map((v, i) => [v.ch, i]));
    if (active && active.jobs.some(job => targets.get(job.ch) !== job.want)) cancel();
    for (const { ch, d2 } of ordered) ch.visible = d2 < 3300 ** 2;
    queue = ordered.filter(({ ch, want }) => ch.visible && (!ch.loaded || want !== ch.step)); cursor = 0;
  }
  function next() {
    if (active) return active;
    // Finish near-to-far: both new arrivals and LOD changes use the same time budget.
    let candidate;
    while (cursor < queue.length) {
      const item = queue[cursor++];
      if (!item.ch.loaded || item.want !== item.ch.step) { candidate = item; break; }
    }
    if (!candidate) return null;
    const center = candidate.ch, step = candidate.want;
    const affected = [center];
    if (step !== center.step) for (const n of Object.values(neighbors(center))) if (n?.loaded) affected.push(n);
    const jobs = affected.sort((a, b) => ranks.get(a) - ranks.get(b))
      .map(ch => ({ ch, want: targets.get(ch), step: ch === center ? step : ch.step,
        edges: Object.fromEntries(Object.entries(neighbors(ch)).map(([side, n]) => [side, n === center ? step : n?.step ?? ch.step])), done: false }));
    active = { generation: ++generation, center, step, jobs };
    return active;
  }
  function prepared(token, job) {
    if (!active || token !== active.generation || !active.jobs.includes(job)) return false;
    job.done = true; return true;
  }
  function commit(token) {
    if (!active || token !== active.generation || !active.jobs.every(j => j.done)) return null;
    const jobs = active.jobs;
    for (const job of jobs) { job.ch.step = job.step; job.ch.loaded = true; }
    active = null; return jobs;
  }
  return { plan, next, prepared, commit, cancel, get active() { return active; }, get generation() { return generation; } };
}
