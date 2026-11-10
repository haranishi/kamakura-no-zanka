// Pure kit measurement, deterministic construction and caller-owned selection buffers.
import { houseBodyBounds } from './kamakura-houses.js';
import { houseIndexSeed,HOUSE_PALETTE as P } from './kamakura-house-texture.js';
export { HOUSE_PARTS } from './kamakura-house-parts.js';
import { houseParts,box,beam,stone,roofCourse,solid,finishHouse } from './kamakura-house-parts.js';
export const HOUSE2 = Object.freeze({
  slopeMin: .15, slopeMax: .98, slopeMargin: 1.15, // upward share of a sloping roof face (not a wall, not a flat cap) and the lead one direction needs to decide the ridge.
  weld:.001, // metres: maximum separation of welded source vertices.
  assignMargin:1, // metres: expand bodies when assigning roof/accessory components.
  towerRise:1, // metres: minimum rise above the main roof to identify a lookout.
  towerOpening:1/3, // fraction: open upper wall band on all four lookout faces.
  porchPosts:2, // posts: support the outside edge of each source entrance roof.
  rearRafters:6, // tails per slope: reduced detail on secondary wings.
  rearStones:4, // stones per slope: reduced secondary roof decoration.
  full:60, // metres, 3D: fully modelled near houses.
  swap:75, // metres, 3D: end of complementary dither.
  cap:90, // houses: closest eligible houses only.
  triangles:160000, // triangles: total submitted detail geometry.
  draws:40, // commands: maximum detail batches.
  sliceMs:2, // milliseconds: yield between construction stages.
  maxBuildMs:8, // milliseconds: hard target per construction slice (Node/Chrome measurement).
  variants:2, // variants per loaded kind, selected by the existing stable instance seed.
  epsilon:.0001, // metres: same-height tolerance for kit rings.
  foundationRatio:.45, // fraction of eave height: reject a roof-underface ring as a foundation.
  postPitch:1.9, // metres: maximum interval between visible posts.
  post:.12, // metres: ordinary post width.
  postReveal:.04, // metres: post face proud of the wall.
  mansionPost:.18, // metres: main-house post width.
  wall:.12, // metres: solid infill thickness.
  waist:.85, // metres above floor: lower rail/panelling.
  board:.25, // metres: visible vertical board spacing.
  batten:.022, // metres: board joint cover width.
  doorMin:1.2, // metres: minimum ordinary entrance width where the kit permits.
  doorMax:1.8, // metres: maximum ordinary entrance width.
  doorHeight:1.85, // metres: entrance head height, clamped under eaves.
  recess:.48, // metres: opening depth behind wall face.
  sill:.8, // metres: side window height above floor.
  windowHeight:.8, // metres: ordinary side window opening height.
  lattice:.16, // metres: vertical lattice spacing.
  verandaHeight:.45, // metres above datum: raised boarded veranda.
  verandaDepth:.9, // metres: projection of veranda.
  eave:.85, // metres: roof projection beyond body.
  boardRoof:.1, // metres vertically: plank roof thickness.
  thatchRoof:.45, // metres vertically: thick straw edge.
  thatchBevel:.12, // metres: inward bevel at the underside of the straw edge.
  storeRoofGap:.12, // metres: ventilated roof on a white storehouse.
  courses:5, // rows per plank roof slope (variant adds one).
  barkCourses:9, // rows per main-house bark roof slope (variant adds one).
  courseLift:.02, // metres: overlap height between roof courses.
  rafter:.1, // metres: square rafter section.
  rafterPitch:.45, // metres: rafter interval under roof.
  rafterCap:16, // rafters per slope: bounded tail density on unusually long private kit roofs.
  roofStones:10, // stones per slope on a plank roof.
  stoneRadius:.13, // metres: head-sized roof stone.
  yardChance:.3, // fraction: deterministic households with 1–2 small yard objects.
  paletteBlend:.92, // fraction: same palette/source blend as the existing part material.
  textureMeters:8, // metres: shared procedural atlas repeat.
  woodPhotoAcross:1.5, // multiplier of original 2m tile width: photographed boards read as 20–30cm.
  photoNormal:.9, // multiplier: original packed photograph tangent normals.
  photoNear:40, // metres: original photograph normal/full-detail fade begins.
  photoFar:120, // metres: photograph normals return to flat.
  plasterReflectance:.76, // linear luminance: warm lime under unit irradiance.
  plasterMin:.72, // linear luminance: lower clean-lime limit.
  plasterMax:.8, // linear luminance: upper clean-lime limit.
  plasterDirt:.26, // fraction: loss of reflectance on lower third of store walls.
  plasterDirtFraction:1/3, // wall-height fraction: dark weathered storehouse foot.
  soilDetail:.4, // multiplier: existing earth photograph relief and contrast.
  undersideTone:.55, // multiplier: physical roof undersides, independent of daylight.
  grain:.22, // fraction: near-surface grain contrast.
  footDirt:.12, // fraction: plaster dirt at ground contact.
  footDirtHeight:.6, // metres above floor: mud fade height.
  roofMoss:.10, // fraction: north-facing roof weathering.
  plasterAge:.3, // fraction: restrained ageing of white store walls.
  colorCap:.45, // linear channel maximum: same bound as the existing house material.
  brightness:.08, // fraction: existing instance seed, ±8% brightness.
  smallThatchShare:.75, // fraction: small houses using the thick straw variant.
  mansionRoofTone:.72, // multiplier: bark roof of the main house.
  timberTone:.65, // multiplier: exposed wood is darker than wall boards.
  edgeTone:.67, // multiplier: eave underside / end grain.
  recessTone:.16, // multiplier: dark brown interior behind openings.
  dirtTone:.72, // multiplier: wall foot/bare bamboo backing.
});
export function houseFamily(kind) {
  const name=typeof kind==='string'?kind:kind.node??kind.house_type??'';
  if(/塀|門|fence|gate|wall/i.test(name))return null;
  if(/町屋|machiya|townhouse/i.test(name))return 'town';
  if(/小家|cottage/i.test(name))return 'small';
  if(/蔵|storehouse|kura/i.test(name))return 'store';
  if(/屋敷|mansion/i.test(name))return 'mansion';
  if(/番屋|舟小屋|boathouse|guardhouse/i.test(name))return 'shed';
  return null;
}
function measureFrame(kind, positions, frontSign=1, surfaces=[]) {
  const body=houseBodyBounds(positions),eps=HOUSE2.epsilon;
  let top=-Infinity;for(let i=1;i<positions.length;i+=3)top=Math.max(top,positions[i]);
  const rmin=[Infinity,Infinity],rmax=[-Infinity,-Infinity],min=[Infinity,Infinity],max=[-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3){for(let k=0;k<2;k++){const v=positions[i+k*2];min[k]=Math.min(min[k],v);max[k]=Math.max(max[k],v);
    if(positions[i+1]>=top-eps){rmin[k]=Math.min(rmin[k],v);rmax[k]=Math.max(rmax[k],v);}}}
  // The ridge runs across the direction the roof slopes face. The highest vertices alone are not enough: a kit whose top is a small
  // cap or vent (shorter along the house than across) turned the whole roof ninety degrees, one huge plane over the long span.
  let slopeX=0,slopeZ=0;
  for(const {positions:p,indices} of surfaces)for(let i=0;i<(indices?.length??p.length/3);i+=3){
    const a=(indices?.[i]??i)*3,b=(indices?.[i+1]??i+1)*3,c=(indices?.[i+2]??i+2)*3;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
    if(len>0&&ny/len>HOUSE2.slopeMin&&ny/len<HOUSE2.slopeMax){slopeX+=Math.abs(nx);slopeZ+=Math.abs(nz);}
  }
  const byTop=rmax[0]-rmin[0]>rmax[1]-rmin[1];
  const alongX=slopeZ>slopeX*HOUSE2.slopeMargin?true:slopeX>slopeZ*HOUSE2.slopeMargin?false:byTop,u=alongX?0:2,v=alongX?2:0;
  // Use roof triangles when available; unindexed measurement falls back to the projecting roof ring.
  let eave=Infinity,floor=Infinity,roofArea=0;
  for(const {positions:p,indices} of surfaces)for(let i=0;i<(indices?.length??p.length/3);i+=3){
    const a=(indices?.[i]??i)*3,b=(indices?.[i+1]??i+1)*3,c=(indices?.[i+2]??i+2)*3;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
    // A small ridge cap is not the eave. Anchor the measurement on the largest sloping roof face.
    if(ny/len>eps&&ny/len<1-eps&&len>roofArea){roofArea=len;eave=Math.min(p[a+1],p[b+1],p[c+1]);}
  }
  for(let i=0;i<positions.length;i+=3){const y=positions[i+1];
    if(!surfaces.length&&(Math.abs(positions[i+v]-min[alongX?1:0])<eps||Math.abs(positions[i+v]-max[alongX?1:0])<eps)&&y>body.min[1]+eps)eave=Math.min(eave,y);
    if(y>body.min[1]+eps)floor=Math.min(floor,y);
  }
  if(!Number.isFinite(eave)){
    // Kits without projecting eaves: take the highest body ring below the ridge.
    for(let i=0;i<positions.length;i+=3)if(positions[i+1]<top-eps)eave=Number.isFinite(eave)?Math.max(eave,positions[i+1]):positions[i+1];
  }
  if(!(eave>body.min[1]&&top>eave))throw new Error('家の軒と棟を読み取れません');
  if(floor>=eave*HOUSE2.foundationRatio||floor<0)floor=Math.max(0,body.min[1]);
  const roofMin=min[alongX?1:0],roofMax=max[alongX?1:0],ridgeLo=rmin[alongX?0:1],ridgeHi=rmax[alongX?0:1];
  return {family:houseFamily(kind),wallKey:kind.wall?.key??null,roofKey:kind.roof?.key??null,body,width:body.max[0]-body.min[0],depth:body.max[2]-body.min[2],
    floor,base:floor-body.min[1],wallHeight:eave-floor,eave,top,alongX,u,v,
    u0:body.min[u],u1:body.max[u],v0:body.min[v],v1:body.max[v],ridgeLo,ridgeHi,
    hipped:ridgeLo>min[alongX?0:1]+eps&&ridgeHi<max[alongX?0:1]-eps,
    ridgeV:(rmin[alongX?1:0]+rmax[alongX?1:0])/2,
    overhang:Math.min(body.min[v]-roofMin,roofMax-body.max[v]),frontSign:frontSign<0?-1:1};
}
// Position welding is deliberately small and deterministic: catalogue kits have only a few hundred vertices.
const lex=(a,b)=>{for(let k=0;k<a.length;k++)if(a[k]!==b[k])return a[k]-b[k];return 0;};
function componentBounds(points) {
  const min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(const p of points)for(let k=0;k<3;k++){min[k]=Math.min(min[k],p[k]);max[k]=Math.max(max[k],p[k]);}
  return {min,max};
}
function triangleInfo(p) {
  const first=p.reduce((best,q,i)=>lex(q,p[best])<0?i:best,0);p=[p[first],p[(first+1)%3],p[(first+2)%3]];
  const a=p[0],b=p[1],c=p[2],u=b.map((v,k)=>v-a[k]),v=c.map((x,k)=>x-a[k]);
  const n=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...n);
  return {p,n,len,sloping:len>HOUSE2.epsilon&&Math.abs(n[1])/len>HOUSE2.epsilon&&Math.abs(n[1])/len<1-HOUSE2.epsilon};
}
export function houseVolumes(surfaces) {
  const points=[],raw=[];
  for(const {positions:p,indices} of surfaces)for(let i=0;i<(indices?.length??p.length/3);i+=3){
    const ids=[];for(let j=0;j<3;j++){const q=(indices?.[i+j]??i+j)*3;ids.push(points.length);points.push(Array.from(p.slice(q,q+3)));}raw.push(ids);
  }
  if(!points.length)return {components:[],volumes:[],towers:[],porches:[]};
  const order=points.map((_,i)=>i).sort((a,b)=>lex(points[a],points[b])),parent=points.map((_,i)=>i);
  const root=i=>{while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;};
  const join=(a,b)=>{a=root(a);b=root(b);if(a!==b)parent[Math.max(a,b)]=Math.min(a,b);};
  const welded=points.map((_,i)=>i);
  for(let a=0;a<order.length;a++)for(let b=a+1;b<order.length&&points[order[b]][0]-points[order[a]][0]<=HOUSE2.weld;b++){
    if(Math.hypot(...points[order[a]].map((v,k)=>v-points[order[b]][k]))<=HOUSE2.weld)join(order[a],order[b]);
  }
  // Keep connectivity and canonical welded positions separate from triangle topology.
  for(let i=0;i<points.length;i++)welded[i]=root(i);
  const representative=new Map();for(const i of order)if(!representative.has(welded[i]))representative.set(welded[i],points[i]);
  for(const ids of raw){join(ids[0],ids[1]);join(ids[0],ids[2]);}
  const groups=new Map();
  for(const ids of raw){const id=root(ids[0]);if(!groups.has(id))groups.set(id,[]);groups.get(id).push(triangleInfo(ids.map(i=>representative.get(welded[i]))));}
  const components=[...groups.values()].map(triangles=>{
    triangles.sort((a,b)=>lex(a.p.slice().sort(lex).flat(),b.p.slice().sort(lex).flat()));
    const points=triangles.flatMap(t=>t.p),bounds=componentBounds(points);
    return {...bounds,positions:points.flat(),triangles,slopeArea:triangles.reduce((s,t)=>s+(t.sloping?t.len/2:0),0),center:[(bounds.min[0]+bounds.max[0])/2,(bounds.min[2]+bounds.max[2])/2]};
  }).sort((a,b)=>lex([...a.min,...a.max],[...b.min,...b.max]));
  const bottom=Math.min(...components.map(c=>c.min[1])),volumes=[];
  for(const c of components)if(Math.abs(c.min[1]-bottom)<=HOUSE2.weld){
    const points=c.triangles.flatMap(t=>t.p).filter(p=>p[1]<=bottom+HOUSE2.weld),body=componentBounds(points);
    if(body.max[0]>body.min[0]&&body.max[2]>body.min[2])volumes.push({body,component:c,assigned:[],roof:null});
  }
  if(!volumes.length)return {components,volumes,towers:[],porches:[]};
  for(const c of components){if(volumes.some(v=>v.component===c))continue;
    const score=v=>{
      const b=v.body,inside=[0,2].every((k,i)=>c.center[i]>=b.min[k]-HOUSE2.assignMargin&&c.center[i]<=b.max[k]+HOUSE2.assignMargin);
      const overlap=[0,2].reduce((s,k)=>s*Math.max(0,Math.min(c.max[k],b.max[k])-Math.max(c.min[k],b.min[k])),1);
      const distance=Math.hypot(...[0,2].map((k,i)=>Math.max(b.min[k]-c.center[i],0,c.center[i]-b.max[k])));
      return [inside?0:1,inside?-overlap:distance];
    };
    const best=volumes.slice().sort((a,b)=>lex(score(a),score(b))||lex(a.body.min,b.body.min))[0];best.assigned.push(c);
  }
  const towers=[],porches=[];
  for(const [volume,v] of volumes.entries()){
    v.roof=v.assigned.filter(c=>c.slopeArea>HOUSE2.epsilon).sort((a,b)=>b.slopeArea-a.slopeArea||lex(a.min,b.min))[0]??null;
    if(!v.roof)continue;
    const high=v.assigned.filter(c=>c!==v.roof&&c.max[1]>v.roof.max[1]+HOUSE2.towerRise);
    for(const c of high.filter(c=>c.slopeArea<=HOUSE2.epsilon)){
      const roofs=high.filter(r=>r.slopeArea>HOUSE2.epsilon&&r.center.every((x,i)=>x>=c.min[i*2]-HOUSE2.weld&&x<=c.max[i*2]+HOUSE2.weld));
      if(roofs.length)towers.push({volume,min:c.min,max:c.max,roof:roofs[0],top:roofs[0].max[1]});
    }
    for(const c of v.assigned)if(c!==v.roof&&c.slopeArea>HOUSE2.epsilon&&!high.includes(c)&&c.max[1]<=v.roof.max[1]){
      const b=v.body,out=[0,2].map((k,i)=>c.center[i]<b.min[k]?c.center[i]-b.min[k]:c.center[i]>b.max[k]?c.center[i]-b.max[k]:0);
      if(!out.some(x=>x))continue;
      const axis=Math.abs(out[0])>Math.abs(out[1])?0:2,sign=Math.sign(out[axis/2]),along=axis===0?2:0;
      const slope=c.triangles.filter(t=>t.sloping).flatMap(t=>t.p),eave=Math.min(...slope.map(p=>p[1])),top=Math.max(...slope.map(p=>p[1]));
      porches.push({volume,face:(sign>0?'+':'-')+(axis===0?'x':'z'),min:c.min,max:c.max,width:c.max[along]-c.min[along],projection:c.max[axis]-c.min[axis],eave,top});
    }
  }
  const kept=volumes.filter(v=>v.roof),remap=items=>items.map(item=>({...item,volume:kept.indexOf(volumes[item.volume])})).filter(item=>item.volume>=0);
  return {components,volumes:kept,towers:remap(towers),porches:remap(porches)};
}
function faceName(axis,sign){return (sign>0?'+':'-')+(axis===0?'x':'z');}
function frameContacts(a,b,other) {
  const out=[];
  for(const axis of [0,2])for(const sign of [-1,1]){
    const edge=sign>0?a.body.max[axis]:a.body.min[axis],along=axis===0?2:0;
    const lo=Math.max(a.body.min[along],b.body.min[along]),hi=Math.min(a.body.max[along],b.body.max[along]);
    if(hi-lo<=HOUSE2.weld)continue;
    if(edge>=b.body.min[axis]-HOUSE2.weld&&edge<=b.body.max[axis]+HOUSE2.weld&&sign*((b.body.min[axis]+b.body.max[axis])/2-edge)>=-HOUSE2.weld)out.push({face:faceName(axis,sign),lo,hi,other});
  }
  return out;
}
export function houseFrame(kind,positions,unusedFront=1,surfaces=[]) {
  const parts=houseVolumes(surfaces);
  // Unindexed point-ring callers predate the connected surface API; keep their measurement route.
  if(!parts.volumes.length){const f=measureFrame(kind,positions,1,surfaces);return {...f,front:'+z',frontSign:1,volume:0,frontVolume:0,wings:[],towers:[],porches:[],contacts:[]};}
  const frames=parts.volumes.map(v=>{
    const p=[...v.component.positions,...v.roof.positions];
    const f=measureFrame(kind,p,1,[{positions:v.roof.positions}]);
    f.sourceRoof={min:v.roof.min.slice(),max:v.roof.max.slice()};
    return f;
  });
  const area=f=>f.width*f.depth;
  const main=frames.reduce((a,b)=>area(b)>area(a)?b:a),mainIndex=frames.indexOf(main);
  const zPorches=parts.porches.filter(p=>p.face.endsWith('z'));
  const front=zPorches.find(p=>p.volume===mainIndex)?.face??zPorches[0]?.face??'+z';
  const sign=front==='-z'?-1:1;
  const frontIndex=frames.reduce((best,f,i)=>sign*(sign>0?f.body.max[2]:f.body.min[2])>sign*(sign>0?frames[best].body.max[2]:frames[best].body.min[2])+HOUSE2.weld?i:best,mainIndex);
  for(const [i,f] of frames.entries()){
    f.volume=i;f.front=front;f.frontSign=sign;f.frontVolume=frontIndex;f.contacts=[];
    for(const [j,g] of frames.entries())if(i!==j)f.contacts.push(...frameContacts(f,g,j));
  }
  main.wings=frames.filter(f=>f!==main).map(f=>({...f,attachment:frameContacts(main,f,f.volume).map(c=>c.face)}));
  main.towers=parts.towers;main.porches=parts.porches;
  return main;
}
export function houseTriangleLimit(f) {
  return f.wings?.length?(f.family==='mansion'?5200:3000):f.towers?.length?2000:f.family==='mansion'?4000:f.family==='store'?1400:1800;
}
// Read actual roof top triangles, rather than echoing the input frame: catches the old single-roof regression.
export function houseSilhouette(input) {
  if(Array.isArray(input)){
    const v=houseVolumes(input);
    return {roofs:v.volumes.map((x,volume)=>{
      const f=measureFrame('',[...x.component.positions,...x.roof.positions],1,[{positions:x.roof.positions}]);
      return {volume,min:x.roof.min,max:x.roof.max,eave:f.eave,top:f.top,alongX:f.alongX,body:f.body};
    }),towers:v.towers.map(t=>({top:t.top}))};
  }
  const groups=new Map();
  for(const s of input.solids)if(s.label==='roof course'||s.label==='hip roof'){
    const id=s.volume??0;if(!groups.has(id))groups.set(id,[]);
    for(const vertex of s.topFaces)for(let j=0;j<9;j+=3)groups.get(id).push(Array.from(input.positions.slice(vertex*3+j,vertex*3+j+3)));
  }
  const frames=[input.frame,...(input.frame.wings??[])];
  return {roofs:[...groups].sort((a,b)=>a[0]-b[0]).map(([volume,p])=>{
    const b=componentBounds(p),f=frames.find(f=>f.volume===volume);
    // Ridge direction is measured from top triangles, not trusted from the frame.
    let x=0,z=0;for(let i=0;i<p.length;i+=3){const t=triangleInfo(p.slice(i,i+3));x+=Math.abs(t.n[0]);z+=Math.abs(t.n[2]);}
    return {volume,...b,eave:b.min[1],top:b.max[1],alongX:z>x,body:f.body};
  }),towers:input.solids.filter(s=>s.label==='tower roof').map(s=>{
    let top=-Infinity;for(let i=s.start*3+1;i<(s.start+s.count)*3;i+=3)top=Math.max(top,input.positions[i]);return {top};
  })};
}
export const house2Fade = d => d<=HOUSE2.full?1:d>=HOUSE2.swap?0:(HOUSE2.swap-d)/(HOUSE2.swap-HOUSE2.full);
export const house2Variant = (id,family) => houseIndexSeed(id)[1]<(family==='small'?HOUSE2.smallThatchShare:.5)?0:1;
export function house2Selection(items,pos,indices,distances,limit=HOUSE2.cap) {
  let count=0;const cap=Math.min(limit,indices.length),y=pos.y??0;
  for(let i=0;i<items.length;i++){
    const item=items[i];if(!item.house2Eligible)continue;
    const m=item.grounded,d=Math.hypot(m[12]-pos.x,m[13]-y,m[14]-pos.z);if(d>=HOUSE2.swap)continue;
    let at=Math.min(count,cap-1);if(count===cap&&d>=distances[at])continue;
    while(at>0&&d<distances[at-1]){if(at<cap){indices[at]=indices[at-1];distances[at]=distances[at-1];}at--;}
    indices[at]=i;distances[at]=d;if(count<cap)count++;
  }
  return count;
}
const surfaces={wood:0,roof:1,timber:2,recess:3,stone:4,plaster:5,earth:6};
// Each yield is a bounded facade/roof slope. View checks its clock between stages.
function* buildWingSteps(frame,variant,m,secondary=false) {
  const C=HOUSE2,f=frame,family=f.family;
  if(!family)throw new Error('対象外の家の系統です');
  const roofThatch=/thatch|茅/.test(f.roofKey??'')||(family==='small'&&!f.roofKey&&variant===0),grand=family==='mansion',store=family==='store',shed=family==='shed';
  const pw=grand?C.mansionPost:C.post,front=f.frontSign,uf=(f.u0+f.u1)/2;
  const p=(u,y,v)=>f.alongX?[u,y,v]:[v,y,u];
  function b(u0,y0,v0,u1,y1,v1,role,surface=role,tone=1,label='',exterior=null) {
    const a=p(u0,y0,v0),z=p(u1,y1,v1);box(m,a.map((x,k)=>Math.min(x,z[k])),a.map((x,k)=>Math.max(x,z[k])),role,surface,tone,label,exterior);
  }
  // Retain the original stone skirt and ground datum; exposed wall/stone stay inside the collision body.
  b(f.u0,f.body.min[1],f.v0,f.u1,f.floor,f.v1,5,surfaces.stone,1,'original foundation');
  yield;
  const walls=[{a:f.u0,b:f.u1,fixed:f.v1,sign:1,side:false},{a:f.u0,b:f.u1,fixed:f.v0,sign:-1,side:false},
    {a:f.v0,b:f.v1,fixed:f.u0,sign:-1,side:true},{a:f.v0,b:f.v1,fixed:f.u1,sign:1,side:true}];
  for(let face=0;face<walls.length;face++){
    const w=walls[face],worldFace=faceName(w.side?f.u:f.v,w.sign),contact=f.contacts?.some(c=>c.face===worldFace);
    const isFront=f.volume===f.frontVolume&&worldFace===f.front&&!contact,n=Math.max(2,Math.ceil((w.b-w.a)/C.postPitch));
    function wb(a,y0,c,y1,depth,t,role,surface=role,tone=1,label=''){
      const out=w.fixed-w.sign*depth,inside=out-w.sign*t;
      if(w.side)b(Math.min(out,inside),y0,a,Math.max(out,inside),y1,c,role,surface,tone,label,label==='waist boards'?p(w.sign,0,0):null);
      else b(a,y0,Math.min(out,inside),c,y1,Math.max(out,inside),role,surface,tone,label,label==='waist boards'?p(0,0,w.sign):null);
    }
    for(let j=w.side?1:0;j<=(w.side?n-1:n);j++){
      if(store&&j!==0&&j!==n)continue;
      const a=w.a+(w.b-w.a)*j/n,lo=Math.max(w.a,a-pw/2),hi=Math.min(w.b,a+pw/2);
      wb(lo,f.floor,hi,f.eave,0,pw,2,2,C.timberTone,'post');
      const s=(hi-lo)/2;const centre=(lo+hi)/2;const q=w.side?p(w.fixed-w.sign*pw/2,f.floor-C.post/2,centre):p(centre,f.floor-C.post/2,w.fixed-w.sign*pw/2);
      if(j===0||j===n)stone(m,...q,s,C.post/2,s,5,4,1,'post stone');
    }
    for(const y of [f.floor+C.post,f.eave-C.post])wb(w.a,y-C.post/2,w.b,y+C.post/2,0,pw,2,2,C.timberTone,'rail');
    if(!isFront&&!w.side&&!store)wb(w.a,f.floor+Math.min(C.waist,f.wallHeight*.4)-C.post/2,w.b,f.floor+Math.min(C.waist,f.wallHeight*.4)+C.post/2,0,pw,2,2,C.timberTone,'rail');
    const doorBay=Math.floor(n/2)-(variant%2),head=f.floor+Math.min(C.doorHeight,f.wallHeight*.8);
    for(let j=0;j<n;j++){
      const a=w.a+(w.b-w.a)*j/n+pw/2,c=w.a+(w.b-w.a)*(j+1)/n-pw/2;
      const door=isFront&&j===Math.max(0,doorBay),shutter=isFront&&!door&&(grand||family==='town')&&j%2===variant;
      const sideWindow=!contact&&!isFront&&w.side&&face===3&&j===Math.floor(n/2),openShed=shed&&isFront&&j<n-1;
      const win=sideWindow||shutter,opening=door||win||openShed;
      const plaster=store?5:f.wallKey==='plaster'?6:(family==='small'&&(j+variant+face)%3!==0?6:0),waist=store||((j+variant)%3===0&&plaster===6);
      const y0=f.floor,y1=f.eave-C.post/2;
      function panel(lo,hi,ya,yb){
        wb(lo,ya,hi,yb,C.postReveal,C.recess,0,plaster,1,'wall');
        if(store)wb(lo,ya,hi,Math.min(yb,f.floor+f.wallHeight*C.plasterDirtFraction),C.postReveal-C.batten,C.batten,0,2,C.timberTone,'waist boards');
        if(waist&&!store)wb(lo,ya,hi,Math.min(yb,f.floor+C.waist),C.postReveal-C.batten,C.batten,0,2,C.timberTone,'waist boards');
        if(plaster===0){/* Fine board joints are drawn by the shared procedural surface. */}        else if(!store&&variant===1&&j===0&&face===1){
          // Recessed bamboo backing visible in a small eroded patch, below the infill face.
          wb(lo,ya,Math.min(hi,lo+C.board*2),Math.min(yb,ya+C.waist),C.postReveal-C.batten/2,C.batten,0,2,C.dirtTone,'eroded plaster');
          for(let yy=ya+C.board/2;yy<Math.min(yb,ya+C.waist);yy+=C.board/2)wb(lo,yy,Math.min(hi,lo+C.board*2),yy+C.batten,C.postReveal-C.batten,C.batten,0,0,1,'bamboo');
        }
      }
      if(!opening){panel(a,c,y0,y1);continue;}
      const ow=door?Math.min(c-a,C.doorMax):sideWindow?Math.min(c-a,store?C.windowHeight:C.doorMin):c-a,lo=(a+c-ow)/2,hi=lo+ow;
      const bottom=win?f.floor+(store?f.wallHeight*.6:Math.min(C.sill,f.wallHeight*.3)):f.floor;
      const top=win?Math.min(y1-C.post,bottom+(store?C.windowHeight/2:C.windowHeight)):head;
      panel(a,lo,y0,y1);panel(hi,c,y0,y1);panel(lo,hi,top,y1);if(bottom>y0)panel(lo,hi,y0,bottom);
      // Back, reveals and floor: physically recessed, open at the front. No black decal over a solid wall.
      wb(lo,bottom,hi,top,C.recess,C.wall,3,3,C.recessTone,'opening back');
      // Deep wall panels form the side reveals of the opening.
      wb(lo,bottom-C.post,hi,bottom,C.postReveal,C.recess,3,0,C.edgeTone,'opening floor');
      wb(lo,top-C.post,hi,top,C.postReveal,C.recess,2,2,C.timberTone,'lintel');
      m.openings.push({face:worldFace,volume:f.volume,kind:door?'door':openShed?'shed':shutter?'shutter':'window',lo,hi,bottom,top,depth:C.recess});
      if(door&&!openShed){wb((lo+hi)/2,bottom,hi,top-C.post,C.postReveal+C.batten,C.wall,2,0,.85,'half open sliding door');}
      else if(shutter){wb(lo,bottom,hi,top-C.post,C.postReveal+C.batten,C.wall,2,0,.85,'closed shutter');}
      else if(sideWindow){for(let x=lo+C.lattice/2;x<hi;x+=C.lattice)wb(x-C.batten/2,bottom,x+C.batten/2,top,C.postReveal+C.post,C.post/2,2,2,C.timberTone,'lattice');
        if(store)wb(lo,bottom,(lo+hi)/2,top,C.postReveal,C.wall,2,0,.8,'window door');}
    }
    yield;
  }
  // The facade can be a gable end. Place its veranda in that wall's coordinates.
  if((family==='town'||grand)&&f.volume===f.frontVolume){
    const frontSide=f.front.endsWith('x')?f.u===0:f.u===2;
    const a=frontSide?f.v0:f.u0,c=frontSide?f.v1:f.u1;
    const fixed=frontSide?(front>0?f.u1:f.u0):(front>0?f.v1:f.v0);
    const y=Math.max(f.floor,C.verandaHeight),th=C.post;
    const fb=(lo,y0,near,hi,y1,far,role,surface,tone,label)=>frontSide?b(near,y0,lo,far,y1,hi,role,surface,tone,label):b(lo,y0,near,hi,y1,far,role,surface,tone,label);
    fb(a,y-th,fixed,c,y,fixed+front*C.verandaDepth,5,0,1,'veranda');
    for(let x=a+C.post;x<c;x+=C.postPitch)fb(x-C.post/2,0,fixed+front*C.verandaDepth/2-C.post/2,x+C.post/2,y-th,fixed+front*C.verandaDepth/2+C.post/2,5,2,.8,'veranda support');
    const mid=(a+c)/2,stair=fixed+front*C.verandaDepth;
    for(let i=0;i<(grand?3:1);i++)fb(mid-C.doorMin/2,0,stair,mid+C.doorMin/2,y*(grand?(3-i)/4:.4),stair+front*(i+1)*C.board,5,grand?0:4,1,'entrance step');
  }
  yield;
  // Source ridge orientation/hip topology is retained; the new eave adds only the specified projection.
  const extent=(axis,sign,edge)=>{
    if(f.contacts?.some(c=>c.face===faceName(axis,sign)))return edge;
    const original=f.sourceRoof?(sign>0?f.sourceRoof.max[axis]:f.sourceRoof.min[axis]):edge;
    return sign>0?Math.max(edge+C.eave,original):Math.min(edge-C.eave,original);
  };
  const eu0=extent(f.u,-1,f.u0),eu1=extent(f.u,1,f.u1),ev0=extent(f.v,-1,f.v0),ev1=extent(f.v,1,f.v1),vc=f.ridgeV??(f.v0+f.v1)/2;
  const touches=(axis,sign)=>f.contacts?.some(c=>c.face===faceName(axis,sign));
  const thick=roofThatch?C.thatchRoof:grand?C.boardRoof*2:C.boardRoof;
  const roofY=(u,v)=>{
    const across=1-Math.abs(v-vc)/(v<vc?vc-ev0:ev1-vc);
    const hip=f.hipped?Math.min(1,(u-eu0)/(f.ridgeLo-eu0),(eu1-u)/(eu1-f.ridgeHi)):1;
    return f.eave+(store?C.storeRoofGap:0)+(f.top-f.eave)*Math.max(0,Math.min(across,hip));
  };
  const rows=roofThatch?3:(grand?C.barkCourses:C.courses)+variant;
  // Match decorations and gable infill to the stepped surface, including the store roof gap.
  const roofLift=(u,v)=>roofThatch?0:Math.min(rows-1,Math.floor(Math.max(0,(roofY(u,v)-f.eave-(store?C.storeRoofGap:0))/(f.top-f.eave))*rows))*C.courseLift;
  // Close the triangular gable and the wall/eave shoulder; no daylight slit under the roof.
  const shoulder=Math.min(roofY(f.u0,f.v0)+roofLift(f.u0,f.v0),roofY(f.u1,f.v1)+roofLift(f.u1,f.v1))-thick-(store?C.storeRoofGap:0);
  if(shoulder>f.eave)b(f.u0,f.eave,f.v0,f.u1,shoulder,f.v1,0,store?5:family==='small'?6:0,.85,'eave infill');
  if(!f.hipped)for(const u of [f.u0,f.u1]){
    const inward=u===f.u0?C.wall:-C.wall;
    const outline=[[f.v0,shoulder],[f.v1,shoulder],[vc,roofY(u,vc)+roofLift(u,vc)-thick-(store?C.storeRoofGap:0)]];
    const points=[];for(const v of [u,u+inward])for(const [across,y] of outline)points.push(p(v,y,across));
    solid(m,points,[[0,1,2],[3,5,4],[0,3,4,1],[1,4,5,2],[2,5,3,0]],0,store?5:family==='small'?6:0,.85,'gable');
  }
  // Four roof planes in a hipped kit; two in a gabled kit.
  const ridge0=f.hipped?f.ridgeLo:eu0,ridge1=f.hipped?f.ridgeHi:eu1;
  const roofPlanes=[[[eu0,ev0],[eu1,ev0],[ridge1,vc],[ridge0,vc]],[[eu1,ev1],[eu0,ev1],[ridge0,vc],[ridge1,vc]]];
  if(f.hipped)roofPlanes.push([[eu0,ev1],[eu0,ev0],[ridge0,vc]],[[eu1,ev0],[eu1,ev1],[ridge1,vc]]);
  for(const plane of roofPlanes){
    for(let row=0;row<rows;row++){
      const t0=row/rows,t1=(row+1)/rows,edge0=plane[0],edge1=plane[1],r1=plane[2],r0=plane[3]??plane[2];
      const mix=(a,z,t)=>[a[0]+(z[0]-a[0])*t,a[1]+(z[1]-a[1])*t];
      const q=[mix(edge0,r0,t0),mix(edge1,r1,t0),mix(edge1,r1,t1),mix(edge0,r0,t1)];
      const pts=q.map(([u,v])=>p(u,roofY(u,v)+(roofThatch?0:row*C.courseLift),v));
      // Triangular tip uses a closed wedge rather than a degenerate quad.
      if(Math.hypot(q[2][0]-q[3][0],q[2][1]-q[3][1])<C.epsilon){
        const upper=pts.slice(0,3),lower=upper.map(a=>[a[0],a[1]-thick,a[2]]);
        solid(m,[...lower,...upper],[[0,1,2],[3,5,4],[0,3,4,1],[1,4,5,2],[2,5,3,0]],1,1,grand?C.mansionRoofTone:1,'hip roof');
      }else roofCourse(m,pts,thick,1,1,grand?C.mansionRoofTone:1,'roof course',roofThatch?C.thatchBevel:0);
    }
    const a=plane[0],z=plane[1];
    const edgeContact=(a[0]===z[0]&&touches(f.u,a[0]===eu0?-1:1))||(a[1]===z[1]&&touches(f.v,a[1]===ev0?-1:1));
    if(!edgeContact)beam(m,p(a[0],roofY(...a)-thick/2,a[1]),p(z[0],roofY(...z)-thick/2,z[1]),C.rafter,thick,4,1,C.edgeTone,'thick eave');
    yield;
  }
  // Rafter tails and barge boards are real closed beams, not a second luminous plane.
  const n=Math.min(secondary?C.rearRafters:C.rafterCap,Math.ceil((eu1-eu0)/C.rafterPitch));
  for(let i=0;i<=n;i++){
    const u=eu0+(eu1-eu0)*i/n;
    for(const v of [ev0,ev1]){
      if(touches(f.v,v<vc?-1:1))continue;
      const inner=v<vc?f.v0:f.v1;
      beam(m,p(u,roofY(u,v)-thick-C.rafter/2,v),p(u,roofY(u,inner)-thick-C.rafter/2,inner),C.rafter,C.rafter,4,2,C.edgeTone,'rafter');
    }
  }
  for(const u of [eu0,eu1])for(const v of [ev0,ev1])if(!touches(f.u,u===eu0?-1:1))beam(m,p(u,roofY(u,v)-thick/2,v),p(f.hipped?(u===eu0?ridge0:ridge1):u,roofY(f.hipped?(u===eu0?ridge0:ridge1):u,vc)+roofLift(f.hipped?(u===eu0?ridge0:ridge1):u,vc)-thick/2,vc),C.rafter,thick,4,2,C.edgeTone,'bargeboard');
  const ridgeY=roofY((ridge0+ridge1)/2,vc)+roofLift((ridge0+ridge1)/2,vc)+C.post/2;
  beam(m,p(ridge0,ridgeY,vc),p(ridge1,ridgeY,vc),roofThatch?C.post*3:C.board,C.post,1,roofThatch?2:1,.85,'ridge cap');
  yield;
  for(const sign of [-1,1]){
    const count=roofThatch?Math.max(1,Math.min(4,Math.ceil((ridge1-ridge0)/C.board))):secondary?C.rearStones:C.roofStones;
    for(let i=0;i<count;i++){
      const u=roofThatch?ridge0+(ridge1-ridge0)*(i+1)/(count+1):eu0+(eu1-eu0)*(i%5+1)/6,v=vc+sign*(ev1-vc)*(Math.floor(i/5)+1)/4;
      if(roofThatch&&sign>0)continue;
      if(roofThatch)beam(m,p(u,ridgeY+C.post/2,vc-C.post*2),p(u,ridgeY+C.post/2,vc+C.post*2),C.post/2,C.post/2,1,2,.85,'ridge bamboo');
      else stone(m,...p(u,roofY(u,v)+roofLift(u,v)+C.stoneRadius/2,v),C.stoneRadius,C.stoneRadius/2,C.stoneRadius,1,4,1,'roof stone');
    }
    if(!roofThatch)for(const t of [.3,.65]){const v=vc+sign*(ev1-vc)*t;
      beam(m,p(f.u0,roofY(f.u0,v)+roofLift(f.u0,v)+C.post/4,v),p(f.u1,roofY(f.u1,v)+roofLift(f.u1,v)+C.post/4,v),C.post,C.post/2,1,2,.8,'roof batten');}
  }
  yield;
  // Keep yard objects on the main body, away from its facade and wing contacts.
  if(!secondary){
    const yardFace=[0,1,2,3].find(face=>{const axis=face<2?f.v:f.u,sign=face===0||face===3?1:-1,name=faceName(axis,sign);return name!==f.front&&!f.contacts?.some(c=>c.face===name);});
    const side=yardFace>=2,sign=yardFace===0||yardFace===3?1:-1;
    const u=side?(sign>0?f.u1:f.u0)-sign*C.recess:uf-C.doorMin/4,v=side?(f.v0+f.v1)/2:(sign>0?f.v1:f.v0)-sign*C.recess,r=C.post*2;
    stone(m,...p(u,f.floor+r,v),r,r,r,6,0,1,'bucket');
    const yardPoint=(a,y,inset)=>side?p(u-sign*inset,y,v+a):p(u+a,y,v-sign*inset);
    if(family==='shed'||family==='small'){
      const h=Math.min(C.doorHeight,f.wallHeight*.7);
      for(const off of [-C.post,C.post])beam(m,yardPoint(off,f.floor,0),yardPoint(off,f.floor+h,C.post*2),C.post/2,C.post/2,6,2,.8,'ladder rail');
      for(let i=1;i<6;i++){const t=i/6;beam(m,yardPoint(-C.post,f.floor+h*t,C.post*2*t),yardPoint(C.post,f.floor+h*t,C.post*2*t),C.post/2,C.post/2,6,2,.8,'ladder rung');}
    }else beam(m,yardPoint(-C.board,f.floor+C.waist,0),yardPoint(C.board,f.floor+C.waist,0),C.batten,C.batten,6,2,1,'drying rope');
  }
  yield;
  return roofThatch;
}
export function* houseBuildSteps(frame,variant=0) {
  const m=houseParts(),frames=[frame,...(frame.wings??[])];let roofThatch=false;
  for(const [i,f] of frames.entries()){
    m.volume=f.volume??0;
    const thatch=yield* buildWingSteps(f,variant,m,i>0);if(i===0)roofThatch=thatch;
  }
  for(const porch of frame.porches??[]){m.volume=porch.volume;buildPorch(m,porch);yield;}
  for(const tower of frame.towers??[]){m.volume=tower.volume;buildTower(m,tower);yield;}
  return finishHouse(m,{...frame,roofThatch},variant);
}
function buildPorch(m,p) {
  const C=HOUSE2,axis=p.face.endsWith('x')?0:2,along=axis===0?2:0,sign=p.face[0]==='+'?1:-1;
  const inside=sign>0?p.min[axis]:p.max[axis],outside=sign>0?p.max[axis]:p.min[axis];
  const point=(a,y,d)=>axis===0?[d,y,a]:[a,y,d];
  const lo=p.min[along],hi=p.max[along];
  roofCourse(m,[point(lo,p.eave,outside),point(hi,p.eave,outside),point(hi,p.top,inside),point(lo,p.top,inside)],C.boardRoof,1,1,1,'porch roof');
  beam(m,point(lo,p.eave-C.boardRoof/2,outside),point(hi,p.eave-C.boardRoof/2,outside),C.rafter,C.boardRoof,4,2,C.edgeTone,'porch eave');
  for(const a of [lo,hi])beam(m,point(a,p.eave-C.boardRoof/2,outside),point(a,p.top-C.boardRoof/2,inside),C.rafter,C.boardRoof,4,2,C.edgeTone,'porch bargeboard');
  const n=Math.min(C.rearRafters,Math.max(1,Math.ceil(p.width/C.rafterPitch)));
  for(let i=0;i<=n;i++){const a=lo+(hi-lo)*i/n;beam(m,point(a,p.eave-C.boardRoof-C.rafter/2,outside),point(a,p.top-C.boardRoof-C.rafter/2,inside),C.rafter,C.rafter,4,2,C.edgeTone,'porch rafter');}
  for(let i=0;i<C.porchPosts;i++){
    const a=i===0?lo+C.post/2:hi-C.post/2,q=point(a,0,outside-sign*C.post/2);
    box(m,[q[0]-C.post/2,0,q[2]-C.post/2],[q[0]+C.post/2,p.eave-C.boardRoof,q[2]+C.post/2],2,2,C.timberTone,'porch post');
  }
}
function buildTower(m,t) {
  const C=HOUSE2,a=t.min,b=t.max,band=b[1]-(b[1]-a[1])*C.towerOpening;
  for(const x of [a[0],b[0]-C.post])for(const z of [a[2],b[2]-C.post])box(m,[x,a[1],z],[x+C.post,b[1],z+C.post],2,2,C.timberTone,'tower post');
  for(const z of [a[2],b[2]-C.wall])box(m,[a[0],a[1],z],[b[0],band,z+C.wall],0,0,1,'tower wall');
  for(const x of [a[0],b[0]-C.wall])box(m,[x,a[1],a[2]],[x+C.wall,band,b[2]],0,0,1,'tower wall');
  const r=t.roof,lo=r.min,hi=r.max;
  solid(m,[[lo[0],lo[1],lo[2]],[hi[0],lo[1],lo[2]],[hi[0],lo[1],hi[2]],[lo[0],lo[1],hi[2]],[(lo[0]+hi[0])/2,t.top,(lo[2]+hi[2])/2]],[[0,3,2,1],[0,1,4],[1,2,4],[2,3,4],[3,0,4]],1,1,1,'tower roof');
}
export function buildHouse(frame,variant=0) {const g=houseBuildSteps(frame,variant);let r;do{r=g.next();}while(!r.done);return r.value;}

