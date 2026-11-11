import { ESCAPE as R } from '../worlds/kamakura-escape.mjs';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { gameNorth, riverX, riverWidth, hash } from './designed-terrain.mjs';
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
  for(const side of [-1,1])for(const top of [false,true]) {
    const line=R.cut.map(([x,y],i)=>{const a=R.cut[Math.max(0,i-1)],b=R.cut[Math.min(R.cut.length-1,i+1)],dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),offset=top?R.rocks.topOffset:R.rocks.toeOffset;return [x+side*dy/len*offset,y-side*dx/len*offset];});
    rocks.push({id:'pass-'+(side>0?'ne':'sw')+(top?'-top':'-toe'),shape:'line',xy_m:xy(line),width:R.rocks.width,count:Math.round(R.rocks.count*(top?R.rocks.topRate:1-R.rocks.topRate)/2),size_m:top?R.rocks.topSize:R.rocks.size});
  }
  const fences=R.fences.map((p,i)=>({id:'retreat-'+i,kind:'rail',xy_m:xy(p),height_m:R.fenceHeight}));
  return {fences,schema:'kz-works/0.1',rocks,piers:[{id:'quay-pier',xy_m:xy(c.pier),width_m:c.pierWidth,deck_m:c.deck}],moorings:c.moorings.map(([x,y,yaw_deg,kind])=>({x,y:gameNorth(y),yaw_deg,kind}))};
}
