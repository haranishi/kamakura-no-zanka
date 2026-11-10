// Original procedural wooden craft. Palette literals come from kamakura-props-kit.js;
// there is no external model, texture or separate art palette.
import * as THREE from '../vendor/three.module.min.js';
import { HARBOR } from './kamakura-harbor.js';

export const HARBOR_ART = Object.freeze({
  wood: '#64513a', plank: '#79644b', net: '#4c4a38', mat: '#817052', // existing props boat, seats, net and mat colours
  seamGain: .7, farDebugGain: .62, // linear gain: plank seams; dark far debug silhouettes
  beachDebug: '#e52acb', rackDebug: '#ffe02b', sailDebug: '#35e7ef', portDebug: '#ff8b24', // unlit category masks
  hullRim: Object.freeze([[-.5,-.5],[.5,-.5],[.5,.2],[.26,.4],[0,.5],[-.26,.4],[-.5,.2]].map(Object.freeze)), // normalized x/z: far hull outline
  taperStart: .7, sternInset: .1, floorFactor: .45, rimGain: .55, tipHalfWidth: .006, // normalized: near hull profile
  hullBoxes: Object.freeze([
    [0,.025,-.04,.5,.05,.8,'wood'], [0,HARBOR.depth/2,-.5+.018/2,.8,HARBOR.depth,.018,'wood'],
    ...[-.28,0,.25].map(z=>[0,HARBOR.depth,z,.78,.06,.035,'plank']),
    [.11,HARBOR.depth+.035,0,.025,.07,.83,'plank'], [.11,HARBOR.depth+.035,.39,.09,.07,.14,'plank'],
  ].map(Object.freeze)), // x/y/z,width/height/depth,colour role; x/z normalized, y in m: floor, stern, seats and oar
  sparePole: Object.freeze([-.19,HARBOR.depth+.035,0,.016,.07,.7,'wood']), // same units: second pole
  bundleBox: Object.freeze([0,HARBOR.depth+.1,-.18,.5,.2,.16,'mat']), // same units: optional mat/net bundle
  deckhouseBox: Object.freeze([0,.9,-.31,.65,.7,.2,'wood']), // same units: low cabin
  rudderBox: Object.freeze([0,.3,-.57,.03,.7,.11,'wood']), // same units: steering oar
  rackFootSpread: .35, rackReferenceWidth: 6.5, postSides: 6, mastDepth: .008, // m, m, sides, local length: frame feet and pole profiles
  hullSections: 4, plankRows: 3, seamWidth: .018, // counts and m: open lapstrake sides, dark joins
  keelWidth: .12, seatDepth: .035, seatHeight: .06, // local width fraction, length fraction, m
  poleRadius: .035, rackPoleRadius: .065, rackPosts: 4, // m, m, count: wooden poles, four-post drying frame
  netBottom: .35, netTop: 1.95, netRows: 4, netCols: 6, netGap: .035, // m, m, counts, local fraction: opaque coarse weave
  sailWidth: 5, sailHeight: 6.5, sailBottom: 2.2, sailBulge: .45, mastHeight: 9, // m: square woven sail and one mast
  sailCols: 4, sailRows: 3, // subdivisions: a slight belly, no transparent fabric
  hutHeight: 2.2, roofRise: .9, roofOverhang: .3, // m: simple plank shed
  pierBoard: .5, pierThickness: .12, pileSpacing: 3, pileDepth: 1.8, // m: deck boards and two rows of piles
  ropeWidth: .035, ropeSag: .2, ropeSegments: 4, // m, m, count: opaque mooring ribbons
  cargoWidth: .6, cargoHeight: .8, cargoCount: 3, // m, m, count: timber barrels beside the hut
});
function builder() {
  const vertices = [], colors = [], bundles = [], rigs = [];
  let bundle = 0, rig = 0;
  function triangle(a, b, c, color) {
    const rgb = new THREE.Color(color);
    vertices.push(...a, ...b, ...c); bundles.push(bundle,bundle,bundle); rigs.push(rig,rig,rig);
    for (let i = 0; i < 3; i++) colors.push(rgb.r, rgb.g, rgb.b);
  }
  function quad(a, b, c, d, color) { triangle(a, b, c, color); triangle(a, c, d, color); }
  function box(x, y, z, w, h, d, color) {
    const a = [x-w/2,y-h/2,z-d/2], b = [x+w/2,y-h/2,z-d/2], c = [x+w/2,y+h/2,z-d/2], e = [x-w/2,y+h/2,z-d/2];
    const f = [x-w/2,y-h/2,z+d/2], g = [x+w/2,y-h/2,z+d/2], j = [x+w/2,y+h/2,z+d/2], k = [x-w/2,y+h/2,z+d/2];
    quad(a,e,c,b,color); quad(f,g,j,k,color); quad(a,f,k,e,color); quad(b,c,j,g,color); quad(e,k,j,c,color); quad(a,b,g,f,color);
  }
  function finish() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
    g.setAttribute('aHarborBundleVertex', new THREE.Float32BufferAttribute(bundles,1));
    g.setAttribute('aHarborRigVertex', new THREE.Float32BufferAttribute(rigs,1));
    g.computeVertexNormals(); g.computeBoundingBox(); g.computeBoundingSphere(); return g;
  }
  return { triangle, quad, box, finish, bundle: value => { bundle = value; }, rig: value => { rig = value; } };
}
const A = HARBOR_ART;
function widthAt(t) { return t < A.taperStart ? .5 - A.sternInset * (1 - t / A.taperStart) ** 2 : .5 * (1 - (t - A.taperStart) / (1-A.taperStart)); }
const component = (b,recipe) => b.box(...recipe.slice(0,6),A[recipe[6]]);
function hull(b, far, sail = false) {
  if (far) {
    // Seven rim vertices, five deck + seven sides = exactly twelve triangles.
    const ring = A.hullRim;
    const v = i => [ring[i][0], HARBOR.depth, ring[i][1]];
    for (let i = 1; i < ring.length - 1; i++) b.triangle(v(0),v(i+1),v(i),A.wood);
    for (let i = 0; i < ring.length; i++) b.triangle(v(i),v((i+1)%ring.length),[0,0,0],A.wood);
    return;
  }
  const seam = new THREE.Color(A.wood).multiplyScalar(A.seamGain);
  const point = (t, row, side) => {
    const level = row / A.plankRows;
    // Pointed bow, flat broad transom and an open dark interior. All dimensions other than
    // height are local fractions: the instance supplies independent width and length.
    return [side * Math.max(A.tipHalfWidth, widthAt(t)) * (A.floorFactor + A.rimGain * level), HARBOR.depth * level + Math.max(0,t-A.taperStart) ** 2, t-.5];
  };
  for (let i = 0; i < A.hullSections; i++) for (const side of [-1,1]) for (let row = 0; row < A.plankRows; row++) {
    const t = i / A.hullSections, t1 = (i+1) / A.hullSections;
    const p = point(t,row,side), q = point(t1,row,side), r = point(t1,row+1,side), s = point(t,row+1,side);
    b.quad(p,q,r,s,A.wood);
    if (row > 0) { const lo = p.slice(), hi = q.slice(); lo[1] += A.seamWidth; hi[1] += A.seamWidth; b.quad(p,q,hi,lo,seam); }
  }
  for (let i=0;i<A.hullBoxes.length;i++) {
    const recipe=A.hullBoxes[i];
    if (i>=2 && i<=4) {
      const [x,y,z,w,h,d,role]=recipe;
      // Seat planks need their broad faces; the thin edges are below a pixel even nearby.
      for(const side of [-1,1])b.quad([x-w/2,y+side*h/2,z-d/2],[x+w/2,y+side*h/2,z-d/2],[x+w/2,y+side*h/2,z+d/2],[x-w/2,y+side*h/2,z+d/2],A[role]);
    } else component(b,recipe);
  }
  if (!sail) {
    component(b,A.sparePole);
    b.bundle(1); component(b,A.bundleBox); b.bundle(0);
  }
}
function rack(b, far) {
  if (far) {
    b.quad([-.5,0,0],[.5,0,0],[.5,A.netTop,0],[-.5,A.netTop,0],A.net);
    b.quad([-.5,A.netTop,0],[.5,A.netTop,0],[.5,HARBOR.rackHeight,0],[-.5,HARBOR.rackHeight,0],A.wood);
    return;
  }
  for (const x of [-.5+A.rackPoleRadius/A.rackReferenceWidth,.5-A.rackPoleRadius/A.rackReferenceWidth]) for (const z of [-A.rackFootSpread,A.rackFootSpread]) {
    // Six-sided round timber; radius in x compensates the typical frame width.
    for (let i=0;i<A.postSides;i++) {
      const a=i*Math.PI*2/A.postSides, c=(i+1)*Math.PI*2/A.postSides;
      const ax=x+Math.cos(a)*A.rackPoleRadius/A.rackReferenceWidth, az=z+Math.sin(a)*A.rackPoleRadius;
      const cx=x+Math.cos(c)*A.rackPoleRadius/A.rackReferenceWidth, cz=z+Math.sin(c)*A.rackPoleRadius;
      b.quad([ax,0,az],[cx,0,cz],[cx,HARBOR.rackHeight,cz],[ax,HARBOR.rackHeight,az],A.wood);
    }
  }
  for (const y of [A.netBottom,A.netTop]) b.box(0,y,0,1,A.rackPoleRadius,A.rackPoleRadius,A.wood);
  // Big opaque cells separated by broad openings; no transparent threads to shimmer at distance.
  for (let i = 0; i < A.netCols; i++) for (let j = 0; j < A.netRows; j++) {
    const x0 = -.5+i/A.netCols, x1 = -.5+(i+1)/A.netCols-A.netGap;
    const y0 = A.netBottom+(A.netTop-A.netBottom)*j/A.netRows, y1 = A.netBottom+(A.netTop-A.netBottom)*(j+1)/A.netRows-A.netGap;
    b.quad([x0,y0,0],[x1,y0,0],[x1,y1,0],[x0,y1,0],A.net);
  }
}
function rig(b, far) {
  if (!far) b.box(0,A.mastHeight/2,0,A.poleRadius*2/HARBOR.sailWidth,A.mastHeight,A.mastDepth,A.wood);
  if (far) {
    b.quad([-A.sailWidth/HARBOR.sailWidth/2,A.sailBottom,0],[A.sailWidth/HARBOR.sailWidth/2,A.sailBottom,0],
      [A.sailWidth/HARBOR.sailWidth/2,A.sailBottom+A.sailHeight,0],[-A.sailWidth/HARBOR.sailWidth/2,A.sailBottom+A.sailHeight,0],A.mat);
  } else {
    const point = (u,v) => [(u-.5)*A.sailWidth/HARBOR.sailWidth,A.sailBottom+v*A.sailHeight,Math.sin(u*Math.PI)*Math.sin(v*Math.PI)*A.sailBulge/((HARBOR.sailLengthMin+HARBOR.sailLengthMax)/2)];
    for (let i = 0; i < A.sailCols; i++) for (let j = 0; j < A.sailRows; j++) b.quad(point(i/A.sailCols,j/A.sailRows),point((i+1)/A.sailCols,j/A.sailRows),point((i+1)/A.sailCols,(j+1)/A.sailRows),point(i/A.sailCols,(j+1)/A.sailRows),A.mat);
  }
  if (!far) component(b,A.deckhouseBox); // low deckhouse instead of a person silhouette
  if (!far) component(b,A.rudderBox); // stern steering oar
}
function infrastructure(b, far, infra) {
  // Bake the few harbour structures into one geometry/draw; boats retain the shared hull batch.
  for (const p of infra) {
    if (p.kind === 'rope') {
      if (!far) {
        const dx=p.endX-p.x,dz=p.endZ-p.z,len=Math.hypot(dx,dz)||1;
        const ox=-dz/len*A.ropeWidth/2,oz=dx/len*A.ropeWidth/2;
        const point=(t,side)=>[p.x+dx*t+ox*side,p.y+(p.endY-p.y)*t-Math.sin(t*Math.PI)*A.ropeSag,p.z+dz*t+oz*side];
        for(let i=0;i<A.ropeSegments;i++)b.quad(point(i/A.ropeSegments,-1),point((i+1)/A.ropeSegments,-1),point((i+1)/A.ropeSegments,1),point(i/A.ropeSegments,1),A.mat);
      }
      continue;
    }
    const local = builder();
    if (p.kind === 'pier') {
      const boards = far ? 1 : Math.round(p.d/A.pierBoard);
      for (let i=0;i<boards;i++) local.box(0,HARBOR.pierHeight-A.pierThickness/2,(i+.5)*p.d/boards,p.w,A.pierThickness,p.d/boards*(far?1:.96),A.plank);
      const piles = far ? 2 : Math.floor(p.d/A.pileSpacing)+1;
      for (let i=0;i<piles;i++) for (const side of [-1,1]) local.box(side*p.w/2,HARBOR.pierHeight-A.pileDepth/2,i*p.d/(piles-1),A.rackPoleRadius*2,A.pileDepth,A.rackPoleRadius*2,A.wood);
    } else {
      local.box(0,A.hutHeight/2,0,p.w,A.hutHeight,p.d,A.wood);
      for (const side of [-1,1]) {
        const x = side*(p.w/2+A.roofOverhang), z = p.d/2+A.roofOverhang;
        local.quad([0,A.hutHeight+A.roofRise,-z],[0,A.hutHeight+A.roofRise,z],[x,A.hutHeight,z],[x,A.hutHeight,-z],A.plank);
      }
      if (!far) for (let i=0;i<A.cargoCount;i++) local.box(p.w/2+A.cargoWidth,A.cargoHeight/2,(i-1)*A.cargoWidth,A.cargoWidth,A.cargoHeight,A.cargoWidth,A.mat);
    }
    const g = local.finish(); g.rotateY(p.yaw); g.translate(p.x,p.y,p.z);
    const pos = g.attributes.position, col = g.attributes.color;
    for (let i=0;i<pos.count;i+=3) {
      b.triangle([pos.getX(i),pos.getY(i),pos.getZ(i)],[pos.getX(i+1),pos.getY(i+1),pos.getZ(i+1)],[pos.getX(i+2),pos.getY(i+2),pos.getZ(i+2)],new THREE.Color(col.getX(i),col.getY(i),col.getZ(i)));
    }
    g.dispose();
  }
}
export function harborGeometry(kind, far = false, infra = []) {
  const b = builder();
  if (kind === 'boat') hull(b,far);
  else if (kind === 'craft') { hull(b,far); b.rig(1); rig(b,far); b.rig(0); }
  else if (kind === 'rack') rack(b,far);
  else if (kind === 'sail') { hull(b,far,true); rig(b,far); }
  else if (kind === 'port') infrastructure(b,far,infra);
  else throw new RangeError(`Unknown harbour shape: ${kind}`);
  return b.finish();
}
