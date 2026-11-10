// Load the shipped modules (including real actors/Character/UpperRig) against bundled Three.
// Only module specifiers/import.meta.url change in this Node harness; no runtime dependency.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { parseGlb, buildGlb } from '../tools/lib/glb.mjs';
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
  s += '\n//# sourceURL=hero-moves-node/' + url.pathname.split('/').at(-1);
  const result = 'data:text/javascript;base64,' + Buffer.from(s).toString('base64'); memo.set(url.href, result); return result;
}
const load = name => import(moduleURL(new URL(name, base)));
const { createKamakuraHeroMoves } = await load('kamakura-hero-moves.js');
const { HeroActor, configureLoco } = await load('actors.js');
const { buildColliders } = await load('collision.js');
const { createKamakuraHeroLife } = await load('kamakura-hero-life-view.js');
const { mulberry32 } = await load('scatter.js');
const meta = JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json', import.meta.url)));
const DT = 1 / 60;

// Use the shipped rig/skin; omit only image decoding in this Node-only harness.
const { GLTFLoader } = await import(moduleURL(new URL('../vendor/loaders/GLTFLoader.js', base)));
const { prepareHands } = await load('hand-rig.js');
const glb = parseGlb(fs.readFileSync(new URL('../dist/assets/characters/hero.glb', import.meta.url)));
glb.json.materials = (glb.json.materials || []).map(() => ({}));
delete glb.json.images; delete glb.json.textures;
const buffer = buildGlb(glb);
const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
prepareHands(gltf.scene);

function fixture(search = '?debug=1', obstacles = {}) {
  const scene = new THREE.Scene(), model = gltf.scene;
  const clips = new Map();
  // Synthetic motion, real shipped clip names/timing and real mixer/IK/grip/trails.
  for (const [name, info] of Object.entries(meta.clips)) {
    const d = info.seconds || 2;
    clips.set(name, new THREE.AnimationClip(name, d, [new THREE.NumberKeyframeTrack('RightArm.rotation[z]', [0, d * .35, d * .7, d], [0, -2, 2, 0])]));
  }
  const terrain = { bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }, heightAt: () => 0, waterAt: () => 0, slopeAt: () => 0,
    surfaceAt: () => ({ grass: 0, dirt: 1, rock: 0, gravel: 0, mud: 0, litter: 0 }), ...obstacles.terrain };
  const col = buildColliders({ bounds: { minX: -60, maxX: 60, minZ: -60, maxZ: 60 }, ...obstacles.colliders });
  const sounds = [], hints = [], dust = [];
  const g = { scene, terrain, col, roster: { meta, templates: new Map([['hero', { scene: model, clips, roots: new Map(), info: { height: 1.7 } }]]) },
    enemies: [], ally: null, audio: { play: name => sounds.push(name), playStep: () => true }, rng: mulberry32(91),
    world: { buildings: [] }, emitNoise() {}, pan: () => 0, fx: { dust: (p, n) => dust.push(n) }, hud: { hint: (...a) => hints.push(a) } };
  // Only the procedural weapon's 2D texture painter needs a canvas; no browser/rendering.
  const previous = globalThis.document;
  const painter = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
  globalThis.document = { createElement: () => ({ getContext: () => painter }) };
  let hero;
  try { g.hero = hero = new HeroActor(g, { x: 0, z: 0, yaw: 0 }); }
  finally { if (previous) globalThis.document = previous; else delete globalThis.document; }
  const input = { pressed: new Set(), held: new Set(), mouse: new Set(), edges: new Set(),
    wasPressed(code) { return this.pressed.has(code); }, down(code) { return this.held.has(code); },
    mouseWasPressed(b) { return this.edges.has(b); }, mouseDown(b) { return this.mouse.has(b); } };
  const flight = { active: false }, events = new EventTarget(), axis = { active: false, forward: 0, right: 0 };
  const moves = createKamakuraHeroMoves({ game: g, hero, input, flight, search }, { eventTarget: events });
  let maxTriangles = 0;
  function step(layer = null, yaw = 0) {
    moves?.setFlying(flight.active);
    const ch = hero.character;
    ch.splitPose = true; ch.legIk = true; ch.legTerrain = terrain;
    layer?.beforeHero(DT);
    if (moves) moves.update(DT, axis, yaw);
    else {
      hero.updateLocomotion(DT, { input, axis, moveYaw: yaw }, false);
      hero.slideTurn += (hero.slideWant - hero.slideTurn) * (1 - Math.exp(-12 * DT)); hero.slideWant = 0;
      hero.tickCharacter(DT); hero.sync();
    }
    ch.finishPose(); moves?.afterPose();
    const mesh = scene.getObjectByName('slash-trails');
    maxTriangles = Math.max(maxTriangles, (mesh?.geometry.drawRange.count || 0) / 3);
    assert(Number.isFinite(hero.pos.x) && Number.isFinite(hero.pos.y) && Number.isFinite(hero.pos.z));
    input.pressed.clear(); input.edges.clear();
  }
  function frames(n) { for (let i = 0; i < n; i++) step(); }
  return { g, hero, input, flight, moves, axis, scene, events, step, frames, sounds, hints, dust, terrain,
    get maxTriangles() { return maxTriangles; }, close() { moves?.dispose(); hero.remove(); } };
}

