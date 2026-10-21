import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {PLACES} from '../dist/places.js';
import {checkPosition,movePlayer,groundAt} from '../dist/collision.js';
import {selectTarget,segmentBlocked} from '../dist/interactions.js';
const world=JSON.parse(fs.readFileSync(new URL('../dist/assets/collision.json',import.meta.url)));
test('新しい対話は元の安全な道から見え、家と井戸越しには届かない',()=>{
 for(const [name,position] of [['sluice',{x:-2.3,z:1.2}],['lantern',{x:-10.5,z:.4}]]){
  position.y=groundAt(world.ground,position.x,position.z);
  assert.equal(checkPosition(world,position.x,position.z).ok,true);
  const anchor=PLACES[name],yaw=Math.atan2(-(anchor.x-position.x),-(anchor.z-position.z));
  const target={id:name,anchor,available:true};
  assert.equal(selectTarget(position,yaw,[target],(p,t)=>segmentBlocked(p,t,world.boxes))?.id,name);
  assert.equal(selectTarget(position,yaw+Math.PI,[target],()=>false),null);
 }
 assert.equal(segmentBlocked({x:-10.5,y:0,z:-8.2},{anchor:PLACES.lantern},world.boxes),true);
});
test('配達先から水門と灯へ元の衝突を保って連続移動できる',()=>{
 let current={x:-8.5,z:.2,y:groundAt(world.ground,-8.5,.2)};
 const waypoints=[[-8.5,3.8],[-4.9,3.8],[-2.3,3.8],[-2.3,1.2],[-2.3,3.8],[-8.5,3.8],[-10.5,3.8],[-10.5,.4]];
 for(const [x,z] of waypoints){
  const result=movePlayer(world,current,x-current.x,z-current.z);
  assert.equal(result.blocked,null);
  assert.ok(Math.hypot(result.position.x-x,result.position.z-z)<.001);
  current=result.position;
 }
});
