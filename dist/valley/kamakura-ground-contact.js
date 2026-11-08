import { smooth } from './kamakura-ground-pattern.js';

// W2c-11 ground6: no contact -> a view-centred, deterministic half-metre field.
export const CONTACT = Object.freeze({ size:256, cell:.5, span:128, move:12, reach:1.2, edge:.45 });
export function contactBoxDistance(b,x,z) {
  const c=Math.cos(b.rotY||0),s=Math.sin(b.rotY||0),dx=x-b.x,dz=z-b.z;
  return Math.hypot(Math.max(0,Math.abs(c*dx-s*dz)-b.w/2),Math.max(0,Math.abs(s*dx+c*dz)-b.d/2));
}
export const contactFactor=(distance,reach=CONTACT.reach)=>CONTACT.edge+(1-CONTACT.edge)*smooth(0,reach,distance);
export function contactAt(boxes,circles,x,z) {
  let ao=1;
  for(const b of boxes)ao=Math.min(ao,contactFactor(contactBoxDistance(b,x,z)));
  for(const c of circles)if(c.r>0)ao=Math.min(ao,contactFactor(Math.max(0,Math.hypot(x-c.x,z-c.z)-c.r),2*c.r));
  return ao;
}
export function createContactField() {
  const {size,cell,span,move}=CONTACT,bytes=new Uint8Array(size*size).fill(255);
  let cx=Infinity,cz=Infinity,oldBoxes=null,oldCircles=null,shapes=[],revision=0;
  function changed(boxes,circles) {
    if(oldBoxes!==boxes||oldCircles!==circles||shapes.length!==boxes.length+circles.length)return true;
    let k=0;
    for(const b of boxes){const o=shapes[k++];if(o.x!==b.x||o.z!==b.z||o.w!==b.w||o.d!==b.d||o.rotY!==(b.rotY||0))return true;}
    for(const c of circles){const o=shapes[k++];if(o.x!==c.x||o.z!==c.z||o.r!==c.r)return true;}
    return false;
  }
  function update(pos,boxes,circles) {
    const dirty=changed(boxes,circles);
    if(!dirty&&Math.hypot(pos.x-cx,pos.z-cz)<move)return false;
    if(dirty){
      shapes=[];oldBoxes=boxes;oldCircles=circles;
      for(const b of boxes){const rotY=b.rotY||0,c=Math.cos(rotY),s=Math.sin(rotY);
        shapes.push({x:b.x,z:b.z,w:b.w,d:b.d,rotY,c,s,ex:Math.abs(c)*b.w/2+Math.abs(s)*b.d/2+CONTACT.reach,ez:Math.abs(s)*b.w/2+Math.abs(c)*b.d/2+CONTACT.reach,reach:CONTACT.reach});}
      for(const c of circles)shapes.push({x:c.x,z:c.z,r:c.r,ex:3*c.r,ez:3*c.r,reach:2*c.r});
    }
    cx=Math.round(pos.x/cell)*cell;cz=Math.round(pos.z/cell)*cell;bytes.fill(255);
    const x0=cx-span/2,z0=cz-span/2;
    // Raster only each object's support, not every object at every pixel.
    for(const o of shapes){
      if(o.reach<=0)continue;
      const i0=Math.max(0,Math.ceil((o.x-o.ex-x0)/cell-.5)),i1=Math.min(size-1,Math.floor((o.x+o.ex-x0)/cell-.5));
      const j0=Math.max(0,Math.ceil((o.z-o.ez-z0)/cell-.5)),j1=Math.min(size-1,Math.floor((o.z+o.ez-z0)/cell-.5));
      for(let j=j0;j<=j1;j++)for(let i=i0;i<=i1;i++){
        const dx=x0+(i+.5)*cell-o.x,dz=z0+(j+.5)*cell-o.z;
        let distance;
        if(o.r!==undefined){
          const squared=dx*dx+dz*dz;
          if(squared>=o.ex*o.ex)continue;
          distance=squared<=o.r*o.r?0:Math.sqrt(squared)-o.r;
        }else{
          const u=Math.max(0,Math.abs(o.c*dx-o.s*dz)-o.w/2),v=Math.max(0,Math.abs(o.s*dx+o.c*dz)-o.d/2);
          const squared=u*u+v*v;if(squared>=o.reach*o.reach)continue;
          distance=Math.sqrt(squared);
        }
        const k=j*size+i;bytes[k]=Math.min(bytes[k],Math.round(contactFactor(distance,o.reach)*255));
      }
    }
    revision++;return true;
  }
  return {bytes,update,get x(){return cx-span/2;},get z(){return cz-span/2;},get revision(){return revision;},at(x,z){
    const i=Math.floor((x-(cx-span/2))/cell),j=Math.floor((z-(cz-span/2))/cell);
    return i<0||j<0||i>=size||j>=size?1:bytes[j*size+i]/255;
  }};
}
const owners=new WeakMap();
export const groundContactFor=data=>owners.get(data);
export function installGroundContact(THREE,data,owner,quality) {
  const field=createContactField(),texture=new THREE.DataTexture(field.bytes,CONTACT.size,CONTACT.size,THREE.RedFormat);
  texture.internalFormat='R8';texture.minFilter=texture.magFilter=THREE.LinearFilter;texture.generateMipmaps=false;texture.unpackAlignment=1;texture.needsUpdate=true;
  const uniforms={uGroundContact:{value:texture},uGroundContactOrigin:{value:new THREE.Vector2()},uGround6:{value:quality==='light'?.5:1},uGround6Fine:{value:quality==='light'?0:1}};
  let disposed=false;
  const view={field,texture,uniforms,update(pos,boxes,circles){if(disposed||uniforms.uGround6.value<=0)return false;
    if(!field.update(pos,boxes,circles))return false;
    uniforms.uGroundContactOrigin.value.set(field.x,field.z);texture.needsUpdate=true;return true;
  }};
  owners.set(data,view);Object.assign(owner.uniforms,uniforms);
  const oldAdapt=owner.setAdapt,oldDispose=owner.dispose;
  owner.setAdapt=function(policy){oldAdapt.call(this,policy);const step=typeof policy==='number'?policy:policy.step;uniforms.uGround6.value=step>=3?0:(quality==='light'?.5:1)*(step>=2?.5:1);uniforms.uGround6Fine.value=quality==='light'||step>=2?0:1;};
  owner.dispose=function(){if(disposed)return;disposed=true;if(owners.get(data)===view)owners.delete(data);texture.dispose();oldDispose.call(this);};
  return view;
}
