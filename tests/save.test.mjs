import test from 'node:test';
import assert from 'node:assert/strict';
import {PROGRESS_KEY,SCHEMA_VERSION,loadProgress,saveProgress} from '../dist/save.js';
const memoryStorage=()=>{
 const data=new Map();
 return{getItem:key=>data.has(key)?data.get(key):null,setItem:(key,value)=>data.set(key,String(value))};
};

test('四状態を設定と分けて保存し、安全な進行だけを復元する',()=>{
 const storage=memoryStorage();
 storage.setItem('kamakura-ui-v16','{"quality":"low"}');
 assert.deepEqual(loadProgress(storage),{state:{stage:'bucket'},hasSave:false,notice:''});
 for(const stage of ['bucket','empty','full','delivered']){
  const original=Object.freeze({stage,position:{x:Infinity,y:0,z:9}});
  assert.deepEqual(saveProgress(storage,original),{ok:true,notice:''});
  assert.deepEqual(JSON.parse(storage.getItem(PROGRESS_KEY)),{schemaVersion:SCHEMA_VERSION,stage});
  assert.deepEqual(loadProgress(storage),{state:{stage},hasSave:true,notice:''});
 }
 assert.equal(storage.getItem('kamakura-ui-v16'),'{"quality":"low"}');
});

test('壊れたJSON、null、配列、型や列挙の不正を初期状態と案内へ戻す',()=>{
 const storage=memoryStorage();
 const invalid=['','{oops','null','[]','"full"','1','true','{}',
  '{"stage":"full"}','{"schemaVersion":1}',
  '{"schemaVersion":1,"stage":null}','{"schemaVersion":1,"stage":0}',
  '{"schemaVersion":1,"stage":"future"}','{"schemaVersion":1,"stage":"constructor"}',
  '{"schemaVersion":1,"stage":"toString"}','{"schemaVersion":1,"stage":["full"]}'];
 for(const raw of invalid){
  storage.setItem(PROGRESS_KEY,raw);
  const result=loadProgress(storage);
  assert.deepEqual(result.state,{stage:'bucket'},raw);
  assert.equal(result.hasSave,false,raw);
  assert.ok(result.notice.length>0,raw);
  assert.equal(storage.getItem(PROGRESS_KEY),raw,'読み取りで元データを破棄しない');
 }
});

test('未知・旧版や文字列の版を移行せず、使えない理由を案内する',()=>{
 const storage=memoryStorage();
 for(const schemaVersion of [0,2,-1,1.5,'1',null,true]){
  storage.setItem(PROGRESS_KEY,JSON.stringify({schemaVersion,stage:'full'}));
  const result=loadProgress(storage);
  assert.deepEqual(result.state,{stage:'bucket'});
  assert.equal(result.hasSave,false);
  assert.match(result.notice,/版|バージョン/);
 }
});

test('保存済みの余分な座標や設定は復元せず、既知の進行だけを使う',()=>{
 const storage=memoryStorage();
 storage.setItem(PROGRESS_KEY,'{"schemaVersion":1,"stage":"full","position":{"x":1e999,"y":-999,"z":0},"quality":"ultra"}');
 assert.deepEqual(loadProgress(storage),{state:{stage:'full'},hasSave:true,notice:''});
});

test('保存領域や読み取りAPIの拒否でもクラッシュせず初期状態へ戻る',()=>{
 const denied={getItem(){throw new Error('private-test-error');}};
 for(const storage of [null,undefined,{},denied,{getItem:4},{getItem:()=>42}]){
  const result=loadProgress(storage);
  assert.deepEqual(result.state,{stage:'bucket'});
  assert.equal(result.hasSave,false);
  assert.ok(result.notice.length>0);
  assert.doesNotMatch(result.notice,/private-test-error/);
 }
});

test('保存容量や権限の拒否を通知し、セッション内の状態を変更しない',()=>{
 const state=Object.freeze({stage:'full'});
 for(const name of ['QuotaExceededError','SecurityError','Error']){
  const storage={setItem(){throw Object.assign(new Error('private-test-error'),{name});}};
  const result=saveProgress(storage,state);
  assert.equal(result.ok,false);
  assert.match(result.notice,/保存/);
  assert.doesNotMatch(result.notice,/private-test-error/);
  if(name==='QuotaExceededError')assert.match(result.notice,/容量/);
  assert.deepEqual(state,{stage:'full'});
 }
 for(const storage of [null,undefined,{}, {setItem:false}])assert.equal(saveProgress(storage,state).ok,false);
});

test('不正なセッション状態を保存せず、既存の正しい進行を保つ',()=>{
 const storage=memoryStorage();
 saveProgress(storage,{stage:'empty'});
 const previous=storage.getItem(PROGRESS_KEY);
 for(const state of [null,[],{},'full',{stage:2},{stage:'future'},{stage:'toString'},Object.create({stage:'full'})]){
  const result=saveProgress(storage,state);
  assert.equal(result.ok,false);
  assert.ok(result.notice.length>0);
  assert.equal(storage.getItem(PROGRESS_KEY),previous);
 }
});
