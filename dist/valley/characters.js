// characters.js — 人物GLBの読み込み・複製・動作制御・武器の取り付け（view層）
// 論理（combat/enemy-ai/quest）の状態を読んで、動作クリップを選んで再生するだけ。規則は持たない。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { LOCO, gaitsFor } from './loco.js';
const GAIT_RANK = { idle: 0, walk: 1, jog: 2, run: 3 }, STOP_BLEND_BELOW = 1.0;
import { GAITS, LOCOMOTION, MOVE_CLIPS, ACTION_CLIPS, pickGait, locomotionTimeScale, moveSegment, clipTimeAt, phaseMatchedTime, STANCE_SPEED } from './anim-data.js';
import { createContactTracker, observeContacts } from './foot-contacts.js';
import { GAIT_TABLE } from './gait-table.js';
import { passStartTime } from './gait-phase.js';
import { FOOT_CONTACTS } from './anim-contacts.js';
import { BowRig } from './bow.js';
import { SwordRig } from './sword-rig.js';
import { HandRig, HAND_RIG_WHO, prepareHands } from './hand-rig.js';
import { LegRig } from './leg-ik.js';
import { UpperRig } from './upper-rig.js';
import { strideScale } from './leg-plant.js';
import { makeTachi, makeNaginata, makeYumi, makeArrow, makeQuiver } from './weapons.js';
import { patchLift } from './grade.js';
import { spreadWeight, spreadFix } from './arm-spread.js';

let contactActorId = 0;
const DIR = new URL('../assets/characters/', import.meta.url).href;
export const ROSTER = ['hero', 'archer', 'soldier', 'officer', 'villager_m', 'villager_f', 'child'];
const HIPS = 'Hips';
const FLINCH_BONES = ['Spine', 'Spine01', 'Spine02'];
const FLINCH_Q = new THREE.Quaternion(), FLINCH_AXIS = new THREE.Vector3();
// 腕の力の抜き：焼き込んだ待ち・歩きの一部（Meshy由来の動作）は腕が体から30〜40°開く。下がった腕だけ、開きを目標まで詰める（度）。
// full〜none は「腕が下がっている」と見なす範囲（下向きからの角）。構え・振りの腕には効かない。
const ARM = { target: 9, max: 32, full: 48, none: 76, rate: 14 };
const P0 = new THREE.Vector3(), P1 = new THREE.Vector3(), MQ = new THREE.Quaternion(), PQ = new THREE.Quaternion(), PQI = new THREE.Quaternion(), RQ = new THREE.Quaternion(), AX = new THREE.Vector3();
const FIX = new Float64Array(4), SPREAD_BONES = [['LeftArm', 'LeftHand'], ['RightArm', 'RightHand']];   // 骨の名前は先に作る（毎コマ文字列をつながない）   // 腕の開きの寄せ（arm-spread.js）の受け渡し。毎コマの新規確保をしない
const smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

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
      patchLift(m, 0.78);
    });
    const clips = new Map(), roots = new Map();
    for (const c of gltf.animations) {
      const looped = meta.clips[c.name]?.loop;
      if (looped) clips.set(c.name, c);
      else { const s = stripRoot(c); clips.set(c.name, s.clip); roots.set(c.name, s.root); }
    }
    if (HAND_RIG_WHO.has(name)) prepareHands(gltf.scene);   // 指の骨の重み・握りの形（8.6a）を、読み込みの間に1回だけ
    templates.set(name, { scene: gltf.scene, clips, roots, info: meta.characters[name] });
  }));
  return { templates, meta };
}

