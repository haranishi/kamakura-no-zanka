// Load the shipped modules (including real actors/Character/UpperRig) against bundled Three.
// Only module specifiers/import.meta.url change in this Node harness; no runtime dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { pearson } from '../tools/lib/upper-metrics.mjs';
import { HERO_MOVE, heroLean, heroMoveTarget } from '../dist/valley/kamakura-hero-move.js';
import { baseline, fixture, load, DT } from './kamakura-hero-move-harness.test.mjs';
const { UPPER_ENV } = await load('upper-rig.js');
const base = new URL('../dist/valley/', import.meta.url), D = 180 / Math.PI, v = () => new THREE.Vector3();
const speeds = [0, 1.35, 2.5, 5];
function summarize(rows) {
  const out = {};
  for (const key of ['lean', 'head', 'up', 'shoulderUp', 'fwd', 'right', 'elbow', 'spread', ...(rows[0].carryLeft === undefined ? [] : ['leftGap', 'gripGap', 'elbowDropL', 'armSpreadL'])]) {
    const xs = rows.map(r => r[key]); out[key] = [Math.min(...xs), xs.reduce((a,b) => a+b,0) / xs.length, Math.max(...xs)].map(n => +n.toFixed(4));
  }
  return out;
}
test('shipped hero and clips: three full cycles per steady gait', async t => {
  for (const speed of speeds) {
    const f = await fixture();
    for (let i = 0; i < 240; i++) f.step(speed);
    const ch = f.ch, count = Math.ceil(3 * ch.current.getClip().duration / (Math.abs(ch.current.timeScale) || 1) / DT), rows = [];
    for (let i = 0; i < count; i++) rows.push(f.step(speed));
    const s = summarize(rows);
    const sync = pearson(rows.map(r=>r.thigh), rows.map(r=>r.fwd));
    t.diagnostic(JSON.stringify({ speed, clip: ch.currentName, frames: count, sync, ...s }));
    if (!baseline) {
      const range = HERO_MOVE.leanRange[speeds.indexOf(speed)];
      assert(s.lean[1] >= range[0] && s.lean[1] <= range[1]);
      assert(s.head[1] >= -8 && s.head[1] <= 2 && s.head[2] <= 6);
      assert(s.spread[2] <= (speed <= 1.35 ? 12 : 18));
      assert(s.armSpreadL[2] <= (speed <= 1.35 ? 12 : 18));
      assert(s.elbowDropL[0] >= .15);
      assert(s.gripGap[2] <= .02); // Grip centre only: literal wrist gap is reported, not passed off as compliant.
      if (speed > 1.35) {
        assert(s.up[0] >= .03 && s.shoulderUp[2] <= -.22);
        assert(s.fwd[0] >= -.14 && s.fwd[2] <= .24);
        assert(s.fwd[2] - s.fwd[0] >= (speed > 2.5 ? .18 : .12));
        assert(s.right[0] >= .09 && s.right[2] <= .26);
        assert(s.elbow[0] >= (speed > 2.5 ? 75 : 80) && s.elbow[2] <= (speed > 2.5 ? 115 : 125));
        assert(sync > .9);
      }
      const target = speed > 1.35 ? HERO_MOVE.fist : HERO_MOVE.rest;
      for (let k=0;k<12;k++) assert(Math.abs(ch.hands.sides.Right.curl[k] - target[k%3]) < .001);
      assert.equal(ch.hands.sides.Left.gSaya, 1);
    }
    f.close();
  }
});

test('no settings: all bone quaternions and call sequence match git HEAD for 600 frames', async t => {
  const a = await fixture('?herolife=0', true), b = await fixture('?herolife=0', false);
  const ba = [], bb = [], ca = [], cb = [];
  a.ch.model.traverse(o => { if (o.isBone) ba.push(o); }); b.ch.model.traverse(o => { if (o.isBone) bb.push(o); });
  assert.equal(ba.length, bb.length);
  for (const [f, calls] of [[a, ca], [b, cb]]) for (const key of ['upper', 'sword', 'hands']) {
    const rig = f.ch[key], fn = rig.apply; rig.apply = function (...args) { calls.push(key); return fn.apply(this, args); };
  }
  const sword=(await load('sword-layer.js')).createSwordLayer();
  let components = 0;
  for (let i = 0; i < 600; i++) {
    const speed = i < 90 ? 0 : i < 200 ? 1.35 : i < 350 ? 2.5 : i < 500 ? 5 : 0;
    if(i===300)sword.requestDraw();if(i===500)sword.requestSheathe();
    const frame=sword.tick(DT),name=frame.mode==='drawing'?'Katana_Draw_v2':frame.mode==='sheathing'?'Katana_Sheathe':i>=390&&i<435?'Katana_Kesa_Cut':null;
    for (const f of [a,b]) { f.ch.sword.setFrame(frame);f.ch.weapons.tachiDrawn.holder.visible=frame.u>0;f.hero.fighter.state=name?'attack':'idle';f.ch.root.rotation.y = i < 400 ? .2 : -.4; f.step(speed,name); }
    for (let j = 0; j < ba.length; j++) for (const c of ['x','y','z','w']) { assert(Object.is(ba[j].quaternion[c], bb[j].quaternion[c]), `${i}/${ba[j].name}/${c}`); components++; }
    assert(!Object.hasOwn(b.ch.upper, 'style')); assert(!Object.hasOwn(b.ch.hands, 'rest'));
  }
  assert.deepEqual(ca, cb); t.diagnostic(`${ba.length} bones, ${components} quaternion components, ${cb.length} calls identical to git HEAD`);
  a.close(); b.close();
});

