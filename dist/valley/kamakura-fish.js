// W2c-9d: empty river -> deterministic local schools. Pure, fixed output pool.
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export function fxHash(x, z, n = 0) {
  let h = Math.imul(Math.round(x * 16) ^ n, 374761393) ^ Math.imul(Math.round(z * 16), 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
// W2c-9d3: linear pigment from olive #344032 and silver #c9cfc6.
export const FISH_WATER = Object.freeze([.035,.12,.15]);
const linear = c => c <= .04045 ? c / 12.92 : ((c + .055) / 1.055) ** 2.4;
const back = [52,64,50].map(c=>linear(c/255)), belly = [201,207,198].map(c=>linear(c/255));
export function fishPigment(channel, top) { return belly[channel] * (1-top) + back[channel] * top; }
export function fishHaze(channel, top, depth, variation=1) {
  const haze=clamp(.15+.45*depth,.15,.60);
  let lum=0; for(let c=0;c<3;c++) lum+=(fishPigment(c,top)*variation*(1-haze)+FISH_WATER[c]*haze)*[.2126,.7152,.0722][c];
  const limit=FISH_WATER[0]*.2126+FISH_WATER[1]*.7152+FISH_WATER[2]*.0722-.04;
  const scale=top===1?Math.min(1,limit/Math.max(.0001,lum)):1;
  return (fishPigment(channel,top)*variation*(1-haze)+FISH_WATER[channel]*haze)*scale;
}
// Split long segments once; index by numeric cell key. Queries never scan the whole river.
export function* prepareFishRiverSteps(data, vscale = 1, terrain = null) {
  const segments = [], cells = new Map(), stride = 1048576, key = (i, j) => i + j * stride;
  let work = 0;
  for (const r of data?.rivers || []) for (let k = 1; k < r.xy_m.length; k++) {
    const a = r.xy_m[k - 1], b = r.xy_m[k], length = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (length < .4) continue;
    const pieces = Math.ceil(length / 12);
    for (let j = 0; j < pieces; j++) {
      // W2c-9p: bound even a long source segment; stop habitat probes on first rejection.
      if (++work % 128 === 0) yield;
      const lo = j / pieces, hi = (j + 1) / pieces, mix = (ar, t) => ar[k - 1] + (ar[k] - ar[k - 1]) * t;
      const s = { ax: a[0] + (b[0] - a[0]) * lo, az: -a[1] - (b[1] - a[1]) * lo,
        dx: (b[0] - a[0]) / pieces, dz: -(b[1] - a[1]) / pieces, length: length / pieces,
        wa: mix(r.width_m, lo), wb: mix(r.width_m, hi), ya: mix(r.water_elev_m, lo) * vscale, yb: mix(r.water_elev_m, hi) * vscale,
        ba: mix(r.bed_m, lo) * vscale, bb: mix(r.bed_m, hi) * vscale, scare: 0, scareUntil: 0, travel: 0, jumpCycle: -1 };
      s.habitat = true;
      if (terrain) {
        // Reject sea/land and channels whose sampled bed leaves no swimming depth.
        habitat: for (const t of [.15, .5, .85]) {
          const half = (s.wa + (s.wb - s.wa) * t) / 2, water = s.ya + (s.yb - s.ya) * t;
          for (const lane of [-.35, 0, .35]) {
            const x = s.ax + s.dx * t - s.dz / s.length * half * lane, z = s.az + s.dz * t + s.dx / s.length * half * lane;
            const wet = terrain.waterAt(x, z);
            if (wet <= .05 || wet >= .46 || water - terrain.heightAt(x, z) < .32) { s.habitat = false; break habitat; }
          }
        }
      }
      s.id = fxHash(s.ax, s.az); s.count = 3 + Math.floor(s.id * 6); s.period = 27 + s.id * 19;
      const id = segments.length; segments.push(s);
      const pad = Math.max(s.wa, s.wb) / 2;
      for (let z = Math.floor((Math.min(s.az, s.az + s.dz) - pad) / 32); z <= Math.floor((Math.max(s.az, s.az + s.dz) + pad) / 32); z++)
        for (let x = Math.floor((Math.min(s.ax, s.ax + s.dx) - pad) / 32); x <= Math.floor((Math.max(s.ax, s.ax + s.dx) + pad) / 32); x++) {
          const q = key(x, z); if (!cells.has(q)) cells.set(q, []); cells.get(q).push(id);
        }
    }
  }
  const stamps = new Uint32Array(segments.length); let epoch = 0;
  function visit(x, z, reach, fn) {
    if (++epoch === 0xffffffff) { stamps.fill(0); epoch = 1; }
    for (let j = Math.floor((z - reach) / 32); j <= Math.floor((z + reach) / 32); j++)
      for (let i = Math.floor((x - reach) / 32); i <= Math.floor((x + reach) / 32); i++) {
        const list = cells.get(key(i, j)); if (!list) continue;
        for (let n = 0; n < list.length; n++) { const id = list[n]; if (stamps[id] === epoch) continue; stamps[id] = epoch; fn(segments[id]); }
      }
  }
  const sample = { valid: false, y: 0, depth: 0, distance: Infinity };
  let qx, qz;
  function sampleSegment(s) {
    const t = clamp(((qx - s.ax) * s.dx + (qz - s.az) * s.dz) / (s.length * s.length), 0, 1);
    const d = Math.hypot(qx - s.ax - s.dx * t, qz - s.az - s.dz * t), half = (s.wa + (s.wb - s.wa) * t) / 2;
    if (d > half || d >= sample.distance) return;
    sample.distance = d; sample.y = s.ya + (s.yb - s.ya) * t;
    sample.depth = sample.y - s.ba - (s.bb - s.ba) * t; sample.valid = sample.y > 0;
  }
  return { segments, visit, sampleAt(x, z) { qx = x; qz = z; sample.valid = false; sample.distance = Infinity; visit(x, z, 0, sampleSegment); return sample; } };
}
export function prepareFishRivers(data, vscale = 1, terrain = null) {
  const job = prepareFishRiverSteps(data, vscale, terrain); let result;
  do { result = job.next(); } while (!result.done);
  return result.value;
}
export function createFishState(rivers, { limit = 56, ripple = () => {} } = {}) {
  const fish = Array.from({ length: limit }, () => ({ x: 0, y: 0, z: 0, yaw: 0, size: 0, phase: 0, big: false, lane: 0, half: 0, school: 0, scare: 0, jumping: false, depth: 0, variation: 1, speed: 0, headingOffset: 0 }));
  // W2c-9d2: scan order / 35m -> nearest 40 schools / camera gate 24m.
  // Allocate once; bounded insertion keeps the nearest schools even after saturation.
  const candidates = new Array(40), distances = new Float64Array(40);
  let candidateCount = 0;
  let time = 0, count = 0, cap = limit, camera, hero, dtNow;
  function candidate(s) {
    if (!s.habitat || Math.min(s.wa, s.wb) < 1.2 || Math.min(s.ya - s.ba, s.yb - s.bb) < .35 || Math.min(s.ya, s.yb) <= 0) return;
    if (Math.hypot(s.ax + s.dx / 2 - camera.x, s.az + s.dz / 2 - camera.z) > 24 + s.length / 2) return;
    const t = clamp(((hero.x - s.ax) * s.dx + (hero.z - s.az) * s.dz) / (s.length * s.length), 0, 1);
    const distance = Math.hypot(s.ax + s.dx * t - hero.x, s.az + s.dz * t - hero.z);
    let i = candidateCount;
    if (i === candidates.length) { if (distance >= distances[i - 1]) return; i--; }
    else candidateCount++;
    while (i > 0 && distances[i - 1] > distance) {
      candidates[i] = candidates[i - 1]; distances[i] = distances[i - 1]; i--;
    }
    candidates[i] = s; distances[i] = distance;
  }
  function school(s, distance) {
    if (!s.habitat || count >= cap || Math.min(s.wa, s.wb) < 1.2 || Math.min(s.ya - s.ba, s.yb - s.bb) < .35 || Math.min(s.ya, s.yb) <= 0) return;
    const mx = s.ax + s.dx / 2, mz = s.az + s.dz / 2;
    if (Math.hypot(mx - camera.x, mz - camera.z) > 24 + s.length / 2) return;
    // W2c-9d2: 3–8 per school -> up to 10 toward the player, same global cap.
    const schoolCount = s.count + Math.round((10 - s.count) * clamp(1 - distance / 24, 0, 1));
    let near = false;
    for (let i = 0; i < schoolCount; i++) {
      const phase = s.id * 19 + i * .47, speed = .3 + fxHash(s.ax, s.az, i + 1) * .6;
      const u = ((time + s.travel) * speed / Math.max(1, s.length * .7) + phase) % 2;
      const t = .15 + .7 * (u < 1 ? u : 2 - u), half = (s.wa + (s.wb - s.wa) * t) / 2;
      const lane = half * .35 * Math.sin(phase + time * .23) * .65;
      if (Math.hypot(s.ax + s.dx * t - s.dz / s.length * lane - hero.x, s.az + s.dz * t + s.dx / s.length * lane - hero.z) < 3) near = true;
    }
    if (near) s.scareUntil = time + 1;
    s.scare = Math.max(0, s.scareUntil - time); s.travel += dtNow * 2 * s.scare;
    const cycle = Math.floor((time + s.id * s.period) / s.period), jump = (time + s.id * s.period) % s.period;
    for (let i = 0; i < schoolCount && count < cap; i++) {
      const phase = s.id * 19 + i * .47, speed = .3 + fxHash(s.ax, s.az, i + 1) * .6;
      const u = ((time + s.travel) * speed / Math.max(1, s.length * .7) + phase) % 2, forward = u < 1;
      const t = .15 + .7 * (forward ? u : 2 - u), half = (s.wa + (s.wb - s.wa) * t) / 2;
      const lane = half * .35 * clamp(Math.sin(phase + time * .23) * .65 + Math.sign(Math.sin(phase) || 1) * s.scare * .35, -1, 1);
      const x = s.ax + s.dx * t - s.dz / s.length * lane, z = s.az + s.dz * t + s.dx / s.length * lane;
      if (Math.hypot(x - camera.x, z - camera.z) > 24) continue;
      const f = fish[count++], water = s.ya + (s.yb - s.ya) * t;
      // W2c-9d3: surface slivers -> staggered swimming depths and individual headings.
      f.x = x; f.z = z;
      const bed = s.ba + (s.bb - s.ba) * t;
      f.y = water - clamp(.325 + .075 * Math.sin(time * .7 + phase), .2, .45);
      f.jumping = i === 0 && jump < .7;
      if (f.jumping) { f.y = water - .18 + Math.sin(jump / .7 * Math.PI) * .55;
        if (cycle !== s.jumpCycle) { ripple(x, water + .015, z, 1); ripple(x + .06, water + .016, z, .85); s.jumpCycle = cycle; } }
      f.y = Math.max(bed + .08, f.y);
      f.depth = Math.max(0, water - f.y);
      // Alternating endpoints ensure even a small school has visible angular spread.
      f.headingOffset = ((i % 2 ? 1 : -1) * (19 + 6 * Math.sin(time * .31 + phase))) * Math.PI / 180;
      f.yaw = Math.atan2(s.dx, s.dz) + (forward ? 0 : Math.PI) + f.headingOffset;
      f.speed = speed; f.variation = .9 + fxHash(s.ax, s.az, i + 101) * .2; f.big = i === 0 && s.id > .65;
      // W2c-9d3: thicker 25–35cm fish, 55–70cm large fish.
      f.size = f.big ? .55 + s.id * .15 : .25 + (i % 3) * .05; f.phase = phase + (time + s.travel) * 9; f.lane = lane; f.half = half; f.school = s.id; f.scare = s.scare;
    }
  }
  return { fish, get count() { return count; }, setLimit(n) { cap = Math.min(limit, Math.max(0, n)); },
    update(dt, cameraPos, heroPos) { dtNow = Math.max(0, dt); time += dtNow; count = 0; camera = cameraPos; hero = heroPos || cameraPos; candidateCount = 0;
      if (cap) {
        rivers.visit(camera.x, camera.z, 30, candidate);
        for (let i = 0; i < candidateCount && count < cap; i++) school(candidates[i], distances[i]);
      } } };
}