test('three chained slashes, heavy, dodge, guard, draw and sheathe complete through real HeroActor/Character', t => {
  configureLoco('');
  const f = fixture(), seen = new Set();
  f.input.edges.add(0); f.step();
  for (let i = 0; i < 180; i++) {
    const m = f.hero.fighter.move;
    if (m) { seen.add(m.id); if (m.phase === 'recover' && m.id !== 'light3') f.input.edges.add(0); }
    f.step();
  }
  assert.deepEqual([...seen], ['light1', 'light2', 'light3']); assert.equal(f.hero.fighter.state, 'idle');
  assert(f.hero.drawn); assert(f.sounds.includes('draw')); assert(f.sounds.includes('swing') && f.sounds.includes('swing_heavy'));
  assert(f.maxTriangles > 0); const trailTriangles = f.maxTriangles;
  f.frames(360); assert.equal(f.hero.drawn, false); assert.equal(f.hero.swordLayer.snapshot().mode, 'sheathed'); assert(f.sounds.includes('sheathe'));
  f.input.pressed.add('KeyF'); f.step(); assert.equal(f.hero.fighter.move.id, 'heavy'); f.frames(180); assert.equal(f.hero.fighter.state, 'idle');
  f.input.pressed.add('Space'); f.step(); assert.equal(f.hero.fighter.state, 'dodge'); f.frames(180); assert.equal(f.hero.fighter.state, 'idle'); assert(f.dust.includes(5)); assert(f.sounds.includes('roll'));
  f.input.mouse.add(2); f.frames(180); assert(f.hero.fighter.blocking); assert(f.hero.drawn); f.input.mouse.clear(); f.frames(180); assert(!f.hero.fighter.blocking); assert.equal(f.hero.fighter.state, 'idle');
  f.frames(360); assert.equal(f.hero.swordLayer.snapshot().mode, 'sheathed');
  t.diagnostic(`combo light1/light2/light3; trail peak ${trailTriangles} triangles, 1 mesh; every action simulated for 180 frames`);
  f.close();
});