test('heromove=0, settings ownership and dispose remove the debug function', async () => {
  const off = await fixture('?heromove=0&debug=1&cloth=0'); assert(!off.ch.upper.style && !off.ch.hands.rest); off.close();
  const f = await fixture(); assert(f.ch.upper.style && f.ch.hands.rest); assert.equal(typeof globalThis.__kzHeroMove, 'function');
  for (let i=0;i<60;i++) f.step(2.5);
  f.layer.dispose(); f.layer.dispose(); assert(!Object.hasOwn(f.ch.upper, 'style')); assert(!Object.hasOwn(f.ch.hands, 'rest')); assert.equal(globalThis.__kzHeroMove, undefined); f.close();
});

test('60Hz transitions preserve grips; report the unresolved drawn-wrist jump separately', async t => {
  const { createSwordLayer } = await load('sword-layer.js');
  const f = await fixture(), sword = createSwordLayer();
  let prev = null, maxR = 0, maxL = 0, maxFreeR = 0, wasDrawn = false, carryBefore = 0, carryAfter = 0, gripErrorR = 0;
  for (let i=0;i<900;i++) {
    let speed = i < 120 ? 0 : i < 240 ? 2.5 : i < 360 ? 5 : 0;
    if (i === 480) { carryBefore = f.ch.hands.sides.Left.gSaya; sword.requestDraw(); }
    if (i === 660) sword.requestSheathe();
    const frame = sword.tick(DT); f.ch.sword.setFrame(frame);
    f.ch.weapons.tachiDrawn.holder.visible = frame.u > 0;
    const name = frame.mode === 'drawing' ? 'Katana_Draw_v2' : frame.mode === 'sheathing' ? 'Katana_Sheathe' : i >= 560 && i < 600 ? 'Katana_Kesa_Cut' : null;
    f.hero.fighter.state = name ? 'attack' : 'idle';
    const row = f.step(speed, name);
    if (prev && i > 90) { if (!wasDrawn && !f.ch.weapons.tachiDrawn.holder.visible) maxFreeR = Math.max(maxFreeR, Math.hypot(...row.hand.map((x,k)=>x-prev.hand[k] - (k===2 ? speed * DT : 0)))); maxR = Math.max(maxR, Math.hypot(...row.hand.map((x,k)=>x-prev.hand[k] - (k===2 ? speed * DT : 0)))); maxL = Math.max(maxL, Math.hypot(...row.left.map((x,k)=>x-prev.left[k] - (k===2 ? speed * DT : 0)))); }
    if (i===481) carryAfter = f.ch.hands.sides.Left.gSaya;
    if (f.ch.hands.sides.Right.g > .99) gripErrorR = Math.max(gripErrorR, f.ch.hands.sides.Right.vis[2].getWorldPosition(v()).distanceTo(f.ch.hands.sides.Right.target.pos));
    wasDrawn = f.ch.weapons.tachiDrawn.holder.visible; prev=row;
  }
  t.diagnostic(JSON.stringify({ maxR, maxFreeR, maxL, gripErrorR, carryBefore, carryAfter, finalCarry:f.ch.hands.sides.Left.gSaya }));
  assert(gripErrorR < .002); assert(maxFreeR<=.04 && maxL<=.04); assert(carryBefore>.99 && carryAfter>.5); assert(f.ch.hands.sides.Left.gSaya>.99);
  f.close();
});

