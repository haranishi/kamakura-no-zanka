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
