import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import {fixture,load,DT} from './kamakura-hero-move-harness.test.mjs';
const {createKamakuraHeroGear,measureHeroWaist,HERO_GEAR:C}=await load('kamakura-hero-gear.js');
const v=()=>new THREE.Vector3();

test('K3 actual hero: fittings, empty hand area, <=700 triangles/3 meshes, parenting, flags and disposal',async t=>{
  const f=await fixture('?cloth=0&gear=0');
  assert.equal(createKamakuraHeroGear(f.ch,{search:'?gear=0'}),null);
  assert.equal(createKamakuraHeroGear(f.ch,{search:'?heromove=0'}),null);
  const g=createKamakuraHeroGear(f.ch);assert(g);
  assert.equal(g.parts.filter(p=>p.kind==='foot').length,2);assert.equal(g.parts.filter(p=>p.kind==='ring').length,2);
  assert.equal(g.parts.filter(p=>p.kind==='middle').length,1);assert.equal(g.parts.filter(p=>p.kind==='butt').length,1);
  assert.equal(g.meshes.length,3);assert(g.triangles<=700);
  assert.equal(g.meshes[0].parent,f.ch.weapons.tachiHip.holder);assert.equal(g.meshes[2].parent,f.ch.weapons.tachiHip.holder);
  assert.equal(g.meshes[1].parent,f.ch.bone('Hips'));
  for(const p of g.parts.filter(p=>p.kind==='foot'||p.kind==='middle'))assert(Math.abs(p.y-C.hold)-p.width/2>=C.holdClearance);
  for(const m of g.meshes)assert(m.castShadow&&m.receiveShadow);
  let geometries=0,materials=0,textures=0;
  for(const m of g.meshes){m.geometry.addEventListener('dispose',()=>geometries++);m.material.addEventListener('dispose',()=>materials++);m.material.map?.addEventListener('dispose',()=>textures++);}
  const arrays=g.meshes.map(m=>m.geometry.attributes.position.array), cloneV=THREE.Vector3.prototype.clone,cloneQ=THREE.Quaternion.prototype.clone;
  let clones=0;THREE.Vector3.prototype.clone=function(){clones++;return cloneV.call(this);};THREE.Quaternion.prototype.clone=function(){clones++;return cloneQ.call(this);};
  try{for(let i=0;i<1000;i++)g.update();assert.equal(clones,0);}finally{THREE.Vector3.prototype.clone=cloneV;THREE.Quaternion.prototype.clone=cloneQ;}
  for(let i=0;i<3;i++)assert.equal(g.meshes[i].geometry.attributes.position.array,arrays[i]);
  t.diagnostic(JSON.stringify({triangles:g.triangles,draws:g.meshes.length,parts:g.parts,straps:g.straps.map(s=>s.length),updates:1000,strapVerticesPerUpdate:72,clones}));
  g.dispose();g.dispose();assert.equal(geometries,3);assert.equal(materials,3);assert.equal(textures,1);
  for(const m of g.meshes)assert.equal(m.parent,null);assert.equal(g.knot.parent,null);f.close();
});

test('K3 front foot clears the actual skinned left hand holding LEFT_HOLD',async t=>{
  const f=await fixture();for(let i=0;i<240;i++)f.step(0);
  const mesh=f.ch.hands.mesh,sk=mesh.skeleton,geo=mesh.geometry,skin=geo.attributes.skinIndex,weight=geo.attributes.skinWeight;
  sk.update();const inverse=f.ch.weapons.tachiHip.holder.matrixWorld.clone().invert(),point=v();let maxY=-Infinity,vertices=0;
  for(let i=0;i<geo.attributes.position.count;i++){
    let w=0;for(let k=0;k<4;k++){const name=sk.bones[skin.getComponent(i,k)].name;if(name==='LeftHand_view'||name.startsWith('Left_'))w+=weight.getComponent(i,k);}
    if(w<.5)continue;
    point.fromBufferAttribute(geo.attributes.position,i);mesh.applyBoneTransform(i,point);point.applyMatrix4(mesh.matrixWorld).applyMatrix4(inverse);
    maxY=Math.max(maxY,point.y);vertices++;
  }
  const clearance=C.feet[0]-C.bandWidth/2-maxY;assert(vertices>100&&clearance>.002);
  t.diagnostic(JSON.stringify({vertices,handMaxY:maxY,firstBandStart:C.feet[0]-C.bandWidth/2,clearance}));f.close();
});

