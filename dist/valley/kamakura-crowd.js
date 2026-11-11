// W2c-19e-2: renderer-free crowd silhouettes, selection and shader equations.
import { PEOPLE, peopleAmount, peopleHash, peoplePlacementBatches, sampleFlight } from './kamakura-people.js';
import { HOUSE_PALETTE } from './kamakura-house-texture.js';

// Shared near/far belongings. Palette entries are linear RGB from existing thatch/timber and clothes.
export const TRAVELLER = Object.freeze({
  straw: Object.freeze([...HOUSE_PALETTE.thatch]), // linear RGB, dry sedge from the thatched roofs.
  wood: Object.freeze([...HOUSE_PALETTE.post]), // linear RGB, dark wooden staff.
  hatRadius: .26, hatHeight: .105, hatCrown: .028, // m, brim radius / rise / rounded crown radius.
  hatSides: 12, hatRound: .94, // segments / ratio, shoulder of the rounded crown.
  hatRim: .72, hatRib: .12, // colour multipliers, dark rim / alternating radial ribs.
  headRise: .20, // m above Head, brim sits over the crown of the shipped heads.
  packSize: .36, packHeight: .30, packDepth: .23, // m, flattened cloth bundle / basket envelope.
  packBack: .20, packDrop: .03, // m behind / below Spine; character models face +z.
  packGap: .006, packFitWidth: .12, packFitHeight: .10, // m, back clearance / torso sampling half-width and half-height.
  packFold: .12, basketTaper: .78, basketWall: .018, // shade variation / bottom-to-top ratio / m wall thickness.
  staffLength: 1.28, staffRadius: .01, staffGrip: .20, // m, length / radius / distance of grip below the top.
  staffSides: 6, palm: .035, walkReference: .3, // segments / m along hand / seconds, relaxed walking reference pose.
});

