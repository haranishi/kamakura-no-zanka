import { validateSteps, stepsEnabled } from './kamakura-stairs.js';
// Pure facility catalog, placement and footprint rules. No bundled geography.
export const FACILITY_FAR = Object.freeze({
  landmarkRange: 8000, // metres: flying hall, romon and Buddha range.
  otherRange: 4000, // metres: flying torii, gates and other facilities.
  wallRange: 2500 // metres: flying fence range.
});
export const FACILITY_PARTS = ['hall', 'romon', 'gate', 'torii', 'buddha', 'fence', 'kairo', 'causeway', 'stairs', 'jetty', 'sando', 'platform', 'nagayamon'];
export const FACILITY_RUINS = Object.freeze(['burnt']);
export const ruinsEnabled = search => new URLSearchParams(search).get('ruins') !== '0';
const softParts = new Set(['fence', 'kairo', 'causeway', 'stairs', 'jetty', 'sando', 'platform']);
export const facilitiesEnabled = search => new URLSearchParams(search).get('facilities') !== '0';
export function decodeFacilities(catalog) {
  const fail = () => { throw new Error('施設の配置データが不正です'); };
  if (catalog?.schema !== 'kz-facilities/0.1' || catalog.kit !== 'facilities.glb' ||
      !Number.isInteger(catalog.count) || catalog.count < 0 || catalog.count > 10000 ||
      !Array.isArray(catalog.nodes) || catalog.nodes.length !== catalog.count ||
      !Number.isInteger(catalog.total_triangles) || catalog.total_triangles < 0 || !catalog.parts) fail();
  const names = new Set(), counts = {}; let triangles = 0;
  for (const n of catalog.nodes) {
    if (typeof n.node !== 'string' || !n.node || names.has(n.node) || !FACILITY_PARTS.includes(n.part) || n.soft !== softParts.has(n.part) ||
        !['facility', 'source'].every(k => typeof n[k] === 'string') ||
        !(typeof n.status === 'string' || n.status === null) ||
        !Number.isInteger(n.triangles) || n.triangles <= 0 || !Number.isFinite(n.rel_anchor) ||
        ![n.anchor_xz, n.bbox_min, n.bbox_max].every((a,i) => Array.isArray(a) && a.length === (i ? 3 : 2) && a.every(Number.isFinite)) ||
        n.bbox_min.some((v,i) => v > n.bbox_max[i]) ||
        (n.ruin !== undefined && (n.part !== 'hall' || !FACILITY_RUINS.includes(n.ruin)))) fail();
    validateSteps(n);
    names.add(n.node); counts[n.part] = (counts[n.part] || 0) + 1; triangles += n.triangles;
  }
  if (triangles !== catalog.total_triangles || Object.keys(catalog.parts).some(k => !FACILITY_PARTS.includes(k)) ||
      FACILITY_PARTS.some(k => (catalog.parts[k] || 0) !== (counts[k] || 0))) fail();
  return { catalog, nodes: catalog.nodes };
}
export const facilitySolid = n => n.part === 'hall' || n.part === 'buddha';
export const facilityExcludesTrees = n => facilitySolid(n) || n.part === 'stairs';
export const facilityCastsShadow = n => ['hall', 'romon', 'gate', 'torii', 'buddha', 'nagayamon'].includes(n.part);
export function facilityRange(n, quality = 'standard', step = 0, flying = false) {
  const landmark=n.part==='hall'||n.part==='romon'||n.part==='buddha';
  const range = landmark ? 3000 : n.part === 'fence' ? 900 : 1200;
  const far = landmark ? FACILITY_FAR.landmarkRange : n.part === 'fence' ? FACILITY_FAR.wallRange : FACILITY_FAR.otherRange;
  return (flying ? far : range) * (quality === 'light' ? .6 : 1) * (step === 3 ? .6 : 1);
}
export function facilityVisible(n, box, pos, quality, step, flying = false) {
  // Distance to horizontal bounds, not the anchor of a long wall or causeway.
  const c = Math.cos(box.rotY), s = Math.sin(box.rotY), dx = pos.x - box.x, dz = pos.z - box.z;
  const horizontal=Math.hypot(Math.max(0, Math.abs(dx*c-dz*s)-box.w/2), Math.max(0, Math.abs(dx*s+dz*c)-box.d/2));
  const distance=flying?Math.hypot(horizontal,Math.max(0,(box.minY??0)-(pos.y??0),(pos.y??0)-(box.maxY??box.height??0))):horizontal;
  return distance <= facilityRange(n, quality, step, flying);
}
// Parts the hero walks on (causeway, stairs, approach, platform). The walking height is the terrain, so their tops are
// pressed down to a paving just above the ground; a 1m-4m embankment would swallow the hero's legs (the spawn is on the
// causeway). The skirt below the ground is kept as it is.
export const FACILITY_WALK_SURFACE = new Set(['causeway', 'stairs', 'sando', 'platform']);
export const FACILITY_WALK_TOP = 0.12;
// The causeway runs along the street and the river bank. Pressed down to a paving it leaves white shards where the bank
// drops away, and left as an embankment it swallows the hero. It stays out of the scene until it can be walked on
// (a walk-surface overlay); ?causeway=1 shows it for inspection. The node is still decoded and checked.
export const FACILITY_HELD_BACK = new Set(['causeway']);
export const causewayShown = search => new URLSearchParams(search).get('causeway') === '1';
export const facilityVertexY = (n, ground, rel) => ground + (FACILITY_WALK_SURFACE.has(n.part) ? Math.min(rel, FACILITY_WALK_TOP) : rel);
export function facilityPlacement(n, positions, terrain, {search=''}={}) {
  const soft=n.soft && !(n.steps && stepsEnabled(search));
  const [x,z] = n.anchor_xz, y = soft ? 0 : terrain.heightAt(x,z) + n.rel_anchor;
  const result = Float32Array.from(positions);
  if (soft) for (let i=0; i<result.length; i+=3) result[i+1] = facilityVertexY(n, terrain.heightAt(x+positions[i], z+positions[i+2]), positions[i+1]);
  return { positions: result, position: { x,y,z }, rebuildNormals: soft };
}
// Convex hull followed by the minimum-area rectangle over hull edge orientations.
export function minimumRectangle(points) {
  const p = [...new Map(points.map(p => [p.join(','), p])).values()].sort((a,b) => a[0]-b[0] || a[1]-b[1]);
  const cross = (a,b,c) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const chain = list => { const h=[]; for (const q of list) { while(h.length>1 && cross(h.at(-2),h.at(-1),q)<=0) h.pop(); h.push(q); } return h; };
  const hull = [...chain(p).slice(0,-1), ...chain([...p].reverse()).slice(0,-1)];
  let best = null;
  for(let i=0;i<hull.length;i++) {
    const a=hull[i], b=hull[(i+1)%hull.length], angle=Math.atan2(b[1]-a[1], b[0]-a[0]), c=Math.cos(angle), s=Math.sin(angle);
    let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
    for(const [x,z] of hull) {const u=x*c+z*s,v=-x*s+z*c;u0=Math.min(u0,u);u1=Math.max(u1,u);v0=Math.min(v0,v);v1=Math.max(v1,v);}
    const w=u1-u0,d=v1-v0, area=w*d;
    if(!best || area<best.area-1e-9) {const u=(u0+u1)/2,v=(v0+v1)/2;best={x:u*c-v*s,z:u*s+v*c,w,d,rotY:-angle,area};}
  }
  if(!best || best.w<=1e-6 || best.d<=1e-6) throw new Error('施設の足跡を読み取れません');
  const {area, ...box}=best; return box;
}
export function facilityFootprint(n, positions, lowOnly = true) {
  let bottom=Infinity, top=-Infinity;
  for(let i=1;i<positions.length;i+=3) {bottom=Math.min(bottom,positions[i]);top=Math.max(top,positions[i]);}
  const points=[];
  for(let i=0;i<positions.length;i+=3) if(!lowOnly || positions[i+1]<=bottom+1e-3) points.push([positions[i],positions[i+2]]);
  const box=minimumRectangle(points);
  return {...box, x:box.x+n.anchor_xz[0],z:box.z+n.anchor_xz[1],height:Math.max(.1,top-bottom),id:n.node,bottom};
}
export function facilityGroundSamples(box, terrain, spacing=.5) {
  const nx=Math.max(1,Math.ceil(box.w/spacing)),nz=Math.max(1,Math.ceil(box.d/spacing)),c=Math.cos(box.rotY),s=Math.sin(box.rotY);
  let low=Infinity,high=-Infinity;
  for(let i=0;i<=nx;i++) for(let j=0;j<=nz;j++) {
    const u=(i/nx-.5)*box.w,v=(j/nz-.5)*box.d,h=terrain.heightAt(box.x+c*u+s*v,box.z-s*u+c*v);
    low=Math.min(low,h); high=Math.max(high,h);
  }
  return {low,high};
}

