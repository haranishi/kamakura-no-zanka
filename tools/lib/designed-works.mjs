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
  return {schema:'kz-works/0.1',rocks,piers:[{id:'quay-pier',xy_m:xy(c.pier),width_m:c.pierWidth,deck_m:c.deck}],moorings:c.moorings.map(([x,y,yaw_deg,kind])=>({x,y:gameNorth(y),yaw_deg,kind}))};
}
