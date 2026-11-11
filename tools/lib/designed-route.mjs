import { designedCamera } from './designed-perspective.mjs';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { ESCAPE as R } from '../worlds/kamakura-escape.mjs';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
const mix=(a,b,t)=>a+(b-a)*t;
export const routeDefinitions=[
  {id:'pass',name:'北西の切通',kind:'kaido',width:R.width,points:R.pass},
  {id:'lookout',name:'物見の岩への道',kind:'trail',width:R.branchWidth,points:R.lookout},
  {id:'valley-trail',name:'谷戸の枝道',kind:'trail',width:R.branchWidth,points:R.branch},
  {id:'kenchoji-trail',name:'建長寺への坂',kind:'trail',width:3,points:R.kenchoji},
];
export function nearLine(points,x,y) {
  let best=null;
  for(let i=1;i<points.length;i++){
    const a=points[i-1],b=points[i],dx=b[0]-a[0],dy=b[1]-a[1],l=Math.hypot(dx,dy),t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(l*l)),xx=a[0]+t*dx,yy=a[1]+t*dy,d=Math.hypot(x-xx,y-yy);
    if(!best||d<best.distance)best={distance:d,h:mix(a[2],b[2],t),x:xx,y:yy,side:((x-xx)*dy-(y-yy)*dx)/l,index:i,t};
  }return best;
}
export function routeNear(x,y){let q=null;for(const road of routeDefinitions){const p=nearLine(road.points,x,y);if(!q||p.distance<q.distance)q={...p,road};}return q;}
export function routeWall(x,y) {
  const a=R.cut[0],b=R.cut.at(-1),dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),along=((x-a[0])*dx+(y-a[1])*dy)/len,side=((x-a[0])*dy-(y-a[1])*dx)/len;
  let h=-Infinity;
  for(const [name,sign] of [['ne',1],['sw',-1]])for(const [centre,length,height,depth] of R.wallBlocks[name]){
    const lateral=side*sign-R.cutWidth/2,over=Math.max(0,Math.abs(along-centre)-length/2),outer=Math.max(0,lateral-depth),floor=mix(a[2],b[2],clamp(along/len));
    const rise=Math.min(height,R.wallSlope*lateral)-R.wallSlope*Math.hypot(over,outer);
    if(lateral>0)h=Math.max(h,floor+rise);
  }return {h,along,side};
}
export function routeCliff(x,y,margin=0){
  const w=routeWall(x,y),q=nearLine(R.cut,x,y),s=Math.hypot(x-R.summit[0],y-R.summit[1]);
  const mountain=nearLine(R.pass.slice(9,14),x,y);
  const walls=Object.entries(R.wallBlocks).some(([name,blocks])=>blocks.some(([centre,length,height,depth])=>{
    const side=w.side*(name==='ne'?1:-1),pad=height/R.wallSlope+margin;
    return Math.abs(w.along-centre)<=length/2+pad&&side>=R.cutWidth/2-margin&&side<=R.cutWidth/2+depth+pad;
  }));
  return walls||s<R.summitRockRadius+margin&&(x>=R.summit[0]||y<R.summit[1])||mountain.side<0&&mountain.distance<R.gradeWidth+margin;
}
export function routePatch(x,y){return routeNear(x,y).distance<R.patchRange||Math.hypot(x-R.summit[0],y-R.summit[1])<R.summitRadius+R.summitBlend;}
// Local bounded cut/fill. The original hills remain the outer boundary; this is not a trench subtracted from them.
export function routeTerrain(x,y,original) {
  if(x>=P.shrine.upper[0]&&x<=P.shrine.upper[1]&&y>=P.shrine.upper[2]&&y<=P.shrine.upper[3])return original;
  for(const t of P.terraces)if(x>=t.rect[0]&&x<=t.rect[1]&&y>=t.rect[2]&&y<=t.rect[3])return {h:t.rect[4],code:original.code};
  if(x < -210||x>0||y<220||y>505)return original;
  const near=routeNear(x,y),d=Math.max(0,near.distance-near.road.width/2-R.shelfPad),envelope=R.earthSlope*(d-R.shoulder*(1-Math.exp(-d/R.shoulder)));
  let lo=-Infinity,hi=Infinity;
  for(const road of routeDefinitions)for(let i=1;i<road.points.length;i++){
    const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)),distance=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);
    const off=Math.max(0,distance-road.width/2-R.shelfPad),bound=R.earthSlope*(off-R.shoulder*(1-Math.exp(-off/R.shoulder))),target=mix(a[2],b[2],t);
    lo=Math.max(lo,target-bound);hi=Math.min(hi,target+bound);
  }
  let h=lo<=hi?clamp(original.h,lo,hi):(lo+hi)/2,weight=1-smooth(R.influence/2,R.influence,near.distance),code=original.code;
  // Valley floor has convex, moderate sides; its head opens into the meadow.
  const v=nearLine(R.valley,x,y),vd=Math.max(0,v.distance-R.valleyWidth/2);
  if(v.distance<R.influence){h=Math.min(h,v.h+R.valleySlope*vd);weight=Math.max(weight,1-smooth(R.influence/2,R.influence,v.distance));}
  const md=Math.hypot(x-R.meadow[0]-R.meadowOffset[0],y-R.meadow[1]-R.meadowOffset[1]),mh=R.meadow[2]+R.meadowSlope*(y-R.meadow[1]);
  h=mix(h,mh,1-smooth(R.meadowRadius,R.meadowRadius+R.meadowBlend,md));
  for(const [hx,hy] of R.homes){const r=Math.hypot(x-hx,y-hy);h=mix(h,R.homeHeight,1-smooth(R.homeRadius,R.homeRadius+R.homeBlend,r));}
  for(const [hx,hy,hh] of R.huts){const r=Math.hypot(x-hx,y-hy);h=mix(h,hh,1-smooth(R.hutRadius,R.hutRadius+R.homeBlend,r));}
  const sd=Math.hypot(x-R.summit[0],y-R.summit[1]),summit=R.summit[2]-R.summitSlope*Math.max(0,sd-R.summitRadius);
  h=Math.max(h,summit);if(sd<R.summitRadius+R.summitBlend)code=sd<R.summitTurf?2:5; // turf over the flat top and its rounded rim, rock on the faces below
  const cut=nearLine(R.cut,x,y),wall=routeWall(x,y);
  if(wall.h>h){h=wall.h;code=5;}
  // Road shelves win at junctions and on the walkable northwest face of the summit.
  const shoulder=wall.h>cut.h?R.wallShelf:R.shoulder;
  if(d<shoulder){const floorWeight=1-smooth(0,shoulder,d);h=mix(h,near.h,floorWeight);}
  // Keep the road earthworks continuous with both temple platforms, including their outside shoulders.
  const slope=Math.tan(P.hill.frontSlope*Math.PI/180);
  for(const t of P.terraces){const r=t.rect,distance=Math.hypot(Math.max(r[0]-x,0,x-r[1]),Math.max(r[2]-y,0,y-r[3]));h=clamp(h,r[4]-slope*distance,r[4]+slope*distance);}
  if(near.distance<=near.road.width/2)code=4;
  else if(md<R.meadowRadius+R.meadowBlend||v.distance<R.valleyWidth)code=2;
  // Grass verges: with the trees set back from the road, the bare forest floor beside it read as one wide dirt clearing.
  else if(code!==5&&near.distance<=near.road.width/2+R.verge)code=2;
  return {h:mix(original.h,h,weight),code};
}
// Fade fine samples back to the already graded grid before the outer patch boundary.
export function routeDetail(x,y,grid){const weight=1-smooth(R.patchCore,R.patchFade,routeNear(x,y).distance);if(weight===0)return grid;const q=routeTerrain(x,y,grid);return {h:mix(grid.h,q.h,weight),code:q.code};}
// Rotate the canopy with the same YXZ lean/yaw used by the tree instances.
export function crownPoint(x,y,base,u,v,lift,lean=0,yaw=0){
  const co=Math.cos(lean),si=Math.sin(lean),cy=Math.cos(yaw),sy=Math.sin(yaw),z=v*co+lift*si;
  return [x+u*cy+z*sy,y+u*sy-z*cy,base+lift*co-v*si];
}
// Exact segment against a finite canopy cylinder in the tree's own coordinates.
export function canopyHit(origin,target,v,margin=0){
  const lean=v[11]||0,yaw=v[3]||0,cy=Math.cos(yaw),sy=Math.sin(yaw),co=Math.cos(lean),si=Math.sin(lean),north=(P.grid.north+P.grid.south)/2-v[1];
  const local=point=>{const dx=point[0]-v[0],dz=north-point[1],dy=point[2]-v[2],u=cy*dx-sy*dz,z=sy*dx+cy*dz;return [u,co*dy+si*z,-si*dy+co*z];};
  const a=local(origin),b=local(target),dx=b[0]-a[0],dz=b[2]-a[2],ll=dx*dx+dz*dz,radius=v[5]+margin;
  let lo=0,hi=1;
  if(ll===0){if(Math.hypot(a[0],a[2])>radius)return null;}
  else {const t=-(a[0]*dx+a[2]*dz)/ll,off=Math.hypot(a[0]+t*dx,a[2]+t*dz);if(off>=radius)return null;const span=Math.sqrt(radius*radius-off*off)/Math.sqrt(ll);lo=Math.max(0,t-span);hi=Math.min(1,t+span);if(lo>hi)return null;}
    const bottom=v[4]*R.crownBase-margin,top=v[4]+margin,dh=b[1]-a[1];
  if(dh===0)return a[1]>bottom&&a[1]<top?lo:null;
  const t0=(bottom-a[1])/dh,t1=(top-a[1])/dh;
  lo=Math.max(lo,Math.min(t0,t1));hi=Math.min(hi,Math.max(t0,t1));
  return lo<=hi?lo:null;
}
export function canopyIntersects(origin,target,v,margin=0){return canopyHit(origin,target,v,margin)!==null;}
export function crownFrame(x,y,h,r,base,lean=0,yaw=0) {
  const camera=designedCamera('escape'),points=[];
  for(const lift of [R.crownBase,1])for(let i=0;i<R.crownSamples;i++){
    const a=i*Math.PI*2/R.crownSamples,p=camera.project(...crownPoint(x,y,base,r*Math.cos(a),r*Math.sin(a),h*lift,lean,yaw));
    if(p[2]>0)points.push([p[0]/P.preview.perspectiveWidth,p[1]/P.preview.perspectiveHeight]);
  }
  return points.length?{left:Math.min(...points.map(p=>p[0])),right:Math.max(...points.map(p=>p[0])),top:Math.min(...points.map(p=>p[1])),bottom:Math.max(...points.map(p=>p[1]))}:null;
}
export function routeTreeHeight(x,y,h,r,base,targets,named=false) {
  if(named)return h;
  const c=R.camera,dx=x-c.east,dy=y-c.north,d=Math.hypot(dx,dy);
  if(d<R.nearTree)return 0;
  if(Math.hypot(x-R.meadow[0]-R.meadowOffset[0],y-R.meadow[1]-R.meadowOffset[1])<=R.meadowRadius)return 0;
  if(Math.hypot(x-R.huts[1][0],y-R.huts[1][1])<=R.hutClear+r)return 0;
  let limit=h;
  for(let index=0;index<targets.length;index++){
    const [tx,ty,th]=targets[index];
    const townRay=index>=targets.length-(R.townGrid.east-R.townGrid.west+R.townGrid.step)/R.townGrid.step*(R.townGrid.north-R.townGrid.south+R.townGrid.step)/R.townGrid.step-R.seaTargets.length;
    if((townRay||index>=1&&index<=R.fires.length)&&Math.hypot(x-tx,y-ty)<=R.treeEndpoint)continue;
    const vx=tx-c.east,vy=ty-c.north,len=Math.hypot(vx,vy),t=(dx*vx+dy*vy)/(len*len),side=Math.hypot(dx-t*vx,dy-t*vy),radius=r+R.crownClearance+R.treeSafety;
    if(t<=0||t>=1||side>=radius)continue;
    const span=Math.sqrt(radius*radius-side*side)/len,low=Math.min(c.height+(th-c.height)*clamp(t-span),c.height+(th-c.height)*clamp(t+span))-R.treeMargin-R.treeSafety-base;
    limit=Math.min(limit,low);
  }
  if(limit<Math.min(h,R.treeMin))return 0;
  if(!named){const f=crownFrame(x,y,limit,r,base);
    if(f&&(f.top<R.skyBand[2]&&f.bottom>0&&f.right>R.skyBand[0]&&f.left<R.skyBand[1]))return 0;
  }return limit;
}
export function clearRouteTree(x,y,h,r,base,targets,named=false){return routeTreeHeight(x,y,h,r,base,targets,named)>=h;}
export function townTargets(field){
  const out=[],g=R.townGrid;for(let y=g.south;y<=g.north;y+=g.step)for(let x=g.west;x<=g.east;x+=g.step)out.push([x,y,field.sample(x,y).h+R.fireLift]);return out;
}
// Points on the retreat road that the overlook should see between the trees: a walker's chest above the road, every few metres.
export function roadSightTargets(field) {
  const v=R.roadView,out=[];
  for(let i=v.from;i<v.to;i++){const a=R.pass[i],b=R.pass[i+1],len=Math.hypot(b[0]-a[0],b[1]-a[1]),n=Math.max(1,Math.round(len/v.step));
    for(let k=0;k<n;k++){const t=k/n,x=a[0]+(b[0]-a[0])*t,y=a[1]+(b[1]-a[1])*t;out.push([x,y,field.sample(x,y).h+v.lift]);}}
  return out;
}
export function routeTargets(field,roofTargets=[]) {
  const ground=([x,y])=>[x,y,field.sample(x,y).h];
  return [ground([0,126]),...R.fires.map(([x,y])=>[x,y,field.sample(x,y).h+R.fireLift]),ground([0,18]),...roofTargets,...R.pass.slice(3,13).map(ground),ground(R.meadow),...R.huts.map(([x,y,h],i)=>[x,y,h+R.hutLifts[i]]),...townTargets(field),...R.seaTargets];
}
