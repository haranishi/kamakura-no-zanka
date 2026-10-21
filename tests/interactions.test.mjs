import test from 'node:test';
import assert from 'node:assert/strict';
import {selectTarget,segmentBlocked} from '../dist/interactions.js';
const player={x:0,y:.2,z:0};
const target=(id,x,z,options={})=>({id,anchor:{x,y:.06,z},available:true,...options});

test('桶の低さを水平距離に加えず、1.6mの境界まで手が届く',()=>{
 const bucket=target('bucket',0,-1.6);
 assert.equal(selectTarget(player,0,[bucket]),bucket);
 assert.equal(selectTarget({...player,z:.00001},0,[bucket]),null);
 assert.equal(selectTarget({...player,z:-.00001},0,[bucket]),bucket);
});

test('前方の許容角とyawの符号に従い、背後や真横を拒否する',()=>{
 assert.equal(selectTarget(player,0,[target('back',0,1)]),null);
 assert.equal(selectTarget(player,0,[target('side',1,0)]),null);
 const edge=target('edge',.8,-.6,{minFacingCos:.6});
 assert.equal(selectTarget(player,0,[edge]),edge);
 assert.equal(selectTarget(player,0,[{...edge,minFacingCos:.60001}]),null);
 const left=target('left',-1,0);
 assert.equal(selectTarget(player,Math.PI/2,[left]),left);
 assert.equal(selectTarget(player,-Math.PI/2,[left]),null);
});

test('利用可否と安全な接近側を評価し、移動後は古い予告を使わない',()=>{
 const bucket=target('bucket',0,-1);
 assert.equal(selectTarget(player,0,[{...bucket,available:false}]),null);
 const well=target('well',0,-1,{approach:p=>p.z>=0});
 assert.equal(selectTarget(player,0,[well]),well);
 assert.equal(selectTarget({...player,z:-.2},0,[well]),null);
 assert.equal(selectTarget(player,0,[bucket]),bucket);
 assert.equal(selectTarget({...player,z:1},0,[bucket]),null);
 assert.equal(selectTarget(player,Math.PI,[bucket]),null);
});

test('遮蔽を除いた最も近い一対象を選び、同距離は向きと入力順で安定する',()=>{
 const near=target('near',.4,-.6),front=target('front',0,-1),far=target('far',0,-1.5);
 assert.equal(selectTarget(player,0,[far,front,near]),near);
 assert.equal(selectTarget(player,0,[near,front],(_,t)=>t.id==='near'),front);
 assert.equal(selectTarget(player,0,[near],()=>true),null);
 const angled=target('angled',.8,-.6),equal=target('equal',0,-1);
 assert.equal(selectTarget(player,0,[angled,front]),front);
 assert.equal(selectTarget(player,0,[equal,front]),equal);
});

test('同じ位置の対象と明示的な距離指定を扱い、不正な幾何データを拒否する',()=>{
 const atFeet=target('feet',0,0),far=target('far',0,-1.7,{distance:1.8});
 assert.equal(selectTarget(player,Math.PI,[atFeet]),atFeet);
 assert.equal(selectTarget(player,0,[far]),far);
 for(const bad of [null,{...far,anchor:{x:0,y:NaN,z:-1}},{...far,distance:-1},{...far,minFacingCos:2},{...far,approach:'east'}])
  assert.equal(selectTarget(player,0,[bad]),null);
 assert.equal(selectTarget({...player,x:Infinity},0,[atFeet]),null);
 assert.equal(selectTarget(player,NaN,[atFeet]),null);
 assert.equal(selectTarget(player,0,null),null);
});

test('家のXZ領域が高さにかかわらず遮蔽し、先や背後の箱は遮蔽しない',()=>{
 const box={id:'house',minX:-.4,maxX:.4,minY:0,maxY:.3,minZ:-.9,maxZ:-.8};
 const ahead=target('bucket',0,-1);
 assert.equal(segmentBlocked(player,ahead,[box]),true);
 assert.equal(segmentBlocked({...player,y:2},ahead,[box]),true);
 assert.equal(segmentBlocked(player,target('near',0,-.5),[box]),false);
 assert.equal(segmentBlocked(player,target('side',1,-1),[box]),false);
 assert.equal(segmentBlocked(player,target('back',0,1),[box]),false);
 assert.equal(segmentBlocked(ahead.anchor,player,[box]),true);
 assert.equal(segmentBlocked(player,ahead,[]),false);
});

test('井戸自身の箱だけを除外し、別の壁や境界への接触を除外しない',()=>{
 const well={id:'well',minX:-.5,maxX:.5,minZ:-1.1,maxZ:-.9};
 const wall={id:'house',minX:-.5,maxX:.5,minZ:-.7,maxZ:-.6};
 const destination=target('well',0,-1);
 assert.equal(segmentBlocked(player,destination,[well]),true);
 assert.equal(segmentBlocked(player,destination,[well],'well'),false);
 assert.equal(segmentBlocked(player,destination,[well,wall],'well'),true);
 assert.equal(segmentBlocked({x:.5,y:0,z:0},target('edge',.5,-1),[well]),true);
 assert.equal(segmentBlocked({...player,x:NaN},destination,[well]),true);
});
