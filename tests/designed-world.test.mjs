import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { designedWorld, designedFetcher } from '../tools/make-designed-world.mjs';
import { PLAN as P } from '../tools/worlds/kamakura-return.mjs';
import { gameZ, gameNorth, northOffset, shoreAt, plainAt, inRect, townWestAt, townNorthAt, townEastAt, harborAt, quayAt, rectangleDistance } from '../tools/lib/designed-terrain.mjs';
import { loadKamakura, validateMeta } from '../dist/valley/kamakura-data.js';
import { sunPlace, airOf } from '../dist/valley/kamakura-atmosphere.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { townFillConfig, TOWN_FILL, prepareTownFill, townBoxesOverlap } from '../dist/valley/kamakura-town-fill.js';
import { overlookConfig, OVERLOOK, createFly, overlookPose } from '../dist/valley/kamakura-fly.js';
import { bridgeSites, withBridgeDecks, bridgeRailBoxes } from '../dist/valley/kamakura-bridges.js';
import { prepareRivers } from '../dist/valley/kamakura-rivers.js';
import { houseBox, houseIntersects } from '../dist/valley/kamakura-houses.js';
import { kamakuraPaths } from '../dist/valley/kamakura-roads.js';
import { prepareVeg, decodeVeg, VEG_FIELDS } from '../dist/valley/kamakura-veg.js';
import { buildColliders, moveActor } from '../dist/valley/collision.js';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
import { readPrivateFacilities, verifyFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
import { verifyDesignedRivers } from '../tools/lib/designed-river-validation.mjs';
import { verifyVeg } from '../tools/lib/kamakura-veg-validation.mjs';
import { verifyPrivateSurface } from '../tools/lib/kamakura-surface-validation.mjs';
import { designedSlopes, designedTreeSpacing, designedTreeRows, designedGroundMeans, designedTerraceSlopes, designedRiverValley, designedForestCoverage } from '../tools/lib/designed-shape-validation.mjs';
import { buildBackdrop, backdropPoint } from '../dist/valley/kamakura-backdrop.js';
const w=await designedWorld({kits:process.env.KZ_KIT_DIR}),data=await loadKamakura(designedFetcher(w.files)),bare=await loadKamakura(designedFetcher(w.files),'?townfill=0'),terrain=createKamakuraTerrain(data);
const at=(x,y)=>terrain.heightAt(x,gameZ(y));
const boxes=d=>d.houses.instances.map(p=>houseBox(d.houses.kinds.get(p.kind),p.matrix));
test('designed: same authored plan and kit produce identical bytes in every file',async()=>{
  const second=await designedWorld({kits:process.env.KZ_KIT_DIR});assert.deepEqual([...second.files.keys()],[...w.files.keys()]);for(const [name,b] of w.files)assert(b.equals(second.files.get(name)),name);
  assert.deepEqual(w.stats.grid,[(P.grid.east-P.grid.west)/P.grid.cell,(P.grid.north-P.grid.south)/P.grid.cell]);assert.equal(w.stats.cell,2);assert.equal(w.files.size,19);
});
test('designed: data whitelist rejects invalid metadata and absent fields preserve legacy defaults',()=>{
  assert.equal(townFillConfig(),TOWN_FILL);assert.equal(overlookConfig(),OVERLOOK);
  assert.deepEqual(townFillConfig(P.townFill),{...TOWN_FILL,...P.townFill});
  for(const value of [null,[],{houseMax:1},{reach:Infinity},{depth:'24'},{frontageMin:30,frontageMax:20},{reach:100,outerStart:200},{houseRate:1},{constructor:1}])assert.throws(()=>townFillConfig(value));
  for(const value of [null,[],{far:'other'},{fov:100},{pitch:NaN},{height:'150'},{__proto__:null,toString:1}])assert.throws(()=>overlookConfig(value));
  assert.throws(()=>validateMeta({...w.meta,overlook:{fov:0}}));assert.throws(()=>validateMeta({...w.meta,town_fill:{depth:NaN}}));
  const camera=createFly('?fly=1&cam=overlook',terrain,{x:0,z:0});assert.equal(camera.fov,P.overlook.fov);assert.equal(camera.pose.pos.y,P.overlook.height);assert.equal(camera.pose.pitch,P.overlook.pitch*Math.PI/180);
  const old={...terrain,meta:{...data.meta}};delete old.meta.overlook;
  assert.deepEqual(createFly('?fly=1&cam=overlook',old,{x:0,z:0}).pose,((p)=>({pos:p.pos,yaw:p.yaw,pitch:p.pitch}))(overlookPose(data.meta.places)));
});
test('designed: complete data loads and existing geometry validators accept synthetic output',async t=>{
  assert(data.houses&&data.veg&&data.facilities&&data.rivers&&data.roads&&data.crossings&&data.ground&&data.surface&&data.patches);
  assert(!data.sandoNotice);assert.equal(data.houseNotice,undefined);assert.equal(data.facilityNotice,undefined);
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'designed-validation-'));
  try {for(const [name,b] of w.files)await fs.writeFile(path.join(dir,name),b);
    const houses=await readPrivateHouses(dir,bare),facilities=await readPrivateFacilities(dir,bare);
    assert.equal(houses.bodies.size,bare.houses.kinds.size);assert.equal(new Set(bare.houses.instances.map(p=>p.kind)).size,bare.houses.kinds.size);
    const f=verifyFacilities(bare,facilities);assert.equal(f.overlaps.spawn.length,0);assert.equal(f.overlaps.paths.length,0);assert.equal(f.overlaps.walkingRoutes.length,0);
    const r=verifyDesignedRivers(bare);assert.equal(r.excludedSegments,0);
    const v=await verifyVeg(bare,dir,houses,facilities.exclusionBoxes);assert(v.used>10000);
    await verifyPrivateSurface(dir);t.diagnostic(JSON.stringify({stats:w.stats,riverTriangles:prepareRivers(data.rivers).chunks.reduce((s,c)=>s+c.indices.length/3,0),facilityTriangles:bare.facilities.catalog.total_triangles,treeDrawUpper:v.spawn,groundingWarnings:f.grounding.byVerticalScale[1].warningCount}));
  } finally {await fs.rm(dir,{recursive:true,force:true});}
});
test('designed: sea, broad beach, gentle plain, flat terraces, hills, land frame and open harbour',()=>{
  assert(at(0,P.grid.south+P.grid.cell)<0);assert(at(0,shoreAt(0)+1)>0);
  for(let x=P.shore.centre-P.shore.halfWidth+10;x<P.shore.centre+P.shore.halfWidth-10;x+=10){if(x>=P.harbor.connection[0]&&x<=P.harbor.connection[1]||Math.abs(x)<=P.roads[0].width/2+P.ground.vergeWidth/2+P.grid.cell)continue;let width=0;for(let d=1;d<P.shore.beach;d++){const y=shoreAt(x)+d,k=Math.round((P.grid.north-y)/2-.5)*w.meta.grid.width+Math.round((x-P.grid.west)/2-.5);if(w.surface[k]===0||w.surface[k]===1)width++;}assert(width>=P.targets.beachWidth[0]&&width<=P.targets.beachWidth[1],'beach width');}
  let maxSlope=0;
  for(let y=P.town.south+8;y<P.town.north-8;y+=8)for(let x=townWestAt(y)+P.targets.plainEdge;x<townEastAt(y)-P.targets.plainEdge;x+=8){if(y>townNorthAt(x)-P.targets.plainEdge||w.field.sample(x,y).code!==4||w.field.roadNear(x,y)?.distance<12||P.terraces.some(t=>rectangleDistance(x,y,t.rect)<Math.max(t.blend,30))||inRect(x,y,[P.shrine.lower[0]-P.shrine.edgeRun,P.shrine.lower[1]+P.shrine.edgeRun,P.shrine.lower[2]-P.shrine.edgeRun,P.shrine.lower[3]]))continue;const edge=Math.min(x-townWestAt(y),townEastAt(y)-x,townNorthAt(x)-y),slope=terrain.slopeAt(x,gameZ(y));maxSlope=Math.max(maxSlope,slope);assert(slope<=(edge<P.targets.plainEdge?P.targets.plainEdgeSlope:2),'town grade '+slope+' at '+x+','+y);}
  const terraces=[...P.terraces.map(t=>t.rect),[P.shrine.lower[0],P.shrine.lower[1],P.shrine.forecourtLevel,P.shrine.lower[3]],[...P.shrine.upper,w.field.upper]];
  for(const r of terraces){let lo=Infinity,hi=-Infinity;for(let x=r[0]+4;x<r[1]-4;x+=4)for(let y=r[2]+4;y<r[3]-4;y+=4){lo=Math.min(lo,at(x,y));hi=Math.max(hi,at(x,y));}assert(hi-lo<=.3,'terrace relief '+(hi-lo));}
  for(const x of [P.grid.west+1,P.grid.east-1])assert(at(x,P.grid.north-1)>=100&&at(x,P.grid.north-1)<=115);
  assert(at(P.hill.peakEast,P.hill.peakNorth)>=120);
  for(let y=P.hill.peakNorth;y<P.grid.north;y+=4)for(let x=P.grid.west+10;x<P.grid.east-10;x+=4)assert(at(x,y)<=135.01,'north mountain height cap');
  for(let x=P.grid.west+1;x<P.grid.east;x+=10)assert(at(x,P.grid.north-1)>=P.hill.edgeHeight-P.grid.cell);
  const c=P.harbor;for(let deg=124;deg<=262;deg++){ // between the tapers at the mouth and at the landward root
    const a=deg*Math.PI/180,x=c.x+(c.radius-c.width/2)*Math.sin(a),y=c.y+(c.radiusY-c.width/2)*Math.cos(a);assert(at(x,y)>1,'southern elliptical wall');}

  assert(at(c.x,c.y)<0);assert(at(c.island[0],c.island[1])>=c.island[2]-.1);
});
test('designed: river runs downhill, is sampled every four metres and has no inverted ribbon',()=>{
  const r=data.rivers.rivers[0];for(let i=1;i<r.xy_m.length;i++){assert(r.bed_m[i]<=r.bed_m[i-1]+1e-8);const d=Math.hypot(r.xy_m[i][0]-r.xy_m[i-1][0],r.xy_m[i][1]-r.xy_m[i-1][1]);assert(d<=4.001);if(i<r.xy_m.length-1)assert(d>P.river.step*.98);}
  const prepared=prepareRivers(data.rivers);assert.equal(prepared.ribbons.reduce((s,r)=>s+r.excludedSegments,0),0);const end=r.xy_m.at(-1);assert(terrain.isSea(end[0],-end[1]));
  for(let y=P.river.points.at(-1)[1];y>P.grid.south+P.grid.inset;y-=P.grid.cell)assert(at(end[0],y)<0,'river mouth must remain connected to the southern sea');
  assert(r.water_elev_m.every((v,i)=>v>r.bed_m[i]&&Math.abs(v-r.bed_m[i]-r.depth_m[i])<1e-6));
});
test('designed: the central avenue is the widest and both recorded crossings make short bank-top bridges',()=>{
  const axis=prepareTownFill(bare).stats.axis;assert.equal(axis.width,P.roads[0].width);assert(axis.points.every(p=>Math.abs(p.x)<1e-8));
  assert.equal(Math.max(...Object.values(data.roads).map(p=>p.width_m)),P.roads[0].width);
  const sites=bridgeSites(data,terrain);assert.equal(sites.length,2);for(const c of w.field.crossings){const s=sites.find(s=>Math.hypot(s.x-c.x,s.z-gameZ(c.y))<1);assert(s);assert(s.span<=w.field.riverNear(c.x,c.y).width+P.river.bridgeExtra);}
});
test('designed: the overridden town adds houses within the planned range, without water, platforms, facilities, old houses or routes underneath',t=>{
  const r=prepareTownFill(bare);const old=boxes(bare),added=boxes(r),fac=w.nodes.map(n=>({x:n.anchor_xz[0],z:n.anchor_xz[1],w:n.bbox_max[0]-n.bbox_min[0],d:n.bbox_max[2]-n.bbox_min[2],rotY:0}));
  for(const b of added.slice(old.length)){
    for(const o of [...old,...fac])assert(!townBoxesOverlap(b,o));
    for(let x=-b.w/2;x<=b.w/2;x+=2)for(let z=-b.d/2;z<=b.d/2;z+=2){const co=Math.cos(b.rotY),si=Math.sin(b.rotY),px=b.x+co*x+si*z,pz=b.z-si*x+co*z;assert.equal(terrain.waterAt(px,pz),0);assert.equal(terrain.surfaceAt(px,pz).dirt,1);assert(!P.terraces.some(t=>inRect(px,northOffset-pz,t.rect)));}
  }
  for(let i=0;i<added.length;i++)for(let j=Math.max(i+1,old.length);j<added.length;j++)assert(!townBoxesOverlap(added[i],added[j]));
  for(const p of Object.values(kamakuraPaths(data)))for(let i=1;i<p.xyz_m.length;i++){const a={x:p.xyz_m[i-1][0],z:-p.xyz_m[i-1][1]},b={x:p.xyz_m[i][0],z:-p.xyz_m[i][1]};for(const box of added.slice(old.length))assert(!houseIntersects(box,a,b,.3));}
  t.diagnostic(JSON.stringify({houses:r.stats.houses,work:r.stats.work}));assert(r.stats.houses.added>=P.targets.addedHouses[0]&&r.stats.houses.added<=P.targets.addedHouses[1]);
});
test('designed: the avenue entrance has a town house on each side and original houses keep road clearances',()=>{
  for(const side of [-1,1])assert(bare.houses.instances.some(p=>{const k=bare.houses.kinds.get(p.kind),b=houseBox(k,p.matrix);return k.house_type.startsWith('machiya')&&Math.sign(b.x)===side&&Math.abs(b.x)<50&&northOffset-b.z>=P.town.south&&northOffset-b.z<=P.town.south+30;}));
  for(const b of boxes(bare))for(const road of w.field.roads)for(let i=1;i<road.points.length;i++)assert(!houseIntersects(b,{x:road.points[i-1][0],z:gameZ(road.points[i-1][1])},{x:road.points[i][0],z:gameZ(road.points[i][1])},road.width/2));
});
test('designed: generated individual trees already avoid roads, filled houses, facilities and rivers',()=>{
  const all=boxes(data),fac=w.nodes.map(n=>({x:n.anchor_xz[0],z:n.anchor_xz[1],w:n.bbox_max[0]-n.bbox_min[0],d:n.bbox_max[2]-n.bbox_min[2],rotY:0}));
  const bin=w.files.get('veg_f32.bin'),trees=decodeVeg(JSON.parse(w.files.get('veg.json')),bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.length)),prepared=prepareVeg(trees,terrain,{boxes:[...all,...fac],paths:kamakuraPaths(data),spawn:{x:data.meta.spawn.x,z:-data.meta.spawn.y}});
  const gardenTrees=w.veg.filter(v=>v[7]===0&&v[4]>=P.veg.gardenHeight&&v[4]<=P.veg.gardenHeight+P.veg.gardenHeightRange).length;assert(gardenTrees>=Math.floor(data.houses.instances.length/P.veg.gardenEvery)*.75);
  assert(prepared.active.length>10000);assert.equal(prepared.excluded.water,0);assert.equal(prepared.excluded.house,0);assert.equal(prepared.excluded.path,0);assert.deepEqual(JSON.parse(w.files.get('veg.json')).fields,VEG_FIELDS);
});
test('designed: disabling avenue decoration preserves the authored avenue axis for town fill',async()=>{
  const off=await loadKamakura(designedFetcher(w.files),'?avenue=0&townfill=0');assert.equal(prepareTownFill(off).stats.axis.width,P.roads[0].width);assert.equal(off.avenue,undefined);
});
test('designed: optional real kits are read only at execution time and also load',{skip:!process.env.KZ_KIT_DIR&&'KZ_KIT_DIR未設定'},async t=>{
  const {loadDesignedKits}=await import('../tools/lib/designed-kits.mjs');const kit=await loadDesignedKits(process.env.KZ_KIT_DIR),stairs=kit.nodes.find(n=>n.part==='stairs');assert.equal(kit.stairRise,P.stairs.totalRise);assert(stairs.triangles<=P.stairs.triangles);
  const real=await designedWorld({kits:process.env.KZ_KIT_DIR}),d=await loadKamakura(designedFetcher(real.files)),terr=createKamakuraTerrain(d);
  assert(d.houses&&d.facilities&&d.veg);assert(real.stats.treeIndividuals>=P.targets.trees[0]&&real.stats.treeIndividuals<=P.targets.trees[1]);assert.equal(real.stats.stands,0);assert.deepEqual(real.meta.veg_policy,{range:P.veg.range,far:P.veg.far});
  const shape=designedSlopes(real);assert(shape.over45Fraction===0&&shape.over30Fraction<=.45&&shape.over40Fraction<=.12);assert(designedTreeSpacing(real.veg).minRatio>=.7-1e-5);
  const atReal=(x,y)=>terr.heightAt(x,gameZ(y));for(const p of designedTerraceSlopes(real.field,atReal)){assert(p.front<=(p.id==='buddha'?70:p.id==='kenchoji'?45:P.targets.platformSlope)&&p.rear<=(p.id==='kenchoji'?45:P.targets.platformSlope)&&p.relief<=.3,p.id+' real-kit earthwork');}assert(designedRiverValley(real.field,atReal).max<=8);
  assert(real.stats.addedHouses>=P.targets.addedHouses[0]&&real.stats.addedHouses<=P.targets.addedHouses[1]);assert.equal(bridgeSites(d,terr).length,2);assert.equal(new Set(real.placed.houses.map(p=>p.kind)).size,d.houses.kinds.size);t.diagnostic(JSON.stringify(real.stats));
});

