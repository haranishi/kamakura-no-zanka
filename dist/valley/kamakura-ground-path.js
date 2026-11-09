import { CONTACT } from './kamakura-ground-contact.js';
import { soilHash, smooth } from './kamakura-ground-pattern.js';
// W2c-12 GD4: grass-free routes -> world-anchored, irregular packed-earth support.
export const pathRadius=p=>Number.isFinite(p.width_m)&&p.width_m>0?p.width_m/2:2.5;
export function segmentWeight(s,x,z) {
  const dx=x-s.x,dz=z-s.z,t=Math.max(0,Math.min(1,(dx*s.dx+dz*s.dz)/(s.dx*s.dx+s.dz*s.dz||1)));
  const u=dx-t*s.dx,v=dz-t*s.dz,squared=u*u+v*v;
  if(squared>=s.r*s.r)return 0;
  if(!s.water && squared<=Math.min(1.2,s.r*.375)**2)return 1;
  const d=Math.sqrt(squared);
  if(s.water)return 1-smooth(s.r-2,s.r,d);
  const edge=s.r*(.75+.25*soilHash(Math.floor(x/2),Math.floor(z/2)));
  return 1-smooth(Math.min(1.2,edge*.5),edge,d);
}
export function createPathField(water=false) {
  const {size,cell,span,move}=CONTACT,bytes=new Uint8Array(size*size);
  let cx=Infinity,cz=Infinity,revision=0,old=null,snapshot=[],segments=[];
  function update(pos,paths={}) {
    let dirty=old!==paths,k=0;
    // Compare scalar snapshots, including in-place edits, without allocating on stable frames.
    for(const id in paths){const p=paths[id];
      const oldId=snapshot[k++],oldRadius=snapshot[k++];if(oldId!==id||oldRadius!==pathRadius(p))dirty=true;
      for(const q of p.xyz_m){const x=snapshot[k++],y=snapshot[k++];if(x!==q[0]||y!==q[1])dirty=true;}
    }
    if(k!==snapshot.length)dirty=true;
    if(!dirty&&Math.hypot(pos.x-cx,pos.z-cz)<move)return false;
    if(dirty){old=paths;snapshot=[];segments=[];
      for(const id in paths){const p=paths[id],r=pathRadius(p);snapshot.push(id,r);
        for(const q of p.xyz_m)snapshot.push(q[0],q[1]);
        for(let i=1;i<p.xyz_m.length;i++){const a=p.xyz_m[i-1],b=p.xyz_m[i];segments.push({x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1],r,water});}
      }
    }
    cx=Math.round(pos.x/cell)*cell;cz=Math.round(pos.z/cell)*cell;bytes.fill(0);
    const x0=cx-span/2,z0=cz-span/2;
    for(const s of segments){
      const lo=Math.max(0,Math.ceil((Math.min(s.z,s.z+s.dz)-s.r-z0)/cell-.5));
      const hi=Math.min(size-1,Math.floor((Math.max(s.z,s.z+s.dz)+s.r-z0)/cell-.5));
      for(let j=lo;j<=hi;j++){
        const z=z0+(j+.5)*cell;
        // Intersect each row's support strip before the exact capsule test (long diagonals stay cheap).
        let a=0,b=1;
        if(Math.abs(s.dz)>1e-12){a=Math.max(0,Math.min((z-s.r-s.z)/s.dz,(z+s.r-s.z)/s.dz));b=Math.min(1,Math.max((z-s.r-s.z)/s.dz,(z+s.r-s.z)/s.dz));}
        const xa=s.x+s.dx*a,xb=s.x+s.dx*b;
        const i0=Math.max(0,Math.ceil((Math.min(xa,xb)-s.r-x0)/cell-.5)),i1=Math.min(size-1,Math.floor((Math.max(xa,xb)+s.r-x0)/cell-.5));
        for(let i=i0;i<=i1;i++){const n=j*size+i;bytes[n]=Math.max(bytes[n],Math.round(255*segmentWeight(s,x0+(i+.5)*cell,z)));}
      }
    }
    revision++;return true;
  }
  return {bytes,update,get x(){return cx-span/2;},get z(){return cz-span/2;},get revision(){return revision;},at(x,z){
    const i=Math.floor((x-(cx-span/2))/cell),j=Math.floor((z-(cz-span/2))/cell);
    return i<0||j<0||i>=size||j>=size?0:bytes[j*size+i]/255;
  }};
}
const owners=new WeakMap();
export const groundPathFor=data=>owners.get(data);
export function installGroundPath(THREE,data,owner,contact,quality) {
  const field=createPathField(),water=createPathField(true),rivers={};
  // Static river widths exclude bed and the first three metres of bank from open-land mottling.
  for(const r of data.rivers?.rivers||[])for(let i=1;i<r.xy_m.length;i++)rivers[`${r.id}:${i}`]={xyz_m:[r.xy_m[i-1],r.xy_m[i]],width_m:Math.max(r.width_m[i-1],r.width_m[i])+6};
  const bytes=new Uint8Array(CONTACT.size*CONTACT.size*3);
  bytes.fill(255,0,field.bytes.length);
  // One fixed-size R8 atlas from the first upload: no texStorage2D resize, no extra sampler.
  contact.texture.image={data:bytes,width:CONTACT.size,height:CONTACT.size*3};contact.texture.needsUpdate=true;
  const uniforms={uGround7:{value:1},uGround7Fine:{value:quality==='light'?0:1},uGroundPathOrigin:{value:new THREE.Vector2()}};
  Object.assign(owner.uniforms,uniforms);
  let disposed=false,contactRevision=-1;
  const view={field,uniforms,update(pos,paths){
    if(disposed||uniforms.uGround7.value<=0)return false;
    const changed=field.update(pos,paths);
    if(changed){water.update(pos,rivers);bytes.set(water.bytes,field.bytes.length*2);bytes.set(field.bytes,field.bytes.length);uniforms.uGroundPathOrigin.value.set(field.x,field.z);}
    if(contactRevision!==contact.field.revision){bytes.set(contact.field.bytes);contactRevision=contact.field.revision;contact.texture.needsUpdate=true;}
    if(changed)contact.texture.needsUpdate=true;
    return changed;
  }};
  owners.set(data,view);
  const oldAdapt=owner.setAdapt,oldDispose=owner.dispose;
  owner.setAdapt=function(policy){oldAdapt.call(this,policy);const step=typeof policy==='number'?policy:policy.step;uniforms.uGround7.value=step>=3?0:step>=2?.5:1;uniforms.uGround7Fine.value=quality==='light'||step>=2?0:1;};
  owner.dispose=function(){if(disposed)return;disposed=true;if(owners.get(data)===view)owners.delete(data);oldDispose.call(this);};
  return view;
}
