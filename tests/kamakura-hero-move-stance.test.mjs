import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from '../dist/vendor/three.module.min.js';
import { fixture, load, DT } from './kamakura-hero-move-harness.test.mjs';
import { HERO_STANCE as C } from '../dist/valley/kamakura-hero-move.js';
const range = (rows, fn) => { const a = rows.map(fn); return [Math.min(...a), Math.max(...a)]; };
const inside = (a, lo, hi) => assert(a[0] >= lo - 1e-5 && a[1] <= hi + 1e-5, `${a} outside ${lo}…${hi}`);
const v = () => new THREE.Vector3();

test('K1 shipped guard idle/walk: three cycles, actual pommel/tip/elbows/grip and breathing', async t => {
  for (const speed of [0, 1.35]) {
    const f = await fixture(); f.ch.setTachi({}, true);
    for (let i=0;i<240;i++) f.step(speed);
    const count = Math.ceil(3 * f.ch.current.getClip().duration / f.ch.current.timeScale / DT), rows=[];
    for (let i=0;i<count;i++) rows.push(f.step(speed));
    const g = fn => range(rows, r=>fn(r.guard));
    inside(g(r=>r.pommel.fwd), .18,.26); inside(g(r=>r.pommel.right),-.04,.04); inside(g(r=>r.pommel.up),.02,.12);
    inside(g(r=>r.tip.height),1.30,1.50); inside(g(r=>r.tip.yawDeg),-10,10);
    assert(g(r=>r.elbowDropL)[0]>=.15); assert(g(r=>r.elbowDropR)[0]>=.15); assert(g(r=>r.leftReachGap)[1]<=.02);
    for (const side of ['Left','Right']) {
      const a=f.ch.hands.sides[side].vis; const arm=a[0].getWorldPosition(v()), elbow=a[1].getWorldPosition(v());
      assert(Math.atan2(Math.abs(elbow.x-arm.x), arm.y-elbow.y)*180/Math.PI<=35);
    }
    assert(f.ch.hands.sides.Left.g2>.99);
    inside(range(rows,r=>r.armSpreadL),0,35); inside(range(rows,r=>r.armSpreadR),0,35);
    for(let i=0;i<120;i++)f.step(0);
    const heights=[];for(let i=0;i<420;i++)heights.push(f.step(0).guard.tip.height);
    const amplitude=Math.max(...heights)-Math.min(...heights); assert(amplitude>=.01&&amplitude<=.02);
    const peaks=[]; let armed=false; const mid=(Math.max(...heights)+Math.min(...heights))/2; for(let i=0;i<heights.length;i++){if(heights[i]<mid-.002)armed=true;if(armed&&heights[i]>mid+.002){peaks.push(i);armed=false;}}
    assert(peaks.length>=2); inside([(peaks[1]-peaks[0])*DT,(peaks[1]-peaks[0])*DT],3,4);
    // Report this literal requirement as unmet: an elevated blade's perpendicular edge
    // cannot point more vertically than its pitch. Do not disguise it as a passing angle.
    const edge = g(r=>r.edgeDownDeg);
    t.diagnostic(JSON.stringify({speed,frames:count,pommelFwd:g(r=>r.pommel.fwd),pommelRight:g(r=>r.pommel.right),pommelUp:g(r=>r.pommel.up),tip:g(r=>r.tip.height),yaw:g(r=>r.tip.yawDeg),edgeDownDeg:edge,elbowL:g(r=>r.elbowDropL),elbowR:g(r=>r.elbowDropR),leftReach:g(r=>r.leftReachGap),breath:amplitude,period:C.period,edge20Compliant:edge[1]<=20}));
    f.close();
  }
});