test('designed: physical movement reaches every landmark and both banks, returns, and adds no traps',{timeout:180000},async t=>{
  const {designedMovement}=await import('../tools/lib/designed-movement-validation.mjs');
  const report=designedMovement(data,bare.houses.instances.length);t.diagnostic(JSON.stringify(report));
  for(const goal of report.goals){assert(goal.distance<=4,goal.name+' has no nearby free cell');assert(goal.forward&&goal.back,goal.name+' cannot go and return');}
  assert.equal(report.newTraps,0);assert.equal(report.enclosed,0);
});

test('designed fix1 T1: actual terrain triangles obey slope budgets and each summit has relief',t=>{
  const report=designedSlopes(w);assert(report.over45Fraction===0);assert(report.over30Fraction<=.45);t.diagnostic(JSON.stringify(report));
  for(const [west,east,south,north,minPeak,maxPeak] of [[P.grid.west,P.grid.east,540,600,120,135],[-430,-375,100,330,95,110],[375,430,100,330,90,105]]) {
    let peak=-Infinity,point;for(let y=south;y<=north;y+=4)for(let x=west;x<=east;x+=4){const z=at(x,y);if(z>peak){peak=z;point=[x,y];}}
    assert(peak>=minPeak&&peak<=maxPeak,'regional peak height '+peak);
    let low=peak;for(let y=point[1]-P.hill.wave/2;y<=point[1]+P.hill.wave/2;y+=6)for(let x=point[0]-P.hill.wave/2;x<=point[0]+P.hill.wave/2;x+=6)if(Math.hypot(x-point[0],y-point[1])<=P.hill.wave/2&&x>P.grid.west&&x<P.grid.east&&y>P.grid.south&&y<P.grid.north)low=Math.min(low,at(x,y));
    assert(peak-low>=12,'summit must have valleys within 150m');
  }
  let peak=-Infinity,ridgeY=0;for(let y=P.shrine.upper[3];y<P.grid.north;y+=2)if(at(0,y)>peak){peak=at(0,y);ridgeY=y;}
  assert(ridgeY-P.shrine.upper[3]>=P.hill.frontRun,'shrine foothill cannot rise as a cliff');
  const mean=Math.atan((peak-at(0,P.town.north))/(ridgeY-P.town.north))*180/Math.PI;
  assert(mean>=10&&mean<=40,'main foothill mean inclination '+mean);
});
test('designed fix1 T2: rounded platform cuts and fills keep slopes, flat tops and low front steps',t=>{
  const report=designedTerraceSlopes(w.field,at);for(const p of report){assert(p.relief<=.3,p.id);assert(p.rear<=(p.id==='kenchoji'?45:P.targets.platformSlope),p.id+' rear '+p.rear);assert(p.front<=(p.id==='buddha'?70:p.id==='kenchoji'?45:P.targets.platformSlope),p.id+' front '+p.front);assert(p.west<=(p.id==='buddha'?70:P.targets.platformSlope),p.id+' west '+p.west);assert(p.east<=(p.id==='kenchoji'?45:P.targets.platformSlope),p.id+' east '+p.east);}
  for(const r of [...P.terraces.map(t=>t.rect),P.shrine.lower,[...P.shrine.upper,w.field.upper]])for(let x=r[0]+4;x<=r[1]-4;x+=4)if(r!==P.terraces[0].rect)assert(Math.abs(at(x,r[2]+1)-at(x,r[2]-1))<=3,'front masonry cannot exceed 3m');
  const upper=report.find(p=>p.id==='shrine-upper');assert(upper.rear<=P.targets.platformSlope);t.diagnostic(JSON.stringify(report));
});
test('designed fix2 F2: the eastern river valley remains gentle without the former southeast plain',t=>{
  const report=designedRiverValley(w.field,at);assert(report.checked>40);assert(report.max<=8,'natural river valley '+report.max);t.diagnostic(JSON.stringify(report));

});
test('designed fix1 T4: mean sRGB colours stay within eight percent of the authored swatches',t=>{
  const means=designedGroundMeans(w);for(const p of means)assert(p.relative.every(v=>Math.abs(v)<=.08),'class '+p.class);t.diagnostic(JSON.stringify(means));
  const colours=w.files.get('ground_rgb.bin'),k=(x,y)=>(Math.round((P.grid.north-y)/2-.5)*w.meta.grid.width+Math.round((x-P.grid.west)/2-.5))*3;
  assert(colours[k(0,(P.town.south+P.town.north)/2)]>colours[k(P.roads[0].width,(P.town.south+P.town.north)/2)],'avenue must be brighter than neighbouring soil');
});
test('designed fix1 T5: all trees are individuals, correctly spaced, unaligned and use the distant policy',t=>{
  assert(w.veg.length>=P.targets.trees[0]&&w.veg.length<=P.targets.trees[1]);assert(w.veg.every(v=>v[7]===0));assert.equal(w.stats.stands,0);
  assert.deepEqual(w.meta.veg_policy,{range:P.veg.range,far:P.veg.far});assert.deepEqual(JSON.parse(w.files.get('meta.json')).veg_policy,w.meta.veg_policy);
  const buffer=w.files.get('veg_f32.bin'),rounded=Array.from({length:w.veg.length},(_,i)=>Array.from({length:16},(_,j)=>buffer.readFloatLE(i*64+j*4)));
  const spacing=designedTreeSpacing(rounded);assert(spacing.minRatio>=.7-1e-5);
  for(const period of [P.veg.pitch,P.veg.pitch/2,P.veg.pitch*2]){const rows=designedTreeRows(w.veg,period);for(let axis=0;axis<2;axis++)assert(rows.actual[axis]<=Math.max(.035,rows.reference[axis]*2.5),'row/column alignment');}
  let same=0,pairs=0;const bins=new Map(),cell=P.veg.speciesWave;
  for(const v of w.veg){const x=Math.floor(v[0]/cell),y=Math.floor(v[1]/cell);for(let j=y-1;j<=y+1;j++)for(let i=x-1;i<=x+1;i++)for(const o of bins.get(i+','+j)||[]){const d=Math.hypot(v[0]-o[0],v[1]-o[1]);if(d<12){pairs++;if(v[6]===o[6])same++;}}const key=x+','+y;if(!bins.has(key))bins.set(key,[]);bins.get(key).push(v);}
  assert(same/pairs>.48,'species should form patches rather than independent random marks');
  t.diagnostic(JSON.stringify({spacing,rows:designedTreeRows(w.veg),sameSpeciesNearby:same/pairs}));
});
test('designed fix1 T6: town edges curve, valley mouths open toward town, and exterior mountains attach',t=>{
  const west=[],north=[];for(let y=P.town.south;y<=P.town.north;y+=10)west.push(townWestAt(y));for(let x=P.town.west;x<P.town.east;x+=10)north.push(townNorthAt(x));
  assert(Math.max(...west)-Math.min(...west)>=20);assert(Math.max(...north)-Math.min(...north)>=20);
  for(const v of P.valleys){const r=P.terraces.find(t=>t.id===v.id).rect;let previous=at(...v.centre);for(let d=5;d<=v.sideRun;d+=5){const x=v.centre[0]+v.toward[0]*d,y=v.centre[1]+v.toward[1]*d,h=at(x,y);if(x<r[0]||x>r[1]||y<r[2]||y>r[3])assert(h<=(v.id==='toshoji'?Math.max(r[4],plainAt(x,y)):r[4])+.3,'valley mouth cannot be walled above its platform');previous=h;}assert(previous<r[4]);}
  const backdrop=buildBackdrop(terrain);assert.equal(backdrop.landEdges.north,1);assert(backdrop.landEdges.west>.7);assert(backdrop.landEdges.east>.7);assert(backdrop.triangles>0&&backdrop.draws<=2);
  for(const [x,z] of [[terrain.bounds.minX,0],[terrain.bounds.maxX,0],[0,terrain.bounds.minZ]])assert.equal(backdropPoint(terrain,x,z).height,terrain.heightAt(x,z));
  t.diagnostic(JSON.stringify({landEdges:backdrop.landEdges,triangles:backdrop.triangles,draws:backdrop.draws}));
});

