import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { hash, outcropAt, harborAt, shoreAt } from './designed-terrain.mjs';
export function designedSlopes(world) {
  const {width:w,height:h,cell_m:cell}=world.meta.grid,a=world.heights,counts={land:0,measured:0,over30:0,over40:0,over45:0,max:0},distribution=[0,0,0,0,0],steepSamples=[];
  for(let j=1;j<h-1;j++)for(let i=1;i<w-1;i++) {
    const k=j*w+i;if(a[k]<=0)continue;counts.land++;
    const x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell;
    const margin=cell*2,harbor=P.harbor,radius=Math.hypot(x-harbor.x,y-harbor.y);
    const coast=(x<P.hill.rockyCoast[0]||x>P.hill.rockyCoast[1])&&y>=shoreAt(x)-margin&&y<=shoreAt(x)+P.hill.coastEdgeRun+margin;
    const cape=[P.cape,P.eastCape].some(c=>Math.hypot(x-c.x,y-c.y)<=c.radius+margin&&y<c.y+c.cliff);
    const masonry=harborAt(x,y).ring&&Math.abs(harborAt(x,y).distance)<=P.works.ringWidth/2+harbor.slope+margin||Math.hypot(x-harbor.island[0],y-harbor.island[1])<harbor.islandRadius+margin||[harbor.quay,harbor.connection].some(q=>x>=q[0]-margin&&x<=q[1]+margin&&y>=q[2]-margin&&y<=q[3]+margin); // the quay, and the stone apron that joins it to the beach
    const river=world.field.riverNear(x,y),rock=y>P.river.valleyNorth&&river.distance<river.width/2+P.river.bankMax;
    const road=world.field.roadNear(x,y),pass=y>P.road.passSouth-margin&&y<P.road.passNorth+margin&&road?.road.id==='pass'&&road.distance<P.road.passWidth+margin;
    const b=P.terraces[0].rect,c=P.buddha,run=c.cliffHeight/Math.tan(c.cliffAngle*Math.PI/180)+c.cliffBlend+margin;
    const buddha=(x>b[0]-margin&&x<b[1]+margin&&y>=b[2]-run&&y<=b[2]+margin)||(y>b[2]-margin&&y<b[3]+margin&&x>=b[0]-run&&x<=b[0]+margin);
    if(coast||cape||masonry||rock||pass||buddha||outcropAt(x,y,P.grid.cell*2))continue;
    // Both triangles of each actual 2m cell, including short walls that a centred gradient could hide.
    const slope=Math.atan(Math.max(Math.hypot(a[k+1]-a[k],a[k+w]-a[k]),Math.hypot(a[k+w+1]-a[k+w],a[k+w+1]-a[k+1]))/cell)*180/Math.PI;
    counts.measured++;counts.max=Math.max(counts.max,slope);if(slope>30)counts.over30++;if(slope>40)counts.over40++;if(slope>45){counts.over45++;if(steepSamples.length<12)steepSamples.push({x,y,slope});}
    distribution[slope<=8?0:slope<=18?1:slope<=30?2:slope<=45?3:4]++;
  }
  return {...counts,steepSamples,over30Fraction:counts.over30/counts.measured,over40Fraction:counts.over40/counts.measured,over45Fraction:counts.over45/counts.measured,distribution:distribution.map(n=>n/counts.measured)};
}
export function designedTreeSpacing(trees) {
  const bins=new Map(),cell=Math.max(P.veg.crownMax*P.veg.farCrown*2,P.veg.farPitch);let minRatio=Infinity,pairs=0;
  for(const tree of trees){const x=Math.floor(tree[0]/cell),y=Math.floor(tree[1]/cell);for(let j=y-1;j<=y+1;j++)for(let i=x-1;i<=x+1;i++)for(const t of bins.get(i+','+j)||[]){minRatio=Math.min(minRatio,Math.hypot(tree[0]-t[0],tree[1]-t[1])/(tree[5]+t[5]));pairs++;}const key=x+','+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(tree);}
  return {minRatio,pairs};
}
// Compare folded row/column histograms against independent uniform points. Folding removes the authored forest mask.
export function designedTreeRows(trees,period=P.veg.pitch,bins=12) {
  const actual=[Array(bins).fill(0),Array(bins).fill(0)],reference=[Array(bins).fill(0),Array(bins).fill(0)];
  for(let i=0;i<trees.length;i++)for(let axis=0;axis<2;axis++){const t=trees[i][axis]/period;actual[axis][Math.floor((t-Math.floor(t))*bins)]++;reference[axis][Math.floor(hash(i,axis,31)*bins)]++;}
  const cv=a=>Math.sqrt(a.reduce((s,n)=>s+(n-trees.length/bins)**2,0)/bins)/(trees.length/bins);
  return {actual:actual.map(cv),reference:reference.map(cv)};
}
export function designedGroundMeans(world) {
  const palette=[P.ground.sand,P.ground.wet,P.ground.grass,P.ground.forest,P.ground.soil,P.ground.rock,P.ground.gravel,P.ground.riverbed],sums=palette.map(()=>[0,0,0]),counts=palette.map(()=>0),rgb=world.files.get('ground_rgb.bin');
  for(let k=0;k<world.surface.length;k++){const code=world.surface[k];if(code>7||world.heights[k]<0)continue;
    if(code===5){const j=Math.floor(k/world.meta.grid.width),x=P.grid.west+(k%world.meta.grid.width+.5)*P.grid.cell,y=P.grid.north-(j+.5)*P.grid.cell,b=P.terraces[0].rect;
      if((x<b[0]+P.buddha.cliffInset&&y>b[2]-P.buddha.cliffHeight&&y<b[3])||(y<b[2]&&x>b[0]&&x<b[1])||(Math.hypot(x-P.cape.x,y-P.cape.y)<P.cape.radius&&y<P.cape.y+P.cape.cliff))continue;
    }
    if(code===7){const j=Math.floor(k/world.meta.grid.width),y=P.grid.north-(j+.5)*P.grid.cell;if(y<P.town.south)continue;}counts[code]++;for(let q=0;q<3;q++)sums[code][q]+=rgb[k*3+q];}
  return sums.map((s,i)=>({class:i,mean:s.map(v=>v/counts[i]),relative:s.map((v,q)=>v/counts[i]/palette[i][q]-1)}));
}
export function designedTerraceSlopes(field,at=(x,y)=>field.sample(x,y).h) {
  const sites=[...P.terraces.map(t=>({id:t.id,rect:t.rect})),{id:'shrine-lower',rect:[P.shrine.lower[0],P.shrine.lower[1],P.shrine.forecourtLevel,P.shrine.lower[3],P.shrine.lower[4]]},{id:'shrine-upper',rect:[...P.shrine.upper,field.upper]}];
  const slope=(x,y)=>Math.atan(Math.hypot(at(x+1,y)-at(x-1,y),at(x,y+1)-at(x,y-1))/2)*180/Math.PI;
  return sites.map(({id,rect:r})=>{
    let rear=0,front=0,side=0,west=0,east=0,low=Infinity,high=-Infinity;
    for(let x=r[0]+4;x<=r[1]-4;x+=4){for(let y=r[2]+4;y<=r[3]-4;y+=4){const h=at(x,y);low=Math.min(low,h);high=Math.max(high,h);}for(let d=4;d<=P.river.valleyWidth;d+=2){rear=Math.max(rear,slope(x,r[3]+d));front=Math.max(front,slope(x,r[2]-d));}}
    for(let y=r[2]+4;y<=r[3]-4;y+=4)for(let d=4;d<=P.hill.smoothRun;d+=2){west=Math.max(west,slope(r[0]-d,y));east=Math.max(east,slope(r[1]+d,y));side=Math.max(west,east);}
    return {id,rear,front,side,west,east,relief:high-low};
  });
}
export function designedRiverValley(field,at=(x,y)=>field.sample(x,y).h) {
  let max=0,checked=0;const c=P.river;
  for(const p of field.river){if(p.y<c.eastBank[0]||p.y>c.eastBank[1])continue;
    if(field.crossings.some(q=>Math.abs(q.y-p.y)<q.width/2+c.bridgeWidthPad+c.bridgeApron+P.grid.cell*2))continue;
    for(let d=p.width/2+c.bankMax+P.grid.cell*2;d<=p.width/2+c.eastBank[2]-P.grid.cell*2;d+=2){const x=p.x+d,y=p.y;
      if(P.terraces.some(t=>x>=t.rect[0]-P.grid.cell*2&&x<=t.rect[1]+P.grid.cell*2&&y>=t.rect[2]-P.grid.cell*2&&y<=t.rect[3]+P.grid.cell*2))continue;
      const s=Math.atan(Math.hypot(at(x+1,y)-at(x-1,y),at(x,y+1)-at(x,y-1))/2)*180/Math.PI;max=Math.max(max,s);checked++;
    }
  }
  return {max,checked};
}

