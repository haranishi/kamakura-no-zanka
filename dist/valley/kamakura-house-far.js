// Pure far-house shapes and chunk mask rules. Dimensions come only from loaded vertices.
import { houseIndexSeed, HOUSE_SURFACE } from './kamakura-house-texture.js';
export const HOUSE_FAR = Object.freeze({
  lightRange: 4000, // metres: far chunk limit in light quality.
  adaptRange: 2500, // metres: far chunk limit at adaptive step 3.
  brightness: .08, // fraction: deterministic per-house brightness variation, ±8%.
  colorNear: 800, // metres: begin matching the far brightness range.
  colorFar: 920, // metres: match before the far hysteresis boundary.
  batch: 32, // houses: maximum construction work in one update after presentation.
  sliceMs: 2, // milliseconds: construction time budget, checked after each house.
  maskBytes: 4096, // bytes: maximum single-channel chunk mask.
  triangles: 180000, // triangles: maximum combined geometry (one draw). Raised from 60,000 so that the town fill is not cut short: about 11,000 houses.
  epsilon: .0001, // metres: same-plane/ridge vertex tolerance.
  roofFallback: .28, // fraction: legacy mid roof depth, only for degenerate source triangles.
  midSink: 2.5, // metres: same skirt extension as the existing mid view.
  debugHouse: 0xff00ff, // sRGB: unlit houses in diagnostic mode.
  debugWall: 0xffff00 // sRGB: unlit walls/gates in diagnostic mode.
});
export const houseFarEnabled = search => new URLSearchParams(search).get('housefar') !== '0';
export const houseFarWall = name => /wall|fence|gate|nagayamon|hei|塀|門/i.test(name);
export function houseFarShape(positions, body, name = '', surfaces = []) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i=0;i<positions.length;i+=3) for(let k=0;k<3;k++) { min[k]=Math.min(min[k],positions[i+k]); max[k]=Math.max(max[k],positions[i+k]); }
  if (!min.every(Number.isFinite) || max.some((v,k)=>v<=min[k])) throw new Error('遠景の家の外形が不正です');
  const wall=houseFarWall(name), top=max[1], eps=HOUSE_FAR.epsilon;
  const ridgeMin=[Infinity,Infinity],ridgeMax=[-Infinity,-Infinity];
  for(let i=0;i<positions.length;i+=3) if(positions[i+1]>=top-eps) for(let k=0;k<2;k++) {
    const v=positions[i+k*2];ridgeMin[k]=Math.min(ridgeMin[k],v);ridgeMax[k]=Math.max(ridgeMax[k],v);
  }
  const alongX=ridgeMax[0]-ridgeMin[0]>ridgeMax[1]-ridgeMin[1];
  let eave=Infinity;
  // A roof face incident on the ridge identifies its eave even on a hipped source roof.
  for(const {positions:p,indices} of surfaces) for(let i=0;i<(indices?.length??p.length/3);i+=3) {
    const a=(indices?.[i]??i)*3,b=(indices?.[i+1]??i+1)*3,c=(indices?.[i+2]??i+2)*3;
    if(c+2>=p.length)continue;
    const ux=p[b]-p[a],uy=p[b+1]-p[a+1],uz=p[b+2]-p[a+2],vx=p[c]-p[a],vy=p[c+1]-p[a+1],vz=p[c+2]-p[a+2];
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx,len=Math.hypot(nx,ny,nz);
    if(ny/len>HOUSE_SURFACE.roof && ny/len<1-eps && Math.max(p[a+1],p[b+1],p[c+1])>=top-eps)
      eave=Math.min(eave,p[a+1],p[b+1],p[c+1]);
  }
  if(!Number.isFinite(eave) || eave<=min[1]+eps)eave=top-(top-min[1])*HOUSE_FAR.roofFallback;
  const p=[],n=[];
  function triangle(a,b,c) {
    const u=b.map((v,k)=>v-a[k]),v=c.map((w,k)=>w-a[k]);
    const normal=[u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]],len=Math.hypot(...normal);
    for(const q of [a,b,c]) {p.push(...q);n.push(...normal.map(w=>w/len));}
  }
  function quad(a,b,c,d){triangle(a,b,c);triangle(a,c,d);}
  const x0=wall?min[0]:body.min[0],x1=wall?max[0]:body.max[0],z0=wall?min[2]:body.min[2],z1=wall?max[2]:body.max[2];
  const y0=min[1]-HOUSE_FAR.midSink,y1=wall?max[1]:eave;
  quad([x0,y0,z0],[x0,y0,z1],[x0,y1,z1],[x0,y1,z0]);
  quad([x1,y0,z1],[x1,y0,z0],[x1,y1,z0],[x1,y1,z1]);
  quad([x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]);
  quad([x1,y0,z0],[x0,y0,z0],[x0,y1,z0],[x1,y1,z0]);
  quad([x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]);
  if(wall)quad([x0,y1,z1],[x1,y1,z1],[x1,y1,z0],[x0,y1,z0]);
  else {
    const across=alongX?2:0,along=alongX?0:2,mid=(min[across]+max[across])/2;
    const q=(u,y,v)=>{const a=[];a[across]=u;a[1]=y;a[along]=v;return a;};
    // Reversing the local axes also reverses winding.
    const face=(a,b,c,d)=>alongX?quad(d,c,b,a):quad(a,b,c,d);
    face(q(min[across],eave,min[along]),q(min[across],eave,max[along]),q(mid,top,max[along]),q(mid,top,min[along]));
    face(q(mid,top,min[along]),q(mid,top,max[along]),q(max[across],eave,max[along]),q(max[across],eave,min[along]));
    const gable=(v,reverse)=>{const a=q(body.min[across],eave,v),b=q(mid,top,v),c=q(body.max[across],eave,v);if(reverse)triangle(c,b,a);else triangle(a,b,c);};
    gable(body.min[along],alongX);gable(body.max[along],!alongX);
  }
  return {positions:Float32Array.from(p),normals:Float32Array.from(n),min,max,eave,top,alongX,wall,triangles:p.length/9};
}
export const houseFarBrightness = id => 1+(houseIndexSeed(id)[0]*2-1)*HOUSE_FAR.brightness;
export const houseFarRange = (quality,step) => step===3?HOUSE_FAR.adaptRange:quality==='light'?HOUSE_FAR.lightRange:Infinity;
export const houseFarVisible = (level,distance,quality,step) => level===2 && distance<=houseFarRange(quality,step);
// Reuses caller-owned mask; no writes or allocations on an unchanged revision.
export function houseFarMask(state,chunks,revision,quality,step) {
  if(state.revision===revision)return false;
  let changed=false;
  for(let i=0;i<chunks.length;i++) {
    const ch=chunks[i],v=houseFarVisible(ch.level,ch.distance,quality,step)?255:0;
    if(state.data[i]!==v){state.data[i]=v;changed=true;}
  }
  state.revision=revision;return changed;
}
export function houseFarDistance(chunk,pos,horizontal) {
  return Math.hypot(horizontal,Math.max(0,chunk.minY-(pos.y??chunk.minY),(pos.y??chunk.maxY)-chunk.maxY));
}