test('designed fix2 F1/F9: expanded frame, walk limits and every upper-frame ray hit terrain',async t=>{
  const {designedFrameHits}=await import('../tools/lib/designed-perspective.mjs');
  const hits=designedFrameHits({sample:(x,y)=>({h:at(x,y)})});assert.equal(hits.length,19);assert(hits.slice(0,9).filter(p=>p.hit).length>=7);
  for(let y=P.grid.south+1;y<P.grid.north;y+=P.grid.cell)for(const x of [P.grid.west+1,P.grid.east-1]){if(y<shoreAt(x))assert(at(x,y)<0);else if(y>=shoreAt(x)+P.hill.coastRun)assert(at(x,y)>=P.hill.edgeHeight*.85,'edge '+at(x,y)+' at '+x+','+y);}
  for(let x=P.grid.west+1;x<P.grid.east;x+=P.grid.cell)assert(at(x,P.grid.south+1)<0);
  const walk=P.grid.walk;
  for(const [x,y] of [[walk[0]-1,P.town.north],[walk[1]+1,P.town.north],[0,walk[2]-1],[0,walk[3]+1]])assert(!terrain.walkable(x,gameZ(y)));
  for(const x of [P.grid.west+1,P.grid.east-1])assert(at(x,P.grid.north-1)>=100&&at(x,P.grid.north-1)<=115);
  assert(at(P.hill.peakEast,P.hill.peakNorth)>=120&&at(P.hill.peakEast,P.hill.peakNorth)<=135);
  let front=0;for(let y=P.hill.frontNorth-10;y<=P.hill.frontNorth+10;y+=2)for(let x=-30;x<=30;x+=2)front=Math.max(front,at(x,y));assert(front>=55&&front<=62);
  assert.deepEqual(w.meta.overlook,P.overlook);t.diagnostic(JSON.stringify({frameHits:hits.filter(p=>p.hit).length}));
});
test('designed fix2 F2/F3: coastline order, island, connected quay, raised temples and burnt hall',()=>{
  assert(P.cape.x<P.harbor.connection[0]&&P.harbor.connection[0]<P.harbor.x&&P.harbor.x<P.river.points.at(-1)[0]&&P.river.points.at(-1)[0]<P.eastCape.x);
  const h=P.harbor;assert.equal(h.mouth,90);assert(at(h.x,h.y)<=h.innerDepth+.1);assert(at(...h.island.slice(0,2))>=h.island[2]-.1);
  for(const site of P.terraces.filter(t=>['kenchoji','jochiji'].includes(t.id))){const r=site.rect;assert(Math.abs(at((r[0]+r[1])/2,(r[2]+r[3])/2)-r[4])<.02);}
  const burnt=data.facilities.nodes.filter(n=>n.facility==='toshoji'&&n.part==='hall');assert.equal(burnt.length,1);assert.equal(burnt[0].ruin,'burnt');
  assert.equal(bridgeSites(data,terrain).length,2);for(const r of data.rivers.rivers)for(let i=0;i<r.bed_m.length;i++)assert(Math.abs(r.water_elev_m[i]-r.bed_m[i]-r.depth_m[i])<1e-9);
});
test('designed fix2 F4/F5: town tree count, brighter lanes, four-metre wet band and irregular banks',t=>{
  const trees=w.veg.filter(v=>v[0]>=P.town.west&&v[0]<=P.town.east&&northOffset-v[1]>=P.town.south&&northOffset-v[1]<=P.town.north);assert(trees.length>=P.targets.townTrees[0]&&trees.length<=P.targets.townTrees[1],'town trees '+trees.length);const runtimeTown=data.veg.filter(v=>v.x>=P.town.west&&v.x<=P.town.east&&northOffset-v.z>=P.town.south&&northOffset-v.z<=P.town.north);assert(runtimeTown.length>=P.targets.townTrees[0]&&runtimeTown.length<=P.targets.townTrees[1],'runtime town tree count includes avenue pines');
  const rgb=w.files.get('ground_rgb.bin'),colour=(x,y)=>{const i=Math.max(0,Math.min(w.meta.grid.width-1,Math.round((x-P.grid.west)/P.grid.cell-.5))),j=Math.max(0,Math.min(w.meta.grid.height-1,Math.round((P.grid.north-y)/P.grid.cell-.5)));return rgb[(j*w.meta.grid.width+i)*3];};
  let bright=0,checked=0;for(const lane of Object.values(data.lanes))for(let i=2;i<lane.xyz_m.length-2;i+=3){const [x,y]=lane.xyz_m[i],v=colour(x,y+northOffset);if(v>P.ground.soil[0]*1.035)bright++;checked++;}assert(bright/checked>.5,'lane pixels should be brighter than soil');
  for(let x=P.shore.centre-P.shore.halfWidth+10;x<=P.shore.centre+P.shore.halfWidth-10;x+=10)for(let dy=P.shore.wet+4;dy<P.shore.beach-2;dy+=2){const y=shoreAt(x)+dy,k=Math.round((P.grid.north-y)/2-.5)*w.meta.grid.width+Math.round((x-P.grid.west)/2-.5);assert.notEqual(w.surface[k],1);}
  const bank=w.veg.map(v=>({v,r:w.field.riverNear(v[0],northOffset-v[1])})).filter(({v,r})=>northOffset-v[1]>P.town.south&&northOffset-v[1]<P.river.valleyNorth&&r.distance>r.width/2+2&&r.distance<r.width/2+24).sort((a,b)=>a.r.y-b.r.y);
  const gaps=bank.slice(1).map((p,i)=>p.r.y-bank[i].r.y),mean=gaps.reduce((s,v)=>s+v,0)/gaps.length,cv=Math.sqrt(gaps.reduce((s,v)=>s+(v-mean)**2,0)/gaps.length)/mean;
  assert(bank.length>20);assert(cv>.6,'riverbank trees must form clusters');t.diagnostic(JSON.stringify({townTrees:trees.length,laneBrightFraction:bright/checked,bankSpacingCV:cv}));
});
test('designed fix2 F6/F7: grounded stair edges, exact endpoints, triangle cap and forest coverage',t=>{
  const steps=w.stairs.steps;assert.equal(steps[0].top,P.shrine.lower[4]);assert.equal(steps.at(-1).top,w.field.upper);assert(w.stairs.triangles<=1200);
  for(const p of steps)for(const x of [-P.stairs.width/2,0,P.stairs.width/2]){// The first row of cells lies under the first tread, level with the terrace, so the treads just behind it stand higher above the ground.
    const gap=p.top-w.field.sample(x,p.y).h,first=p.y<P.shrine.stairSouth+P.grid.cell;assert(gap>=.02&&(first||gap<=.45),'step must sit above its own terrain');const emitted=p.top-at(x,p.y);assert(emitted>=.02&&emitted<=.45,'stair edge must clear the decoded terrain');}
  for(let i=1;i<steps.length;i++)assert(steps[i].top-steps[i-1].top<=P.stairs.rise+1e-9);
  const coverage=designedForestCoverage(w);assert(coverage.fraction>=.9);assert(coverage.outsideFraction>=.9);t.diagnostic(JSON.stringify({stairs:w.stairs.triangles,stairDraws:P.stairs.tones,coverage}));
});
test('designed fix2 F8: works pass runtime construction and boats remain inside the ring on water',async t=>{
  const {decodeWorks,prepareWorks}=await import('../dist/valley/kamakura-works.js');const source=decodeWorks(JSON.parse(w.files.get('works.json'))),works=prepareWorks(source,terrain);
  assert.deepEqual(w.meta.works,{file:'works.json'});assert.equal(source.rocks.length,10);assert.equal(source.moorings.length,4);assert.equal(works.piers.length,1);assert.equal(works.moorings.filter(p=>p.kind==='boat').length,3);
  const ring=works.rocks.filter(r=>r.group===0);assert(ring.length>0);for(const r of ring)assert(r.ground+r.size*Math.max(r.sx,r.sy,r.sz)>0,'wall stones reach above water');
  for(const m of works.moorings){assert(terrain.heightAt(m.x,m.z)<0);const h=P.harbor;assert(((m.x-h.x)/h.radius)**2+((northOffset-m.z-h.y)/h.radiusY)**2<1);}

  for(let i=0;i<works.moorings.length;i++)for(let j=0;j<i;j++)assert(!townBoxesOverlap({...works.moorings[i],rotY:works.moorings[i].yaw},{...works.moorings[j],rotY:works.moorings[j].yaw},2));
  t.diagnostic(JSON.stringify({rocks:works.rocks.length,skipped:works.skipped,work:works.work,piers:works.piers.length,boats:works.moorings.length}));
});

