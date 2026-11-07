// W2c-9e2: coarse river raster -> terrain-draped ribbon outside each water edge.
export const BANK_WIDTH=1.5;
export function bankRibbon(ribbon,terrain,width=BANK_WIDTH){
  const positions=[],uvs=[],indices=[],p=ribbon.positions;
  for(let k=0;k<ribbon.indices.length;k+=6){
    const a=ribbon.indices[k],b=ribbon.indices[k+2];
    const length=Math.hypot(p[b*3]-p[a*3],p[b*3+2]-p[a*3+2]),steps=Math.max(1,Math.ceil(length/4));
    for(const side of [0,1]){
      const start=positions.length/3;
      for(let j=0;j<=steps;j++){
        const t=j/steps,edge=a+side,end=b+side,opposite=a+1-side,oppositeEnd=b+1-side;
        const x=p[edge*3]*(1-t)+p[end*3]*t,z=p[edge*3+2]*(1-t)+p[end*3+2]*t;
        const ox=p[opposite*3]*(1-t)+p[oppositeEnd*3]*t,oz=p[opposite*3+2]*(1-t)+p[oppositeEnd*3+2]*t;
        const l=Math.max(.001,Math.hypot(x-ox,z-oz));
        for(const u of [0,1]){const xx=x+(x-ox)/l*width*u,zz=z+(z-oz)/l*width*u;
          positions.push(xx,terrain.heightAt(xx,zz)+.015,zz);uvs.push(u,0);}
      }
      for(let j=0;j<steps;j++){const q=start+j*2;indices.push(q,q+2,q+1,q+1,q+2,q+3);}
    }
  }
  return {positions:new Float32Array(positions),uvs:new Float32Array(uvs),indices};
}
export function buildBankWet(THREE,prepared,terrain,{search=''}={}){
  const group=new THREE.Group();group.name='kamakura-bank-wet';let disposed=false;
  if(!terrain||new URLSearchParams(search).get('seav')==='0')return {group,dispose(){}};
  const material=new THREE.MeshBasicMaterial({color:0x514b40,transparent:true,opacity:.58,depthWrite:false,side:THREE.DoubleSide});material.fog=true;
  material.onBeforeCompile=s=>{
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vBankUv;varying vec3 vBankWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvBankUv=uv;vBankWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nvarying vec2 vBankUv;varying vec3 vBankWorld;').replace('#include <color_fragment>',`#include <color_fragment>
      float bankFilter=1.0-smoothstep(.1,.7,length(fwidth(vBankWorld.xz)));
      float bankMottle=.5+.5*sin(vBankWorld.x*7.1+sin(vBankWorld.z*4.7))*bankFilter;
      diffuseColor.rgb*=mix(.75,1.2,bankMottle);
      diffuseColor.a*=(1.0-smoothstep(0.0,1.0,vBankUv.x))*(1.0-smoothstep(${(prepared.policy.maxDistance-128).toFixed(1)},${prepared.policy.maxDistance.toFixed(1)},distance(cameraPosition.xz,vBankWorld.xz)));`);
  };
  for(const ribbon of prepared.ribbons){const f=bankRibbon(ribbon,terrain);if(!f.indices.length)continue;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(f.positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(f.uvs,2));g.setIndex(f.indices);g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,material);mesh.renderOrder=1;group.add(mesh);
  }
  return {group,material,dispose(){if(disposed)return;disposed=true;for(const m of group.children)m.geometry.dispose();group.clear();group.removeFromParent();material.dispose();}};
}
