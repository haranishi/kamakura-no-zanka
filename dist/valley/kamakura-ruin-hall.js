// Original deterministic joinery and rubble, in metres. No geography or renderer state.
export const RUIN_HALL = Object.freeze({
  burntFraction: .3, burntDiameter: .45, burntMinHeight: .3, burntMaxHeight: .9, // ratio / m / ratios: charred survivors.
  burntLeaning: 3, burntLean: 8, burntBeamsMin: 4, burntBeamsMax: 8, // counts / degrees / counts: fallen beams only.
  burntBeamLength: 6, burntBeamWidth: .35, burntBeamYaw: .65, // m / m / radians: ground timber and overlap.
  burntAshSides: 12, burntAshInner: .86, burntAshOuter: .96, burntAshGain: .45, // count / footprint ratios / gain: irregular dark ash.
  burntGrass: 7, burntGrassSize: .8, burntGrassGain: .65, // count / m / gain: sparse old regrowth, existing crop colour.
  burntEdge: .8, burntLift: .02, burntGrassLift: .03, // m: footprint margin and terrain-following surface offsets.
  burntDraws: 6, // hard draw limit shared by open and burnt halls.
  spacing: 4.5, // m: intended pillar bay, capped to keep the silhouette within budget.
  minPosts: 12, maxPosts: 20, fraction: .4, // count / ratio: surviving perimeter and inner-row columns.
  diameter: .55, // m: old column diameter.
  eaveRatio: .68, minHeight: .5, // ratios: eave / roof height, broken / eave height.
  leanMin: 5, leanMax: 15, leaning: 3, // degrees / count: columns leaning away from the entrance.
  beams: 6, dropped: 2, // count: head ties, including fallen ends.
  frontClear: 3, // m: clear central approach, including space for the hero's radius.
  pileCount: 4, pileLength: 6, pileDepth: 3, pileHeight: 1.1, // count / m: rubble heaps.
  timberMin: 3, timberMax: 9, pileMembers: 9, // m / count: stacked broken timber.
  roofPatches: 2, roofWidth: 3, roofDepth: 2, // count / m: scattered bark and dark planks.
  scaffoldWidth: 7, scaffoldDepth: 2, scaffoldHeight: 5, scaffoldRadius: .1, // m: two-tier repair frame.
  ropeRadius: .14, ropeThickness: .06, // m: lashings around scaffold joints.
  baseHeight: .4, baseWidth: .65, stoneRadius: .5, stoneHeight: .2, // m: edge and exposed round footings.
  minBays: 3, maxBays: 8, neighbourRatio: 1.6, // count / ratio: cap work and link only adjacent grid sites.
  adjacencyEpsilon: .01, // m: identify a shared row without coordinate rounding.
  pileSide: .7, pileBack: -.45, pileFront: .35, // footprint ratios: keep piles alongside the open approach.
  pileRow: 3, pileStack: .6, pileYaw: .12, // count / ratio / radians: irregular rubble layers.
  barkPieces: 6, barkGap: .9, barkThickness: .08, barkYaw: .3, // count / ratio / m / radians: loose roof fragments.
  scaffoldBack: -.25, tiers: 2, lashings: 3, // footprint ratio / count: repair frame and rope wraps.
  stockCount: 12, stockColumns: 3, stockSpacing: .65, stockLift: .3, // count / m: neat new lumber.
  stockWidth: .5, stockHeight: .28, rollerHeight: .25, rollerDepth: .4, // m: squared lumber and rolling trestle.
  soilHeight: .025, // m: compacted soil above walking terrain.
  segments: 6, splinter: .18, // sides / m: irregular broken column tops.
  farDistance: 350, lightDistance: 220, adaptDistance: 160, // m: detail-to-frame transition, using 3D distance in flight.
  oldGrey: .45, newWarm: .55, barkDark: .7, brightness: .12, // mixes / multiplier / variation: existing house pigments only.
  debugPost: 0xff0000, debugBeam: 0xff8000, debugPile: 0xffff00, debugRepair: 0x00ffff, debugBase: 0x888888 // unlit inspection colours.
});
export function ruinLocal(box, x, z) {
  const c=Math.cos(box.rotY),s=Math.sin(box.rotY),dx=x-box.x,dz=z-box.z;
  return [c*dx-s*dz,s*dx+c*dz];
}
export function ruinWorld(box, u, v) {
  const c=Math.cos(box.rotY),s=Math.sin(box.rotY);
  return {x:box.x+c*u+s*v,z:box.z-s*u+c*v};
}
export function prepareRuinHall(input, terrain, gates=[]) {
  const C=RUIN_HALL, box={...input};
  // An existing approach gate identifies the front. Snap to the nearest footprint axis.
  let gate=null,distance=Infinity;
  for(const g of gates){const d=Math.hypot(g.x-box.x,g.z-box.z);if(d<distance){distance=d;gate=g;}}
  if(gate){const [u,v]=ruinLocal(box,gate.x,gate.z);
    if(Math.abs(u)>Math.abs(v)){box.rotY+=u>0?Math.PI/2:-Math.PI/2;[box.w,box.d]=[box.d,box.w];}
    else if(v<0)box.rotY+=Math.PI;
  }
  let seed=1977;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const items=[],sites=[],posts=[],beams=[],piles=[],boxes=[],circles=[];
  const yAt=(u,v)=>{const p=ruinWorld(box,u,v);return terrain.heightAt(p.x,p.z);};
  const add=(kind,shape,u,v,y,w,h,d,extra={})=>{const item={kind,shape,u,v,y,w,h,d,...extra};items.push(item);return item;};
  const nx=Math.max(C.minBays,Math.min(C.maxBays,Math.round(box.w/C.spacing))), nz=Math.max(C.minBays,Math.min(C.maxBays,Math.round(box.d/C.spacing)));
  const hx=Math.max(C.diameter,box.w/2-C.baseWidth),hz=Math.max(C.diameter,box.d/2-C.baseWidth);
  for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++)if(i===0||i===nx||j===0||j===nz||j===Math.floor(nz/2)) {
    const u=(i/nx*2-1)*hx,v=(j/nz*2-1)*hz;
    if(Math.abs(u)<C.frontClear/2+C.diameter && v>=0)continue;
    sites.push({u,v,i,j,rank:random()});
  }
  const count=Math.min(sites.length,C.maxPosts,Math.max(C.minPosts,Math.round(sites.length*C.fraction)));
  // Keep neighbouring columns for actual connected beams; deterministic cluster selection.
  sites.sort((a,b)=>a.v-b.v||a.u-b.u);
  const selected=new Set();
  for(let i=0;i<sites.length-1&&selected.size<C.beams+2;i++) {
    const a=sites[i],b=sites[i+1];if(Math.hypot(a.u-b.u,a.v-b.v)<=C.spacing*C.neighbourRatio){selected.add(a);selected.add(b);}
  }
  const ranked=[...sites].sort((a,b)=>a.rank-b.rank);
  for(const s of ranked){if(selected.size>=count)break;selected.add(s);}
  const eave=box.height*C.eaveRatio;
  for(const site of sites){
    const y=yAt(site.u,site.v);
    add('base','round',site.u,site.v,y,C.stoneRadius*2,C.stoneHeight,C.stoneRadius*2);
    if(!selected.has(site))continue;
    const index=posts.length, h=eave*(C.minHeight+(1-C.minHeight)*random()), lean=index<C.leaning?(C.leanMin+(C.leanMax-C.leanMin)*random())*Math.PI/180:0;
    // Lean along local x away from the central route; no tall members over the Buddha's face.
    const du=Math.sign(site.u||1)*Math.tan(lean)*h;
    const p=add('post','round',site.u,site.v,y+C.stoneHeight,C.diameter,h,C.diameter,{du,lean,broken:true});posts.push(p);
    const at=ruinWorld(box,site.u+du/2,site.v);circles.push({...at,r:C.diameter/2+Math.abs(du)/2,height:h,id:'ruin-post'});
  }
  for(let i=0;i<posts.length&&beams.length<C.beams;i++)for(let j=i+1;j<posts.length&&beams.length<C.beams;j++) {
    const a=posts[i],b=posts[j],d=Math.hypot(a.u-b.u,a.v-b.v);
    if(d>C.spacing*C.neighbourRatio || (Math.abs(a.u-b.u)>C.adjacencyEpsilon&&Math.abs(a.v-b.v)>C.adjacencyEpsilon))continue;
    const dropped=beams.length<C.dropped;
    const beam=add('beam','beam',a.u+(a.du||0),a.v,a.y+a.h,C.diameter,C.diameter,C.diameter,{end:[b.u+(b.du||0),dropped?b.y+C.baseHeight:b.y+b.h,b.v],dropped});beams.push(beam);
  }
  // All low heaps and repair work stay outside the central approach strip.
  for(let k=0;k<C.pileCount;k++) {
    const side=k%2?1:-1,u=side*Math.max(C.frontClear/2+C.pileDepth/2+C.baseWidth,hx*C.pileSide),v=(k<C.pileCount/2?C.pileBack:C.pileFront)*hz,y=yAt(u,v);
    const pile={u,v,y,w:C.pileDepth,d:C.pileLength};piles.push(pile);
    const first=items.length;
    for(let m=0;m<C.pileMembers;m++) {
      const length=C.timberMin+(C.timberMax-C.timberMin)*random(),offset=(random()-.5)*(C.pileDepth-C.diameter);
      // Length runs along the hall side, so even the long pieces never intrude on the entrance.
      add('pile',m%C.pileRow?'round':'block',u+offset,v,y+Math.floor(m/C.pileRow)*C.diameter*C.pileStack,C.diameter,C.diameter,length,{yaw:(random()-.5)*C.pileYaw});
    }
    if(k<C.roofPatches)for(let m=0;m<C.barkPieces;m++)add('bark','block',u+(m%C.pileRow-1)*C.roofWidth/C.pileRow,v+(Math.floor(m/C.pileRow)-.5)*C.roofDepth/2,y+C.pileHeight,C.roofWidth/C.pileRow*C.barkGap,C.barkThickness,C.roofDepth/2*C.barkGap,{yaw:(random()-.5)*C.barkYaw});
    let u0=Infinity,u1=-Infinity,v0=Infinity,v1=-Infinity;
    for(let i=first;i<items.length;i++){
      const p=items[i],c=Math.abs(Math.cos(p.yaw||0)),s=Math.abs(Math.sin(p.yaw||0)),ex=(c*p.w+s*p.d)/2,ez=(s*p.w+c*p.d)/2;
      u0=Math.min(u0,p.u-ex);u1=Math.max(u1,p.u+ex);v0=Math.min(v0,p.v-ez);v1=Math.max(v1,p.v+ez);
    }
    const at=ruinWorld(box,(u0+u1)/2,(v0+v1)/2);
    boxes.push({...at,w:u1-u0,d:v1-v0,height:C.pileHeight,rotY:box.rotY,id:'ruin-pile'});
  }
  const su=hx+C.scaffoldDepth,sv=hz*C.scaffoldBack,sy=yAt(su,sv);
  const repairAt=ruinWorld(box,su,sv);boxes.push({...repairAt,w:C.scaffoldDepth,d:C.scaffoldWidth,height:C.scaffoldHeight,rotY:box.rotY,id:'ruin-scaffold'});
  for(const u of [su-C.scaffoldDepth/2,su+C.scaffoldDepth/2])for(const v of [sv-C.scaffoldWidth/2,sv,sv+C.scaffoldWidth/2]) {
    add('repair','round',u,v,sy,C.scaffoldRadius*2,C.scaffoldHeight,C.scaffoldRadius*2);
    for(let tier=1;tier<=C.tiers;tier++){
      const y=sy+tier*C.scaffoldHeight/C.tiers;
      if(v<sv+C.scaffoldWidth/2)add('repair','beam',u,v,y,C.scaffoldRadius*2,0,0,{end:[u,y,v+C.scaffoldWidth/2]});
      for(let r=0;r<C.lashings;r++)add('rope','round',u,v,y+r*C.ropeThickness,C.ropeRadius*2,C.ropeThickness,C.ropeRadius*2);
    }
  }
  for(let tier=1;tier<=C.tiers;tier++)for(const v of [sv-C.scaffoldWidth/2,sv+C.scaffoldWidth/2])add('repair','beam',su-C.scaffoldDepth/2,v,sy+tier*C.scaffoldHeight/C.tiers,C.scaffoldRadius*2,0,0,{end:[su+C.scaffoldDepth/2,sy+tier*C.scaffoldHeight/C.tiers,v]});
  for(const u of [su-C.scaffoldDepth/2,su+C.scaffoldDepth/2])add('repair','beam',u,sv-C.scaffoldWidth/2,sy,C.scaffoldRadius*2,0,0,{end:[u,sy+C.scaffoldHeight,sv+C.scaffoldWidth/2]});
  const stockU=-hx-C.pileDepth,stockY=yAt(stockU,0),stockAt=ruinWorld(box,stockU,0);
  boxes.push({...stockAt,w:C.pileDepth,d:C.pileLength,height:C.pileHeight,rotY:box.rotY,id:'ruin-stock'});
  for(let i=0;i<C.stockCount;i++)add('repair','block',stockU+(i%C.stockColumns-1)*C.stockSpacing,0,stockY+Math.floor(i/C.stockColumns)*C.stockLift,C.stockWidth,C.stockHeight,C.pileLength);
  for(const v of [-C.pileLength/C.stockColumns,C.pileLength/C.stockColumns])add('repair','block',stockU,v,stockY,C.pileDepth,C.rollerHeight,C.rollerDepth);
  // Stone perimeter has a deliberate entrance gap; soil is almost flush with walking terrain.
  for(const side of [-1,1])add('base','block',side*(box.w/2-C.baseWidth/2),0,yAt(side*box.w/2,0),C.baseWidth,C.baseHeight,box.d);
  add('base','block',0,-box.d/2+C.baseWidth/2,yAt(0,-box.d/2),box.w,C.baseHeight,C.baseWidth);
  for(const side of [-1,1]){const w=Math.max(0,(box.w-C.frontClear)/2);add('base','block',side*(C.frontClear/2+w/2),box.d/2-C.baseWidth/2,yAt(0,box.d/2),w,C.baseHeight,C.baseWidth);}
  // Terrain-following soil grid avoids floating over a slope, without creating a walking obstacle.
  for(let i=0;i<nx;i++)for(let j=0;j<nz;j++){
    const u=((i+.5)/nx-.5)*box.w,v=((j+.5)/nz-.5)*box.d;
    add('soil','block',u,v,yAt(u,v),box.w/nx,C.soilHeight,box.d/nz);
  }
  return {box,items,posts,beams,piles,boxes,circles,sites,frontClear:C.frontClear};
}
// A separate plan keeps unmarked halls and the open-air Buddha byte-for-byte on their existing path.
export function prepareBurntHall(input, terrain, gates=[]) {
  const C=RUIN_HALL, box={...input}, items=[],sites=[],posts=[],beams=[],circles=[];
  // Reuse only the orientation rule, without producing scaffolds or repair stock.
  let gate=null,distance=Infinity;
  for(const g of gates){const d=Math.hypot(g.x-box.x,g.z-box.z);if(d<distance){distance=d;gate=g;}}
  if(gate){const [u,v]=ruinLocal(box,gate.x,gate.z);if(Math.abs(u)>Math.abs(v)){box.rotY+=u>0?Math.PI/2:-Math.PI/2;[box.w,box.d]=[box.d,box.w];}else if(v<0)box.rotY+=Math.PI;}
  let seed=1977;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const yAt=(u,v)=>{const at=ruinWorld(box,u,v);return terrain.heightAt(at.x,at.z);};
  const nx=Math.max(C.minBays,Math.min(C.maxBays,Math.round(box.w/C.spacing))),nz=Math.max(C.minBays,Math.min(C.maxBays,Math.round(box.d/C.spacing)));
  const hx=Math.max(0,box.w/2-C.burntEdge),hz=Math.max(0,box.d/2-C.burntEdge);
  for(let i=0;i<=nx;i++)for(let j=0;j<=nz;j++)if(i===0||j===0||i===nx||j===nz||j===Math.floor(nz/2)){
    const u=(i/nx*2-1)*hx,v=(j/nz*2-1)*hz;sites.push({u,v,rank:random()});
    items.push({kind:'base',shape:'round',u,v,y:yAt(u,v),w:C.stoneRadius*2,h:C.stoneHeight,d:C.stoneRadius*2});
  }
  const candidates=sites.filter(p=>Math.abs(p.u)>=C.frontClear/2+C.burntDiameter),count=Math.min(candidates.length,Math.round(sites.length*C.burntFraction));
  candidates.sort((a,b)=>a.rank-b.rank);
  for(const site of candidates.slice(0,count)){
    const h=box.height*C.eaveRatio*(C.burntMinHeight+(C.burntMaxHeight-C.burntMinHeight)*random());
    const lean=posts.length<C.burntLeaning?C.burntLean*Math.PI/180:0;
    // Tilt along z, towards the centre, so even a narrow hall retains its full approach strip.
    const dv=-Math.sign(site.v)*Math.min(Math.tan(lean)*h,hz+Math.abs(site.v));
    const p={kind:'post',shape:'round',u:site.u,v:site.v,y:yAt(site.u,site.v)+C.stoneHeight,w:C.burntDiameter,h,d:C.burntDiameter,dv,lean,broken:true};
    posts.push(p);items.push(p);const at=ruinWorld(box,p.u,p.v+dv/2);
    circles.push({...at,r:C.burntDiameter/2+Math.abs(dv)/2,height:h,id:'burnt-hall-post'});
    // Inflate the route guard by the conservative circle used by the movement engine.
    if(Math.abs(p.u)-circles.at(-1).r<C.frontClear/2){circles.at(-1).x=ruinWorld(box,p.u,p.v).x;circles.at(-1).z=ruinWorld(box,p.u,p.v).z;circles.at(-1).r=C.burntDiameter/2;p.dv=0;p.lean=0;}
  }
  const beamCount=C.burntBeamsMin+Math.floor(random()*(C.burntBeamsMax-C.burntBeamsMin+1));
  for(let i=0;i<beamCount;i++){
    const side=i%2?1:-1,u=side*(C.frontClear/2+Math.max(C.burntBeamWidth,(hx-C.frontClear/2)/2)),v=(random()-.5)*hz;
    const length=Math.max(C.burntBeamWidth,Math.min(C.burntBeamLength,2*(hz-Math.abs(v))));
    const yaw=(random()-.5)*C.burntBeamYaw,reach=Math.abs(Math.sin(yaw))*length/2+C.burntBeamWidth/2;
    const safeU=side*Math.max(C.frontClear/2+reach,Math.min(hx-reach,Math.abs(u)));
    const du=Math.sin(yaw)*length/2,dv=Math.cos(yaw)*length/2,lift=C.burntBeamWidth/2;
    const p={kind:'beam',shape:'beam',u:safeU-du,v:v-dv,y:yAt(safeU-du,v-dv)+lift,h:0,w:C.burntBeamWidth,d:0,end:[safeU+du,yAt(safeU+du,v+dv)+lift,v+dv]};items.push(p);beams.push(p);
  }
  const patch=(kind,u,v,w,d,lift,scale=1)=>{
    const vertices=[],sides=kind==='ash'?C.burntAshSides:4;
    for(let i=0;i<sides;i++){const t=i*Math.PI*2/sides,r=kind==='ash'?(i%2?C.burntAshInner:C.burntAshOuter):1;const x=u+Math.cos(t)*w/2*r,z=v+Math.sin(t)*d/2*r;vertices.push([x,yAt(x,z)+lift,z]);}
    items.push({kind,shape:'patch',vertices,centre:[u,yAt(u,v)+lift,v],shade:scale});
  };
  patch('ash',0,0,box.w,box.d,C.burntLift,C.burntAshGain);
  for(let i=0;i<C.burntGrass;i++)patch('grass',(random()-.5)*hx,(random()-.5)*hz,C.burntGrassSize,C.burntGrassSize,C.burntGrassLift,C.burntGrassGain);
  return {burnt:true,box,items,sites,posts,beams,piles:[],boxes:[],circles,frontClear:C.frontClear};
}
// Flat triangles with category and age weights. Far LOD has only box posts and head ties.
export function ruinHallGeometry(plan, far=false) {
  const positions=[],kinds=[],shades=[];
  const triangle=(a,b,c,kind,shade)=>{positions.push(...a,...b,...c);kinds.push(kind,kind,kind);shades.push(shade,shade,shade);};
  const C=RUIN_HALL;
  for(const p of plan.items){
    if(far&&p.kind!=='post'&&p.kind!=='beam'&&!(plan.burnt&&p.kind==='ash'))continue;
    if(p.shape==='patch'){for(let i=0;i<p.vertices.length;i++)triangle(p.centre,p.vertices[(i+1)%p.vertices.length],p.vertices[i],p.kind,p.shade);continue;}
    const log=p.kind==='pile'&&p.shape==='round';
    const start=log?[p.u-Math.sin(p.yaw||0)*p.d/2,p.y+p.h/2,p.v-Math.cos(p.yaw||0)*p.d/2]:[p.u,p.y,p.v], end=log?[p.u+Math.sin(p.yaw||0)*p.d/2,p.y+p.h/2,p.v+Math.cos(p.yaw||0)*p.d/2]:p.end||[p.u+(p.du||0),p.y+p.h,p.v+(p.dv||0)];
    const axial=log||p.shape==='beam'||p.shape==='round'&&p.kind==='post';
    const centre=[p.u,p.y+p.h/2,p.v], n=far||p.shape==='block'||p.shape==='beam'?4:C.segments;
    const vertices=[];
    if(axial){
      const dy=end[1]-start[1],dx=end[0]-start[0],dz=end[2]-start[2],len=Math.hypot(dx,dy,dz)||1,axis=[dx/len,dy/len,dz/len];
      let right=Math.abs(axis[1])>.9?[1,0,0]:[-axis[2],0,axis[0]];const rl=Math.hypot(...right);right=right.map(v=>v/rl);
      const up=[right[1]*axis[2]-right[2]*axis[1],right[2]*axis[0]-right[0]*axis[2],right[0]*axis[1]-right[1]*axis[0]];
      for(let ring=0;ring<2;ring++)for(let i=0;i<n;i++){
        const t=(i+.5)/n*Math.PI*2,r=p.w/(n===4?Math.SQRT2:2),origin=ring?end:start,jag=ring&&p.broken&&!far?(i%3-1)*C.splinter:0;
        vertices.push(origin.map((v,k)=>v+right[k]*Math.cos(t)*r+up[k]*Math.sin(t)*r+axis[k]*jag));
      }
    }else for(let ring=0;ring<2;ring++)for(let i=0;i<n;i++){
      const t=(i+.5)/n*Math.PI*2,round=p.shape==='round',x=Math.cos(t)*p.w/(round?2:Math.SQRT2),z=Math.sin(t)*p.d/(round?2:Math.SQRT2),c=Math.cos(p.yaw||0),s=Math.sin(p.yaw||0);
      vertices.push([centre[0]+c*x+s*z,p.y+ring*p.h,centre[2]-s*x+c*z]);
    }
    // Reverse winding consistently; caps use perimeter fans and no coincident centre vertices.
    for(let i=0;i<n;i++){const j=(i+1)%n;triangle(vertices[i],vertices[n+i],vertices[n+j],p.kind,1);triangle(vertices[i],vertices[n+j],vertices[j],p.kind,1);}
    for(let i=1;i<n-1;i++){triangle(vertices[0],vertices[i],vertices[i+1],p.kind,1-C.brightness);triangle(vertices[n],vertices[n+i+1],vertices[n+i],p.kind,1+C.brightness);}
  }
  return {positions:new Float32Array(positions),kinds,shades,triangles:positions.length/9};
}