test('designed fix3 G1: the complete outer harbour and stones fit with a two-percent frame margin',async t=>{
  const {designedCamera}=await import('../tools/lib/designed-perspective.mjs'),camera=designedCamera(),h=P.harbor;let right=0,left=1;
  for(let a=110;a<=270;a+=.25){const r=P.works.ringSize[1]/2,p=camera.project(h.x+(h.radius+r)*Math.sin(a*Math.PI/180),h.y+(h.radiusY+r)*Math.cos(a*Math.PI/180),h.height);right=Math.max(right,p[0]/P.preview.perspectiveWidth);left=Math.min(left,p[0]/P.preview.perspectiveWidth);assert(p[1]>=P.preview.perspectiveHeight*.02&&p[1]<=P.preview.perspectiveHeight*.97);}
  assert(right<=.98);assert(left>=.02);t.diagnostic(JSON.stringify({rightMargin:1-right}));
});
test('designed fix3 G2: lanes, striped gardens, repairs and sand remain distinct in emitted RGB',async t=>{
  const {designedFurrow}=await import('../tools/lib/designed-ground.mjs');
  const rgb=w.files.get('ground_rgb.bin'),brightness=k=>.2126*rgb[k*3]+.7152*rgb[k*3+1]+.0722*rgb[k*3+2];let lane=0,ln=0,soil=0,sn=0,sand=0,an=0;
  for(let k=0;k<w.surface.length;k++){if(w.ground.laneAt[k]===1){lane+=brightness(k);ln++;}else if(w.surface[k]===4&&!w.ground.stripe[k]){soil+=brightness(k);sn++;}if(w.surface[k]===0&&w.heights[k]>0){sand+=brightness(k);an++;}} // the sandy seabed carries the colours of the depth, not of the beach
  assert(lane/ln>=soil/sn*1.1);assert(sand/an>=soil/sn*1.25);
  assert.deepEqual(designedFurrow(.6),P.ground.soil);assert.deepEqual(designedFurrow(1.8),P.ground.crop);
  let striped=0;
  for(const f of w.field.farms){const rows=[];for(let d=-f.depth/2+2;d<f.depth/2-2;d+=2){const x=f.x-Math.sin(f.yaw)*d,y=f.y+Math.cos(f.yaw)*d,k=Math.floor((P.grid.north-y)/2)*w.meta.grid.width+Math.floor((x-P.grid.west)/2);rows.push(rgb[k*3]);}if(Math.max(...rows)-Math.min(...rows)>15)striped++;}
  assert(striped>=w.field.farms.length*.8);t.diagnostic(JSON.stringify({laneGain:lane/ln/(soil/sn),sandGain:sand/an/(soil/sn),stripedFarms:striped}));
});
test('designed fix3 G3/G4: wavy forest margins, grouped farms, small homes, trees and narrow east bank',t=>{
  assert(w.field.farms.length>=P.targets.farms);assert(w.placed.beltHouses+w.placed.mouthHouses.reduce((s,n)=>s+n,0)+w.placed.showcaseSmallHouses>=3&&w.placed.beltHouses+w.placed.mouthHouses.reduce((s,n)=>s+n,0)+w.placed.showcaseSmallHouses<=14);assert(w.field.beltTrees>=P.belt.cluster[0]);
  const groups=new Map();for(const f of w.field.farms)groups.set(f.group,(groups.get(f.group)||0)+1);for(const n of groups.values())assert(n>=3&&n<=8);
  let checked=0,clear=0;
  for(let y=P.town.south+P.belt.townFade;y<=P.town.north;y+=8){const x=townWestAt(y);let nearest=Infinity;for(const v of w.veg)if(v[0]<x&&v[4]>P.belt.treeHeight[1])nearest=Math.min(nearest,Math.hypot(v[0]-x,northOffset-v[1]-y));if(nearest>=P.belt.forestGap)clear++;checked++;}
  assert(clear/checked>=.8);
  for(let y=P.river.eastBank[0];y<=P.river.eastBank[1];y+=8){const r=w.field.riverNear(w.field.riverX(y),y),edge=r.x+r.width/2;let last=0;for(let d=1;d<=100;d++){const b=w.field.beltAt(edge+d,y);if(b&&b.side==='river')last=d;}const belt=w.field.beltAt(edge+P.grid.cell,y);assert(belt&&belt.width>=P.river.bankMin&&belt.width<=50);assert(last>=belt.width-P.grid.cell&&last<=belt.width+P.grid.cell);}
  const allocation={grass:0,farms:0,woods:0};let cells=0;for(let y=P.town.south;y<P.town.north+P.belt.width;y+=2)for(let x=P.town.west-P.belt.width*2;x<P.town.east+P.belt.width*2;x+=2){const b=w.field.beltAt(x,y);if(!b||b.d<0||b.side==='river')continue;assert(b.width>=P.targets.beltWidth[0]&&b.width<=P.targets.beltWidth[1]);cells++;allocation[w.field.farmAt(x,y)?'farms':b.d>=P.belt.forestGap&&w.field.woodAt(x,y)?'woods':'grass']++;}for(const key of Object.keys(allocation)){allocation[key]/=cells;assert(Math.abs(allocation[key]-P.belt[key])<.22,key+' '+allocation[key]);} // a belt 8-16 m wide: the shares of so few cells swing widely
  t.diagnostic(JSON.stringify({allocation,beltHouses:w.placed.beltHouses,beltTrees:w.field.beltTrees,farms:w.field.farms.length,forestGapFraction:clear/checked}));
});
test('designed fix3 G4: inner-bend gravel bars and riverbed riffles leave a smooth water profile',t=>{
  assert(w.field.bars.length>10);assert(w.field.riffles.length>8);
  for(const b of w.field.bars){const r=w.field.riverNear(b.x,b.y);assert(b.width/r.width>=.14&&b.width/r.width<=.31);assert(r.distance<r.width/2);assert.equal(w.field.sample(b.x,b.y).code,6);}
  for(const r of w.field.riffles){assert(r.y>P.town.south);assert(r.rise>=.3&&r.rise<=.6);assert(w.field.riffleAt(r.s)>=r.rise-1e-8);}
  const river=data.rivers.rivers[0];let shallows=0;for(let i=1;i<river.bed_m.length;i++){assert(river.bed_m[i]<=river.bed_m[i-1]+1e-8);assert(river.water_elev_m[i]<=river.water_elev_m[i-1]+1e-8);if(river.depth_m[i]<P.river.waterDepth-.2)shallows++;}assert(shallows>8);
  t.diagnostic(JSON.stringify({bars:w.field.bars.length,riffles:w.field.riffles.length,shallowSamples:shallows}));
});
test('designed K2/G7: sea deepens close to shore, beach has two grades and both avenue verges are grass',()=>{
  const rgb=w.files.get('ground_rgb.bin'),colour=(x,y)=>{const k=(Math.floor((P.grid.north-y)/2)*w.meta.grid.width+Math.floor((x-P.grid.west)/2))*3;return [rgb[k],rgb[k+1],rgb[k+2]];};
  for(const [d,h] of P.shore.seaProfile.slice(1))assert(Math.abs(at(0,shoreAt(0)-d)-h)<.1);assert.equal(P.shore.wet,3);assert.equal(w.meta.sea.surf_scale,P.atmosphere.surfScale);assert(P.atmosphere.surfScale<=.12,'the surf stays a fringe at the shore');
  const sh=shoreAt(0),c=P.shore,low=(at(0,sh+c.bermRun)-at(0,sh))/c.bermRun,high=(at(0,sh+c.beach-2)-at(0,sh+c.bermRun+2))/(c.beach-c.bermRun-4);assert(low>high);assert(Math.abs(at(0,sh+c.beach)-c.beachTop)<.15);
  for(let y=P.town.south+6;y<P.town.north-6;y+=6){if(w.field.roads.some(r=>r.id!=='avenue'&&r.points.some(p=>Math.abs(p[1]-y)<8)))continue;for(const side of [-1,1])assert.equal(w.field.sample(side*(P.roads[0].width/2-P.ground.vergeInset),y).code,2);const a=colour(-(P.roads[0].width/2-P.ground.vergeInset),y),b=colour(P.roads[0].width/2-P.ground.vergeInset,y);for(let q=0;q<3;q++)assert(Math.abs(a[q]-b[q])<5);}
});
test('designed fix3 G6/G8/G9/G11: capes are forested, unapproved steep seams are absent, metadata and stone foot width match',()=>{
  const coverage=designedForestCoverage(w);assert(coverage.fraction>=.9&&coverage.outsideFraction>=.9);
  for(const v of w.veg){const y=northOffset-v[1],h=P.harbor;if(((v[0]-h.x)/h.radius)**2+((y-h.y)/h.radiusY)**2<1)assert(Math.hypot(v[0]-h.island[0],y-h.island[1])<h.islandRadius,'only the island pine may stand within the harbour');}
  const slopes=designedSlopes(w);assert.equal(slopes.over45,0,JSON.stringify(slopes));
  assert.deepEqual(w.meta.mist,P.atmosphere.mist);assert.deepEqual(w.meta.backdrop,P.atmosphere.backdrop);assert.equal(JSON.parse(w.files.get('works.json')).rocks[0].width,P.works.ringWidth);assert.equal(P.harbor.width,7);
});
test('designed fix3 G10: built stairs and the swell are emitted; the stairs keep their rise, their datum, a landing and a hollow under the treads only',async()=>{
  const {loadDesignedKits}=await import('../tools/lib/designed-kits.mjs'),{placeDesignedFacilities}=await import('../tools/lib/designed-placement.mjs'),{withStairRamps,STAIRS}=await import('../dist/valley/kamakura-stairs.js');
  assert.deepEqual(P.emit,{steps:true,sea:true,light:true,vista:true,disc:true});assert.deepEqual(w.meta.sun,P.atmosphere.sun);assert.deepEqual(w.meta.air,P.atmosphere.air);assert.deepEqual(sunPlace(data.meta),{turn:P.atmosphere.sun.turn_deg,lift:P.atmosphere.sun.lift_deg});assert.deepEqual(airOf(data.meta),P.atmosphere.air);assert.deepEqual(w.meta.sea,{swell_from_deg:P.atmosphere.swellFrom,surf_scale:P.atmosphere.surfScale});
  const n=w.nodes.find(n=>n.part==='stairs'),lower=P.shrine.lower[4],south=P.shrine.stairSouth,north=P.shrine.stairNorth;
  assert.deepEqual(n.steps,{from_xz:[0,gameZ(south)],to_xz:[0,gameZ(north)],rise_m:7.5,width_m:10,landing_m:P.stairs.landing});assert.deepEqual(n.anchor_xz,n.steps.from_xz);
  // The stairs' own zero is the lower terrace: the decoded ground at the anchor plus rel_anchor reaches it.
  assert(Math.abs(at(0,south)+n.rel_anchor-lower)<1e-9);assert(Math.abs(n.rel_anchor)<.1);
  assert(Math.abs(n.bbox_max[1]-(P.stairs.totalRise+P.stairs.earLift))<1e-6);assert(n.bbox_min[1]<-1);
  const emitted=JSON.parse(w.files.get('facilities.json')).nodes.find(q=>q.steps);assert.deepEqual(emitted.steps,n.steps);assert.equal(emitted.rel_anchor,n.rel_anchor);
  // Under every tread the decoded ground stays below it, and never by more than a riser and a half.
  const riser=P.stairs.totalRise/Math.ceil(P.stairs.totalRise/P.stairs.rise);
  for(let i=0;i<w.stairs.steps.length-1;i++){const step=w.stairs.steps[i],next=w.stairs.steps[i+1];
    for(const y of [step.y+1e-6,(step.y+next.y)/2,next.y-1e-6])for(const x of [-P.stairs.width/2,0,P.stairs.width/2]){const gap=step.top-at(x,y);assert(gap>0&&gap<riser*1.5+.2,`tread ${i} at ${y}: ${gap}`);}}
  // The terraces at both ends keep their height: no notch across the foot, no ridge behind the landing.
  for(const x of [-4,0,4])for(const d of [1.01,2,3,5]){assert(Math.abs(at(x,south-d)-lower)<.02,`foot ${d}`);assert(Math.abs(at(x,north+P.stairs.landing+d-1)-w.field.upper)<.02,`head ${d}`);}
  // The walking height (the game's own function) follows the noses, is level on the landing and meets both terraces within 6 cm.
  const ramp=withStairRamps(terrain,w.nodes),nose=y=>lower+P.stairs.totalRise*Math.min(1,(y-south)/(north-south));
  for(let y=south+.5;y<=north+P.stairs.landing-.01;y+=.5)assert(Math.abs(ramp.heightAt(0,gameZ(y))-(nose(y)-STAIRS.noseInsetM))<1e-6,`ramp ${y}`);
  let previous=ramp.heightAt(0,gameZ(south-3));for(let y=south-3;y<=north+P.stairs.landing+3;y+=.05){const h=ramp.heightAt(0,gameZ(y));assert(Math.abs(h-previous)<.06,`step in the walking height at ${y}: ${h-previous}`);previous=h;}
  // Switched off, the stairs carry no steps (a game that does not know them drapes the model as before).
  const off={steps:false,sea:false},kits=await loadDesignedKits(undefined,{emit:off});assert(placeDesignedFacilities(kits,{emit:off}).every(q=>q.steps===undefined));
});

