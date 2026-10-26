// characters.js — 人物GLBの読み込み・複製・動作制御・武器の取り付け（view層）
// 論理（combat/enemy-ai/quest）の状態を読んで、動作クリップを選んで再生するだけ。規則は持たない。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { LOCOMOTION, MOVE_CLIPS, ACTION_CLIPS, pickGait, locomotionTimeScale, segmentFor } from './anim-data.js';
import { makeTachi, makeNaginata, makeYumi, makeArrow, makeQuiver } from './weapons.js';

const DIR = new URL('../assets/characters/', import.meta.url).href;
export const ROSTER = ['hero', 'archer', 'soldier', 'officer', 'villager_m', 'villager_f', 'child'];
const HIPS = 'Hips';

// 非ループ動作の水平な根の移動を取り除く（その場の動作にする）。取り除いた分は root に残す。
function stripRoot(clip) {
  const index = clip.tracks.findIndex(t => t.name === HIPS + '.position');
  if (index < 0) return { clip, root: null };
  const track = clip.tracks[index], v = track.values, n = track.times.length;
  const root = { times: Float32Array.from(track.times), x: new Float32Array(n), z: new Float32Array(n) };
  const out = new Float32Array(v.length);
  for (let i = 0; i < n; i++) {
    root.x[i] = v[i * 3] - v[0]; root.z[i] = v[i * 3 + 2] - v[2];
    out[i * 3] = v[0]; out[i * 3 + 1] = v[i * 3 + 1]; out[i * 3 + 2] = v[2];
  }
  const next = clip.clone();
  next.tracks[index] = new THREE.VectorKeyframeTrack(track.name, Array.from(track.times), out);
  return { clip: next, root };
}

export async function loadRoster({ names = ROSTER, onProgress, anisotropy = 8 } = {}) {
  const loader = new GLTFLoader();
  const meta = await (await fetch(DIR + 'clips.json')).json();
  const progress = new Map();
  const report = () => { if (onProgress) { let l = 0, t = 0; for (const p of progress.values()) { l += p.loaded; t += p.total || p.loaded; } onProgress(t ? l / t : 0); } };
  const templates = new Map();
  await Promise.all(names.map(async name => {
    const gltf = await loader.loadAsync(DIR + name + '.glb', e => { progress.set(name, { loaded: e.loaded, total: e.total }); report(); });
    gltf.scene.traverse(o => {
      if (!o.isMesh) return;
      o.frustumCulled = false; o.castShadow = true; o.receiveShadow = true;
      const m = o.material;
      for (const k of ['map', 'normalMap', 'roughnessMap', 'metalnessMap', 'aoMap']) if (m[k]) m[k].anisotropy = anisotropy;
    });
    const clips = new Map(), roots = new Map();
    for (const c of gltf.animations) {
      const looped = meta.clips[c.name]?.loop;
      if (looped) clips.set(c.name, c);
      else { const s = stripRoot(c); clips.set(c.name, s.clip); roots.set(c.name, s.root); }
    }
    templates.set(name, { scene: gltf.scene, clips, roots, info: meta.characters[name] });
  }));
  return { templates, meta };
}

export class Character {
  constructor(roster, who, { tint = null, scale = 1, style = 'relaxed' } = {}) {
    this.who = who; this.roster = roster;
    const tpl = roster.templates.get(who);
    if (!tpl) throw new Error('Unknown character ' + who);
    this.tpl = tpl;
    this.model = cloneSkinned(tpl.scene);
    this.model.traverse(o => {
      if (o.isSkinnedMesh && tint) { o.material = o.material.clone(); o.material.color.set(tint); }
    });
    this.root = new THREE.Group(); this.root.name = 'char-' + who; this.root.add(this.model); this.root.scale.setScalar(scale);
    this.height = (tpl.info?.height || 1.7) * scale;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    this.current = null; this.currentName = null;
    this.gait = 'idle'; this.style = style; this.locoName = null;
    this.segment = null; this.onSegmentEnd = null;
    this.time = 0; this.rate = 1;
    this.bones = new Map();
    this.model.traverse(o => { if (o.isBone) this.bones.set(o.name, o); });
    this.weapons = {};
    this.rootTravel = { x: 0, z: 0 };
  }

  bone(name) { return this.bones.get(name); }
  meta(name) { return this.roster.meta.clips[name]; }

  action(name) {
    let a = this.actions.get(name);
    if (a) return a;
    const clip = this.tpl.clips.get(name);
    if (!clip) return null;
    a = this.mixer.clipAction(clip);
    const loop = this.meta(name)?.loop;
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    this.actions.set(name, a);
    return a;
  }