// Select by actual horizontal geometry, never by facility names or IDs.
export function buddhaSearch(meta, search = '') {
  if (meta?.buddha !== undefined && meta.buddha !== 'hall') throw new RangeError('Invalid map Buddha');
  const q = new URLSearchParams(search);
  if (q.has('buddha') || meta?.buddha === undefined) return search;
  q.set('buddha', meta.buddha); return '?' + q.toString();
}
export const buddhaHallMode = search => new URLSearchParams(search).get('buddha') === 'hall';
export function enclosingBuddhaHalls(records) {
  const result=[];
  for(const buddha of records) {
    if(buddha.node.part!=='buddha')continue;
    let smallest=null;
    for(const hall of records) {
      if(hall.node.part!=='hall')continue;
      const b=hall.bounds,c=Math.cos(b.rotY),s=Math.sin(b.rotY),dx=buddha.bounds.x-b.x,dz=buddha.bounds.z-b.z;
      if(Math.abs(c*dx-s*dz)>b.w/2 || Math.abs(s*dx+c*dz)>b.d/2)continue;
      if(!smallest||b.w*b.d<smallest.bounds.w*smallest.bounds.d)smallest=hall;
    }
    if(smallest&&!result.includes(smallest))result.push(smallest);
  }
  return result;
}
// Re-export the pure layout so the facility loader and add-on layer share one plan.
export { prepareRuinHall, prepareBurntHall, RUIN_HALL } from './kamakura-ruin-hall.js';
