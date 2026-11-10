import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { decodeRoads } from '../dist/valley/kamakura-roads.js';
import { decodeRivers } from '../dist/valley/kamakura-rivers.js';
import { PEOPLE, PEOPLE_ROLES, PEOPLE_CLIPS, peopleAmount, peopleStride, peopleLimit, preparePeople, peoplePlacementBatches,
  createPersonState, resetPerson, stepPerson, avoidPerson } from '../dist/valley/kamakura-people.js';
import { propBoxDistance } from '../dist/valley/kamakura-props.js';
import { createHabitat } from '../dist/valley/kamakura-habitat.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { readPrivateData } from '../tools/lib/kamakura-validation.mjs';
import { readPrivateHouses } from '../tools/lib/kamakura-house-validation.mjs';
import { readPrivateFacilities } from '../tools/lib/kamakura-facility-validation.mjs';
import { houseBox, houseMatrix } from '../dist/valley/kamakura-houses.js';
import { facilityFootprint } from '../dist/valley/kamakura-facilities.js';

export function town() {
  const terrain = { bounds: { minX: -200, maxX: 200, minZ: -200, maxZ: 200 }, heightAt: () => 0, walkable: () => true, waterAt: () => 0, slopeAt: () => 0 };
  const habitat = { at(x,z,out) { Object.assign(out, { town: 1, forest: 0, pass: 0, paddy: 0, meadow: 0, sand: 0, temple: 0 }); return out; } };
  return { data: {}, terrain, habitat };
}
function world() {
  const w = town(); w.terrain.bounds = { minX: -250, maxX: 700, minZ: -200, maxZ: 870 };
  w.terrain.walkable = (x,z) => z < 850 && !(x > 600 && z < 0);
  w.terrain.waterAt = (x,z) => z >= 850 ? 1 : 0;
  w.terrain.seaDistanceAt = (x,z) => Math.max(0,850-z);
  w.terrain.slopeAt = (x,z) => x > 600 ? 25 : 0;
  w.habitat.at = (x,z,out) => Object.assign(out, { town: x < 240 && z < 180 ? 1 : 0, paddy: z > 220 && z < 650 ? 1 : 0,
    forest: x > 600 ? 1 : 0, pass: x > 550 && z < 0 ? 1 : 0, sand: z > 750 ? 1 : 0, meadow: .6, temple: x > 300 && x < 500 ? 1 : 0 });
  w.houses = { boxes: Array.from({length: 150}, (_,i) => ({ x: -180 + i%15*26, z: -160 + Math.floor(i/15)*30, w: 8, d: 4, height: 5, rotY: i%2*.4 })) };
  const node = (part,x,z,w,d) => ({ node: part, facility: 'test', part, anchor_xz:[x,z], bbox_min:[-w/2,0,-d/2], bbox_max:[w/2,5,d/2] });
  w.data = { facilities:{nodes:[node('hall',400,0,20,10),node('gate',400,60,8,2)]}, meta:{places:[{kind:'coast',name:'synthetic',x:0,y:-800}]},
    roads:{street:{kind:'local_road',width_m:6,xyz_m:[[-150,0,0],[120,0,0],[120,-150,0]]}} };
  return w;
}

