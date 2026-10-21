import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState, transition, progressFor, objectiveFor } from '../dist/gameplay.js';
import { loadProgress, saveProgress, PROGRESS_KEY, SCHEMA_VERSION } from '../dist/save.js';
const stages=['bucket','empty','full','delivered','irrigated','restored'];
const actions=['pickup','fill','deliver','clear','light'];
const storageFor=raw=>({ raw, getItem(){return this.raw;},setItem(key,value){assert.equal(key,PROGRESS_KEY);this.raw=value;} });

test('水運びから復流・点灯まで順に一度ずつ進み、結果と次の目的が残る',()=>{
 let state=initialState();
 for(let index=0;index<stages.length;index++){
  assert.equal(state.stage,stages[index]);
  const progress=progressFor(state);
  assert.equal(progress.watered,index>=3);
  assert.equal(progress.flowing,index>=4);
  assert.equal(progress.lit,index===5);
  assert.equal(progress.complete,index===5);
  assert.equal(progress.step,Math.min(5,index+1));
  assert.ok(objectiveFor(state).length>0);
  if(index<actions.length){
   const before={...state};const next=transition(state,actions[index]);
   assert.equal(next.changed,true);assert.deepEqual(state,before);
   assert.equal(transition(next.state,actions[index]).changed,false);
   state=next.state;
  }
 }
 assert.match(objectiveFor({stage:'delivered'}),/水路|落枝/);
 assert.match(objectiveFor({stage:'irrigated'}),/灯/);
 assert.match(objectiveFor({stage:'restored'}),/散策|歩/);
});

test('六状態の全てで前段階・先のしごと・終端からの再実行を拒否する',()=>{
 for(let index=0;index<stages.length;index++){
  for(const action of [...actions,'reset','constructor',null]){
   const before=Object.freeze({stage:stages[index]});
   const result=transition(before,action);
   assert.equal(result.changed,index<actions.length&&action===actions[index]);
   if(!result.changed)assert.deepEqual(result.state,before);
  }
 }
});

test('旧v1の四状態を失わず読み取り移行し、次の成功保存はv2になる',()=>{
 assert.equal(SCHEMA_VERSION,2);
 for(const stage of stages.slice(0,4)){
  const raw=JSON.stringify({schemaVersion:1,stage,position:{x:999}});
  const storage=storageFor(raw),result=loadProgress(storage);
  assert.deepEqual(result.state,{stage});assert.equal(result.hasSave,true);
  assert.equal(storage.raw,raw,'読み取りで旧保存を上書きしない');
  assert.equal(saveProgress(storage,result.state).ok,true);
  assert.deepEqual(JSON.parse(storage.raw),{schemaVersion:2,stage});
 }
 const migrated=loadProgress(storageFor('{"schemaVersion":1,"stage":"delivered"}'));
 assert.equal(progressFor(migrated.state).watered,true);
 assert.equal(progressFor(migrated.state).flowing,false);
});

test('v2六状態の往復と、v1に偽装した新状態・未知版・不正値の拒否',()=>{
 for(const stage of stages){
  const storage=storageFor(null);
  assert.equal(saveProgress(storage,{stage}).ok,true);
  assert.deepEqual(loadProgress(storage).state,{stage});
 }
 for(const data of [
  {schemaVersion:1,stage:'irrigated'},{schemaVersion:1,stage:'restored'},
  {schemaVersion:3,stage:'full'},{schemaVersion:2,stage:'future'},
  {schemaVersion:'2',stage:'full'},{schemaVersion:2,stage:null}
 ]){
  const loaded=loadProgress(storageFor(JSON.stringify(data)));
  assert.deepEqual(loaded.state,initialState());assert.equal(loaded.hasSave,false);assert.ok(loaded.notice);
 }
});
