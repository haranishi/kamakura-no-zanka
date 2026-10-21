import assert from 'node:assert/strict';
import fs from 'node:fs';
import {groundAt,checkPosition,movePlayer} from '../dist/collision.js';
const world=JSON.parse(fs.readFileSync(new URL('../dist/assets/collision.json',import.meta.url),'utf8'));
const tests=[];function test(name,fn){fn();tests.push({name,passed:true});}
function pos(x,z){const q=checkPosition(world,x,z);assert(q.ok,JSON.stringify(q));return{x,z,y:q.y};}
test('Source-ground start is valid',()=>{assert(checkPosition(world,-2.3,6.4).ok);assert(Number.isFinite(groundAt(world.ground,-2.3,6.4)));});
test('Unobstructed path movement',()=>{const p=pos(-2.3,6.4),r=movePlayer(world,p,0,-1);assert(Math.abs(r.position.z-5.4)<1e-8);assert.equal(r.blocked,null);});
test('House and porch stop a swept approach',()=>{const r=movePlayer(world,pos(-9,1),0,-5);assert(r.position.z>-.76);assert(r.blocked);});
test('Well blocks approach without roof-overhang collider',()=>{const r=movePlayer(world,pos(-9,2),6,0);assert(r.position.x<-7.7);assert(r.blocked);});
test('West scene boundary prevents escape',()=>{const r=movePlayer(world,pos(-14,-4),-20,0);assert(r.position.x>=-14.77);assert.equal(r.blocked,'boundary');});
test('Channel bank prevents entering water',()=>{const r=movePlayer(world,pos(-2.3,5),8,0);assert(r.position.x<=-1.43);assert(r.blocked);});
test('South and north cut edges block walking',()=>{assert(movePlayer(world,pos(-2.3,5),0,10).position.z<=6.77);assert(movePlayer(world,pos(-2.3,-10),0,-10).position.z>=-10.77);});
test('A large frame cannot tunnel through well',()=>{const r=movePlayer(world,pos(-9,2),20,0);assert(r.position.x<-7.7);});
test('Wall sliding preserves tangential movement',()=>{const r=movePlayer(world,pos(-9,-.70),2,-1);assert(r.position.x>-7.1);assert(r.position.z>-.76);});
test('Ground stays attached along 17m of road',()=>{let p=pos(-2.3,6.4);for(let i=0;i<170;i++){p=movePlayer(world,p,0,-.1).position;assert(Math.abs(p.y-groundAt(world.ground,p.x,p.z))<1e-8);}assert(p.z<-10.5);});
test('Raised >22cm steps are blocked',()=>{const w={bounds:{minX:-5,maxX:5,minZ:-5,maxZ:5},boxes:[],waterHazards:[],ground:{minX:-5,minZ:-5,step:1,nx:11,nz:11,heights:Array.from({length:121},(_,i)=>i%11>5?1:0)}};assert.equal(checkPosition(w,1,0,.23,0).reason,'step');});
const result={passed:tests.length,failed:0,tests};fs.writeFileSync(new URL('../reports/collision_tests.json',import.meta.url),JSON.stringify(result,null,2));console.log(result);
