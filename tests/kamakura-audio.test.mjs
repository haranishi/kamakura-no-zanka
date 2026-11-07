import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createKamakuraAudio } from '../dist/valley/kamakura-audio-view.js';
import { FakeContext, Button, flush } from './helpers/kamakura-audio.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { surfaceWeights } from '../dist/valley/kamakura-surface.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { pickStep, distanceRule } from '../dist/valley/audio-rules.js';
import { roleOf, gaitOfClip, stepSurfaceAt } from '../dist/valley/step-surface.js';
import { AUDIO_NOISE } from '../dist/valley/config.js';
import * as loco from '../dist/valley/loco.js';
// Same production-method harness as valley-step-wiring; no renderer or GLB doubles needed.
const actorSource = fs.readFileSync(new URL('../dist/valley/actors.js',import.meta.url),'utf8').replace(/^import .*;\n/gm,'').replace(/export /g,'');
const names=['LOCO','parseLoco','useLoco','dependents','speedStep','turnRate','turnTargetScale'];
const Actor=new Function('pickStep','distanceRule','roleOf','gaitOfClip','stepSurfaceAt','AUDIO_NOISE',...names,`${actorSource}; return Actor;`)(pickStep,distanceRule,roleOf,gaitOfClip,stepSurfaceAt,AUDIO_NOISE,...names.map(n=>loco[n]));
function setup(options={}) {
  const f=fixture({width:3,height:3,cell:10});f.meta.surface={};f.surface=new Uint8Array(9).fill(2);
  const terrain=createKamakuraTerrain(f),target=new EventTarget(),button=new Button();
  const c=createKamakuraAudio({terrain,target,button,storage:()=>null,...options});
  const g={terrain};c.attach(g);
  const hero=Object.assign(Object.create(Actor.prototype),{game:g,who:'hero',pos:{x:0,z:0},stepGait:'walk'});g.hero=hero;
  return {c,target,button,hero,terrain};
}
const contact={foot:'left',clip:'Casual_Walk'};
const emit=(target,type)=>target.dispatchEvent(new Event(type));
async function withAudio(fn,Context=FakeContext) {
  const old=globalThis.AudioContext;globalThis.AudioContext=Context;
  try {await fn();} finally {globalThis.AudioContext=old;}
}
test('gesture-only unlock, real hero contact, correct surface and cumulative successful steps',()=>withAudio(async()=>{
  for(const gesture of ['pointerup','touchend','click','keydown']) {
    const {c,target,hero,terrain}=setup();
    hero.onFootContact(contact);c.update(.1,hero.pos);
    assert.equal(c.audio.context,null);assert.equal(c.state.steps,0);assert.match(c.debugText(),/未解錠/);
    emit(target,gesture);await flush();const ctx=c.audio.context;
    assert.equal(ctx.state,'running');assert.equal(c.state.ambient,true);
    hero.onFootContact(contact);assert.equal(hero.lastStep.recipe.surface,'grass');assert.equal(c.state.steps,1);
    assert.match(c.debugText(),/解錠済・足音1・環境音on/);
    const surfaces=['gravel','water','grass','leaves','dirt','stone','gravel','water','dirt'];
    for(const [i,code]of [0,1,2,3,4,5,6,7,255].entries()) {
      terrain.surfaceAt=()=>surfaceWeights(code);hero.onFootContact(contact);
      assert.equal(hero.lastStep.recipe.surface,surfaces[i]);
    }
    terrain.waterAt=()=>.5;hero.onFootContact(contact);assert.equal(hero.lastStep.recipe.surface,'water');
    assert.equal(c.state.steps,11);
    emit(target,'touchend');await flush();assert.equal(c.audio.context,ctx);
    c.dispose();assert.equal(ctx.closes,1);
  }
}));
test('pause, mute, persistence, flight suppression, 28-voice cap and disposed event cleanup',()=>withAudio(async()=>{
  let flying=false;const saved=new Map();
  const {c,target,button,hero}=setup({flying:()=>flying,storage:()=>({getItem:k=>saved.get(k),setItem:(k,v)=>saved.set(k,v)})});
  emit(target,'keydown');await flush();hero.onFootContact(contact);
  const loops=[...c.audio.ambient.values()].map(v=>v.source);
  for(let i=0;i<60;i++)c.update(1/60,hero.pos);
  assert.deepEqual([...c.audio.ambient.values()].map(v=>v.source),loops,'updates do not recreate ambient');
  c.setPaused(true);assert.equal(c.audio.sources.size,0);assert.equal(c.audio.ambient.size,0);
  hero.onFootContact(contact);assert.equal(c.state.steps,1);await flush();assert.equal(c.audio.context.state,'suspended');
  c.setPaused(false);await flush();emit(button,'click');await flush();assert(c.audio.muted);
  hero.onFootContact(contact);assert.equal(c.state.steps,1);assert.deepEqual([...saved.values()],['1']);
  emit(button,'click');await flush();assert(!c.audio.muted);assert.equal(button.attributes['aria-pressed'],'true');
  flying=true;hero.onFootContact(contact);assert.equal(c.state.steps,1);flying=false;
  for(let i=0;i<29;i++)hero.onFootContact(contact);
  assert.equal(c.audio.sources.size,28);assert.equal(c.state.steps,29);
  const ctx=c.audio.context;c.dispose();c.dispose();assert.equal(ctx.state,'closed');assert.equal(ctx.closes,1);
  assert.equal(c.audio.sources.size,0);assert.equal(c.audio.ambient.size,0);assert(ctx.nodes.every(n=>n.connections.length===0));
  emit(button,'click');emit(target,'keydown');hero.onFootContact(contact);await flush();assert.equal(ctx.state,'closed');assert.equal(c.state.steps,29);
}));
test('listener updates at 10Hz, skips pause and uses supplied camera location in flight',()=>withAudio(async()=>{
  const {c,target,hero,terrain}=setup({flying:()=>true});
  const calls=[];terrain.riverDistanceAt=(x,z)=>{calls.push([x,z]);return 3;};
  emit(target,'keydown');await flush();
  for(let i=0;i<600;i++)c.update(1/60,{x:100,z:200});
  assert.equal(calls.length,100);assert(calls.every(([x,z])=>x===100&&z===200));assert.equal(c.state.river,3);assert.equal(c.audio.listener.fire,Infinity);
  hero.onFootContact(contact);assert.equal(c.state.steps,0);
  c.setPaused(true);for(let i=0;i<60;i++)c.update(1/60,hero.pos);assert.equal(calls.length,100);
  c.dispose();
}));
test('audio=0 allocates no audio context; initial mute overrides storage; storage exceptions are harmless',()=>withAudio(async()=>{
  const {c,target,button,hero}=setup({search:'?audio=0'});emit(target,'keydown');emit(button,'click');hero.onFootContact(contact);c.update(1,hero.pos);await flush();
  assert.equal(c.audio.context,undefined);assert.equal(c.state.enabled,false);assert(button.disabled);assert.equal(c.debugText(),'音：無効');c.dispose();
  for(const search of ['?mute=1','']) {
    const s=setup({search,storage:()=>({getItem:()=> '1',setItem:()=>{throw Error();}})});
    emit(s.target,'touchend');await flush();assert(s.c.audio.muted);assert.equal(s.c.audio.ambient.size,0);
    emit(s.button,'click');await flush();assert(!s.c.audio.muted);s.c.dispose();
  }
  const s=setup({storage:()=>{throw Error();}});emit(s.button,'click');s.c.dispose();
}));
test('unavailable audio reports once, preserves contact path and respects pause during unlock',async()=>{
  await withAudio(async()=>{
    const messages=[];const {c,target,hero}=setup({onUnavailable:m=>messages.push(m)});
    emit(target,'keydown');await flush();hero.onFootContact(contact);assert.equal(messages.length,1);assert.equal(c.state.steps,0);assert.match(c.debugText(),/利用不可/);c.dispose();
  },null);
  await withAudio(async()=>{
    const {c,target}=setup();emit(target,'pointerup');c.setPaused(true);await flush();assert(c.audio.paused);assert.equal(c.audio.context.state,'suspended');c.dispose();
  });
});
test('dispose during pending resume cannot recreate ambient or context',()=>withAudio(async()=>{
  const {c,target}=setup();emit(target,'keydown');const ctx=c.audio.context;c.dispose();await flush();
  assert.equal(ctx.state,'closed');assert.equal(ctx.closes,1);assert.equal(c.audio.ambient.size,0);
}));