test('designed fix5 H0/H1/H3/H4: framing, inhabited plain, valley homes, sanctuary and Buddha sightlines',async t=>{
  const {designedComposition}=await import('../tools/lib/designed-composition.mjs'),r=designedComposition(w);t.diagnostic(JSON.stringify(r));
  assert(r.shoreY>=.73&&r.shoreY<=.79);assert(r.beachY>=.66&&r.beachY<=.72);assert(r.stairY>=.22&&r.stairY<=.28);assert(r.gateY>=.13&&r.gateY<=.21);assert(r.bridge[0]>=.74&&r.bridge[0]<=.82&&r.bridge[1]>=.41&&r.bridge[1]<=.48);assert(r.topHits>=7);assert(r.townWidth>=.62);
  assert(r.buddhaHead[0]>=.04&&r.buddhaHead[0]<=.11&&r.buddhaHead[1]>=.40&&r.buddhaHead[1]<=.52);assert.deepEqual(r.buddhaHeadOcclusion,{terrain:false,trees:0});assert.deepEqual(r.buddhaChestOcclusion,{terrain:false,trees:0});
  assert(r.townCoverage>=.7);assert(r.mouthHouses.reduce((a,n)=>a+n,0)+w.placed.beltHouses+w.placed.showcaseSmallHouses>=3);assert(r.grove>=60);assert(r.gravelFraction<=.30);
  assert(w.veg.filter(v=>Math.abs(v[0])<P.sanctuary.axisGap&&northOffset-v[1]>=P.shrine.lower[2]&&northOffset-v[1]<=P.shrine.upper[3]).length===0);
});
test('designed fix4 H2: species quotas, cedar islands, brightness and height variation',t=>{
  const counts=[0,0,0,0];for(const v of w.veg)counts[v[6]]++;
  const ratios=counts.map(n=>n/w.veg.length);for(const [i,target] of [P.veg.evergreen,P.veg.pine,P.veg.cedar,P.veg.deciduous].entries())assert(Math.abs(ratios[i]-target)<=.03);
  const forest=w.veg.filter(v=>northOffset-v[1]>P.shrine.upper[3]+P.sanctuary.buildingGap||Math.abs(v[0])>P.townFill.reach+P.belt.width),cedars=forest.filter(v=>v[6]===2);
  const used=new Set();let diameter=0;
  for(let i=0;i<cedars.length;i++)if(!used.has(i)){const queue=[i],members=[];used.add(i);for(let at=0;at<queue.length;at++){const k=queue[at],v=cedars[k];members.push(v);for(let j=0;j<cedars.length;j++)if(!used.has(j)&&Math.hypot(v[0]-cedars[j][0],v[1]-cedars[j][1])<P.veg.speciesWave/2){used.add(j);queue.push(j);}}for(const a of members)for(const b of members)diameter=Math.max(diameter,Math.hypot(a[0]-b[0],a[1]-b[1])+a[5]+b[5]);}
  assert(diameter<=40,'cedar canopy diameter '+diameter);
  const tintRMS=Math.sqrt(forest.reduce((n,v)=>n+v[9]**2,0)/forest.length),heights=forest.map(v=>v[4]);assert(tintRMS>=.3);assert(Math.max(...heights)/Math.min(...heights)>=1.6);
  t.diagnostic(JSON.stringify({ratios,cedarMaxDiameter:diameter,tintRMS}));
});
test('designed fix4 H5/H6: curved beach, granular quay, root stones and coherent ash plots',()=>{
  assert.equal(P.shore.amplitude,10);assert(P.harbor.radius<=34&&P.harbor.radius>=34*.85);
  const works=JSON.parse(w.files.get('works.json')),root=works.rocks.find(r=>r.id==='harbor-root');assert(root&&root.count===P.works.rootCount);
  const rgb=w.files.get('ground_rgb.bin');let total=0,dark=0;
  for(const r of P.burns.plots)for(let y=r[2]+4;y<r[3]-4;y+=2)for(let x=r[0]+4;x<r[1]-4;x+=2){const k=Math.floor((P.grid.north-y)/2)*w.meta.grid.width+Math.floor((x-P.grid.west)/2);total++;if(rgb[k*3]<120)dark++;assert.equal(w.surface[k],2);}
  assert(dark/total>=.65);for(let y=P.harbor.quay[2]+P.grid.cell/2;y<P.harbor.quay[3];y+=P.grid.cell)for(let x=P.harbor.quay[0]+P.grid.cell/2;x<P.harbor.quay[1];x+=P.grid.cell)if(quayAt(x,y))assert.equal(w.field.sample(x,y).code,0);
});

