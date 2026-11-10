// Load the shipped modules (including real actors/Character/UpperRig) against bundled Three.
// Only module specifiers/import.meta.url change in this Node harness; no runtime dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { speedStep } from '../dist/valley/loco.js';
const base = new URL('../dist/valley/', import.meta.url), memo = new Map();
function moduleURL(url) {
  if (memo.has(url.href)) return memo.get(url.href);
  let s = fs.readFileSync(url, 'utf8');
  s = s.replace(/from '([^']+)'/g, (all, name) => {
    if (name === 'three') return `from '${new URL('../vendor/three.module.min.js', base).href}'`;
    let next;
    if (name.startsWith('three/addons/')) next = new URL('../vendor/' + name.slice(13), base);
    else if (name.startsWith('.')) next = new URL(name, url);
    else return all;
    if (next.href === url.href) return all; // BufferGeometryUtils has a self-import in a documentation example.
    return `from '${moduleURL(next)}'`;
  });
  s = s.replace(/import\('([^']+)'\)/g, (all, name) => {
    if (name === 'three') return `import('${new URL('../vendor/three.module.min.js', base).href}')`;
    if (name.startsWith('.')) return `import('${moduleURL(new URL(name, url))}')`;
    return all;
  });
  s = s.replace(/import.meta.url/g, JSON.stringify(url.href));
  s += '\n//# sourceURL=hero-life-node/' + url.pathname.split('/').at(-1);
  const result = 'data:text/javascript;base64,' + Buffer.from(s).toString('base64'); memo.set(url.href, result); return result;
}
const load = name => import(moduleURL(new URL(name, base)));
const { createKamakuraHeroLife, HERO_CLOTH } = await load('kamakura-hero-life-view.js');
const { SPEED, HeroActor, configureLoco } = await load('actors.js');
const { Character } = await load('characters.js');
const { UpperRig } = await load('upper-rig.js');

function fixture(search = '?debug=1') {
  const scene = new THREE.Scene(), root = new THREE.Group(), model = new THREE.Group(), bones = new Map(); root.add(model); scene.add(root);
  const bone = (name, parent, x, y, z) => { const b = new THREE.Bone(); b.name = name; b.position.set(x, y, z); parent.add(b); bones.set(name, b); return b; };
  const hips = bone('Hips', model, 0, .9, 0), spine = bone('Spine', hips, 0, .11, 0), s1 = bone('Spine01', spine, 0, .11, 0), s2 = bone('Spine02', s1, 0, .11, 0), neck = bone('neck', s2, 0, .08, 0);
  bone('Head', neck, 0, .07, 0);
  for (const side of ['Left', 'Right']) {
    const sign = side === 'Left' ? 1 : -1;
    const arm = bone(side + 'Arm', s2, .16 * sign, 0, 0), fore = bone(side + 'ForeArm', arm, .12 * sign, -.25, 0); bone(side + 'Hand', fore, 0, -.23, 0);
    const up = bone(side + 'UpLeg', hips, .09 * sign, -.07, 0), leg = bone(side + 'Leg', up, 0, -.36, 0); bone(side + 'Foot', leg, 0, -.35, .03);
  }
  const skeleton = new THREE.Skeleton([...bones.values()]);
  const ch = Object.create(Character.prototype);
  Object.assign(ch, { root, model, bones, height: 1.7, cinePose: null, legs: null, upper: null, flinch: { x: 0, v: 0 }, armRelax: false,
    spreadCapDeg: 0, spreadW: 0, currentName: 'Idle', locoName: 'Idle', gait: 'idle', style: 'relaxed', rate: 1, current: null, legTerrain: null,
    roster: { meta: { clips: {} } }, locomote(v) { this.currentName = this.locoName = 'Idle'; this.gait = v > .3 ? 'run' : 'idle'; } });
  const hero = Object.create(HeroActor.prototype);
  Object.assign(hero, { character: ch, pos: { x: 0, y: 0, z: 0 }, yaw: 0, speed: 0, locoV: 0, locoA: 0, locoSt: { v: 0, a: 0 },
    fighter: { alive: true, state: 'idle', blocking: false }, slideWant: 0, steepT: 0, scripted: false,
    step(dx, dz) { this.pos = { x: this.pos.x + dx, y: this.pos.y, z: this.pos.z + dz }; return { blocked: null }; } });
  Object.defineProperty(hero, 'guardStance', { value: false });
  const input = { edge: false, sprint: false, wasPressed(code) { return code === 'KeyC' && this.edge; }, down(code) { return this.sprint && code === 'ShiftLeft'; } };
  const hints = [], flight = { active: false }, terrain = { heightAt: () => 0 }, context = { hero, scene, terrain, keys: input, flight, search, quality: 'standard', game: { hud: { hint: (...a) => hints.push(a) } } };
  const frame = { dt: 1 / 60, time: 0, wind: 1, windDir: [1, 0], flying: false };
  function tick(layer, dt = 1 / 60) {
    ch.legIk = true; ch.legTerrain = terrain;
    layer?.beforeHero(dt); ch.upper?.undo();
    frame.dt = dt; frame.time += dt;
    ch.finishPose(dt);
    root.position.set(hero.pos.x, hero.pos.y, hero.pos.z);
    layer?.update(frame); input.edge = false;
  }
  return { context, ch, hero, input, hints, flight, frame, tick, scene, skeleton, bones };
}

