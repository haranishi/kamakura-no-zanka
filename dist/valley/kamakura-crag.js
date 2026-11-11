import { cliffColor } from './kamakura-ground-cliff.js';

// Metres unless noted. All visible tuning lives here; input limits are separate from appearance.
export const CRAG = Object.freeze({
  count: 16, points: 16, areaMin: 6, areaMax: 1500, areaTotal: 5000, coordinate: 1e6,
  dip: 9, leanMin: 3, leanMax: 9, faceSpread: 60, // degrees: bed default / inward wall lean / protected road half-angle.
  strongPeriodMin: 4, strongPeriodMax: 6, ledgeMin: .25, ledgeMax: .45, recessMin: .25, recessMax: .5, // layers / m: strong beds and their outward/inward reach.
  breakReserve: 2, // layers: room above terrain clearance before top breaks and edge erosion.
  topRate: .35, topDoubleRate: .08, edgeRate: .45, edgeSteps: 3, cornerSteps: 2, // fractions / counts: top breaks and contour lowering.
  sharedCornerLimit: .2, // edge-clearance fraction: keep shared corner motion from crossing a thin cell.
  offsetFade: .25, // m: strong beds taper to zero at shared cap junctions.
  cavityGain: .7, rimGain: 1.1, hueVariation: .04, // brightness / brightness / warm-cool rock tint fraction.
  cell: 1.9, step: 1.1, lift: .45, rise: 0, // m: authored defaults.
  stretchMin: 1.5, stretchMax: 2.6, acrossMin: .8, acrossMax: 1.25, jitter: .3, // spacing gains / displacement fraction.
  minArea: .25, clearance: .15, embed: .8, heightJitter: .12, // m² / m / m / layer fraction.
  bevelRatio: .2, bevelMin: .12, bevelMax: .5, insetLimit: .45, // cell fraction / m / m / inradius fraction.
  offsetMin: .04, offsetMax: .2, offsetShared: .6, miterLimit: .3, // m / m / common-sign share / m.
  bandVariation: .10, darkEveryMin: 3, darkEveryMax: 5, darkShade: .18, blockVariation: .06, // brightness / layers / layers / brightness / brightness.
  footHeight: 1.2, footShade: .25, seamWidth: .12, seamShade: .12, // m / darkening / edge fraction / darkening.
  soilRate: .65, soilHeight: 1.2, rockTopGain: 1.08, bevelGain: 1.10, // fraction / m / brightness / brightness.
  roughness: .96, metalness: 0, // MeshStandardMaterial coefficients.
  triangles: 36000, lightTriangles: 18000, scaleGrowth: 1.35, adaptScale: 1.3, // counts / counts / gains.
  far: 1400, farLight: 1000, adaptDistance: .18, // m / m / distance reduction per step (450m remains visible at step 3).
  maxSites: 2200, maxRows: 2400, attempts: 32, epsilon: 1e-8, // bounded preparation / numerical tolerance.
  debug: Object.freeze({ rock: Object.freeze([0,1,1]), soil: Object.freeze([0,1,0]), bevel: Object.freeze([1,1,0]), wall: Object.freeze([1,0,1]) }),
});
// Seen in a real browser: flat vertex colours read as pale concrete panels up close, and as lavender plastic at dusk. The rock is
// darker and greyer than the cliff colour it starts from, and its faces carry a world-anchored procedural surface: grain, the
// grooves between beds, and joints. Even beds with evenly spaced upright joints read as a masonry wall, so the beds differ in
// thickness, the grooves break off, most joints are left out and the rest lean. The same relief also bends the shading normal.
// No texture; one scalar attribute carries the bed-height correction.
export const CRAG_LOOK = Object.freeze({
  tone: .56, grey: .5, warm: Object.freeze([1.06, 1, .9]), // rock brightness against the cliff colour / share pulled to grey / that grey's tint.
  grain: Object.freeze([2.9, .8, .23]), grainLow: .78, grainHigh: 1.18, // 1/m: three grain sizes / darkest and brightest grain.
  bed: .5, bend: .7, bendScale: .13, uneven: .85, unevenGain: 1.25, // m: mean bed thickness, its wander, wander scale (1/m) / 1/m and beds: how fast and how far the thickness changes with height.
  groove: .08, grooveDark: .3, grooveGapScale: .45, grooveGapFrom: .28, grooveGapTo: .5, layerTone: .24, // groove share of a bed / darkening / 1/m and noise gates: where a groove breaks off / tone range between beds.
  joint: 2.3, jointWidth: .03, jointDark: .42, jointKeep: .62, jointJitter: .8, jointSlant: .5, // m: joint spacing / joint share of the spacing / darkening / share left out / spacings of wander / spacings of lean across one bed.
  relief: Object.freeze([.022, .04, .035]), bump: 1, // m: depth of grain, grooves and joints for the shading normal / gain.
  wallFrom: .55, wallTo: .85, fineFrom: .03, fineTo: .14, // |normal.y| over which wall detail gives way to the top / m per pixel over which thin lines fade.
});
const L=CRAG_LOOK, gl=n=>Number(n).toFixed(6);
export function cragRockTone(c) {
  const lum=.2126*c[0]+.7152*c[1]+.0722*c[2];
  return c.map((v,i)=>(v+(lum*L.warm[i]-v)*L.grey)*L.tone);
}
export const CRAG_VERTEX_PARS = `attribute float cragBed;
varying float vCragBed;
varying vec3 vCragWorld;
varying vec3 vCragNormal;`;
export const CRAG_VERTEX = `vCragBed=cragBed;
vCragWorld=(modelMatrix*vec4(transformed,1.0)).xyz;
vCragNormal=normalize(mat3(modelMatrix)*objectNormal);`;
export const CRAG_FRAGMENT_PARS = `varying float vCragBed;
varying vec3 vCragWorld;
varying vec3 vCragNormal;
float cragRelief=0.0;
float cragHash3(vec3 p){
  return fract(sin(dot(p,vec3(12.9898,37.719,78.233)))*43758.5453);
}
float cragNoise(vec3 p){
  vec3 i=floor(p);
  vec3 f=fract(p);
  f=f*f*(3.0-2.0*f);
  float a=mix(mix(cragHash3(i),cragHash3(i+vec3(1.0,0.0,0.0)),f.x),mix(cragHash3(i+vec3(0.0,1.0,0.0)),cragHash3(i+vec3(1.0,1.0,0.0)),f.x),f.y);
  float b=mix(mix(cragHash3(i+vec3(0.0,0.0,1.0)),cragHash3(i+vec3(1.0,0.0,1.0)),f.x),mix(cragHash3(i+vec3(0.0,1.0,1.0)),cragHash3(i+vec3(1.0,1.0,1.0)),f.x),f.y);
  return mix(a,b,f.z);
}
vec3 cragLook(vec3 base,vec3 p,vec3 n){
  float pixel=length(fwidth(p));
  float fine=1.0-smoothstep(${gl(L.fineFrom)},${gl(L.fineTo)},pixel);
  float wall=1.0-smoothstep(${gl(L.wallFrom)},${gl(L.wallTo)},abs(n.y));
  float grain=cragNoise(p*${gl(L.grain[0])})*0.5+cragNoise(p*${gl(L.grain[1])})*0.3+cragNoise(p*${gl(L.grain[2])})*0.2;
  float height=p.y-vCragBed+(cragNoise(vec3(p.xz*${gl(L.bendScale)},1.7))-0.5)*${gl(L.bend)};
  float layer=height/${gl(L.bed)}+(cragNoise(vec3(height*${gl(L.uneven)},5.3,2.1))-0.5)*${gl(L.unevenGain)};
  float bedPart=fract(layer);
  float groove=1.0-smoothstep(0.0,${gl(L.groove)},min(bedPart,1.0-bedPart));
  groove*=smoothstep(${gl(L.grooveGapFrom)},${gl(L.grooveGapTo)},cragNoise(p*${gl(L.grooveGapScale)}+11.0));
  float tone=cragHash3(vec3(floor(layer),3.1,7.7));
  vec2 along=normalize(vec2(-n.z,n.x)+vec2(0.0001,0.0));
  float span=dot(p.xz,along);
  float run=span/${gl(L.joint)}+tone*7.0+(cragNoise(vec3(span*0.31,floor(layer)*1.9,9.1))-0.5)*${gl(L.jointJitter)}+(tone-0.5)*${gl(L.jointSlant)}*bedPart;
  float runPart=fract(run);
  float joint=1.0-smoothstep(0.0,${gl(L.jointWidth)},min(runPart,1.0-runPart));
  joint*=step(${gl(L.jointKeep)},cragHash3(vec3(floor(run),floor(layer),1.3)));
  cragRelief=((grain-0.5)*${gl(L.relief[0])}-(groove*${gl(L.relief[1])}+joint*${gl(L.relief[2])})*wall)*fine;
  vec3 c=base*mix(${gl(L.grainLow)},${gl(L.grainHigh)},grain);
  c*=1.0+(tone-0.5)*${gl(L.layerTone)}*wall;
  c*=1.0-groove*${gl(L.grooveDark)}*wall*fine;
  c*=1.0-joint*${gl(L.jointDark)}*wall*fine;
  return c;
}
vec3 cragBump(vec3 surface,vec3 eye,float relief){
  vec3 alongX=dFdx(eye);
  vec3 alongY=dFdy(eye);
  vec3 r1=cross(alongY,surface);
  vec3 r2=cross(surface,alongX);
  float det=dot(alongX,r1);
  vec3 slope=sign(det)*(dFdx(relief)*r1+dFdy(relief)*r2);
  return normalize(abs(det)*surface-slope*${gl(L.bump)});
}`;
export const CRAG_FRAGMENT = `diffuseColor.rgb=cragLook(diffuseColor.rgb,vCragWorld,normalize(vCragNormal));`;
export const CRAG_NORMAL = `normal=cragBump(normal,-vViewPosition,cragRelief);`;
const C=CRAG, rad=Math.PI/180, clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const finite=(v,a,b)=>Number.isFinite(v)&&v>=a&&v<=b;
export function cragHash(id, a=0, b=0) {
  let h=2166136261;
  for(let i=0;i<id.length;i++)h=Math.imul(h^id.charCodeAt(i),16777619);
  h=Math.imul(h^(Math.round(a*1000)|0),16777619);h=Math.imul(h^(Math.round(b*1000)|0),16777619);
  h^=h>>>16;h=Math.imul(h,0x7feb352d);h^=h>>>15;h=Math.imul(h,0x846ca68b);return ((h^(h>>>16))>>>0)/4294967296;
}
export function cragArea(p) {
  // Local origin avoids cancellation for small invented polygons far from zero.
  const o=p[0];let sum=0;
  for(let i=1;i<p.length-1;i++)sum+=(p[i][0]-o[0])*(p[i+1][1]-o[1])-(p[i][1]-o[1])*(p[i+1][0]-o[0]);
  return sum/2;
}
export function decodeCrags(value, ids=new Set(), fail=()=>{throw new Error('岩の範囲・形式が不正です');}) {
  if(value===undefined)return [];
  if(!Array.isArray(value)||value.length>C.count)fail();
  let total=0;
  return value.map(r=>{
    if(!r||typeof r.id!=='string'||!r.id.length||ids.has(r.id)||!Array.isArray(r.xy_m)||r.xy_m.length<3||r.xy_m.length>C.points)fail();
    if(!r.xy_m.every(p=>Array.isArray(p)&&p.length===2&&p.every(v=>finite(v,-C.coordinate,C.coordinate))))fail();
    let poly=r.xy_m.map(p=>p.slice()),area=cragArea(poly);if(area<0){poly.reverse();area=-area;}
    if(!finite(area,C.areaMin,C.areaMax)||(total+=area)>C.areaTotal)fail();
    let longest=0,grain=0;
    for(let i=0;i<poly.length;i++) {
      const a=poly[i],b=poly[(i+1)%poly.length],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy);
      if(len<=C.epsilon)fail();
      if(len>longest){longest=len;grain=(Math.atan2(dx,dy)/rad+180)%180;}
      for(let j=0;j<poly.length;j++) {
        if(j!==i&&Math.hypot(poly[j][0]-a[0],poly[j][1]-a[1])<=C.epsilon)fail();
        if(dx*(poly[j][1]-a[1])-dy*(poly[j][0]-a[0]) < -C.epsilon*len)fail();
      }
    }
    const result={id:r.id,xy_m:poly,area};
    for(const [key,lo,hi,fallback] of [['cell_m',1,4,C.cell],['step_m',.4,2,C.step],['grain_deg',0,180,grain],['lift_m',0,1.5,C.lift],['rise_m',0,10,C.rise],['dip_deg',0,25,C.dip]]) {
      const v=r[key]===undefined?fallback:r[key];if(!finite(v,lo,hi))fail();result[key]=v;
    }
    for(const key of ['dip_to_deg','face_deg'])if(r[key]!==undefined){if(!finite(r[key],0,360))fail();result[key]=r[key];}
    ids.add(r.id);return result;
  });
}
export const cragEnabled=(search='')=>{const q=new URLSearchParams(search);return q.get('crag')!=='0'&&q.get('layers')!=='0'&&q.get('works')!=='0';};

