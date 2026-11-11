import { ESCAPE, sceneMetadata } from './worlds/kamakura-escape.mjs';
import { routePatch, routeDetail } from './lib/designed-route.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PLAN as P } from './worlds/kamakura-return.mjs';
import { loadDesignedKits } from './lib/designed-kits.mjs';
import { createDesignedTerrain, gameNorth, gameZ, northOffset, noise, mix, harborAt } from './lib/designed-terrain.mjs';
import { placeDesignedFacilities, placeDesignedHouses, placeDesignedVeg, facilityBoxes } from './lib/designed-placement.mjs';
import { designedLanduse } from './lib/designed-landuse.mjs';
import { gradeDesignedTerrain } from './lib/designed-grade.mjs';
import { designedGround } from './lib/designed-ground.mjs';
import { designedWorks } from './lib/designed-works.mjs';
import { writeDesignedPreview } from './lib/designed-preview.mjs';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { kamakuraPaths } from '../dist/valley/kamakura-roads.js';
import { VEG_FIELDS, vegExclusions } from '../dist/valley/kamakura-veg.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { prepareTownFill } from '../dist/valley/kamakura-town-fill.js';
import { houseBox } from '../dist/valley/kamakura-houses.js';
const ab=b=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength);
export const designedFetcher=files=>async url=>{const b=files.get(path.basename(url));return b?{ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>ab(b)}:{ok:false};};
const f32=values=>{const out=Buffer.alloc(values.length*4);values.forEach((v,i)=>out.writeFloatLE(v,i*4));return out;};
function makeRoads(field) {
  const roads={};
  for(const road of field.roads) {
    if(road.id==='avenue'||road.kind!=='local_road') {roads[road.id]={route_id:road.id,name:road.name,kind:road.kind,width_m:road.width,xyz_m:road.points.map(([x,y,h])=>[x,gameNorth(y),h])};continue;}
    // The existing avenue finder chooses the longest route. Side roads remain separate runs shorter than the avenue.
    let run=0;
    for(let i=1;i<road.points.length;i++) {const a=road.points[i-1],b=road.points[i],parts=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/250);for(let k=0;k<parts;k++) {const id=road.id+':'+run++;roads[id]={route_id:id,name:road.name,kind:road.kind,width_m:road.width,xyz_m:[k/parts,(k+1)/parts].map(t=>[mix(a[0],b[0],t),gameNorth(mix(a[1],b[1],t)),mix(a[2],b[2],t)])};}}
  }
  const crossings=field.crossings.map(c=>({road:c.road,route_id:c.road,river:P.river.id,xy_m:[c.x,gameNorth(c.y)],bearing_deg:c.bearing,width_m:c.width,span_m:field.riverNear(c.x,c.y).width+P.river.bridgeExtra}));
  return {schema:'kz-roads/0.1',count:Object.keys(roads).length,roads,crossings};
}
export async function designedWorld({kits:kitDirectory,emit=P.emit,scene='return'}={}) {
  const sceneMeta=sceneMetadata(scene,P,northOffset,emit);
  const started=performance.now();
  const kits=await loadDesignedKits(kitDirectory,{emit}),field=designedLanduse(createDesignedTerrain(kits.stairRise,kits.nodes.find(n=>n.facility==='daibutsuden'&&n.part==='gate'),emit)),files=new Map(),json=(n,v)=>files.set(n,Buffer.from(JSON.stringify(v)+'\n'));
  const g=P.grid,width=(g.east-g.west)/g.cell,height=(g.north-g.south)/g.cell,n=width*height;
  const heights=Buffer.alloc(n*2),walk=Buffer.alloc(n),surface=Buffer.alloc(n),floats=new Float32Array(n);
  for(let j=0;j<height;j++)for(let i=0;i<width;i++){const x=g.west+(i+.5)*g.cell,y=g.north-(j+.5)*g.cell,q=field.sample(x,y),k=j*width+i;if(q.h<g.minHeight||q.h>g.maxHeight)throw Error('Designed height out of encoding range');floats[k]=q.h;heights.writeUInt16LE(Math.round((q.h-g.minHeight)/(g.maxHeight-g.minHeight)*65535),k*2);walk[k]=(x<g.walk[0]||x>g.walk[1]||y<g.walk[2]||y>g.walk[3])?0:q.h<=0?2:1;surface[k]=q.code;}
  // A narrow bar must retain at least one physical 2m cell after rasterisation.
  for(const bar of field.bars){const i=Math.round((bar.x-g.west)/g.cell-.5),j=Math.round((g.north-bar.y)/g.cell-.5),k=j*width+i;surface[k]=6;floats[k]=Math.max(floats[k],bar.water+P.river.barLift);}
  const authoredSample=field.sample,grading=gradeDesignedTerrain(floats,width,height,field);
  for(let k=0;k<n;k++){heights.writeUInt16LE(Math.round((floats[k]-g.minHeight)/(g.maxHeight-g.minHeight)*65535),k*2);if(walk[k]!==0)walk[k]=floats[k]<=0?2:1;}
  const sampleGrid=(x,y)=>{
    const fx=Math.max(0,Math.min(width-1,(x-g.west)/g.cell-.5)),fy=Math.max(0,Math.min(height-1,(g.north-y)/g.cell-.5)),i=Math.floor(fx),j=Math.floor(fy),ii=Math.min(i+1,width-1),jj=Math.min(j+1,height-1);
    return {h:mix(mix(floats[j*width+i],floats[j*width+ii],fx-i),mix(floats[jj*width+i],floats[jj*width+ii],fx-i),fy-j),code:surface[Math.round(fy)*width+Math.round(fx)]};
  };
  field.sample=sampleGrid;
  for(let j=1;j<height-1;j++)for(let i=1;i<width-1;i++){const k=j*width+i;if(surface[k]!==3)continue;const slope=Math.atan(Math.hypot(floats[k+1]-floats[k-1],floats[k+width]-floats[k-width])/(2*g.cell))*180/Math.PI;if(slope>P.hill.rockSlope)surface[k]=5;}
  files.set('height_u16.bin',heights);files.set('walk_u8.bin',walk);files.set('surface_class_u8.bin',surface);files.set('ground_rgb.bin',designedGround(surface,width,height,floats,field).rgb);
  const meta={schema:'kz-world-web/0.9',world:P.id,design_origin:{north_offset_m:northOffset},grid:{width,height,cell_m:g.cell,row0:'north',col0:'west',sample_position:'cell_center',x_axis:'east',y_axis:'north',z_axis:'up'},height:{file:'height_u16.bin',encoding:'uint16-le',min_m:g.minHeight,max_m:g.maxHeight},walk:{file:'walk_u8.bin',polygon_m:[[g.walk[0],gameNorth(g.walk[2])],[g.walk[1],gameNorth(g.walk[2])],[g.walk[1],gameNorth(g.walk[3])],[g.walk[0],gameNorth(g.walk[3])]]},ground:{file:'ground_rgb.bin'},surface:{file:'surface_class_u8.bin',encoding:'uint8'},spawn:{x:P.spawn[0],y:gameNorth(P.spawn[1]),z:field.sample(...P.spawn).h,yaw_deg_clockwise_from_north:0},places:P.places.map(([id,name,x,y])=>({id,name,x,y:gameNorth(y)})),town_fill:P.townFill,house_policy:P.housePolicy,overlook:P.overlook,veg_policy:{range:P.veg.range,far:P.veg.far}};
  meta.mist=P.atmosphere.mist;meta.backdrop=P.atmosphere.backdrop;if(emit.sea)meta.sea={swell_from_deg:P.atmosphere.swellFrom,surf_scale:P.atmosphere.surfScale};
  if(emit.light){meta.sun=P.atmosphere.sun;meta.air=P.atmosphere.air;}
  json('works.json',designedWorks());meta.works={file:'works.json'};
  const roadSource=makeRoads(field);json('roads.json',roadSource);meta.roads={file:'roads.json',schema:roadSource.schema,count:roadSource.count};
  const river={id:P.river.id,name:'滑川',enters_sea:true,xy_m:field.river.map(p=>[p.x,gameNorth(p.y)]),width_m:field.river.map(p=>p.width),depth_m:field.river.map(p=>p.water-p.bed),bed_m:field.river.map(p=>p.bed),water_elev_m:field.river.map(p=>p.water)};
  json('rivers.json',{schema:'kz-rivers/0.1',rivers:[river]});meta.rivers={file:'rivers.json',count:1,points:river.xy_m.length};
  const nodes=placeDesignedFacilities(kits,{emit}),parts={};let tris=0;for(const n of nodes){parts[n.part]=(parts[n.part]||0)+1;tris+=n.triangles;}
  json('facilities.json',{schema:'kz-facilities/0.1',kit:'facilities.glb',count:nodes.length,total_triangles:tris,parts,nodes});files.set('facilities.glb',kits.facilityGlb);meta.facilities={file:'facilities.json',kit:'facilities.glb',count:nodes.length,total_triangles:tris};
  const placed=placeDesignedHouses(kits,field,nodes),count_by_kind={};for(const k of kits.kinds)count_by_kind[k.node]=0;for(const h of placed.houses){const k=kits.kinds.find(k=>k.index===h.kind);count_by_kind[k.node]++;}
  json('houses.json',{count:placed.houses.length,kinds:kits.kinds,count_by_kind});files.set('houses_f32.bin',f32(placed.houses.flatMap(p=>[p.kind,...p.matrix])));files.set('houses_kit.glb',kits.houseGlb);meta.houses={file:'houses.json',instances:'houses_f32.bin',kit:'houses_kit.glb'};
  // Half-metre harbour samples preserve the narrow eight-metre crest beside the carved basin.
  // Without them, bilinear sampling pulls its inner stone row down into the adjacent water cell.
  const row=Math.floor((g.north-(P.patch.south+P.patch.north)/2)/g.cell),col=width/2,patchCells=[[row,col]],values=[];
  for(let j=0;j<height-1;j++)for(let i=0;i<width-1;i++){
    const x=g.west+(i+1)*g.cell,y=g.north-(j+1)*g.cell,r=harborAt(x,y);
    if(r.ring&&Math.abs(r.distance)<=P.harbor.width/2+g.cell*2||routePatch(x,y)||emit.polish&&Math.abs(x)>=P.stairs.width/2-g.cell&&Math.abs(x)<=P.stairs.width/2+P.stairs.ear+P.stairs.bankWidth+g.cell&&y>=P.shrine.stairSouth-g.cell&&y<=P.shrine.stairNorth+g.cell)patchCells.push([j,i]);
  }
  const pc=Buffer.alloc(patchCells.length*8);
  patchCells.forEach(([r,c],k)=>{pc.writeInt32LE(r,k*8);pc.writeInt32LE(c,k*8+4);for(let j=0;j<5;j++)for(let i=0;i<5;i++){
    const x=g.west+(c+.5)*g.cell+i*g.cell/4,y=g.north-(r+.5)*g.cell-j*g.cell/4;
    const underStair=emit.polish&&Math.abs(x)<=P.stairs.width/2&&y>=P.shrine.stairSouth-g.cell&&y<=P.shrine.stairNorth+g.cell;
    values.push(k===0||underStair?field.sample(x,y).h:routePatch(x,y)?routeDetail(x,y,field.sample(x,y)).h:authoredSample(x,y).h);
  }});
  files.set('patch_cells_i32.bin',pc);files.set('patch_h_f32.bin',f32(values));const id='avenue-detail',xy=[[0,gameNorth(P.patch.south)],[0,gameNorth(P.patch.north)]];
  json('patch_axes.json',{[id]:{xy_m:xy,floor_m:[field.sample(0,P.patch.south).h,field.sample(0,P.patch.north).h],s_m:[0,P.patch.north-P.patch.south],floor_width_m:P.roads[0].width}});
  json('patch_paths.json',{[id]:{route_id:'avenue-detail',xyz_m:xy.map(([x,y])=>[x,y,field.sample(x,y+northOffset).h]),s_m:[0,P.patch.north-P.patch.south]}});
  meta.patches={cells_file:'patch_cells_i32.bin',h_file:'patch_h_f32.bin',axes_file:'patch_axes.json',paths_file:'patch_paths.json',subdivisions:4,total_cells:patchCells.length,items:[{id}]};
  json('meta.json',meta);
  // Plan lanes and houses once to keep authored trees off the runtime fill as well.
  const bareData=await loadKamakura(designedFetcher(files),'?townfill=0'),town=prepareTownFill(bareData);
  const data=await loadKamakura(designedFetcher(files),'');
  const createTerrain=createKamakuraTerrain(data);
  if(!data.houses||!data.facilities||!data.rivers||!data.roads)throw Error('Designed world failed its own decoders');
  // Built stairs are set down whole at their anchor. The game adds rel_anchor to the decoded ground there, so the stairs'
  // own zero (the lower terrace) is reached whatever the hollow under the first tread does to that sample.
  const built=nodes.find(n=>n.steps);
  if(built){
    built.rel_anchor=P.shrine.lower[4]-createKamakuraTerrain(data).heightAt(built.anchor_xz[0],built.anchor_xz[1]);
    json('facilities.json',{schema:'kz-facilities/0.1',kit:'facilities.glb',count:nodes.length,total_triangles:tris,parts,nodes});
  }
  field.sample=(x,y)=>({h:createTerrain.heightAt(x,gameZ(y)),code:sampleGrid(x,y).code});
  let ground;files.set('ground_rgb.bin',(ground=designedGround(surface,width,height,floats,field,data)).rgb);
  const filledBoxes=data.houses.instances.map(p=>houseBox(data.houses.kinds.get(p.kind),p.matrix)),lanes=Object.values(data.lanes||{}).map(p=>({width:p.width_m,points:p.xyz_m.map(([x,y])=>[x,y+northOffset])}));
  const alternateMeta={...meta,...sceneMetadata('escape',P,northOffset,{})};delete alternateMeta.overlook;
  const altFiles=new Map(files);altFiles.set('meta.json',Buffer.from(JSON.stringify(alternateMeta)));
  const alternate=await loadKamakura(designedFetcher(altFiles),'');
  const alternateBoxes=alternate.houses.instances.map(p=>houseBox(alternate.houses.kinds.get(p.kind),p.matrix));
  const exclude=vegExclusions(createKamakuraTerrain(data),{boxes:[...filledBoxes,...alternateBoxes,...facilityBoxes(nodes)],paths:kamakuraPaths(data),spawn:{x:meta.spawn.x,z:-meta.spawn.y}});
  const townReserve=(data.veg||[]).filter(v=>v.x>=P.town.west&&v.x<=P.town.east&&northOffset-v.z>=P.town.south&&northOffset-v.z<=P.town.north).length;
  // Vegetation samples the already authored grid, exactly as the runtime does, instead of
  // rebuilding all road earthworks for each of the million inhibition candidates.
  const sampledField={...field,habitat:(x,y)=>field.habitat(x,y,sampleGrid)};
  const veg=placeDesignedVeg(sampledField,placed.boxes,nodes,lanes,filledBoxes,data.townPlots,exclude,townReserve,town?.yards||[]).filter(v=>!exclude({x:v[0],z:v[1]}));
  field.routeForest=sampledField.routeForest;field.templeGrove=sampledField.templeGrove;field.templeGroveStats=sampledField.templeGroveStats;field.routeTrees=sampledField.routeTrees;field.sanctuaryTrees=sampledField.sanctuaryTrees;field.beltTrees=sampledField.beltTrees;field.polishTrees=sampledField.polishTrees;
  files.set('veg_f32.bin',f32(veg.flat()));json('veg.json',{schema:'kz-veg-web/0.1',file:'veg_f32.bin',encoding:'float32-le (N,16)',fields:VEG_FIELDS,count:veg.length});meta.veg={file:'veg_f32.bin',info:'veg.json',count:veg.length};json('meta.json',meta);
  if(scene==='escape'){
    delete meta.overlook;Object.assign(meta,sceneMeta);
    meta.spawn={x:ESCAPE.spawn[0],y:gameNorth(ESCAPE.spawn[1]),z:field.sample(...ESCAPE.spawn).h,yaw_deg_clockwise_from_north:ESCAPE.camera.bearing};
    for(const n of nodes)if(n.facility==='toshoji'&&n.part==='hall')delete n.ruin;
    json('facilities.json',{schema:'kz-facilities/0.1',kit:'facilities.glb',count:nodes.length,total_triangles:tris,parts,nodes});
    json('meta.json',meta);
  }
  const finalData=await loadKamakura(designedFetcher(files),'');
  if(scene==='escape'){files.set('ground_rgb.bin',(ground=designedGround(surface,width,height,floats,field,finalData,{scene})).rgb);}
  return {scene,files,field,stairs:kits.stair,meta,heights:floats,surface,placed,nodes,veg,filled:finalData,ground,stats:{scene,grading,templeGrove:field.templeGroveStats,polishTrees:field.polishTrees,yards:town?.yards?.length||0,townFillWork:town?.stats.work,houseCount:finalData.houses.instances.length,routeHouses:placed.routeHouses.length,fires:meta.fires?.length||0,beachHouses:placed.beachHouses,portHouses:placed.portHouses,showcaseSmallHouses:placed.showcaseSmallHouses,beltHouses:placed.beltHouses,beltTrees:field.beltTrees,farms:field.farms.length,gravelBars:field.bars.length,riffles:field.riffles.length,grid:[width,height],cell:g.cell,landmarks:placed.houses.length,treeIndividuals:veg.filter(v=>v[7]===0).length,stands:veg.filter(v=>v[7]>0).length,riverPoints:river.xy_m.length,addedHouses:finalData.houses.instances.length-placed.houses.length,bytes:[...files.values()].reduce((n,b)=>n+b.length,0),files:files.size,generationMs:Math.round(performance.now()-started),townTrees:townReserve+veg.filter(v=>v[0]>=P.town.west&&v[0]<=P.town.east&&northOffset-v[1]>=P.town.south&&northOffset-v[1]<=P.town.north).length,stairTriangles:kits.stair.triangles}};
}
export async function writeDesignedWorld(directory,options={}) {
  const world=await designedWorld(options);await fs.mkdir(directory,{recursive:true});
  for(const [name,bytes] of world.files)await fs.writeFile(path.join(directory,name),bytes);
  if(options.preview)await writeDesignedPreview(options.preview,world);
  return world.stats;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const args=process.argv.slice(2),options={kits:process.env.KZ_KIT_DIR};let directory;
  if(args[0]&&!args[0].startsWith('--'))directory=args.shift();
  for(let i=0;i<args.length;i+=2){const key=args[i],v=args[i+1];if(!['--kits','--world','--preview','--scene'].includes(key)||!v||v.startsWith('--'))throw Error('Unknown or missing option: '+key);options[key.slice(2)]=v;}
  options.scene??='return';sceneMetadata(options.scene,P,northOffset);
  if(options.world&&options.world!=='kamakura-'+options.scene)throw Error('Unknown world: '+options.world);
  directory??=path.join('.world-out','kamakura-'+options.scene);
  console.log(JSON.stringify(await writeDesignedWorld(directory,options)));
}
