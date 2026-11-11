import { crownPoint } from './designed-route.mjs';
import { ESCAPE } from '../worlds/kamakura-escape.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { encodePNG } from './png.mjs';
import { mapVeg } from '../../dist/valley/kamakura-veg.js';
import { northOffset } from './designed-terrain.mjs';
import { prepareWorks } from '../../dist/valley/kamakura-works.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
import { bridgeSites } from '../../dist/valley/kamakura-bridges.js';
import { houseBox } from '../../dist/valley/kamakura-houses.js';
export function designedCamera(scene='return') {
  const c=P.preview,place=P.places.find(p=>p[0]==='wakamiya_oji'),settings=scene==='escape'?ESCAPE.camera:P.overlook;
  const origin=scene==='escape'?[settings.east,settings.north,settings.height]:[place[2],place[3]-settings.back,settings.height];
  const angle=settings.pitch*Math.PI/180,co=Math.cos(angle),si=Math.sin(angle),bearing=(settings.bearing||0)*Math.PI/180,ex=Math.sin(bearing),ny=Math.cos(bearing),f=c.perspectiveHeight/(2*Math.tan(settings.fov*Math.PI/360));
  return {origin,project(x,y,h){const dx=x-origin[0],dy=y-origin[1],dz=h-origin[2],forward=dx*ex+dy*ny,right=dx*ny-dy*ex,d=forward*co-dz*si;return [c.perspectiveWidth/2+right*f/d,c.perspectiveHeight/2-(forward*si+dz*co)*f/d,d];},
    ray(u,v){const right=u*Math.tan(settings.fov*Math.PI/360)*c.perspectiveWidth/c.perspectiveHeight,up=v*Math.tan(settings.fov*Math.PI/360),forward=co+up*si;return [right*ny+forward*ex,-right*ex+forward*ny,-si+up*co];}};
}
export function designedFrameHits(field,topSamples=9) {
  const samples=[...Array.from({length:topSamples},(_,i)=>[-1+i*2/(topSamples-1),1]),...[-1,1].flatMap(x=>Array.from({length:5},(_,i)=>[x,i/4]))],camera=designedCamera(),origin=camera.origin;
  return samples.map(([u,v])=>{const d=camera.ray(u,v);let hit=null;for(let t=0;t<5000;t+=1){const x=origin[0]+d[0]*t,y=origin[1]+d[1]*t,h=origin[2]+d[2]*t;if(x<P.grid.west||x>P.grid.east||y>P.grid.north)break;if(y<P.grid.south)continue;if(h<=field.sample(x,y).h){hit={x,y,h};break;}}return {u,v,hit};});
}
export async function writeDesignedPerspective(directory,world) {
  const c=P.preview,W=c.perspectiveWidth,H=c.perspectiveHeight,pixels=new Uint8Array(W*H*4),depth=new Float64Array(W*H);depth.fill(Infinity);
  for(let i=0;i<W*H;i++)pixels.set([175,195,200,255],i*4);
  const camera=designedCamera(world.scene),rgb=world.files.get('ground_rgb.bin'),{width:w,height:h}=world.meta.grid,cell=P.grid.cell;
  const project=(x,y,z)=>camera.project(x,y,z),point=(i,j)=>project(P.grid.west+(i+.5)*cell,P.grid.north-(j+.5)*cell,Math.max(0,world.heights[j*w+i]));
  function tri(a,b,c,colour) {
    if(Math.min(a[2],b[2],c[2])<=0)return;
    const area=(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);if(Math.abs(area)<1e-8)return;
    const x0=Math.max(0,Math.floor(Math.min(a[0],b[0],c[0]))),x1=Math.min(W-1,Math.ceil(Math.max(a[0],b[0],c[0]))),y0=Math.max(0,Math.floor(Math.min(a[1],b[1],c[1]))),y1=Math.min(H-1,Math.ceil(Math.max(a[1],b[1],c[1])));
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++){const u=((b[0]-x)*(c[1]-y)-(b[1]-y)*(c[0]-x))/area,v=((c[0]-x)*(a[1]-y)-(c[1]-y)*(a[0]-x))/area,t=1-u-v;if(u<0||v<0||t<0)continue;const z=1/(u/a[2]+v/b[2]+t/c[2]),k=y*W+x;if(z<depth[k]){depth[k]=z;pixels.set([...colour,255],k*4);}}
  }
  const stride=c.meshStride;
  for(let j=0;j<h-stride;j+=stride)for(let i=0;i<w-stride;i+=stride){const k=j*w+i;if(P.grid.north-j*cell>=220&&world.filled.patches.index.has(k))continue;const dx=(world.heights[k+stride]-world.heights[k])/(cell*stride),dy=(world.heights[k]-world.heights[k+stride*w])/(cell*stride),light=Math.max(0,(-dx*c.light[0]-dy*c.light[1]+c.light[2])/Math.hypot(dx,dy,1)),gain=c.shadeAmbient+c.shadeGain*light;
    const sea=[28,96,107],transmission=Math.exp(world.heights[k]*c.seaAbsorption);
    const colour=world.heights[k]<=0?sea.map((v,q)=>Math.round(v+(rgb[k*3+q]-v)*transmission)):[0,1,2].map(q=>Math.round(rgb[k*3+q]*gain));const a=point(i,j),b=point(i+stride,j),d=point(i,j+stride),e=point(i+stride,j+stride);tri(a,b,d,colour);tri(b,e,d,colour);}
  for(const [key,k] of world.filled.patches.index){
    const j=Math.floor(key/w),i=key%w,step=cell/4;
    if(P.grid.north-j*cell<220)continue;
    for(let r=0;r<4;r++)for(let a=0;a<4;a++){
      const x=P.grid.west+(i+.5)*cell+a*step,y=P.grid.north-(j+.5)*cell-r*step,h=world.filled.patches.heights;
      const at=(u,v)=>project(x+u*step,y-v*step,h[k*25+(r+v)*5+a+u]);
      const colour=[0,1,2].map(q=>rgb[(j*w+i)*3+q]);tri(at(0,0),at(1,0),at(0,1),colour);tri(at(1,0),at(1,1),at(0,1),colour);
    }
  }
  const quad=(a,b,c,d,colour)=>{tri(a,b,c,colour);tri(a,c,d,colour);};
  // The river water is intentionally distinguished from the authored dark bed below it.
  for(let i=1;i<world.field.river.length;i++){const a=world.field.river[i-1],b=world.field.river[i];quad(project(a.x-a.width/2,a.y,a.water+.05),project(a.x+a.width/2,a.y,a.water+.05),project(b.x+b.width/2,b.y,b.water+.05),project(b.x-b.width/2,b.y,b.water+.05),[39,103,96]);}
  function block(x,y,base,width,length,height,colour,yaw=0){const co=Math.cos(yaw),si=Math.sin(yaw),p=(u,v,z)=>project(x+co*u+si*v,y+si*u-co*v,z),v=[[-1,-1],[1,-1],[1,1],[-1,1]],bottom=v.map(([u,v])=>p(u*width/2,v*length/2,base)),top=v.map(([u,v])=>p(u*width/2,v*length/2,base+height));quad(...top,colour);for(let i=0;i<4;i++){const j=(i+1)%4;quad(bottom[i],bottom[j],top[j],top[i],colour.map(v=>Math.round(v*.75)));}}
  for(const h of world.filled.houses.instances){const b=houseBox(world.filled.houses.kinds.get(h.kind),h.matrix),y=northOffset-b.z;block(b.x,y,world.field.sample(b.x,y).h,b.w,b.d,b.height||6,[109,83,55],b.rotY);}
  for(const n of world.nodes){
    if(n.part==='stairs'&&P.emit.polish){
      const c=P.stairs;
      for(const [i,p]of world.stairs.steps.entries()){
        const length=i===world.stairs.steps.length-1?c.landing:world.stairs.tread;
        block(0,p.y+length/2,p.top-c.embed,c.width,length,c.embed,c.colour);
      }
      for(const sign of [-1,1]){
        const x=sign*(c.width+c.ear)/2,a=P.shrine.stairSouth,b=P.shrine.stairNorth,lo=P.shrine.lower[4]+c.earLift,hi=lo+c.totalRise;
        quad(project(x-c.ear/2,a,lo),project(x+c.ear/2,a,lo),project(x+c.ear/2,b,hi),project(x-c.ear/2,b,hi),c.colour.map(v=>v*c.edgeDark));
      }
      continue;
    }
    const x=n.anchor_xz[0],y=northOffset-n.anchor_xz[1],h=world.field.sample(x,y).h;if(world.scene!=='escape'&&n.facility==='daibutsuden'&&n.part==='hall'){const w=n.bbox_max[0]-n.bbox_min[0],d=n.bbox_max[2]-n.bbox_min[2];for(const side of [-1,1])for(const end of [-1,1])block(x+side*w/2,y+end*d/2,h,1,1,n.bbox_max[1],[88,76,55]);continue;}block(x,y,h,n.bbox_max[0]-n.bbox_min[0],n.bbox_max[2]-n.bbox_min[2],n.bbox_max[1],n.facility==='tsurugaoka'?[154,57,32]:n.part==='buddha'?[59,108,87]:[88,76,55]);}
  const terrain=createKamakuraTerrain(world.filled),works=prepareWorks(JSON.parse(world.files.get('works.json')),terrain);
  for(const r of works.rocks)block(r.x,northOffset-r.z,r.ground,r.size,r.size,r.height,[111,108,94]);
  for(const p of works.piers)for(const s of p.spans)block(s.x,northOffset-s.z,p.deck,p.width,s.length,.12,[121,90,55],Math.atan2(s.ux,s.uz));
  for(const b of works.moorings)block(b.x,northOffset-b.z,0,b.w,b.d,.8,[88,58,34],b.yaw);
  for(const b of bridgeSites(world.filled,terrain))block(b.x,northOffset-b.z,b.y??terrain.heightAt(b.x,b.z)+2,b.span,b.width??5,.3,[121,90,55]);
  for(const t of world.veg){
    const y=northOffset-t[1],centre=crownPoint(t[0],y,t[2],0,0,t[4]*.7,t[11],t[3]),p=project(...centre),edge=project(centre[0]+t[5],centre[1],centre[2]),r=Math.max(.7,Math.abs(edge[0]-p[0]));
    if(p[2]<=0)continue;
    const colour=mapVeg({sourceSpecies:t[6],tier:0,variant:t[8],tint:t[9]}).color.map(v=>255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055));
    for(let v=Math.max(0,Math.floor(p[1]-r));v<=Math.min(H-1,p[1]+r);v++)for(let u=Math.max(0,Math.floor(p[0]-r));u<=Math.min(W-1,p[0]+r);u++){
      const nx=(u-p[0])/r,ny=-(v-p[1])/r,q=nx*nx+ny*ny;if(q>1)continue;
      const nz=Math.sqrt(1-q),k=v*W+u,z=p[2]-nz*t[5];
      if(z<depth[k]){
        const sun=Math.max(0,nx*c.light[0]+ny*c.light[2]-nz*c.light[1]),gain=(c.shadeAmbient+c.shadeGain*sun)*(1+t[9]*.2),base=colour;
        depth[k]=z;pixels.set([...base.map(v=>Math.round(v*gain)),255],k*4);
      }
    }
  }
  await fs.writeFile(path.join(directory,'07-overlook.png'),encodePNG({width:W,height:H,data:pixels}));
}
