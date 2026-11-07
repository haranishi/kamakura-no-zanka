import { shoreHash, shorePropAt, riverPropAt } from './kamakura-shore.js';
// W2c-9e3: stretched diamond/board -> four readable, life-size solid silhouettes.
export const PROP_SIZES=Object.freeze([[.03,.08],[.10,.25],[.25,.60],[.02,.05]]);
export function shorePropShape(x,z){
  const h=shoreHash(x,z,71),d=shoreHash(x,z,12);
  const type=h<.52?0:h<.83?1:h<.845?2:3;
  const size=PROP_SIZES[type][0]+d*(PROP_SIZES[type][1]-PROP_SIZES[type][0]);
  return {type,size};
}
export function buildShoreProps(THREE,terrain,data,quality='standard',{shore2=false}={}){
  const group=new THREE.Group(),cap=quality==='light'?40:60;
  const geometries=[new THREE.IcosahedronGeometry(.5,0),new THREE.IcosahedronGeometry(.5,0),new THREE.CylinderGeometry(.5,.5,1,3,1),new THREE.ConeGeometry(.5,1,4,1)];
  // Irregular rounded pebbles and weed clumps, never four-sided flat plates.
  for(let type=0;type<2;type++){
    const a=geometries[type].attributes.position;
    for(let i=0;i<a.count;i++){
      const x=a.getX(i),y=a.getY(i),z=a.getZ(i),j=1+.12*Math.sin(x*13+y*17+z*19);
      a.setXYZ(i,x*j,y*(type===1?.35:.72)*j,z*j*(type===1?.8:1));
    }
    geometries[type].computeVertexNormals();
  }
  // W2c-9r1 shore: rounded algae clump -> three tapered, solid weed shoots.
  if(shore2){
    geometries[1].dispose();const vertices=[];
    for(let n=0;n<3;n++){
      const a=n*2.094,x=Math.cos(a)*.16,z=Math.sin(a)*.16,tip=[x+.08*Math.sin(a),.45+n*.08,z+.06*Math.cos(a)];
      for(let k=0;k<4;k++){const b=k*Math.PI/2,d=(k+1)*Math.PI/2;vertices.push(x+Math.cos(b)*.12,0,z+Math.sin(b)*.12,...tip,x+Math.cos(d)*.12,0,z+Math.sin(d)*.12);}
    }
    geometries[1]=new THREE.BufferGeometry();geometries[1].setAttribute('position',new THREE.Float32BufferAttribute(vertices,3));geometries[1].computeVertexNormals();
  }
  geometries[2].rotateZ(Math.PI/2);
  for(const g of geometries)g.computeBoundingBox();
  const material=new THREE.MeshLambertMaterial({color:0xffffff});
  let meshes=geometries.map(g=>new THREE.InstancedMesh(g,material,cap)),spares=geometries.map(g=>new THREE.InstancedMesh(g,material,cap));
  for(const m of [...meshes,...spares]){m.count=0;m.frustumCulled=false;m.castShadow=false;m.receiveShadow=true;group.add(m);}for(const m of spares)m.visible=false;
  const dummy=new THREE.Object3D(),color=new THREE.Color(),counts=new Uint16Array(4);
  const pebbleColors=[0x9c9c90,0xb2aa97,0x928679];
  let cx=Infinity,cz=Infinity,cursor=0,total=0,wood=0,pending=false,disposed=false,step=0;
  function update(pos){
    if(disposed||step>=2)return;
    const ix=Math.floor(pos.x/4),iz=Math.floor(pos.z/4);
    if(!pending&&ix===cx&&iz===cz)return;
    if(ix!==cx||iz!==cz){cx=ix;cz=iz;cursor=0;total=0;wood=0;counts.fill(0);pending=true;for(const m of spares)m.count=0;}
    for(let n=0;n<96&&pending;n++){
      const a=cursor%36-18,b=Math.floor(cursor/36)-18,x=(cx*2+a)*2,z=(cz*2+b)*2;
      if(++cursor>=1296)pending=false;
      // W2c-9r2 shore: 6–19cm river pebbles / tiny shoots -> 18–41cm stones / 0.7–1.3m clumps.
      // W2c-9r1 shore: beach-only scatter -> distance/slope-gated river pebbles and weed.
      const river=shore2&&terrain.riverDistanceAt&&riverPropAt(terrain,x,z);
      const h=shoreHash(x,z);if((!river&&h>.22)||total>=cap||Math.hypot(x-pos.x,z-pos.z)>30||(!river&&!shorePropAt(terrain,null,x,z)))continue;
      let {type,size}=shorePropShape(x,z);
      if(river){type=shoreHash(x,z,34)<.3?1:0;size=type===1?.42+shoreHash(x,z,35)*.30:.18+shoreHash(x,z,36)*.23;}
      if(type===2&&wood>=2)type=0,size=.05;
      const d=terrain.shoreSigned?-terrain.shoreSigned.signedDistanceAt(x,z):terrain.seaDistanceAt(x,z);
      // Weed is concentrated along the high-water wrack, rather than spread inland.
      if(!river&&type===1&&d<7)type=0,size=.05;
      const thick=type===2?.03+shoreHash(x,z,9)*.02:type===3?size*.35:type===1?size*.175:size*.36;
      dummy.position.set(x,terrain.heightAt(x,z)-geometries[type].boundingBox.min.y*(type===2||type===3?thick:size),z);
      let yaw=shoreHash(x,z,3)*6.283;
      if(type===2&&terrain.shoreSigned){const f=terrain.shoreSigned,dx=f.signedDistanceAt(x+1,z)-f.signedDistanceAt(x-1,z),dz=f.signedDistanceAt(x,z+1)-f.signedDistanceAt(x,z-1);yaw=Math.atan2(dx,dz)+(.5-shoreHash(x,z,4))*.35;}
      dummy.rotation.set(0,yaw,0);
      dummy.scale.set(type===2?size:size,type===2?thick:type===3?thick:river&&type===1?size*3:size,type===2?thick:size);dummy.updateMatrix();
      spares[type].setMatrixAt(counts[type],dummy.matrix);
      color.setHex(type===0?pebbleColors[Math.floor(shoreHash(x,z,19)*3)]:type===1?(river?0x596640:0x64634c):type===2?0xaaa18c:0xbcb39d);
      spares[type].setColorAt(counts[type]++,color);total++;if(type===2)wood++;
    }
    if(!pending){
      for(let i=0;i<4;i++){spares[i].count=counts[i];spares[i].instanceMatrix.needsUpdate=true;if(spares[i].instanceColor)spares[i].instanceColor.needsUpdate=true;meshes[i].visible=false;spares[i].visible=true;}
      const old=meshes;meshes=spares;spares=old;
    }
  }
  material.onBeforeCompile=s=>{
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vShoreProp;').replace('#include <project_vertex>','#include <project_vertex>\nvShoreProp=(modelMatrix*instanceMatrix*vec4(position,1.0)).xyz;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec3 vShoreProp;').replace('#include <color_fragment>','#include <color_fragment>\nif(distance(vShoreProp.xz,cameraPosition.xz)>30.0)discard;');
  };
  return {group,get meshes(){return meshes;},get count(){return meshes.reduce((n,m)=>n+m.count,0);},update,
    setAdapt(value){step=typeof value==='number'?value:value.step;group.visible=step<2;if(step<2)cx=Infinity;},
    dispose(){if(disposed)return;disposed=true;group.removeFromParent();for(const m of [...meshes,...spares])m.dispose();for(const g of geometries)g.dispose();material.dispose();}};
}