test('designed fix6 D1/D3/D5: landward basin stays water, island and pier fit, and finishing work is bounded',async()=>{
  const h=P.harbor,atRaw=(x,y)=>w.field.sample(x,y).h;
  for(let y=h.y-h.radius+h.width/2+P.grid.cell;y<h.y+h.radius-h.width/2-P.grid.cell;y+=P.grid.cell)for(let x=h.x-h.radius+h.width/2+P.grid.cell;x<h.x+h.radius-h.width/2-P.grid.cell;x+=P.grid.cell)if(harborAt(x,y).distance<-h.width/2-P.grid.cell&&!quayAt(x,y)&&Math.hypot(x-h.island[0],y-h.island[1])>h.islandRadius+P.grid.cell*2)assert(atRaw(x,y)<0,'basin must stay water');
  assert(h.x+h.radius<=100);
  const q=h.quay;assert.equal(q[1]-q[0],38);assert.equal(q[3]-q[2],6);
  const pier=P.works.pier;assert(Math.hypot(pier[1][0]-pier[0][0],pier[1][1]-pier[0][1])>=14&&Math.hypot(pier[1][0]-pier[0][0],pier[1][1]-pier[0][1])<=14);
  assert.equal(P.works.ringCount,180);assert.deepEqual(P.works.ringSize,[1.6,4.2]);
  const {designedCamera}=await import('../tools/lib/designed-perspective.mjs'),camera=designedCamera();
  const inside=(x,y,z)=>{const p=camera.project(x,y,z);assert(p[0]>=P.preview.perspectiveWidth*.02&&p[0]<=P.preview.perspectiveWidth*.98);assert(p[1]>=P.preview.perspectiveHeight*.02&&p[1]<=P.preview.perspectiveHeight*.98);};
  for(let deg=0;deg<360;deg++){const a=deg*Math.PI/180;inside(h.island[0]+h.islandRadius*Math.sin(a),h.island[1]+h.islandRadius*Math.cos(a),h.island[2]);}
  for(const [x,y] of pier)for(const side of [-1,1])inside(x+side*P.works.pierWidth/2,y,P.works.deck);

  assert(w.stats.grading.finishPasses<=P.grading.finishPasses);assert(w.stats.grading.finishCells>0);assert(w.stats.grading.finishMaxChange>0);
});

 test('designed J0: projected town has at least 34 percent roof-box coverage across 2000 screen rays',async t=>{
  const {designedRoofCoverage}=await import('../tools/lib/designed-roof-validation.mjs'),r=designedRoofCoverage(w);t.diagnostic(JSON.stringify(r));assert(r.rays>=2000);assert(r.fraction>=P.composition.roofMin);assert(data.houses.instances.length>=P.targets.totalHouses);
});

