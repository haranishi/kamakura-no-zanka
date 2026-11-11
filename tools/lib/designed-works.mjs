import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { gameNorth } from './designed-terrain.mjs';
export function designedWorks() {
  const h=P.harbor,c=P.works,xy=points=>points.map(([x,y])=>[x,gameNorth(y)]);
  return {schema:'kz-works/0.1',rocks:[
    {id:'harbor-ring',shape:'ring',x:h.x,y:gameNorth(h.y),radius:h.radius,width:c.ringWidth,gap_bearing_deg:h.mouth,gap_deg:h.opening,count:c.ringCount,size_m:c.ringSize},
    {id:'harbor-island',shape:'disc',x:h.island[0],y:gameNorth(h.island[1]),radius:h.islandRadius,count:c.islandCount,size_m:c.islandSize},
    {id:'harbor-root',shape:'line',xy_m:xy(c.rootLine),width:c.rootWidth,count:c.rootCount,size_m:c.rootSize},
    {id:'west-cape',shape:'line',xy_m:xy(c.westLine),width:c.westWidth,count:c.westCount,size_m:c.westSize},
    {id:'east-cape',shape:'line',xy_m:xy(c.eastLine),width:c.eastWidth,count:c.eastCount,size_m:c.eastSize}],
    piers:[{id:'quay-pier',xy_m:xy(c.pier),width_m:c.pierWidth,deck_m:c.deck}],
    moorings:c.moorings.map(([x,y,yaw_deg,kind])=>({x,y:gameNorth(y),yaw_deg,kind}))};
}
