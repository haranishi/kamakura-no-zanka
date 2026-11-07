// W2c-9e3: 4m floating quads -> fine normal-offset strips with terrain error refinement.
export const BANK_WIDTH=1.5;
export function bankRibbon(ribbon,terrain,width=BANK_WIDTH){
  const positions=[],uvs=[],indices=[],p=ribbon.positions;
  let rejected=0,folds=0;
  const point=(x,z,u)=>[Math.fround(x),Math.fround(terrain.heightAt(Math.fround(x),Math.fround(z))+.015),Math.fround(z),u];
  const area=(a,b,c)=>(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);
  const mid=(a,b)=>point((a[0]+b[0])/2,(a[2]+b[2])/2,(a[3]+b[3])/2);
  function tri(a,b,c,depth=0){
    if(area(a,b,c)<=1e-10){folds++;return;}
    let error=0,edge=0;
    for(const [v,w] of [[a,b],[b,c],[c,a]]){
      edge=Math.max(edge,Math.hypot(v[0]-w[0],v[1]-w[1],v[2]-w[2]));
      error=Math.max(error,Math.abs((v[1]+w[1])/2-terrain.heightAt((v[0]+w[0])/2,(v[2]+w[2])/2)));
    }
    error=Math.max(error,Math.abs((a[1]+b[1]+c[1])/3-terrain.heightAt((a[0]+b[0]+c[0])/3,(a[2]+b[2]+c[2])/3)));
    if(edge>1.19||error>.019){
      if(depth>=8){rejected++;return;}
      const ab=mid(a,b),bc=mid(b,c),ca=mid(c,a);
      tri(a,ab,ca,depth+1);tri(ab,b,bc,depth+1);tri(ca,bc,c,depth+1);tri(ab,bc,ca,depth+1);return;
    }
    const k=positions.length/3;
    for(const v of [a,b,c]){positions.push(v[0],v[1],v[2]);uvs.push(v[3],0);}
    indices.push(k,k+1,k+2);
  }
  for(let k=0;k<ribbon.indices.length;k+=6){
    const a=ribbon.indices[k],b=ribbon.indices[k+2];
    const ax=(p[a*3]+p[(a+1)*3])/2,az=(p[a*3+2]+p[(a+1)*3+2])/2;
    const bx=(p[b*3]+p[(b+1)*3])/2,bz=(p[b*3+2]+p[(b+1)*3+2])/2;
    const steps=Math.max(1,Math.ceil(Math.hypot(bx-ax,bz-az)/.6));
    for(const side of [0,1]){
      const edge=a+side,end=b+side,other=a+1-side,otherEnd=b+1-side;
      const nax=p[edge*3]-p[other*3],naz=p[edge*3+2]-p[other*3+2],la=Math.hypot(nax,naz);
      const nbx=p[end*3]-p[otherEnd*3],nbz=p[end*3+2]-p[otherEnd*3+2],lb=Math.hypot(nbx,nbz);
      let span=width;
      // On the inside of a bend shorten the normal offset before it can fold.
      const row=(t,u)=>{
        const nx=nax/la*(1-t)+nbx/lb*t,nz=naz/la*(1-t)+nbz/lb*t,l=Math.max(.001,Math.hypot(nx,nz));
        return point(p[edge*3]*(1-t)+p[end*3]*t+nx/l*span*u,p[edge*3+2]*(1-t)+p[end*3+2]*t+nz/l*span*u,u);
      };
      const upward=(a,b,c)=>side===0?area(a,b,c):area(a,c,b);
      while(span>.05&&(upward(row(0,0),row(1,0),row(0,1))<=0||upward(row(0,1),row(1,0),row(1,1))<=0))span*=.5;
      if(span<=.05){folds++;continue;}
      const bands=Math.max(1,Math.ceil(span/.6));
      for(let j=0;j<steps;j++)for(let n=0;n<bands;n++){
        const v=row(j/steps,n/bands),w=row((j+1)/steps,n/bands),x=row(j/steps,(n+1)/bands),y=row((j+1)/steps,(n+1)/bands);
        if(side===0){tri(v,w,x);tri(x,w,y);}else{tri(v,x,w);tri(x,y,w);}
      }
    }
  }
  return {positions:new Float32Array(positions),uvs:new Float32Array(uvs),indices,rejected,folds};
}
export function buildBankWet(THREE,prepared,terrain,{search='',defer=false}={}){
  const group=new THREE.Group();group.name='kamakura-bank-wet';let disposed=false;
  if(!terrain||new URLSearchParams(search).get('seav')==='0'||new URLSearchParams(search).get('bankwet')==='0')return {group,update(){},setAdapt(){},dispose(){}};
  const material=new THREE.MeshBasicMaterial({color:0x514b40,transparent:true,opacity:.58,depthWrite:false,side:THREE.DoubleSide});material.fog=true;
  const uniforms={uBankRange:{value:defer?96:prepared.policy.maxDistance}};
  material.onBeforeCompile=s=>{
    Object.assign(s.uniforms,uniforms);
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vBankUv;varying vec3 vBankWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvBankUv=uv;vBankWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uBankRange;varying vec2 vBankUv;varying vec3 vBankWorld;').replace('#include <color_fragment>',`#include <color_fragment>
      float bankFilter=1.0-smoothstep(.1,.7,length(fwidth(vBankWorld.xz)));
      float bankMottle=.5+.5*sin(vBankWorld.x*7.1+sin(vBankWorld.z*4.7))*bankFilter;
      diffuseColor.rgb*=mix(.75,1.2,bankMottle);
      diffuseColor.a*=(1.0-smoothstep(0.0,1.0,vBankUv.x))*(1.0-smoothstep(uBankRange-32.0,uBankRange-16.0,distance(cameraPosition.xz,vBankWorld.xz)));`);
  };
  function addMesh(f,attach=true){
    if(!f.indices.length)return null;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(f.positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(f.uvs,2));g.setIndex(Array.isArray(f.indices)?f.indices:new THREE.BufferAttribute(f.indices,1));g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,material);mesh.renderOrder=1;if(attach)group.add(mesh);return mesh;
  }
  // W2c-9e3: do not build/render all rivers at once. Only a nearby 96m window,
  // one source segment per preparation tick. Far buffers are released on travel.
  const sources=defer?prepared.ribbons.map(r=>{
    const segments=[];
    for(let k=0;k<r.indices.length;k+=6){
      const a=r.indices[k],b=r.indices[k+2],p=r.positions;
      segments.push({ribbon:{positions:p,indices:r.indices.slice(k,k+6)},
        minX:Math.min(p[a*3],p[b*3],p[(a+1)*3],p[(b+1)*3])-BANK_WIDTH,
        maxX:Math.max(p[a*3],p[b*3],p[(a+1)*3],p[(b+1)*3])+BANK_WIDTH,
        minZ:Math.min(p[a*3+2],p[b*3+2],p[(a+1)*3+2],p[(b+1)*3+2])-BANK_WIDTH,
        maxZ:Math.max(p[a*3+2],p[b*3+2],p[(a+1)*3+2],p[(b+1)*3+2])+BANK_WIDTH,
        mesh:null,near:false,done:false});
    }return segments;
  }).flat():[];
  if(!defer)for(const r of prepared.ribbons)addMesh(bankRibbon(r,terrain));
  let lastX=Infinity,lastZ=Infinity,cursor=0,pending=false,adapt=0,batch=null;
  return {group,material,uniforms,
    update(pos){
      if(disposed||!defer||adapt>=3)return;
      const radius=adapt>=2?48:96;uniforms.uBankRange.value=radius;
      if(Math.hypot(pos.x-lastX,pos.z-lastZ)>16){
        lastX=pos.x;lastZ=pos.z;cursor=0;pending=true;
        for(const s of sources){
          s.near=Math.hypot(Math.max(s.minX-pos.x,0,pos.x-s.maxX),Math.max(s.minZ-pos.z,0,pos.z-s.maxZ))<=radius;
          if(!s.near&&s.mesh){group.remove(s.mesh);s.mesh.geometry.dispose();s.mesh=null;s.done=false;}
        }
      }
      if(!pending)return;
      for(let n=0;n<128&&cursor<sources.length;n++){
        const s=sources[cursor++];
        if(s.near&&!s.done){s.mesh=addMesh(bankRibbon(s.ribbon,terrain),false);s.done=true;break;}
      }
      pending=cursor<sources.length;
      if(!pending){
        // Many tiny wet strips -> one nearby draw, keeping the CPU source buffers
        // for the next window. Source geometries are never uploaded/rendered.
        let vertices=0,indexCount=0;
        for(const s of sources)if(s.mesh){vertices+=s.mesh.geometry.attributes.position.count;indexCount+=s.mesh.geometry.index.count;}
        const positions=new Float32Array(vertices*3),uvs=new Float32Array(vertices*2),indices=new Uint32Array(indexCount);
        let vertex=0,index=0;
        for(const s of sources)if(s.mesh){const g=s.mesh.geometry;positions.set(g.attributes.position.array,vertex*3);uvs.set(g.attributes.uv.array,vertex*2);for(const i of g.index.array)indices[index++]=i+vertex;vertex+=g.attributes.position.count;}
        if(batch){group.remove(batch);batch.geometry.dispose();}
        batch=addMesh({positions,uvs,indices});
      }
    },
    setAdapt(value){adapt=value;group.visible=adapt<3;lastX=Infinity;},
    dispose(){if(disposed)return;disposed=true;for(const s of sources)if(s.mesh)s.mesh.geometry.dispose();for(const m of group.children)m.geometry.dispose();group.clear();group.removeFromParent();material.dispose();}};
}