// All art/distance controls live here. Dimensions below are fractions of adult height.
export const CROWD = Object.freeze({
  range: 600, // m, camera-to-ground-anchor distance limit.
  lightRange: 350, // m, lightweight distance limit.
  fade: 80, // m, shrinking band at the far edge.
  max: 600, // bodies, nearest-first capacity.
  // Seen in real Chrome from the overlook of a small town: with the near people's own spots there were 40 figures where the concept
  // has a crowd. The far crowd places itself this many times denser. A figure with no person to turn into shrinks away at the
  // hand-over distance (60-70 m, where it is some twenty pixels tall), as the near people do when they leave.
  density: 2.5, // ratio, the crowd's placement amount over the near people's.
  lightMax: 300, // bodies, lightweight capacity.
  adaptRange: .6, // ratio, distance at automatic step 2.
  adaptCount: .6, // ratio, capacity at automatic step 2.
  refresh: 8, // m, centre/camera movement before reselection.
  budget: 2.5, // ms, cooperative placement budget per frame.
  batch: 8192, // generator steps, defensive per-frame work cap.
  heightMin: 1.5, heightMax: 1.7, // m, adult height including headwear.
  child: .7, sitter: .5625, sitterWidth: 1.25, // ratios, child scale and seated height (~0.9m).
  farmerBend: .55, farmerLean: .65, hip: .43, // ratios, bent upper-body pose.
  walk: 3, speed: .9, bob: .04, // m / m per second / m, walking amplitude, speed, bob.
  bobRate: 5, // radians per m travelled, walking bob frequency.
  debugHeight: 3, // ratio, debug height multiplier (width unchanged).
  // Real Chrome, the overlook: figures eight pixels tall in dark indigo and brown could not be told from the earth they stood on.
  // The cloth is lighter, each figure lays a flat shadow on the ground away from the sun (what makes a small figure read in the
  // concept), and far figures are drawn a little larger than life.
  clothes: Object.freeze([0x55788c, 0x8d775a, 0xd9cfb3, 0xa3a49d, 0xb89f6c]), // sRGB, indigo/brown/ecru/grey/ochre.
  shadow: .42, shadowLift: .04, shadowReach: 4, // opacity / m above the ground / longest shadow in body heights (a very low sun).
  farScale: 1.3, farFrom: 90, farTo: 240, // ratio / m / m: size gain of distant figures, from where and fully where.
  skin: 0xad8c6b, hair: 0x252724, // sRGB, common skin/hair.
  debug: Object.freeze([0x18d9ff, 0xff38a0, 0xffe02b, 0x65ff25, 0xac54ff, 0xff701c, 0xeeeeee]), // sRGB, PEOPLE_ROLES order.
  headHair: .5, headHat: .8, // cumulative ratios, 5:3:2 headwear split.
  hem: Object.freeze([.17, .12, .10, .07]), // lower/upper half-width, lower/upper half-depth.
  torso: Object.freeze([.11, .19, .07, .08, .43, .77]), // waist/shoulder width/depth, bottom/top height.
  sleeve: Object.freeze([.12, .085, .085, .065, .47, .75, .23]), // frustum widths/depths, heights, offset.
  neck: Object.freeze([.045, .045, .04, .04, .76, .83]), // frustum widths/depths and heights.
  head: Object.freeze([.09, .09, .82, .92]), // half-width/depth and bottom/top height.
  cover: Object.freeze([.108, .23, .115, .91, 1]), // hair/hat/cloth radii, brim/top heights.
  travellerHatRadius: .16, travellerBrim: .935, // adult-height fractions, small shallow hat leaving shoulders visible.
  pack: Object.freeze([.10, .11, .065, .075, .50, .72]), // adult-height fractions, tapered pack inside the back width.
  packBack: .17, // adult-height fraction, backpack centre behind the shoulders.
  staffWidth: .014, staffSide: .34, staffHeight: .8, // adult-height fractions, square staff.
  travellerLight: .75, // ratio, lightweight moving-figure count.
  travellerDebug: 0xff701c, // existing orange role colour for road groups.
  sides: 8, // segments, headwear cone.
});
export function travellerTraits(p) {
  const variant = p.variant || 0;
  return { packCloth: variant < 3 ? (variant + 1) % 3 : variant % 3, basket: variant % 2 === 1 };
}
const clamp = v => Math.max(0, Math.min(1, v));
export const crowdEnabled = (search = '') => new URLSearchParams(search).get('crowd') !== '0' && peopleAmount(search) > 0;
export const crowdRange = (quality, step) => step >= 3 ? 0 : (quality === 'light' ? CROWD.lightRange : CROWD.range) * (step >= 2 ? CROWD.adaptRange : 1);
export const crowdLimit = (quality, step) => step >= 3 ? 0 : Math.floor((quality === 'light' ? CROWD.lightMax : CROWD.max) * (step >= 2 ? CROWD.adaptCount : 1));
export const crowdNear = quality => (quality === 'light' ? PEOPLE.lightRange : PEOPLE.range) - PEOPLE.fade;
export const crowdScale = (horizontal, distance, quality, step) => clamp((horizontal - crowdNear(quality)) / PEOPLE.fade) * clamp((crowdRange(quality, step) - distance) / CROWD.fade);

