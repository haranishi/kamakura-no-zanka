import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { designedWorld, designedFetcher } from '../tools/make-designed-world.mjs';
import { ESCAPE as R, sceneMetadata } from '../tools/worlds/kamakura-escape.mjs';
import { PLAN as P } from '../tools/worlds/kamakura-return.mjs';
import { escapeReport, escapeDetails } from '../tools/lib/designed-escape-validation.mjs';
import { routeDefinitions, clearRouteTree, routeTargets, nearLine } from '../tools/lib/designed-route.mjs';
import { designedCamera } from '../tools/lib/designed-perspective.mjs';
import { gameZ, northOffset } from '../tools/lib/designed-terrain.mjs';
import { loadKamakura, validateMeta } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
const kits=process.env.KZ_KIT_DIR;
const home=await designedWorld({kits}),escape=await designedWorld({kits,scene:'escape'}),report=escapeReport(escape),details=escapeDetails(escape);
test('scenes: shared geography, vegetation, authored houses and works are byte identical',async()=>{
  const same=['height_u16.bin','walk_u8.bin','surface_class_u8.bin','roads.json','rivers.json','veg.json','veg_f32.bin','houses.json','houses_f32.bin','houses_kit.glb','facilities.glb','patch_cells_i32.bin','patch_h_f32.bin','patch_axes.json','patch_paths.json','works.json'];
  for(const file of same)assert(home.files.get(file).equals(escape.files.get(file)),file);
  const again=await designedWorld({kits,scene:'escape',emit:{...P.emit,horizon:false}});
  for(const [n,b]of escape.files)if(n!=='meta.json')assert(b.equals(again.files.get(n)),n);
  const plain=JSON.parse(again.files.get('meta.json')),emitted={...escape.meta};assert.equal(plain.horizon,undefined);assert.deepEqual(emitted.horizon,R.horizon);delete emitted.horizon;assert.deepEqual(plain,emitted);
  await loadKamakura(designedFetcher(again.files));
  assert.equal(home.meta.world,'kamakura-return');assert.deepEqual(home.meta.overlook,P.overlook);assert.equal(home.meta.time,undefined);
});
test('scenes: dusk metadata, coordinate conversion and standing temples load with the current decoder',async()=>{
  const m=escape.meta,d=await loadKamakura(designedFetcher(escape.files));assert.equal(m.world,'kamakura-escape');assert.equal(m.time,'dusk');assert.equal(m.buddha,'hall');assert.deepEqual(m.overlook,{...R.camera,north:140});
  assert.deepEqual(m.sun,{...R.sun,disc_deg:R.disc});assert.deepEqual(m.air,R.air);assert.deepEqual(m.lights,R.lights);assert.deepEqual(m.flight,R.flight);assert.deepEqual(m.fields,R.fields);
  assert.deepEqual(m.fires,R.fires.map(([x,y,radius_m,strength])=>({x,y:y-northOffset,radius_m,strength})));
  assert.equal(m.spawn.x,R.spawn[0]);assert.equal(m.spawn.y,R.spawn[1]-northOffset);assert(Math.abs(m.spawn.z-50)<.1);assert.equal(m.spawn.yaw_deg_clockwise_from_north,156);
  assert.equal(m.town_fill.burntRate,0);assert.equal(m.town_fill.repairRate,0);assert(Math.abs(m.town_fill.houseRate-.97)<1e-12);
  assert(!d.townPlots.some(p=>['burnt','repair'].includes(p.state)));assert(!d.facilities.nodes.some(n=>n.ruin));assert(d.facilities.nodes.some(n=>n.facility==='daibutsuden'&&n.part==='hall'));
  assert.equal(home.nodes.find(n=>n.facility==='toshoji'&&n.part==='hall').ruin,'burnt');assert(!home.files.get('ground_rgb.bin').equals(escape.files.get('ground_rgb.bin')));
  validateMeta(m);assert.throws(()=>sceneMetadata('unknown',P,northOffset));
});
test('scenes: camera and disc default on and can be omitted explicitly',()=>{
  assert.equal(R.emit.vista,true);assert.equal(R.emit.disc,true);
  const on=sceneMetadata('escape',P,northOffset,{vista:true,disc:true});assert.deepEqual(on.overlook,{...R.camera,north:140});assert.equal(on.sun.disc_deg,1.5);
  assert.equal(sceneMetadata('escape',P,northOffset,{}).overlook,undefined);assert.equal(sceneMetadata('escape',P,northOffset,{}).sun.disc_deg,undefined);
});
test('retreat: actual four-metre road grades and lookout spur obey the physical limits',t=>{
  for(const r of report.routes){assert(r.maxError<=1,r.id+' authored height error '+r.maxError);assert(r.maxFourGrade<=(r.id==='lookout'?.15:.22)+.001,r.id+' grade '+r.maxFourGrade);}
  const pass=escape.filled.roads.pass;assert.equal(pass.width_m,3);assert.equal(pass.kind,'kaido');assert.deepEqual(pass.xyz_m.at(-1),[-126,189,61.4]);
  assert.equal(escape.field.roads.filter(r=>r.id==='pass').length,1);assert(!('passCut'in P.road));t.diagnostic(JSON.stringify(report.routes));
});
test('retreat: spawn, town, pass mouth and temple branch are traversable in both directions',t=>{
  for(const move of report.moves)assert(move.ok,JSON.stringify(move));assert.equal(report.moves.length,8);assert(report.work>1000);t.diagnostic(JSON.stringify({moves:report.moves,work:report.work}));
});
test('retreat: meadow has at least 250 square metres below six degrees and summit has a flat five-metre radius',()=>{
  assert(report.meadow.flatArea>=250,JSON.stringify(report.meadow));const terrain=createKamakuraTerrain(escape.filled);
  for(let a=0;a<Math.PI*2;a+=.1)assert(Math.abs(terrain.heightAt(-112+5*Math.cos(a),gameZ(410+5*Math.sin(a)))-50)<.15);
});
test('retreat: both rock faces retain their specified height, run and exposed surfaces',t=>{
  assert(report.walls.ne.every(p=>p.rise>=8),JSON.stringify(report.walls));assert(report.walls.sw.every(p=>p.rise>=5),JSON.stringify(report.walls));
  const rock=JSON.parse(escape.files.get('works.json')).rocks.filter(r=>r.id.startsWith('pass-'));const toes=rock.filter(p=>p.id.includes('toe')||p.id.includes('large')).reduce((n,p)=>n+p.count,0);assert(toes>=90&&toes<=120);assert.equal(rock.filter(p=>p.id.includes('large')).reduce((n,p)=>n+p.count,0),10);assert(rock.every(p=>p.size_m[0]>=.6&&p.size_m[1]<=3));assert(report.wallProfiles.ne.length>=18);assert(report.wallProfiles.sw.length>=12);t.diagnostic(JSON.stringify({walls:report.walls,profiles:report.wallProfiles}));
});
test('retreat: four hamlet homes and two huts face roads with the required trees and fence lengths',()=>{
  assert.equal(escape.placed.routeHouses.length,6);assert.equal(escape.placed.routeHouses.filter(b=>b.hamlet).length,4);
  for(const [x,y,h]of R.trees){const tree=escape.veg.find(v=>Math.hypot(v[0]-x,northOffset-v[1]-y)<.01);assert(tree);assert.equal(tree[4],h);assert.equal(tree[6],3);}
  assert(report.fences.count>=6&&report.fences.count<=10);assert(report.fences.length>=120&&report.fences.length<=220);
  const fences=JSON.parse(escape.files.get('works.json')).fences;for(const f of fences){assert.equal(f.kind,'rail');for(const [x,y]of f.xy_m)assert(nearLine(R.cut,x,y+northOffset).distance>R.cutWidth/2);}
});
test('retreat: all requested screen frames and horizon use emitted ground heights',t=>{
  for(const p of report.frames){const [lo,hi,top,bottom]=p.range;assert(p.x>=lo&&p.x<=hi&&p.y>=top&&p.y<=bottom,JSON.stringify(p));}
  assert(report.horizon>=6&&report.horizon<=10);t.diagnostic(JSON.stringify({frames:report.frames,horizon:report.horizon}));
});
test('retreat: protected terrain and canopy sightlines stay clear while near woodland fills the frame',t=>{
  for(const ray of report.rays.filter(p=>!p.roof)){assert.equal(ray.hit,null,JSON.stringify(ray));assert(ray.clearance>=ray.required,JSON.stringify(ray));assert.equal(ray.trees,0,JSON.stringify(ray));}
  assert(report.rays.filter(p=>p.roof&&!p.hit&&p.clearance>=p.required&&!p.trees).length>=3);
  assert(details.forest.fraction>=R.survey.forestMin,JSON.stringify(details.forest));
  for(const v of escape.veg)if(!R.trees.some(p=>p[0]===v[0]&&p[1]===northOffset-v[1]))assert(Math.hypot(v[0]-R.camera.east,northOffset-v[1]-R.camera.north)>=14);
  t.diagnostic(JSON.stringify({forest:details.forest,rays:report.rays}));
});
test('scenes: CLI defaults to scene folders and rejects unknown scenes before writing',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'escape-cli-'));
  try{const bad=spawnSync(process.execPath,[path.resolve('tools/make-designed-world.mjs'),'--scene','other'],{cwd:dir,encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/Unknown scene/);assert.deepEqual(await fs.readdir(dir),[]);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('retreat: town roofs, sea and fires remain visible through terrain and full canopy cylinders',t=>{
  const count=kind=>report.visibility[kind].filter(p=>p.clear).length;
  assert.equal(report.visibility.town.length,99);assert(count('town')>=60);assert(count('sea')>=3);assert.equal(count('fires'),4);
  t.diagnostic(JSON.stringify({town:count('town'),sea:count('sea'),fires:count('fires'),trees:report.treeChanges}));
});
test('retreat: frame crown stays at the left edge and the sun band stays open',()=>{
  for(const p of report.crowns){if(R.trees.some(t=>t[0]===p.x&&t[1]===p.y))continue;
    const tree=escape.veg.find(v=>v[0]===p.x&&northOffset-v[1]===p.y);
    const low=tree[4]<=R.foreground.height[1];if(low)assert(tree[4]>=R.foreground.height[0]);

    assert(!(p.top<R.skyBand[2]&&p.bottom>0&&p.right>R.skyBand[0]&&p.left<R.skyBand[1]),JSON.stringify(p));
  }
  const frame=report.crowns.find(p=>p.x===R.trees[0][0]&&p.y===R.trees[0][1]);assert(frame.right<=R.frameRight);
  const meadow=R.trees[1];assert(meadow[2]>=12&&meadow[2]<=14);assert(meadow[3]*2>=9&&meadow[3]*2<=10);
});

test('retreat polish: low foreground trees and stones fill the right slope without blocking roads or views',()=>{
  const f=R.foreground,trees=escape.veg.filter(v=>v[4]>=f.height[0]&&v[4]<=f.height[1]&&Math.hypot(v[0]-R.camera.east,northOffset-v[1]-R.camera.north)<=f.distance[1]);
  assert(trees.length>=10&&trees.length<=16);
  for(const v of trees){const dx=v[0]-R.camera.east,dy=northOffset-v[1]-R.camera.north,bearing=(Math.atan2(dx,dy)*180/Math.PI+360)%360,distance=Math.hypot(dx,dy);assert(bearing>=185&&bearing<=215);assert(distance>=8&&distance<=45);}
  const rocks=JSON.parse(escape.files.get('works.json')).rocks.filter(p=>p.id.startsWith('foreground-'));
  assert(rocks.length>=15&&rocks.length<=25);assert(rocks.every(p=>p.size_m[0]>=.5&&p.size_m[1]<=1.6));
  for(const p of rocks){const q=nearLine(R.pass,p.x,p.y+northOffset);assert(q.distance>R.width/2+f.size[1]);}
  assert(report.moves.every(p=>p.ok));assert(report.rays.every(p=>!p.hit&&p.trees===0));
});

test('retreat: hamlet roofs and upper entrance facades are visible, and the small meadow hut stays left',t=>{
  // The stand-in boxes used without the model kit are not the size of the real houses: two of the four must still show.
  assert(details.hamlet.filter(p=>p.clear).length>=(kits?3:2),JSON.stringify(details.hamlet));
  assert(details.hut.width<=.06,JSON.stringify(details.hut));assert(details.hut.right<.4||details.hut.left>.6);
  assert(details.templeGrove>=10&&details.templeGrove<=16,JSON.stringify(details));
  const frame=report.crowns.find(p=>p.x===R.trees[0][0]&&p.y===R.trees[0][1]);assert(frame.distance>=22&&frame.distance<=26);assert(frame.right>=0&&frame.left<=.12);
  t.diagnostic(JSON.stringify({hamlet:details.hamlet,hut:details.hut,grove:details.templeGrove}));
});
test('scenes: optional horizon appears only in the escape scene when enabled',()=>{
  assert.equal(R.emit.horizon,true);assert.deepEqual(escape.meta.horizon,R.horizon);assert.equal(sceneMetadata('escape',P,northOffset,{}).horizon,undefined);
  const on=sceneMetadata('escape',P,northOffset,{horizon:true});assert.deepEqual(on.horizon,R.horizon);assert.equal(on.horizon.length,6);
  assert.deepEqual(sceneMetadata('return',P,northOffset,{horizon:true}),{});
});

test('retreat: the temple grove retains both cedar and broadleaf at nine to fourteen metres',()=>{
  const g=escape.field.templeGroveStats;assert(g.count>=10&&g.count<=16,JSON.stringify(g));assert(g.minHeight>=9&&g.maxHeight<=14,JSON.stringify(g));assert(g.species.includes(2)&&g.species.includes(3),JSON.stringify(g));
});
