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
  poleLength: 1.35, poleRadius: .045, poleHeight: .70, // m / m / adult-height ratio, long wrapped shoulder load.
  packShade: .58, // linear luminance ratio, load stays darker than its wearer's garment.
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
  child: .6, sitter: .5625, sitterWidth: 1.25, // ratios, child scale and seated height (~0.9m).
  farmerBend: .55, farmerLean: .65, hip: .43, // ratios, bent upper-body pose.
  walk: 3, speed: .9, bob: 0, // m / m per second / m, route amplitude / speed / grounded root (feet lift in the shader).
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
  sides: 6, // segments, rounded body/limb cross sections.
  shoulder: .77, hemY: .22, legTop: .43, // height fractions, garment / separated legs.
  legWidth: .045, legDepth: .055, legSide: .075, // height fractions, leg radii / side offset.
  armWidth: .065, armDepth: .055, armSide: .205, armLow: .43, // height fractions, lowered sleeve envelope.
  stride: .13, footLift: .045, lean: .10, armSwing: .075, // height fractions / slope, walking pose.
  gaitRate: 5, // radians per second, independent of travel wrapping.
  duskGain: .48, // linear RGB multiplier on existing cloth colours in evening/dusk.
  lodDistance: 90, // m, same distance as far enlargement begins; use the simpler geometry beyond it.
});
const linear = v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; };
const luminance = hex => .2126 * linear(hex >> 16 & 255) + .7152 * linear(hex >> 8 & 255) + .0722 * linear(hex & 255);
export function travellerTraits(p) {
  const variant = p.variant || 0, packCloth = variant < 3 ? (variant + 1) % 3 : variant % 3;
  return { packCloth, basket: variant % 2 === 1,
    packGain: Math.min(1, luminance(CROWD.clothes[variant]) * TRAVELLER.packShade / luminance(CROWD.clothes[packCloth])) };
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
  return { height: p.flight ? (CROWD.heightMin + CROWD.heightMax) / 2 : CROWD.heightMin + (CROWD.heightMax - CROWD.heightMin) * peopleHash(p.x, p.z, 102),
    cloth: p.flight ? p.variant : Math.floor(peopleHash(p.x, p.z, 103) * CROWD.clothes.length), head: p.flight ? 1 : roll < CROWD.headHair ? 0 : roll < CROWD.headHat ? 1 : 2,
    phase: p.flight ? p.phase : peopleHash(p.x, p.z, 104) * CROWD.walk * 4, dx: -Math.sin(yaw), dz: -Math.cos(yaw) };
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
  out.bob = CROWD.bob;
  return out;
}

// Shared CPU mirror of the shader's local gait; caller owns out (normal checks use the same posing).
export function crowdGait(x, y, z, joint, time, phase, walking, out) {
  const swing = walking ? Math.sin(time * CROWD.gaitRate + phase) : 0;
  if (joint === 1 || joint === 2) {
    const leg = swing * (joint === 1 ? 1 : -1), weight = Math.max(0, 1 - y / CROWD.legTop);
    z += leg * CROWD.stride * weight; y += Math.max(0, leg) * CROWD.footLift * weight;
  }
  if (joint === 3 || joint === 4) z += swing * (joint === 3 ? -1 : 1) * CROWD.armSwing * Math.max(0, (CROWD.shoulder - y) / (CROWD.shoulder - CROWD.armLow));
  if (walking && y > CROWD.hip) z -= (y - CROWD.hip) * CROWD.lean;
  out.x = x; out.y = y; out.z = z; return out;
}