export function crowdTraits(p) {
  const roll = peopleHash(p.x, p.z, 101);
  let yaw = p.yaw || 0;
  if (p.role === 'walker' && p.route?.length > 1) {
    const i = Math.max(1, Math.floor(p.route.length / 2)), a = p.route[i - 1], b = p.route[i];
    yaw = Math.atan2(a.x - b.x, a.z - b.z);
  }
  return { height: CROWD.heightMin + (CROWD.heightMax - CROWD.heightMin) * peopleHash(p.x, p.z, 102),
    cloth: p.flight ? p.variant : Math.floor(peopleHash(p.x, p.z, 103) * CROWD.clothes.length), head: p.flight ? 1 : roll < CROWD.headHair ? 0 : roll < CROWD.headHat ? 1 : 2,
    phase: peopleHash(p.x, p.z, 104) * CROWD.walk * 4, dx: -Math.sin(yaw), dz: -Math.cos(yaw) };
}
// The same generator is consumed by the near layer. Each added silhouette yields before the next one.
export function* crowdPlacementBatches(context, amount = peopleAmount(context.search)) {
  const job = peoplePlacementBatches(context, amount), bodies = []; let seen = 0;
  try {
    let next;
    do {
      next = job.next();
      while (seen < next.value.spots.length) {
        const spot = next.value.spots[seen++], traits = crowdTraits(spot), terrain = context.terrain;
        const x = spot.x, z = spot.z, y = terrain.heightAt(x, z);
        const front = terrain.heightAt(x + traits.dx * CROWD.walk, z + traits.dz * CROWD.walk);
        const back = terrain.heightAt(x - traits.dx * CROWD.walk, z - traits.dz * CROWD.walk);
        bodies.push({ spot, ...traits, y, terrain: spot.flight ? terrain : null, slope: spot.role === 'walker' && Number.isFinite(front) && Number.isFinite(back) ? (front - back) / (2 * CROWD.walk) : 0 });
        yield bodies;
      }
      yield bodies;
    } while (!next.done);
    return bodies;
  } finally { job.return(); }
}

// Caller-owned scratch. A max heap keeps selection O(N log capacity); final heapsort is nearest first.
export function createCrowdSelection(capacity = CROWD.max) {
  return { chosen: new Int32Array(capacity), distances: new Float64Array(capacity), count: 0, scans: 0, comparisons: 0 };
}
function swap(s, a, b) {
  const i = s.chosen[a], d = s.distances[a]; s.chosen[a] = s.chosen[b]; s.distances[a] = s.distances[b]; s.chosen[b] = i; s.distances[b] = d;
}
function down(s, root, end) {
  for (;;) {
    let k = root * 2 + 1; if (k >= end) return;
    if (k + 1 < end && s.distances[k + 1] > s.distances[k]) k++;
    s.comparisons++; if (s.distances[root] >= s.distances[k]) return;
    swap(s, root, k); root = k;
  }
}
export function selectCrowd(bodies, centre, camera, quality, step, s, travellers = false, reserved = 0, cap = Infinity) {
  const near = crowdNear(quality), range = crowdRange(quality, step), limit = Math.min(s.chosen.length, cap, Math.max(0, crowdLimit(quality, step) - reserved));
  s.count = s.scans = s.comparisons = 0;
  if (!limit) return s;
  for (let i = 0; i < bodies.length; i++) {
    s.scans++; const b = bodies[i], p = b.spot;
    if (!travellers && p.flight) continue;
    if (!travellers && Math.hypot(p.x - centre.x, p.z - centre.z) <= near) continue;
    const d = Math.hypot(p.x - camera.x, b.y - camera.y, p.z - camera.z);
    if (d >= range) continue;
    if (s.count < limit) {
      let k = s.count++; s.chosen[k] = i; s.distances[k] = d;
      while (k > 0) { const parent = (k - 1) >> 1; s.comparisons++; if (s.distances[parent] >= s.distances[k]) break; swap(s, parent, k); k = parent; }
    } else if (d < s.distances[0]) { s.chosen[0] = i; s.distances[0] = d; down(s, 0, s.count); }
  }
  for (let end = s.count - 1; end > 0; end--) { swap(s, 0, end); down(s, 0, end); }
  return s;
}
// CPU mirror for diagnostics/tests. Shader performs this each frame, without geometry uploads.
export function crowdMotion(body, time, out) {
  if (body.spot.flight) return sampleFlight(body.spot, time, body.terrain, out);
  if (body.spot.role !== 'walker') { out.travel = out.bob = 0; out.direction = 1; return out; }
  const cycle = (time * CROWD.speed + body.phase) % (CROWD.walk * 4);
  out.travel = CROWD.walk - Math.abs(cycle - CROWD.walk * 2);
  out.direction = cycle < CROWD.walk * 2 ? 1 : -1;
  out.bob = Math.sin((time * CROWD.speed + body.phase) * CROWD.bobRate) * CROWD.bob;
  return out;
}

