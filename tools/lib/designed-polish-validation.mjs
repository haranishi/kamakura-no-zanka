import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { designedCamera } from './designed-perspective.mjs';
// Uniform screen columns, limited to the mountain band above the far edge of town.
export function designedRidgeOverlap(field) {
  const c=P.reliefCheck,camera=designedCamera(),o=camera.origin;
  let columns=0,overlaps=0,work=0;const jumps=[];
  for(let col=0;col<c.columns;col++){
    let previous=null,maxJump=0,hits=0;
    for(let row=0;row<c.rows;row++){
      const d=camera.ray((col+.5)*2/c.columns-1,1-2*(row+.5)*c.bottom/c.rows);let hit=null;
      for(let t=0;t<c.far;t+=c.step){
        const x=o[0]+d[0]*t,y=o[1]+d[1]*t,z=o[2]+d[2]*t;
        if(x<P.grid.west||x>P.grid.east||y>P.grid.north)break;
        if(y<P.grid.south)continue;
        work++;if(z<=field.sample(x,y).h){hit={x,y,distance:t*Math.hypot(...d)};break;}
      }
      if(!hit||hit.y<P.town.north){previous=null;continue;}
      hits++;if(previous!==null)maxJump=Math.max(maxJump,Math.abs(hit.distance-previous));previous=hit.distance;
    }
    if(hits>1)columns++;if(maxJump>=c.jump)overlaps++;jumps.push(maxJump);
  }
  return {columns,overlaps,totalColumns:c.columns,fraction:overlaps/c.columns,work,jumps};
}
export function designedStairSides(field){
  const c=P.stairs;let maxError=0,samples=0;
  for(let y=P.shrine.stairSouth;y<=P.shrine.stairNorth;y+=.1)for(let d=0;d<=c.bankWidth;d+=.25)for(const sign of [-1,1]){
    const nose=P.shrine.lower[4]+c.totalRise*(y-P.shrine.stairSouth)/(P.shrine.stairNorth-P.shrine.stairSouth);
    maxError=Math.max(maxError,Math.abs(field.sample(sign*(c.width/2+c.ear+d),y).h-nose));samples++;
  }
  return {maxError,samples};
}
