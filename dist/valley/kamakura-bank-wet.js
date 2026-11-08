import { shore4Enabled } from './kamakura-shore-r4.js';
import { PHOTO_GLSL, PHOTO_TEX_DATA, photoSampler, photoBlendUniform } from './kamakura-photo-tex.js';
import { chunkGeometry, CHUNK_CELLS } from './kamakura-chunks.js';
import { shore2Enabled, bankCrossingDistance } from './kamakura-shore.js';
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
// W2c-9r2 shore fix: independent crossing jumps -> shared, smoothed bounded rows.
export const BANK_REACH_STEP=.4;
export const BANK_MAX_ASPECT=32;
export function bankTriangleAspect(a,b,c){
  const u=b.map((v,i)=>v-a[i]),v=c.map((v,i)=>v-a[i]);
  const twiceArea=Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0]);
  const edge2=Math.max(...[[a,b],[b,c],[c,a]].map(([p,q])=>p.reduce((sum,n,i)=>sum+(n-q[i])**2,0)));
  return twiceArea>0?edge2/twiceArea:Infinity;
}
export function* bankWaterlineRibbonSteps(ribbon,terrain){
  const src=ribbon.positions,positions=new Float32Array(src),rows=src.length/6;
  const reaches=new Float64Array(rows*2),caps=new Float64Array(rows*2);
  for(let row=0;row<rows;row++){
    const k=row*6,x=(src[k]+src[k+3])/2,z=(src[k+2]+src[k+5])/2,level=(src[k+1]+src[k+4])/2;
    for(let side=0;side<2;side++){
      const i=k+side*3,dx=src[i]-x,dz=src[i+2]-z,half=Math.hypot(dx,dz),n=row*2+side;
      caps[n]=2*half;
      reaches[n]=Math.min(caps[n],half>1e-6?bankCrossingDistance(terrain,x,z,level,dx/half,dz/half,half):0);
    }
    yield;
  }
  // Convolution removes isolated protrusions; two projections bound every neighbour
  // including narrow source rows. Shared rows remain identical across source segments.
  const smooth=new Float64Array(reaches);
  for(let row=1;row<rows-1;row++)for(let side=0;side<2;side++){
    const n=row*2+side;smooth[n]=Math.min(caps[n],(reaches[n-2]+2*reaches[n]+reaches[n+2])/4);
  }
  for(let row=1;row<rows;row++){for(let side=0;side<2;side++){const n=row*2+side;smooth[n]=Math.min(smooth[n],smooth[n-2]+BANK_REACH_STEP);}yield;}
  for(let row=rows-2;row>=0;row--){for(let side=0;side<2;side++){const n=row*2+side;smooth[n]=Math.min(smooth[n],smooth[n+2]+BANK_REACH_STEP);}yield;}
  for(let row=0;row<rows;row++){
    const k=row*6,x=(src[k]+src[k+3])/2,z=(src[k+2]+src[k+5])/2;
    for(let side=0;side<2;side++){
      const i=k+side*3,dx=src[i]-x,dz=src[i+2]-z,half=Math.hypot(dx,dz),reach=smooth[row*2+side];
      if(half>1e-6){positions[i]=x+dx/half*reach;positions[i+2]=z+dz/half*reach;}
    }
    yield;
  }
  return {positions,indices:ribbon.indices};
}
export function bankWaterlineRibbon(ribbon,terrain){
  const job=bankWaterlineRibbonSteps(ribbon,terrain);let r=job.next();while(!r.done)r=job.next();return r.value;
}
function boundedBankTriangles(f){
  const indices=[];
  for(let k=0;k<f.indices.length;k+=3){const ids=f.indices.slice(k,k+3),v=ids.map(i=>Array.from(f.positions.slice(i*3,i*3+3)));
    // Clipping at a terrain vertex can still produce arbitrarily thin slivers.
    if(bankTriangleAspect(...v)<=BANK_MAX_ASPECT)indices.push(...ids);
  }
  return {...f,indices};
}
// W2c-9r1 shore: bilinear drape intersected the rendered triangles on saddle cells.
// Clip the wet footprint onto the actual near-LOD terrain faces instead. A bounded
// cache of local cells limits preparation memory; no terrain data is copied into assets.
const surfaceCaches=new WeakMap();
export function* bankSurfaceRibbonSteps(ribbon,terrain,width=BANK_WIDTH,alignWater=false){
  if(alignWater)ribbon=yield* bankWaterlineRibbonSteps(ribbon,terrain);
  if(!terrain.cell||!terrain.normalAt){const f=bankRibbon(ribbon,terrain,width);return alignWater?boundedBankTriangles(f):f;}
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
          if(area<=1e-8||alignWater&&bankTriangleAspect(...f)>BANK_MAX_ASPECT)continue;
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
export function bankSurfaceRibbon(ribbon,terrain,width=BANK_WIDTH,alignWater=false){
  const job=bankSurfaceRibbonSteps(ribbon,terrain,width,alignWater);let result=job.next();
  while(!result.done)result=job.next();return result.value;
}
export function buildBankWet(THREE,prepared,terrain,{search='',defer=false,sunDir=null,now=()=>performance.now()}={}){
  const group=new THREE.Group();group.name='kamakura-bank-wet';let disposed=false;
  const shore4=shore4Enabled(search),shore2=shore2Enabled(search),ribbonFor=shore2?(r,t)=>bankSurfaceRibbon(r,t,BANK_WIDTH,true):bankRibbon;
  if(!terrain||new URLSearchParams(search).get('seav')==='0'||new URLSearchParams(search).get('bankwet')==='0')return {group,update(){},setAdapt(){},dispose(){}};
  const material=new THREE.MeshBasicMaterial({color:shore4?0x49463e:shore2?0x55574d:0x514b40,transparent:true,opacity:shore2?.68:.58,depthWrite:false,side:THREE.DoubleSide});material.fog=true;material.forceSinglePass=shore2;
  // W2c-10b shore5: pale unlit bank -> darker neutral earth tint.
  // W2c-10 shore4: flat stain -> normalized photo relief; preserve the neutral first frame and pigment.
  const uniforms={uBankSun:{value:sunDir?.clone().normalize()??new THREE.Vector3(.5,.17,.85).normalize()},uBankPhoto:{value:+shore4},uPhotoBlend:photoBlendUniform,uBankSand:photoSampler('groundSandWet'),uBankPebbles:photoSampler('groundPebbles'),uBankRange:{value:defer?96:prepared.policy.maxDistance}};
  material.onBeforeCompile=s=>{
    Object.assign(s.uniforms,uniforms);
    s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec2 vBankUv;varying vec3 vBankWorld;').replace('#include <begin_vertex>','#include <begin_vertex>\nvBankUv=uv;vBankWorld=(modelMatrix*vec4(position,1.0)).xyz;');
    s.fragmentShader=s.fragmentShader.replace('#include <common>','#include <common>\nuniform float uBankRange;varying vec2 vBankUv;varying vec3 vBankWorld;').replace('#include <color_fragment>',`#include <color_fragment>
      float bankFilter=1.0-smoothstep(.1,.7,length(fwidth(vBankWorld.xz)));
      float bankMottle=${shore2?".5":".5+.5*sin(vBankWorld.x*7.1+sin(vBankWorld.z*4.7))*bankFilter"};
      diffuseColor.rgb*=mix(.75,1.2,bankMottle);
      diffuseColor.a*=(1.0-smoothstep(0.0,1.0,vBankUv.x))*(1.0-smoothstep(uBankRange-32.0,uBankRange-16.0,distance(cameraPosition.xz,vBankWorld.xz)));`);
  };
  if(shore4){
    const legacyCompile=material.onBeforeCompile;
    material.onBeforeCompile=s=>{
      legacyCompile(s);
      s.vertexShader=s.vertexShader.replace('#include <common>','#include <common>\nvarying vec3 vBankView4,vBankN4;').replace('#include <project_vertex>','#include <project_vertex>\nvBankView4=mvPosition.xyz;vBankN4=normalMatrix*normal;');
      s.fragmentShader=s.fragmentShader.replace('#include <common>',`#include <common>
        ${PHOTO_GLSL}
        uniform sampler2D uBankSand,uBankPebbles;uniform float uPhotoBlend,uBankPhoto;uniform vec3 uBankSun;varying vec3 vBankView4,vBankN4;`)
        .replace('#include <color_fragment>',`#include <color_fragment>
          vec2 wetUv=vBankWorld.xz/${PHOTO_TEX_DATA.groundSandWet.meters.toFixed(2)};
          vec2 pebbleUv=vBankWorld.xz/${PHOTO_TEX_DATA.groundPebbles.meters.toFixed(2)};
          vec2 wetDx=dFdx(wetUv),wetDy=dFdy(wetUv),pebbleDx=dFdx(pebbleUv),pebbleDy=dFdy(pebbleUv);
          vec3 wetPhoto=vec3(0.0,0.0,1.0);
          float wetStrength=uPhotoBlend*uBankPhoto;
          if(wetStrength>0.0){
            wetPhoto=.65*kzPhotoHexGrad(uBankSand,wetUv,1.2,1.0,wetDx,wetDy)+.35*kzPhotoHexGrad(uBankPebbles,pebbleUv,1.2,1.0,pebbleDx,pebbleDy);
          }
          vec3 bankN4=normalize(vBankN4);
          vec3 wetNormal=kzPerturbNormal(bankN4,vBankView4,wetUv,wetPhoto.xy,.35*wetStrength*(1.0-smoothstep(40.0,120.0,distance(cameraPosition,vBankWorld))));
          vec3 bankLight4=normalize((viewMatrix*vec4(uBankSun,0.0)).xyz);
          float relief4=(.8+.2*max(0.0,dot(wetNormal,bankLight4)))/(.8+.2*max(0.0,dot(bankN4,bankLight4)));
          diffuseColor.rgb*=mix(1.0,wetPhoto.z,.45*wetStrength)*relief4;`);
    };
    material.customProgramCacheKey=()=> 'kamakura-bank-10-shore4';
  }
  function addMesh(f,attach=true){
    if(!f.indices.length)return null;
    const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(f.positions,3));g.setAttribute('uv',new THREE.Float32BufferAttribute(f.uvs,2));g.setIndex(Array.isArray(f.indices)?f.indices:new THREE.BufferAttribute(f.indices,1));if(shore4)g.computeVertexNormals();g.computeBoundingSphere();
    const mesh=new THREE.Mesh(g,material);mesh.renderOrder=1;if(attach)group.add(mesh);return mesh;
  }
  // W2c-9e3: do not build/render all rivers at once. Only a nearby 96m window,
  // one source segment per preparation tick. Far buffers are released on travel.
  const sources=defer?prepared.ribbons.map(r=>{
    const segments=[],alignment=shore2?{job:bankWaterlineRibbonSteps(r,terrain),result:null}:null;
    for(let k=0;k<r.indices.length;k+=6){
      const a=r.indices[k],b=r.indices[k+2],p=r.positions;
      segments.push({ribbon:{positions:p,indices:r.indices.slice(k,k+6)},
        minX:Math.min(p[a*3],p[b*3],p[(a+1)*3],p[(b+1)*3])-BANK_WIDTH,
        maxX:Math.max(p[a*3],p[b*3],p[(a+1)*3],p[(b+1)*3])+BANK_WIDTH,
        minZ:Math.min(p[a*3+2],p[b*3+2],p[(a+1)*3+2],p[(b+1)*3+2])-BANK_WIDTH,
        maxZ:Math.max(p[a*3+2],p[b*3+2],p[(a+1)*3+2],p[(b+1)*3+2])+BANK_WIDTH,
        alignment,mesh:null,near:false,done:false,job:null});
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
            if(s.alignment&&!s.alignment.result){
              const start=now();let next;
              for(let n=0;n<128;n++){
                next=s.alignment.job.next();
                if(next.done||now()-start>(adapt>=2?.15:.35))break;
              }
              if(!next.done){cursor--;break;}
              s.alignment.result=next.value;s.alignment.job=null;
            }
            if(!s.job){
              const aligned={positions:s.alignment.result.positions,indices:s.ribbon.indices};
              // Already aligned over the whole river; retain the final triangle guard.
              s.job=bankSurfaceRibbonSteps(aligned,terrain,BANK_WIDTH,false);
            }
            const result=s.job.next();
            if(!result.done){cursor--;break;}
            s.job=null;s.mesh=addMesh(boundedBankTriangles(result.value),false);
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
    setAdapt(value){uniforms.uBankPhoto.value=shore4&&value<3?(value>=2?.5:1):0;adapt=value;group.visible=adapt<3;lastX=Infinity;},
    dispose(){if(disposed)return;disposed=true;surfaceCaches.delete(terrain);for(const s of sources){s.alignment?.job?.return();s.job?.return();s.job=null;if(s.mesh)s.mesh.geometry.dispose();}for(const m of group.children)m.geometry.dispose();group.clear();group.removeFromParent();material.dispose();}};
}
