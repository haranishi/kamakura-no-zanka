import { chunkGeometry, CHUNK_CELLS } from './kamakura-chunks.js';
import { shore2Enabled } from './kamakura-shore.js';
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
// W2c-9r1 shore: bilinear drape intersected the rendered triangles on saddle cells.
// Clip the wet footprint onto the actual near-LOD terrain faces instead. A bounded
// cache of local cells limits preparation memory; no terrain data is copied into assets.
const surfaceCaches=new WeakMap();
export function* bankSurfaceRibbonSteps(ribbon,terrain,width=BANK_WIDTH){
  if(!terrain.cell||!terrain.normalAt)return bankRibbon(ribbon,terrain,width);
  let cache=surfaceCaches.get(terrain);if(!cache){cache=new Map();surfaceCaches.set(terrain,cache);}
  const positions=[],uvs=[],indices=[],p=ribbon.positions,c=terrain.cell;
  const cross=(a,b,x,z)=>(b[0]-a[0])*(z-a[2])-(b[2]-a[2])*(x-a[0]);
  function clip(poly,a,b,sign){
    const out=[];
    for(let i=0;i<poly.length;i++){
      const v=poly[i],w=poly[(i+1)%poly.length],dv=cross(a,b,v[0],v[2])*sign,dw=cross(a,b,w[0],w[2])*sign;
      if(dv>=-1e-8)out.push(v);
      if((dv<0&&dw>0)||(dv>0&&dw<0)){const f=dv/(dv-dw);out.push(v.map((n,k)=>n+(w[k]-n)*f));}
    }return out;
  }
  for(let k=0;k<ribbon.indices.length;k+=6)for(const side of [0,1]){
    const a=ribbon.indices[k]+side,b=ribbon.indices[k+2]+side;
    const v=[p[a*3],0,p[a*3+2]],w=[p[b*3],0,p[b*3+2]],dx=w[0]-v[0],dz=w[2]-v[2],len=Math.hypot(dx,dz);
    if(len<1e-5)continue;
    // A segment-local perpendicular cannot reverse or cross on a hairpin.
    const direction=side===0?-1:1,nx=-dz/len*direction,nz=dx/len*direction;
    const q=[v,w,[w[0]+nx*width,0,w[2]+nz*width],[v[0]+nx*width,0,v[2]+nz*width]];
    const sign=cross(q[0],q[1],q[2][0],q[2][2])>0?1:-1;
    const minX=Math.min(...q.map(a=>a[0])),maxX=Math.max(...q.map(a=>a[0])),minZ=Math.min(...q.map(a=>a[2])),maxZ=Math.max(...q.map(a=>a[2]));
    const i0=Math.max(0,Math.floor((minX-terrain.x0)/c)),j0=Math.max(0,Math.floor((minZ-terrain.z0)/c));
    for(let j=j0;j<terrain.h-1&&terrain.z0+j*c<=maxZ;j++)for(let i=i0;i<terrain.w-1&&terrain.x0+i*c<=maxX;i++){
      const key=j*terrain.w+i;let g=cache.get(key);
      if(!g){
        // At most a 3x3 tile. Preserve the parent chunk's perimeter/fan flags
        // so this central cell is exactly the one drawn by chunkGeometry.
        const ci=Math.floor(i/CHUNK_CELLS)*CHUNK_CELLS,cj=Math.floor(j/CHUNK_CELLS)*CHUNK_CELLS;
        const left=i===ci?i:i-1,top=j===cj?j:j-1;
        const right=i+1===Math.min(terrain.w-1,ci+CHUNK_CELLS)?i+1:i+2;
        const bottom=j+1===Math.min(terrain.h-1,cj+CHUNK_CELLS)?j+1:j+2;
        g=chunkGeometry(terrain,left,top,right,bottom,1,{},false);g.faces=[];
        for(let t=0;t<g.indices.length;t+=3){
          const a=g.indices[t]*3,b=g.indices[t+1]*3,d=g.indices[t+2]*3;
          const x=(g.positions[a]+g.positions[b]+g.positions[d])/3,z=(g.positions[a+2]+g.positions[b+2]+g.positions[d+2])/3;
          if(Math.floor((x-terrain.x0)/c)===i&&Math.floor((z-terrain.z0)/c)===j)g.faces.push(t);
        }
        cache.set(key,g);if(cache.size>256)cache.delete(cache.keys().next().value);
      }
      for(const t of g.faces){
        let poly=g.indices.slice(t,t+3).map(n=>g.positions.slice(n*3,n*3+3));
        if(Math.max(...poly.map(a=>a[0]))<minX||Math.min(...poly.map(a=>a[0]))>maxX||Math.max(...poly.map(a=>a[2]))<minZ||Math.min(...poly.map(a=>a[2]))>maxZ)continue;
        for(let e=0;e<4&&poly.length;e++)poly=clip(poly,q[e],q[(e+1)%4],sign);
        for(let n=1;n+1<poly.length;n++){
          const face=[poly[0],poly[n],poly[n+1]];
          // Recheck Float32 winding, including clipping slivers.
          const f=face.map(a=>a.map(Math.fround)),area=-cross(f[0],f[1],f[2][0],f[2][2]);
          if(area<=1e-8)continue;
          const base=positions.length/3;
          for(const a of f){positions.push(a[0],a[1]+.015,a[2]);uvs.push(Math.max(0,Math.min(1,((a[0]-v[0])*nx+(a[2]-v[2])*nz)/width)),0);}
          indices.push(base,base+1,base+2);
        }
      }
      yield; // W2c-9r1 shore: one touched terrain cell per preparation tick.
    }
  }
  return {positions:new Float32Array(positions),uvs:new Float32Array(uvs),indices,rejected:0,folds:0};
}
export function bankSurfaceRibbon(ribbon,terrain,width=BANK_WIDTH){
  const job=bankSurfaceRibbonSteps(ribbon,terrain,width);let result=job.next();
  while(!result.done)result=job.next();return result.value;
}
export function buildBankWet(THREE,prepared,terrain,{search='',defer=false}={}){
  const group=new THREE.Group();group.name='kamakura-bank-wet';let disposed=false;
  const shore2=shore2Enabled(search),ribbonFor=shore2?bankSurfaceRibbon:bankRibbon;
  if(!terrain||new URLSearchParams(search).get('seav')==='0'||new URLSearchParams(search).get('bankwet')==='0')return {group,update(){},setAdapt(){},dispose(){}};
  const material=new THREE.MeshBasicMaterial({color:0x514b40,transparent:true,opacity:.58,depthWrite:false,side:THREE.DoubleSide});material.fog=true;material.forceSinglePass=shore2;
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
        mesh:null,near:false,done:false,job:null});
    }return segments;
  }).flat():[];
  if(!defer)for(const r of prepared.ribbons)addMesh(ribbonFor(r,terrain));
  let lastX=Infinity,lastZ=Infinity,cursor=0,pending=false,adapt=0,batch=null;
  return {group,material,uniforms,
    update(pos){
      if(disposed||!defer||adapt>=3)return;
      const radius=adapt>=2?48:96;uniforms.uBankRange.value=radius;
      if(Math.hypot(pos.x-lastX,pos.z-lastZ)>16){
        lastX=pos.x;lastZ=pos.z;cursor=0;pending=true;
      }
      if(!pending)return;
      for(let n=0;n<128&&cursor<sources.length;n++){
        const s=sources[cursor++];
        s.near=Math.hypot(Math.max(s.minX-lastX,0,lastX-s.maxX),Math.max(s.minZ-lastZ,0,lastZ-s.maxZ))<=radius;
        if(!s.near){
          s.job?.return();s.job=null;
          if(s.mesh){s.mesh.geometry.dispose();s.mesh=null;}s.done=false;continue;
        }
        if(!s.done){
          if(shore2){
            if(!s.job)s.job=bankSurfaceRibbonSteps(s.ribbon,terrain);
            const result=s.job.next();
            if(!result.done){cursor--;break;}
            s.job=null;s.mesh=addMesh(result.value,false);
          }else s.mesh=addMesh(ribbonFor(s.ribbon,terrain),false);
          s.done=true;break;
        }
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
    dispose(){if(disposed)return;disposed=true;surfaceCaches.delete(terrain);for(const s of sources){s.job?.return();s.job=null;if(s.mesh)s.mesh.geometry.dispose();}for(const m of group.children)m.geometry.dispose();group.clear();group.removeFromParent();material.dispose();}};
}
