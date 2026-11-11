import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { designedWorld, designedFetcher } from '../tools/make-designed-world.mjs';
import { ESCAPE as R, sceneMetadata } from '../tools/worlds/kamakura-escape.mjs';
import { PLAN as P } from '../tools/worlds/kamakura-return.mjs';
import { escapeReport } from '../tools/lib/designed-escape-validation.mjs';
import { routeDefinitions, clearRouteTree, routeTargets, nearLine } from '../tools/lib/designed-route.mjs';
import { designedCamera } from '../tools/lib/designed-perspective.mjs';
import { gameZ, northOffset } from '../tools/lib/designed-terrain.mjs';
import { loadKamakura, validateMeta } from '../dist/valley/kamakura-data.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
const kits=process.env.KZ_KIT_DIR;
const home=await designedWorld({kits}),escape=await designedWorld({kits,scene:'escape'}),report=escapeReport(escape);
test('scenes: shared geography, vegetation, authored houses and works are byte identical',async()=>{
  const same=['height_u16.bin','walk_u8.bin','surface_class_u8.bin','roads.json','rivers.json','veg.json','veg_f32.bin','houses.json','houses_f32.bin','houses_kit.glb','facilities.glb','patch_cells_i32.bin','patch_h_f32.bin','patch_axes.json','patch_paths.json','works.json'];
  for(const file of same)assert(home.files.get(file).equals(escape.files.get(file)),file);
  const again=await designedWorld({kits,scene:'escape'});for(const [n,b]of escape.files)assert(b.equals(again.files.get(n)),n);
  assert.equal(home.meta.world,'kamakura-return');assert.deepEqual(home.meta.overlook,P.overlook);assert.equal(home.meta.time,undefined);
});
test('scenes: dusk metadata, coordinate conversion and standing temples load with the current decoder',async()=>{
  const m=escape.meta,d=await loadKamakura(designedFetcher(escape.files));assert.equal(m.world,'kamakura-escape');assert.equal(m.time,'dusk');assert.equal(m.buddha,'hall');assert.deepEqual(m.overlook,{...R.camera,north:140});
  assert.deepEqual(m.sun,{...R.sun,disc_deg:R.disc});assert.deepEqual(m.air,R.air);assert.deepEqual(m.lights,R.lights);assert.deepEqual(m.flight,R.flight);
  assert.deepEqual(m.fires,R.fires.map(([x,y,radius_m,strength])=>({x,y:y-northOffset,radius_m,strength})));
  assert.equal(m.spawn.x,-112);assert.equal(m.spawn.y,140);assert(Math.abs(m.spawn.z-50)<.1);assert.equal(m.spawn.yaw_deg_clockwise_from_north,156);
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
test('retreat: meadow has at least 250 square metres below six degrees and summit has a flat three-metre radius',()=>{
  assert(report.meadow.flatArea>=250,JSON.stringify(report.meadow));const terrain=createKamakuraTerrain(escape.filled);
  for(let a=0;a<Math.PI*2;a+=.1)assert(Math.abs(terrain.heightAt(-112+3*Math.cos(a),gameZ(410+3*Math.sin(a)))-50)<.15);
});
test('retreat: both rock faces retain their specified height, run and exposed surfaces',t=>{
  assert(report.walls.ne.every(p=>p.rise>=8),JSON.stringify(report.walls));assert(report.walls.sw.every(p=>p.rise>=5),JSON.stringify(report.walls));
  const rock=JSON.parse(escape.files.get('works.json')).rocks.filter(r=>r.id.startsWith('pass-'));assert.equal(rock.reduce((n,p)=>n+p.count,0),72);assert(rock.every(p=>p.size_m[0]>=.6&&p.size_m[1]<=2.4));assert(report.wallProfiles.ne.length>=18);assert(report.wallProfiles.sw.length>=12);t.diagnostic(JSON.stringify({walls:report.walls,profiles:report.wallProfiles}));
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
test('retreat: terrain and crown sightlines stay clear; unmarked near fan has no forest',t=>{
  for(const ray of report.rays){assert.equal(ray.hit,null,JSON.stringify(ray));assert(ray.clearance>=ray.required,JSON.stringify(ray));assert.equal(ray.trees,0,JSON.stringify(ray));}
  const c=R.camera;for(const v of escape.veg){const x=v[0],y=northOffset-v[1],bearing=(Math.atan2(x-c.east,y-c.north)*180/Math.PI+360)%360;
    if(Math.hypot(x-c.east,y-c.north)<R.fanRange&&bearing>=120&&bearing<=200)assert(R.trees.some(p=>Math.hypot(p[0]-x,p[1]-y)<.01));}
  t.diagnostic(JSON.stringify({rays:report.rays}));
});
test('scenes: CLI defaults to scene folders and rejects unknown scenes before writing',async()=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'escape-cli-'));
  try{const bad=spawnSync(process.execPath,[path.resolve('tools/make-designed-world.mjs'),'--scene','other'],{cwd:dir,encoding:'utf8'});assert.notEqual(bad.status,0);assert.match(bad.stderr,/Unknown scene/);assert.deepEqual(await fs.readdir(dir),[]);}finally{await fs.rm(dir,{recursive:true,force:true});}
});

test('retreat: town roofs, sea and fires remain visible through terrain and full canopy cylinders',t=>{
  const count=kind=>report.visibility[kind].filter(p=>p.clear).length;
  assert.equal(report.visibility.town.length,99);assert(count('town')>=60);assert(count('sea')>=3);assert.equal(count('fires'),5);
  t.diagnostic(JSON.stringify({town:count('town'),sea:count('sea'),fires:count('fires'),trees:report.treeChanges}));
});
test('retreat: only the left frame tree enters the near frame; the upper sun band stays open',()=>{
  for(const p of report.crowns){if(R.trees.some(t=>t[0]===p.x&&t[1]===p.y))continue;
    if(p.distance<R.nearTree&&p.bottom>0&&p.top<1)assert(!(p.right>R.frameRight&&p.left<R.nearRight),JSON.stringify(p));
    assert(!(p.top<R.skyBand[2]&&p.bottom>0&&p.right>R.skyBand[0]&&p.left<R.skyBand[1]),JSON.stringify(p));
  }
  const frame=report.crowns.find(p=>p.x===R.trees[0][0]&&p.y===R.trees[0][1]);assert(frame.right<=R.frameRight);
  const meadow=R.trees[1];assert(meadow[2]>=12&&meadow[2]<=14);assert(meadow[3]*2>=9&&meadow[3]*2<=10);
});
