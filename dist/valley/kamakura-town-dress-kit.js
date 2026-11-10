// Original procedural meshes; colour sources are the shipped house, props and crop palettes.
import * as THREE from '../vendor/three.module.min.js';
import { FIELD_LEAF } from './kamakura-fields-kit.js';
import { HOUSE_PALETTE } from './kamakura-house-texture.js';
import { TOWN_DRESS } from './kamakura-town-dress.js';
export const DRESS_ART = Object.freeze({
  charGain: .7, ashMix: .65, newWoodGain: 1.8, clothGain: 1.25, grassGain: .65, farDebugGain: .55, // linear gains / mix: derived existing colours
  newWoodPale: .5, // mix toward the lime colour. Parent (real Chrome): the brightened roof colour alone read as painted yellow, not fresh timber.
  debug: Object.freeze({ burnt: '#ff3020', repair: '#ffe020', garden: '#20e040', bamboo: '#20e8ff', board: '#20e8ff', log: '#20e8ff', tent: '#f020e0', smoke: '#ff3020' }), // unlit category masks
  ruinPosts: 7, ruinBeams: 4, ruinStones: 8, ashSides: 10, grassPatches: 5, // counts: charred skeleton, foundation and old regrowth
  ashInner: .44, ashOuter: .49, ashGain: .5, postSpreadX: .35, postSpreadZ: .32, postHeightPhase: .37, // ratios: irregular ash and uneven ruin skeleton
  beamSpread: .13, beamStart: -.32, beamEnd: .3, beamSkew: .14, wallSpan: .8, // footprint ratios: fallen beams and single lower wall
  stoneWidth: .32, stoneHeight: .18, stoneAlong: .25, stoneSide: .4, // m / ratios: surviving foundation rows
  grassSpread: .25, grassAlong: .12, grassWidth: .7, grassDepth: .6, // ratios / m: sparse old regrowth
  postWidth: .16, postLow: .8, postHigh: 2.6, lean: .28, broken: .10, // m: charred columns, lean and broken tops
  wallLow: .6, wallHigh: 1.1, ashLift: .02, grassLift: .025, // m: surviving lower wall and ground offsets
  frameCols: 3, frameRows: 4, frameSpacing: 1.9, frameHeight: 2.8, framePost: .12, roofRise: 1.2, // count / m: new timber frame
  scaffoldOffset: .7, stackOffset: .55, stackSpacing: 1.5, stackWidth: .7, stackHeight: .35, stackDepth: 1.3, // m: scaffold and two timber stacks
  bundleWidth: 1.1, bundleHeight: .5, bundleDepth: .7, bundleOffset: .6, // m: stored thatch
  ladderWidth: .45, ladderHeight: 2.8, ladderLean: .4, ladderOffset: .55, ladderRail: .05, ladderRung: .04, // m: ladder
  scaffoldHeight: 1.1, scaffoldTop: 2.2, scaffoldWidth: .08, ladderRungs: 6, // m / count: two-level scaffold and ladder
  ridgeSpacing: .9, cropHalfWidth: .2, cropGain: .85, cropGainStep: .075, stakeWidth: .04, stakeInset: .3, // m / ratios: garden row layout
  ridgeRows: 6, ridgeWidth: .6, ridgeHeight: .12, cropEvery: .5, cropLow: .18, cropHigh: .36, stakes: 6, stakeHeight: 1.3, // count / m: garden rows
  fenceBoards: 18, fenceBamboos: 22, fenceLogs: 4, fenceReference: 5, fencePost: .07, railHeight: .32, // counts / m: detailed fence spacing
  roundSides: 6, fenceFill: .8, fenceInset: .98, // ratios: plank width and post endpoints inside the segment
  tableWidth: 1.2, tableHeight: .75, tableDepth: .65, cargoSize: .5, cargoHeight: .4, cargoSide: -.3, cargoAlong: .2, // m / footprint ratios: awning contents
  tentPost: .06, tentHigh: 2.4, tentLow: 2.1, tentSag: .2, clothCols: 4, clothRows: 2, // m / counts: awning cloth grid
  fenceCoverage: Object.freeze({ bamboo: .42, board: .85, log: .2 }), // alpha: match near gaps when fences become panels
  fenceStripe: .20, stripeDark: .68, fenceStripeFill: .75, gardenStripeFill: .58, // m / linear gain: far vertical slats
});
const A = DRESS_ART, P = HOUSE_PALETTE;
export const dressPalette = () => ({
  char: P.oldWood.map(v => v * A.charGain), ash: P.stone.map((v, i) => v * (1 - A.ashMix) + P.oldLime[i] * A.ashMix),
  wood: P.roof.map((v, i) => Math.min(.9, v * A.newWoodGain) * (1 - A.newWoodPale) + P.lime[i] * A.newWoodPale), cloth: P.lime.map(v => Math.min(.9, v * A.clothGain)),
  stone: P.oldStone, earth: P.oldEarth, bamboo: P.oldRoof, board: P.oldWood,
  crop: FIELD_LEAF,
});
function builder(w, d) {
  const positions = [], colors = [], cloths = [], stakes = [], tags = [], palette = dressPalette();
  let cloth = 0, stake = 0, tag = 0;
  function tri(a, b, c, role, gain = 1) {
    for (const v of [a, b, c]) { positions.push(v[0] / w, v[1], v[2] / d); colors.push(...palette[role].map(v => v * gain)); cloths.push(cloth); stakes.push(stake); tags.push(tag); }
  }
  function quad(a, b, c, d, role, gain = 1) { tri(a, b, c, role, gain); tri(a, c, d, role, gain); }
  // Open-ended timber; six facets for bamboo/logs, four for sawn square beams.
  function beam(a, b, width, role, sides = 4) {
    const dir = new THREE.Vector3(...b).sub(new THREE.Vector3(...a)).normalize();
    const u = new THREE.Vector3().crossVectors(dir, Math.abs(dir.y) < .9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0)).normalize().multiplyScalar(width / 2);
    const v = new THREE.Vector3().crossVectors(dir, u).normalize().multiplyScalar(width / 2);
    const profile = sides === 4 ? [[-1, -1], [1, -1], [1, 1], [-1, 1]] : Array.from({length:sides},(_,i)=>[Math.cos(i*Math.PI*2/sides),Math.sin(i*Math.PI*2/sides)]);
    const ring = p => profile.map(([s, t]) => [p[0] + s * u.x + t * v.x, p[1] + s * u.y + t * v.y, p[2] + s * u.z + t * v.z]);
    const lo = ring(a), hi = ring(b);
    for (let i = 0; i < sides; i++) { const j = (i + 1) % sides; quad(lo[i], lo[j], hi[j], hi[i], role); }
  }
  function box(x, y, z, w, h, d, role) {
    const a = [x-w/2,y,z-d/2], b = [x+w/2,y,z-d/2], c = [x+w/2,y+h,z-d/2], e = [x-w/2,y+h,z-d/2];
    const f = [x-w/2,y,z+d/2], g = [x+w/2,y,z+d/2], j = [x+w/2,y+h,z+d/2], k = [x-w/2,y+h,z+d/2];
    quad(a,e,c,b,role); quad(f,g,j,k,role); quad(a,f,k,e,role); quad(b,c,j,g,role); quad(e,k,j,c,role); quad(a,b,g,f,role);
  }
  function finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('aDressCloth', new THREE.Float32BufferAttribute(cloths, 1)); g.setAttribute('aDressStake', new THREE.Float32BufferAttribute(stakes, 1));
    g.setAttribute('aDressTag', new THREE.Float32BufferAttribute(tags, 1));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  return { tri, quad, beam, box, finish, cloth: n => { cloth = n; }, stake: n => { stake = n; }, tag: n => { tag = n; } };
}
function ruin(b, far, w, d) {
  b.tag(1); // ground patches get terrain-conforming bases; no billboard expansion on near geometry
  const rim = Array.from({ length: A.ashSides }, (_, i) => { const t = i * Math.PI * 2 / A.ashSides, r = i % 2 ? A.ashInner : A.ashOuter; return [Math.cos(t) * w * r, A.ashLift, Math.sin(t) * d * r]; });
  for (let i = 0; i < rim.length; i++) b.tri([0,A.ashLift,0], rim[(i+1)%rim.length], rim[i], 'ash', A.ashGain);
  b.tag(0);
  const count = far ? 3 : A.ruinPosts;
  for (let i = 0; i < count; i++) {
    const x = (i % 3 - 1) * w * A.postSpreadX, z = (Math.floor(i / 3) - .8) * d * A.postSpreadZ, h = A.postLow + (i * A.postHeightPhase % 1) * (A.postHigh - A.postLow);
    // Alternating corner height and tilt break the top instead of a flat-cut box.
    const lean = !far && i < 3 ? A.lean * (i % 2 ? -1 : 1) : 0;
    b.beam([x,0,z],[x+lean,h,z+lean/2],far ? A.postWidth * 2 : A.postWidth,'char');
    if (!far) b.tri([x+lean-A.postWidth/2,h,z+lean/2],[x+lean+A.postWidth/2,h,z+lean/2],[x+lean,h+A.broken,z+lean/2+A.postWidth/2],'char');
  }
  if (far) return;
  for (let i = 0; i < A.ruinBeams; i++) { const z = (i-(A.ruinBeams-1)/2)*d*A.beamSpread; b.beam([w*A.beamStart,A.postWidth/2,z],[w*A.beamEnd,A.postWidth*1.5,z+d*A.beamSkew],A.postWidth,'char'); }
  for (let i = 0; i < 4; i++) {
    const x0 = -w*A.wallSpan/2+i*w*A.wallSpan/4, x1 = x0+w*A.wallSpan/4, h0 = A.wallLow+(i%2)*(A.wallHigh-A.wallLow), h1 = A.wallLow+((i+1)%2)*(A.wallHigh-A.wallLow);
    b.quad([x0,0,-d*A.wallSpan/2],[x0,h0,-d*A.wallSpan/2],[x1,h1,-d*A.wallSpan/2],[x1,0,-d*A.wallSpan/2],'char');
  }
  for (let i = 0; i < A.ruinStones; i++) { const x = (i%4-1.5)*w*A.stoneAlong, z = (i<4?-1:1)*A.stoneSide*d; b.box(x,0,z,A.stoneWidth,A.stoneHeight,A.stoneWidth,'stone'); }
  b.tag(1);
  for (let i = 0; i < A.grassPatches; i++) { const x=(i%3-1)*w*A.grassSpread,z=(i-2)*d*A.grassAlong; b.tri([x-A.grassWidth/2,A.grassLift,z-A.grassDepth/2],[x,A.grassLift,z+A.grassDepth/2],[x+A.grassWidth/2,A.grassLift,z-A.grassDepth/2],'crop',A.grassGain); }
}
function repair(b, far) {
  const w = (A.frameCols-1)*A.frameSpacing, d = (A.frameRows-1)*A.frameSpacing, h=A.frameHeight;
  for(let i=0;i<(far?2:A.frameCols);i++) for(let j=0;j<(far?2:A.frameRows);j++) {
    const x=far?(i-.5)*w:(i-(A.frameCols-1)/2)*A.frameSpacing,z=far?(j-.5)*d:(j-(A.frameRows-1)/2)*A.frameSpacing;
    b.beam([x,0,z],[x,h,z],A.framePost,'wood');
  }
  for(const x of [-w/2,w/2])b.beam([x,h,-d/2],[x,h,d/2],A.framePost,'wood');
  for(const z of (far?[-d/2,d/2]:[-d/2,-d/6,d/6,d/2])) {
    b.beam([-w/2,h,z],[w/2,h,z],A.framePost,'wood');
    for(const side of [-1,1])b.beam([side*w/2,h,z],[0,h+A.roofRise,z],A.framePost,'wood');
  }
  b.beam([0,h+A.roofRise,-d/2],[0,h+A.roofRise,d/2],A.framePost,'wood');
  // One half is covered; the other keeps its exposed rafters.
  b.cloth(1); const point=(u,v)=>[-w/2+u*w/2,h+u*A.roofRise-Math.sin(v*Math.PI)*A.tentSag,-d/2+v*d];
  for(let j=0;j<(far?1:A.clothRows);j++){const rows=far?1:A.clothRows;b.quad(point(0,j/rows),point(0,(j+1)/rows),point(1,(j+1)/rows),point(1,j/rows),'cloth');} b.cloth(0);
  if(far)return;
  const sx=w/2+A.scaffoldOffset;
  for(const z of [-d/2,d/2])b.beam([sx,0,z],[sx,A.scaffoldTop,z],A.scaffoldWidth,'board',A.roundSides);
  for(const y of [A.scaffoldHeight,A.scaffoldTop])b.beam([sx,y,-d/2],[sx,y,d/2],A.scaffoldWidth,'board',A.roundSides);
  for(const z of [-d/2,d/2])b.beam([w/2,A.scaffoldHeight,z],[sx,A.scaffoldTop,z],A.scaffoldWidth,'board',A.roundSides);
  // Two timber stacks, a thatch bundle and a leaning ladder fit inside the kit footprint.
  for(let i=0;i<2;i++)b.box(-w/2-A.stackOffset,0,(i-.5)*A.stackSpacing,A.stackWidth,A.stackHeight,A.stackDepth,'wood');
  b.box(0,0,d/2+A.bundleOffset,A.bundleWidth,A.bundleHeight,A.bundleDepth,'bamboo');
  const lx=-A.ladderWidth,lz=-d/2-A.ladderOffset;
  for(const x of [lx,lx+A.ladderWidth])b.beam([x,0,lz],[x,h,lz+A.grassDepth/2],A.ladderRail,'board');
  for(let j=1;j<=A.ladderRungs;j++){const y=j*h/(A.ladderRungs+1);b.quad([lx,y,lz+A.grassDepth/2*y/h],[lx+A.ladderWidth,y,lz+A.grassDepth/2*y/h],[lx+A.ladderWidth,y+A.ladderRung,lz+A.grassDepth/2*y/h],[lx,y+A.ladderRung,lz+A.grassDepth/2*y/h],'board');}
}
function garden(b, far, w, d) {
  b.tag(1);
  if(far){b.quad([-w/2,.02,-d/2],[-w/2,.02,d/2],[w/2,.02,d/2],[w/2,.02,-d/2],'earth');return;}
  for(let i=0;i<A.ridgeRows;i++) {
    const x=(i-(A.ridgeRows-1)/2)*A.ridgeSpacing,h=A.ridgeHeight,half=A.ridgeWidth/2;
    b.quad([x-half,0,-d/2],[x-half,0,d/2],[x,h,d/2],[x,h,-d/2],'earth');
    b.quad([x,h,-d/2],[x,h,d/2],[x+half,0,d/2],[x+half,0,-d/2],'earth');
    // A scalloped ribbon merges the little vegetable clumps into one row.
    const n=Math.floor(d/A.cropEvery),top=h+(i%2?A.cropLow:A.cropHigh);
    for(let j=0;j<n;j++){const z=-d/2+j*d/n,z1=-d/2+(j+1)*d/n;b.tri([x-A.cropHalfWidth,h,z],[x-A.cropHalfWidth,h,z1],[x+A.cropHalfWidth,top,(z+z1)/2],'crop',A.cropGain+(i%3)*A.cropGainStep);}
  }
  b.stake(1);
  for(let i=0;i<A.stakes;i++){const x=(i-(A.stakes-1)/2)*A.ridgeSpacing;b.quad([x-A.stakeWidth/2,0,d/2-A.stakeInset],[x+A.stakeWidth/2,0,d/2-A.stakeInset],[x+A.stakeWidth/2,A.stakeHeight,d/2-A.stakeInset],[x-A.stakeWidth/2,A.stakeHeight,d/2-A.stakeInset],'bamboo');} b.stake(0);
}
function fence(b, kind, far) {
  const h=TOWN_DRESS.fenceHeights[kind];
  if(far){b.quad([-.5,0,0],[.5,0,0],[.5,h,0],[-.5,h,0],kind==='bamboo'?'bamboo':'board');return;}
  const n=kind==='bamboo'?A.fenceBamboos:kind==='board'?A.fenceBoards:A.fenceLogs;
  for(let i=0;i<n;i++) {
    const x=(i/(n-1)-.5)*A.fenceReference*A.fenceInset,width=kind==='board'?A.fenceFill*A.fenceReference/n:A.fencePost;
    b.beam([x,0,0],[x,h,0],width,kind==='bamboo'?'bamboo':'board',kind==='board'?4:A.roundSides);
  }
  for(const y of [A.railHeight,h-A.railHeight])b.beam([-A.fenceReference/2,y,0],[A.fenceReference/2,y,0],A.fencePost,'board',kind==='log'?A.roundSides:4);
  if(kind==='board')b.beam([-A.fenceReference/2,h-A.fencePost/2,0],[A.fenceReference/2,h-A.fencePost/2,0],A.fencePost,'board');
}
function tent(b, far, w, d) {
  if(!far)for(const x of [-w/2+A.tentPost/2,w/2-A.tentPost/2])for(const z of [-d/2+A.tentPost/2,d/2-A.tentPost/2])b.beam([x,0,z],[x,z<0?A.tentHigh:A.tentLow,z],A.tentPost,'board');
  const point=(u,v)=>[(u-.5)*w,A.tentHigh+(A.tentLow-A.tentHigh)*v-Math.sin(u*Math.PI)*Math.sin(v*Math.PI)*A.tentSag,(v-.5)*d];
  b.cloth(1); const cols=far?1:A.clothCols,rows=far?1:A.clothRows;
  for(let i=0;i<cols;i++)for(let j=0;j<rows;j++)b.quad(point(i/cols,j/rows),point(i/cols,(j+1)/rows),point((i+1)/cols,(j+1)/rows),point((i+1)/cols,j/rows),'cloth');b.cloth(0);
  if(!far){b.box(0,0,0,A.tableWidth,A.tableHeight,A.tableDepth,'wood');b.box(w*A.cargoSide,0,d*A.cargoAlong,A.cargoSize,A.cargoHeight,A.cargoSize,'bamboo');}
}
export function townDressGeometry(kind, far=false) {
  const w=TOWN_DRESS.fenceHeights[kind]&&!far?A.fenceReference:kind==='repair'?TOWN_DRESS.repairWidth:kind==='garden'?TOWN_DRESS.gardenWidth:kind==='burnt'?6:kind==='tent'?3.5:1;
  const d=kind==='repair'?TOWN_DRESS.repairDepth:kind==='garden'?TOWN_DRESS.gardenDepth:kind==='burnt'?9:kind==='tent'?2.75:1;
  const b=builder(w,d);
  if(kind==='burnt')ruin(b,far,w,d);else if(kind==='repair')repair(b,far);else if(kind==='garden')garden(b,far,w,d);
  else if(TOWN_DRESS.fenceHeights[kind])fence(b,kind,far);else if(kind==='tent')tent(b,far,w,d);
  else if(kind==='smoke')for(let i=0;i<4;i++){b.tag(i/4);b.quad([-.5,-.5,0],[.5,-.5,0],[.5,.5,0],[-.5,.5,0],'ash');}
  else throw new RangeError(`Unknown town dressing: ${kind}`);
  return b.finish();
}