export function designedForestCoverage(world) {
  const bins=new Map(),size=12;for(const v of world.veg){const key=Math.floor(v[0]/size)+','+Math.floor(v[1]/size);if(!bins.has(key))bins.set(key,[]);bins.get(key).push(v);}
  const {width,height,cell_m:cell}=world.meta.grid;let hills=0,covered=0,outside=0,outsideCovered=0;
  for(let j=0;j<height;j++)for(let i=0;i<width;i++) {
    const k=j*width+i;if(world.surface[k]!==3)continue;
    const x=P.grid.west+(i+.5)*cell,y=P.grid.north-(j+.5)*cell,z=(P.grid.north+P.grid.south)/2-y,bx=Math.floor(x/size),bz=Math.floor(z/size);let near=false;
    for(let dz=-1;dz<=1&&!near;dz++)for(let dx=-1;dx<=1&&!near;dx++)for(const v of bins.get((bx+dx)+','+(bz+dz))||[])if(Math.hypot(v[0]-x,v[1]-z)<=size){near=true;break;}
    hills++;if(near)covered++;if(x<P.grid.walk[0]||x>P.grid.walk[1]||y<P.grid.walk[2]||y>P.grid.walk[3]){outside++;if(near)outsideCovered++;}
  }
  return {hills,covered,fraction:covered/hills,outsideFraction:outsideCovered/outside};
}