test('K2 drawn jog/run: three cycles, quiet rearward blade, saya grip, stop in .3s', async t => {
  for(const speed of [2.5,5]){
    const f=await fixture();f.ch.setTachi({},true);for(let i=0;i<240;i++)f.step(speed);
    const count=Math.ceil(3*f.ch.current.getClip().duration/f.ch.current.timeScale/DT),rows=[];
    for(let i=0;i<count;i++)rows.push(f.step(speed));
    const g=fn=>range(rows,r=>fn(r.carry));
    inside(g(r=>r.wrist.right),.20,.30);inside(g(r=>r.wrist.fwd),-.05,.10);inside(g(r=>r.wrist.up),-.05,.10);
    inside(g(r=>r.tipPitchDeg),-40,-15);inside(g(r=>r.tipYawDeg),-25,0);
    const tip=g(r=>r.tipHeight);assert(tip[0]>=.15&&tip[1]-tip[0]<=.12);
    assert(f.ch.hands.sides.Left.g2<.001&&f.ch.hands.sides.Left.gSaya>.99);assert(f.ch.hands.sides.Left.last.error<=.02);
    for(let i=0;i<18;i++)f.step(0);
    assert(f.ch.upper.style.guardWeight>.999&&f.ch.upper.style.carryWeight<.001);
    t.diagnostic(JSON.stringify({speed,frames:count,wristRight:g(r=>r.wrist.right),wristFwd:g(r=>r.wrist.fwd),wristUp:g(r=>r.wrist.up),pitch:g(r=>r.tipPitchDeg),yaw:g(r=>r.tipYawDeg),tip,stopGuard:f.ch.upper.style.guardWeight}));
    f.close();
  }
});

test('K1/K2 60Hz draw, three cuts, heavy, dodge, block, guard, carry and sheathe: measure transitions', async t => {
  const {createSwordLayer}=await load('sword-layer.js'), f=await fixture(), sword=createSwordLayer();
  const sections=[['idle',120],['draw',60],['idle',90],['Katana_Kesa_Cut',40],['Katana_Gyakukesa_Cut',40],['Katana_Yokonagi_Cut',40],['idle',90],['Katana_Karatake_Heavy',60],['Roll_Dodge',55],['Two_Handed_Parry',40],['idle',90],['jog',120],['run',120],['idle',90],['sheathe',60],['idle',120]];
  let previous=null,maxTransition=0,maxLeftReach=0,maxGrip=0,frames=0,previousTag='',maxFrame=null;
  for(const [tag,count]of sections){
    if(tag==='draw')sword.requestDraw();if(tag==='sheathe')sword.requestSheathe();
    for(let i=0;i<count;i++){
      const frame=sword.tick(DT);f.ch.sword.setFrame(frame);f.ch.weapons.tachiDrawn.holder.visible=frame.u>0;
      const name=frame.mode==='drawing'?'Katana_Draw_v2':frame.mode==='sheathing'?'Katana_Sheathe':tag.includes('_')?tag:null;
      f.hero.fighter.state=name?'attack':'idle';f.hero.fighter.blocking=tag==='Two_Handed_Parry';
      const row=f.step(tag==='jog'?2.5:tag==='run'?5:0,name),point=f.ch.root.worldToLocal(f.ch.hands.sides.Right.vis[2].getWorldPosition(v()));
      const transition=(!name&&i<18)||(name&&i<8&&row.guard.w+row.carry.w>0)||frame.mode==='sheathing'||(frame.mode==='drawing'&&frame.u>.90);
      if(previous&&transition){const d=point.distanceTo(previous);if(d>maxTransition){maxTransition=d;maxFrame={tag,i,u:frame.u,previousTag};}}
      if(row.guard.w>.999)maxLeftReach=Math.max(maxLeftReach,row.guard.leftReachGap);
      if(f.ch.hands.sides.Right.g>.99)maxGrip=Math.max(maxGrip,f.ch.hands.sides.Right.vis[2].getWorldPosition(v()).distanceTo(f.ch.hands.sides.Right.target.pos));
      previous=point;previousTag=tag;frames++;
    }
  }
  t.diagnostic(JSON.stringify({frames,maxTransition,maxFrame,maxLeftReach,maxGrip,finalSaya:f.ch.hands.sides.Left.gSaya}));
  assert(maxTransition<=.06);assert(maxLeftReach<=.02);assert(maxGrip<=.02);assert(f.ch.hands.sides.Left.gSaya>.99);f.close();
});

