import { kamakuraPaths as farPaths } from './kamakura-roads.js';
// W2c-13 SL2: one deterministic low-resolution canopy field per ground owner.
// Source placements stay in memory; only coverage is copied into the existing yard alpha.
export function createGroundDensity(veg,spanX,spanZ,size=128){
  const area=new Float64Array(size*size),bytes=new Uint8Array(size*size),dx=spanX/size,dz=spanZ/size;
  for(const tree of veg||[]){
    if(tree.sourceSpecies===5 || !Number.isFinite(tree.x)||!Number.isFinite(tree.z)||!(tree.crown>0))continue;
    const x=(tree.x/spanX+.5)*size-.5,z=(tree.z/spanZ+.5)*size-.5;
    const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz;
    const cover=Math.PI*tree.crown*tree.crown/(dx*dz);
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const a=ix+i,b=iz+j;if(a<0||a>=size||b<0||b>=size)continue;
      area[b*size+a]+=cover*(i?fx:1-fx)*(j?fz:1-fz);
    }
  }
  // A 3x3 binomial filter prevents cell-sized canopy squares at hill silhouettes.
  for(let z=0;z<size;z++)for(let x=0;x<size;x++){
    let sum=0;
    for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
      const a=x+i,b=z+j;if(a<0||a>=size||b<0||b>=size)continue;
      sum+=area[b*size+a]*(i===0?2:1)*(j===0?2:1)/16;
    }
    bytes[z*size+x]=Math.round(255*(1-Math.exp(-sum/.65)));
  }
  return {bytes,size,at(x,z){
    if(Math.abs(x)>spanX/2 || Math.abs(z)>spanZ/2)return 0;
    const u=Math.max(0,Math.min(size-1,(x/spanX+.5)*size-.5)),v=Math.max(0,Math.min(size-1,(z/spanZ+.5)*size-.5));
    const i=Math.floor(u),j=Math.floor(v),a=v-j,b=u-i;
    const row=k=>bytes[k*size+i]*(1-b)+bytes[k*size+Math.min(size-1,i+1)]*b;
    return row(j)*(1-a)+row(Math.min(size-1,j+1))*a;
  }};
}

