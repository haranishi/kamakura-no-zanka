import test from 'node:test';
import assert from 'node:assert/strict';
import {initialState,transition,objectiveFor,inventoryFor} from '../dist/gameplay.js';

test('水運びを一周し、目的と一枠の所持が各段階に一致する',()=>{
 let state=initialState();
 assert.deepEqual(state,{stage:'bucket'});
 assert.match(objectiveFor(state),/桶.*拾/);
 assert.equal(inventoryFor(state),'なし');
 for(const [action,stage,inventory,objective] of [
  ['pickup','empty','空の桶',/井戸.*水/],
  ['fill','full','水入りの桶',/庭.*届/],
  ['deliver','delivered','なし',/届け|届き|散策/]
 ]){
  const previous={...state};
  const result=transition(state,action);
  assert.equal(result.changed,true);
  assert.deepEqual(result.state,{stage});
  assert.deepEqual(state,previous,'入力状態を直接変更しない');
  assert.equal(inventoryFor(result.state),inventory);
  assert.match(objectiveFor(result.state),objective);
  assert.equal(typeof result.notice,'string');
  state=result.state;
 }
});

test('不正順序、未知の操作、同じ入力の再実行は進行を変えない',()=>{
 const allowed={bucket:'pickup',empty:'fill',full:'deliver'};
 for(const stage of ['bucket','empty','full','delivered']){
  for(const action of ['pickup','fill','deliver','reset','toString',null,{},undefined]){
   const before=Object.freeze({stage});
   const result=transition(before,action);
   if(typeof allowed[stage]==='string'&&allowed[stage]===action){
    assert.equal(result.changed,true);
    assert.equal(transition(result.state,action).changed,false,'二重実行を拒否する');
   }else{
    assert.equal(result.changed,false,`${stage} / ${String(action)}`);
    assert.deepEqual(result.state,{stage});
   }
  }
 }
});

test('壊れた状態は安全な初期状態へ戻り、操作は発火しない',()=>{
 for(const state of [null,[],{},'empty',{stage:'future'},{stage:1},{stage:'toString'},Object.create({stage:'empty'})]){
  const result=transition(state,'pickup');
  assert.equal(result.changed,false);
  assert.deepEqual(result.state,{stage:'bucket'});
  assert.equal(typeof objectiveFor(state),'string');
  assert.equal(inventoryFor(state),'なし');
 }
});

test('やり直し用の初期状態は別オブジェクトであり、前回の進行を引き継がない',()=>{
 const first=initialState();first.stage='full';
 assert.deepEqual(initialState(),{stage:'bucket'});
});