test('K4 actual hero: default two tails, band opt-in, idle/run tilt and time-varying gust',async t=>{
  for(const [flag,count]of [['',2],['&cloth=band',2],['&cloth=all',4]]){
    const f=await fixture('?debug=1'+flag);f.frame.wind=1;
    let min=Infinity,max=-Infinity,idleMax=0,runMax=0;
    for(let i=0;i<600;i++){
      f.step(i<300?0:5);const stats=globalThis.__kzHeroMove().cloth;assert.equal(stats.count,count);
      if(!flag){const tilt=Math.max(...stats.tiltDeg);if(i>=240&&i<300){idleMax=Math.max(idleMax,tilt);min=Math.min(min,tilt);max=Math.max(max,tilt);}if(i>=300)runMax=Math.max(runMax,tilt);}
    }
    if(!flag){assert(idleMax<=20.01);assert(runMax<=60.01);assert(max-min>.05);t.diagnostic(JSON.stringify({count,idleMax,runMax,gustVariation:max-min}));}
    f.close();
  }
});

test('K1/K2 hot stance frames keep scratch storage and grip connection, no clones',async t=>{
  const f=await fixture();f.ch.setTachi({},true);for(let i=0;i<180;i++)f.step(5);
  const rig=f.ch.upper.style,refs=Object.entries(rig).filter(([,v])=>v&&typeof v==='object');
  const vc=THREE.Vector3.prototype.clone,qc=THREE.Quaternion.prototype.clone;let clones=0,solves=0;
  const solve=rig.solve;rig.solve=function(a,b,c,g,h){solves++;return solve.call(this,a,b,c,g,h);};
  THREE.Vector3.prototype.clone=function(){clones++;return vc.call(this);};THREE.Quaternion.prototype.clone=function(){clones++;return qc.call(this);};
  try{for(let i=0;i<1000;i++){rig.undo();rig.apply(DT);f.ch.hands.apply(DT);}for(const[k,v]of refs)assert.equal(rig[k],v);assert.equal(clones,0);}
  finally{THREE.Vector3.prototype.clone=vc;THREE.Quaternion.prototype.clone=qc;}
  t.diagnostic(JSON.stringify({frames:1000,solves,clones,guardWeight:rig.guardWeight,carryWeight:rig.carryWeight}));f.close();
});

test('K1 normal/fast/walking/reversed draw keeps the original saya curve and full grips',async t=>{
  const {createSwordLayer}=await load('sword-layer.js'), results=[];
  for(const reference of [true,false]){
    let maxAxis=0,maxGrip=0;
    for(const mode of ['normal','fast','walking','reverse']){
      const f=await fixture('?debug=1&cloth=0',reference),sword=createSwordLayer();for(let i=0;i<120;i++)f.step(mode==='walking'?1.35:0);sword.requestDraw({fast:mode==='fast'});
      for(let i=0;i<240;i++){
        if(i===90)sword.requestSheathe();if(mode==='reverse'&&i===100)sword.requestDraw();
        const frame=sword.tick(DT);f.ch.sword.setFrame(frame);f.ch.weapons.tachiDrawn.holder.visible=frame.u>0;
        f.hero.fighter.state=frame.u>0&&frame.u<1?'attack':'idle';f.step(mode==='walking'?1.35:0,frame.mode==='drawing'?'Katana_Draw_v2':frame.mode==='sheathing'?'Katana_Sheathe':null);
        if(frame.u>0&&frame.u<1&&frame.pose.handBlend<=0){
          const expected=f.ch.sword.swordOnAxis(frame.pose.s).elements,actual=f.ch.weapons.tachiDrawn.holder.matrixWorld.elements;
          for(let j=0;j<16;j++)maxAxis=Math.max(maxAxis,Math.abs(expected[j]-actual[j]));
        }
        if(f.ch.hands.sides.Right.g>.99)maxGrip=Math.max(maxGrip,f.ch.hands.sides.Right.vis[2].getWorldPosition(v()).distanceTo(f.ch.hands.sides.Right.target.pos));
      }
      f.close();
    }
    results.push({reference,maxAxis,maxGrip});assert(maxGrip<.02);
  }
  // Compare TRS decomposition's tiny shear residual to the unchanged shipped path.
  // A newly invented 1e-5 matrix threshold rejected the old implementation as well.
  assert(results[1].maxAxis<=results[0].maxAxis+1e-8);t.diagnostic(JSON.stringify(results));
});