test('designed J0: front shoulders reveal a separate middle ridge and named peaks retain their authored heights',()=>{
  for(const x of [-100,100])assert(at(x,P.hill.shoulderNorth)>=30&&at(x,P.hill.shoulderNorth)<=42);
  assert(at(0,P.hill.middleNorth)>=70&&at(0,P.hill.middleNorth)<=95);
  for(const [x,low,high] of [[-285,75,90],[290,62,80]])assert(at(x,200)>=low&&at(x,200)<=high,'ridge '+at(x,200));
});
test('designed J0: both pale east-facing exposures survive terrain grading',()=>{
  for(const c of P.outcrops){let rocks=0;for(let y=c.y-c.height/Math.tan(c.angle*Math.PI/180)/2;y<=c.y+c.height/Math.tan(c.angle*Math.PI/180)/2;y+=P.grid.cell)for(let x=c.x-c.width/2;x<=c.x+c.width/2;x+=P.grid.cell)if(w.field.sample(x,y).code===5)rocks++;assert(rocks>0);}
});

test('designed J0: authored beach and harbour house groups reach their requested counts',()=>{
  assert(w.stats.beachHouses>=6&&w.stats.beachHouses<=14,'beach '+w.stats.beachHouses);assert(w.stats.portHouses>=2&&w.stats.portHouses<=6,'port '+w.stats.portHouses);
});

