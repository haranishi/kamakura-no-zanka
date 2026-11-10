// Real shipped rigs + the real Character, rendered nowhere. No image decoder, server or new dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from '../dist/vendor/three.module.min.js';
import { parseGlb, buildGlb } from '../tools/lib/glb.mjs';
import { createKamakuraPeople } from '../dist/valley/kamakura-people-view.js';
import { PEOPLE_CLIPS } from '../dist/valley/kamakura-people.js';
const base=new URL('../dist/valley/',import.meta.url),memo=new Map();
function moduleURL(url) {
  if(memo.has(url.href))return memo.get(url.href);
  let s=fs.readFileSync(url,'utf8').replace(/from '([^']+)'/g,(all,name)=>{
    if(name==='three')return `from '${new URL('../vendor/three.module.min.js',base).href}'`;
    const next=name.startsWith('three/addons/')?new URL('../vendor/'+name.slice(13),base):name.startsWith('.')?new URL(name,url):null;
    return !next||next.href===url.href?all:`from '${moduleURL(next)}'`;
  }).replace(/import.meta.url/g,JSON.stringify(url.href));
  const out='data:text/javascript;base64,'+Buffer.from(s).toString('base64');memo.set(url.href,out);return out;
}
const {Character}=await import(moduleURL(new URL('characters.js',base)));
const {GLTFLoader}=await import(moduleURL(new URL('../vendor/loaders/GLTFLoader.js',base)));
const meta=JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json',import.meta.url)));
const templates=new Map(),measurements={};
for(const who of ['villager_m','villager_f','child']) {
  const glb=parseGlb(fs.readFileSync(new URL(`../dist/assets/characters/${who}.glb`,import.meta.url)));
  glb.json.materials=(glb.json.materials||[]).map(()=>({}));delete glb.json.images;delete glb.json.textures;
  const buffer=buildGlb(glb),gltf=await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),'');
  const clips=new Map();
  for(const c of gltf.animations) {
    // Match loadRoster's non-loop root stripping, using the real rest position/vertical track.
    if(!meta.clips[c.name]?.loop) for(const track of c.tracks) if(track.name==='Hips.position') {
      for(let i=3;i<track.values.length;i+=3){track.values[i]=track.values[0];track.values[i+2]=track.values[2];}
    }
    clips.set(c.name,c);
  }
  templates.set(who,{scene:gltf.scene,clips,roots:new Map(),info:meta.characters[who]});
  let triangles=0,meshes=0,bones=0;
  gltf.scene.traverse(o=>{if(o.isMesh){meshes++;triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;}if(o.isBone)bones++;});
  measurements[who]={triangles,meshes,bones};
}
test('real three rigs: finite animated poses, measured triangle/draw work, shared templates/skeletons release once', async t=>{
  const scene=new THREE.Scene(),hero={pos:{x:0,y:0,z:0},drawn:false},events={geometry:0,material:0,cloneSkeleton:0,templateSkeleton:0};
  for(const tpl of templates.values())tpl.scene.traverse(o=>{
    if(o.geometry)o.geometry.addEventListener('dispose',()=>events.geometry++);
    if(o.material)o.material.addEventListener('dispose',()=>events.material++);
    if(o.skeleton){const dispose=o.skeleton.dispose.bind(o.skeleton);o.skeleton.dispose=()=>{events.templateSkeleton++;dispose();};}
  });
  const terrain={bounds:{minX:-200,maxX:200,minZ:-200,maxZ:200},heightAt:()=>0,waterAt:()=>0,slopeAt:()=>0,walkable:()=>true};
  let created=0,disposed=0,firstPhaseTime=0;
  class MeasuredCharacter extends Character {
    constructor(...args){const start=performance.now();super(...args);firstPhaseTime=Math.max(firstPhaseTime,performance.now()-start);created++;
      this.model.traverse(o=>{if(o.skeleton){const dispose=o.skeleton.dispose.bind(o.skeleton);o.skeleton.dispose=()=>{events.cloneSkeleton++;dispose();};}});}
    dispose(){disposed++;super.dispose();}
  }
  const layer=createKamakuraPeople({scene,hero,terrain,search:'?debug=1',quality:'standard',data:{},habitat:{at:(x,z,o)=>Object.assign(o,{town:1,forest:0,pass:0,paddy:0,sand:0})}},
    {loadModule:async()=>({Character:MeasuredCharacter,loadRoster:async({names})=>({meta,templates:new Map([[names[0],templates.get(names[0])]])})})});
  const frame={dt:1/60,pos:hero.pos,hero,flying:false};layer.update(frame);layer.update(frame);await new Promise(r=>setImmediate(r));
  for(let i=0;i<100;i++)layer.update(frame);
  const debug=globalThis.__kzPeople();assert.equal(debug.active,10);
  let triangles=0,draws=0;scene.traverse(o=>{if(o.isMesh){triangles+=(o.geometry.index?.count||o.geometry.attributes.position.count)/3;draws++;}});
  const start=performance.now();for(let i=0;i<600;i++)layer.update(frame);const ms=(performance.now()-start)/600;
  scene.updateMatrixWorld(true);scene.traverse(o=>{if(o.isBone)for(const n of o.matrixWorld.elements)assert(Number.isFinite(n));});
  // Exercise every actual rig/clip through the real mixer (not merely metadata names).
  for(const who of templates.keys()) {
    const ch=new MeasuredCharacter({templates,meta},who);
    for(const name of PEOPLE_CLIPS){assert(ch.play(name,{restart:true}));ch.mixer.update(.25);}
    ch.dispose();
  }
  t.diagnostic(`shipped models ${JSON.stringify(measurements)}; synthetic town 10 people ${triangles} triangles, ${draws} main-pass draws, ${debug.boneUpdates} bone ticks before timing; 600-frame Node mean ${ms.toFixed(3)}ms, max Character constructor ${firstPhaseTime.toFixed(3)}ms (not GPU/frame timing)`);
  layer.dispose();layer.dispose();assert.equal(events.geometry,3);assert.equal(events.material,3);assert.equal(created,disposed);assert.equal(events.cloneSkeleton,created);assert.equal(events.templateSkeleton,3);assert.equal(scene.children.length,0);
});
