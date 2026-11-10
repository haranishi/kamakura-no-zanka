import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { parseGlb, buildGlb } from '../tools/lib/glb.mjs';
import { execFileSync } from 'node:child_process';
export const baseline = process.env.HEROMOVE_BASELINE === '1';
const shared = new Set(['upper-rig.js', 'upper-body.js', 'characters.js', 'hand-rig.js', 'hand-grip.js', 'sword-rig.js', 'kamakura-hero-life-view.js', 'kamakura-hero-move.js']);
const base = new URL('../dist/valley/', import.meta.url), memo = new Map();
function moduleURL(url, reference = baseline) {
  const key = reference + url.href;
  if (memo.has(key)) return memo.get(key);
  let s = reference && shared.has(url.pathname.split('/').at(-1)) ? execFileSync('git', ['show', 'HEAD:dist/valley/' + url.pathname.split('/').at(-1)], { encoding: 'utf8' }) : fs.readFileSync(url, 'utf8');
  s = s.replace(/from '([^']+)'/g, (all, name) => {
    if (name === 'three') return `from '${new URL('../vendor/three.module.min.js', base).href}'`;
    let next;
    if (name.startsWith('three/addons/')) next = new URL('../vendor/' + name.slice(13), base);
    else if (name.startsWith('.')) next = new URL(name, url);
    else return all;
    if (next.href === url.href) return all; // BufferGeometryUtils has a self-import in a documentation example.
    return `from '${moduleURL(next, reference)}'`;
  });
  s = s.replace(/import\('([^']+)'\)/g, (all, name) => {
    if (name === 'three') return `import('${new URL('../vendor/three.module.min.js', base).href}')`;
    if (name.startsWith('.')) return `import('${moduleURL(new URL(name, url), reference)}')`;
    return all;
  });
  s = s.replace(/import.meta.url/g, JSON.stringify(url.href));
  s += '\n//# sourceURL=hero-moves-node/' + url.pathname.split('/').at(-1);
  const result = 'data:text/javascript;base64,' + Buffer.from(s).toString('base64'); memo.set(key, result); return result;
}
export const load = (name, reference = baseline) => import(moduleURL(new URL(name, base), reference));

const { GRIP } = await load('config.js');
const { Character } = await load('characters.js');
const { createKamakuraHeroLife } = await load('kamakura-hero-life-view.js');
const { UPPER_ENV } = await load('upper-rig.js');
const { GLTFLoader } = await import(moduleURL(new URL('../vendor/loaders/GLTFLoader.js', base)));
const { prepareHands } = await load('hand-rig.js');
const meta = JSON.parse(fs.readFileSync(new URL('../dist/assets/characters/clips.json', import.meta.url)));
const glb = parseGlb(fs.readFileSync(new URL('../dist/assets/characters/hero.glb', import.meta.url)));
glb.json.materials = (glb.json.materials || []).map(() => ({})); delete glb.json.images; delete glb.json.textures;
const buffer = buildGlb(glb);
const gltf = await new GLTFLoader().parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
prepareHands(gltf.scene);
const clips = new Map(gltf.animations.map(original => {
  if (meta.clips[original.name]?.loop) return [original.name, original];
  const clip = original.clone(), track = clip.tracks.find(t => t.name === 'Hips.position');
  if (track) for (let i=3;i<track.values.length;i+=3) { track.values[i]=track.values[0]; track.values[i+2]=track.values[2]; }
  return [clip.name,clip];
}));
const roster = { meta, templates: new Map([['hero', { scene: gltf.scene, clips, roots: new Map(), info: meta.characters.hero }]]) };
export const DT = 1 / 60, D = 180 / Math.PI;
const painter = { fillRect() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {} };
export async function fixture(search = '?debug=1&cloth=0', reference = baseline) {
  const C = reference ? (await load('characters.js', true)).Character : Character;
  const life = reference ? (await load('kamakura-hero-life-view.js', true)).createKamakuraHeroLife : createKamakuraHeroLife;
  const ch = new C(roster, 'hero'), scene = new THREE.Scene(); scene.add(ch.root);
  const previous = globalThis.document; globalThis.document = { createElement: () => ({ getContext: () => painter }) };
  try { ch.setTachi(GRIP, false); } finally { if (previous) globalThis.document = previous; else delete globalThis.document; }
  const terrain = { heightAt: () => 0, normalAt: () => ({ x: 0, y: 1, z: 0 }) };
  const hero = { character: ch, speed: 0, fighter: { state: 'idle', alive: true }, pos: { x: 0, y: 0, z: 0 } };
  const layer = await life({ hero, scene, terrain, search, keys: { wasPressed: () => false } });
  const frame = { dt: DT, time: 0, windDir: [1, 0], wind: 0, flying: false };
  function step(speed, name = null) {
    layer?.beforeHero(DT); hero.speed = speed;
    if (name) ch.play(name);
    else ch.locomote(speed, ch.weapons.tachiDrawn.holder.visible ? 'guard' : 'relaxed', false, 0);
    ch.root.position.z += speed * DT;
    ch.legIk = true; ch.legTerrain = terrain; ch.update(DT);
    frame.time += DT; layer?.update(frame);
    return measure(ch);
  }
  return { ch, layer, hero, step, scene, frame, close() { layer?.dispose(); ch.dispose(); } };
}
const v = () => new THREE.Vector3();
export function measure(ch) {
  ch.root.updateMatrixWorld(true);
  const p = name => ch.bone(name).getWorldPosition(v());
  const hips = p('Hips'), neck = p('neck'), arm = p('RightArm'), fore = ch.hands.sides.Right.vis[1].getWorldPosition(v()), hand = ch.hands.sides.Right.vis[2].getWorldPosition(v());
  const a = arm.clone().sub(fore), b = hand.clone().sub(fore);
  const head = v().copy(ch.bone('headfront').position).normalize().applyQuaternion(ch.bone('Head').getWorldQuaternion(new THREE.Quaternion()));
  const thigh = p('LeftLeg').sub(p('LeftUpLeg'));
  const measured = ch.upper.style?.measure();
  return { thigh: Math.atan2(thigh.z, -thigh.y) * D, ...measured, lean: Math.atan2(neck.z - hips.z, neck.y - hips.y) * D, head: Math.asin(head.y) * D,
    up: hand.y - hips.y, shoulderUp: hand.y - arm.y, fwd: hand.z - arm.z, right: -(hand.x - hips.x),
    elbow: a.angleTo(b) * D, spread: Math.atan2(Math.abs(fore.x - arm.x), arm.y - fore.y) * D,
    hand: hand.toArray(), left: ch.hands.sides.Left.vis[2].getWorldPosition(v()).toArray() };
}
