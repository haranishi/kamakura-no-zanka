import * as THREE from '../vendor/three.module.min.js';
import { CRAG as C, cragEnabled, buildCrags, CRAG_VERTEX_PARS, CRAG_VERTEX, CRAG_FRAGMENT_PARS, CRAG_FRAGMENT, CRAG_NORMAL } from './kamakura-crag.js';

// The close-up rock surface is added to the standard material at its named anchors; a missing anchor is an error, not a silent skip.
export function cragShader(shader) {
  const put=(text,anchor,extra)=>{if(!text.includes(anchor))throw new Error('Crag shader anchor missing: '+anchor);return text.replace(anchor,anchor+'\n'+extra);};
  shader.vertexShader=put(put(shader.vertexShader,'#include <common>',CRAG_VERTEX_PARS),'#include <begin_vertex>',CRAG_VERTEX);
  shader.fragmentShader=put(put(put(shader.fragmentShader,'#include <common>',CRAG_FRAGMENT_PARS),'#include <color_fragment>',CRAG_FRAGMENT),'#include <normal_fragment_maps>',CRAG_NORMAL);
  return shader;
}

export function createKamakuraCrag(context) {
  if(!cragEnabled(context.search)||!context.data?.works?.crags?.length)return null;
  const q=new URLSearchParams(context.search),debug=q.get('cragdebug')==='1',lods=[];
  // All four adaptive shapes are prepared once. Changing quality never builds triangles in a frame.
  try { for(let step=0;step<4;step++) {
    const plan=buildCrags(context.data.works.crags,context.terrain,{quality:context.quality,step,debug,dip:q.get('cragdip')!=='0',minimumScale:step?lods[step-1].plan.scale*C.adaptScale:1});
    const geometry=new THREE.BufferGeometry();
    geometry.setAttribute('position',new THREE.BufferAttribute(plan.positions,3));
    geometry.setAttribute('normal',new THREE.BufferAttribute(plan.normals,3));
    geometry.setAttribute('color',new THREE.BufferAttribute(plan.colors,3));
    geometry.setAttribute('cragBed',new THREE.BufferAttribute(plan.beds,1));
    const indices=new Uint32Array(plan.positions.length/3);
    geometry.setIndex(new THREE.BufferAttribute(indices,1).setUsage(THREE.DynamicDrawUsage));
    geometry.computeBoundingSphere();
    const bounds=plan.plans.map((p,i)=>{
      let x=0,y=0,z=0;for(const b of p.blocks){x+=b.point[0];y+=b.top;z-=b.point[1];}
      x/=p.blocks.length;y/=p.blocks.length;z/=p.blocks.length;
      let radius=0;for(const b of p.blocks)for(const v of b.polygon)radius=Math.max(radius,Math.hypot(v[0]-x,b.top-y,-v[1]-z),Math.hypot(v[0]-x,b.base-y,-v[1]-z));
      if(p.natural){const r=plan.ranges[i];for(let k=r.start*3;k<(r.start+r.count)*3;k+=3)radius=Math.max(radius,Math.hypot(plan.positions[k]-x,plan.positions[k+1]-y,plan.positions[k+2]-z));}
      return {x,y,z,radius};
    });
    lods.push({plan,geometry,bounds,mask:-1,triangles:0,blocks:0,crags:0});
  }
  } catch(error) {for(const lod of lods)lod.geometry.dispose();throw error;}
  const material=new THREE.MeshStandardMaterial({vertexColors:true,roughness:C.roughness,metalness:C.metalness});
  if(!debug&&q.get('craglook')!=='0'){material.onBeforeCompile=cragShader;material.customProgramCacheKey=()=>'kamakura-crag-look';}
  const mesh=new THREE.Mesh(lods[0].geometry,material);mesh.name='kamakura-crag';mesh.castShadow=true;mesh.receiveShadow=true;
  mesh.frustumCulled=false;context.scene.add(mesh);
  let step=0,disposed=false,camera=context.camera;
  function apply() {
    const lod=lods[step],far=(context.quality==='light'?C.farLight:C.far)*(1-step*C.adaptDistance),eye=camera?.position;
    let mask=0;
    for(let i=0;i<lod.bounds.length;i++) {
      const b=lod.bounds[i];if(!eye||Math.hypot(eye.x-b.x,eye.y-b.y,eye.z-b.z)-b.radius<=far)mask|=1<<i;
    }
    mesh.geometry=lod.geometry;
    if(mask!==lod.mask) {
      let cursor=0;lod.crags=0;lod.blocks=0;
      const indices=lod.geometry.index.array;
      for(let i=0;i<lod.plan.ranges.length;i++)if(mask&(1<<i)) {
        const r=lod.plan.ranges[i];lod.crags++;lod.blocks+=r.blocks;
        for(let k=r.start;k<r.start+r.count;k++)indices[cursor++]=k;
      }
      lod.mask=mask;lod.triangles=cursor/3;lod.geometry.setDrawRange(0,cursor);lod.geometry.index.needsUpdate=true;
    }
    mesh.visible=lod.triangles>0;
  }
  apply();
  function inspect() {
    const lod=lods[step],eye=camera?.position;let nearest=null,distance=Infinity;
    if(eye)for(let i=0;i<lod.plan.plans.length;i++)if(lod.mask&(1<<i))for(const b of lod.plan.plans[i].blocks) {
      const dx=b.point[0]-eye.x,dz=-b.point[1]-eye.z,d=Math.hypot(dx,b.top-eye.y,dz);
      if(d<distance){distance=d;nearest={id:b.id,distance:d,bearing:(Math.atan2(dx,-dz)*180/Math.PI+360)%360};}
    }
    return {crags:disposed?0:lod.crags,blocks:disposed?0:lod.blocks,triangles:disposed?0:lod.triangles,draws:!disposed&&mesh.visible?1:0,
      dip:disposed?[]:lod.plan.plans.filter((_,i)=>lod.mask&(1<<i)).map(p=>({id:p.id,degrees:p.natural?p.dip:0,bearing:p.direction})),
      strong:disposed?0:lod.plan.ranges.reduce((n,r,i)=>n+((lod.mask&(1<<i))?r.strong:0),0),lowered:disposed?0:lod.plan.ranges.reduce((n,r,i)=>n+((lod.mask&(1<<i))?r.lowered:0),0),
      scale:lod.plan.scale,tallest:lod.plan.tallest,nearest,work:lod.plan.work,preparedLods:lods.length};
  }
  if(q.get('debug')==='1')globalThis.__kzCrag=inspect;
  return {mesh,lods,update(frame){if(disposed)return;camera=frame?.camera??camera;apply();},
    setAdapt(value){if(disposed)return;step=Math.max(0,Math.min(3,Math.floor(typeof value==='number'?value:value.step)));apply();},
    dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();for(const lod of lods)lod.geometry.dispose();material.dispose();if(globalThis.__kzCrag===inspect)delete globalThis.__kzCrag;},
  };
}