test('pure speed targets are continuous; reduce affects lean/swing amplitude, not grip', async t => {
  const out = {};
  for (const speed of speeds) assert(Math.abs(heroLean(speed - 1e-5) - heroLean(speed + 1e-5)) < 1e-3);
  const normal = heroMoveTarget(out, 5, 30, 0, true, false).arm;
  const reduced = heroMoveTarget(out, 5, 30, 0, true, true).arm;
  assert(Math.abs(reduced + 35) < Math.abs(normal + 35) * .36);
  const f = await fixture();
  try {
    UPPER_ENV.reduce = true;
    for (let i=0;i<240;i++) f.step(5);
    const d = f.ch.upper.style.measure();
    assert(d.lean > 4 && d.lean < 7); assert.equal(d.carryLeft, 1);
    for (let k=0;k<12;k++) assert(Math.abs(d.curlR[k]-HERO_MOVE.fist[k%3])<.001);
    t.diagnostic(`reduce: measured lean ${d.lean.toFixed(3)} degrees, carry ${d.carryLeft}`);
  } finally { UPPER_ENV.reduce = false; f.close(); }
});

test('bow, dodge, guard and external poses release carry; pause preserves state', async () => {
  const f = await fixture();
  for (const mode of ['bow','dodge','guard','cinematic']) {
    for (let i=0;i<120;i++) f.step(0);
    assert.equal(f.ch.hands.sides.Left.gSaya,1);
    if (mode === 'bow') f.ch.weapons.yumi = { holder: { visible: true } };
    else if (mode === 'guard') f.hero.fighter.blocking = true;
    else if (mode === 'cinematic') f.ch.cinePose = () => {};
    else f.hero.fighter.state = 'dodge';
    for (let i=0;i<120;i++) f.step(0);
    assert.equal(f.ch.hands.sides.Left.gSaya,0, mode);
    delete f.ch.weapons.yumi; f.hero.fighter.state = 'idle'; f.hero.fighter.blocking = false; f.ch.cinePose = null;
  }
  f.layer.setPaused(true); const w=f.ch.upper.style.weight; f.step(5); assert.equal(f.ch.upper.style.weight,w);
  f.layer.setPaused(false); f.close();
});

test('1,000 hot frames reuse every scratch object and clone no vectors/quaternions', async t => {
  const f=await fixture(); for(let i=0;i<180;i++) f.step(2.5);
  const rig=f.ch.upper.style, entries=Object.entries(rig), vc=THREE.Vector3.prototype.clone, qc=THREE.Quaternion.prototype.clone;
  let clones=0, solves=0, rotations=0;
  const solve=rig.solve, rot=rig.rot;
  rig.solve=function(arm,fore,hand,goal,hint){solves++;return solve.call(this,arm,fore,hand,goal,hint);};
  rig.rot=function(bone,axis,angle){rotations++;return rot.call(this,bone,axis,angle);};
  THREE.Vector3.prototype.clone=function(){clones++;return vc.call(this);};
  THREE.Quaternion.prototype.clone=function(){clones++;return qc.call(this);};
  try {
    for(let i=0;i<1000;i++){rig.undo();rig.apply(DT);f.ch.hands.apply(DT);}
    for(const [key,value] of entries) if(value && typeof value==='object') assert.equal(rig[key],value,key);
    assert.equal(clones,0);
  } finally { THREE.Vector3.prototype.clone=vc;THREE.Quaternion.prototype.clone=qc;f.close(); }
  const src=fs.readFileSync(new URL('upper-rig.js',base),'utf8'), hot=src.slice(src.indexOf('  undo() {',src.indexOf('export class HeroMoveRig')),src.indexOf('  measure() {',src.indexOf('export class HeroMoveRig')));
  assert(!/\bnew\s|\.map\(|\.slice\(|\.filter\(|\.clone\(/.test(hot));
  t.diagnostic(`1000 frames: scratch identities fixed, clones ${clones}, pose IK solves ${solves}, rotations ${rotations}; added meshes/triangles/draws 0/0/0`);
});

test('heromove=0 matches the git HEAD disabled layer on real bones for 600 frames', async () => {
  const a=await fixture('?debug=1&heromove=0',true), b=await fixture('?debug=1&heromove=0',false);
  const aa=[],bb=[];a.ch.model.traverse(o=>{if(o.isBone)aa.push(o);});b.ch.model.traverse(o=>{if(o.isBone)bb.push(o);});
  for(let i=0;i<600;i++){
    const speed=speeds[Math.floor(i/150)];a.step(speed);b.step(speed);
    for(let j=0;j<aa.length;j++)for(const key of ['x','y','z','w'])assert(Object.is(aa[j].quaternion[key],bb[j].quaternion[key]),`${i}/${aa[j].name}/${key}`);
    const av=a.scene.getObjectByName('kamakura-hero-cloth').geometry.attributes.position.array,bv=b.scene.getObjectByName('kamakura-hero-cloth').geometry.attributes.position.array;
    assert.deepEqual(av,bv);assert.equal(b.scene.getObjectByName('kamakura-hero-metal'),undefined);
  }
  a.close();b.close();
});