test('600-frame old path, moves=0 and no-action enabled path have identical positions and function sequence', async t => {
  for (const search of ['', '?smooth=0']) {
    configureLoco(search);
    const a = fixture('?moves=0'), b = fixture(), positions = [];
    let updates = 0, ticks = 0, syncs = 0;
    const wrap = (hero, name, count) => { const fn = hero[name]; hero[name] = function (...args) { count(); return fn.apply(this, args); }; };
    wrap(a.hero, 'update', () => updates++); wrap(a.hero, 'tickCharacter', () => ticks++); wrap(a.hero, 'sync', () => syncs++);
    assert.equal(a.moves, null); assert.equal(a.scene.getObjectByName('slash-trails'), undefined);
    for (let i = 0; i < 600; i++) {
      a.axis.active = b.axis.active = i >= 60 && i < 540 && i % 110 < 85;
      for (const f of [a, b]) { if (i >= 170 && i < 380) f.input.held.add('ShiftLeft'); else f.input.held.clear(); }
      a.step(null, i < 300 ? -.2 : .7); b.step(null, i < 300 ? -.2 : .7);
      for (const k of ['x', 'y', 'z']) { assert.equal(a.hero.pos[k], b.hero.pos[k], `${i}/${k}`); positions.push(b.hero.pos[k]); }
      assert.equal(a.hero.speed, b.hero.speed);
    }
    assert.equal(updates, 0); assert.equal(ticks, 600); assert.equal(syncs, 1200); // tickCharacter also syncs internally
    t.diagnostic(`${search || 'default'}: ${positions.length} position components identical, 600 legacy tickCharacter calls, 0 update calls with moves=0`);
    a.close(); b.close();
  }
  configureLoco('');
});

test('C stays with hero-life; E/Tab/Q do nothing; pause, flight and place clear unfinished actions', async () => {
  const f = fixture();
  const layer = await createKamakuraHeroLife({ hero: f.hero, scene: f.scene, terrain: f.terrain, keys: f.input, search: '?cloth=0', flight: f.flight, game: f.g });
  f.input.pressed.add('KeyC'); f.input.pressed.add('KeyE'); f.input.pressed.add('Tab'); f.input.pressed.add('KeyQ');
  f.step(layer); assert.equal(f.hero.crouch, false); assert.equal(f.hero.fighter.state, 'idle'); assert(f.hints.length > 0);
  for (const kind of ['pause', 'flight', 'place']) {
    f.input.edges.add(0); f.step(layer); assert.equal(f.hero.fighter.state, 'attack');
    if (kind === 'pause') f.moves.setPaused(true);
    else if (kind === 'flight') { f.flight.active = true; f.moves.setFlying(true); }
    else f.hero.place(1, 1);
    assert.equal(f.hero.fighter.state, 'idle'); assert.equal(f.hero.drawn, false); assert.equal(f.hero.queued, null); assert.equal(f.hero.lunge, null); assert.equal(f.hero.dodge, null);
    if (kind !== 'place') {
      f.input.edges.add(0); f.input.pressed.add('Space'); f.input.pressed.add('KeyF'); f.input.mouse.add(2); f.frames(180);
      assert.equal(f.hero.fighter.state, 'idle'); assert(!f.hero.drawn); assert(!f.hero.fighter.blocking);
      f.input.mouse.clear(); f.moves.setPaused(false); f.flight.active = false; f.moves.setFlying(false);
    }
    f.frames(180); assert.equal(f.hero.fighter.state, 'idle');
  }
  assert.equal(f.hero.pos.x, 1); assert.equal(f.hero.pos.z, 1);
  layer.dispose(); f.close();
});

test('F is routed to heavy on foot, remains available to flight, respects UI/pause/repeat and disposes once', () => {
  const f = fixture(), mesh = f.scene.getObjectByName('slash-trails');
  function key(extra = {}) {
    const e = new Event('keydown', { cancelable: true }); Object.assign(e, { code: 'KeyF', repeat: false, ...extra });
    f.events.dispatchEvent(e); return e;
  }
  assert(key().defaultPrevented); f.step(); assert.equal(f.hero.fighter.move.id, 'heavy');
  f.moves.setPaused(true); assert(!key().defaultPrevented); f.moves.setPaused(false);
  key({ repeat: true }); f.step(); assert.equal(f.hero.fighter.state, 'idle');
  f.flight.active = true; assert(!key().defaultPrevented); f.flight.active = false;
  const e = new Event('keydown', { cancelable: true }); Object.assign(e, { code: 'KeyF' }); Object.defineProperty(e, 'target', { value: { closest: () => true } });
  f.events.dispatchEvent(e); assert(!e.defaultPrevented);
  let gd = 0, md = 0; mesh.geometry.addEventListener('dispose', () => gd++); mesh.material.addEventListener('dispose', () => md++);
  f.moves.dispose(); f.moves.dispose(); assert.equal(gd, 1); assert.equal(md, 1); assert.equal(globalThis.__kzMoves, undefined);
  assert.equal(f.scene.getObjectByName('slash-trails'), undefined); assert(!key().defaultPrevented);
  assert.equal(Object.hasOwn(f.hero, 'place'), false); assert.equal(f.g.alertedEnemies, undefined); assert.equal(f.g.hud.toast, undefined); f.close();
});

