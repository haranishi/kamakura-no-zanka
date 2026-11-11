import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { gameZ, northOffset, hash, noise, clamp, townWestAt, inRect, townEastAt } from './designed-terrain.mjs';
import { houseBounds, houseBox, houseIntersects } from '../../dist/valley/kamakura-houses.js';
import { townBoxesOverlap } from '../../dist/valley/kamakura-town-fill.js';
export function placeDesignedFacilities(kits,{emit=P.emit}={}) {
  return kits.nodes.map((node,i)=>({...node,anchor_xz:[P.facilities[i][3],gameZ(emit.steps&&node.part==='stairs'?P.shrine.stairSouth:P.facilities[i][4])],...(emit.steps&&node.part==='stairs'?{steps:{from_xz:[0,gameZ(P.shrine.stairSouth)],to_xz:[0,gameZ(P.shrine.stairNorth)],rise_m:kits.stairRise,width_m:P.stairs.width,landing_m:P.stairs.landing}}:{})}));
}
export const facilityBoxes=nodes=>nodes.map(n=>({x:n.anchor_xz[0]+(n.bbox_min[0]+n.bbox_max[0])/2,z:n.anchor_xz[1]+(n.bbox_min[2]+n.bbox_max[2])/2,w:n.bbox_max[0]-n.bbox_min[0],d:n.bbox_max[2]-n.bbox_min[2],rotY:0,height:n.bbox_max[1]}));
export function placeDesignedHouses(kits,field,nodes) {
  const houses=[],boxes=[],facilities=facilityBoxes(nodes),used=new Set(),c=P.houses;
  const fillRow=(box)=>{const y=northOffset-box.z,r=Math.hypot(box.w,box.d)/2;if(y+r<P.town.south||y-r>P.town.north||box.x+r<townWestAt(y)||box.x-r>townEastAt(y))return false;const half=P.roads[0].width/2;if(Math.abs(box.x)-r<half+P.townFill.depth+P.grid.cell)return true;for(let off=half+P.townFill.laneFirst;off<P.townFill.reach;off+=P.townFill.laneEvery)if(Math.abs(Math.abs(box.x)-off)<P.townFill.depth+P.grid.cell+r)return true;return false;};
  const byGroup=group=>kits.kinds.filter(k=>k.house_type.split('_')[0]===group);
  const choose=(group,i)=>{const a=byGroup(group);if(!a.length)throw Error('Missing house family: '+group);return a[i%a.length];};
  const nearest=(x,y)=>{let best=Infinity,target=null;for(const road of field.roads)for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy))),rx=a[0]+dx*t,ry=a[1]+dy*t,d=Math.hypot(x-rx,y-ry);if(d<best){best=d;target={x:rx,y:ry};}}return target;};
  function add(k,x,y,{yaw,scaleX=1,scaleZ=1,allowTouch=false,reserve=false}={}) {
    if(yaw===undefined){const q=nearest(x,y);yaw=Math.atan2(q.x-x,-(q.y-y));}
    const co=Math.cos(yaw),si=Math.sin(yaw),b=houseBounds(k),u=(b.min[0]+b.max[0])/2,v=(b.min[2]+b.max[2])/2;
    const matrix=[co*scaleX,0,-si*scaleX,0,0,1,0,0,si*scaleZ,0,co*scaleZ,0,x-co*u*scaleX-si*v*scaleZ,0,gameZ(y)+si*u*scaleX-co*v*scaleZ,1];
    const box=houseBox(k,matrix),q=field.riverNear(x,y);
    if(reserve&&fillRow(box))return false;
    if(field.sample(x,y).h<=0||q.distance<q.width/2+P.river.bankMin||facilities.some(b=>townBoxesOverlap(box,b,c.gap))||(!allowTouch&&boxes.some(b=>townBoxesOverlap(box,b,c.gap))))return false;
    for(const road of field.roads)for(let i=1;i<road.points.length;i++) {
      const a=road.points[i-1],b=road.points[i];
      if(houseIntersects(box,{x:a[0],z:gameZ(a[1])},{x:b[0],z:gameZ(b[1])},road.width/2+c.gap))return false;
    }
    for(const [u,v] of [[-box.w/2,-box.d/2],[box.w/2,-box.d/2],[-box.w/2,box.d/2],[box.w/2,box.d/2]]) {
      const px=box.x+co*u+si*v,py=northOffset-box.z+si*u-co*v,r=field.riverNear(px,py);
      if(field.sample(px,py).h<=0||r.distance<r.width/2)return false;
    }
    houses.push({kind:k.index,matrix});boxes.push(box);used.add(k.index);return true;
  }
  // Reserve a shop on each side of the entrance before the beach hamlet claims those plots.
  const shops=byGroup('machiya').sort((a,b)=>(a.bbox_max[0]-a.bbox_min[0])-(b.bbox_max[0]-b.bbox_min[0]));
  for(const side of [-1,1]) {
    let ok=false;
    for(let y=c.avenueFirst;y<=P.spawn[1]+20&&!ok;y+=P.grid.cell)for(const k of shops)if(add(k,side*c.avenueX,y)){ok=true;break;}
    if(!ok)throw Error('No safe entrance shop on each side of the avenue');
  }
  let beach=0;
  for(let i=0;i<c.beach;i++){const side=i%2?1:-1,slot=Math.floor(i/2),group=i%4===0?'banya':'koya';const x=c.beachFirst+i*c.beachPitch,y=c.beachY+(side>0?c.beachDepth/2:-c.beachDepth/2);if(add(choose(group,i),x,y))beach++;}
  for(let i=0;i<c.showcaseRun&&beach<c.beach;i++) {
    const x=c.beachFirst+hash(i,0,181)*(c.beachFirst+(c.beach-1)*c.beachPitch-c.beachFirst),y=c.beachY+(hash(i,0,182)-.5)*c.beachDepth;
    if(add(choose(i%4?'koya':'banya',i),x,y))beach++;
  }
  let portHouses=0;
  for(let i=0;i<c.port;i++){const col=i%5,row=Math.floor(i/5);if(add(choose('banya',i),c.portFirst+i*c.portPitch,c.portY))portHouses++;}
  const portKinds=byGroup('banya').sort((a,b)=>{const x=houseBounds(a),y=houseBounds(b);return (x.max[0]-x.min[0])*(x.max[2]-x.min[2])-(y.max[0]-y.min[0])*(y.max[2]-y.min[2]);});
  for(let i=0;i<c.showcaseRun&&portHouses<c.port;i++){const x=P.harbor.quay[0]+hash(i,0,186)*(P.harbor.quay[1]-P.harbor.quay[0]),y=P.harbor.connection[2]+P.grid.cell+hash(i,0,187)*(c.portY-P.harbor.connection[2]-P.grid.cell);if(add(portKinds[0],x,y))portHouses++;}
  for(let i=0;i<c.avenue;i++){const x=(i%2?1:-1)*c.avenueX,y=c.avenueFirst+Math.floor(i/2)*c.avenuePitch;add(choose('machiya',i),x,y);}
  for(const [i,[x,y]] of c.estates.entries()) {
    const k=choose('yashiki',i),b=houseBounds(k),q=nearest(x,y),yaw=Math.atan2(q.x-x,-(q.y-y)),co=Math.cos(yaw),si=Math.sin(yaw);
    const w=b.max[0]-b.min[0]+2*c.estatePad,d=b.max[2]-b.min[2]+2*c.estatePad;
    add(k,x,y,{yaw});
    const local=(u,v)=>[x+co*u+si*v,y+si*u-co*v];
    const fence=choose('fence',0),fb=houseBounds(fence),fw=fb.max[0]-fb.min[0];
    for(const [u,v,angle,len] of [[0,-d/2,0,w],[-w/2,0,Math.PI/2,d],[w/2,0,Math.PI/2,d],[-w/3,d/2,0,w/3],[w/3,d/2,0,w/3]]){const [px,py]=local(u,v);add(fence,px,py,{yaw:yaw+angle,scaleX:len/fw,allowTouch:true});}
    const [gx,gy]=local(0,d/2);add(choose(i===2?'nagayamon':'gate',0),gx,gy,{yaw,allowTouch:true});
  }
  let showcaseSmallHouses=0;
  // Guarantee one example of every kit kind; search only the authored roadside showcase bands.
  for(const k of kits.kinds)if(!used.has(k.index)) {
    let ok=false;
    for(let i=0;i<c.showcaseRun&&!ok;i++){const road=field.roads.filter(r=>r.kind==='trail'||r.id==='pass')[i%3],p=road.points[Math.floor(hash(i,0,183)*road.points.length)],x=p[0]+(hash(i,0,184)-.5)*c.showcasePitch*3,y=p[1]+(hash(i,0,185)-.5)*c.showcasePitch*3;ok=add(k,x,y,{reserve:true});}
    if(!ok)throw Error('No safe landmark placement for kind: '+k.house_type);
    if(k.house_type.split('_')[0]==='koya')showcaseSmallHouses++;
  }
  const mouthHouses=[];
  for(const [m,[cy,width,depth]] of P.edge.westMouths.entries()) {
    let count=0;
    for(let i=0;i<P.edge.mouthAttempts&&count<P.edge.mouthHouses;i++) {
      const y=cy+(hash(i,m,160)-.5)*width,x=townWestAt(y)-hash(i,m,161)*depth;
      if(field.sample(x,y).h<=0)continue;
      if(add(choose('koya',i),x,y,{reserve:true}))count++;
    }
    mouthHouses.push(count);
  }
  let beltHouses=0;
  for(let i=0;i<P.belt.houseSearch&&beltHouses<P.belt.houseTarget;i++) {
    const road=field.roads[i%field.roads.length];if(road.id==='avenue'||road.id==='beach')continue;
    const segment=1+Math.floor(hash(i,0,123)*(road.points.length-1)),a=road.points[segment-1],b=road.points[segment],t=hash(i,0,124),dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy),side=i%2?1:-1,offset=road.width/2+P.belt.farmDepth*(.7+hash(i,0,125));
    const x=a[0]+dx*t-dy/length*offset*side,y=a[1]+dy*t+dx/length*offset*side,belt=field.beltAt(x,y);
    if(!belt||belt.d<0||field.farmAt(x,y))continue;
    if(add(choose('koya',i),x,y,{reserve:true}))beltHouses++;
  }
  return {houses,boxes,facilities,beltHouses,mouthHouses,beachHouses:beach,portHouses,showcaseSmallHouses};
}
export function placeDesignedVeg(field,houseBoxes,nodes,extraPaths=[],extraBoxes=[],plots=[],runtimeExclude=null,townReserve=0) {
  const c=P.veg,boxes=[...houseBoxes,...facilityBoxes(nodes),...extraBoxes],veg=[],forestTrees=new Set(),groveTrees=[];
  let townTreeCount=0;const inTown=(x,y)=>x>=P.town.west&&x<=P.town.east&&y>=P.town.south&&y<=P.town.north;
  const paths=[...field.roads,...extraPaths],buckets=new Map(),cell=32;
  for(const b of boxes){const r=Math.hypot(b.w,b.d)/2+c.boxGap;for(let x=Math.floor((b.x-r)/cell);x<=Math.floor((b.x+r)/cell);x++)for(let z=Math.floor((b.z-r)/cell);z<=Math.floor((b.z+r)/cell);z++){const key=x+','+z;if(!buckets.has(key))buckets.set(key,[]);buckets.get(key).push(b);}}
  function free(x,y,crown=0){const q=field.sample(x,y),r=field.riverNear(x,y),near=field.roadNear(x,y);if(q.h<=0||r.distance<r.width/2+c.boxGap+crown||near&&near.distance<near.road.width/2+c.pathGap+crown)return false;
    const z=gameZ(y);if((buckets.get(Math.floor(x/cell)+','+Math.floor(z/cell))||[]).some(b=>houseIntersects(b,{x,z},undefined,c.boxGap+crown)))return false;
    for(const p of extraPaths)for(let i=1;i<p.points.length;i++){const a=p.points[i-1],b=p.points[i],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)));if(Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy)<p.width/2+c.pathGap)return false;}
    return true;
  }
  const buddha=nodes.find(n=>n.part==='buddha'),brect=P.terraces[0].rect;
  const camera=[0,P.places.find(p=>p[0]==='wakamiya_oji')[3]-P.overlook.back,P.overlook.height];
  const target=[buddha.anchor_xz[0],northOffset-buddha.anchor_xz[1],brect[4]+buddha.bbox_max[1]*.7];
  const clearBuddha=(x,y,h,r,base)=>{
    if(x>brect[0]&&x<brect[1]+P.buddha.clear&&y>brect[2]-P.buddha.clear&&y<target[1]&&h>P.belt.treeHeight[1])return false;
    const dx=target[0]-camera[0],dy=target[1]-camera[1],dz=target[2]-camera[2],t=clamp(((x-camera[0])*dx+(y-camera[1])*dy+(base+h*.7-camera[2])*dz)/(dx*dx+dy*dy+dz*dz));
    return Math.hypot(x-camera[0]-t*dx,y-camera[1]-t*dy,base+h*.7-camera[2]-t*dz)>r;
  };
  const treeBins=new Map(),treeCell=c.farPitch*1.5,forest=[];
  function add(x,y,species,tier=0,height=null,crown=null,isForest=false) {
    const a=hash(Math.round(x*100),Math.round(y*100),2),b=hash(Math.round(y*100),Math.round(x*100),3);
    const far=Math.hypot(x-c.forestCentre[0],y-c.forestCentre[1])>c.farRadius;
    const h=height??((c.heightMin+c.heightMax)/2)*(1+(a*2-1)*c.heightVariation),r=crown??(c.crownMin+(c.crownMax-c.crownMin)*b)*(far?c.farCrown:1);
    const bx=Math.floor(x/treeCell),by=Math.floor(y/treeCell);
    if(h>P.belt.treeHeight[1])for(let d=-P.belt.forestGap;d<=P.belt.forestGap;d+=P.grid.cell){const yy=y+d;if(yy>=P.town.south&&yy<=P.town.north&&Math.hypot(x-townWestAt(yy),d)<P.belt.forestGap)return false;}
    if(y>=P.shrine.lower[2]&&y<=P.shrine.upper[3]&&Math.abs(x)<P.sanctuary.axisGap)return false;
    const habitat=field.habitat(x,y),density=1+c.densityVariation*clamp((noise(x/c.densityWave,y/c.densityWave)+habitat.valley-habitat.ridge-c.steepWeight*habitat.steep)/2,-1,1);
    const spacing=c.spacing/Math.sqrt(Math.min(1,density));
    for(let j=by-1;j<=by+1;j++)for(let i=bx-1;i<=bx+1;i++)for(const other of treeBins.get(i+','+j)||[]){
      if(Math.hypot(x-other.tree[0],gameZ(y)-other.tree[1])<Math.max(Math.max(spacing,other.spacing)*(r+other.tree[5]),isForest&&far?c.farPitch:other.far?c.farPitch:0))return false;
    }
    if(!clearBuddha(x,y,h,r,field.sample(x,y).h)||!free(x,y)||runtimeExclude?.({x,z:gameZ(y)})||inTown(x,y)&&townTreeCount>=c.townTreesMax-townReserve)return false;
    const tree=[x,gameZ(y),field.sample(x,y).h,a*Math.PI*2,h,r,species,0,Math.floor(b*3),(a*2-1)*c.tint,b,0,hash(Math.round(x),Math.round(y),4),0,0,0];
    veg.push(tree);if(inTown(x,y))townTreeCount++;const entry={tree,spacing,far:far&&isForest};const key=bx+','+by;if(!treeBins.has(key))treeBins.set(key,[]);treeBins.get(key).push(entry);
    if(isForest){forest.push({tree,valley:habitat.valley,ridge:habitat.ridge});forestTrees.add(tree);}return true;
  }
  // Reserve the sacred grove before garden and forest trees compete for its space.
  let sanctuaryTrees=0;
  for(let i=0;i<P.sanctuary.attempts&&sanctuaryTrees<P.sanctuary.treeTarget;i++){
    const l=P.shrine.lower,u=P.shrine.upper,x=l[0]+hash(i,0,171)*(l[1]-l[0]),y=l[2]+hash(i,0,172)*(u[3]-l[2]);
    if(Math.abs(x)<P.sanctuary.axisGap||inRect(x,y,P.sanctuary.square))continue;
    if(nodes.some(n=>n.facility==='tsurugaoka'&&houseIntersects(facilityBoxes([n])[0],{x,z:gameZ(y)},undefined,P.sanctuary.buildingGap)))continue;
    if(add(x,y,i%2?3:2,0,P.sanctuary.height[0]+hash(i,0,173)*(P.sanctuary.height[1]-P.sanctuary.height[0]),P.sanctuary.crown)){groveTrees.push(veg.at(-1));sanctuaryTrees++;}
  }
  field.sanctuaryTrees=sanctuaryTrees;
  // Shore trees are not a row. Seen in real Chrome, pines of one height at one spacing along the top of the beach read as a line of
  // palms. Clumps of one to three stand at uneven gaps, set back by different amounts, pines and broadleaves mixed, each its own height.
  for(let x=P.shore.centre-P.shore.halfWidth,i=0;x<P.shore.centre+P.shore.halfWidth;i++){
    x+=c.coastPitch*(.7+1.6*hash(i,0,201));const count=1+Math.floor(hash(i,0,202)*3);
    for(let k=0;k<count;k++)add(x+(hash(i,k,203)-.5)*7,c.coastNorth+hash(i,k,204)*8,hash(i,k,205)<.45?1:3,0,c.heightMin*(.75+.6*hash(i,k,206)));
  }
  add(P.harbor.island[0],P.harbor.island[1],1,0,c.heightMin);
  for(const n of nodes){if(!['hall','buddha'].includes(n.part))continue;const r=Math.hypot(n.bbox_max[0]-n.bbox_min[0],n.bbox_max[2]-n.bbox_min[2])/2+c.templePitch;for(let i=0;i<12;i++){const angle=i*Math.PI/6;add(n.anchor_xz[0]+Math.cos(angle)*r,northOffset-n.anchor_xz[1]+Math.sin(angle)*r,i%10<7?3:1,0,c.templeHeight);}}
  const gardens=extraBoxes.length?extraBoxes:houseBoxes;
  for(let i=0;i<gardens.length;i+=c.gardenEvery){const b=gardens[i],co=Math.cos(b.rotY),si=Math.sin(b.rotY);
    for(const [u,v] of [[b.w/2+c.boxGap*2,0],[-b.w/2-c.boxGap*2,0],[0,b.d/2+c.boxGap*2],[0,-b.d/2-c.boxGap*2]]) {
      if(add(b.x+co*u+si*v,northOffset-b.z+si*u-co*v,3,0,c.gardenHeight))break;
    }
  }
  for(let cluster=0,s=0;s<field.river.at(-1).s;cluster++,s+=c.bankGap[0]+hash(cluster,0,81)*(c.bankGap[1]-c.bankGap[0])) {
    let i=0;while(i<field.river.length-1&&field.river[i].s<s)i++;const r=field.river[i],count=c.bankCluster[0]+Math.floor(hash(cluster,0,82)*(c.bankCluster[1]-c.bankCluster[0]+1));
    for(let j=0;j<count;j++){const angle=hash(cluster,j,83)*Math.PI*2,radius=c.bankSpread*Math.sqrt(hash(cluster,j,84));add(r.x+(cluster%2?1:-1)*(r.width/2+c.bankOffset)+Math.cos(angle)*radius,r.y+Math.sin(angle)*radius,3);}
  }
  // Garden plots and lane corners first, then safe remaining small spaces, with full exclusion checks.
  const townCount=()=>veg.filter(v=>v[0]>=P.town.west&&v[0]<=P.town.east&&northOffset-v[1]>=P.town.south&&northOffset-v[1]<=P.town.north).length;
  for(let i=0;i<plots.length;i+=c.gardenEvery){const p=plots[i],co=Math.cos(p.yaw),si=Math.sin(p.yaw),u=p.width/2,v=p.depth/2;add(p.x+co*u+si*v,northOffset-p.z+si*u-co*v,i%10<7?3:1,0,c.gardenHeight);}
  for(const lane of extraPaths)for(const p of [lane.points[0],lane.points.at(-1)])for(const sign of [-1,1])add(p[0]+sign*(lane.width+c.pathGap),p[1]+sign*c.pathGap,1,0,c.gardenHeight);
  let townTrees=townCount();
  for(let i=0;i<c.gardenAttempts&&townTrees<c.townTreesMin;i++) {
    const x=P.town.west+hash(i,0,91)*(P.town.east-P.town.west),y=P.town.south+hash(i,0,92)*(P.town.north-P.town.south);
    if(field.sample(x,y).code!==4||!free(x,y,c.gardenCrown))continue;
    if(!plots.some(p=>{const dx=x-p.x,dz=gameZ(y)-p.z,co=Math.cos(p.yaw),si=Math.sin(p.yaw),u=Math.abs(co*dx-si*dz),v=Math.abs(si*dx+co*dz);return u<=p.width/2+c.gardenCrown&&v<=p.depth/2+c.gardenCrown&&(Math.abs(u-p.width/2)<=c.gardenCrown||Math.abs(v-p.depth/2)<=c.gardenCrown);}))continue;
    if(add(x,y,i%10<7?3:1,0,c.gardenHeight+hash(i,0,93)*c.gardenHeightRange,c.gardenCrown))townTrees++;
  }
  let beltTrees=0;
  for(const [i,g] of field.clusters.entries()){let accepted=0;for(let j=0;j<g.count*P.belt.cluster[1]&&accepted<g.count;j++) {
    const a=hash(i,j,126)*Math.PI*2,r=P.belt.clusterSpread*Math.sqrt(hash(i,j,127)),x=g.x+Math.cos(a)*r,y=g.y+Math.sin(a)*r,b=field.beltAt(x,y);
    if(!b||b.d<P.belt.forestGap)continue;
    if(add(x,y,i%10<7?3:1,0,P.belt.treeHeight[0]+hash(i,j,128)*(P.belt.treeHeight[1]-P.belt.treeHeight[0]),P.belt.treeCrown)){beltTrees++;accepted++;}
  }}
  field.beltTrees=beltTrees;
  // Uniform random candidates with a crown-size inhibition radius: no underlying rows or columns.
  for(let i=0;i<c.attempts;i++) {
    const x=P.grid.west+hash(i,0,5)*(P.grid.east-P.grid.west),y=P.grid.south+hash(i,0,6)*(P.grid.north-P.grid.south),q=field.sample(x,y);
    // Upstream of the town the grass of the river's bank is wooded too: bare, it climbed the hill as a pale strip in the overlook.
    if((inTown(x,y)&&x>=townWestAt(y)&&x<=townEastAt(y))||q.code!==3&&q.code!==5&&!(q.code===2&&y>P.river.valleyNorth))continue;
    if(Math.hypot(x-P.harbor.x,y-P.harbor.y)<P.harbor.radius+P.harbor.width+P.harbor.slope)continue;
    const belt=field.beltAt(x,y);if(belt&&belt.d<belt.width&&!(belt.side==='river'&&y>P.river.valleyNorth))continue;
    const e=P.grid.cell,slope=Math.atan(Math.hypot(field.sample(x+e,y).h-field.sample(x-e,y).h,field.sample(x,y+e).h-field.sample(x,y-e).h)/(2*e))*180/Math.PI;if(slope>P.hill.rockSlope)continue;
    const habitat=field.habitat(x,y),density=1+c.densityVariation*clamp((noise(x/c.densityWave,y/c.densityWave)+habitat.valley-habitat.ridge-c.steepWeight*habitat.steep)/2,-1,1);
    if(hash(i,0,9)>density/(1+c.densityVariation))continue;
    add(x,y,0,0,null,null,true);
  }
  // Quotas retain the authored mix; continuous spatial scores group like species in 30–80m patches.
  const score=(p,salt)=>noise(p.tree[0]/c.speciesWave+salt,p.tree[1]/c.speciesWave-salt);
  const forestCount=forest.length;
  const cedarScore=p=>{
    const x=p.tree[0],y=p.tree[1],cx=(Math.floor(x/c.cedarTile)+.5)*c.cedarTile,cy=(Math.floor(y/c.cedarTile)+.5)*c.cedarTile;
    return Math.hypot(x-cx,y-cy)<c.cedarRadius?score(p,7)+p.valley:-Infinity;
  };
  forest.sort((a,b)=>cedarScore(b)-cedarScore(a));
  for(const p of forest.splice(0,Math.round(forest.length*c.cedar)))p.tree[6]=2;
  forest.sort((a,b)=>(score(b,13)+b.ridge)-(score(a,13)+a.ridge));
  for(const p of forest.splice(0,Math.round(forestCount*c.pine)))p.tree[6]=1;
  forest.sort((a,b)=>score(b,21)-score(a,21));
  const evergreen=Math.round(forestCount*c.evergreen);forest.forEach((p,i)=>{p.tree[6]=i<evergreen?0:3;});
  for(let i=0;i<groveTrees.length;i++)groveTrees[i][6]=i%2?3:2;
  const sacred=new Set(groveTrees),bright=veg.filter(v=>!forestTrees.has(v)&&!sacred.has(v)&&(inTown(v[0],northOffset-v[1])||field.beltAt(v[0],northOffset-v[1])));
  bright.sort((a,b)=>hash(Math.round(a[0]),Math.round(a[1]),194)-hash(Math.round(b[0]),Math.round(b[1]),194));
  const broadleaf=Math.round(bright.length*c.gardenDeciduous);for(let i=0;i<bright.length;i++)bright[i][6]=i<broadleaf?3:1;
  return veg;
}