// Six-sided rings avoid box silhouettes. Part: cloth/skin/hat/pack/staff/shoulder load.
// Joint: upper body / left leg / right leg / left sleeve / right sleeve.
export function crowdShape(role = 'chat', head = 0, staff = false, simple = false) {
  if (role === 'traveller') head = 1;
  const positions = [], normals = [], parts = [], joints = [], C = CROWD, n = C.sides;
  function pose(v) {
    let [x,y,z] = v;
    if (role === 'sitter') { if (y <= C.hip) x *= C.sitterWidth; y *= C.sitter; }
    if (role === 'farmer' && y > C.hip) { z -= (y-C.hip)*C.farmerLean; y=C.hip+(y-C.hip)*C.farmerBend; }
    return [x,y,z];
  }
  function tri(a,b,c,part,joint=0) {
    a=pose(a);b=pose(b);c=pose(c);
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,l=Math.hypot(nx,ny,nz);
    for(const p of [a,b,c]) {positions.push(...p);normals.push(nx/l,ny/l,nz/l);parts.push(part);joints.push(joint);}
  }
  function ring(w,d,y,x=0,z=0) {return Array.from({length:n},(_,i)=>{const a=i/n*Math.PI*2;return [x+Math.cos(a)*w,y,z+Math.sin(a)*d];});}
  function join(a,b,part,joint=0) {for(let i=0;i<n;i++){const j=(i+1)%n;tri(a[i],b[i],a[j],part,joint);tri(a[j],b[i],b[j],part,joint);}}
  function cap(a,part,joint=0,top=false) {for(let i=1;i<n-1;i++)top?tri(a[0],a[i+1],a[i],part,joint):tri(a[0],a[i],a[i+1],part,joint);}
  const hem=ring(C.hem[0],C.hem[2],C.hemY),waist=ring(C.torso[0],C.torso[2],C.hip),shoulder=ring(C.torso[1],C.torso[3],C.shoulder);
  if(simple)join(hem,shoulder,0);else{join(hem,waist,0);join(waist,shoulder,0);}
  cap(shoulder,0,0,true);
  // Keep a visible neck above the shoulder line in the detailed silhouette.
  if(!simple)join(ring(C.neck[0],C.neck[2],C.neck[4]),ring(C.neck[1],C.neck[3],C.neck[5]),1);
  // At distance the bottom of the face also supplies the neck.
  const face=ring(C.head[0],C.head[1],(C.head[2]+C.head[3])/2);
  for(let i=0;i<n;i++){const j=(i+1)%n;tri([0,simple?C.shoulder:C.head[2],0],face[i],face[j],1);tri([0,C.head[3],0],face[j],face[i],1);}
  for(const side of [-1,1]) {
    const joint=side<0?1:2,foot=ring(C.legWidth,C.legDepth,0,side*C.legSide),hip=ring(C.legWidth,C.legDepth,C.legTop,side*C.legSide);
    join(foot,hip,0,joint);if(!simple)cap(foot,0,joint);
    const arm=side<0?3:4,hand=ring(C.armWidth,C.armDepth,C.armLow,side*C.armSide),top=ring(C.armWidth,C.armDepth,C.shoulder,side*C.armSide);
    join(hand,top,0,arm); // The hanging sleeve ends remain open, like cloth.
  }
  const r=role==='traveller'?C.travellerHatRadius:C.cover[head],brim=role==='traveller'?C.travellerBrim:C.cover[3];
  const hat=ring(r,r,brim);
  for(let i=0;i<n;i++){const j=(i+1)%n;tri(hat[i],[0,1,0],hat[j],2);if(!simple)tri(hat[i],hat[j],[0,brim,0],2);}
  if(role==='traveller') {
    const pack=ring(C.pack[1],C.pack[3],C.pack[5],0,C.packBack),bottom=ring(C.pack[0],C.pack[2],C.pack[4],0,C.packBack);
    join(bottom,pack,3);if(!simple){cap(bottom,3);cap(pack,3,0,true);}
    if(staff){
      const base=ring(C.staffWidth,C.staffWidth,0,C.staffSide),top=ring(C.staffWidth,C.staffWidth,C.staffHeight,C.staffSide);
      join(base,top,4);if(!simple){cap(base,4);cap(top,4,0,true);}
      // Long wrapped load, transverse across one shoulder; hidden unless this person's role carries it.
      const a=ring(TRAVELLER.poleRadius/((C.heightMin+C.heightMax)/2),TRAVELLER.poleRadius/((C.heightMin+C.heightMax)/2),0),b=ring(TRAVELLER.poleRadius/((C.heightMin+C.heightMax)/2),TRAVELLER.poleRadius/((C.heightMin+C.heightMax)/2),TRAVELLER.poleLength/(C.heightMin+C.heightMax)*2);
      const turn=v=>[v[1]-TRAVELLER.poleLength/(C.heightMin+C.heightMax),TRAVELLER.poleHeight-v[0],C.packBack+v[2]];
      const left=a.map(turn),right=b.map(turn);join(left,right,5);if(!simple){cap(left,5);cap(right,5,0,true);}
    }
  }
  return {positions:new Float32Array(positions),normals:new Float32Array(normals),parts:new Uint8Array(parts),joints:new Uint8Array(joints),triangles:parts.length/3};
}
