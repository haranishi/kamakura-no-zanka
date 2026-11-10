import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { VEG_FIELDS } from '../dist/valley/kamakura-veg.js';
import { box, makeGlb } from './lib/synthetic-glb.mjs';
// Fixed seed, invented metre coordinates, analytic heights. Never reads private geography.
// Library callers retain the legacy fixture; the CI CLI opts into the town-fill terrain/catalogue.
export function syntheticWorld(seed=731, { townFill=false } = {}) {
  const files=new Map(), json=(name,value)=>files.set(name,Buffer.from(JSON.stringify(value)+'\n'));
  const f32=values=>{const b=Buffer.alloc(values.length*4);values.forEach((v,i)=>b.writeFloatLE(v,i*4));return b;};
  const width=256, cell=8, count=width*width;
  const height=Buffer.alloc(count*2), walk=Buffer.alloc(count), surface=Buffer.alloc(count), ground=Buffer.alloc(count*3);
  for(let r=0;r<width;r++)for(let c=0;c<width;c++){
    const i=r*width+c, x=(c-127.5)*cell, z=(r-127.5)*cell;
    const h=z>240?Math.max(-12,12-(z-240)*.15):12+3*Math.sin(x/160)*Math.sin(z/160);
    height.writeUInt16LE(Math.round((h+32)/96*65535),i*2);walk[i]=h<=0?2:1;
    surface[i]=townFill&&Math.abs(x)<140&&Math.abs(z)<220?4:Math.floor(c/8)%8;ground.set([83+(c+seed)%31,95+(r+seed)%29,53+(c+r)%17],i*3);
  }
  const meta={schema:'kz-world-web/0.9',grid:{width,height:width,cell_m:cell,row0:'north',col0:'west',sample_position:'cell_center',x_axis:'east',y_axis:'north',z_axis:'up'},height:{file:'height_u16.bin',encoding:'uint16-le',min_m:-32,max_m:64},walk:{file:'walk_u8.bin',polygon_m:[[-300,-300],[300,-300],[300,300],[-300,300]]},spawn:{x:0,y:0,z:12,yaw_deg_clockwise_from_north:0},places:[{name:'Synthetic CI',x:0,y:0}],ground:{file:'ground_rgb.bin'},surface:{file:'surface_class_u8.bin',encoding:'uint8'}};
  files.set('height_u16.bin',height);files.set('walk_u8.bin',walk);files.set('ground_rgb.bin',ground);files.set('surface_class_u8.bin',surface);
  const axis={xy_m:[[-80,0],[80,0]],floor_m:[12,12],s_m:[0,160],floor_width_m:8};
  meta.patches={cells_file:'patch_cells_i32.bin',h_file:'patch_h_f32.bin',axes_file:'patch_axes.json',paths_file:'patch_paths.json',subdivisions:4,total_cells:1,items:[{id:'synthetic-road'}]};
  const pc=Buffer.alloc(8);pc.writeInt32LE(127,0);pc.writeInt32LE(127,4);files.set('patch_cells_i32.bin',pc);files.set('patch_h_f32.bin',f32(Array(25).fill(12)));
  json('patch_axes.json',{'synthetic-road':axis});json('patch_paths.json',{'synthetic-road':{route_id:'synthetic',xyz_m:[[-80,0,12],[80,0,12]],s_m:[0,160]}});
  const roads={
    'ci-avenue':{route_id:'avenue',name:'Synthetic avenue',kind:'local_road',width_m:14,xyz_m:[[0,-180,0],[0,0,0],[0,180,0]]},
    'ci-kaido':{route_id:'kaido',name:'Synthetic kaido',kind:'kaido',width_m:4,xyz_m:[[-160,70,0],[0,70,0],[100,130,0],[240,0,0]]},
    'ci-trail':{route_id:'trail',name:'Synthetic trail',kind:'trail',width_m:2.8,xyz_m:[[-150,-60,0],[-80,-90,0],[-40,-180,0]]}
  };
  meta.roads={file:'roads.json',schema:'kz-roads/0.1',count:Object.keys(roads).length};
  json('roads.json',{schema:'kz-roads/0.1',count:meta.roads.count,roads});
  const houseParts=[{geometry:box(0,-1,0,8,6,6)},{geometry:box(0,5,0,10,3,8,true)}];
  files.set('houses_kit.glb',makeGlb([{name:'ci_house',parts:houseParts}]));
  json('houses.json',{count:3,kinds:[{index:0,node:'ci_house',...(townFill?{house_type:'machiya'}:{}),bbox_min:[-5,-4,-1],bbox_max:[5,4,8],triangles:20}],count_by_kind:{ci_house:3}});
  files.set('houses_f32.bin',f32([-32,0,64].flatMap(x=>[0,1,0,0,0,0,1,0,0,0,0,1,0,x,0,-35,1])));
  meta.houses={file:'houses.json',instances:'houses_f32.bin',kit:'houses_kit.glb'};
  // Four pillars, a roof, and dark inward-facing walls/floor leave an open hall interior.
  const hall=[...[-9,9].flatMap(x=>[-7,7].map(z=>({geometry:box(x,0,z,1,8,1)}))),{geometry:box(0,8,0,22,5,18,true)},
    {geometry:box(0,0,0,18,.3,14),interior:true},{geometry:box(0,0,-7,18,8,.3),interior:true},{geometry:box(-9,0,0,.3,8,14),interior:true},{geometry:box(9,0,0,.3,8,14),interior:true}];
  const gate = [-5,5].map(x=>({geometry:box(x,0,0,.8,5,.8)}));
  gate.push({geometry:box(0,5,0,12,2,4,true)});
  const ruinedHall=[{geometry:box(0,0,0,40,13,32)},{geometry:box(0,13,0,42,5,34,true)}];
  const buddha=[{geometry:box(0,0,0,7,2,6)},{geometry:box(0,2,0,6,6,4)},{geometry:box(0,8,0,3,3,3)}];
  files.set('facilities.glb',makeGlb([{name:'ci_hall',parts:hall},{name:'ci_gate',parts:gate},{name:'ci_buddha_hall',parts:ruinedHall},{name:'ci_buddha',parts:buddha}]));
  const triangles=hall.reduce((sum,p)=>sum+p.geometry.positions.length/9,0);
  const gateTriangles=gate.reduce((sum,p)=>sum+p.geometry.positions.length/9,0);
  const ruinTriangles=ruinedHall.reduce((sum,p)=>sum+p.geometry.positions.length/9,0),buddhaTriangles=buddha.reduce((sum,p)=>sum+p.geometry.positions.length/9,0);
  json('facilities.json',{schema:'kz-facilities/0.1',kit:'facilities.glb',count:4,total_triangles:triangles+gateTriangles+ruinTriangles+buddhaTriangles,parts:{hall:2,gate:1,buddha:1},nodes:[{node:'ci_hall',part:'hall',soft:false,facility:'synthetic',source:'original mathematical boxes',status:null,triangles,rel_anchor:0,anchor_xz:[38,-82],bbox_min:[-11,0,-9],bbox_max:[11,13,9]},{node:'ci_gate',part:'gate',soft:false,facility:'synthetic',source:'original mathematical boxes',status:null,triangles:gateTriangles,rel_anchor:0,anchor_xz:[38,-22],bbox_min:[-6,0,-2],bbox_max:[6,7,2]},{node:'ci_buddha_hall',part:'hall',soft:false,facility:'synthetic-ruin',source:'original mathematical boxes',status:null,triangles:ruinTriangles,rel_anchor:0,anchor_xz:[-110,-150],bbox_min:[-21,0,-17],bbox_max:[21,18,17]},{node:'ci_buddha',part:'buddha',soft:false,facility:'synthetic-ruin',source:'original mathematical boxes',status:null,triangles:buddhaTriangles,rel_anchor:0,anchor_xz:[-110,-150],bbox_min:[-3.5,0,-3],bbox_max:[3.5,11,3]}]});
  meta.facilities={file:'facilities.json',kit:'facilities.glb',count:4,total_triangles:triangles+gateTriangles+ruinTriangles+buddhaTriangles};
  const veg=[];
  for(let i=0;i<36;i++)veg.push(-130+(i%6)*48,-90-Math.floor(i/6)*42,12,0,12+(i%4),4,i%4,0,i%3,0,(i%7)/7,0,(i%11)/11,0,0,0);
  for(let i=0;i<8;i++)veg.push(-390+i*110,-370,12,0,24,24,i%4,1,0,0,.5,0,.5,0,0,0);
  meta.veg={file:'veg_f32.bin',info:'veg.json',count:veg.length/16};files.set('veg_f32.bin',f32(veg));json('veg.json',{schema:'kz-veg-web/0.1',file:'veg_f32.bin',encoding:'float32-le (N,16)',fields:VEG_FIELDS,count:veg.length/16});
  const rivers=Array.from({length:27},(_,i)=>({id:`ci-river-${i}`,name:null,enters_sea:true,xy_m:[[145+i*5,200],[145+i*5,-350]],width_m:[3,4],depth_m:[1,1],bed_m:[11,-2],water_elev_m:[12,-1]}));
  json('rivers.json',{schema:'kz-rivers/0.1',rivers});meta.rivers={file:'rivers.json',count:27,points:54};
  json('meta.json',meta);return files;
}
export async function writeSyntheticWorld(directory,seed=731,options={}) {
  await fs.mkdir(directory,{recursive:true});const files=syntheticWorld(seed,options);
  for(const [name,bytes] of files)await fs.writeFile(path.join(directory,name),bytes);
  return {files:files.size,bytes:[...files.values()].reduce((sum,b)=>sum+b.length,0)};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(!process.argv[2])throw Error('Usage: node tools/make-synthetic-world.mjs <output-directory>');
  console.log(JSON.stringify(await writeSyntheticWorld(process.argv[2],731,{townFill:true})));
}
