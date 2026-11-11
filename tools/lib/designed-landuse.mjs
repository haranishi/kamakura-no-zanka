import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { hash, smooth, townWestAt, townEastAt, townNorthAt, inRect, shoreAt, riverWidth } from './designed-terrain.mjs';
// Signed distance from the town / eastern floodplain. A varying width avoids a straight forest wall.
export function designedBelt(field,x,y) {
  const c=P.belt;
  let d=Infinity,side=null,along=0;
  if(y>=P.town.south+c.townFade&&y<=P.town.north+c.width+c.variation){d=townWestAt(y)-x;side='west';along=y;}
  if(x>=townWestAt(y)&&x<=P.town.east&&Math.abs(x)>P.shrine.lower[1]+P.shrine.edgeRun){const n=y-townNorthAt(x);if(Math.abs(n)<Math.abs(d)){d=n;side='north';along=x;}}
  if(x<field.riverX(y)&&y>=P.town.south&&y<=P.town.north){const n=x-townEastAt(y);if(Math.abs(n)<Math.abs(d)){d=n;side='east';along=y;}}
  if(x>P.town.east){const n=x-field.riverX(y)-riverWidth(y)/2;if(y>P.town.south&&n>=-P.river.valleyWidth&&n<Math.abs(d)){d=n;side='river';along=y;}}
  const width=Math.min(side==='river'?50:P.targets.beltWidth[1],Math.max(side==='river'?30:P.targets.beltWidth[0],c.width+c.variation*(Math.sin(along*Math.PI*2/c.waves[0])+Math.sin(along*Math.PI*2/c.waves[1]))/2));
  if(d < -c.townFade||d>width||y<shoreAt(x)+P.shore.beach)return null;
  return {d,width,side,along};
}
export function designedLanduse(field) {
  const c=P.belt,farms=[],clusters=[];
  const raw=field.sample;
  const free=(x,y)=>{const q=raw(x,y),r=field.riverNear(x,y),road=field.roadNear(x,y);return q.h>0&&q.code!==6&&r.distance>r.width/2+P.river.gravel&&(!road||road.distance>road.road.width/2+P.veg.pathGap)&&!P.terraces.some(t=>inRect(x,y,t.rect))&&!(Math.abs(x)<P.shrine.lower[1]+P.shrine.edgeRun&&y>P.shrine.lower[2]);};
  const groups=[];
  for(let y=P.town.south+c.groupPitch/2;y<P.town.north;y+=c.groupPitch)groups.push({x:townWestAt(y)-c.farmDepth/2,y,side:'west',yaw:Math.PI/2});
  for(let x=P.town.west+c.groupPitch/2;x<P.town.east;x+=c.groupPitch){if(Math.abs(x)<P.shrine.lower[1]+P.shrine.edgeRun)continue;groups.push({x,y:townNorthAt(x)+c.farmDepth/2,side:'north',yaw:0});}
  for(let y=P.town.south+c.groupPitch/2;y<P.river.valleyNorth;y+=c.groupPitch)groups.push({x:field.riverX(y)+P.river.valleyWidth/2,y,side:'river',yaw:Math.PI/2});
  for(let y=P.town.south+c.groupPitch/2;y<P.town.north;y+=c.groupPitch)groups.push({x:townEastAt(y)+c.farmDepth/2,y,side:'east',yaw:Math.PI/2});
  const baseGroups=[...groups];for(const g of baseGroups)groups.push({...g,x:g.x+(g.side==='west'?-c.farmDepth:g.side==='river'||g.side==='east'?c.farmDepth:0),y:g.y+(g.side==='north'?c.farmDepth:0),outer:true});
  for(const [id,g] of groups.entries()) {
    if(g.outer&&hash(id,0,141)>c.farms/c.grass)continue;
    const count=c.group[0]+Math.floor(hash(id,0,120)*(c.group[1]-c.group[0]+1)),co=Math.cos(g.yaw),si=Math.sin(g.yaw);
    const candidates=[];
    for(let i=0;i<count;i++){
      const along=(i-(count-1)/2)*c.farmWidth,x=g.x+co*along,y=g.y+si*along;
      if(g.outer){const belt=designedBelt(field,x,y);if(!belt||belt.d+c.farmDepth/2>belt.width)continue;}
      if(![[-1,-1],[-1,1],[1,-1],[1,1]].every(([u,v])=>free(x+co*u*c.farmWidth/2-si*v*c.farmDepth/2,y+si*u*c.farmWidth/2+co*v*c.farmDepth/2)))continue;
      candidates.push({x,y,width:c.farmWidth,depth:c.farmDepth,yaw:g.yaw,group:id,side:g.side});
    }
    if(candidates.length>=c.group[0])farms.push(...candidates);
    const x=g.side==='west'?townWestAt(g.y)-c.width:g.side==='east'?townEastAt(g.y)+c.width:g.side==='river'?field.riverX(g.y)+riverWidth(g.y)/2+c.width*.8:g.x;
    const y=g.side==='north'?townNorthAt(g.x)+c.width:g.y;
    if(!g.outer&&free(x,y))clusters.push({x,y,count:c.cluster[0]+Math.floor(hash(id,0,121)*(c.cluster[1]-c.cluster[0]+1))});
  }
  const farmAt=(x,y)=>{for(const f of farms){const dx=x-f.x,dy=y-f.y,co=Math.cos(f.yaw),si=Math.sin(f.yaw);if(Math.abs(co*dx+si*dy)<=f.width/2&&Math.abs(-si*dx+co*dy)<=f.depth/2)return f;}return null;};
  field.farms=farms;field.clusters=clusters;field.beltAt=(x,y)=>designedBelt(field,x,y);field.farmAt=farmAt;field.woodAt=(x,y)=>clusters.some(g=>Math.hypot(x-g.x,y-g.y)<c.clusterRadius);
  field.sample=(x,y)=>{
    const q=raw(x,y),b=designedBelt(field,x,y),cape=[P.cape,P.eastCape].some(c=>Math.hypot(x-c.x,y-c.y)<c.radius&&y>=c.y);
    if(cape&&q.h>0&&q.code===5)q.code=3;
    if(!b&&q.code===4&&y>townNorthAt(x)&&y>P.town.north){const road=field.roadNear(x,y);if(!road||road.distance>road.road.width/2+P.road.pavedShoulder/4)q.code=3;}
    if(b&&q.h>0&&q.code!==6&&q.code!==7){const road=field.roadNear(x,y),r=field.riverNear(x,y);if((!road||road.distance>road.road.width/2+P.road.pavedShoulder/4)&&r.distance>r.width/2+P.river.gravel){
      if(b.d>=0)q.code=b.d>=c.forestGap&&field.woodAt(x,y)?3:2;
      else if(hash(Math.floor(x/c.townFade),Math.floor(y/c.townFade),122)<smooth(-c.townFade,0,b.d))q.code=2;
      if(farmAt(x,y))q.code=4;
    }}
    if(y>=P.town.south&&y<=P.town.north&&(x<townWestAt(y)||x>townEastAt(y))&&q.code===4){const road=field.roadNear(x,y);if(!road||road.distance>road.road.width/2+P.road.pavedShoulder/4)q.code=b?2:3;}
    if(P.burns.plots.some(r=>inRect(x,y,r))&&q.code===4)q.code=2;
    return q;
  };
  return field;
}