test('600 poses undo exactly without accumulation; hips/legs/arms stay untouched; allocations/buffers stay fixed', async t => {
  const f = fixture(), layer = await createKamakuraHeroLife(f.context);
  let maxUndo = 0, geometry, position, normal, material;
  const protectedBones = ['Hips', 'LeftUpLeg', 'LeftArm', 'LeftHand'].map(n => f.bones.get(n));
  for (let i = 0; i < 600; i++) {
    layer.beforeHero(1 / 60);
    for (const b of f.bones.values()) { maxUndo = Math.max(maxUndo, Math.abs(b.quaternion.x), Math.abs(b.quaternion.y), Math.abs(b.quaternion.z), Math.abs(b.quaternion.w - 1)); }
    f.ch.legIk = false; f.ch.cinePose(f.ch); layer.update(f.frame);
    for (const b of protectedBones) assert(b.quaternion.equals(new THREE.Quaternion()));
    const mesh = f.scene.getObjectByName('kamakura-hero-cloth');
    if (!geometry) { geometry = mesh.geometry; position = geometry.attributes.position.array; normal = geometry.attributes.normal.array; material = mesh.material; }
    assert.equal(mesh.geometry, geometry); assert.equal(geometry.attributes.position.array, position); assert.equal(geometry.attributes.normal.array, normal); assert.equal(mesh.material, material);
  }
  assert(maxUndo < 1e-14); assert.equal(geometry.attributes.position.count, 68); assert.equal(geometry.index.count / 3, 58);
  const stats = globalThis.__kzHeroLife(); assert(!stats.cloth.nan && stats.cloth.maxStretch < .03);
  let gd = 0, md = 0; geometry.addEventListener('dispose', () => gd++); material.addEventListener('dispose', () => md++);
  layer.dispose(); layer.dispose(); assert.equal(gd, 1); assert.equal(md, 1); assert.equal(f.ch.cinePose, null); assert.equal(globalThis.__kzHeroLife, undefined);
  assert.equal(f.scene.getObjectByName('kamakura-hero-cloth'), undefined);
  for (const b of f.bones.values()) assert(b.quaternion.equals(new THREE.Quaternion()));
  t.diagnostic(`600 frames: undo error ${maxUndo}, 68 vertices/58 triangles/1 mesh; final stretch ${(stats.cloth.maxStretch * 100).toFixed(4)}%`);
});