export class Character {
  constructor(roster, who, { tint = null, scale = 1, style = 'relaxed' } = {}) {
    this.who = who; this.roster = roster;
    this.id = `character-${++contactActorId}`;
    this.contacts = createContactTracker(); this.onContact = null;
    this.contactAirborne = false; this.contactNear = true; this.contactReset = false; this.contactTimeScale = 1; this.contactRestart = new Set();
    const tpl = roster.templates.get(who);
    if (!tpl) throw new Error('Unknown character ' + who);
    this.tpl = tpl;
    this.model = cloneSkinned(tpl.scene);
    this.model.traverse(o => {
      if (o.isSkinnedMesh && tint) { o.material = o.material.clone(); o.material.color.set(tint); patchLift(o.material, 0.78); }
    });
    this.root = new THREE.Group(); this.root.name = 'char-' + who; this.root.add(this.model); this.root.scale.setScalar(scale);
    this.height = (tpl.info?.height || 1.7) * scale;
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = new Map();
    this.current = null; this.currentName = null;
    this.gait = 'idle'; this.style = style; this.strideWant = 1; this.locoName = null; this.locoOut = null; this.locoOutRef = 0;
    this.segment = null; this.onSegmentEnd = null; this.warp = null;
    this.time = 0; this.rate = 1;
    this.bones = new Map();
    this.model.traverse(o => { if (o.isBone) this.bones.set(o.name, o); });
    this.weapons = {};
    this.rootTravel = { x: 0, z: 0 };
    this.flinch = { x: 0, v: 0, px: 0, pz: 1 };
    this.armRelax = true; this.relax = { Left: 0, Right: 0 };
    this.spreadCapDeg = 0; this.spreadLastCap = 0; this.spreadW = 0;   // 腕の開きの上限（度・人物が毎コマ置く）と、その効き（8.3b）
    this.cinePose = null;   // 節目の演出の間だけ置く、骨の後処理（うなずき・視線・袖印を持つ手。cinematics-view.js）。見た目だけ
    // 指の骨と見える腕の写し（8.6a）。this.bones（動作の骨）を作ったあとに足すので、写しは this.bones に入らない
    this.hands = HAND_RIG_WHO.has(who) ? new HandRig(this) : null;
    // 脚のIKと接地（M2b・leg-ik.js）。game.js が押し分けの後に finishPose を呼ぶコマだけ使う（splitPose・legIk はそのコマごとに置かれる）
    this.legs = new LegRig(this); this.splitPose = false; this.legIk = false; this.legTerrain = null; this.poseDt = null;
    // 走りの形（M3・upper-rig.js）：脚のIKを使う人だけ、脚の前に当てる（?smooth=arms で M2b の姿勢）
    this.upper = new UpperRig(this);
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
  play(name, options = {}) {
    const { fade = 0.18, timeScale = 1, from = 0, to = null, weight = 1, onEnd = null, restart = false } = options;
    const next = this.action(name);
    if (!next) return null;
    this.warp = null;                  // 3区間の速さ（playMove）は、別の動作に替えたら終わる
    if (this.current === next && !restart && !to && !Object.hasOwn(options, 'from')) { next.timeScale = timeScale; return next; }
    next.enabled = true; next.paused = false; next.setEffectiveWeight(weight); next.timeScale = timeScale;
    this.contactRestart.add(name);   // 巻き戻した動作だけ、新しい走り出しとして扱う（出ていく動作の接地は続ける）
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
    const seg = moveSegment(moveId, meta, timing);
    this.play(def.clip, { fade, timeScale: seg.speeds ? seg.speeds[0] : seg.speed, from: seg.from, to: seg.to, restart: true, onEnd });
    if (seg.knots) this.warp = { knots: seg.knots, t: 0, action: this.current };   // 接触（8.3a 第2周）・振りの山（8.3a）を判定へ合わせる技
    return { ...seg, clip: def.clip, root: this.tpl.roots.get(def.clip) || null };
  }

  // 折れ線の速さの技：技の開始からの秒で動作の時刻を決め、このコマで mixer が進める量を合わせる。
  // 秒は、人物が渡す論理の技の経過（warpClock）。無いとき（闇討ちの演出）は dt を積む。論理の秒を使うので、技を始めたコマに
  // 動作が1コマ先へ進む（60コマ/秒で17ms早く当たって見える）ことがない。個体の速さ rate で割り戻すので、敵の個体差（0.94〜1.06倍）も掛からない。
  followWarp(dt) {
    const w = this.warp;
    if (this.current !== w.action) { this.warp = null; return; }
    const step = dt * this.rate * this.mixer.timeScale;
    if (!(dt > 0) || !(step > 0)) return;
    w.t = Number.isFinite(this.warpClock) ? this.warpClock : w.t + dt;
    w.action.timeScale = Math.max(0, (clipTimeAt(w.knots, w.t) - w.action.time) / step);
  }

  // 移動：速さ(m/s)から歩き・小走り・走りを選ぶ。style は LOCOMOTION の表。
  // hold：減速の間は下の歩容へ替えない（'stop'＝入力を離して止まる途中）（M1。止まりきる・スキッドの0.2〜0.3秒に走り→小走り→歩きの混ぜが3回重なり、着いた足が流れた）。
  // floor：再生の倍率の下限。主人公の新しい加減速では0（走り出し・止まりの間も、着いた足の速さ＝進む速さにする。定速の倍率は0.55を下回らない）
  // aim：加速の間に歩容を選ぶ速さ（目標の速さ）。走り出しで歩き→小走り→走りの混ぜが0.1秒に2回重なり、着いた足が10cm流れたので、
  // 動き出したら目標の歩容へ直接入る（倍率の下限0で、遅いうちはゆっくり回す）
  // M2a（gait-phase.js）の2つ。主人公の新しい経路（floor＝0）だけ。?smooth=phase で M1 の経路へ戻る：
  //   ① 歩容を替える混ぜの間も、出ていく動作を実際の速さで回す（前は替えた瞬間の倍率のまま回り、小走り→走りで着いた足が流れた。止まりでは0で止めていた）
  //   ② 待ちから歩き出すとき、すれ違いの位相（両足が体の下で揃う所）から始める（前は動作の先頭＝片足を前へ伸ばした姿から）
  locomote(speed, style = this.style, hold = false, floor = undefined, aim = undefined) {
    this.style = style;
    const table = LOCOMOTION[style] || LOCOMOTION.relaxed, G = gaitsFor(LOCO, GAITS), phaseOn = floor === 0 && LOCO.smoothPhase;
    const pickAt = aim != null && speed >= G.walkUp ? Math.max(speed, aim) : speed;
    let next = pickGait(this.gait, pickAt, G);   // 歩容の境は速さの表と一緒に替える（loco.js）
    if (aim != null && this.gait === 'idle' && next !== 'idle') next = pickGait(next, pickAt, G);
    this.gait = hold && next !== 'idle' && GAIT_RANK[next] < GAIT_RANK[this.gait] ? this.gait : next;
    // 止まりかけ（1m/秒未満）で待ちへ混ぜ始める：0まで走りの姿で回すと、浮いた脚が上がったまま0.3秒止まって見えた（盲検用のコマ割り）
    if (hold === 'stop' && speed < STOP_BLEND_BELOW && this.gait !== 'idle' && style !== 'crouch') this.gait = 'idle';
    const name = table[this.gait];
    const meta = this.meta(name);
    const frozen = this.gait === 'idle' && table.idleFreeze;
    const ref = STANCE_SPEED[name] ?? meta?.avgSpeed;   // 着いている足の速さに合わせる（anim-data.js の STANCE_SPEED）
    let ts = this.gait === 'idle' ? (frozen ? 0 : 1) : (style === 'injured' ? Math.max(1, Math.min(1.5, locomotionTimeScale(speed, ref))) : locomotionTimeScale(speed, ref, floor));   // 負傷でも急ぐときは足を速める
    // 歩幅の伸縮（M2b・leg-plant.js の strideScale）：主人公の新しい経路だけ。歩幅を伸ばした分だけ歩調を下げる（伸ばすのは脚のIK。leg-ik.js）。
    // 歩調は前のコマにならした歩幅で割る（脚のIKと同じ値を使わないと、着いた足の動作の速さと進む速さがずれる）
    this.strideWant = phaseOn && LOCO.smoothStride && this.gait !== 'idle' && style !== 'crouch' && ref > 0.3 ? strideScale(speed / ref) : 1;
    if (this.gait !== 'idle' && this.legs && this.legs.ks > 1) ts /= this.legs.ks;
    const out = this.locoOut;
    if (out && (!phaseOn || out === this.current || !(out.getEffectiveWeight() > 0))) this.locoOut = null;
    else if (out) out.timeScale = locomotionTimeScale(speed, this.locoOutRef, 0);   // ①
    if (this.locoName !== name) {
      const prev = this.locoName && this.current && this.currentName === this.locoName ? this.current : null;
      // 引き継ぐのは同じ構え（style）の中の歩き↔小走り↔走りだけ。構えの替わり目（待ち構え↔ふだん）は抜刀・納刀と重なり、
      // 引き継ぐと納刀の右腕のIKが届かない姿の位相に入った（regress-draw-sheathe の sheatheWalking で80mm。先頭からなら12mm）
      let from = prev && this.locoStyle === style ? phaseMatchedTime(FOOT_CONTACTS, this.locoName, prev.time, name) : null;
      if (from == null && phaseOn && this.gait !== 'idle' && style !== 'crouch') from = passStartTime(GAIT_TABLE[name]?.[this.who]);   // ②
      // 止まる：出ていく足の動作をその姿で止めてから待ちへ混ぜる（体は止まったのに、着いている足だけ後ろへ流れて見えた）。M2a では止めずに①で回す
      if (prev && this.gait === 'idle' && !phaseOn) prev.timeScale = 0;
      if (phaseOn && prev) { this.locoOut = prev; this.locoOutRef = STANCE_SPEED[this.locoName] ?? this.meta(this.locoName)?.avgSpeed; }
      this.play(name, from == null ? { fade: 0.2, timeScale: ts } : { fade: 0.2, timeScale: ts, from });
      this.locoName = name; this.locoStyle = style;
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

  // 弓：左手に持ち、矢筒を背負う。構えの間は両手の位置から弓・弦・矢を作る（bow.js）
  attachBow(grips, arrow) {
    this.attach('yumi', makeYumi(), grips.yumi);
    this.attach('quiver', makeQuiver(), grips.quiver);
    this.bow = new BowRig(this);
    if (arrow) this.bow.setArrow(arrow);
    return this.bow;
  }

  setTachi(grips, drawn) {
    if (!this.weapons.tachiDrawn) {
      const t = makeTachi();
      this.attach('tachiDrawn', t.drawn, grips.tachiDrawn);
      this.attach('tachiHip', t.hip, grips.tachiHip);
      this.weapons.tachiHipHilt = { object: t.hiltOnHip };
      this.sword = new SwordRig(this);   // 抜刀・納刀の見た目の層（8.2）。主人公だけが frame を与える。与えられない間は何もしない
    }
    this.weapons.tachiDrawn.holder.visible = !!drawn;
    this.weapons.tachiHipHilt.object.visible = !drawn;
  }

  // 被弾のひるみ：動作を止めずに、上体を押された向きへ一瞬しならせる（鎧で怯まない相手にも手応えを返す。見た目だけ）。
  // push は世界の水平の向き（押される向き）。無ければ yawLocal（打たれた向き。人物の向きからの角）の反対。
  // 骨の局所の軸は人物の向きとそろっていないので、世界の軸を親の向きで局所へ直して回す（8.3a 第2周。前は相手の側へ曲がり、反応が見えなかった）。
  kick(amount = 1, yawLocal = 0, push = null) {
    const f = this.flinch, yaw = this.root.rotation.y - Math.PI + yawLocal, l = push ? Math.hypot(push.x, push.z) : 0;
    f.v += amount * 7; f.px = l > 1e-9 ? push.x / l : Math.sin(yaw); f.pz = l > 1e-9 ? push.z / l : Math.cos(yaw);
  }

  resetContacts() { this.contactReset = true; if (this.legs) this.legs.reset = true; }

  // 人物の更新は2つに分かれる：①mixer・接地通知（update）②脚のIK→体幹ばね→腕→刀→握り（finishPose）。
  // splitPose のコマ（?smooth=ik で戻していない間、game.js が遊びのコマごとに置く）は①だけを行い、押し分けの後に game.js が②を呼ぶ（骨盤を動かすと刀・握りも動くので、
  // 脚の姿勢と模型の根の位置を決めてから刀と握りを解く）。それ以外（演出・見本の画面・?smooth=ik）は①②を続けて行う＝M2a までと同じ順
  update(dt) {
    this.sword?.undo();   // 前のコマの抜刀・納刀の骨の後処理を戻してから、動作を当てる
    this.legs?.undo();    // 脚のIK（M2b）の補正も戻す（刀の後に当てたので、刀の次に戻す）
    this.upper?.undo();   // 走りの形（M3）は脚の前に当てたので、最後に戻す
    this.time += dt;
    if (this.warp) this.followWarp(dt);
    this.mixer.update(dt * this.rate);
    // Baked table durations are rounded to 4 decimals; clamp the sub-0.1ms GLB tail.
    const sources = [];
    for (const [clip, action] of this.actions) {
      if (Object.hasOwn(FOOT_CONTACTS, clip) && action.getEffectiveWeight() > 0) sources.push({ clip, time: Math.min(action.time, FOOT_CONTACTS[clip].duration), weight: action.getEffectiveWeight(), speed: action.getEffectiveTimeScale() * this.rate * this.mixer.timeScale * this.contactTimeScale, target: action === this.current, restart: this.contactRestart.has(clip) });
    }
    const result = observeContacts(this.contacts, { actor: this.id, sources, moving: !!this.locoName && this.gait !== 'idle', airborne: this.contactAirborne, near: this.contactNear, reset: this.contactReset }, FOOT_CONTACTS);
    this.contacts = result.state; this.contactReset = false; this.contactRestart.clear();
    for (const contact of result.contacts) this.onContact?.(contact);
    if (this.segment && this.current && this.current.time >= this.segment.to) {
      const cb = this.onSegmentEnd; this.segment = null; this.onSegmentEnd = null;
      if (cb) cb(this);
    }
    if (this.splitPose) { this.poseDt = dt; return; }
    this.finishPose(dt);
  }

  finishPose(dt = this.poseDt) {
    this.splitPose = false; this.poseDt = null;
    if (dt == null) return;
    const legs = this.legs;
    // 走りの形（M3）：mixer の直後・脚のIKの前（骨盤の上下 lift は脚のIKが当てる）。使うのは脚のIKを使う人だけ
    if (this.upper) this.upper.apply(dt, this.legIk && !!this.legTerrain && LOCO.smoothArms);
    if (legs && !this.legIk && legs.ks !== 1) legs.ks = 1;   // IK を使わないコマ（範囲の外・軽量）では歩幅の伸縮も使わない。古い値を残すと歩調だけが下がる
    if (legs && this.legIk && this.legTerrain) legs.apply(dt, this.legTerrain, true);
    else if (legs && (legs.feet[0].mode || legs.feet[1].mode || legs.drop)) legs.apply(dt, null, false);
    this.legIk = false;
    const f = this.flinch;
    if (f.v !== 0 || f.x !== 0) {
      f.v += (-f.x * 120 - f.v * 14) * dt; f.x += f.v * dt;
      if (Math.abs(f.x) < 1e-3 && Math.abs(f.v) < 1e-2) f.x = f.v = 0;
      const a = Math.max(-0.5, Math.min(0.5, f.x));
      for (const name of FLINCH_BONES) {
        const b = this.bones.get(name); if (!b) continue;
        b.parent.getWorldQuaternion(PQ);   // 世界の軸 上×押す向き（上体の先が押す向きへ傾く）を、親の局所へ
        b.quaternion.premultiply(FLINCH_Q.setFromAxisAngle(FLINCH_AXIS.set(f.pz, 0, -f.px).applyQuaternion(PQ.invert()), a * 0.4));
      }
    }
    if (this.armRelax) this.relaxArms(dt);
    if (this.spreadCapDeg > 0 || this.spreadW > 0) this.spreadArms(dt);   // 被弾・弾かれ・倒れの腕の開き（8.3b）：動作の骨の後処理。握りの層の前
    if (this.cinePose) this.cinePose(this);   // 演出の身振り：動作の骨へ。見える腕の写し（握りの層）より前に当てる
    if (this.sword) this.sword.apply();   // 抜刀・納刀：骨の後処理なので relaxArms のあと
    if (this.hands) this.hands.apply(dt);   // 握り（8.6a）：抜刀の層が決めた刀・鞘を読み、見える腕の写しだけを動かす
    if (this.bow) this.bow.update();
    if (this.drops) this.updateDrops(dt);
  }

  // 倒れた人の武器を手から外して地面へ置く（手に付いたままだと、死んだ姿で刀が真上に立った）。武器の長い軸は +Y（weapons.js の約束）。
  // onLand は地面に着いた瞬間に1回だけ呼ぶ（刀が落ちる音。無ければ鳴らさない）。
  dropWeapon(key, groundAt, onLand = null) {
    const w = this.weapons[key], parent = this.root.parent;
    if (!w || !w.holder.visible || !parent || this.drops?.some(d => d.key === key)) return;
    const obj = w.object, p0 = new THREE.Vector3(), q0 = new THREE.Quaternion(), sc = new THREE.Vector3();
    obj.updateWorldMatrix(true, false); obj.matrixWorld.decompose(p0, q0, sc);
    obj.removeFromParent(); parent.add(obj); obj.position.copy(p0); obj.quaternion.copy(q0); obj.scale.copy(sc);
    const th = (Math.sin(p0.x * 12.9898 + p0.z * 78.233) * 43758.5453 % 1) * Math.PI * 2, dir = new THREE.Vector3(Math.cos(th), 0, Math.sin(th));
    const qEnd = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    const pEnd = new THREE.Vector3(p0.x + dir.x * 0.1, groundAt(p0.x, p0.z) + 0.035, p0.z + dir.z * 0.1);
    (this.drops ||= []).push({ key, obj, t: 0, p0, q0, pEnd, qEnd, onLand });
    w.holder.visible = false;
  }
  updateDrops(dt) {
    for (const d of this.drops) {
      if (d.t >= 1) continue;
      d.t = Math.min(1, d.t + dt / 0.5);
      const k = d.t, fall = k * k;
      d.obj.position.set(d.p0.x + (d.pEnd.x - d.p0.x) * k, d.p0.y + (d.pEnd.y - d.p0.y) * fall, d.p0.z + (d.pEnd.z - d.p0.z) * k);
      d.obj.quaternion.slerpQuaternions(d.q0, d.qEnd, 1 - (1 - k) * (1 - k));
      if (d.t >= 1 && d.onLand) { const f = d.onLand; d.onLand = null; f(); }
    }
  }

  // 下がった腕の「体からの開き」を詰める（モデル空間の前向きの軸まわりに、上腕の骨を回す）
  relaxArms(dt) {
    this.model.updateMatrixWorld(true);
    this.model.getWorldQuaternion(MQ); AX.set(0, 0, 1).applyQuaternion(MQ);
    for (const side of ['Left', 'Right']) {
      const arm = this.bones.get(side + 'Arm'), fore = this.bones.get(side + 'ForeArm');
      if (!arm || !fore) continue;
      arm.getWorldPosition(P0); fore.getWorldPosition(P1); this.model.worldToLocal(P0); this.model.worldToLocal(P1);
      const dx = (P1.x - P0.x) * (side === 'Left' ? 1 : -1), dy = P1.y - P0.y, dz = P1.z - P0.z;
      const abduct = Math.atan2(dx, -dy) * 180 / Math.PI, fromDown = Math.atan2(Math.hypot(P1.x - P0.x, dz), -dy) * 180 / Math.PI;
      const want = abduct > ARM.target ? Math.min(ARM.max, abduct - ARM.target) * (1 - smoothstep(ARM.full, ARM.none, fromDown)) : 0;
      this.relax[side] += (want - this.relax[side]) * (dt > 0 ? 1 - Math.exp(-ARM.rate * dt) : 1);
      const r = this.relax[side];
      if (r < 0.05) continue;
      arm.parent.getWorldQuaternion(PQ); PQI.copy(PQ).invert();
      RQ.setFromAxisAngle(AX, THREE.MathUtils.degToRad(side === 'Left' ? -r : r));
      arm.quaternion.premultiply(PQ).premultiply(RQ).premultiply(PQI);
    }
  }

  // 腕の開きの上限（8.3b・arm-spread.js）：腕全体（肩→手首）が胴の下向き（首→腰）から spreadCapDeg 度より開いたら、
  // 腕と下向きを含む面の中で、上腕の骨を胴の側へ回す。上限を外したら、効きを0へ戻しながら同じ上限で寄せ続ける（1コマで跳ばない）
  spreadArms(dt) {
    const on = this.spreadCapDeg > 0;
    if (on) this.spreadLastCap = this.spreadCapDeg;
    this.spreadW = spreadWeight(this.spreadW, on, dt);
    if (!on && this.spreadW < 1e-3) { this.spreadW = 0; return; }
    const neck = this.bones.get('neck') || this.bones.get('Spine02'), hips = this.bones.get(HIPS);
    if (!neck || !hips) return;
    this.model.updateMatrixWorld(true);
    neck.getWorldPosition(P0); hips.getWorldPosition(P1);
    const dx = P1.x - P0.x, dy = P1.y - P0.y, dz = P1.z - P0.z;
    for (let i = 0; i < 2; i++) {
      const arm = this.bones.get(SPREAD_BONES[i][0]), hand = this.bones.get(SPREAD_BONES[i][1]);
      if (!arm || !hand) continue;
      arm.getWorldPosition(P0); hand.getWorldPosition(P1);
      spreadFix(P1.x - P0.x, P1.y - P0.y, P1.z - P0.z, dx, dy, dz, this.spreadLastCap, this.spreadW, FIX);
      if (!(FIX[3] > 0)) continue;
      arm.parent.getWorldQuaternion(PQ); PQI.copy(PQ).invert();
      RQ.setFromAxisAngle(AX.set(FIX[0], FIX[1], FIX[2]), FIX[3]);
      arm.quaternion.premultiply(PQ).premultiply(RQ).premultiply(PQI);
      arm.updateMatrixWorld(true);
    }
  }

  // 取り除く。人物ごとに作った付属品（太刀・弓・矢筒・縄）の形と材質は、ここで解放する（模型の形・材質は全員で共有なので触らない）。
  // やり直しのたびに作り直すので、解放しないとGPU資源が増え続ける。
  dispose() {
    this.bow?.dispose(); this.mixer.stopAllAction(); this.mixer.uncacheRoot(this.model); this.root.removeFromParent();
    this.model.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); });          // 骨ごとに作られる骨の行列の画像（これが増え続けていた：人物1人につき1枚）
    for (const d of this.drops || []) d.obj.removeFromParent();
    for (const w of Object.values(this.weapons)) w.object?.traverse(o => {
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); }
    });
  }
}
