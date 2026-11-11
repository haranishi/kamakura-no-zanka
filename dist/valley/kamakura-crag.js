import { cliffColor } from './kamakura-ground-cliff.js';

// Metres unless noted. All visible tuning lives here; input limits are separate from appearance.
export const CRAG = Object.freeze({
  count: 16, points: 16, areaMin: 6, areaMax: 1500, areaTotal: 5000, coordinate: 1e6,
  cell: 1.9, step: 1.1, lift: .45, rise: 0, // m: authored defaults.
  stretchMin: 1.5, stretchMax: 2.6, acrossMin: .8, acrossMax: 1.25, jitter: .3, // spacing gains / displacement fraction.
  minArea: .25, clearance: .15, embed: .8, heightJitter: .12, // m² / m / m / layer fraction.
  bevelRatio: .12, bevelMin: .1, bevelMax: .3, insetLimit: .45, // cell fraction / m / m / inradius fraction.
  offsetMin: .03, offsetMax: .10, offsetShared: .6, miterLimit: .3, // m / m / common-sign share / m.
  bandVariation: .10, darkEveryMin: 3, darkEveryMax: 5, darkShade: .18, blockVariation: .06, // brightness / layers / layers / brightness / brightness.
  footHeight: 1.2, footShade: .25, seamWidth: .12, seamShade: .12, // m / darkening / edge fraction / darkening.
  soilRate: .65, soilHeight: 1.2, rockTopGain: 1.08, bevelGain: 1.10, // fraction / m / brightness / brightness.
  roughness: .96, metalness: 0, // MeshStandardMaterial coefficients.
  triangles: 36000, lightTriangles: 18000, scaleGrowth: 1.35, adaptScale: 1.3, // counts / counts / gains.
  far: 1400, farLight: 1000, adaptDistance: .18, // m / m / distance reduction per step (450m remains visible at step 3).
  maxSites: 2200, maxRows: 2400, attempts: 32, epsilon: 1e-8, // bounded preparation / numerical tolerance.
  debug: Object.freeze({ rock: Object.freeze([0,1,1]), soil: Object.freeze([0,1,0]), bevel: Object.freeze([1,1,0]), wall: Object.freeze([1,0,1]) }),
});
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
    for(const [key,lo,hi,fallback] of [['cell_m',1,4,C.cell],['step_m',.4,2,C.step],['grain_deg',0,180,grain],['lift_m',0,1.5,C.lift],['rise_m',0,10,C.rise]]) {
      const v=r[key]===undefined?fallback:r[key];if(!finite(v,lo,hi))fail();result[key]=v;
    }
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
function prepareCrag(r,terrain,scale,work) {
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
    const rock=cliffColor(source,{x:p[0],y:ground[0],z:-p[1]},{x:1,y:0,z:0},{fine:0});
    return {...cell,index,id:r.id,phase,step:r.step_m,top,base:gMin-C.embed,gMin,gMax,rise,soil:false,source,rock,
      tone:1+(cragHash(r.id,p[0]+107,p[1])*2-1)*C.blockVariation};
  });
  // Deterministic stratified selection keeps the soil proportion stable, including small outcrops.
  const eligible=blocks.filter(b=>b.top-b.gMax<=C.soilHeight).sort((a,b)=>cragHash(r.id,...a.point)-cragHash(r.id,...b.point));
  for(let i=0;i<Math.round(eligible.length*C.soilRate);i++)eligible[i].soil=true;
  return {id:r.id,blocks,phase,step:r.step_m,cell:r.cell_m*scale};
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
// One non-shared normal per triangle; the only GPU attributes are position, normal and colour.
function geometryFor(plans,light,debug,budget,work) {
  const positions=[],normals=[],colors=[],faces=[],ranges=[];let overflow=false,tallest=0;
  function tri(a,b,c,colorA,colorB,colorC,expected,kind,block,edge=-1,layer=null) {
    if(overflow)return;
    // Validate the actual uploaded coordinates, including Float32 rounding far from the origin.
    a=a.map(Math.fround);b=b.map(Math.fround);c=c.map(Math.fround);
    let ab=b.map((v,i)=>v-a[i]),ac=c.map((v,i)=>v-a[i]);
    let n=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]],len=Math.hypot(...n);
    if(len<=C.epsilon)return;
    if(n.reduce((sum,v,i)=>sum+v*expected[i],0)<0){[b,c]=[c,b];[colorB,colorC]=[colorC,colorB];n=n.map(v=>-v);}
    positions.push(...a,...b,...c);for(let j=0;j<3;j++)normals.push(...n.map(v=>v/len));colors.push(...colorA,...colorB,...colorC);
    faces.push({kind,id:block.id,block:block.index,edge,layer});work.triangles++;
    if(faces.length>budget)overflow=true;
  }
  const pos=(p,y)=>[p[0],y,-p[1]];
  function tint(b,kind,gain=1) {return debug?C.debug[kind]: (kind==='soil'?b.source:b.rock).map(v=>v*gain);}
  function quad(a,b,c,d,ca,cb,cc,cd,n,kind,block,edge=-1,layer=null) {tri(a,b,c,ca,cb,cc,n,kind,block,edge,layer);tri(a,c,d,ca,cc,cd,n,kind,block,edge,layer);}
  for(const plan of plans) {
    const start=positions.length/3;
    for(const b of plan.blocks) {
      const poly=b.polygon,ps=planes(poly),bevel=light?0:Math.min(clamp(plan.cell*C.bevelRatio,C.bevelMin,C.bevelMax),inradius(poly,ps)*C.insetLimit);
      const inner=bevel?offsetRing(poly,ps,-bevel):poly,kind=b.soil?'soil':'rock',color=tint(b,kind,b.soil?1:C.rockTopGain*b.tone);
      for(let j=1;j<inner.length-1;j++)tri(pos(inner[0],b.top),pos(inner[j],b.top),pos(inner[j+1],b.top),color,color,color,[0,1,0],kind,b);
      for(let e=0;e<poly.length;e++) {
        const j=(e+1)%poly.length,a=poly[e],d=poly[j],n=[ps[e].nx,0,-ps[e].ny];
        if(bevel){const col=tint(b,'bevel',C.bevelGain*b.tone);quad(pos(a,b.top-bevel),pos(d,b.top-bevel),pos(inner[j],b.top),pos(inner[e],b.top),col,col,col,col,[0,1,0],'bevel',b,e);}
        const neighbor=b.neighbors[e],bottom=neighbor<0?b.base:Math.max(b.base,plan.blocks[neighbor].top),top=b.top-bevel;
        if(bottom>=top-C.epsilon)continue;
        tallest=Math.max(tallest,b.top-bottom);
        const cuts=[bottom],span=plan.step*(light?2:1);
        for(let h=b.phase+Math.ceil((bottom-b.phase+C.epsilon)/span)*span;h<top-C.epsilon;h+=span){cuts.push(h);if(cuts.length>budget){overflow=true;break;}}
        if(overflow)break;
        // Include the lower darkening limit even when it falls inside one bed.
        if(bottom+C.footHeight<top)cuts.push(bottom+C.footHeight);
        cuts.push(top);cuts.sort((a,b)=>a-b);
        let previous=poly,previousHeight=bottom,previousOffset=0;
        for(let k=1;k<cuts.length;k++) {
          const lo=cuts[k-1],hi=cuts[k];if(hi-lo<C.epsilon)continue;
          const layer=Math.floor(((lo+hi)/2-b.phase)/plan.step),offset=cragOffset(plan.id,b.index,light?Math.floor(layer/2)*2:layer),ring=offsetRing(poly,ps,offset);
          const A=ring[e],B=ring[j],tone=cragLayerTone(plan.id,layer)*b.tone;
          // Horizontal bridges seal the changes of bed offset, including the foot and bevel rim.
          const bridge=tint(b,'wall',tone);
          quad(pos(previous[e],previousHeight),pos(previous[j],previousHeight),pos(B,lo),pos(A,lo),bridge,bridge,bridge,bridge,[0,previousOffset-offset,0],'ledge',b,e,layer);
          const stops=[0,C.seamWidth,1-C.seamWidth,1];
          const shade=(t,y)=>tint(b,'wall',tone*(1-C.footShade*(1-clamp((y-bottom)/C.footHeight,0,1)))*(t===0||t===1?1-C.seamShade:1));
          for(let s=1;s<stops.length;s++) {
            const u=stops[s-1],v=stops[s],p=[A[0]+(B[0]-A[0])*u,A[1]+(B[1]-A[1])*u],q=[A[0]+(B[0]-A[0])*v,A[1]+(B[1]-A[1])*v];
            quad(pos(p,lo),pos(q,lo),pos(q,hi),pos(p,hi),shade(u,lo),shade(v,lo),shade(v,hi),shade(u,hi),n,'wall',b,e,layer);
          }
          previous=ring;previousHeight=hi;previousOffset=offset;
        }
        const col=tint(b,'wall',b.tone);quad(pos(previous[e],top),pos(previous[j],top),pos(d,top),pos(a,top),col,col,col,col,[0,previousOffset,0],'ledge',b,e);
      }
      if(overflow)break;
    }
    ranges.push({id:plan.id,start,count:positions.length/3-start,blocks:plan.blocks.length});if(overflow)break;
  }
  return {positions:Float32Array.from(positions),normals:Float32Array.from(normals),colors:Float32Array.from(colors),faces,ranges,overflow,tallest};
}
export function buildCrags(items,terrain,{quality='standard',step=0,debug=false,minimumScale=1}={}) {
  const crags=decodeCrags(items),light=quality==='light',budget=light?C.lightTriangles:C.triangles;
  const work={candidates:0,sitePasses:0,bisectors:0,clips:0,heightTests:0,triangles:0,attempts:0};
  let scale=Math.max(minimumScale,C.adaptScale**clamp(step,0,3));
  for(let attempt=0;attempt<C.attempts;attempt++,scale*=C.scaleGrowth) {
    work.attempts++;const plans=[];
    for(const r of crags){const p=prepareCrag(r,terrain,scale,work);if(!p)break;plans.push(p);}
    if(plans.length!==crags.length)continue;
    const geometry=geometryFor(plans,light,debug,budget,work);if(geometry.overflow)continue;
    return {...geometry,plans,scale,work,blocks:plans.reduce((n,p)=>n+p.blocks.length,0),triangles:geometry.positions.length/9,draws:plans.length?1:0};
  }
  throw new Error('岩の形状を描画予算に収められません');
}