test('designed K1: avenue frontage reaches both banks through the lower and middle town',t=>{
  const r=prepareTownFill(bare),front=r.townPlots.filter(p=>p.lane==='avenue'&&p.state==='house'&&northOffset-p.z>=40&&northOffset-p.z<=185);
  const shops=bare.houses.instances.map(p=>({kind:bare.houses.kinds.get(p.kind),box:houseBox(bare.houses.kinds.get(p.kind),p.matrix)})).filter(({kind,box:b})=>kind.house_type.startsWith('machiya')&&Math.abs(b.x)<=P.houses.avenueX+P.houses.gap&&northOffset-b.z>=40&&northOffset-b.z<=185);
  t.diagnostic(JSON.stringify({candidates:r.stats.work.candidates,acceptedAvenue:r.townPlots.filter(p=>p.lane==='avenue').length,frontage:front.length+shops.length,rejected:r.stats.houses.skipped,work:r.stats.work}));
  assert(front.some(p=>p.x<0)&&front.some(p=>p.x>0));assert(front.length+shops.length>=18,'avenue frontage '+(front.length+shops.length));
  assert.equal(P.townFill.crossEvery,300);
});
test('designed K3: continuous raised harbour wall encloses a deep basin visible from the overlook',async t=>{
  const h=P.harbor;let cells=0,water=0,deep=0,deepCells=0;
  for(let y=h.y-h.radiusY+h.width;y<h.quay[2]-P.grid.cell/2;y+=P.grid.cell)for(let x=h.x-h.radius+h.width;x<h.x+h.radius-h.width;x+=P.grid.cell){
    const r=harborAt(x,y);if(!r.inside||r.distance>=-h.width/2-P.grid.cell/2||Math.hypot(x-h.island[0],y-h.island[1])<=h.islandRadius+P.grid.cell)continue;
    cells++;const value=at(x,y);if(value<=-1)water++;if(r.distance<-h.width/2-h.slope-P.grid.cell){deepCells++;if(Math.abs(value-h.innerDepth)<.2)deep++;}
  }
  assert(cells>20);assert(water/cells>=.95);assert(deepCells>0&&deep/deepCells>=.95);
  for(let deg=h.mouth+h.opening/2+6;deg<=262;deg+=.5){ // the wall tapers to the water over the last degrees at the mouth and at its landward root
    const a=deg*Math.PI/180;assert(at(h.x+(h.radius-h.width/2)*Math.sin(a),h.y+(h.radiusY-h.width/2)*Math.cos(a))>=1.5);}
  const {designedCamera}=await import('../tools/lib/designed-perspective.mjs'),o=designedCamera().origin;
  for(let step=1;step<100;step++){const u=step/100;assert(at(o[0]+(h.x-o[0])*u,o[1]+(h.y-o[1])*u)<o[2]*(1-u),'basin centre hidden behind terrain');}
  t.diagnostic(JSON.stringify({basinWaterFraction:water/cells,basinDeepFraction:deep/deepCells}));
});
test('designed K4: downstream width and depth change without lifting the original water profile',()=>{
  const r=data.rivers.rivers[0];
  for(let i=0;i<r.xy_m.length;i++){const y=r.xy_m[i][1]+northOffset;if(y>P.river.rapidSouth&&y<P.river.rapidNorth){assert(Math.abs(r.width_m[i]-20)<1e-6);assert(r.depth_m[i]>=1.2-1e-6&&r.depth_m[i]<=1.6+1e-6);}}
  assert.equal(r.width_m.at(-1),26);assert(w.field.bars.length>0&&w.field.riffles.length>0);
});
test('designed K5: town and satoyama trees use bright broadleaf and pine without evergreen crowns',()=>{
  const trees=w.veg.filter(v=>{const y=northOffset-v[1];return y<P.shrine.lower[2]&&(v[0]>=P.town.west&&v[0]<=P.town.east&&y>=P.town.south||v[4]<=P.belt.treeHeight[1]&&w.field.beltAt(v[0],y));});
  assert(trees.length>0);assert(trees.every(v=>v[6]===3||v[6]===1));
});
test('designed K6: the middle ridge rises above a sightline over the lowered shoulders',async()=>{
  const {designedCamera}=await import('../tools/lib/designed-perspective.mjs'),o=designedCamera().origin;
  for(const x of [-100,100]){const y=P.hill.shoulderNorth,h=at(x,y);let hit=false;for(let yy=P.hill.frontNorth+P.hill.frontRun;yy<=P.hill.middleNorth+P.hill.middleRun;yy+=P.grid.cell){const u=(yy-o[1])/(y-o[1]);if(at(o[0]+(x-o[0])*u,yy)>=o[2]+(h-o[2])*u){hit=true;break;}}assert(hit);}
});
