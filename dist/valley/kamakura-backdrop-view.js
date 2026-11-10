// W2c-18 seaedge: build after the first rendered frame, then leave the CPU idle.
import * as THREE from '../vendor/three.module.min.js';
import { BACKDROP, backdropEnabled, backdropRange, buildBackdrop } from './kamakura-backdrop.js';

export function createKamakuraBackdrop({scene,terrain,camera,search='',quality='standard'}) {
  if(!backdropEnabled(search))return null;
  const q=new URLSearchParams(search),debug=q.get('debug')==='1',colors=q.get('backdropdebug')==='1';
  const group=new THREE.Group(),meshes=[];group.name='kamakura-backdrop';
  let disposed=false,ready=false,pending=false,frames=0,step=0,timer=null,prepared=null,failure=null;
  function applyAdapt(){
    const range=backdropRange(quality,step);
    for(let i=0;i<meshes.length;i++){
      const mesh=meshes[i],segment=prepared.segments[i];let count=0;
      for(const band of segment.bands)if(band.distance<=range)count=band.count;
      mesh.geometry.setDrawRange(0,count);mesh.visible=count>0;
    }
  }
  function release(){
    for(const mesh of meshes){mesh.geometry.dispose();mesh.material.dispose();}
    meshes.length=0;group.removeFromParent();ready=false;prepared=null;
  }
  function build(){
    timer=null;if(disposed)return;
    try{
      prepared=buildBackdrop(terrain,{quality});
      for(const segment of prepared.segments){
        const geometry=new THREE.BufferGeometry();
        const material=colors?new THREE.MeshBasicMaterial({color:segment.outer?BACKDROP.debugFar:BACKDROP.debugNear,fog:false,toneMapped:false}):new THREE.MeshLambertMaterial({vertexColors:true,fog:true});
        // Register resources before populating: a failed attribute/normal build still releases both once.
        const mesh=new THREE.Mesh(geometry,material);meshes.push(mesh);
        geometry.setAttribute('position',new THREE.BufferAttribute(segment.positions,3));
        geometry.setAttribute('color',new THREE.BufferAttribute(segment.colors,3));
        geometry.setIndex(new THREE.BufferAttribute(segment.indices,1));geometry.computeVertexNormals();geometry.computeBoundingSphere();
        mesh.castShadow=false;mesh.receiveShadow=false;mesh.updateMatrix();mesh.matrixAutoUpdate=false;group.add(mesh);
      }
      applyAdapt();scene.add(group);ready=true;
    }catch(error){failure=error;release();console.warn('Kamakura backdrop closed:',error);}
  }
  const reader=()=>{
    let triangles=0,draws=0,distance=Infinity,bearing=null;
    for(const mesh of meshes){
      if(!mesh.visible)continue;draws++;triangles+=mesh.geometry.drawRange.count/3;
      const p=mesh.geometry.attributes.position.array,indices=mesh.geometry.index.array;
      for(let k=0;k<mesh.geometry.drawRange.count;k++){const i=indices[k]*3,dx=p[i]-camera.position.x,dy=p[i+1]-camera.position.y,dz=p[i+2]-camera.position.z,d=Math.hypot(dx,dy,dz);
        if(d<distance){distance=d;bearing=(Math.atan2(dx,-dz)*180/Math.PI+360)%360;}}
    }
    return {ready,triangles,draws,landEdges:prepared?.landEdges??null,maxHeight:prepared?.maxHeight??0,work:prepared?.work??null,error:failure?.message??null,nearest:{distance:Number.isFinite(distance)?distance:null,bearing}};
  };
  if(debug)globalThis.__kzBackdrop=reader;
  const layer={group,meshes,
    update(){
      if(disposed||pending||++frames<2)return;
      pending=true;timer=setTimeout(build,0);delete layer.update;
    },
    setAdapt(value){step=typeof value==='number'?value:value.step;if(ready)applyAdapt();},
    dispose(){if(disposed)return;disposed=true;if(timer!==null)clearTimeout(timer);release();if(globalThis.__kzBackdrop===reader)delete globalThis.__kzBackdrop;}
  };
  return layer;
}