// Same mean palette as the shader, for CPU previews and reflectance checks (not a lighting model).
export function house2SurfaceColor(surface,seed=.5,{source=P.wood,gain=1,tone=1,height=Infinity,wallHeight=1,up=1}={}) {
  const C=HOUSE2,keys=[['wood','oldWood'],['thatch','oldThatch'],['wood','oldWood'],['post','post'],['stone','oldStone'],['lime','oldLime'],['earth','oldEarth']],k=keys[surface];
  const age=surface===5?seed*C.plasterAge:seed;
  const target=P[k[0]].map((v,i)=>v*(1-age)+P[k[1]][i]*age),bright=1+(seed*2-1)*C.brightness;
  let color=target.map((v,i)=>(source[i]*(1-C.paletteBlend)+v*C.paletteBlend)*gain*bright);
  if(surface===5){const y=target.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);color=target.map(v=>v/y*Math.max(C.plasterMin,Math.min(C.plasterMax,C.plasterReflectance*bright)));}
  const t=Math.max(0,Math.min(1,height/(surface===5?wallHeight*C.plasterDirtFraction:C.footDirtHeight))),dirt=1-t*t*(3-2*t);
  const factor=tone*(surface===1&&up<=0?C.undersideTone:1)*(1-([5,6].includes(surface)?dirt*(surface===5?C.plasterDirt:C.footDirt):0));
  color=color.map(v=>v*factor);const cap=surface===5?1:C.colorCap,scale=Math.min(1,cap/Math.max(...color));return color.map(v=>v*scale);
}