test('flags: herolife=0 returns null; cloth=0 has no mesh; band/sash use two strips; debug shapes released once', async () => {
  const off = fixture('?herolife=0'); assert.equal(createKamakuraHeroLife(off.context), null); assert.equal(off.ch.cinePose, null);
  for (const [flag, vertices] of [['0', 0], ['band', 36], ['sash', 32]]) {
    const f = fixture('?cloth=' + flag), layer = await createKamakuraHeroLife(f.context); f.tick(layer);
    const mesh = f.scene.getObjectByName('kamakura-hero-cloth'); assert.equal(mesh?.geometry.attributes.position.count || 0, vertices); layer.dispose();
  }
  const f = fixture('?herodebug=1'), layer = await createKamakuraHeroLife(f.context); f.tick(layer);
  const lines = f.scene.getObjectByName('kamakura-hero-cloth-debug'); assert(lines.geometry.drawRange.count > 400 && lines.geometry.drawRange.count <= 800);
  assert(lines.geometry.attributes.position.array.every(Number.isFinite));
  let gd = 0, md = 0; lines.geometry.addEventListener('dispose', () => gd++); lines.material.addEventListener('dispose', () => md++);
  layer.dispose(); layer.dispose(); assert.equal(gd, 1); assert.equal(md, 1);
});

test('C toggles only walk, restores custom speed/dispose, ignores flight/pause, and shows hints', async () => {
  const f = fixture(), layer = await createKamakuraHeroLife(f.context), original = SPEED.walk, sprint = SPEED.sprint;
  // Boot configures the speed table AFTER constructing layers. Capture it when C is actually used.
  SPEED.walk = 3.25;
  try {
    f.input.edge = true; layer.beforeHero(.016); assert.equal(SPEED.walk, 1.35); assert(globalThis.__kzHeroLife().stroll); assert.equal(SPEED.sprint, sprint);
    layer.beforeHero(.016); assert.equal(SPEED.walk, 3.25); // explicit second edge supplied by harness
    f.input.edge = false; layer.beforeHero(.016); assert.equal(f.hints.length, 2);
    f.flight.active = true; f.input.edge = true; layer.beforeHero(.016); assert.equal(SPEED.walk, 3.25);
    f.flight.active = false; layer.setPaused(true); layer.beforeHero(.016); assert.equal(SPEED.walk, 3.25);
    layer.setPaused(false); layer.beforeHero(.016); assert.equal(SPEED.walk, 1.35);
    layer.dispose(); assert.equal(SPEED.walk, 3.25); assert.equal(f.ch.cinePose, null);
  } finally { layer.dispose(); SPEED.walk = original; }
});

test('walk speed transitions through the existing speedStep continuously, without a position jump', async t => {
  const s = { v: 3, a: 0 }; let position = 0, delta = 0;
  for (const target of [1.35, 3]) for (let i = 0; i < 120; i++) {
    const v = s.v, oldPosition = position; position += speedStep(s, target, 1 / 60);
    delta = Math.max(delta, Math.abs(v - s.v)); assert(position >= oldPosition && position - oldPosition <= .051);
  }
  assert(Math.abs(s.v - 3) < 1e-10 && delta < .28); t.diagnostic(`max speed change ${delta.toFixed(5)}m/s/frame at 60Hz`);
});

