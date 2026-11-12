import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as THREE from '../dist/vendor/three.module.min.js';
import { LAMPS as C,validateLights,lampsEnabled,lampsPolicy,lampFarWeight,selectLampHouses,lampLayout } from '../dist/valley/kamakura-lamps.js';
import { createKamakuraLamps,LAMPS_VERTEX,LAMPS_FRAGMENT,LAMPS_ART } from '../dist/valley/kamakura-lamps-view.js';
import { validateMeta } from '../dist/valley/kamakura-data.js';
import { KAMAKURA_TIMES } from '../dist/valley/kamakura-atmosphere.js';
import { propGeometry } from '../dist/valley/kamakura-props-kit.js';
import { fixture } from './helpers/kamakura-fixture.mjs';
function context(count=700,quality='standard',search='?time=evening&debug=1') {
  const instances=[],boxes=[],kinds=new Map([[0,{node:'町屋'}],[1,{node:'蔵'}],[2,{node:'塀'}],[3,{node:'門'}],[4,{node:'小家'}],[5,{node:'屋敷'}]]);
  for(let i=0;i<count;i++) {
    const x=i%35*8,z=Math.floor(i/35)*10,m=new THREE.Matrix4().makeTranslation(x,2,z).toArray();
    instances.push({id:i,kind:0,matrix:m,grounded:m});boxes.push({id:'house-'+i,x,z,w:6,d:5,height:4,rotY:i%4*Math.PI/2});
  }
  return {quality,search,houses:{boxes},data:{meta:{lights:{rate:1}},houses:{instances,kinds}},terrain:{heightAt:(x,z)=>2+x*.01+z*.02},scene:new THREE.Scene(),camera:new THREE.PerspectiveCamera()};
}
const selected=c=>selectLampHouses(c.houses.boxes,c.data.houses,c.data.meta.lights,c.data.meta.fires);
const frame=c=>({camera:c.camera,dt:1/60});
function balanced(s) {const stack=[];for(const ch of s){if('({['.includes(ch))stack.push(ch);if(')}]'.includes(ch))assert.equal(stack.pop(),'({['[')}]'.indexOf(ch)]);}assert.equal(stack.length,0);}
function expand(s){return s.replace(/#include <(\w+)>/g,(_,key)=>expand(THREE.ShaderChunk[key]??assert.fail('missing hook '+key)));}

test('lights validation: optional, inclusive rate limits, strict types and meta wiring',()=>{
  assert.equal(validateLights(undefined),null);
  for(const rate of [0,.35,1])assert.equal(validateLights({rate}).rate,rate);
  for(const value of [null,0,[],{},true,{rate:'1'},{rate:NaN},{rate:Infinity},{rate:-.01},{rate:1.01}])assert.throws(()=>validateLights(value));
  const f=fixture({width:3,height:3});f.meta.lights={rate:.5};assert.equal(validateMeta(f.meta),f.meta);f.meta.lights.rate=2;assert.throws(()=>validateMeta(f.meta));
});
test('house choice is proportional, stable under input order, includes additions and excludes stores, walls, gates and fires',()=>{
  const c=context(700),all=selected(c);assert.equal(all.length,700);
  c.data.meta.lights.rate=.4;const partial=selected(c);assert(partial.length>230&&partial.length<330);assert.deepEqual(partial,selected(c));
  c.houses.boxes.reverse();assert.deepEqual(partial,selected(c));
  for(let i=0;i<3;i++)c.data.houses.instances[i].kind=i+1;
  c.data.houses.instances[3].kind=4;c.data.houses.instances[4].kind=5;c.data.meta.lights.rate=1;
  c.data.meta.fires=[{x:40,y:0,radius_m:4}];const on=selected(c),ids=new Set(on.map(h=>h.id));
  for(const i of [0,1,2,5])assert(!ids.has('house-'+i));for(const i of [3,4,699])assert(ids.has('house-'+i));
  assert(on.every(h=>Math.hypot(h.x-40,h.z)>4));
});
test('front openings sit 3cm beyond local +z at every yaw; pools follow terrain',()=>{
  const c=context(4);
  for(const h of selected(c)) {
    const layout=lampLayout(h,c.terrain),cs=Math.cos(h.yaw),sn=Math.sin(h.yaw);assert.equal(layout.openings.length,3);
    for(const o of layout.openings){const localZ=(o.x-h.x)*sn+(o.z-h.z)*cs;assert(Math.abs(localZ-h.d/2-.03)<1e-8);assert(o.y>h.y);}
    assert.equal(layout.openings[0].w,.9);assert.equal(layout.openings[0].h,1.7);assert.equal(layout.pool.y,c.terrain.heightAt(layout.pool.x,layout.pool.z)+C.groundOffset);
  }
  assert.equal(lampLayout({...selected(c)[0],w:4},c.terrain).openings.length,2);
  assert.throws(()=>lampLayout(selected(c)[0],{heightAt:()=>NaN}));
});
test('time and flags: evening/dusk only, absent/rate zero null; dawn and noon stay inactive',()=>{
  for(const time of ['evening','dusk'])assert(lampsEnabled('',time,{rate:1}));
  for(const time of ['morning','noon','golden'])assert(!lampsEnabled('',time,{rate:1}));
  for(const flag of ['lamps=0','layers=0'])assert.equal(createKamakuraLamps(context(10,'standard','?time=evening&'+flag)),null);
  for(const time of ['morning','noon','golden'])assert.equal(createKamakuraLamps(context(10,'standard','?time='+time)),null);
  const c=context();c.data.meta.lights={rate:0};assert.equal(createKamakuraLamps(c),null);delete c.data.meta.lights;assert.equal(createKamakuraLamps(c),null);
  // Exercise the future dusk name without changing the atmosphere module in this change.
  const existing=KAMAKURA_TIMES.dusk;
  try {KAMAKURA_TIMES.dusk??=KAMAKURA_TIMES.evening;const dusk=context(10,'standard','?time=dusk');const l=createKamakuraLamps(dusk);assert(l);l.dispose();}
  finally {if(existing===undefined)delete KAMAKURA_TIMES.dusk;}
});
test('distance transition is continuous, complementary and visible at 450m',()=>{
  // Openings stay true shapes out to the overlook's distances (a hamlet 150m away showed no light as 3-pixel points).
  assert(C.blendStart>=200&&C.blendEnd<=400&&C.blendEnd>C.blendStart);assert.equal(lampFarWeight(C.blendStart),0);assert.equal(lampFarWeight((C.blendStart+C.blendEnd)/2),.5);assert.equal(lampFarWeight(C.blendEnd),1);
  let last=0;
  for(let d=99;d<141;d+=.05){const far=lampFarWeight(d);assert(far>=last);assert(far-last<.003);assert.equal(1-far+far,1);last=far;}
  const c=context(),l=createKamakuraLamps(c);c.camera.position.set(0,450,0);l.update(frame(c));const info=globalThis.__kzLamps();assert(info.points>0);assert.equal(info.openings,0);assert(info.nearest.distance>140);l.dispose();
});
test('quality stages cap houses, remove spill at 2 and keep only points at 3; three draws maximum',t=>{
  const report=[];
  for(const quality of ['standard','light']) {
    const c=context(700,quality),l=createKamakuraLamps(c);assert(l);const group=c.scene.children[0];assert.equal(group.children.length,3);
    for(let step=0;step<4;step++) {l.setAdapt(step);l.update(frame(c));const info=globalThis.__kzLamps(),policy=lampsPolicy(quality,step);assert.equal(info.houses,policy.limit);assert(info.draws<=3);assert.equal(group.children[1].visible,step<2);assert.equal(group.children[0].visible,step<3);report.push({quality,step,...info});}
    l.dispose();
  }
  t.diagnostic(JSON.stringify(report.map(({quality,step,houses,triangles,draws,work})=>({quality,step,houses,triangles,draws,work}))));
});
test('geometry uses the existing lantern color, ground vertices fit terrain and per-house flicker phases differ',()=>{
  const c=context(20),l=createKamakuraLamps(c),[open,pool,dots]=c.scene.children[0].children,g=propGeometry('glow');
  assert.deepEqual(LAMPS_ART.color,[g.attributes.color.getX(0),g.attributes.color.getY(0),g.attributes.color.getZ(0)]);g.dispose();
  assert(new Set(open.geometry.attributes.aPhase.array).size>1);assert(C.frequency<=.8);
  const p=pool.geometry.attributes.position;for(let i=0;i<p.count;i++)assert(Math.abs(p.getY(i)-c.terrain.heightAt(p.getX(i),p.getZ(i))-C.groundOffset)<1e-5);
  assert.equal(dots.geometry.attributes.position.count,20);assert.equal(pool.material.blending,THREE.AdditiveBlending);l.dispose();
});
test('debug masks, paused clock, repeated update with stable buffers, nearest and exact disposal',()=>{
  const c=context(20,'standard','?time=evening&debug=1&lampsdebug=1'),l=createKamakuraLamps(c),group=c.scene.children[0],counts=new Map();
  for(const m of group.children)for(const r of [m.geometry,m.material]){counts.set(r,0);r.addEventListener('dispose',()=>counts.set(r,counts.get(r)+1));}
  const shared=group.children[0].material.uniforms.uTime,buffer=group.children[0].geometry.attributes.position;
  l.update(frame(c));const first=shared.value;l.setPaused(true);l.update(frame(c));assert.equal(shared.value,first);l.setPaused(false);
  for(let i=0;i<1000;i++)l.update(frame(c));assert.equal(group.children[0].geometry.attributes.position,buffer);assert(shared.value>first);
  for(const m of group.children){assert.equal(m.material.uniforms.uDebug.value,1);assert.equal(m.material.toneMapped,false);}
  const info=globalThis.__kzLamps();assert(info.nearest.distance>=0&&info.nearest.bearing>=0&&info.nearest.bearing<360);assert.equal(info.work.matrixWrites,0);assert.equal(info.work.terrainTests,0);
  l.dispose();l.dispose();l.setAdapt(0);assert.equal(c.scene.children.length,0);assert.equal(globalThis.__kzLamps,undefined);for(const n of counts.values())assert.equal(n,1);
});
test('GLSL: balanced brackets, available include hooks, no reserved tokens, float literals and all identifiers declared',()=>{
  const chunks=LAMPS_VERTEX+'\n'+LAMPS_FRAGMENT;balanced(expand(chunks));
  assert.doesNotMatch(chunks,/--\d|\b(?:input|output|sample|filter|half|fixed)\b/);
  const code=chunks.replace(/^\s*#.*$/gm,'');assert.doesNotMatch(code,/(?<![\w.])\d+(?![\w.])/);
  const declared=new Set([...code.matchAll(/\b(?:vec[234]|float)\s+(\w+)/g)].map(m=>m[1]));for(const m of code.matchAll(/(?:uniform|varying|attribute)\s+\w+\s+([^;]+);/g))for(const name of m[1].split(','))declared.add(name.trim());
  const known=new Set(['uniform','attribute','varying','void','main','float','vec2','vec3','vec4','distance','smoothstep','sin','pow','max','abs','length','mix','if','discard','uv','position','projectionMatrix','modelViewMatrix','gl_Position','gl_PointSize','gl_PointCoord','gl_FragColor']);
  for(const m of code.matchAll(/\b[A-Za-z_]\w*\b/g))if(code[m.index-1]!=='.')assert(known.has(m[0])||declared.has(m[0]),'undeclared '+m[0]);
  assert.match(LAMPS_VERTEX,new RegExp('gl_PointSize='+C.pixels.toFixed(1).replace('.','\\.')));assert.match(LAMPS_FRAGMENT,/smoothstep/);
});
test('steady frame path allocates no arrays, objects, closures or matrices',async()=>{
  const source=await fs.readFile(new URL('../dist/valley/kamakura-lamps-view.js',import.meta.url),'utf8'),part=source.slice(source.indexOf('    update(frame)'),source.indexOf('    setAdapt(value)'));
  assert.doesNotMatch(part,/\bnew\b|=>|\.map\(|\.filter\(|\.slice\(|\.clone\(|=\s*\[|=\s*\{/);
});
