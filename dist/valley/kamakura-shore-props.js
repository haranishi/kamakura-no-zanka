import { createSurfaceCodeAt } from './kamakura-surface.js';
import { shoreHash, shorePropAt } from './kamakura-shore.js';
const SHORE_COLORS=[0xb3a590,0x6d716b,0x665343,0x4c5140];
// W2c-9e: bare sand -> deterministic, bounded local shell/pebble/wrack window.
// THREE is injected, keeping ownership and the bundled Node harness explicit.
export function buildShoreProps(THREE, terrain, data, quality='standard') {
  const group=new THREE.Group(), cap=quality==='light'?120:300;
  const geometry=new THREE.OctahedronGeometry(1,0), material=new THREE.MeshLambertMaterial({color:0xffffff});
  let mesh=new THREE.InstancedMesh(geometry,material,cap), spare=new THREE.InstancedMesh(geometry,material,cap);
  for(const item of [mesh,spare]){item.count=0;item.frustumCulled=false;item.receiveShadow=true;group.add(item);}spare.visible=false;
  const codeAt=createSurfaceCodeAt(data.meta,data.surface), dummy=new THREE.Object3D(), color=new THREE.Color();
  // Four silhouettes share one 8-triangle geometry; no per-frame allocation.
  let cx=Infinity,cz=Infinity,step=0,cursor=0,count=0,pending=false,disposed=false;
  function update(pos) {
    if(disposed||step>=2)return;
    if(!pending&&Math.floor(pos.x/4)===cx&&Math.floor(pos.z/4)===cz)return;
    const ix=Math.floor(pos.x/4),iz=Math.floor(pos.z/4);
    if(ix!==cx||iz!==cz){cx=ix;cz=iz;cursor=0;count=0;pending=true;spare.count=0;}
    // 36x36 cells at 2m; <=96 candidates per frame, real 30m circle clipped in shader.
    for(let n=0;n<96&&pending;n++) {
      const a=cursor%36-18,b=Math.floor(cursor/36)-18,x=(cx*2+a)*2,z=(cz*2+b)*2;
      if(++cursor>=1296)pending=false;
      const h=shoreHash(x,z);if(h>.3||count>=cap||Math.hypot(x-pos.x,z-pos.z)>30||!shorePropAt(terrain,codeAt,x,z))continue;
      const type=Math.floor(h/.075),s=.06+shoreHash(x,z,12)*.12;
      dummy.position.set(x,terrain.heightAt(x,z)+.035,z);dummy.rotation.set(0,shoreHash(x,z,3)*6.283,0);
      dummy.scale.set(type===2?s*5:s,type===0?s*.25:s*.45,type===3?s*2:s);dummy.updateMatrix();spare.setMatrixAt(count,dummy.matrix);
      color.setHex(SHORE_COLORS[type]);spare.setColorAt(count,color);count++;
    }
    if(!pending){
      spare.count=count;spare.instanceMatrix.needsUpdate=true;if(spare.instanceColor)spare.instanceColor.needsUpdate=true;
      mesh.visible=false;spare.visible=true;const old=mesh;mesh=spare;spare=old;
    }
  }
  material.onBeforeCompile=shader=>{
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vShoreProp;').replace('#include <project_vertex>','#include <project_vertex>\nvShoreProp=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vShoreProp;').replace('#include <color_fragment>','#include <color_fragment>\nif(distance(vShoreProp.xz,cameraPosition.xz)>30.0)discard;');
  };
  return {group,get mesh(){return mesh;},update,setAdapt(value){step=typeof value==='number'?value:value.step;group.visible=step<2;if(step<2)cx=Infinity;},dispose(){if(disposed)return;disposed=true;group.removeFromParent();mesh.dispose();spare.dispose();geometry.dispose();material.dispose();}};
}
