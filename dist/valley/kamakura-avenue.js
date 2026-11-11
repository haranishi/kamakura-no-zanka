// WW15.4: derived geometry and placements only; no stored geography or scene state.
import { kamakuraPaths } from './kamakura-roads.js';
import { sandoRecords, sandoHouses, sandoBoxDistance } from './kamakura-sando.js';
import { createKamakuraTerrain } from './kamakura-terrain.js';
import { toneChannel } from './kamakura-ground-tone-rules.js';
export const AVENUE = Object.freeze({
  pineOffset: 2.5, // m beyond the road edge: centre of each pine row
  pineJitter: .8, // m: maximum lateral variation
  spacingMin: 9, spacingMax: 14, // m: successive planting intervals per side
  heightMin: 9, heightMax: 14, // m: pine height
  crownMin: 3, crownMax: 4.5, // m: pine crown radius
  lean: .055, rankMax: .35, tint: .12, // rad / ratio / ratio: lean, retained rank and pigment variation
  houseClearance: 2, roadClearance: 3, treeClearance: 3, // m from a box / road edge / existing tree
  oldToriiClearance: 12, postClearance: 5, // m: pine exclusion around old torii and new posts
  fractions: Object.freeze([.28, .74]), // proportion along the avenue from the shrine
  shiftMax: 40, shiftStep: 2, // m: safe torii search on either side of its target
  opening: 9, narrowWidth: 12, narrowOpening: .7, heightRatio: .95, // m / m / ratio / ratio: torii scale
  postRadius: .5, postTopRadius: .34, postInward: .22, // m: tapered and inclined ten-sided posts
  postHeight: .87, footHeight: .065, footShade: .65, // height ratios and base pigment gain
  beamOverhang: .23, beamDepth: .65, beamHeight: .055, // opening ratios / m / height ratio
  beamRise: .025, beamLower: .91, nukiHeight: .66, nukiOverhang: .1, // height ratios and opening ratio
  nukiDepth: .38, tabletWidth: .38, roofShade: .28, // m / m / pigment gain for the top beam
  radialSegments: 10, beamSegments: 4, // topology counts: torii stays below 400 triangles
  bermWidth: 2.6, bermTop: 1, bermHeight: .7, bermInset: .6, // m: section (foot to foot, level top, height) and inset from road edge
  bermStep: 1.6, entranceEvery: 70, entranceWidth: 5, crossingExtra: 6, // m: sampling and openings
  soilBand: .16, groundLift: .015, grassStrength: .35, // m / m / ratio: exposed soil toe, surface lift, existing tone strength
  // Three reviews against the concept, all in real Chrome. Banks of one grass colour read as painted prisms; banks faced with pale
  // stone read as concrete kerbs; banks with a section of their own at every station, in three bands of colour, still read as
  // extruded prisms (a ruler-straight crest, the same slope for 90 m, colour in stripes). The picture has low earthen banks, overgrown
  // and worn: they swell and sink, lean one way and the other, have slumped here and there, the road side is trodden to a gentler
  // slope, the grass is patchy and comes down over the earth in tongues, and tufts stand on the top. So the shape follows smooth
  // noise along the bank (several wavelengths), the colour is given point by point from other noise, and tufts of grass are added.
  // Where a run of the bank ends (an entrance, a crossing, a house) it comes down to the ground instead of ending in a cut face.
  bermShoulder: Object.freeze([.26, .16]), bermShoulderHeight: .8, // m beyond the level top: road side (trodden), house side / share of the height reached there
  bermSwell: 12, bermSwellGain: .3, bermBump: 3.5, bermBumpGain: .12, // m wavelength and +-share of the height: the long rise and fall, the short lumps
  bermSlump: 38, bermSlumpFrom: .7, bermSlumpDrop: .55, // m wavelength / noise level above which the bank has slumped / share of the height lost there
  bermTopWave: 9, bermTopVary: .25, bermShiftWave: 14, bermShift: .2, // m, +-share of the top width / m, +-m sideways
  bermPatch: 6, bermDry: .4, bermBare: .8, bermCreep: .7, // m wavelength of the cover patches / road earth mixed into dry grass / grass lost on a slumped top / most grass on the lower slope
  earthShade: .78, bermTone: .09, bermRoad: 1.2, // gain on the road's earth for the bank's own earth / +-fraction along the bank / m into the road where its earth is read
  // The grass does not end on a line: the cover (0 earth .. 1 grass) is given point by point and broken up by noise in the pixel shader.
  coverNoise: Object.freeze([1.7, .9, 9, .25]), coverEdge: Object.freeze([.32, .68]), // 1/m and gain of the coarse and fine noise / cover levels where earth turns to grass
  // The grain is two layers of noise turned against each other: one layer alone showed its square lattice as a woven pattern (real Chrome).
  bermGrain: Object.freeze([23, .2, .16]), // 1/m of the grain / +-brightness of the grain / +-brightness of the fine noise
  tuftEvery: .2, tuftBlades: 5, tuftHeight: Object.freeze([.22, .58]), tuftWidth: .05, tuftLean: .45, // m between tufts / blades in one / m tall / m wide at the root / lean as a share of the height
  tuftRoot: .5, tuftTip: .95, tuftRange: 150, // gain on the grass colour at the root and at the tip / m: tufts are drawn within this distance
  bermTriangles: 6000, tuftTriangles: 4500, totalTriangles: 11500, // hard geometry budgets (bank, tufts, bank + tufts + torii)
  range: 5000, lightRange: 3000, adaptRange: 2000, adapt1Range: 4000, adapt2Range: 3000, // m: 3D visibility
  markerHeight: 20, markerWidth: 1, // m: debug pine columns
  debugPine: '#ff00ff', debugTorii: '#ffff00', debugBerm: '#00ffff', // unlit identification colours
  fallbackTorii: '#a84734', // public painted timber fallback (kamakura-props-view.js); normal use reads the torii GLB
  fallbackGround: '#535f35', // only used without ground colour: the existing synthetic ground RGB base
});
export const avenueEnabled = search => new URLSearchParams(search).get('avenue') !== '0';
export function avenueRange(quality = 'standard', step = 0) {
  return Math.min(quality === 'light' ? AVENUE.lightRange : AVENUE.range,
    step >= 3 ? AVENUE.adaptRange : step >= 2 ? AVENUE.adapt2Range : step >= 1 ? AVENUE.adapt1Range : AVENUE.range);
}
// PCA gives a stable direction even when fragments are unordered or reversed.
export function avenueAxis(data) {
  const routes = new Map();
  for (const [id, p] of Object.entries(data.roads || {})) if (p.kind === 'local_road') {
    const key = p.route_id ?? id;
    if (!routes.has(key)) routes.set(key, []);
    routes.get(key).push(p);
  }
  let best = null;
  for (const [route, roads] of [...routes].sort(([a], [b]) => a.localeCompare(b))) {
    const points = [...new Map(roads.flatMap(r => r.xyz_m.map(p => [`${p[0]},${p[1]}`, { x: p[0], z: -p[1] }]))).values()];
    if (points.length < 2) continue;
    let mx = 0, mz = 0; for (const p of points) { mx += p.x; mz += p.z; } mx /= points.length; mz /= points.length;
    let xx = 0, zz = 0, xz = 0; for (const p of points) { xx += (p.x - mx) ** 2; zz += (p.z - mz) ** 2; xz += (p.x - mx) * (p.z - mz); }
    const theta = Math.atan2(2 * xz, xx - zz) / 2, ux = Math.cos(theta), uz = Math.sin(theta);
    points.sort((a, b) => (a.x - b.x) * ux + (a.z - b.z) * uz || a.x - b.x || a.z - b.z);
    const landmarks = (data.facilities?.nodes || []).filter(n => n.part === 'torii' || n.part === 'hall');
    const near = p => landmarks.reduce((v, n) => Math.min(v, Math.hypot(p.x - n.anchor_xz[0], p.z - n.anchor_xz[1])), Infinity);
    if (near(points.at(-1)) < near(points[0]) || !landmarks.length && points.at(-1).z < points[0].z) points.reverse();
    const lengths = [0]; for (let i = 1; i < points.length; i++) lengths.push(lengths[i - 1] + Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z));
    const start = points[0], end = points.at(-1), span = Math.hypot(end.x - start.x, end.z - start.z);
    if (!span) continue;
    const axis = { start, end, dx: (end.x - start.x) / span, dz: (end.z - start.z) / span, length: lengths.at(-1), width: Math.max(...roads.map(r => r.width_m)), pieces: roads.length, route, roads, points, lengths };
    if (!best || axis.length > best.length) best = axis;
  }
  return best;
}
export function avenueSample(axis, along, offset = 0) {
  const s = Math.max(0, Math.min(axis.length, along)); let i = 1;
  while (i < axis.lengths.length - 1 && axis.lengths[i] < s) i++;
  const a = axis.points[i - 1], b = axis.points[i], len = axis.lengths[i] - axis.lengths[i - 1], t = (s - axis.lengths[i - 1]) / len;
  const dx = (b.x - a.x) / len, dz = (b.z - a.z) / len;
  return { x: a.x + (b.x - a.x) * t - dz * offset, z: a.z + (b.z - a.z) * t + dx * offset, dx, dz };
}
const distance = (x, z, a, b) => {
  const dx = b.x - a.x, dz = b.z - a.z, t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
  return Math.hypot(x - a.x - t * dx, z - a.z - t * dz);
};
// Startup-only spatial indices; the view never queries placement or terrain in update().
function spatial(cell = 32) {
  const grid = new Map(), empty = [];
  return {
    add(p, x0, z0, x1 = x0, z1 = z0) {
      for (let x = Math.floor(x0 / cell); x <= Math.floor(x1 / cell); x++) for (let z = Math.floor(z0 / cell); z <= Math.floor(z1 / cell); z++) {
        const key = `${x},${z}`; if (!grid.has(key)) grid.set(key, []); grid.get(key).push(p);
      }
    },
    at(x, z) { return grid.get(`${Math.floor(x / cell)},${Math.floor(z / cell)}`) || empty; },
  };
}
function avenueSite(data, axis, terrain) {
  const records = sandoRecords(data), boxes = [...sandoHouses(data), ...records.map(r => r.bounds)], obstacles = spatial(), paths = spatial(), trees = spatial();
  const work = { candidates: 0, boxChecks: 0, roadChecks: 0, treeChecks: 0 };
  for (const b of boxes) { const r = Math.hypot(b.w, b.d) / 2 + AVENUE.houseClearance; obstacles.add(b, b.x - r, b.z - r, b.x + r, b.z + r); }
  for (const p of Object.values(kamakuraPaths(data) || {})) {
    if (axis.roads.includes(p)) continue;
    for (let i = 1; i < p.xyz_m.length; i++) {
      const a = { x: p.xyz_m[i - 1][0], z: -p.xyz_m[i - 1][1] }, b = { x: p.xyz_m[i][0], z: -p.xyz_m[i][1] }, radius = (p.width_m || 5) / 2;
      const s = { a, b, radius }, reach = radius + AVENUE.crossingExtra;
      paths.add(s, Math.min(a.x, b.x) - reach, Math.min(a.z, b.z) - reach, Math.max(a.x, b.x) + reach, Math.max(a.z, b.z) + reach);
    }
  }
  const addTree = p => trees.add(p, p.x - AVENUE.treeClearance, p.z - AVENUE.treeClearance, p.x + AVENUE.treeClearance, p.z + AVENUE.treeClearance);
  for (const p of data.veg || []) addTree(p);
  const boxAt = (x, z, margin) => { for (const b of obstacles.at(x, z)) { work.boxChecks++; if (sandoBoxDistance(x, z, b) <= margin) return true; } return false; };
  const roadAt = (x, z, margin) => { for (const s of paths.at(x, z)) { work.roadChecks++; if (distance(x, z, s.a, s.b) <= s.radius + margin) return true; } return false; };
  const dry = (x, z) => Number.isFinite(terrain.heightAt(x, z)) && terrain.waterAt(x, z) === 0 && !(terrain.riverDistanceAt?.(x, z, 0) === 0);
  const walk = (x, z) => (!terrain.insideA || terrain.insideA(x, z)) && terrain.walkable(x, z);
  return { records, work, boxAt, roadAt, dry, walk, addTree,
    treeAt(x, z) { for (const p of trees.at(x, z)) { work.treeChecks++; if (Math.hypot(p.x - x, p.z - z) < AVENUE.treeClearance) return true; } return false; },
  };
}
function toriiPlacements(axis, terrain, site) {
  const out = [], opening = axis.width < AVENUE.narrowWidth ? axis.width * AVENUE.narrowOpening : AVENUE.opening;
  for (const f of AVENUE.fractions) {
    const target = axis.length * f;
    for (let trial = 0; trial <= AVENUE.shiftMax / AVENUE.shiftStep * 2; trial++) {
      const shift = trial ? Math.ceil(trial / 2) * AVENUE.shiftStep * (trial % 2 ? 1 : -1) : 0, along = target + shift;
      if (along < 0 || along > axis.length) continue;
      const at = avenueSample(axis, along), width = opening * (1 + 2 * AVENUE.beamOverhang); let valid = true;
      // Test the whole crossbar footprint, not only the centre between two unsafe posts.
      for (let u = -width / 2; u <= width / 2; u += AVENUE.postRadius) {
        const x = at.x - at.dz * u, z = at.z + at.dx * u;
        if (!site.dry(x, z) || !site.walk(x, z) || site.boxAt(x, z, AVENUE.postRadius) || site.roadAt(x, z, AVENUE.beamDepth)) { valid = false; break; }
      }
      if (!valid) continue;
      const posts = [-1, 1].map(side => { const p = avenueSample(axis, along, side * opening / 2); return { x: p.x, z: p.z, y: terrain.heightAt(p.x, p.z), r: AVENUE.postRadius, height: opening * AVENUE.heightRatio }; });
      out.push({ ...at, along, target, opening, height: opening * AVENUE.heightRatio, yaw: Math.atan2(-at.dx, -at.dz), y: terrain.heightAt(at.x, at.z), posts }); break;
    }
  }
  return out;
}
// Integer PRNG: deterministic on every supported JS engine, independent of world positions.
function seeded(seed) { let n = seed; return () => { n = (Math.imul(n, 1664525) + 1013904223) >>> 0; return n / 4294967296; }; }
export function prepareAvenue(data, { terrain, search = '' } = {}) {
  if (!avenueEnabled(search)) return null;
  const axis = avenueAxis(data); if (!axis) return null;
  terrain ||= createKamakuraTerrain(data);
  const site = avenueSite(data, axis, terrain), torii = toriiPlacements(axis, terrain, site), pines = [], skipped = { house: 0, water: 0, road: 0, tree: 0, other: 0 };
  let id = 0; for (const p of data.veg || []) id = Math.max(id, p.id + 1);
  for (const side of [-1, 1]) {
    const random = seeded(side < 0 ? 731 : 1927); let along = side < 0 ? AVENUE.spacingMin / 2 : AVENUE.spacingMin;
    while (along < axis.length) {
      const offset = side * (axis.width / 2 + AVENUE.pineOffset + (random() * 2 - 1) * AVENUE.pineJitter), at = avenueSample(axis, along, offset);
      const p = { id, x: at.x, z: at.z, yaw: random() * Math.PI * 2, height: AVENUE.heightMin + random() * (AVENUE.heightMax - AVENUE.heightMin), crown: AVENUE.crownMin + random() * (AVENUE.crownMax - AVENUE.crownMin), sourceSpecies: 1, tier: 0, variant: Math.floor(random() * 3), tint: (random() * 2 - 1) * AVENUE.tint, phase: random(), lean: (random() * 2 - 1) * AVENUE.lean, rank: random() * AVENUE.rankMax, along, side };
      site.work.candidates++;
      const reason = site.boxAt(p.x, p.z, AVENUE.houseClearance) ? 'house' : !site.dry(p.x, p.z) ? 'water' : site.roadAt(p.x, p.z, AVENUE.roadClearance) ? 'road' : site.treeAt(p.x, p.z) ? 'tree' :
        !site.walk(p.x, p.z) || site.records.some(r => r.node.part === 'torii' && sandoBoxDistance(p.x, p.z, r.bounds) < AVENUE.oldToriiClearance) || torii.some(t => t.posts.some(q => Math.hypot(q.x - p.x, q.z - p.z) < AVENUE.postClearance)) ? 'other' : null;
      if (reason) skipped[reason]++; else { pines.push(p); site.addTree(p); id++; }
      along += AVENUE.spacingMin + random() * (AVENUE.spacingMax - AVENUE.spacingMin);
    }
  }
  return { axis, pines, skipped, torii, veg: [...(data.veg || []), ...pines], work: site.work, site };
}
export function bermHash(i, side) { const n = Math.sin(i * 12.9898 + side * 78.233) * 43758.5453; return n - Math.floor(n); }
// Smooth noise along the bank (0..1): the hash at whole steps of `wave` metres, eased in between. Places that are close agree,
// so the bank swells and sinks over several metres instead of jumping from station to station.
export function bermNoise(along, side, salt, wave) {
  const t = along / wave, i = Math.floor(t), f = t - i, e = f * f * (3 - 2 * f);
  return bermHash(i + salt, side) * (1 - e) + bermHash(i + 1 + salt, side) * e;
}
// What the bank is like at a place along it: height and half top width (m), sideways shift (m), how far it has slumped (0..1).
export function bermShape(along, side) {
  const wave = (salt, length) => 2 * bermNoise(along, side, salt, length) - 1;
  const s = Math.min(1, Math.max(0, (bermNoise(along, side, 71, AVENUE.bermSlump) - AVENUE.bermSlumpFrom) / (1 - AVENUE.bermSlumpFrom))), slump = s * s * (3 - 2 * s);
  return { slump, shift: AVENUE.bermShift * wave(37, AVENUE.bermShiftWave), top: AVENUE.bermTop * (1 + AVENUE.bermTopVary * wave(23, AVENUE.bermTopWave)) / 2,
    height: AVENUE.bermHeight * (1 + AVENUE.bermSwellGain * wave(11, AVENUE.bermSwell) + AVENUE.bermBumpGain * wave(17, AVENUE.bermBump)) * (1 - AVENUE.bermSlumpDrop * slump) };
}
// One place's section, from the foot on the road side to the foot on the house side: [offset across (m), height (m)] x 8.
export function bermSection(along, side) {
  const { height, top, shift } = bermShape(along, side), foot = AVENUE.bermWidth / 2, [worn, steep] = AVENUE.bermShoulder;
  const shoulder = height * AVENUE.bermShoulderHeight, road = shift - top - worn, house = shift + top + steep;
  return [[-foot, 0], [-foot + AVENUE.soilBand, AVENUE.soilBand / (road + foot) * shoulder], [road, shoulder], [shift - top, height],
    [shift + top, height], [house, shoulder], [foot - AVENUE.soilBand, AVENUE.soilBand / (foot - house) * shoulder], [foot, 0]];
}
export const BERM_FACES = Object.freeze(['soil', 'earth', 'grass', 'grass', 'grass', 'earth', 'soil']); // the seven faces across a section
// The eight section points at one place: `earth` is the colour without grass, `grass` the grass colour, `cover` how much of the
// point is grass (0..1). The feet are the ground they stand on. The bank's own earth is the road's earth, a little darker. Grass
// covers the top and the shoulders, thins out in dry patches, is lost where the bank has slumped, and comes down over the lower
// slopes in tongues. Every colour comes from the ground colours and the existing grass tone: no palette of its own.
export function bermColours(along, side, grounds) {
  const { road, under, house } = grounds, slump = bermShape(along, side).slump;
  const tone = 1 + AVENUE.bermTone * (2 * bermNoise(along, side, 53, AVENUE.bermPatch * 3) - 1);
  const mix = (a, b, t) => a.map((v, k) => v + (b[k] - v) * t), patch = salt => bermNoise(along, side, salt, AVENUE.bermPatch);
  const ease = (v, low, high) => { const t = Math.min(1, Math.max(0, (v - low) / (high - low))); return t * t * (3 - 2 * t); };
  const soil = road.map(v => v * AVENUE.earthShade * tone), fresh = under.map((v, k) => toneChannel(v, k, 0, 0, 1, 0, AVENUE.grassStrength, 0, 0) * tone);
  const grass = mix(fresh, soil, AVENUE.bermDry * ease(patch(97), .45, .85)), top = 1 - AVENUE.bermBare * slump;
  const creep = salt => AVENUE.bermCreep * ease(patch(salt), .3, .8) * top;
  return { grass, earth: [road, soil, soil, soil, soil, soil, soil, house],
    cover: [0, creep(91) * .5, Math.max(creep(91), .8 * top), top, top, Math.max(creep(93), .8 * top), creep(93) * .5, 0] };
}
// Vertex buffers remain pure data: `colors` is the earth, `grass` the grass colour and its cover (r, g, b, cover) for the pixel
// shader to mix. `tufts` is a second set of buffers: grass standing on the top and the shoulders.
export function avenueBerm(plan, terrain) {
  const positions = [], colors = [], grasses = [], normals = [], segments = [], { axis, site } = plan; let length = 0, gaps = 0, inGap = false;
  const tuft = { positions: [], colors: [], normals: [] };
  const from = axis.length * AVENUE.fractions[0], to = axis.length * AVENUE.fractions[1];
  const perStretch = BERM_FACES.length * 2; // two triangles for each face; the ends run down to the ground, so there are no end faces
  const maximum = Math.max(1, Math.floor(AVENUE.bermTriangles / perStretch / 2) - Math.ceil((to - from) / AVENUE.entranceEvery) * 2);
  const step = Math.max(AVENUE.bermStep, (to - from) / maximum), cuts = [from, to];
  const tuftEvery = Math.max(AVENUE.tuftEvery, (to - from) * 2 * AVENUE.tuftBlades / AVENUE.tuftTriangles);
  for (let s = from + step; s < to; s += step) cuts.push(s);
  for (let center = Math.ceil(from / AVENUE.entranceEvery) * AVENUE.entranceEvery; center < to; center += AVENUE.entranceEvery) for (const sign of [-1, 1]) {
    const s = center + sign * AVENUE.entranceWidth / 2; if (s > from && s < to) cuts.push(s);
  }
  cuts.sort((a, b) => a - b);
  const triangle = (a, b, c, ca, cb, cc, na, nb, nc) => { positions.push(...a, ...b, ...c); colors.push(...ca.earth, ...cb.earth, ...cc.earth); grasses.push(...ca.grass, ...cb.grass, ...cc.grass); normals.push(...na, ...nb, ...nc); };
  const between = (p, q, t) => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
  const fallback = [1, 3, 5].map(k => { const v = parseInt(AVENUE.fallbackGround.slice(k, k + 2), 16) / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
  // The normal of a section point: across the section (between its neighbours) and along the bank, turned upwards.
  const rounded = (row, other, k) => {
    const p = row[Math.max(0, k - 1)], q = row[Math.min(row.length - 1, k + 1)], ax = q[0] - p[0], ay = q[1] - p[1], az = q[2] - p[2];
    const bx = other[k][0] - row[k][0], by = other[k][1] - row[k][1], bz = other[k][2] - row[k][2];
    let x = ay * bz - az * by, y = az * bx - ax * bz, z = ax * by - ay * bx; const l = Math.hypot(x, y, z) || 1, sign = y < 0 ? -1 : 1;
    return [x / l * sign, y / l * sign, z / l * sign];
  };
  for (const side of [-1, 1]) {
    // First find where the bank stands, so that each run of stretches can come down to the ground at both of its ends.
    const open = [];
    for (let i = 1; i < cuts.length; i++) {
      const s = cuts[i - 1], end = cuts[i], mid = (s + end) / 2; if (end - s < 1e-6) { open.push(null); continue; }
      const cycle = Math.round(mid / AVENUE.entranceEvery) * AVENUE.entranceEvery;
      let blocked = Math.abs(mid - cycle) < AVENUE.entranceWidth / 2;
      // Include the full strip, so even a narrow crossing or house cannot slip between endpoints.
      for (let along = s; along <= end; along += Math.min(AVENUE.bermTop, end - s)) for (const u of [-AVENUE.bermWidth / 2, 0, AVENUE.bermWidth / 2]) {
        const p = avenueSample(axis, along, side * (axis.width / 2 - AVENUE.bermInset + u));
        if (!site.walk(p.x, p.z) || !site.dry(p.x, p.z) || site.boxAt(p.x, p.z, AVENUE.bermTop / 2) || site.roadAt(p.x, p.z, AVENUE.crossingExtra / 2)) blocked = true;
      }
      open.push(!blocked);
    }
    inGap = false;
    for (let i = 1; i < cuts.length; i++) {
      const s = cuts[i - 1], end = cuts[i]; if (open[i - 1] === null) continue;
      if (!open[i - 1]) { if (!inGap) gaps++; inGap = true; continue; } inGap = false;
      // A neighbour of zero length is skipped: look past it for the next real stretch on either side.
      let before = i - 2; while (before >= 0 && open[before] === null) before--;
      let after = i; while (after < open.length && open[after] === null) after++;
      const rows = [], tints = [], stands = [before >= 0 && open[before], after < open.length && open[after]];
      for (const [along, joined] of [[s, stands[0]], [end, stands[1]]]) {
        const row = [];
        for (const [u, h] of bermSection(along, side)) {
          const p = avenueSample(axis, along, side * (axis.width / 2 - AVENUE.bermInset + u));
          row.push([p.x, terrain.heightAt(p.x, p.z) + (joined ? h : 0) + AVENUE.groundLift, p.z]);
        }
        rows.push(row);
        const read = u => { const p = avenueSample(axis, along, side * (axis.width / 2 - AVENUE.bermInset + u)); return terrain.groundColorAt?.(p.x, p.z) || fallback; };
        const foot = AVENUE.bermWidth / 2, grounds = { road: read(-foot - AVENUE.bermRoad), under: read(0), house: read(foot) }, tint = bermColours(along, side, grounds);
        // Where a run ends, the bank is at ground level: it is the ground there (no grass painted on the road).
        tints.push(tint.earth.map((earth, k) => ({ earth: joined ? earth : read(bermSection(along, side)[k][0]), grass: [...tint.grass, joined ? tint.cover[k] : 0] })));
      }
      const round = rows.map((row, r) => row.map((_, k) => rounded(row, rows[1 - r], k)));
      for (let k = 0; k < rows[0].length - 1; k++) {
        const a = rows[0][k], b = rows[1][k], c = rows[1][k + 1], d = rows[0][k + 1];
        const ca = tints[0][k], cb = tints[1][k], cc = tints[1][k + 1], cd = tints[0][k + 1];
        const na = round[0][k], nb = round[1][k], nc = round[1][k + 1], nd = round[0][k + 1];
        if (side > 0) { triangle(a, c, b, ca, cc, cb, na, nc, nb); triangle(a, d, c, ca, cd, cc, na, nd, nc); } else { triangle(a, b, c, ca, cb, cc, na, nb, nc); triangle(a, c, d, ca, cc, cd, na, nc, nd); }
      }
      segments.push({ from: s, to: end, side, rows }); length += end - s;
      if (!stands[0] || !stands[1]) continue; // no tufts on the stretch that comes down to the ground
      const count = Math.floor((end - s) / tuftEvery + bermHash(i + 311, side));
      for (let j = 0; j < count; j++) {
        const h = salt => bermHash(i * 7 + j * 13 + salt, side);
        const t = h(1), k = 2 + Math.min(2, Math.floor(h(2) * 3)), v = h(3);
        const base = between(between(rows[0][k], rows[0][k + 1], v), between(rows[1][k], rows[1][k + 1], v), t);
        const grass = between(between(tints[0][k].grass, tints[0][k + 1].grass, v), between(tints[1][k].grass, tints[1][k + 1].grass, v), t);
        const cover = (tints[0][k].grass[3] * (1 - v) + tints[0][k + 1].grass[3] * v) * (1 - t) + (tints[1][k].grass[3] * (1 - v) + tints[1][k + 1].grass[3] * v) * t;
        if (h(4) > cover) continue; // tufts stand where there is grass: few on dry earth, almost none where the bank has slumped
        const root = grass.map(c => c * AVENUE.tuftRoot), tip = grass.map(c => c * AVENUE.tuftTip);
        for (let blade = 0; blade < AVENUE.tuftBlades; blade++) {
          const angle = h(5 + blade) * Math.PI * 2, tall = AVENUE.tuftHeight[0] + (AVENUE.tuftHeight[1] - AVENUE.tuftHeight[0]) * h(9 + blade);
          const dx = Math.cos(angle), dz = Math.sin(angle), w = AVENUE.tuftWidth / 2, lean = AVENUE.tuftLean * tall * (.3 + .7 * h(13 + blade)), l = Math.hypot(.35, .94);
          tuft.positions.push(base[0] - dz * w, base[1], base[2] + dx * w, base[0] + dz * w, base[1], base[2] - dx * w, base[0] + dx * lean, base[1] + tall, base[2] + dz * lean);
          tuft.colors.push(...root, ...root, ...tip);
          for (let n = 0; n < 3; n++) tuft.normals.push(dx * .35 / l, .94 / l, dz * .35 / l);
        }
      }
    }
  }
  const tufts = { positions: new Float32Array(tuft.positions), colors: new Float32Array(tuft.colors), normals: new Float32Array(tuft.normals), triangles: tuft.positions.length / 9 };
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), grass: new Float32Array(grasses), normals: new Float32Array(normals), length, gaps, triangles: positions.length / 9, segments, tufts };
}
export function avenueToriiColor(data) {
  const kit = data.facilities?.kit;
  if (!kit) return null;
  const view = new DataView(kit);
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('鳥居の材質を読めません');
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(kit, 20, view.getUint32(12, true))));
  const names = new Set((data.facilities.nodes || []).filter(n => n.part === 'torii').map(n => n.node));
  let best = null, redness = 0;
  const visit = n => {
    for (const p of json.meshes?.[n.mesh]?.primitives || []) {
      const c = json.materials?.[p.material]?.pbrMetallicRoughness?.baseColorFactor;
      if (c && c[0] - Math.max(c[1], c[2]) > redness) { best = c.slice(0, 3); redness = c[0] - Math.max(c[1], c[2]); }
    }
    for (const i of n.children || []) visit(json.nodes[i]);
  };
  for (const n of json.nodes || []) if (names.has(n.name)) visit(n);
  return best;
}
export function avenueToriiGeometry(plan, pigment) {
  const positions = [], colors = [], ranges = [];
  for (const t of plan.torii) {
    const start = positions.length / 3, c = Math.cos(t.yaw), s = Math.sin(t.yaw);
    const point = p => [t.x + c * p[0] + s * p[2], t.y + p[1], t.z - s * p[0] + c * p[2]];
    const tri = (a, b, d, color = pigment) => { positions.push(...point(a), ...point(b), ...point(d)); for (let i = 0; i < 3; i++) colors.push(...color); };
    const quad = (a, b, d, e, color) => { tri(a, b, d, color); tri(a, d, e, color); };
    const dark = pigment.map(v => v * AVENUE.roofShade), dirty = pigment.map(v => v * AVENUE.footShade), h = t.height;
    for (let sideIndex = 0; sideIndex < 2; sideIndex++) {
      const sign = sideIndex ? 1 : -1, base = sign * t.opening / 2, bottom = t.posts[sideIndex].y - t.y;
      const rings = [[bottom, AVENUE.postRadius, base], [bottom + h * AVENUE.footHeight, AVENUE.postRadius, base], [h * AVENUE.postHeight, AVENUE.postTopRadius, base - sign * AVENUE.postInward]];
      const at = (r, a) => [r[2] + Math.cos(a) * r[1], r[0], Math.sin(a) * r[1]];
      for (let k = 0; k < AVENUE.radialSegments; k++) {
        const a = k / AVENUE.radialSegments * Math.PI * 2, b = (k + 1) / AVENUE.radialSegments * Math.PI * 2;
        for (let r = 0; r < rings.length - 1; r++) quad(at(rings[r], a), at(rings[r + 1], a), at(rings[r + 1], b), at(rings[r], b), r ? pigment : dirty);
        tri([base, bottom, 0], at(rings[0], a), at(rings[0], b), dirty);
        tri([rings[2][2], rings[2][0], 0], at(rings[2], b), at(rings[2], a));
      }
    }
    const prism = (x0, x1, y0, y1, depth, rise0 = 0, rise1 = rise0, topColor = pigment) => {
      const a = [x0, y0 + rise0, -depth / 2], b = [x1, y0 + rise1, -depth / 2], d = [x1, y1 + rise1, -depth / 2], e = [x0, y1 + rise0, -depth / 2];
      const f = [x0, y0 + rise0, depth / 2], g = [x1, y0 + rise1, depth / 2], j = [x1, y1 + rise1, depth / 2], k = [x0, y1 + rise0, depth / 2];
      quad(a, e, d, b); quad(f, g, j, k); quad(a, f, k, e); quad(b, d, j, g); quad(e, k, j, d, topColor); quad(a, b, g, f);
    };
    for (let level = 0; level < 2; level++) {
      const half = t.opening * (.5 + AVENUE.beamOverhang), cy = level ? h * (1 - AVENUE.beamHeight / 2 - AVENUE.beamRise) : h * AVENUE.beamLower;
      for (let k = 0; k < AVENUE.beamSegments; k++) {
        const x0 = (k / AVENUE.beamSegments * 2 - 1) * half, x1 = ((k + 1) / AVENUE.beamSegments * 2 - 1) * half;
        prism(x0, x1, cy - h * AVENUE.beamHeight / 2, cy + h * AVENUE.beamHeight / 2, AVENUE.beamDepth, (x0 / half) ** 2 * h * AVENUE.beamRise, (x1 / half) ** 2 * h * AVENUE.beamRise, level ? dark : pigment);
      }
    }
    prism(-t.opening * (.5 + AVENUE.nukiOverhang), t.opening * (.5 + AVENUE.nukiOverhang), h * AVENUE.nukiHeight, h * (AVENUE.nukiHeight + AVENUE.beamHeight), AVENUE.nukiDepth);
    prism(-AVENUE.tabletWidth / 2, AVENUE.tabletWidth / 2, h * (AVENUE.nukiHeight + AVENUE.beamHeight), h * AVENUE.beamLower, AVENUE.nukiDepth);
    ranges.push({ start, count: positions.length / 3 - start });
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), ranges, triangles: positions.length / 9 };
}
