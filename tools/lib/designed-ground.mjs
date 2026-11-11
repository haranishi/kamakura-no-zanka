import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { gameZ, northOffset, shoreAt, noise, mix, clamp, inRect, hash, quayAt, outcropAt } from './designed-terrain.mjs';
export const designedFurrow=(across)=>Math.floor(across/P.ground.stripeWidth)%2===0?P.ground.soil:P.ground.crop;
export function designedGround(surface,width,height,heights,field,data=null) {
  const c=P.ground,cell=P.grid.cell,n=width*height,palette=[c.sand,c.wet,c.grass,c.forest,c.soil,c.rock,c.gravel,c.riverbed],raw=new Float32Array(n*3),out=Buffer.alloc(n*3),use=new Int32Array(n),stripe=new Uint8Array(n);
  const eachRect=(x,y,w,d,yaw,fn)=>{
    const co=Math.cos(yaw),si=Math.sin(yaw),r=Math.hypot(w,d)/2;
    for(let j=Math.max(0,Math.floor((P.grid.north-y-r)/cell));j<=Math.min(height-1,Math.ceil((P.grid.north-y+r)/cell));j++)for(let i=Math.max(0,Math.floor((x-r-P.grid.west)/cell));i<=Math.min(width-1,Math.ceil((x+r-P.grid.west)/cell));i++){
      const dx=P.grid.west+(i+.5)*cell-x,dy=P.grid.north-(j+.5)*cell-y,u=co*dx+si*dy,v=-si*dx+co*dy;
      if(Math.abs(u)<=w/2&&Math.abs(v)<=d/2)fn(j*width+i,u,v);
    }
  };
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){
    const k=j*width+i,x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell,d=y-shoreAt(x);let colour=palette[surface[k]];
    if(heights[k]<0&&d<0&&surface[k]!==5){
      const depth=-heights[k],t=clamp((depth-c.seaSandDepth)/(c.seaMidDepth-c.seaSandDepth));
      colour=c.sand.map((v,q)=>mix(mix(v,c.seaMid[q],t),c.riverbed[q],clamp((depth-c.seaMidDepth)/(c.seaDeepDepth-c.seaMidDepth))));
      if(surface[k]===7){const sand=clamp(-d/P.river.mouthSandRun);colour=c.riverbed.map((v,q)=>mix(v,colour[q],sand));}
    }
    if(surface[k]===4&&Math.abs(x)<=P.roads[0].width/2&&y>=P.roads[0].points[0][1]&&y<=P.roads[0].points[1][1])colour=c.avenue;
    const buddha=P.terraces[0].rect;
    if(surface[k]===5&&(x<buddha[0]+P.buddha.cliffInset&&y>buddha[2]-P.buddha.cliffHeight&&y<buddha[3]||y<buddha[2]&&x>buddha[0]&&x<buddha[1]||Math.hypot(x-P.cape.x,y-P.cape.y)<P.cape.radius&&y<P.cape.y+P.cape.cliff))colour=c.cliff;
    if(surface[k]===5&&outcropAt(x,y))colour=c.cliff;
    if(P.terraces.some(t=>inRect(x,y,t.rect)))colour=c.terrace;
    if(quayAt(x,y))colour=c.wet.map((v,q)=>mix(v,c.gravel[q],.35));
    if(P.burns.plots.some(r=>inRect(x,y,r))&&surface[k]===2)colour=hash(i,j,155)<c.burntCover?(hash(i,j,156)<.5?c.ash:c.charcoal):c.soil;
    use[k]=surface[k];for(let q=0;q<3;q++)raw[k*3+q]=colour[q];
  }
  const paintPlot=(p,id,allowGrass=false)=>eachRect(p.x,p.y,p.width,p.depth,p.yaw,(k,u,v)=>{
    if(surface[k]!==4&&!(allowGrass&&surface[k]===2))return;
    let colour=c.soil;
    if(p.state==='garden'){colour=designedFurrow(v+p.depth/2);stripe[k]=1;}
    else if(p.state==='burnt')colour=hash(k,id,155)<c.burntCover?(hash(k,id,156)<.5?c.ash:c.charcoal):c.soil;
    else if(p.state==='repair')colour=c.soil.map((a,q)=>mix(a,c.chips[q],c.repairMix));
    use[k]=id;for(let q=0;q<3;q++)raw[k*3+q]=colour[q];
  });
  let id=16;
  for(const f of field.farms)paintPlot({...f,state:'garden'},id++,true);
  for(const p of data?.townPlots||[])paintPlot({...p,y:northOffset-p.z,yaw:-p.yaw},id++);
  const laneAt=new Uint8Array(n);
  const paintLine=(a,b,width,kind=1)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1],length=Math.hypot(dx,dy);if(!length)return;
    eachRect((a[0]+b[0])/2,(a[1]+b[1])/2,length,width,Math.atan2(dy,dx),(k)=>{
      if(surface[k]!==4&&surface[k]!==2)return;
      laneAt[k]=kind;stripe[k]=0;use[k]=8;for(let q=0;q<3;q++)raw[k*3+q]=c.lane[q];
    });
  };
  for(const lane of Object.values(data?.lanes||{}))for(let i=1;i<lane.xyz_m.length;i++){const a=lane.xyz_m[i-1],b=lane.xyz_m[i];paintLine([a[0],a[1]+northOffset],[b[0],b[1]+northOffset],c.laneWidth);}
  // Door-to-lane paths use the actual nearest lane, preserving orientation even when the plot rotates.
  for(const p of data?.townPlots||[])if(p.state==='house'||p.state==='repair'){
    let best=Infinity,target=null;const y=northOffset-p.z;
    for(const lane of Object.values(data.lanes||{}))for(let i=1;i<lane.xyz_m.length;i++){const a=lane.xyz_m[i-1],b=lane.xyz_m[i],dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((p.x-a[0])*dx+(y-northOffset-a[1])*dy)/(dx*dx+dy*dy)),x=a[0]+dx*t,yy=a[1]+northOffset+dy*t,d=Math.hypot(p.x-x,y-yy);if(d<best){best=d;target=[x,yy];}}
    if(target)paintLine([p.x,y],target,c.footWidth,2);
  }
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){
    const k=j*width+i,x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell,gain=1+c.variation*noise((surface[k]===2&&Math.abs(Math.abs(x)-(P.roads[0].width/2-c.vergeInset))<=c.vergeWidth/2?Math.abs(x):x)/c.wave,y/c.wave);
    for(let q=0;q<3;q++){
      let sum=0,count=0;
      // Blend only the boundary cell. Interior furrows retain their two alternating colours.
      for(let dj=-c.blendCells;dj<=c.blendCells;dj++)for(let di=-c.blendCells;di<=c.blendCells;di++){
        const kk=Math.max(0,Math.min(height-1,j+dj))*width+Math.max(0,Math.min(width-1,i+di));sum+=use[kk]===use[k]?raw[k*3+q]:raw[kk*3+q];count++;
      }
      const verge=surface[k]===2&&Math.abs(Math.abs(x)-(P.roads[0].width/2-c.vergeInset))<=c.vergeWidth/2;
      const value=(surface[k]===1||surface[k]===6)?raw[k*3+q]:verge?c.grass[q]:laneAt[k]?raw[k*3+q]:surface[k]===7?mix(raw[k*3+q],sum/count,c.riverBlend):sum/count;
      out[k*3+q]=Math.round(value*gain);
    }
  }
  return {rgb:out,use,stripe,laneAt};
}
