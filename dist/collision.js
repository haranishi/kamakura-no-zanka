// Lightweight 2.5D collision: a standing circle, swept by short substeps.
// All dimensions are metres in glTF/Three.js X,Z plane, Y up.
export function groundAt(grid,x,z){
 const fx=(x-grid.minX)/grid.step,fz=(z-grid.minZ)/grid.step;
 if(fx<0||fz<0||fx>grid.nx-1||fz>grid.nz-1)return null;
 const ix=Math.min(grid.nx-2,Math.floor(fx)),iz=Math.min(grid.nz-2,Math.floor(fz));
 const tx=fx-ix,tz=fz-iz,h=grid.heights;
 const a=h[iz*grid.nx+ix],b=h[iz*grid.nx+ix+1],c=h[(iz+1)*grid.nx+ix],d=h[(iz+1)*grid.nx+ix+1];
 if([a,b,c,d].some(v=>v===null||!Number.isFinite(v)))return null;
 return(a*(1-tx)+b*tx)*(1-tz)+(c*(1-tx)+d*tx)*tz;
}
export function intersectsBox(x,z,r,b){
 const dx=x-Math.max(b.minX,Math.min(b.maxX,x)),dz=z-Math.max(b.minZ,Math.min(b.maxZ,z));
 return dx*dx+dz*dz<r*r;
}
export function checkPosition(world,x,z,r=.23,fromHeight=null){
 const b=world.bounds;
 if(x+r>b.maxX&&world.sceneBounds?.maxX>b.maxX)return{ok:false,reason:'water'};
 if(x-r<b.minX||x+r>b.maxX||z-r<b.minZ||z+r>b.maxZ)return{ok:false,reason:'boundary'};
 for(const box of world.boxes||[])if(intersectsBox(x,z,r,box))return{ok:false,reason:box.id};
 for(const box of world.waterHazards||[])if(intersectsBox(x,z,r,box))return{ok:false,reason:'water'};
 const y=groundAt(world.ground,x,z);
 if(y===null)return{ok:false,reason:'water'};
 if(fromHeight!==null&&Math.abs(y-fromHeight)>.22)return{ok:false,reason:'step'};
 return{ok:true,y};
}
export function movePlayer(world,position,dx,dz,r=.23){
 let p={...position},blocked=null;const count=Math.max(1,Math.ceil(Math.hypot(dx,dz)/.06));
 const sx=dx/count,sz=dz/count;
 for(let n=0;n<count;n++){
  let a=checkPosition(world,p.x+sx,p.z+sz,r,p.y);
  if(a.ok){p.x+=sx;p.z+=sz;p.y=a.y;continue;}
  blocked=a.reason;
  // Axis separation produces stable wall sliding rather than sticky corners.
  a=checkPosition(world,p.x+sx,p.z,r,p.y);if(a.ok){p.x+=sx;p.y=a.y;}
  a=checkPosition(world,p.x,p.z+sz,r,p.y);if(a.ok){p.z+=sz;p.y=a.y;}
 }
 return{position:p,blocked};
}