test('dodge stays behind house/tree/water/slope using the shipped moveActor', () => {
  for (const obstacles of [
    { colliders: { extraBoxes: [{ x: 0, z: -1.6, w: 8, d: .5 }] } },
    { colliders: { extraCircles: [{ x: 0, z: -1.6, r: .6 }] } },
    { terrain: { waterAt: (x, z) => z < -1 ? 1 : 0 } },
    { terrain: { slopeAt: (x, z) => z < -1 ? 70 : 0 } },
  ]) {
    const f = fixture('', obstacles); f.axis.active = true; f.input.pressed.add('Space'); f.step(); f.axis.active = false; f.frames(180);
    assert(f.hero.pos.z > -1.1, `blocked dodge z=${f.hero.pos.z}`); assert.equal(f.hero.fighter.state, 'idle'); f.close();
  }
});

test('2000 seeded random input frames hit no undefined game port; debug counts and sound/dust use real connections', t => {
  const f = fixture(), rng = mulberry32(982), states = new Set(), moves = new Set();
  for (let i = 0; i < 2000; i++) {
    f.axis.active = rng() > .5;
    for (const code of ['KeyF', 'Space', 'KeyC', 'KeyE', 'Tab', 'KeyQ']) if (rng() < .035) f.input.pressed.add(code);
    if (rng() < .13) f.input.edges.add(0);
    if (rng() < .03) f.input.mouse.add(2); else if (rng() < .1) f.input.mouse.clear();
    f.step(null, rng() * Math.PI * 2); states.add(f.hero.fighter.state); if (f.hero.fighter.move) moves.add(f.hero.fighter.move.id);
    assert(!f.hero.crouch);
  }
  assert(states.has('attack') && states.has('dodge') && states.has('idle')); assert(moves.has('heavy') && moves.has('light3'));
  const debug = globalThis.__kzMoves(); assert.equal(debug.calls.alertedEnemies, 2000); assert.equal(debug.calls['battle.onStrike'], 0); assert.equal(debug.calls.hitStop, 0);
  f.g.hud.toast('unused'); f.g.battle.onStrike(); f.g.hitStop(); f.g.rig.kick(); f.g.rig.punchFov(); f.g.emitNoise();
  for (const n of ['hud.toast', 'battle.onStrike', 'hitStop', 'rig.kick', 'rig.punchFov', 'emitNoise']) assert(globalThis.__kzMoves().calls[n] > 0);
  assert(f.sounds.length > 0 && f.dust.length > 0); assert(f.maxTriangles > 0);
  t.diagnostic(`2000 frames, undefined calls 0; ${moves.size} distinct moves; trail peak ${f.maxTriangles} triangles; ${f.sounds.length} sound requests`);
  f.close();
});

test('world seam preserves beforeHero / split pose / legacy branch and samples trails after pose', () => {
  const s = fs.readFileSync(new URL('world-kamakura.js', base), 'utf8');
  assert.match(s, /layers\?\.beforeHero\(dt\);\s*if \(moves\) moves\.update\(dt, ax, yawOf\(vx, vz\)\);\s*else \{/);
  assert.match(s, /hero\.updateLocomotion\(dt, \{ input, axis: ax, moveYaw: yawOf\(vx, vz\) \}, false\);/);
  assert.match(s, /ch\.finishPose\(\); moves\?\.afterPose\(camera\);/);
  assert.match(s, /ch\.splitPose = true; ch\.legIk = true; ch\.legTerrain = t;/);
  assert.match(s, /moves\?\.setPaused\(on\)/); assert.match(s, /moves\?\.setFlying\(flight.active\)/);
  assert(s.indexOf('moves?.dispose()') < s.indexOf('hero?.remove()'));
});