test('amount clamps and quality/bone-update thresholds follow the contract', () => {
  assert.equal(peopleAmount('?people=0'),0); assert.equal(peopleAmount('?people=2'),2);
  assert.equal(peopleAmount('?people=.01'),.25); assert.equal(peopleAmount('?people=20'),3);
  assert.equal(peopleAmount('?people=bad'),1); assert.equal(peopleAmount(),1);
  assert.deepEqual([0,1,2,3].map(s=>peopleLimit('standard',s)),[10,10,6,0]);
  assert.deepEqual([0,1,2,3].map(s=>peopleLimit('light',s)),[5,5,5,0]);
  assert.deepEqual([20,35,36,55,56,70].map(peopleStride),[1,1,2,2,4,4]);
});
test('world placement is deterministic, seven roles exist, forbidden ground stays empty', t => {
  const w=world(), a=preparePeople(w), b=preparePeople(w);
  assert.deepEqual(a.spots,b.spots);
  const roles=Object.fromEntries(PEOPLE_ROLES.map(r=>[r,a.spots.filter(p=>p.role===r).length]));
  for(const role of PEOPLE_ROLES) assert(roles[role]>0,role);
  for(let i=0;i<a.spots.length;i++) {
    const p=a.spots[i], h={}; w.habitat.at(p.x,p.z,h);
    assert(a.site.ground(p.x,p.z)); assert(h.forest<=.35 && h.pass<=.4);
    if(p.role!=='walker') assert(!a.site.onRoad(p.x,p.z));
    if(p.role==='farmer') assert(h.paddy>.35 || h.meadow>.5 && h.town>.03);
    if(p.role==='worshipper') assert(h.paddy<.35);
    if(p.role==='chat'||p.role==='sitter') assert(h.town>.25);
    for(const box of a.site.boxes) assert(propBoxDistance(p.x,p.z,box)>=.4);
    for(let j=0;j<i;j++) if(!(p.role==='chat' && p.group===a.spots[j].group)) assert(Math.hypot(p.x-a.spots[j].x,p.z-a.spots[j].z)>=PEOPLE.gap);
    assert(p.scale>=.96 && p.scale<=1.04);
  }
  t.diagnostic(`synthetic roles ${JSON.stringify(roles)}`);
});
test('synthetic town has 6–10 people within 60m; outskirts/paddy has 2–4', t => {
  const a=preparePeople(town()), townCount=a.spots.filter(p=>Math.hypot(p.x,p.z)<60).length;
  assert(townCount>=6 && townCount<=10);
  const w=town(); w.habitat.at=(x,z,out)=>Object.assign(out,{town:0,forest:0,pass:0,paddy:1,meadow:0,sand:0});
  const b=preparePeople(w), fieldCount=b.spots.filter(p=>Math.hypot(p.x,p.z)<60).length;
  assert(fieldCount>=2 && fieldCount<=4); t.diagnostic(`synthetic 60m town ${townCount}, paddy ${fieldCount}`);
  assert(preparePeople(town(),2).spots.length>a.spots.length*1.3);
});
test('chat groups face their centre, seats sit beyond the long face, visitors face the hall', () => {
  const w=world(),{spots,site}=preparePeople(w);
  for(const p of spots) {
    if(p.role==='chat') {
      const group=spots.filter(q=>q.role==='chat'&&q.group===p.group);
      assert(group.length>=2 && group.length<=3);
      assert(w.houses.boxes.some(b=>propBoxDistance(p.x,p.z,b)<=4.1),'chat stays at a house front');
      const x=group.reduce((s,q)=>s+q.x,0)/group.length,z=group.reduce((s,q)=>s+q.z,0)/group.length;
      assert(-Math.sin(p.yaw)*(x-p.x)-Math.cos(p.yaw)*(z-p.z)>.9);
    }
    if(p.role==='worshipper') assert(-Math.sin(p.yaw)*(400-p.x)-Math.cos(p.yaw)*(0-p.z)>0);
    if(p.role==='sitter') {
      const b=w.houses.boxes.find(b=>propBoxDistance(p.x,p.z,b)<=1.200001); assert(b);
      assert(propBoxDistance(p.x,p.z,b)>=.59999);
    }
    if(p.role==='shore') assert(p.who==='villager_m');
    if(p.route) for(const q of p.route) { assert(site.ground(q.x,q.z)); if(p.role==='walker') assert(site.onRoad(q.x,q.z)); }
    if(p.role==='walker') assert(p.length>=40 && p.length<=120);
    if(p.role==='child') {assert(p.route);assert(p.length>=8&&p.length<=20);}
  }
});
test('generator batching gives the same world and all-water/forest/pass worlds are empty', () => {
  const w=world(), job=peoplePlacementBatches(w);let n; do{n=job.next();}while(!n.done);
  assert.deepEqual(n.value.spots,preparePeople(w).spots);
  for(const bad of ['water','forest','pass','slope','walk']) {
    const w=town();
    if(bad==='water') w.terrain.waterAt=()=>1;
    if(bad==='slope') w.terrain.slopeAt=()=>21;
    if(bad==='walk') w.terrain.walkable=()=>false;
    if(bad==='forest'||bad==='pass') w.habitat.at=(x,z,out)=>Object.assign(out,{town:1,forest:0,pass:0,[bad]:1});
    assert.equal(preparePeople(w).spots.length,0,bad);
  }
});
test('bow cooldown, face-only seated reactions, child waves, drawn fear, and route waits', () => {
  const w=world(),{spots,site}=preparePeople(w), p=spots.find(p=>p.role==='walker'), s=resetPerson(createPersonState(),p);
  const hero={x:p.x+2,z:p.z}; stepPerson(s,hero,false,1,1/60,site);
  assert.equal(s.clip,'Formal_Bow'); assert(-Math.sin(s.yaw)>.99); assert.equal(s.lastBow,1);
  for(let i=0;i<1800;i++) {hero.x=s.x+2;hero.z=s.z;stepPerson(s,hero,false,1+i/60,1/60,site);}
  assert.equal(s.lastBow,1); hero.x=s.x+2;hero.z=s.z;stepPerson(s,hero,false,32,1/60,site); assert.equal(s.lastBow,32);
  resetPerson(s,p); hero.x=p.x+2;hero.z=p.z; for(let i=0;i<300;i++) stepPerson(s,hero,true,i/60,1/60,site);
  assert.notEqual(s.clip,'Formal_Bow'); assert.equal(s.lastBow,-Infinity); assert(Math.hypot(s.x-p.x,s.z-p.z)<1.31);
  for(const role of ['sitter','farmer','child']) {
    const p=spots.find(p=>p.role===role); resetPerson(s,p); const yaw=s.yaw;
    stepPerson(s,{x:p.x+2,z:p.z+1},false,1,1/60,site);
    if(role==='child') assert.equal(s.clip,'Wave_One_Hand'); else {assert.equal(s.yaw,yaw);assert.notEqual(s.head,0);}
  }
  resetPerson(s,p); let waits=0;
  for(let i=0;i<18000;i++) { stepPerson(s,{x:900,z:900},false,i/60,1/60,site); if(s.wait>0) waits++; assert(site.onRoad(s.x,s.z)); }
  assert(waits>0);
});
test('hero walks through a row: people yield, hero position is unchanged, overlap frames zero', t => {
  const site={ground:()=>true}, states=Array.from({length:10},(_,i)=>resetPerson(createPersonState(),{x:i*2,z:0,yaw:0,phase:0,role:'chat'}));
  let overlaps=0; const hero={x:-3,z:0};
  for(let frame=0;frame<2000;frame++) {
    hero.x=-3+frame*.015; const before={...hero};
    for(const s of states) {avoidPerson(s,hero.x,hero.z,PEOPLE.heroGap,site); if(Math.hypot(s.x-hero.x,s.z-hero.z)<PEOPLE.heroGap-1e-5) overlaps++;}
    assert.deepEqual(hero,before);
  }
  assert.equal(overlaps,0);t.diagnostic(`2000 frames, hero/person overlap ${overlaps}`);
  const s=states[0];s.x=s.z=0;assert.equal(avoidPerson(s,0,0,1,{ground:()=>false}),false);
});
test('every requested clip exists in each shipped character and each actual GLB animation list', () => {
  const meta=JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json',import.meta.url)));
  for(const who of ['villager_m','villager_f','child']) {
    const glb=fs.readFileSync(new URL(`../dist/assets/characters/${who}.glb`,import.meta.url));
    const json=JSON.parse(glb.subarray(20,20+glb.readUInt32LE(12)).toString());
    for(const clip of PEOPLE_CLIPS) {assert(meta.characters[who].clips.includes(clip),`${who}/${clip}`);assert(json.animations.some(a=>a.name===clip));}
  }
});
test('private world: no exception and no prohibited placement (no coordinates or counts recorded)', async t => {
  if(!process.env.KZ_WORLD_DIR)return t.skip('KZ_WORLD_DIR未設定');
  const dir=process.env.KZ_WORLD_DIR,{data}=await readPrivateData(dir);
  if(data.meta.roads)data.roads=decodeRoads(JSON.parse(fs.readFileSync(path.join(dir,'roads.json'))),data.meta.roads.count);
  if(data.meta.surface)data.surface=new Uint8Array(fs.readFileSync(path.join(dir,'surface_class_u8.bin')));
  if(data.meta.rivers)data.rivers=decodeRivers(JSON.parse(fs.readFileSync(path.join(dir,'rivers.json'))),data.meta.rivers.count);
  const terrain=createKamakuraTerrain(data),{houses,bodies}=await readPrivateHouses(dir,data);
  const input=await readPrivateFacilities(dir,data);data.facilities=input.facilities;
  const facilities={records:input.facilities.nodes.map(node=>({node,bounds:facilityFootprint(node,input.positions.get(node.node),false)}))};
  const boxes=houses.instances.map(h=>houseBox(houses.kinds.get(h.kind),houseMatrix(h,terrain,bodies.get(h.kind)),bodies.get(h.kind)));
  const habitat=createHabitat({terrain,meta:data.meta,surface:data.surface,housePoints:boxes});
  const {spots,site}=preparePeople({data,terrain,facilities,houses:{boxes},habitat});
  for(const p of spots) {assert(site.ground(p.x,p.z),'private ground rule (values withheld)');if(p.role!=='walker')assert(!site.onRoad(p.x,p.z),'private path rule (values withheld)');}
});

test('an unsampled narrow wet strip cannot receive a moving person', () => {
  const site={ground:(x,z)=>!(x>.9&&x<1.1)};
  const p={x:0,z:0,yaw:0,phase:0,role:'walker',length:2,route:[{x:0,z:0,d:0},{x:2,z:0,d:2}]};
  const s=resetPerson(createPersonState(),p);s.travel=0;
  for(let i=0;i<600;i++){stepPerson(s,{x:100,z:100},false,i/60,1/60,site);assert(site.ground(s.x,s.z));assert(s.x<=.9);}
});
