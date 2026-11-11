import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { createDesignedTerrain, hash } from './designed-terrain.mjs';
import { makeGlb, box } from './synthetic-glb.mjs';
import { parseGlb, buildGlb } from './glb.mjs';
// Soft facilities consume terrain-relative heights. Preserve the step edge at every vertex.
export function designedStairs(field=null,{emit=P.emit}={}) {
  field??=createDesignedTerrain(P.stairs.totalRise,null,emit);
  const c=P.stairs,run=P.shrine.stairNorth-P.shrine.stairSouth,n=Math.ceil(c.totalRise/c.rise),tread=run/n,steps=[],parts=[];
  // Built stairs carry their own zero: the lower terrace, where the first nose lies. The world file sets them down at that height.
  const centre=emit.steps?P.shrine.stairSouth:P.shrine.stair[1],groundAnchor=emit.steps?P.shrine.lower[4]:0;
  for(let i=0;i<=n;i++) {
    const y=P.shrine.stairSouth+i*tread,top=P.shrine.lower[4]+i*c.totalRise/n;
    steps.push({y,top});
    const length=i===n?c.landing:tread;
    if(!length)continue;
    for(const [x,width,lift] of (emit.polish?[[0,c.width,0]]:[[0,c.width,0],[-(c.width+c.ear)/2,c.ear,c.earLift],[(c.width+c.ear)/2,c.ear,c.earLift]])) {
      const absolute=box(x,top-c.embed,centre-y-length/2,width,c.embed+lift,length);
      const positions=[],normals=[];
      // Drop hidden underside and back face: top, riser and two embedded sides = eight triangles.
      for(let tri=0;tri<12;tri++){if([0,1,4,5].includes(tri))continue;
        for(let k=0;k<3;k++) {const j=tri*9+k*3,px=absolute.positions[j],pz=absolute.positions[j+2];
          positions.push(px,absolute.positions[j+1]-(emit.steps?groundAnchor:field.sample(px,centre-pz).h),pz);normals.push(...absolute.normals.slice(j,j+3));}
      }
      parts.push({geometry:{positions,normals},tone:1+c.variation*(hash(i,0,73)*2-1)});
    }
  }
  const groups=Array.from({length:c.tones},(_,i)=>({geometry:{positions:[],normals:[]},tone:1-c.variation+2*c.variation*i/(c.tones-1)}));
  for(const part of parts){const i=Math.max(0,Math.min(c.tones-1,Math.round((part.tone-1+c.variation)/(2*c.variation)*(c.tones-1))));groups[i].geometry.positions.push(...part.geometry.positions);groups[i].geometry.normals.push(...part.geometry.normals);}
  if(emit.polish){
    const geometry={positions:[],normals:[]},slope=c.totalRise/run;
    for(const sign of [-1,1])for(const landing of [false,true]){
      const length=landing?c.landing:run,centreY=landing?P.shrine.stairNorth+length/2:P.shrine.stairSouth+run/2;
      const shape=box(sign*(c.width+c.ear)/2,P.shrine.lower[4]+c.earLift-c.embed,centre-centreY,c.ear,c.embed,length);
      for(let i=0;i<shape.positions.length;i+=3){const px=shape.positions[i],pz=shape.positions[i+2],north=centre-pz;
        const lift=landing?c.totalRise:slope*(north-P.shrine.stairSouth);
        geometry.positions.push(px,shape.positions[i+1]+lift-(emit.steps?groundAnchor:field.sample(px,north).h),pz);
        const nx=shape.normals[i],ny=shape.normals[i+1],nz=shape.normals[i+2]+(landing?0:slope*ny),len=Math.hypot(nx,ny,nz);
        geometry.normals.push(nx/len,ny/len,nz/len);
      }
    }
    parts.push({geometry,tone:c.edgeDark});groups.push({geometry,tone:c.edgeDark});
  }
  const doc=parseGlb(makeGlb([{name:'designed:stairs',parts:groups}]));
  doc.json.materials=groups.map(p=>({name:'authored stair stone',pbrMetallicRoughness:{baseColorFactor:[...c.colour.map(v=>{const s=v*p.tone/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;}),1],roughnessFactor:1,metallicFactor:0}}));
  doc.json.meshes[0].primitives.forEach((p,i)=>{p.material=i;});
  const triangles=parts.reduce((n,p)=>n+p.geometry.positions.length/9,0);
  if(triangles>c.triangles)throw Error('Stair triangle budget exceeded');
  return {bytes:buildGlb(doc),steps,tread,triangles};
}
