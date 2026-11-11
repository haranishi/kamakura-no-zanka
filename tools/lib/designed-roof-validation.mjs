import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { designedCamera } from './designed-perspective.mjs';
import { northOffset, townWestAt, townEastAt } from './designed-terrain.mjs';
import { houseBox } from '../../dist/valley/kamakura-houses.js';
// Uniform screen rays: denominator is the visible projection of the town ground.
// Roof boxes keep each emitted house's own dimensions and rotation; no inflated proxy.
export function designedRoofCoverage(world) {
  const c=P.composition,camera=designedCamera(),o=camera.origin,boxes=world.filled.houses.instances.map(p=>{
    const b=houseBox(world.filled.houses.kinds.get(p.kind),p.matrix),y=northOffset-b.z;
    return {...b,y,base:world.field.sample(b.x,y).h,co:Math.cos(b.rotY),si:Math.sin(b.rotY)};
  });
  let rays=0,hits=0,work=0;
  for(let v=0;v<c.rayRows;v++)for(let u=0;u<c.rayColumns;u++){
    const d=camera.ray((u+.5)*2/c.rayColumns-1,1-(v+.5)*2/c.rayRows);let t=0,ground=null;
    for(;t<c.rayFar;t+=c.rayStep){
      const x=o[0]+d[0]*t,y=o[1]+d[1]*t,z=o[2]+d[2]*t;
      if(y>P.grid.north||x<P.grid.west||x>P.grid.east)break;
      if(y<P.grid.south)continue;
      work++;if(z<=world.field.sample(x,y).h){ground=[x,y];break;}
    }
    if(!ground||ground[1]<c.townSouth||ground[1]>c.townNorth||ground[0]<townWestAt(ground[1])||ground[0]>townEastAt(ground[1]))continue;
    rays++;
    for(const b of boxes){
      const dx=o[0]-b.x,dz=northOffset-o[1]-b.z,ox=b.co*dx-b.si*dz,oz=b.si*dx+b.co*dz,vx=b.co*d[0]+b.si*d[1],vz=b.si*d[0]-b.co*d[1];
      let lo=0,hi=t;
      for(const [start,speed,min,max] of [[ox,vx,-b.w/2,b.w/2],[oz,vz,-b.d/2,b.d/2],[o[2],d[2],b.base,b.base+b.height]]){
        work++;if(Math.abs(speed)<1e-12){if(start<min||start>max){hi=-1;break;}}else{const a=(min-start)/speed,q=(max-start)/speed;lo=Math.max(lo,Math.min(a,q));hi=Math.min(hi,Math.max(a,q));}
        if(hi<lo)break;
      }
      if(hi>=lo){hits++;break;}
    }
  }
  return {rays,hits,fraction:hits/rays,work};
}