// W2c-18: incremental all-tier density + prefiltered roads + protected river bank, one RGBA8 atlas.
// setup only retains source references; step() bounds actual work, including large stand footprints.
export function createFarGroundField(data,cfg,roadCoverage){
  const g=data.meta.grid,spanX=g.width*g.cell_m,spanZ=g.height*g.cell_m;
  const size=Math.max(2,Math.ceil(Math.max(spanX,spanZ)/cfg.texelMeters));
  if(size>cfg.maxSize)throw new RangeError('遠景地面の解像度と容量の上限が両立しません');
  const dx=spanX/size,dz=spanZ/size,pixel=Math.max(dx,dz),area=new Float32Array(size*size),bytes=new Uint8Array(size*size*4);
  const trees=data.veg||[],segments=[];
  let roadCount=0;
  // Use precisely the same combined route list as near ground (including patches and sando).
  const paths=farPaths(data);
  for(const id in paths){const p=paths[id];roadCount++;
    for(let i=1;i<p.xyz_m.length;i++){const a=p.xyz_m[i-1],b=p.xyz_m[i];segments.push({x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1],width:p.width_m||5,y:a[2],dy:b[2]-a[2],channel:1});}
  }
  for(const r of data.rivers?.rivers||[])for(let i=1;i<r.xy_m.length;i++){
    const a=r.xy_m[i-1],b=r.xy_m[i];segments.push({x:a[0],z:-a[1],dx:b[0]-a[0],dz:a[1]-b[1],width:Math.max(r.width_m[i-1],r.width_m[i])+cfg.bankMargin*2,channel:2});
  }
  let atlasBytes=null,atlasWidth=0,atlasOrigin=0;
  let phase=0,cursor=0,work=0,stamp=null,ix=0,iz=0,lo=0,hi=-1,rowEnd=-1,forest=0,roadTexels=0;
  let soilCount=0,r=0,green=0,b=0,allR=0,allG=0,allB=0,done=false;
  const soil=[0,0,0],linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  function startStamp(s,radius){
    stamp=s;lo=Math.max(0,Math.ceil((s.z-radius+spanZ/2)/dz-.5));
    rowEnd=Math.min(size-1,Math.floor((s.z+(s.dz||0)+radius+spanZ/2)/dz-.5));
    if(s.channel!==undefined){lo=Math.max(0,Math.ceil((Math.min(s.z,s.z+s.dz)-radius+spanZ/2)/dz-.5));rowEnd=Math.min(size-1,Math.floor((Math.max(s.z,s.z+s.dz)+radius+spanZ/2)/dz-.5));}
    iz=lo;hi=-1;
  }
  function rowBounds(s,radius){
    const z=(iz+.5)*dz-spanZ/2;
    let a=0,c=1;
    if(s.channel!==undefined&&Math.abs(s.dz)>1e-12){a=Math.max(0,Math.min((z-radius-s.z)/s.dz,(z+radius-s.z)/s.dz));c=Math.min(1,Math.max((z-radius-s.z)/s.dz,(z+radius-s.z)/s.dz));}
    const x0=s.x+(s.dx||0)*a,x1=s.x+(s.dx||0)*c;
    ix=Math.max(0,Math.ceil((Math.min(x0,x1)-radius+spanX/2)/dx-.5));hi=Math.min(size-1,Math.floor((Math.max(x0,x1)+radius+spanX/2)/dx-.5));
  }
  function step(limit=64){
    let n=0;
    while(n++<limit&&!done){work++;
      if(phase===0){
        if(stamp){
          if(iz>rowEnd){stamp=null;continue;}
          const radius=stamp.crown+pixel/2;
          if(hi<0)rowBounds(stamp,radius);
          if(ix>hi){iz++;hi=-1;continue;}
          const x=(ix+.5)*dx-spanX/2,z=(iz+.5)*dz-spanZ/2,d=Math.hypot(x-stamp.x,z-stamp.z);
          const t=Math.max(0,Math.min(1,(d-Math.max(0,stamp.crown-pixel/2))/pixel));
          area[iz*size+ix++]+=1-t*t*(3-2*t);continue;
        }
        if(cursor>=trees.length){phase=1;cursor=0;continue;}
        const t=trees[cursor++];
        if(t.sourceSpecies===4||t.sourceSpecies===5||!Number.isFinite(t.x)||!Number.isFinite(t.z)||!(t.crown>0))continue;
        if(t.crown>=pixel/2){startStamp(t,t.crown+pixel/2);continue;}
        const x=(t.x/spanX+.5)*size-.5,z=(t.z/spanZ+.5)*size-.5,a=Math.floor(x),c=Math.floor(z),fx=x-a,fz=z-c;
        const cover=Math.PI*t.crown*t.crown/(dx*dz);
        for(let j=0;j<2;j++)for(let i=0;i<2;i++){const u=a+i,v=c+j;if(u>=0&&v>=0&&u<size&&v<size)area[v*size+u]+=cover*(i?fx:1-fx)*(j?fz:1-fz);}
      }else if(phase===1){
        if(cursor>=segments.length){phase=2;cursor=0;continue;}
        if(!stamp)startStamp(segments[cursor],segments[cursor].width/2+pixel*cfg.roadFilter/2);
        if(iz>rowEnd){stamp=null;cursor++;continue;}
        const radius=stamp.width/2+pixel*cfg.roadFilter/2;
        if(hi<0)rowBounds(stamp,radius);
        if(ix>hi){iz++;hi=-1;continue;}
        const x=(ix+.5)*dx-spanX/2,z=(iz+.5)*dz-spanZ/2;
        const length2=stamp.dx*stamp.dx+stamp.dz*stamp.dz;
        const t=Math.max(0,Math.min(1,((x-stamp.x)*stamp.dx+(z-stamp.z)*stamp.dz)/(length2||1)));
        const d=Math.hypot(x-stamp.x-stamp.dx*t,z-stamp.z-stamp.dz*t),k=(iz*size+ix++)*4+stamp.channel;
        bytes[k]=Math.max(bytes[k],Math.round(255*roadCoverage(d,stamp.width,pixel*cfg.roadFilter)));
      }else{
        if(cursor>=size*size){done=true;if(soilCount){soil[0]=r/soilCount;soil[1]=green/soilCount;soil[2]=b/soilCount;}else{
          // No soil class: derive from the existing source mean, never invent another palette.
          soil[0]=allR/Math.max(1,size*size);soil[1]=allG/Math.max(1,size*size);soil[2]=allB/Math.max(1,size*size);
        }continue;}
        const x=cursor%size,z=Math.floor(cursor/size);let sum=0;
        for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++){
          const a=x+i,c=z+j;if(a>=0&&a<size&&c>=0&&c<size)sum+=area[c*size+a]*(i===0?2:1)*(j===0?2:1)/16;
        }
        const k=cursor*4,density=1-Math.exp(-sum/cfg.densitySaturation);bytes[k]=Math.round(255*density);
        const a=Math.min(g.width-1,Math.floor((x+.5)/size*g.width)),c=Math.min(g.height-1,Math.floor((z+.5)/size*g.height)),source=c*g.width+a,code=data.surface?.[source];
        if(code===0||code===1){bytes[k]=0;bytes[k+1]=0;bytes[k+2]=255;}
        if(code===5)bytes[k]=0;
        if(bytes[k]/255>=cfg.densityFrom)forest++;
        if(bytes[k+2]>0)bytes[k+1]=0;
        if(bytes[k+1]>0)roadTexels++;
        if(data.ground){allR+=linear(data.ground[source*3]/255);allG+=linear(data.ground[source*3+1]/255);allB+=linear(data.ground[source*3+2]/255);}
        if(code===4&&data.ground){soilCount++;r+=linear(data.ground[source*3]/255);green+=linear(data.ground[source*3+1]/255);b+=linear(data.ground[source*3+2]/255);}
        if(atlasBytes)for(let channel=0;channel<3;channel++)atlasBytes[(atlasOrigin+channel*size+z)*atlasWidth+x]=bytes[k+channel];
        cursor++;
      }
    }
    return done;
  }
  function nearest(pos){
    let distance=Infinity,bearing=0;
    for(const s of segments){if(s.channel!==1)continue;
      const n=s.dx*s.dx+s.dz*s.dz+s.dy*s.dy;
      const t=Math.max(0,Math.min(1,((pos.x-s.x)*s.dx+(pos.z-s.z)*s.dz+((pos.y||0)-s.y)*s.dy)/(n||1)));
      const x=s.x+t*s.dx-pos.x,z=s.z+t*s.dz-pos.z,y=s.y+t*s.dy-(pos.y||0),d=Math.hypot(x,y,z);
      if(d<distance){distance=d;bearing=(Math.atan2(x,-z)*180/Math.PI+360)%360;}
    }
    return Number.isFinite(distance)?{distance,bearing}:null;
  }
  return {bytes,size,spanX,spanZ,metersPerTexel:pixel,soil,step,roadCount,nearest,attachAtlas(bytes,width,origin){atlasBytes=bytes;atlasWidth=width;atlasOrigin=origin;},
    get done(){return done;},get work(){return work;},get forestShare(){return forest/(size*size);},get roadTexels(){return roadTexels;}};
}