test('real HeroActor locomotion positions match herolife=0 exactly unless C is used; real M3 stays active', async t => {
  configureLoco('');
  const run = async enabled => {
    const f = fixture(enabled ? '?debug=1' : '?herolife=0'), layer = await createKamakuraHeroLife(f.context), positions = [];
    f.ch.upper = new UpperRig(f.ch); assert(f.ch.upper.ok);
    const ctl = { input: f.input, axis: { active: true }, moveYaw: 0 }; let m3 = 0;
    for (let i = 0; i < 600; i++) {
      f.ch.legIk = true; f.ch.legTerrain = f.context.terrain;
      layer?.beforeHero(1 / 60); f.ch.upper.undo();
      ctl.axis.active = i >= 120 && i < 480; f.input.sprint = i >= 240 && i < 360; ctl.moveYaw = i < 300 ? 0 : .4;
      f.hero.updateLocomotionSmooth(1 / 60, ctl);
      f.ch.root.position.set(f.hero.pos.x, 0, f.hero.pos.z); f.ch.finishPose(1 / 60);
      f.frame.time = i / 60; layer?.update(f.frame);
      if (i === 300) m3 = f.ch.upper.last.w;
      positions.push(f.hero.pos.x, f.hero.pos.z, f.hero.speed);
    }
    layer?.dispose(); return { positions, m3 };
  };
  const a = await run(false), b = await run(true); assert.equal(a.positions.length, b.positions.length);
  for (let i = 0; i < a.positions.length; i++) assert.equal(a.positions[i], b.positions[i], `position/speed component ${i}`);
  assert(a.m3 > .99 && b.m3 > .99); assert.equal(a.m3, b.m3);
  t.diagnostic(`600 real HeroActor frames: all ${a.positions.length} position/speed components identical; M3 weight ${b.m3}`);
});

test('scripted/dead/actions, external cinePose, pause and resume preserve ownership and frozen bones', async () => {
  const f = fixture(), layer = await createKamakuraHeroLife(f.context);
  f.tick(layer); layer.setPaused(true);
  for (const b of f.bones.values()) assert(b.quaternion.equals(new THREE.Quaternion()));
  const before = globalThis.__kzHeroLife().breath; f.tick(layer); assert.equal(globalThis.__kzHeroLife().breath, before);
  layer.setPaused(false);
  for (const mode of ['scripted', 'dead', 'attack']) {
    f.hero.scripted = mode === 'scripted'; f.hero.fighter.alive = mode !== 'dead'; f.hero.fighter.state = mode === 'attack' ? 'attack' : 'idle';
    f.tick(layer); for (const b of f.bones.values()) assert(b.quaternion.equals(new THREE.Quaternion()));
  }
  let calls = 0; const external = () => calls++; f.ch.cinePose = external;
  f.tick(layer); assert.equal(calls, 1); assert.equal(f.ch.cinePose, external);
  layer.dispose(); assert.equal(f.ch.cinePose, external);
});

test('light/adaptation/reduced motion remain finite with cloth visible, including long frames and root jumps', async () => {
  for (const reducedMotion of [false, true]) {
    const f = fixture(), layer = await createKamakuraHeroLife(f.context, { reducedMotion });
    f.context.quality = 'light'; layer.setAdapt(3);
    for (let i = 0; i < 120; i++) { if (i === 60) f.hero.pos.x += 5; f.tick(layer, .1); }
    const stats = globalThis.__kzHeroLife(); assert(!stats.cloth.nan && stats.cloth.maxStretch < .03);
    assert(f.scene.getObjectByName('kamakura-hero-cloth').visible);
    if (reducedMotion) assert.equal(stats.look, 0);
    layer.dispose();
  }
});

test('hot paths do not create arrays/objects/vectors; only debugText/stats snapshots allocate on request', async () => {
  for (const name of ['kamakura-hero-life.js', 'kamakura-hero-life-view.js']) {
    const src = fs.readFileSync(new URL(name, base), 'utf8');
    const sections = name.endsWith('-view.js') ? [src.slice(src.indexOf('function undo()'), src.indexOf('// UpperRig')), src.slice(src.indexOf('function worldPoint'), src.indexOf('const stats =')), src.slice(src.indexOf('beforeHero(dt)'), src.indexOf('debugText()'))] :
      [src.slice(src.indexOf('export function stepHeroLife'), src.indexOf('export function createClothChain')), src.slice(src.indexOf('export function resetCloth'))];
    for (const s of sections) assert(!/\bnew\s|\.map\(|\.slice\(|\.filter\(|\.toArray\(/.test(s), name);
  }
  assert(HERO_CLOTH.band.length >= .38 && HERO_CLOTH.band.length <= .5); assert.equal(HERO_CLOTH.sash.length, .30);   // the fit is tuned on the real model
});
