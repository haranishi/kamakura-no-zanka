import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { inRect, rectangleDistance, townWestAt, townEastAt, townNorthAt, shoreAt, outcropAt, harborAt } from './designed-terrain.mjs';
// Offline fast sweeping of a slope envelope. The quadratic update uses both axes,
// so a diagonal hillside is bounded by its real gradient, not by two independent steps.
export function gradeDesignedTerrain(heights,width,height,field) {
  const cell=P.grid.cell,free=new Uint8Array(heights.length),c=P.grading;
  for(let j=1;j<height-1;j++)for(let i=1;i<width-1;i++){
    const k=j*width+i,x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell,h=P.harbor,r=Math.hypot(x-h.x,y-h.y),b=P.terraces[0].rect;
    const coast=(x<P.hill.rockyCoast[0]||x>P.hill.rockyCoast[1])&&y>=shoreAt(x)-cell*2&&y<=shoreAt(x)+P.hill.coastEdgeRun+cell*2;
    const plain=!P.terraces.some(t=>rectangleDistance(x,y,t.rect)<t.blend)&&y>=Math.max(P.town.south,shoreAt(x)+P.shore.beach+P.shore.stepRun)&&y<=townNorthAt(x)&&x>=townWestAt(y)&&x<=townEastAt(y);
    const cape=[P.cape,P.eastCape].some(p=>Math.hypot(x-p.x,y-p.y)<=p.radius+cell*2&&y<p.y+p.cliff);
    const masonry=harborAt(x,y).ring&&Math.abs(harborAt(x,y).distance)<=P.works.ringWidth/2+h.slope+cell*2||Math.hypot(x-h.island[0],y-h.island[1])<h.islandRadius+cell*2||[h.quay,h.connection].some(q=>x>=q[0]-cell*2&&x<=q[1]+cell*2&&y>=q[2]-cell*2&&y<=q[3]+cell*2);
    const river=field.riverNear(x,y),rock=y>P.river.valleyNorth&&river.distance<river.width/2+P.river.bankMax;
    const road=field.roadNear(x,y),pass=y>P.road.passSouth-cell*2&&y<P.road.passNorth+cell*2&&road?.road.id==='pass'&&road.distance<P.road.passWidth+cell*2;
    const run=P.buddha.cliffHeight/Math.tan(P.buddha.cliffAngle*Math.PI/180)+P.buddha.cliffBlend+cell*2;
    const cliff=(x>b[0]-cell*2&&x<b[1]+cell*2&&y>=b[2]-run&&y<=b[2]+cell*2)||(y>b[2]-cell*2&&y<b[3]+cell*2&&x>=b[0]-run&&x<=b[0]+cell*2);
    if(!plain&&!coast&&!cape&&!masonry&&!rock&&!pass&&!cliff&&!outcropAt(x,y,P.grid.cell*2)&&!P.terraces.some(t=>inRect(x,y,t.rect)))free[k]=1;
  }
  // A fixed terrace also supplies a lower slope envelope. Lowering only its neighbours
  // previously made a new cliff beside the fixed platform during the first sweep.
  const floor=new Float32Array(heights.length);floor.fill(-Infinity);
  const sites=[...P.terraces.map(t=>t.rect),[...P.shrine.upper,field.upper]];
  for(let j=1;j<height-1;j++)for(let i=1;i<width-1;i++){
    const k=j*width+i;if(!free[k])continue;const x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell;
    for(const r of sites)floor[k]=Math.max(floor[k],r[4]-Math.tan(c.slope*Math.PI/180)*rectangleDistance(x,y,r));
    heights[k]=Math.max(heights[k],floor[k]);
  }
  const step=Math.tan(c.slope*Math.PI/180)*cell;
  let changed=0,sweeps=0;
  for(let round=0;round<c.iterations;round++){
    let delta=0;
    for(const [sx,sy] of [[1,1],[-1,1],[-1,-1],[1,-1]]){
      sweeps++;
      for(let j=sy>0?1:height-2;j>0&&j<height-1;j+=sy)for(let i=sx>0?1:width-2;i>0&&i<width-1;i+=sx){
        const k=j*width+i;if(!free[k])continue;
        const a=Math.min(heights[k-1],heights[k+1]),b=Math.min(heights[k-width],heights[k+width]),d=Math.abs(a-b);
        const limit=d>=step?Math.min(a,b)+step:(a+b+Math.sqrt(2*step*step-d*d))/2;
        if(heights[k]>limit+c.epsilon){delta=Math.max(delta,heights[k]-limit);heights[k]=Math.max(floor[k],limit);changed++;}
      }
    }
    if(delta<c.epsilon)break;
  }
  // Test the two actual mesh triangles as well. A four-neighbour envelope can
  // otherwise leave a short diagonal crease steeper than the continuous field.
  const lower=floor;
  const triangleStep=Math.tan(c.triangleSlope*Math.PI/180)*cell;
  let triangleChanges=0;
  const project=(a,b,d)=>{
    const h0=heights[a],h1=heights[b],h2=heights[d],length=Math.hypot(h1-h0,h2-h0);
    if(length<=triangleStep||!free[a]||!free[b]||!free[d])return;
    const floor=Math.min(h0,h1,h2),ratio=triangleStep/length;
    heights[a]=Math.max(lower[a],floor+(h0-floor)*ratio);heights[b]=Math.max(lower[b],floor+(h1-floor)*ratio);heights[d]=Math.max(lower[d],floor+(h2-floor)*ratio);triangleChanges++;
  };
  for(let round=0;round<c.trianglePasses;round++)for(let j=1;j<height-2;j++)for(let i=1;i<width-2;i++){
    const k=j*width+i;project(k,k+1,k+width);project(k+width+1,k+width,k+1);
  }
  // Finish mixed-boundary triangles too: the earlier sweep only touches triangles whose
  // three vertices are all free. Average towards fixed neighbours without moving authored levels.
  const locked=new Uint8Array(heights.length),before=heights.slice(),touched=new Uint8Array(heights.length);
  for(let j=1;j<height-1;j++)for(let i=1;i<width-1;i++){
    const k=j*width+i,x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell,r=field.riverNear(x,y),road=field.roadNear(x,y);
    const plain=!P.terraces.some(t=>rectangleDistance(x,y,t.rect)<t.blend)&&y>=Math.max(P.town.south,shoreAt(x)+P.shore.beach+P.shore.stepRun)&&y<=townNorthAt(x)&&x>=townWestAt(y)+P.targets.plainEdge&&x<=townEastAt(y)-P.targets.plainEdge;
    const harbor=P.harbor,hr=Math.hypot(x-harbor.x,y-harbor.y),harborFixed=harborAt(x,y).inside||harborAt(x,y).ring&&Math.abs(harborAt(x,y).distance)<harbor.width/2+harbor.slope||[harbor.connection,harbor.quay].some(q=>inRect(x,y,q));
    locked[k]=harborFixed||plain||P.terraces.some(t=>inRect(x,y,t.rect))||inRect(x,y,P.shrine.lower)||inRect(x,y,P.shrine.upper)||Math.abs(x)<=P.stairs.width/2+P.stairs.ear&&y>=P.shrine.stairSouth&&y<=P.shrine.stairNorth||r.distance<=r.width/2+P.river.gravel||road&&road.distance<=road.road.width/2?1:0;
  }
  const finishStep=Math.tan(c.finishSlope*Math.PI/180)*cell;
  let finishPasses=0,finishUpdates=0;
  const averageTriangle=(a,b,d)=>{
    const length=Math.hypot(heights[b]-heights[a],heights[d]-heights[a]);if(length<=finishStep)return;
    let sum=0,count=0;for(const k of [a,b,d])if(locked[k]){sum+=heights[k];count++;}
    const mean=count?sum/count:(heights[a]+heights[b]+heights[d])/3,ratio=finishStep/length;
    for(const k of [a,b,d])if(!locked[k]){const next=Math.max(lower[k],mean+(heights[k]-mean)*ratio);if(Math.abs(next-heights[k])>c.epsilon){heights[k]=next;touched[k]=1;finishUpdates++;}}
  };
  for(let round=0;round<c.finishPasses;round++){
    let bad=0;finishPasses++;
    for(const [sx,sy] of [[1,1],[-1,1],[-1,-1],[1,-1]])for(let j=sy>0?1:height-2;j>0&&j<height-1;j+=sy)for(let i=sx>0?1:width-2;i>0&&i<width-1;i+=sx){
      const k=j*width+i;if((!free[k]&&!locked[k])||heights[k]<=0)continue;
      if(Math.max(Math.hypot(heights[k+1]-heights[k],heights[k+width]-heights[k]),Math.hypot(heights[k+width+1]-heights[k+width],heights[k+width+1]-heights[k+1]))<=finishStep)continue;
      bad++;averageTriangle(k,k+1,k+width);averageTriangle(k+width+1,k+width,k+1);
    }
    if(!bad)break;
  }
  let finishCells=0,finishMaxChange=0;for(let k=0;k<heights.length;k++)if(touched[k]){finishCells++;finishMaxChange=Math.max(finishMaxChange,Math.abs(heights[k]-before[k]));}
  // The frame is scenery, with a one-sided derivative. Carry the graded edge out
  // to the final sample rather than leaving an ungraded two-metre rim.
  for(let j=0;j<height;j++){heights[j*width]=heights[j*width+1];heights[j*width+width-1]=heights[j*width+width-2];}
  for(let i=0;i<width;i++){heights[i]=heights[width+i];heights[(height-1)*width+i]=heights[(height-2)*width+i];}
  return {sweeps,changed,triangleChanges,finishPasses,finishCells,finishUpdates,finishMaxChange};
}