  // 動作を切り替える。fade 秒で前の動作から混ぜる。
  play(name, { fade = 0.18, timeScale = 1, from = 0, to = null, weight = 1, onEnd = null, restart = false } = {}) {
    const next = this.action(name);
    if (!next) return null;
    if (this.current === next && !restart && !to) { next.timeScale = timeScale; return next; }
    next.enabled = true; next.paused = false; next.setEffectiveWeight(weight); next.timeScale = timeScale;
    next.reset(); next.time = from;
    if (this.current && this.current !== next) next.crossFadeFrom(this.current, fade, false);
    else next.fadeIn(fade);
    next.play();
    this.current = next; this.currentName = name;
    this.segment = to != null ? { to, speed: timeScale } : null;
    this.onSegmentEnd = onEnd;
    this.locoName = null;
    return next;
  }

  // 一度きりの動作（ACTION_CLIPS の名前）
  playAction(key, { timeScale = 1, onEnd = null, from = 0 } = {}) {
    const def = ACTION_CLIPS[key];
    if (!def) return null;
    const meta = this.meta(def.clip);
    return this.play(def.clip, { fade: def.fade, timeScale, from, restart: true, to: meta?.loop ? null : meta?.seconds - 0.001, onEnd });
  }

  // 技（combat.js の MOVES の id）を、時間割に合わせて再生する。戻り値は切り出しの情報。
  playMove(moveId, timing, { onEnd = null, fade = 0.07 } = {}) {
    const def = MOVE_CLIPS[moveId];
    if (!def) return null;
    const meta = this.meta(def.clip);
    if (!meta) return null;
    const seg = segmentFor(meta, timing);
    this.play(def.clip, { fade, timeScale: seg.speed, from: seg.from, to: seg.to, restart: true, onEnd });
    return { ...seg, clip: def.clip, root: this.tpl.roots.get(def.clip) || null };
  }

  // 移動：速さ(m/s)から歩き・小走り・走りを選ぶ。style は LOCOMOTION の表。
  locomote(speed, style = this.style) {
    this.style = style;
    const table = LOCOMOTION[style] || LOCOMOTION.relaxed;
    this.gait = pickGait(this.gait, speed);
    const name = table[this.gait];
    const meta = this.meta(name);
    const frozen = this.gait === 'idle' && table.idleFreeze;
    const ts = this.gait === 'idle' ? (frozen ? 0 : 1) : (style === 'injured' ? 1 : locomotionTimeScale(speed, meta?.avgSpeed));
    if (this.locoName !== name) {
      this.play(name, { fade: 0.2, timeScale: ts });
      this.locoName = name;
      if (frozen && this.current) this.current.time = 0.3;
    } else if (this.current) this.current.timeScale = ts;
  }

  // 武器を手・腰の骨へ付ける。grip = {bone, pos:[x,y,z], rot:[x,y,z]（度）, scale}
  attach(key, object, grip) {
    const bone = this.bone(grip.bone);
    if (!bone) return null;
    const holder = new THREE.Group(); holder.name = 'grip-' + key;
    holder.position.fromArray(grip.pos || [0, 0, 0]);
    if (grip.axes) {
      // 武器のローカル軸を骨のローカル座標の向きで指定する（y=武器の長い軸、z=刃の向き）。直交化して回転にする。
      const y = new THREE.Vector3(...grip.axes.y).normalize();
      const z0 = new THREE.Vector3(...grip.axes.z);
      const z = z0.sub(y.clone().multiplyScalar(z0.dot(y))).normalize();
      const x = new THREE.Vector3().crossVectors(y, z);
      holder.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    } else {
      const r = grip.rot || [0, 0, 0];
      holder.rotation.set(THREE.MathUtils.degToRad(r[0]), THREE.MathUtils.degToRad(r[1]), THREE.MathUtils.degToRad(r[2]));
    }
    // Meshy の骨は cm 系（親に 0.01 の縮み）を持たない GLB だが、骨のローカル軸の長さは m。念のため等倍。
    if (grip.scale) holder.scale.setScalar(grip.scale);
    holder.add(object); bone.add(holder);
    this.weapons[key] = { holder, object };
    return holder;
  }

  setTachi(grips, drawn) {
    if (!this.weapons.tachiDrawn) {
      const t = makeTachi();
      this.attach('tachiDrawn', t.drawn, grips.tachiDrawn);
      this.attach('tachiHip', t.hip, grips.tachiHip);
      this.weapons.tachiHipHilt = { object: t.hiltOnHip };
    }
    this.weapons.tachiDrawn.holder.visible = !!drawn;
    this.weapons.tachiHipHilt.object.visible = !drawn;
  }

  update(dt) {
    this.time += dt;
    this.mixer.update(dt * this.rate);
    if (this.segment && this.current && this.current.time >= this.segment.to) {
      const cb = this.onSegmentEnd; this.segment = null; this.onSegmentEnd = null;
      if (cb) cb(this);
    }
  }

  dispose() { this.mixer.stopAllAction(); this.root.removeFromParent(); }
}