test('K3 waist ring fits the actual bind-pose triangle surface within 1.5cm',async t=>{
  const f=await fixture('?cloth=0&gear=0'),waist=measureHeroWaist(f.ch),mesh=f.ch.hands.mesh;
  const hi=mesh.skeleton.bones.findIndex(b=>b.name==='Hips'),mat=mesh.skeleton.boneInverses[hi].clone().multiply(mesh.bindMatrix);
  const attr=mesh.geometry.attributes.position,ix=mesh.geometry.index,points=Array.from({length:attr.count},(_,i)=>v().fromBufferAttribute(attr,i).applyMatrix4(mat));
  const triangle=new THREE.Triangle(),closest=v();let max=0,min=Infinity;
  for(const ring of waist.rings)for(const p of ring){
    let distance=Infinity;
    for(let i=0;i<(ix?ix.count:attr.count);i+=3){
      const a=points[ix?ix.getX(i):i],b=points[ix?ix.getX(i+1):i+1],c=points[ix?ix.getX(i+2):i+2];
      if(Math.min(a.y,b.y,c.y)>p.y+.02||Math.max(a.y,b.y,c.y)<p.y-.02)continue;
      triangle.set(a,b,c).closestPointToPoint(p,closest);distance=Math.min(distance,p.distanceTo(closest));
    }
    max=Math.max(max,distance);min=Math.min(min,distance);assert(distance<=.015);
  }
  t.diagnostic(JSON.stringify({waistSamples:waist.rings.length*waist.segments,minDistance:min,maxDistance:max,radialOffset:waist.clearance}));f.close();
});

test('K3 draw/sheathe: metal follows the saya, leather endpoints stay at belt and rings',async t=>{
  const {createSwordLayer}=await load('sword-layer.js'),f=await fixture('?cloth=0&gear=0'),g=createKamakuraHeroGear(f.ch),sword=createSwordLayer();
  const local=g.meshes[0].matrix.clone();let movement=0,maxUpperGap=0,maxLowerGap=0,old=v();f.ch.root.updateMatrixWorld(true);g.meshes[0].getWorldPosition(old);
  sword.requestDraw();
  for(let i=0;i<240;i++){
    if(i===120)sword.requestSheathe();const frame=sword.tick(DT);f.ch.sword.setFrame(frame);f.ch.weapons.tachiDrawn.holder.visible=frame.u>0;
    f.hero.fighter.state=frame.u>0&&frame.u<1?'attack':'idle';f.step(0,frame.mode==='drawing'?'Katana_Draw_v2':frame.mode==='sheathing'?'Katana_Sheathe':null);g.update();
    assert(g.meshes[0].matrix.equals(local));const at=g.meshes[0].getWorldPosition(v());movement=Math.max(movement,old.distanceTo(at));
    const positions=g.meshes[1].geometry.attributes.position,first=positions.count-72;
    for(let j=0;j<2;j++){
      const lower=g.straps[j].lower.clone().applyMatrix4(f.ch.weapons.tachiHip.holder.matrixWorld).applyMatrix4(f.ch.bone('Hips').matrixWorld.clone().invert());
      const axis=g.straps[j].upper.clone().sub(lower).normalize();let lo=Infinity,hi=-Infinity;
      for(let k=0;k<36;k++){const d=v().fromBufferAttribute(positions,first+j*36+k).sub(lower).dot(axis);lo=Math.min(lo,d);hi=Math.max(hi,d);}
      maxLowerGap=Math.max(maxLowerGap,Math.abs(lo));maxUpperGap=Math.max(maxUpperGap,Math.abs(hi-g.straps[j].length));
    }
  }
  assert(movement>.01);assert(maxUpperGap<1e-5&&maxLowerGap<1e-5);
  t.diagnostic(JSON.stringify({maxUpperGap,maxLowerGap,movement}));g.dispose();f.close();
});

test('K3 debug colours separate metal/rings, wrap, leather, waist and tails; hot code creates no scratch objects',async()=>{
  const f=await fixture('?debug=1&geardebug=1'),m=f.scene.getObjectByName('kamakura-hero-metal'),strap=f.scene.getObjectByName('kamakura-hero-straps'),wrap=f.scene.getObjectByName('kamakura-hero-wrap');
  assert(m&&strap&&wrap);assert.equal(wrap.material.map,null);
  const unique=mesh=>new Set(Array.from({length:mesh.geometry.attributes.color.count},(_,i)=>[0,1,2].map(k=>mesh.geometry.attributes.color.array[i*3+k].toFixed(3)).join(',')));
  assert(unique(m).size>=3);assert(unique(strap).size>=3);assert(f.scene.getObjectByName('kamakura-hero-cloth').material.color.getHex()===0xff2277);
  const src=fs.readFileSync(new URL('../dist/valley/kamakura-hero-gear.js',import.meta.url),'utf8'),hot=src.slice(src.indexOf('  function update()'),src.indexOf('  update();'));
  assert(!/\bnew\s|\.map\(|\.slice\(|\.filter\(|\.clone\(/.test(hot));f.close();
});