// Flat-shaded geometry; material codes: 0 garment, 1 skin, 2 headwear.
export function crowdShape(role = 'chat', head = 0, staff = false) {
  if (role === 'traveller') head = 1;
  const positions = [], normals = [], parts = [];
  function pose(v) {
    let [x, y, z] = v;
    if (role === 'sitter') { y *= CROWD.sitter; if (v[1] <= CROWD.hip) x *= CROWD.sitterWidth; }
    if (role === 'farmer' && y > CROWD.hip) { z -= (y - CROWD.hip) * CROWD.farmerLean; y = CROWD.hip + (y - CROWD.hip) * CROWD.farmerBend; }
    return [x, y, z];
  }
  function tri(a, b, c, part) {
    a = pose(a); b = pose(b); c = pose(c);
    const ux = b[0]-a[0], uy = b[1]-a[1], uz = b[2]-a[2], vx = c[0]-a[0], vy = c[1]-a[1], vz = c[2]-a[2];
    const nx = uy*vz-uz*vy, ny = uz*vx-ux*vz, nz = ux*vy-uy*vx, length = Math.hypot(nx,ny,nz);
    for (const p of [a,b,c]) { positions.push(...p); normals.push(nx/length,ny/length,nz/length); parts.push(part); }
  }
  function quad(a,b,c,d,part) { tri(a,c,b,part); tri(a,d,c,part); }
  function box(w0,w1,d0,d1,y0,y1,part,x=0,z=0) {
    const a=[x-w0,y0,z-d0], b=[x+w0,y0,z-d0], c=[x+w0,y0,z+d0], d=[x-w0,y0,z+d0];
    const e=[x-w1,y1,z-d1], f=[x+w1,y1,z-d1], g=[x+w1,y1,z+d1], h=[x-w1,y1,z+d1];
    quad(a,b,f,e,part); quad(b,c,g,f,part); quad(c,d,h,g,part); quad(d,a,e,h,part); quad(e,f,g,h,part); quad(d,c,b,a,part);
  }
  const hem=CROWD.hem, torso=CROWD.torso, sleeve=CROWD.sleeve, neck=CROWD.neck, face=CROWD.head;
  box(hem[0],hem[1],hem[2],hem[3],0,CROWD.hip,0);
  box(...torso,0); box(...sleeve.slice(0,6),0,-sleeve[6]); box(...sleeve.slice(0,6),0,sleeve[6]); box(...neck,1);
  // Octahedral face with a forward point so a returning walker has a readable facing direction.
  const top=[0,face[3],0], bottom=[0,face[2],0], y=(face[2]+face[3])/2;
  const ring=[[face[0],y,0],[0,y,-face[1]],[-face[0],y,0],[0,y,face[1]]];
  for (let i=0;i<4;i++) { tri(top,ring[i],ring[(i+1)%4],1); tri(bottom,ring[(i+1)%4],ring[i],1); }
  const cover=CROWD.cover, r=role==='traveller'?CROWD.travellerHatRadius:cover[head], brim=role==='traveller'?CROWD.travellerBrim:cover[3], peak=cover[4];
  for (let i=0;i<CROWD.sides;i++) {
    const a=i/CROWD.sides*Math.PI*2, b=(i+1)/CROWD.sides*Math.PI*2;
    const p=[Math.cos(a)*r,brim,Math.sin(a)*r], q=[Math.cos(b)*r,brim,Math.sin(b)*r];
    tri(p,[0,peak,0],q,2); tri(p,q,[0,brim,0],2);
  }
  if (role === 'traveller') {
    box(...CROWD.pack, 3, 0, CROWD.packBack);
    // Same topology for the two variants; the no-staff instance hides this part in the shader.
    if (staff) box(CROWD.staffWidth, CROWD.staffWidth, CROWD.staffWidth, CROWD.staffWidth, 0, CROWD.staffHeight, 4, CROWD.staffSide);
  }
  return { positions: new Float32Array(positions), normals: new Float32Array(normals), parts: new Uint8Array(parts), triangles: parts.length/3 };
}
