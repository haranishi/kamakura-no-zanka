// Real shipped rigs + the real Character, rendered nowhere. No image decoder, server or new dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { performance } from 'node:perf_hooks';
import * as THREE from '../dist/vendor/three.module.min.js';
import { parseGlb, buildGlb } from '../tools/lib/glb.mjs';
import { createKamakuraPeople, travellerBindings, createTravellerEquipment, releaseTravellerEquipment } from '../dist/valley/kamakura-people-view.js';
import { PEOPLE_CLIPS } from '../dist/valley/kamakura-people.js';
import { CROWD, TRAVELLER, travellerTraits } from '../dist/valley/kamakura-crowd.js';
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
test('shipped rigs carry distinct coloured shallow hats, rounded bundles or open baskets and hand-held staffs in one draw', t=>{
  const counts = new Set(), C = TRAVELLER;
  for(const who of templates.keys())for(const variant of [0,1,2,3,4]) {
    const ch = new Character({templates,meta},who), bindings = travellerBindings(ch), p = {variant,staff:true};
    const before = ['Head','Spine','RightHand'].map(n=>ch.bone(n).children.length);
    const mesh = createTravellerEquipment(ch,p,bindings), geometry = mesh.geometry;
    const position = geometry.attributes.position, color = geometry.attributes.color;
    assert(mesh.isSkinnedMesh&&mesh.castShadow&&mesh.receiveShadow);assert(!Array.isArray(mesh.material));assert.equal(geometry.groups.length,0);
    assert(position.count/3<=200);counts.add(position.count/3);
    assert.deepEqual(mesh.skeleton.bones.map(b=>b.parent.name),['Head','Spine','RightHand']);
    for(const part of mesh.userData.parts) {
      const inverse=mesh.skeleton.boneInverses[mesh.userData.parts.indexOf(part)], box=new THREE.Box3();
      const tones=new Set();
      for(let i=part.start;i<part.start+part.count;i++) {
        box.expandByPoint(new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(inverse));
        tones.add(color.getX(i).toFixed(5));
        assert(Math.abs(new THREE.Vector3().fromBufferAttribute(geometry.attributes.normal,i).length()-1)<1e-6);
      }
      const size=box.getSize(new THREE.Vector3());
      if(part.name==='hat') {
        assert(size.x/2>=.24&&size.x/2<=.28);assert(size.y>=.09&&size.y<=.12);assert(tones.size>=3);
        // The crown flattens towards its tip; a steep second cone would still look pointed.
        let shoulder=0;
        for(let i=part.start;i<part.start+part.count;i++){
          const v=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(inverse);
          if(Math.abs(Math.hypot(v.x,v.z)-C.hatCrown)<1e-6)shoulder=Math.max(shoulder,v.y);
        }
        assert(shoulder>0);assert((box.max.y-shoulder)/C.hatCrown<shoulder/(C.hatRadius-C.hatCrown));
        assert(part.count/3>24);
      } else if(part.name==='pack') {
        assert(size.x>=.30&&size.x<=.40);assert(size.z<size.x);assert(tones.size>=3);
        if(!travellerTraits(p).basket)assert(part.count/3>=12&&part.count/3<=20);
        else {
          // No triangle spans the opening at the top; each rim triangle stays on one narrow edge.
          for(let i=part.start;i<part.start+part.count;i+=3){const top=[];for(let j=0;j<3;j++)top.push(new THREE.Vector3().fromBufferAttribute(position,i+j).applyMatrix4(inverse));
            if(top.every(v=>Math.abs(v.y-C.packHeight/2)<1e-6))assert(top.every(v=>Math.abs(v.x)>=C.packSize/2-C.basketWall-1e-6)||top.every(v=>Math.abs(v.z)>=C.packDepth/2-C.basketWall-1e-6));}
        }
      } else {
        assert(Math.max(size.x,size.z)>=.019&&Math.max(size.x,size.z)<=.021);assert(size.y>=1.2&&size.y<=1.35);assert(box.max.y>=.15&&box.max.y<=.25);
      }
    }
    const partColor=name=>{const part=mesh.userData.parts.find(p=>p.name===name);return new THREE.Color().fromBufferAttribute(color,part.start);};
    assert(!partColor('hat').equals(partColor('pack'))&&!partColor('hat').equals(partColor('staff'))&&!partColor('pack').equals(partColor('staff')));
    const expected=new THREE.Color(CROWD.clothes[travellerTraits(p).packCloth]);
    const pack=partColor('pack');assert(Math.abs(pack.r-expected.r)<1e-6&&Math.abs(pack.g-expected.g)<1e-6&&Math.abs(pack.b-expected.b)<1e-6);
    if(variant===0) {
      const at=new THREE.Vector3().setFromMatrixPosition(bindings.find(b=>b.part==='pack').anchor),point=new THREE.Vector3();let back=Infinity;
      ch.model.traverse(o=>{if(o.isMesh)for(let i=0;i<o.geometry.attributes.position.count;i++){o.getVertexPosition(i,point).applyMatrix4(o.matrixWorld);if(Math.abs(point.x-at.x)<.12&&Math.abs(point.y-at.y)<.10)back=Math.min(back,point.z);}});
      const part=mesh.userData.parts.find(p=>p.name==='pack');let face=-Infinity;
      for(let i=part.start;i<part.start+part.count;i++)face=Math.max(face,position.getZ(i));
      const gap=back-face;assert(gap>=.003&&gap<=.012,`${who} back clearance ${gap}`);
      t.diagnostic(`${who} bundle-to-clothing gap ${(gap*1000).toFixed(1)}mm in the bind pose`);
    }
    // Motion, heading, nonuniform model axes and the parent's position/scale all go through real skinning.
    ch.play('Casual_Walk',{restart:true});
    ch.root.position.set(4,2,-7);ch.root.rotation.y=1.2;ch.root.scale.setScalar(.9);
    for(const time of [.1,.3,.7,1.1]) {
      ch.current.time=time;ch.mixer.update(0);ch.root.updateMatrixWorld(true);mesh.skeleton.update();
      for(let k=0;k<mesh.userData.parts.length;k++) {
        const part=mesh.userData.parts[k],mount=mesh.skeleton.bones[k],i=part.start;
        const expected=new THREE.Vector3().fromBufferAttribute(position,i).applyMatrix4(mesh.skeleton.boneInverses[k]).applyMatrix4(mount.matrixWorld);
        const actual=mesh.getVertexPosition(i,new THREE.Vector3()).applyMatrix4(mesh.matrixWorld);
        assert(actual.distanceTo(expected)<1e-6);
      }
    }
    let released=0;geometry.addEventListener('dispose',()=>released++);mesh.material.addEventListener('dispose',()=>released++);
    releaseTravellerEquipment(mesh);assert.equal(released,2);assert(!mesh.parent);assert(mesh.skeleton.bones.every(b=>!b.parent));
    assert.deepEqual(['Head','Spine','RightHand'].map(n=>ch.bone(n).children.length),before);
    const next=createTravellerEquipment(ch,{variant:(variant+1)%5,staff:false},bindings);
    assert.deepEqual(next.userData.parts.map(p=>p.name),['hat','pack']);assert.equal(ch.bone('RightHand').children.length,before[2]);
    releaseTravellerEquipment(next);ch.dispose();
  }
  t.diagnostic(`near equipment: ${[...counts].sort((a,b)=>a-b).join('/')} triangles, 1 main-pass draw per person; Head / Spine / RightHand`);
});

test('missing RightHand omits the staff, and disposal/reuse removes every bone mount',()=>{
  const ch=new Character({templates,meta},'villager_m');ch.bones.delete('RightHand');
  for(let i=0;i<20;i++) {
    const base=[ch.bone('Head').children.length,ch.bone('Spine').children.length];
    const mesh=createTravellerEquipment(ch,{variant:i%5,staff:true});
    assert.deepEqual(mesh.userData.parts.map(p=>p.name),['hat','pack']);assert.equal(mesh.skeleton.bones.length,2);
    releaseTravellerEquipment(mesh);assert.deepEqual([ch.bone('Head').children.length,ch.bone('Spine').children.length],base);
  }
  ch.dispose();
});

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
