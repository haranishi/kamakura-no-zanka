import { ESCAPE as R } from '../worlds/kamakura-escape.mjs';
import { routeNear, nearLine } from './designed-route.mjs';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { gameNorth, riverX, riverWidth, hash } from './designed-terrain.mjs';
// Straight axis of the cut, from its first to its last point: metres along it and to its north-east side, and its bearing.
export function cutAxis() {
  const a=R.cut[0],b=R.cut.at(-1),len=Math.hypot(b[0]-a[0],b[1]-a[1]),d=[(b[0]-a[0])/len,(b[1]-a[1])/len],n=[d[1],-d[0]];
  return {length:len,bearing:(Math.atan2(d[0],d[1])*180/Math.PI+360)%180,at:(along,side)=>[a[0]+d[0]*along+n[0]*side,a[1]+d[1]*along+n[1]*side],
    of:(x,y)=>({along:(x-a[0])*d[0]+(y-a[1])*d[1],side:(x-a[0])*n[0]+(y-a[1])*n[1]})};
}
export function designedWorks() {
  const h=P.harbor,c=P.works,xy=points=>points.map(([x,y])=>[x,gameNorth(y)]),rocks=[];
  // Runtime accepts lines, so an ellipse needs no new schema or game-side primitive.
  const points=[],rx=h.radius-h.width/2,ry=h.radiusY-h.width/2;
  for(let a=h.mouth+h.opening/2;a<=270;a+=c.ringStep)points.push([h.x+rx*Math.sin(a*Math.PI/180),h.y+ry*Math.cos(a*Math.PI/180)]);
  points.push([h.x-rx,h.y]);
  rocks.push({id:'harbor-wall',shape:'line',xy_m:xy(points),width:c.ringWidth,count:c.ringCount,size_m:c.ringSize});
  rocks.push({id:'harbor-island',shape:'disc',x:h.island[0],y:gameNorth(h.island[1]),radius:h.islandRadius,count:c.islandCount,size_m:c.islandSize});
  for(const [id,line,width,count,size] of [['harbor-root',c.rootLine,c.rootWidth,c.rootCount,c.rootSize],['west-cape',c.westLine,c.westWidth,c.westCount,c.westSize],['east-cape',c.eastLine,c.eastWidth,c.eastCount,c.eastSize]])rocks.push({id,shape:'line',xy_m:xy(line),width,count,size_m:size});
  const rapid=[];for(let i=0;i<c.rapidCount;i++){const y=c.rapidRange[0]+(c.rapidRange[1]-c.rapidRange[0])*i/(c.rapidCount-1),x=riverX(y)+(hash(i,0,191)-.5)*(riverWidth(y)-c.rapidSize[1]);rapid.push([x,y]);}
  rocks.push({id:'river-rapids',shape:'line',xy_m:xy(rapid),width:c.rapidSize[0],count:c.rapidCount,size_m:c.rapidSize});
  // The cut walls are drawn as rock masses over the height field. Along / side are metres on the straight cut axis; side is
  // positive to the north-east. Stones lie only round the wall ends, clear of the trodden road.
  const {at,bearing}=cutAxis(),crags=[],t=R.talus;
  for(const [name,sign] of [['ne',1],['sw',-1]]) {
    const c=R.crags[name],[from,to]=c.along,near=sign*R.crags.inner,far=sign*(R.crags.inner+c.depth);
    // face_deg: the bearing the road-side face looks towards; the mass keeps its full height there and steps down on the other sides.
    crags.push({id:'cut-'+name,xy_m:xy([at(from,near),at(to,near),at(to,far),at(from,far)]),cell_m:R.crags.cell,step_m:R.crags.step,grain_deg:bearing,lift_m:R.crags.lift,rise_m:0,face_deg:(bearing+(sign>0?90:270))%360});
    for(const [end,out,tag] of [[from,-1,'a'],[to,1,'b']])for(let base=t.base;base<=t.pushMax;base+=t.push) {
      const line=[at(end+out*t.start,sign*(R.crags.inner+base)),at(end+out*t.reach,sign*(R.crags.inner+base+t.spread))];
      const mid=[(line[0][0]+line[1][0])/2,(line[0][1]+line[1][1])/2];
      if([line[0],mid,line[1]].some(([x,y])=>nearLine(R.pass,x,y).distance<R.width/2+t.width/2+t.size[1]/2+t.clear))continue;
      rocks.push({id:'pass-talus-'+name+'-'+tag,shape:'line',xy_m:xy(line),width:t.width,count:t.count,size_m:t.size});break;
    }
  }
  if(P.emit.polish){
    const c=R.foreground,points=[];
    for(let i=0;i<c.attempts&&points.length<c.rocks;i++){
      const a=(c.bearing[0]+hash(i,0,221)*(c.bearing[1]-c.bearing[0]))*Math.PI/180,d=c.distance[0]+hash(i,0,222)*(c.distance[1]-c.distance[0]);
      const x=R.camera.east+Math.sin(a)*d,y=R.camera.north+Math.cos(a)*d,q=routeNear(x,y);
      if(q.distance>q.road.width/2+c.size[1]+P.veg.pathGap)points.push([x,y]);
    }
    // Separate single-rock discs preserve the authored angular sector, without line interpolation across the road.
    for(const [i,[x,y]]of points.entries())rocks.push({id:'foreground-'+i,shape:'disc',x,y:gameNorth(y),radius:c.crown,count:1,size_m:c.size});
  }
  const fences=R.fences.map((p,i)=>({id:'retreat-'+i,kind:'rail',xy_m:xy(p),height_m:R.fenceHeight}));
  return {fences,schema:'kz-works/0.1',rocks,crags,piers:[{id:'quay-pier',xy_m:xy(c.pier),width_m:c.pierWidth,deck_m:c.deck}],moorings:c.moorings.map(([x,y,yaw_deg,kind])=>({x,y:gameNorth(y),yaw_deg,kind}))};
}