// Vertex.incoming labels the edge ending at that vertex. Clipping preserves exact neighbour identities.
function clip(poly,nx,ny,k,label=-1) {
  const out=[];if(!poly.length)return out;
  let a=poly[poly.length-1],da=a[0]*nx+a[1]*ny-k;
  for(const b of poly) {
    const db=b[0]*nx+b[1]*ny-k,ina=da<=0,inb=db<=0;
    if(ina!==inb) {const t=da/(da-db),p=[a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t];p.incoming=ina?b.incoming:label;out.push(p);}
    if(inb){const p=b.slice();p.incoming=b.incoming;out.push(p);}
    a=b;da=db;
  }
  // Degenerate vertices at a bisector intersection do not define a shared edge.
  for(let i=out.length-1;i>=0&&out.length>1;i--){const a=out[i],b=out[(i+1)%out.length];if(Math.hypot(a[0]-b[0],a[1]-b[1])<C.epsilon)out.splice(i,1);}
  return out;
}
function planes(poly) {
  return poly.map((a,i)=>{const b=poly[(i+1)%poly.length],len=Math.hypot(b[0]-a[0],b[1]-a[1]);const nx=(b[1]-a[1])/len,ny=(a[0]-b[0])/len;return {nx,ny,k:nx*a[0]+ny*a[1]};});
}
const edgeDistance=(p,ps)=>Math.max(0,Math.min(...ps.map(e=>e.k-e.nx*p[0]-e.ny*p[1])));
function inset(poly,ps,width) {let p=poly;for(const e of ps)p=clip(p,e.nx,e.ny,e.k-width);return p;}
function inradius(poly,ps) {
  let lo=0,hi=Math.sqrt(Math.abs(cragArea(poly)));
  for(let i=0;i<32;i++){const mid=(lo+hi)/2,p=inset(poly,ps,mid);if(p.length>=3&&Math.abs(cragArea(p))>C.epsilon)lo=mid;else hi=mid;}
  return lo;
}
function sitesFor(r,scale,work) {
  const origin=r.xy_m[0],s=Math.sin(r.grain_deg*rad),c=Math.cos(r.grain_deg*rad);
  const toUV=p=>[(p[0]-origin[0])*s+(p[1]-origin[1])*c,-(p[0]-origin[0])*c+(p[1]-origin[1])*s];
  const poly=r.xy_m.map(toUV),ps=planes(poly),cell=r.cell_m*scale,points=[];
  const minU=Math.min(...poly.map(p=>p[0])),maxU=Math.max(...poly.map(p=>p[0])),minV=Math.min(...poly.map(p=>p[1])),maxV=Math.max(...poly.map(p=>p[1]));
  const vs=cell*(C.acrossMin+(C.acrossMax-C.acrossMin)*cragHash(r.id,7));
  if((maxV-minV)/vs>C.maxRows)return null;
  let candidates=0;
  for(let row=0,v=minV+vs/2;v<maxV;row++,v+=vs) {
    const us=cell*(C.stretchMin+(C.stretchMax-C.stretchMin)*cragHash(r.id,row,11));
    // Scan the row's jitter envelope, rather than a possibly enormous diagonal bounding box.
    let low=minU,high=maxU;
    for(const e of ps) {
      if(Math.abs(e.nx)<C.epsilon)continue;
      const k=e.k-e.ny*v+Math.abs(e.ny)*vs*C.jitter;
      if(e.nx>0)high=Math.min(high,k/e.nx);else low=Math.max(low,k/e.nx);
    }
    const start=Math.ceil((low-minU)/us-(row%2)/2);
    for(let col=start,u=minU+(col+(row%2)/2)*us;u<=high;col++,u+=us) {
      work.candidates++;if(++candidates>C.maxSites)return null;
      const a=u+(cragHash(r.id,row,col+31)*2-1)*C.jitter*us,b=v+(cragHash(r.id,row,col+53)*2-1)*C.jitter*vs;
      if(ps.every(e=>e.nx*a+e.ny*b<=e.k))points.push([a,b]);
    }
  }
  if(!points.length)points.push([poly.reduce((n,p)=>n+p[0],0)/poly.length,poly.reduce((n,p)=>n+p[1],0)/poly.length]);
  return {points,poly,toWorld:p=>[origin[0]+p[0]*s-p[1]*c,origin[1]+p[0]*c+p[1]*s]};
}
export function partitionCrag(r,scale=1,work={candidates:0,sitePasses:0,bisectors:0,clips:0}) {
  work.sitePasses++;const layout=sitesFor(r,scale,work);if(!layout)return null;
  let sites=layout.points;
  // Redistribute tiny edge slivers to their surviving neighbours, so the contour remains filled.
  for(;;) {
    const cells=sites.map((p,i)=>{
      let poly=layout.poly.map(v=>{const q=v.slice();q.incoming=-1;return q;});
      let radius=Infinity;
      for(let j=0;j<sites.length&&poly.length;j++)if(i!==j) {
        work.bisectors++;const b=sites[j],dx=b[0]-p[0],dy=b[1]-p[1],d=Math.hypot(dx,dy);
        if(d>2*radius)continue;
        // Work in coordinates relative to the site to avoid squared-coordinate cancellation.
        const nx=dx/d,ny=dy/d,k=(nx*(p[0]+b[0])+ny*(p[1]+b[1]))/2;
        work.clips++;poly=clip(poly,nx,ny,k,j);
        radius=0;for(const v of poly)radius=Math.max(radius,Math.hypot(v[0]-p[0],v[1]-p[1]));
      }
      return {point:layout.toWorld(p),polygon:poly.map(layout.toWorld),neighbors:poly.map((_,k)=>poly[(k+1)%poly.length].incoming),area:poly.length<3?0:cragArea(poly)};
    });
    const kept=sites.filter((_,i)=>cells[i].area>=C.minArea);
    if(kept.length===sites.length)return cells;
    if(!kept.length)throw new Error('岩の領域を割り付けられません');
    sites=kept;
  }
}
export function cragLayerTone(id,layer) {
  const period=C.darkEveryMin+Math.floor(cragHash(id,71)*(C.darkEveryMax-C.darkEveryMin+1));
  return ((layer%period+period)%period===0?1-C.darkShade:1+(cragHash(id,layer,73)*2-1)*C.bandVariation);
}
export function cragOffset(id,block,layer) {
  const shared=cragHash(id,layer,79)<.5?-1:1;
  const sign=cragHash(id,block,layer+83)<C.offsetShared?shared:(cragHash(id,block,layer+89)<.5?-1:1);
  return sign*(C.offsetMin+(C.offsetMax-C.offsetMin)*cragHash(id,block,layer+97));
}
function prepareCrag(r,terrain,scale,work,natural,light) {
  const cells=partitionCrag(r,scale,work);if(!cells)return null;
  const ps=planes(r.xy_m),radius=inradius(r.xy_m,ps),phase=cragHash(r.id,101)*r.step_m;
  const blocks=cells.map((cell,index)=>{
    const p=cell.point,ground=[];
    for(const v of [p,...cell.polygon]){const h=terrain.heightAt(v[0],-v[1]);work.heightTests++;if(!Number.isFinite(h))throw new Error('岩の地面の高さが読めません');ground.push(h);}
    const gMax=Math.max(...ground),gMin=Math.min(...ground),t=clamp(edgeDistance(p,ps)/radius,0,1),rise=r.rise_m*t*t*(3-2*t);
    const jitter=(cragHash(r.id,p[0],p[1])*2-1)*C.heightJitter*r.step_m;
    let top=phase+Math.ceil((ground[0]+r.lift_m+rise-phase)/r.step_m)*r.step_m+jitter;
    if(top<gMax+C.clearance)top+=Math.ceil((gMax+C.clearance-top)/r.step_m)*r.step_m;
    const source=terrain.groundColorAt(p[0],-p[1]);
    if(!source||source.length!==3||!source.every(Number.isFinite))throw new Error('岩の地面の色が読めません');
    const rock=cragRockTone(cliffColor(source,{x:p[0],y:ground[0],z:-p[1]},{x:1,y:0,z:0},{fine:0}));
    return {...cell,index,id:r.id,phase,step:r.step_m,top,base:gMin-C.embed,gMin,gMax,rise,soil:false,source,rock,
      tone:1+(cragHash(r.id,p[0]+107,p[1])*2-1)*C.blockVariation};
  });
  if(natural&&r.dip_deg>0)prepareNatural(r,blocks,terrain,work,r.cell_m*scale,light);
  // Deterministic stratified selection keeps the soil proportion stable, including small outcrops.
  const eligible=blocks.filter(b=>b.top-b.gMax<=C.soilHeight).sort((a,b)=>cragHash(r.id,...a.point)-cragHash(r.id,...b.point));
  for(let i=0;i<Math.round(eligible.length*C.soilRate);i++)eligible[i].soil=true;
  return {id:r.id,blocks,phase,step:r.step_m,cell:r.cell_m*scale,natural:natural&&r.dip_deg>0,
    dip:r.dip_deg,direction:r.dip_to_deg??((r.grain_deg+(cragHash(r.id,131)<.5?0:180))%360)};
}
// Strong beds repeat in a shared 4–6-bed cycle, independent of the block and of LOD.
export function cragStrong(id,layer) {
  const period=C.strongPeriodMin+Math.floor(cragHash(id,137)*(C.strongPeriodMax-C.strongPeriodMin+1));
  return ((layer%period+period)%period===0)?(cragHash(id,layer,139)<.5?1:-1):0;
}
export function cragNaturalOffset(id,layer) {
  const strong=cragStrong(id,layer),h=cragHash(id,layer,149);
  return strong>0?C.ledgeMin+(C.ledgeMax-C.ledgeMin)*h:strong<0?-(C.recessMin+(C.recessMax-C.recessMin)*h):cragOffset(id,0,layer);
}
const pick=(blocks,rate,id,salt)=>blocks.slice().sort((a,b)=>cragHash(id,a.index,salt)-cragHash(id,b.index,salt)).slice(0,Math.round(blocks.length*rate));
function prepareNatural(r,blocks,terrain,work,cell,light) {
  const direction=r.dip_to_deg??((r.grain_deg+(cragHash(r.id,131)<.5?0:180))%360),slope=Math.tan(r.dip_deg*rad);
  const bed={origin:r.xy_m[0],east:Math.sin(direction*rad)*slope,north:Math.cos(direction*rad)*slope};
  const delta=p=>(p[0]-bed.origin[0])*bed.east+(p[1]-bed.origin[1])*bed.north;
  for(const b of blocks) {
    b.bed=bed;b.legacyTop=b.top;b.topShift=0;b.edgeLower=0;b.corner=false;
    b.bevel=light?0:Math.min(clamp(cell*C.bevelRatio,C.bevelMin,C.bevelMax),inradius(b.polygon,planes(b.polygon))*C.insetLimit);
    b.lean=C.leanMin+(C.leanMax-C.leanMin)*cragHash(r.id,b.index,151);
    b.road=b.neighbors.some((n,e)=>n<0&&r.face_deg!==undefined&&Math.sin(r.face_deg*rad)*planes(b.polygon)[e].nx+Math.cos(r.face_deg*rad)*planes(b.polygon)[e].ny>=Math.cos(C.faceSpread*rad)-C.epsilon);
    b.boundary=b.neighbors.includes(-1);b.edgeEligible=b.boundary&&!b.road;
  }
  for(const b of pick(blocks,C.topRate,r.id,157))b.topShift=(cragHash(r.id,b.index,163)<.5?-1:1)*(cragHash(r.id,b.index,167)<C.topDoubleRate?2:1);
  for(const p of r.xy_m) {
    let closest=null,d=Infinity;
    for(const b of blocks){const v=Math.hypot(b.point[0]-p[0],b.point[1]-p[1]);if(v<d){d=v;closest=b;}}
    // The road edge is protected even where it meets a contour corner.
    if(closest&&!closest.road){closest.corner=true;closest.edgeLower=Math.max(C.cornerSteps+Math.max(0,closest.topShift),closest.edgeLower);}
  }
  const eligible=blocks.filter(b=>b.edgeEligible),remaining=eligible.filter(b=>!b.corner),needed=Math.max(0,Math.round(eligible.length*C.edgeRate)-eligible.filter(b=>b.corner).length);
  if(remaining.length)for(const b of pick(remaining,needed/remaining.length,r.id,173))b.edgeLower=1+Math.floor(cragHash(r.id,b.index,179)*C.edgeSteps);
  // Canonical shared corners: all incident cells use the same anchor, lean and offset direction.
  // A tall cell owns its corner. Short cells meet that exact position rather than pulling a seam apart.
  const vertices=[];
  for(const b of blocks)for(const p of b.polygon) {
    let v=vertices.find(v=>{work.cornerTests++;return Math.hypot(p[0]-v.point[0],p[1]-v.point[1])<C.epsilon;});
    if(!v){v={point:p.slice(),owner:b,anchor:b.base,blocks:[],boundary:false};vertices.push(v);}
    if(b.legacyTop>v.owner.legacyTop||(b.legacyTop===v.owner.legacyTop&&b.index<v.owner.index))v.owner=b;
    v.blocks.push(b);const e=b.polygon.indexOf(p);v.boundary ||= b.neighbors[e]<0||b.neighbors[(e+b.neighbors.length-1)%b.neighbors.length]<0;
    v.anchor=Math.min(v.anchor,b.base);p.corner=v;
  }
  for(const v of vertices) {
    const dx=v.owner.point[0]-v.point[0],dy=v.owner.point[1]-v.point[1],len=Math.hypot(dx,dy);
    v.dx=dx/len;v.dy=dy/len;v.slope=Math.tan(v.owner.lean*rad);v.limit=len*C.insetLimit;
    for(const b of v.blocks)for(let e=0;e<b.polygon.length;e++) {
      const a=b.polygon[e],d=b.polygon[(e+1)%b.polygon.length];
      if(a.corner===v||d.corner===v){v.limit=Math.min(v.limit,Math.hypot(d[0]-a[0],d[1]-a[1])*C.sharedCornerLimit);continue;}
      const ex=d[0]-a[0],ey=d[1]-a[1],t=clamp(((v.point[0]-a[0])*ex+(v.point[1]-a[1])*ey)/(ex*ex+ey*ey),0,1);
      v.limit=Math.min(v.limit,Math.hypot(v.point[0]-a[0]-ex*t,v.point[1]-a[1]-ey*t)*C.sharedCornerLimit);
    }
    if(!v.boundary)v.anchor=Math.min(...v.blocks.map(b=>b.legacyTop))-C.embed;
    v.anchor-=delta(v.point); // wall heights below are bed coordinates.
  }
  for(const b of blocks) {
    const jitter=(cragHash(r.id,...b.point)*2-1)*C.heightJitter*r.step_m;
    const nominal=b.phase+Math.ceil((terrain.heightAt(b.point[0],-b.point[1])-delta(b.point)+r.lift_m+b.rise-b.phase)/r.step_m)*r.step_m+jitter;
    work.heightTests++;
    const minimum=Math.max(...[b.point,...b.polygon].map(p=>terrain.heightAt(p[0],-p[1])+C.clearance-delta(p)));work.heightTests+=b.polygon.length+1;
    const safe=nominal+Math.max(0,Math.ceil((minimum-nominal)/r.step_m))*r.step_m;
    b.nominalBedTop=safe+C.breakReserve*r.step_m;
    b.bedTop=b.nominalBedTop+(b.topShift-b.edgeLower)*r.step_m;
    if(b.bedTop<minimum)b.bedTop+=Math.ceil((minimum-b.bedTop)/r.step_m)*r.step_m;
    // Test the actual leaned cap too, since sampling only the original footprint can miss a hill.
    for(let attempt=0;attempt<C.attempts;attempt++) {
      let deficit=0;
      const cap=naturalRing(b.polygon,b.bedTop),inner=naturalInset(cap,b.bevel);
      for(const q of [...cap,...inner]) {
        const g=terrain.heightAt(q[0],-q[1]);work.heightTests++;
        if(!Number.isFinite(g))throw new Error('岩の地面の高さが読めません');
        deficit=Math.max(deficit,g+C.clearance-delta(q)-b.bedTop);
      }
      if(deficit<=C.epsilon)break;
      b.bedTop+=Math.ceil(deficit/r.step_m)*r.step_m;
      if(attempt===C.attempts-1)throw new Error('傾いた岩の頂を地形の上に置けません');
    }
    b.top=b.bedTop+delta(b.point);b.bedBase=b.base-Math.max(...b.polygon.map(delta));
    b.lowered=b.bedTop<b.nominalBedTop-C.epsilon;
    const hue=(cragHash(r.id,b.index,181)*2-1)*C.hueVariation;
    b.rock=b.rock.map((v,i)=>v*(1+(i===0?hue:i===2?-hue:0)));
  }
}
// This shared corner transform is also used by both sides of a seam and by their bevel rims.
export function naturalPoint(p,height,offset=0) {
  const v=p.corner;if(!v)return p;
  const movement=h=>{
    let fade=1;if(v.heights)for(const rim of v.heights)fade=Math.min(fade,Math.abs(h-rim)/C.offsetFade);
    return clamp(Math.min(v.limit,Math.max(0,h-v.anchor)*v.slope)-offset*fade,-v.limit,v.limit);
  };
  let move=movement(height);
  if(v.knots) {
    // Every incident edge samples this same piecewise-linear corner curve. An extra colour/foot cut
    // on just one edge must not introduce a different kink and open a triangular seam.
    let lo=v.phase+Math.floor((height-v.phase)/v.span)*v.span,hi=lo+v.span;
    for(const h of v.knots){if(h<=height&&h>lo)lo=h;if(h>=height&&h<hi)hi=h;}
    move=hi-lo>C.epsilon?movement(lo)+(movement(hi)-movement(lo))*(height-lo)/(hi-lo):movement(height);
  }
  const q=[p[0]+v.dx*move,p[1]+v.dy*move];q.corner=v;return q;
}
function naturalRing(poly,height,offset=0) {return poly.map(p=>naturalPoint(p,height,offset));}
function naturalInset(poly,width) {
  if(!width)return poly;
  const center=[poly.reduce((s,p)=>s+p[0],0)/poly.length,poly.reduce((s,p)=>s+p[1],0)/poly.length];
  const radius=Math.min(...poly.map(p=>Math.hypot(p[0]-center[0],p[1]-center[1]))),ratio=Math.min(C.insetLimit,width/radius);
  return poly.map(p=>[p[0]+(center[0]-p[0])*ratio,p[1]+(center[1]-p[1])*ratio]);
}
// Shared corners can make a cap concave. Ears retain its actual outline; a convex fan would cover a neighbour.
function capTriangles(poly) {
  const ids=poly.map((_,i)=>i),out=[],cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  while(ids.length>3) {
    let found=false;
    for(let i=0;i<ids.length;i++) {
      const a=ids[(i+ids.length-1)%ids.length],b=ids[i],c=ids[(i+1)%ids.length];
      if(cross(poly[a],poly[b],poly[c])<=C.epsilon)continue;
      if(ids.some(j=>j!==a&&j!==b&&j!==c&&cross(poly[a],poly[b],poly[j])>=-C.epsilon&&cross(poly[b],poly[c],poly[j])>=-C.epsilon&&cross(poly[c],poly[a],poly[j])>=-C.epsilon))continue;
      out.push([a,b,c]);ids.splice(i,1);found=true;break;
    }
    if(!found)throw new Error('岩の頂の輪郭が交差しています');
  }
  if(ids.length===3){if(cross(...ids.map(i=>poly[i]))<=C.epsilon)throw new Error('岩の頂の輪郭が交差しています');out.push(ids);}return out;
}
function offsetRing(poly,ps,amount) {
  return poly.map((p,i)=>{
    const a=ps[(i+ps.length-1)%ps.length],b=ps[i],den=a.nx*b.ny-a.ny*b.nx;
    if(Math.abs(den)<C.epsilon)return [p[0]+b.nx*amount,p[1]+b.ny*amount];
    let dx=amount*(b.ny-a.ny)/den,dy=amount*(a.nx-b.nx)/den;
    const length=Math.hypot(dx,dy);if(length>C.miterLimit){dx*=C.miterLimit/length;dy*=C.miterLimit/length;}
    return [p[0]+dx,p[1]+dy];
  });
}
// Flat triangle normals; position, normal, colour and one scalar bed correction are the four GPU attributes.
function geometryFor(plans,light,debug,budget,work) {
  const positions=[],normals=[],colors=[],beds=[],faces=[],ranges=[];let overflow=false,tallest=0,activePlan=null;
  const strongBeds=new Set();
  function tri(a,b,c,colorA,colorB,colorC,expected,kind,block,edge=-1,layer=null) {
    if(overflow)return;
    // Validate the actual uploaded coordinates, including Float32 rounding far from the origin.
    a=a.map(Math.fround);b=b.map(Math.fround);c=c.map(Math.fround);
    let ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    let n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],len=Math.hypot(...n);
    if(len<=C.epsilon)return;
    if(n.reduce((sum,v,i)=>sum+v*expected[i],0)<0){[b,c]=[c,b];[colorB,colorC]=[colorC,colorB];n=n.map(v=>-v);}
    for(const v of [a,b,c]){const bed=block.bed;beds.push(bed?(v[0]-bed.origin[0])*bed.east+(-v[2]-bed.origin[1])*bed.north:0);}
    positions.push(...a,...b,...c);for(let j=0;j<3;j++)normals.push(...n.map(v=>v/len));colors.push(...colorA,...colorB,...colorC);
    faces.push({kind,id:block.id,block:block.index,edge,layer});work.triangles++;
    if(faces.length>budget)overflow=true;
  }
  const pos=(p,y)=>{const bed=activePlan?.blocks[0]?.bed;return [p[0],y+(bed?(p[0]-bed.origin[0])*bed.east+(p[1]-bed.origin[1])*bed.north:0),-p[1]];};
  function tint(b,kind,gain=1) {return debug?C.debug[kind]: (kind==='soil'?b.source:b.rock).map(v=>v*gain);}
  function quad(a,b,c,d,ca,cb,cc,cd,n,kind,block,edge=-1,layer=null) {tri(a,b,c,ca,cb,cc,n,kind,block,edge,layer);tri(a,c,d,ca,cc,cd,n,kind,block,edge,layer);}
  for(const plan of plans) {
    activePlan=plan;
    if(plan.natural) {
      const corners=new Set();for(const b of plan.blocks)for(const p of b.polygon)corners.add(p.corner);
      for(const v of corners){v.phase=plan.phase;v.span=plan.step*(light?2:1);v.heights=[];v.knots=[v.anchor,v.anchor+v.limit/v.slope];}
      for(const b of plan.blocks)for(const p of b.polygon) {
        const h=b.bedTop-b.bevel,v=p.corner;v.heights.push(h);v.knots.push(h-C.offsetFade,h,h+C.offsetFade);
      }
    }
    const start=positions.length/3,strongStart=strongBeds.size;
    for(const b of plan.blocks) {
      const poly=b.polygon,ps=planes(poly),bevel=plan.natural?b.bevel:light?0:Math.min(clamp(plan.cell*C.bevelRatio,C.bevelMin,C.bevelMax),inradius(poly,ps)*C.insetLimit);
      const topBed=plan.natural?b.bedTop:b.top,capPoly=plan.natural?naturalRing(poly,topBed):poly;
      const inner=plan.natural?naturalInset(capPoly,bevel):bevel?offsetRing(capPoly,planes(capPoly),-bevel):capPoly,kind=b.soil?'soil':'rock',color=tint(b,kind,b.soil?1:C.rockTopGain*b.tone);
      if(plan.natural){for(const [a,c,d] of capTriangles(inner))tri(pos(inner[a],topBed),pos(inner[c],topBed),pos(inner[d],topBed),color,color,color,[0,1,0],kind,b);}
      else for(let j=1;j<inner.length-1;j++)tri(pos(inner[0],topBed),pos(inner[j],topBed),pos(inner[j+1],topBed),color,color,color,[0,1,0],kind,b);
      for(let e=0;e<poly.length;e++) {
        const j=(e+1)%poly.length,a=poly[e],d=poly[j],n=[ps[e].nx,0,-ps[e].ny];
        const rim=plan.natural?naturalRing(poly,topBed-bevel):poly;
        if(bevel){const col=tint(b,'bevel',C.bevelGain*b.tone);quad(pos(rim[e],topBed-bevel),pos(rim[j],topBed-bevel),pos(inner[j],topBed),pos(inner[e],topBed),col,col,col,col,[0,1,0],'bevel',b,e);}
        const neighbor=b.neighbors[e],other=plan.blocks[neighbor],base=plan.natural?b.bedBase:b.base;
        const otherBevel=other&&!light?Math.min(clamp(plan.cell*C.bevelRatio,C.bevelMin,C.bevelMax),inradius(other.polygon,planes(other.polygon))*C.insetLimit):0;
        const bottom=neighbor<0?base:Math.max(base,plan.natural?other.bedTop-otherBevel:other.top),top=topBed-bevel;
        if(bottom>=top-C.epsilon)continue;
        tallest=Math.max(tallest,topBed-bottom);
        const cuts=[bottom],span=plan.step*(light?2:1);
        for(let h=b.phase+Math.ceil((bottom-b.phase+C.epsilon)/span)*span;h<top-C.epsilon;h+=span){cuts.push(h);if(cuts.length>budget){overflow=true;break;}}
        if(overflow)break;
        // Include the lower darkening limit even when it falls inside one bed.
        if(bottom+C.footHeight<top)cuts.push(bottom+C.footHeight);
        if(plan.natural)for(const p of [a,d])for(const h of p.corner.knots)if(h>bottom+C.epsilon&&h<top-C.epsilon)cuts.push(h);
        cuts.push(top);cuts.sort((a,b)=>a-b);
        let previous=plan.natural?naturalRing(poly,bottom):poly,previousHeight=bottom,previousOffset=0,lastLayer=null;
        for(let k=1;k<cuts.length;k++) {
          const lo=cuts[k-1],hi=cuts[k];if(hi-lo<C.epsilon)continue;
          const layer=Math.floor(((lo+hi)/2-b.phase)/plan.step),bedLayer=light?Math.floor(layer/2)*2:layer;
          const offset=plan.natural?cragNaturalOffset(plan.id,bedLayer):cragOffset(plan.id,b.index,bedLayer);
          const ring=plan.natural?naturalRing(poly,lo,offset):offsetRing(poly,ps,offset),upper=plan.natural?naturalRing(poly,hi,offset):ring;
          const strong=plan.natural?cragStrong(plan.id,bedLayer):0;if(strong)strongBeds.add(plan.id+':'+bedLayer);
          const A=ring[e],B=ring[j],tone=cragLayerTone(plan.id,layer)*b.tone;
          // Horizontal bridges seal the changes of bed offset, including the foot and bevel rim.
          const bridge=tint(b,'wall',tone*(plan.natural?(previousOffset<offset?C.cavityGain:C.rimGain):1));
          if(!(plan.natural&&light&&previousOffset<offset))quad(pos(previous[e],previousHeight),pos(previous[j],previousHeight),pos(B,lo),pos(A,lo),bridge,bridge,bridge,bridge,[0,previousOffset-offset,0],'ledge',b,e,layer);
          const stops=[0,C.seamWidth,1-C.seamWidth,1];
          const shade=(t,y)=>tint(b,'wall',tone*(plan.natural&&strong<0?C.cavityGain:1)*(1-C.footShade*(1-clamp((y-bottom)/C.footHeight,0,1)))*(t===0||t===1?1-C.seamShade:1));
          for(let s=1;s<stops.length;s++) {
            const u=stops[s-1],v=stops[s],p=[A[0]+(B[0]-A[0])*u,A[1]+(B[1]-A[1])*u],q=[A[0]+(B[0]-A[0])*v,A[1]+(B[1]-A[1])*v];
            const P=plan.natural?[upper[e][0]+(upper[j][0]-upper[e][0])*u,upper[e][1]+(upper[j][1]-upper[e][1])*u]:p,Q=plan.natural?[upper[e][0]+(upper[j][0]-upper[e][0])*v,upper[e][1]+(upper[j][1]-upper[e][1])*v]:q;
            quad(pos(p,lo),pos(q,lo),pos(Q,hi),pos(P,hi),shade(u,lo),shade(v,lo),shade(v,hi),shade(u,hi),n,'wall',b,e,layer);
          }
          previous=upper;previousHeight=hi;previousOffset=offset;lastLayer=layer;
        }
        const col=tint(b,'wall',b.tone*(plan.natural?cragLayerTone(plan.id,lastLayer)*(previousOffset>0?C.rimGain:C.cavityGain):1));quad(pos(previous[e],top),pos(previous[j],top),pos(rim[j],top),pos(rim[e],top),col,col,col,col,[0,previousOffset,0],'ledge',b,e,plan.natural?lastLayer:null);
      }
      if(overflow)break;
    }
    ranges.push({id:plan.id,start,count:positions.length/3-start,blocks:plan.blocks.length,strong:strongBeds.size-strongStart,lowered:plan.blocks.filter(b=>b.lowered).length});if(overflow)break;
  }
  return {positions:Float32Array.from(positions),normals:Float32Array.from(normals),colors:Float32Array.from(colors),beds:Float32Array.from(beds),faces,ranges,overflow,tallest,strong:strongBeds.size};
}
export function buildCrags(items,terrain,{quality='standard',step=0,debug=false,minimumScale=1,dip=true}={}) {
  const crags=decodeCrags(items),light=quality==='light',budget=light?C.lightTriangles:C.triangles;
  const work={candidates:0,sitePasses:0,bisectors:0,clips:0,heightTests:0,cornerTests:0,triangles:0,attempts:0};
  let scale=Math.max(minimumScale,C.adaptScale**clamp(step,0,3));
  for(let attempt=0;attempt<C.attempts;attempt++,scale*=C.scaleGrowth) {
    work.attempts++;const plans=[];
    for(const r of crags){const p=prepareCrag(r,terrain,scale,work,dip,light);if(!p)break;plans.push(p);}
    if(plans.length!==crags.length)continue;
    const geometry=geometryFor(plans,light,debug,budget,work);if(geometry.overflow)continue;
    return {...geometry,plans,scale,work,lowered:plans.reduce((n,p)=>n+p.blocks.filter(b=>b.lowered).length,0),blocks:plans.reduce((n,p)=>n+p.blocks.length,0),triangles:geometry.positions.length/9,draws:plans.length?1:0};
  }
  throw new Error('岩の形状を描画予算に収められません');
}
