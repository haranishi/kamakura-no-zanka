// actors.js — 主人公・敵・仲間・村人（app層）。論理（combat / enemy-ai / companion-ai）の状態を読み、動作と位置を決める。
// 規則は論理モジュールが持つ。ここでは「入力→意図→論理の呼び出し→動作・音・演出」の結線だけを書く。
import { pickStep, distanceRule } from './audio-rules.js';
import { stepSurfaceAt, roleOf, gaitOfClip } from './step-surface.js';
import { Character } from './characters.js';
import { GRIP, AUDIO_NOISE } from './config.js';
import { makeYumi, makeArrow, makeQuiver, makeRopes } from './weapons.js';
import { moveActor } from './collision.js';
import { MOVES, createFighter, startMove, setBlock, startDodge, tick, finish, stealthStrike } from './combat.js';
import { createBrain, think } from './enemy-ai.js';
import { createCompanion, thinkCompanion } from './companion-ai.js';
import { createSwordLayer, poseAt } from './sword-layer.js';
import { LUNGE_VIEW, LUNGE_IO, CONTACT_POSE, createLungeIO, solveLunge, lungeInReach, lungeShare, gapScale } from './lunge.js';
import { KNOCK_MOVE, createKnock, startKnock, endKnock, knockStep, knockGap } from './knockback.js';

export const angleDiff = (a, b) => Math.atan2(Math.sin(b - a), Math.cos(b - a));
const turnToward = (cur, target, rate, dt) => { const d = angleDiff(cur, target); return cur + Math.sign(d) * Math.min(Math.abs(d), rate * dt); };
const approach = (cur, target, rate, dt) => cur + Math.sign(target - cur) * Math.min(Math.abs(target - cur), rate * dt);
export const yawOf = (dx, dz) => Math.atan2(-dx, -dz);
export const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export const hashId = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const BUSY = ['attack', 'hit', 'stagger', 'recoil', 'dodge'];

// 技ごとの踏み込み（m）。動作の根の移動は取り除いてあるので、ここで前へ出す。
const LUNGE = { light1: 0.55, light2: 0.45, light3: 0.85, heavy: 0.6, finisher: 0.3, counter: 0.75, soldier_slash: 0.5, soldier_thrust: 0.9, officer_a: 0.5, officer_b: 0.4, officer_c: 0.8 };
// ひるみ（見た目だけ）を強める技：三段目・強斬り・反撃・とどめ（combat.js の STRONG と同じ顔ぶれ＋とどめ）
const STRONG_KICK = new Set(['light3', 'heavy', 'counter', 'finisher']);
export const SPEED = { walk: 2.5, sprint: 5.0, crouch: 1.3, guard: 1.5, patrol: 1.3, orbit: 0.95, run: 3.6, officerRun: 3.2, ally: 2.0, child: 4.2, villager: 1.2 };

class Actor {
  constructor(game, { id, who, x, z, yaw = 0, scale = 1, tint = null, style = 'relaxed', radius = 0.3 }) {
    this.game = game; this.id = id; this.who = who; this.radius = radius;
    this.pos = { x, y: game.terrain.heightAt(x, z), z };
    this.yaw = yaw;
    // 見た目だけの踏み込み（8.3a 第3周・lunge.js）：模型の根の、論理の位置からのずれ（x・y・z）と向きのずれ（turn）。毎コマ使い回す
    this.vis = { x: 0, y: 0, z: 0, turn: 0, t: 0, inst: null, io: createLungeIO(), wx: 0, wz: 0,
      sx: 0, sz: 0, fx: 0, fz: 0, roomF: 0, roomB: 0, gx: 0, gz: 0 };
    this.foe = null;                         // 振りの相手（技を始めたときに決める。踏み込む先）
    this.knock = createKnock();              // 押し戻し（8.4a・knockback.js）。論理の位置を動かす
    this.character = new Character(game.roster, who, { tint, scale, style });
    this.character.onContact = c => this.onFootContact(c);
    game.scene.add(this.character.root);
    this.sync();
  }
  tickCharacter(dt) {
    const ch = this.character, g = this.game;
    ch.contactNear = this.who === 'hero' || dist2(this.pos, g.hero.pos) < 22;
    // Movement is terrain-bound; no jump/fall state currently exists.
    ch.contactAirborne = this.airborne === true;
    ch.contactTimeScale = g.contactTimeScale ?? 1;
    const f = this.fighter;                  // 技の動作は、論理の技の経過で進める（8.3a 第2周。characters.js の followWarp）
    ch.warpClock = f?.state === 'attack' && f.move ? f.move.t : NaN;
    if (f) { this.updateLungeView(dt); this.sync(); }   // 模型の根を先に置く（弾きの打ち合い・抜刀の腕IKは世界の位置で解く）
    ch.update(dt);
  }

  // 見た目だけの踏み込み（8.3a 第3周）：振りの間、模型の根だけを相手へ出し、向きを回して、判定の始めの刃を相手の胴へ通す。
  // 論理の位置・向き（当たりの判定・カメラ・影の追従・足音）は変えない。量と時間の配り方は lunge.js。共用の乱数は使わない。
  updateLungeView(dt) {
    const v = this.vis, f = this.fighter, mv = f.state === 'attack' ? f.move : null, m = mv ? MOVES[mv.id] : null, pose = m ? CONTACT_POSE[m.id] : null;
    if (mv !== v.inst) { v.inst = mv; v.t = 0; if (pose) this.measureLungeRoom(); }
    const t0 = v.t, t1 = mv ? mv.t : 0;
    v.t = t1;
    let wx = 0, wz = 0, wt = 0;
    if (pose && t1 <= m.windup + m.active && this.lungeWant(m, mv, pose, dt)) { wx = v.wx; wz = v.wz; wt = v.io[LUNGE_IO.turn]; }
    const k = lungeShare(pose ? m : null, t0, t1, dt);
    v.x += (wx - v.x) * k; v.z += (wz - v.z) * k; v.turn += (wt - v.turn) * k;
    // 壁・崖：技の始めに測った、前後へ出られる長さ（論理の踏み込みで進んだ分を引く）の内へ
    const along = v.x * v.fx + v.z * v.fz, moved = (this.pos.x - v.sx) * v.fx + (this.pos.z - v.sz) * v.fz;
    const room = Math.max(0, along > 0 ? v.roomF - moved : v.roomB + moved);
    if (Math.abs(along) > room) { const s = room / Math.abs(along); v.x *= s; v.z *= s; }   // along≠0 のときだけ（0÷0 にしない）
    // ほかの人：見た目の中心どうしを minGap 以上（相手の見た目の踏み込みも含めて）
    const g = this.game;
    this.keepGap(g.hero); for (let i = 0; i < g.enemies.length; i++) this.keepGap(g.enemies[i]); if (g.ally) this.keepGap(g.ally);
    v.y = Math.max(-LUNGE_VIEW.maxRise, Math.min(LUNGE_VIEW.maxRise, v.gx * v.x + v.gz * v.z));
  }
  keepGap(o) {
    if (!o || o === this || o.departed || !o.character.root.visible) return;
    const v = this.vis, r = o.character.root.position;
    if (Math.abs(r.x - this.pos.x) > 2.5 || Math.abs(r.z - this.pos.z) > 2.5) return;
    const s = gapScale(this.pos.x, this.pos.z, v.x, v.z, r.x, r.z, LUNGE_VIEW.minGap);
    if (s < 1) { v.x *= s; v.z *= s; }
  }
  // 技の始めに1回：前後へ出られる長さ（静的な当たり・急な斜面・水。論理の移動と同じ規則）と、地面の傾き
  measureLungeRoom() {
    const v = this.vis, g = this.game, p = this.pos, fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw);
    v.sx = p.x; v.sz = p.z; v.fx = fx; v.fz = fz;
    v.roomF = this.straightRoom(fx, fz, LUNGE_VIEW.maxShift + (this.lunge ? this.lunge.rate * this.lunge.dur : 0) + 0.05);
    v.roomB = this.straightRoom(-fx, -fz, -LUNGE_VIEW.minShift + 0.05);
    const h = g.terrain.heightAt, e = 0.5;
    v.gx = (h(p.x + e, p.z) - h(p.x - e, p.z)) / (2 * e); v.gz = (h(p.x, p.z + e) - h(p.x, p.z - e)) / (2 * e);
  }
  // まっすぐ出られる長さ（0.1m刻み。壁に沿って滑った分は数えない：斜めに壁へ向かうと、滑った分だけ根が壁へ入った）
  straightRoom(dx, dz, max) {
    const g = this.game;
    let at = this.pos, d = 0;
    while (d < max - 1e-9) {
      const s = Math.min(0.1, max - d), r = moveActor(g.col, g.terrain, at, dx * s, dz * s, this.radius);
      if (r.blocked || Math.hypot(r.x - at.x - dx * s, r.z - at.z - dz * s) > 0.005) break;
      at = r; d += s;
    }
    return d;
  }
  // 判定の始めに刃を相手の胴へ通す、根のずれ（世界の x・z）と向きのずれ。相手が間合い・弧の外なら false（踏み込まない）
  lungeWant(m, mv, pose, dt) {
    const foe = this.foe, v = this.vis;
    if (!foe || foe === this || !foe.fighter?.alive || foe.departed) return false;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
    const l = this.lunge, rem = l && mv.t < m.windup ? Math.max(0, Math.min(l.dur - l.t, m.windup - mv.t)) * l.rate : 0;
    const px = this.pos.x + fx * rem, pz = this.pos.z + fz * rem;   // 判定の始めに立つ論理の位置（論理の踏み込みの残りの分だけ前）
    const lx = foe.pos.x - px, lz = foe.pos.z - pz;
    if (!lungeInReach(m, foe.fighter.radius, lx * rx + lz * rz, lx * fx + lz * fz)) return false;
    const c = foe.character.root.position, dx = c.x - px, dz = c.z - pz, d = Math.sqrt(dx * dx + dz * dz);
    if (!(d > 1e-6)) return false;
    const guard = foe.fighter.blocking && m.blockable;              // 受けている相手：刃は相手の刀の所で止める
    // 止まるコマ（判定の始めを越える最初のコマ。判定の始めの0〜1コマ後）の姿勢へ合わせる
    const io = v.io, I = LUNGE_IO;
    io[I.W] = m.windup; io[I.t] = mv.t; io[I.dt] = dt; io[I.scale] = this.character.root.scale.x;
    io[I.tx] = dx * rx + dz * rz; io[I.tz] = dx * fx + dz * fz; io[I.depth] = guard ? -LUNGE_VIEW.guard : LUNGE_VIEW.depth;
    solveLunge(pose, io);
    v.wx = io[I.shift] * dx / d; v.wz = io[I.shift] * dz / d;
    return true;
  }
  onFootContact(c) {
    const g = this.game, hero = this.who === 'hero';
    const record = g.footQA?.contact(c);
    const role = roleOf(this.who), gait = hero ? (this.crouch ? 'crouch' : this.stepGait || 'walk') : gaitOfClip(c.clip);
    const surface = stepSurfaceAt(this.pos.x, this.pos.z, { terrain: g.terrain, world: g.world });
    const step = pickStep({ surface, gait, role, foot: c.foot }, g.rng, this.lastStep);
    this.lastStep = step;
    if (hero) {
      g.emitNoise(this.pos.x, this.pos.z, AUDIO_NOISE[gait].radius, 'step');
      if (gait === 'run' && surface !== 'grass') g.fx.dust(this.pos, 1);
    }
    const rule = hero ? { audible: true, gain: 1, lowpassHz: 20000 } : distanceRule(dist2(this.pos, g.hero.pos));
    if (!rule.audible) return;
    const before = g.footQA?.playTime();
    const success = g.audio.playStep(step, { pan: hero ? 0 : g.pan(this.pos), lowpassHz: rule.lowpassHz, gainScale: rule.gain });
    g.footQA?.played(record, before, { surface, gait, role, pitch: step.pitch, gain: step.gain, seed: step.seed, success, rejected: g.audio.stepRejectReason === 'limit' });
  }
  sync() { const r = this.character.root, v = this.vis; r.position.set(this.pos.x + v.x, this.pos.y + v.y, this.pos.z + v.z); r.rotation.y = this.yaw + v.turn + Math.PI; }
  step(dx, dz) {
    const r = moveActor(this.game.col, this.game.terrain, this.pos, dx, dz, this.radius);
    this.pos = { x: r.x, y: r.y, z: r.z };
    return r;
  }
  place(x, z, yaw = this.yaw) {
    this.pos = { x, y: this.game.terrain.heightAt(x, z), z }; this.yaw = yaw; this.character.resetContacts();
    const v = this.vis; v.x = v.y = v.z = v.turn = 0; v.inst = null;   // 置き直し・やり直しでは、見た目の踏み込みを残さない
    endKnock(this.knock);                                               // 押し戻しの残りも残さない
    this.sync();
  }
  // 押し戻し（8.4a）：向き（水平）と距離を受けて、次のコマから updateKnock で論理の位置を動かす
  knockBack(dirX, dirZ, dist) { return startKnock(this.knock, dirX, dirZ, dist); }
  // 1コマ分を押す。壁・水・段差・急な斜面（下りも46度まで）は moveActor の規則で止め、ほかの人へは中心0.72mより近づけない（押された人だけ止める）。
  // 止められたら残りは捨てる（壁に沿って滑らせ続けない）。共用の乱数は使わない
  updateKnock(dt) {
    const k = this.knock;
    if (!(k.dist > 0)) return;
    const d = knockStep(k, dt);
    if (!(d > 0)) return;
    const g = this.game, sx = k.dx * d, sz = k.dz * d;
    let s = this.knockRoom(g.hero, sx, sz, 1);
    for (let i = 0; i < g.enemies.length; i++) s = this.knockRoom(g.enemies[i], sx, sz, s);
    s = this.knockRoom(g.ally, sx, sz, s);
    for (const n of g.npcs.values()) s = this.knockRoom(n, sx, sz, s);
    if (!(s > 0)) { endKnock(k); return; }
    const r = moveActor(g.col, g.terrain, this.pos, sx * s, sz * s, this.radius, KNOCK_MOVE);
    this.pos = { x: r.x, y: r.y, z: r.z };
    if (r.blocked || s < 1) endKnock(k);
  }
  knockRoom(o, sx, sz, s) {
    if (!o || o === this || o.departed || !o.character.root.visible || (o.fighter && !o.fighter.alive) || s <= 0) return s;
    if (Math.abs(o.pos.x - this.pos.x) > 2 || Math.abs(o.pos.z - this.pos.z) > 2) return s;
    return Math.min(s, knockGap(this.pos.x, this.pos.z, sx, sz, o.pos.x, o.pos.z));
  }
  chest() { return { x: this.pos.x, y: this.pos.y + this.character.height * 0.62, z: this.pos.z }; }
  head() { return { x: this.pos.x, y: this.pos.y + this.character.height * 1.02, z: this.pos.z }; }
  remove() { this.character.dispose(); }
}

// ---------------------------------------------------------------------------------------------------------------- 主人公
export class HeroActor extends Actor {
  constructor(game, { x, z, yaw }) {
    super(game, { id: 'hero', who: 'hero', x, z, yaw, style: 'relaxed' });
    this.fighter = createFighter({ id: 'hero', team: 'hero', kind: 'hero', x, z, yaw });
    this.character.setTachi(GRIP, false);
    this.resetState();
  }
  resetState() {
    this.drawn = false; this.sheatheIn = 0; this.crouch = false; this.lunge = null; this.queued = null; this.dodge = null; this.dash = null;
    // 抜刀・納刀の進み具合（8.2）。納刀から始まる
    this.swordLayer = createSwordLayer(); this.character.sword?.reset();
    this.trailCue = null;                // 闇討ちの刃の軌跡の時間割（8.3a）
    this.steepT = 0; this.deadT = 0; this.lockTarget = null; this.lockT = 0; this.speed = 0; this.blockPosed = false; this.dead = false;
    this.scripted = false;               // 演出中は動作を外から決める（冒頭の目覚めなど）
    this.recoverT = 0;
  }
  get alive() { return this.fighter.alive; }

  snapshot() {
    const f = this.fighter;
    return { id: 'hero', team: 'hero', kind: 'hero', x: this.pos.x, z: this.pos.z, yaw: this.yaw, hp: f.hp, hpMax: f.hpMax, posture: f.posture, postureMax: f.postureMax,
      state: f.state, alive: f.alive, crouching: this.crouch, inTallGrass: false, ready: f.alive && f.state === 'idle' && !f.blocking };
  }

  // 位置・体力を戻して立て直す（やり直し・再開）
  reset(x, z, yaw, hpRatio = 1) {
    this.place(x, z, yaw);
    this.fighter = createFighter({ id: 'hero', team: 'hero', kind: 'hero', x, z, yaw });
    this.fighter.hp = Math.max(1, Math.round(this.fighter.hpMax * hpRatio));
    this.resetState();
    this.character.setTachi(GRIP, false);
    this.character.gait = 'idle'; this.character.locoName = null;
  }

  nearestEnemy(maxD, withinDeg, facing) {
    let best = null, bd = maxD;
    for (const e of this.game.enemies) {
      if (!e.fighter.alive || e.departed) continue;
      const d = dist2(this.pos, e.pos);
      if (d >= bd) continue;
      if (withinDeg != null && Math.abs(angleDiff(facing, yawOf(e.pos.x - this.pos.x, e.pos.z - this.pos.z))) > withinDeg * Math.PI / 180) continue;
      best = e; bd = d;
    }
    return best;
  }

  beginMove(id, { aim = true } = {}) {
    const f = this.fighter, m = MOVES[id], ctl = this.ctl;
    if (aim) {
      const want = ctl.axis.active ? ctl.moveYaw : this.yaw;
      const t = this.lockTarget && this.lockTarget.fighter.alive ? this.lockTarget : this.nearestEnemy(3.6, 75, want);
      this.yaw = t ? yawOf(t.pos.x - this.pos.x, t.pos.z - this.pos.z) : want;
      this.foe = t;                          // 見た目の踏み込みの先（8.3a 第3周）。とどめ（aim=false）は updateDash が決める
    }
    f.yaw = this.yaw;
    this.character.playMove(id, { windup: m.windup, active: m.active, recover: m.recover }, { fade: 0.06 });
    const dur = m.windup + m.active, d = LUNGE[id] || 0;
    this.lunge = { rate: d / dur, t: 0, dur };
    this.drawSword({ fast: true });   // 攻撃の開始は遅らせない：刃の出し入れは見た目の層が、予備動作の間に済ませる
    this.blockPosed = false;
  }

  // 抜刀・納刀（8.2）。刀の置き場と見た目は swordLayer／character.sword が決め、規則（攻撃・受けの開始）は待たせない。
  // 抜く＝すぐ構え(guard)の論理へ。納める＝すぐ平時(relaxed)の論理へ。進み具合は swordLayer が持つ。
  drawSword({ fast }) {
    const accepted = this.swordLayer.requestDraw({ fast });
    if (accepted || this.swordLayer.snapshot().mode === 'drawn') { this.drawn = true; this.sheatheIn = Math.max(this.sheatheIn, 4.5); }
    return accepted;
  }
  sheatheSword() { if (this.swordLayer.requestSheathe()) { this.drawn = false; this.character.locoName = null; return true; } return false; }
  // 抜刀の前半（u<0.6）は、腕を下げた平時の姿のまま。刃が鞘から抜け切るころから構えへ移す。
  get guardStance() { const sw = this.swordLayer.snapshot(); return this.drawn && !(sw.mode === 'drawing' && sw.u < 0.6); }
  // 死亡・演出中に入ったとき、途中の層を適用し続けない（倒れる動作へ、固定の腕IKとひねりが重なる）。論理が向かう側（抜く→抜いた、納める→納めた）へ確定する。
  settleSword() {
    const sw = this.swordLayer.snapshot();
    if (sw.mode !== 'drawing' && sw.mode !== 'sheathing') return;
    const toDrawn = sw.mode === 'drawing';
    this.swordLayer.reset(toDrawn ? 'drawn' : 'sheathed');
    this.character.sword?.setFrame({ u: toDrawn ? 1 : 0, mode: toDrawn ? 'drawn' : 'sheathed', pose: poseAt(toDrawn ? 1 : 0), events: [] });
  }
  tickSword(dt) {
    const out = this.swordLayer.tick(dt);
    this.character.sword?.setFrame(out);
    for (const e of out.events) { if (e === 'clear') this.game.audio.play('draw', { gain: 0.8 }); else if (e === 'seat') this.game.audio.play('sheathe'); }
  }

  attackInput(kind) {
    const f = this.fighter;
    if (!f.alive || this.lockT > 0) return;
    // 弾いた直後は、受けを握ったまま左クリックで反撃（受けを解いて斬り返す）
    if (kind === 'light' && f.counterT > 0 && (f.state === 'idle')) {
      if (f.blocking) setBlock(f, false);
      this.blockPosed = false;
      if (startMove(f, 'counter')) { this.beginMove('counter'); return; }
    }
    if (f.blocking) return;
    if (kind === 'heavy') {
      if (f.state === 'idle' && startMove(f, 'heavy')) this.beginMove('heavy'); else this.queued = { kind, t: 0.45 };
      return;
    }
    if (f.state === 'attack' && f.move) {
      const next = { light1: 'light2', light2: 'light3' }[f.move.id];
      if (next && startMove(f, next)) this.beginMove(next); else this.queued = { kind, t: 0.45 };
    } else if (f.state === 'idle' && startMove(f, 'light1')) this.beginMove('light1');
    else if (['dodge', 'hit', 'recoil'].includes(f.state)) this.queued = { kind, t: 0.35 };
  }
  processQueue(dt) {
    const q = this.queued; if (!q) return;
    q.t -= dt;
    if (q.t <= 0) { this.queued = null; return; }
    const f = this.fighter;
    if (q.kind === 'heavy') { if (f.state === 'idle' && startMove(f, 'heavy')) { this.beginMove('heavy'); this.queued = null; } return; }
    if (f.state === 'attack' && f.move) {
      const next = { light1: 'light2', light2: 'light3' }[f.move.id];
      if (next && startMove(f, next)) { this.beginMove(next); this.queued = null; }
    } else if (f.state === 'idle' && startMove(f, 'light1')) { this.beginMove('light1'); this.queued = null; }
  }

  // E：とどめ（崩れた敵の前）＞ 闇討ち（気づかれていない敵の背後）。戻りは行動したか。
  tryInteract() {
    const f = this.fighter, g = this.game;
    if (!f.alive || f.state !== 'idle' || f.blocking || this.lockT > 0) return false;
    let best = null, bd = 3.4;
    for (const e of g.enemies) {
      if (!e.fighter.alive || e.fighter.state !== 'stagger') continue;
      const d = dist2(this.pos, e.pos);
      if (d < bd) { best = e; bd = d; }
    }
    if (best) { this.faceTo(best); this.dash = { target: best, speed: 13 }; return true; }
    for (const e of g.enemies) {
      if (!e.fighter.alive || e.fighter.aware !== false) continue;
      f.x = this.pos.x; f.z = this.pos.z; f.yaw = this.yaw; e.fighter.x = e.pos.x; e.fighter.z = e.pos.z; e.fighter.yaw = e.yaw;
      const res = stealthStrike(f, e.fighter);
      if (!res) continue;
      this.faceTo(e); this.lockT = 0.85; this.speed = 0;
      this.character.playMove('finisher', { windup: 0.22, active: 0.1, recover: 0.5 }, { fade: 0.05 });
      this.trailCue = { t0: g.time, windup: 0.22, active: 0.1 };   // 刃の軌跡（8.3a）：論理の技ではないので、この演出の時間割で出す
      this.drawSword({ fast: true });
      g.battle.onStrike(this, e, res);
      return true;
    }
    return false;
  }
  faceTo(actor) { this.yaw = yawOf(actor.pos.x - this.pos.x, actor.pos.z - this.pos.z); this.fighter.yaw = this.yaw; }
  // とどめは崩れた相手の前まで素早く詰めてから出す
  updateDash(dt) {
    const d = this.dash, t = d.target;
    if (!t.fighter.alive || t.fighter.state !== 'stagger') { this.dash = null; return; }
    const dx = t.pos.x - this.pos.x, dz = t.pos.z - this.pos.z, dist = Math.hypot(dx, dz);
    this.faceTo(t);
    // 1.35mへ詰め終えたかは1mmの幅で見る（ちょうど1.35mへ寄せた後も、丸めで1.3500000000000003mになると、0mずつ詰め続けてとどめが出なかった）
    if (dist > 1.35 + 1e-3) {
      const k = Math.min(dist - 1.35, d.speed * dt);
      this.step(dx / dist * k, dz / dist * k);
      this.speed = d.speed; this.character.locomote(this.speed, 'guard');
      return;
    }
    this.dash = null;
    const f = this.fighter;
    f.x = this.pos.x; f.z = this.pos.z; f.yaw = this.yaw; t.fighter.x = t.pos.x; t.fighter.z = t.pos.z;
    if (finish(f, t.fighter)) { this.foe = t; this.beginMove('finisher', { aim: false }); }
  }

  onCombatEvent(e) {
    if (e.type === 'phase' && e.phase === 'active') this.game.audio.play(e.moveId === 'heavy' || e.moveId === 'finisher' || e.moveId === 'light3' ? 'swing_heavy' : 'swing');   // 三段目は締めの振りの音（8.3a）
    if (e.type === 'phase' && e.phase === 'end') this.lunge = null;
    if (e.type === 'stagger_start') {
      this.character.play('Kneel_on_One_Knee_and_Stand', { fade: 0.08, from: 0, to: 0.95, timeScale: 1.6, onEnd: c => { if (c.current) c.current.paused = true; }, restart: true });
      this.blockPosed = false; this.game.hud.toast('構えが崩れた', 1200);
    }
    // 崩れが解けたら、膝をついた姿勢から立ち上がる動作をそのまま続ける（寝た姿勢から立ち姿へ急に切り替えない）
    if (e.type === 'stagger_end') { this.character.play('Kneel_on_One_Knee_and_Stand', { fade: 0.06, from: 1.0, timeScale: 1.8, restart: true }); this.recoverT = 0.55; }
  }

  update(dt, ctl) {
    this.ctl = ctl;
    const f = this.fighter, g = this.game, input = ctl.input;
    for (const e of tick(f, dt)) this.onCombatEvent(e);
    f.x = this.pos.x; f.z = this.pos.z; f.yaw = this.yaw;
    if (!f.alive) { this.settleSword(); this.updateDead(dt); this.tickCharacter(dt); this.sync(); return; }
    if (this.scripted) { this.settleSword(); this.tickCharacter(dt); this.sync(); return; }
    this.lockT = Math.max(0, this.lockT - dt);
    this.sheatheIn = Math.max(0, this.sheatheIn - dt);
    const inCombat = g.alertedEnemies() > 0;
    if (inCombat && this.drawn) this.sheatheIn = Math.max(this.sheatheIn, 2.5);
    if (inCombat && !this.drawn) this.drawSword({ fast: false });   // 敵が気づいた：落ち着いて抜く（戦闘の始まりの見せ場）
    if (this.drawn && this.sheatheIn === 0 && f.state === 'idle' && !f.blocking && !inCombat) this.sheatheSword();   // 戦闘が終わった：落ち着いて納める

    const locked = ctl.talking || ctl.frozen || this.lockT > 0;
    if (!locked) {
      if (input.wasPressed('KeyC')) this.crouch = !this.crouch && f.state === 'idle';
      if (input.mouseWasPressed(0)) this.attackInput('light');
      if (input.wasPressed('KeyF')) this.attackInput('heavy');
      if (input.wasPressed('KeyE') && !this.tryInteract()) ctl.worldInteract?.();
      if (input.wasPressed('Space')) this.tryDodge();
      const wantBlock = input.mouseDown(2) && !this.dash;
      if (wantBlock && !f.blocking && f.state === 'idle') {
        if (setBlock(f, true)) { this.drawSword({ fast: true }); this.sheatheIn = Math.max(this.sheatheIn, 4); this.crouch = false; this.dash = null; this.blockPosed = false; }
      }
      if (!wantBlock && f.blocking) { setBlock(f, false); this.character.locoName = null; this.blockPosed = false; }
    } else if (f.blocking) { setBlock(f, false); this.character.locoName = null; this.blockPosed = false; }
    this.processQueue(dt);

    if (this.dash && f.state === 'idle') this.updateDash(dt);
    else if (f.state === 'dodge') this.updateDodge(dt);
    else if (f.state === 'attack') this.updateLunge(dt);
    else if (f.state === 'idle') this.updateLocomotion(dt, ctl, locked);
    else this.speed = approach(this.speed, 0, 22, dt);
    this.tickSword(dt);
    this.tickCharacter(dt);
    this.sync();
  }

  tryDodge() {
    const f = this.fighter, ctl = this.ctl;
    if (f.state === 'attack' && f.move && f.move.phase === 'recover' && f.posture > 12) { f.move = null; f.state = 'idle'; f.telegraphing = false; }
    if (f.blocking) setBlock(f, false);
    this.dash = null;
    const dirYaw = ctl.axis.active ? ctl.moveYaw : this.yaw + Math.PI;
    if (!startDodge(f, dirYaw)) return false;
    this.crouch = false;
    this.dodge = { dir: { x: -Math.sin(dirYaw), z: -Math.cos(dirYaw) }, t: 0, T: 0.52, dist: 3.2 };
    this.yaw = dirYaw; f.yaw = this.yaw;
    this.character.playAction('dodge', { timeScale: 2.4 });
    this.game.audio.play('roll');
    this.game.fx.dust(this.pos, 5);
    this.blockPosed = false;
    return true;
  }
  updateDodge(dt) {
    const d = this.dodge; if (!d) return;
    d.t += dt;
    const k = Math.max(0, 1 - d.t / d.T), speed = (d.dist * 2 / d.T) * k;
    this.step(d.dir.x * speed * dt, d.dir.z * speed * dt);
    this.speed = speed;
  }
  updateLunge(dt) {
    const l = this.lunge; this.speed = 0;
    if (!l || l.t >= l.dur) return;
    const k = Math.min(dt, l.dur - l.t); l.t += k;
    this.step(-Math.sin(this.yaw) * l.rate * k, -Math.cos(this.yaw) * l.rate * k);
  }

  updateLocomotion(dt, ctl, locked) {
    if (this.recoverT > 0) { this.recoverT -= dt; this.speed = approach(this.speed, 0, 30, dt); this.blockPosed = false; return; }   // 立ち上がる間は歩かない
    const f = this.fighter, ax = locked ? { active: false } : ctl.axis;
    const sprint = !locked && (ctl.input.down('ShiftLeft') || ctl.input.down('ShiftRight')) && !this.crouch && !f.blocking && ax.active;
    if (sprint) this.crouch = false;
    this.stepGait = this.crouch ? 'crouch' : sprint ? 'run' : 'walk';
    let target = 0;
    if (ax.active) target = this.crouch ? SPEED.crouch : f.blocking ? SPEED.guard : sprint ? SPEED.sprint : SPEED.walk;
    this.speed = approach(this.speed, target, target > this.speed ? 18 : 28, dt);
    if (this.speed > 0.01 && ax.active) {
      this.yaw = turnToward(this.yaw, ctl.moveYaw, f.blocking ? 6 : sprint ? 9 : 14, dt);
      const before = this.pos;
      const moved = this.step(-Math.sin(this.yaw) * this.speed * dt, -Math.cos(this.yaw) * this.speed * dt);
      // 急な斜面に阻まれて進めないまま歩き続けたら、理由を案内する（見えない壁に感じる。第3周の評価：斜面の縁で身動きが取れなかった）
      if (moved.blocked === 'slope' && Math.hypot(this.pos.x - before.x, this.pos.z - before.z) < 0.01) { this.steepT += dt; if (this.steepT > 1.1) this.game.hud.hint('steep', '斜面が急で進めない。別の向きへ回り込もう', 4500); }
      else this.steepT = Math.max(0, this.steepT - dt * 2);
    } else if (this.lockTarget && this.lockTarget.fighter.alive) this.yaw = turnToward(this.yaw, yawOf(this.lockTarget.pos.x - this.pos.x, this.lockTarget.pos.z - this.pos.z), 8, dt);
    if (f.blocking && this.speed < 0.3) {
      if (!this.blockPosed) { this.blockPosed = true; this.character.play('Two_Handed_Parry', { fade: 0.07, from: 0, to: 0.3, onEnd: c => { if (c.current) c.current.paused = true; }, restart: true }); }
      return;
    }
    this.blockPosed = false;
    this.character.locomote(this.speed, this.crouch ? 'crouch' : (this.guardStance || f.blocking) ? 'guard' : 'relaxed');
  }

  // hit は当たりの見た目の情報（battle.js の strikeGeometry）：push＝ひるみの押す向き（相手から自分へ＋刃の進む向き）
  onHit(res, att, hit = null) {
    const f = this.fighter, ch = this.character;
    const from = att ? yawOf(att.pos.x - this.pos.x, att.pos.z - this.pos.z) - this.yaw : 0, push = hit?.push || null;
    if (res.outcome === 'hit') {
      this.game.audio.play('hurt');
      if (f.alive && f.state === 'hit') { ch.playAction(this.game.rng() < 0.5 ? 'hit' : 'hit2', { timeScale: 2.4 }); this.blockPosed = false; }
      ch.kick(1.2, from, push);
    } else if (res.outcome === 'blocked') ch.kick(0.5, from, push);
  }
  die() {
    this.dead = true; this.deadT = 0; this.dash = null; this.queued = null; this.character.armRelax = false;
    this.character.playAction(this.game.rng() < 0.5 ? 'die' : 'die2', { timeScale: 1.1 });
    this.game.audio.play('die'); this.game.fx.dust(this.pos, 8);
  }
  updateDead(dt) { this.deadT += dt; }
}

// ---------------------------------------------------------------------------------------------------------------- 敵
const TINTS = [null, '#ece6d8', '#ddd6c6', '#cfc7b5'];
export class EnemyActor extends Actor {
  constructor(game, def, { alert = 'unaware' } = {}) {
    const isOfficer = def.kind === 'officer', isArcher = def.kind === 'archer', h = hashId(def.id);
    super(game, { id: def.id, who: isOfficer ? 'officer' : 'soldier', x: def.x, z: def.z, yaw: def.yaw || 0, scale: isOfficer ? 1.0 : 0.97 + (h % 7) * 0.01,
      tint: isArcher ? '#a9ad92' : isOfficer ? null : TINTS[h % TINTS.length], radius: isOfficer ? 0.34 : 0.3 });
    this.def = def; this.kind = def.kind; this.group = def.group || null;
    this.fighter = createFighter({ id: def.id, team: 'enemy', kind: def.kind, x: def.x, z: def.z, yaw: def.yaw || 0 });
    this.fighter.aware = alert === 'high';
    this.brain = createBrain(def.kind, { id: def.id, home: { x: def.x, z: def.z }, patrol: (def.patrol || []).map(([x, z]) => ({ x, z })), seed: h, exit: def.exit || game.exitPoint });
    if (alert === 'high') { this.brain.state = 'combat'; this.brain.awareness = 1; this.brain.lastSeen = { x: game.hero.pos.x, z: game.hero.pos.z }; }
    this.lunge = null; this.speedNow = 0; this.deadT = 0; this.idleT = 0; this.departed = false; this.reported = null; this.surrendered = false; this.dormant = false; this.recoverT = 0;
    if (isArcher) this.character.attachBow(GRIP, makeArrow());
    else this.character.setTachi(GRIP, true);
    this.character.rate = 0.94 + (h % 9) * 0.015;
    this.character.time = (h % 50) / 10;
  }
  get alive() { return this.fighter.alive; }

  snapshot() {
    const f = this.fighter;
    return { id: f.id, team: f.team, kind: f.kind, x: this.pos.x, z: this.pos.z, yaw: this.yaw, hp: f.hp, hpMax: f.hpMax, posture: f.posture, postureMax: f.postureMax,
      state: f.state, alive: f.alive, ready: f.alive && f.state === 'idle' && !f.blocking, aware: f.aware };
  }

  onCombatEvent(e) {
    const g = this.game, m = MOVES[e.moveId];
    if (e.type === 'phase' && e.phase === 'active') {
      if (m.kind === 'shot') g.battle.fireArrow(this, e.moveId);
      else g.audio.play(e.moveId === 'officer_c' ? 'swing_heavy' : 'swing', { pan: g.pan(this.pos), gain: 0.8 });
    }
    if (e.type === 'phase' && e.phase === 'windup' && m.telegraph > 0) g.battle.telegraph(this, m);
    if (e.type === 'phase' && e.phase === 'end') this.lunge = null;
    if (e.type === 'stagger_start') {
      this.character.play('Kneel_on_One_Knee_and_Stand', { fade: 0.08, from: 0, to: 0.95, timeScale: 1.5, onEnd: c => { if (c.current) c.current.paused = true; }, restart: true });
      this.lunge = null;
    }
    if (e.type === 'stagger_end') { this.character.play('Kneel_on_One_Knee_and_Stand', { fade: 0.06, from: 1.0, timeScale: 1.8, restart: true }); this.recoverT = 0.55; }
  }

  update(dt) {
    const f = this.fighter, g = this.game;
    for (const e of tick(f, dt)) this.onCombatEvent(e);
    if (!this.departed) this.updateKnock(dt);            // 押し戻し（8.4a）：論理の位置を、技の判定へ写す前に動かす（倒れた体も押す）
    f.x = this.pos.x; f.z = this.pos.z; f.yaw = this.yaw;
    if (this.departed) return;
    if (!f.alive) {
      this.deadT += dt; g.tokens.release(this.id);
      if (this.deadT >= 0.3) this.character.dropWeapon('tachiDrawn', (x, z) => g.terrain.heightAt(x, z));   // 倒れてから、刀が手を離れて落ちる
      this.tickCharacter(dt); this.sync(); return;
    }
    if (this.brain.state === 'surrendered') { g.tokens.release(this.id); this.tickCharacter(dt); this.sync(); return; }
    if (this.brain.departed) { this.departed = true; g.tokens.release(this.id); this.character.root.visible = false; return; }
    if (this.dormant || g.aiPaused) { this.animateFree(dt); this.tickCharacter(dt); this.sync(); return; }
    const view = g.aiView(this);
    // 侍大将の連続技：一段目・二段目の戻りの終わり際（連続の窓）だけ「手が空いた」ことにして、次の技を決めさせる。
    // 敵の頭は手が空いたときしか技を決めないので、二段目・三段目が一度も出なかった。
    const chaining = this.kind === 'officer' && this.chainWindowOpen();
    if (chaining) view.self = { ...view.self, ready: true };
    const { intent, events } = think(this.brain, view, dt);
    this.chaining = chaining;
    // 気づかれていない＝戦闘に入っておらず、離脱もしていない（闇討ちの条件）
    f.aware = !['patrol', 'suspicious', 'search'].includes(this.brain.state);
    this.handleEvents(events);
    this.apply(intent, dt);
    this.tickCharacter(dt);
    this.sync();
  }

  handleEvents(events) {
    const g = this.game;
    for (const e of events) {
      if (e.type === 'alerted') g.battle.onEnemyAlerted(this);
      else if (e.type === 'suspicious') g.audio.play('alert', { gain: 0.35, pan: g.pan(this.pos) });
      else if (e.type === 'shout') g.battle.onEnemyShout(this, e);
      else if (e.type === 'routed' || e.type === 'leader_fled') g.battle.onEnemyRouted(this, e);
      else if (e.type === 'surrendered') { this.surrender(); g.battle.onEnemySurrendered(this); }
    }
  }

  apply(intent, dt) {
    const f = this.fighter, brain = this.brain, g = this.game;
    const busy = BUSY.includes(f.state);
    let target = 0, dir = null;
    if (!busy && intent.move && intent.speed !== 'stop') {
      const dx = intent.move.x - this.pos.x, dz = intent.move.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d > 0.05) {
        dir = { x: dx / d, z: dz / d };
        target = intent.speed === 'run' ? (this.kind === 'officer' ? SPEED.officerRun : SPEED.run) : brain.state === 'combat' ? SPEED.orbit : SPEED.patrol;
      }
    }
    if (this.recoverT > 0) { target = 0; dir = null; }
    this.speedNow = approach(this.speedNow, target, 14, dt);
    if (!busy) {
      let want = this.yaw;
      if (intent.face != null) want = intent.face; else if (dir) want = yawOf(dir.x, dir.z);
      this.yaw = turnToward(this.yaw, want, brain.state === 'combat' ? 10 : 5, dt);
    }
    if (dir && this.speedNow > 0.01 && !busy) {
      this.step(dir.x * this.speedNow * dt, dir.z * this.speedNow * dt);
    }
    if (f.state === 'attack' && this.lunge && this.lunge.t < this.lunge.dur) {
      const l = this.lunge, k = Math.min(dt, l.dur - l.t); l.t += k;
      this.step(-Math.sin(this.yaw) * l.rate * k, -Math.cos(this.yaw) * l.rate * k);
    }
    if (intent.startMove && (!busy || this.chaining)) {
      const hp = g.hero.pos, aim = yawOf(hp.x - this.pos.x, hp.z - this.pos.z);
      if (Math.abs(angleDiff(this.yaw, aim)) < 1.0) this.yaw = aim;
      f.yaw = this.yaw;
      if (startMove(f, intent.startMove)) this.beginMove(intent.startMove);
    }
    if (intent.say) g.battle.bark(this, intent.say);
    if (!busy && f.state === 'idle') this.animateFree(dt);
  }

  chainWindowOpen() {
    const f = this.fighter, m = f.move && MOVES[f.move.id];
    if (f.state !== 'attack' || !m || f.move.phase !== 'recover' || !(m.id === 'officer_a' || m.id === 'officer_b') || !(this.chainRoll < (m.id === 'officer_a' ? 0.75 : 0.55))) return false;
    const next = MOVES[m.id === 'officer_a' ? 'officer_b' : 'officer_c'], end = m.windup + m.active + m.recover;
    return f.move.t + 1e-6 >= end - next.chainWindow && f.move.t < end - 1e-6 && dist2(this.pos, this.game.hero.pos) < 2.7;
  }

  // 振りの相手（見た目の踏み込みの先・8.3a 第3周）：前を向いている方の主人公か仲間。共用の乱数は使わない
  pickFoe() {
    const g = this.game, hero = g.hero, ally = g.ally?.inParty && !g.ally.down ? g.ally : null;
    if (!ally) return hero;
    const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), front = a => { const dx = a.pos.x - this.pos.x, dz = a.pos.z - this.pos.z; return (dx * fx + dz * fz) / (Math.hypot(dx, dz) || 1); };
    return !hero.alive || (front(ally) > front(hero) + 0.2 && dist2(this.pos, ally.pos) < dist2(this.pos, hero.pos)) ? ally : hero;
  }

  beginMove(id) {
    const m = MOVES[id], g = this.game;
    this.chainRoll = g.rng();
    this.foe = this.pickFoe();
    this.character.playMove(id, { windup: m.windup, active: m.active, recover: m.recover }, { fade: 0.1 });
    const dur = m.windup + m.active, d = LUNGE[id] || 0;
    this.lunge = { rate: d / dur, t: 0, dur };
    if (m.kind === 'shot') { g.audio.play('bow_draw', { pan: g.pan(this.pos), gain: 0.8 }); g.battle.bark(this, 'archer'); }
  }

  animateFree(dt) {
    if (this.recoverT > 0) { this.recoverT -= dt; return; }
    const brain = this.brain, ch = this.character, style = this.kind === 'archer' ? 'relaxed' : brain.state === 'combat' ? 'guard' : 'relaxed';
    if (this.speedNow > 0.15) { this.idleT = 0; ch.locomote(this.speedNow, style); return; }
    if (brain.state === 'patrol' && this.def.idleClip) {
      this.idleT -= dt;
      const meta = ch.meta(this.def.idleClip);
      if (ch.currentName !== this.def.idleClip || this.idleT <= 0) { ch.play(this.def.idleClip, { fade: 0.3, restart: ch.currentName !== this.def.idleClip }); this.idleT = (meta?.loop ? 9999 : (meta?.seconds || 5)) + 0.4; ch.locoName = null; }
      return;
    }
    ch.locomote(0, style);
  }

  // hit は当たりの見た目の情報（battle.js の strikeGeometry）。鎧でひるまない（論理の 'hit' にならない）一・二発目にも、
  // 上体を押された向きへしならせる（見た目だけ。強い技は1.25倍。8.3a 第2周）
  onHit(res, att, hit = null) {
    const f = this.fighter, ch = this.character, brain = this.brain;
    if (!['combat', 'retreat', 'surrendered'].includes(brain.state) && f.alive) { brain.state = 'combat'; brain.awareness = 1; brain.lastSeen = { x: this.game.hero.pos.x, z: this.game.hero.pos.z }; f.aware = true; }
    this.dormant = false;
    if (res.dead) { this.die(); return; }
    const from = att ? yawOf(att.pos.x - this.pos.x, att.pos.z - this.pos.z) - this.yaw : 0, push = hit?.push || null;
    if (res.outcome === 'hit') {
      // 被弾の動作は Hit_Reaction_1（hit2）だけにする（8.4a）。Hit_Reaction と Hit_Reaction_to_Waist は、刀を持った腕が横へ80〜100度跳ね上がり、
      // 両腕を水平に広げた棒立ち（T字）に見えた（実測：上腕の横への開き。hit2 は判定の0.3秒の間ずっと37度以下）。
      // 共用の乱数は前と同じだけ使う（引く回数を変えると、その後の敵の判断がずれる）
      if (f.state === 'hit') { this.game.rng(); ch.playAction('hit2', { timeScale: 2.4 }); }
      ch.kick((this.kind === 'officer' ? 0.8 : 1.15) * (STRONG_KICK.has(res.moveId) ? 1.25 : 1), from, push);
    } else if (res.outcome === 'blocked') ch.kick(0.4, from, push);
    else if (res.outcome === 'parried') ch.play('Hit_Reaction_to_Waist', { fade: 0.06, from: 0.1, timeScale: 1.9, restart: true });
  }
  die() {
    this.deadT = 0; this.character.armRelax = false;
    this.character.playAction(this.game.rng() < 0.5 ? 'die' : 'die2', { timeScale: 1.25 });
    this.game.audio.play('die', { pan: this.game.pan(this.pos) });
    this.game.fx.dust(this.pos, 8);
    if (this.character.bow) this.character.bow.rest();
  }
  surrender() {
    this.surrendered = true;
    this.character.play('Kneel_on_One_Knee_and_Stand', { fade: 0.2, from: 0, to: 0.95, timeScale: 1.2, onEnd: c => { if (c.current) c.current.paused = true; }, restart: true });
    const w = this.character.weapons.tachiDrawn; if (w) w.holder.visible = false;
    const y = this.character.weapons.yumi; if (y) y.holder.visible = false;
  }
}

// ---------------------------------------------------------------------------------------------------------------- 仲間（弓手）
export class AllyActor extends Actor {
  constructor(game, { x, z, yaw, captive = true }) {
    super(game, { id: 'archer', who: 'archer', x, z, yaw, style: 'injured' });
    this.fighter = createFighter({ id: 'archer', team: 'ally', kind: 'archer_ally', x, z, yaw });
    this.companion = createCompanion({ id: 'archer', mode: 'follow' });
    this.character.attachBow(GRIP, makeArrow());
    this.role = captive ? 'captive' : 'party';
    this.speedNow = 0; this.lunge = null; this.down = false; this.standT = 0; this.shootTarget = null;
    if (captive) { this.character.weapons.yumi.holder.visible = false; this.character.play('Sit_Cross_Legged_on_Floor', { fade: 0 }); this.character.attach('rope', makeRopes(), { bone: 'Spine01', pos: [0, 0.0, 0] }); }
  }
  get inParty() { return this.role === 'party'; }
  get alive() { return !this.down; }

  // 縄を解かれて立ち、仲間に加わる
  join(instant = false) {
    this.role = 'party'; this.standT = instant ? 0 : 2.4; this.character.weapons.yumi.holder.visible = true;
    if (this.character.weapons.rope) this.character.weapons.rope.holder.visible = false;     // 縄は解かれる
    if (!instant) this.character.play('Kneel_on_One_Knee_and_Stand', { fade: 0.25, timeScale: 1.1, restart: true });
    else this.character.locoName = null;
  }
  setMode(mode) {
    const c = this.companion;
    c.mode = mode; c.retryIn = 0; if (!this.down) c.state = 'ready';
    if (mode === 'hold') c.holdPoint = { x: this.pos.x, z: this.pos.z };
    else if (mode === 'retreat') c.holdPoint = { x: this.game.world.start.x - 2, z: this.game.world.start.z + 2 };
    else c.holdPoint = null;
  }

  snapshot() {
    const f = this.fighter;
    return { id: f.id, team: f.team, kind: f.kind, x: this.pos.x, z: this.pos.z, yaw: this.yaw, hp: f.hp, hpMax: f.hpMax, state: f.state, alive: f.alive,
      ready: f.alive && f.state === 'idle' && !f.blocking && this.standT <= 0 };
  }

  onCombatEvent(e) {
    if (e.type === 'phase' && e.phase === 'active' && MOVES[e.moveId].kind === 'shot') this.game.battle.fireArrow(this, e.moveId);
    if (e.type === 'phase' && e.phase === 'end') this.lunge = null;
  }

  update(dt) {
    const f = this.fighter, g = this.game;
    for (const e of tick(f, dt)) this.onCombatEvent(e);
    f.x = this.pos.x; f.z = this.pos.z; f.yaw = this.yaw;
    if (this.role === 'captive') { this.tickCharacter(dt); this.sync(); return; }
    if (this.standT > 0) { this.standT -= dt; this.tickCharacter(dt); this.sync(); if (this.standT <= 0) this.character.locoName = null; return; }
    // 倒れても死なない：論理側が「倒れ」を保つので、戦闘側の死亡をここで受ける
    const self = this.snapshot();
    const view = { t: g.time, self, hero: { ...g.hero.snapshot() }, enemies: g.enemies.filter(e => e.fighter.alive && !e.departed && e.brain.state !== 'surrendered').map(e => e.snapshot()), world: g.aiWorld };
    const { intent, events } = thinkCompanion(this.companion, view, dt);
    for (const e of events) {
      if (e.type === 'down') {
        this.down = true; f.alive = true; f.hp = 0; f.state = 'down'; f.move = null; f.blocking = false;
        this.character.play('Knock_Down', { fade: 0.08, from: 0, to: 1.6, timeScale: 1.3, onEnd: c => { if (c.current) c.current.paused = true; }, restart: true });
        g.hud.toast('弥十郎が倒れた。敵が離れれば、起き上がる', 2600); g.audio.play('hurt', { pan: g.pan(this.pos) });
      } else if (e.type === 'recovered') {
        this.down = false; f.alive = true; f.hp = Math.max(f.hp, f.hpMax * 0.3); f.state = 'idle'; this.standT = 3.0;
        this.character.play('Stand_Up2', { fade: 0.15, timeScale: 1.1, restart: true });
        g.hud.toast('弥十郎が起き上がった', 1800);
      }
    }
    if (this.down) { this.tickCharacter(dt); this.sync(); return; }
    this.apply(intent, dt);
    this.tickCharacter(dt);
    this.sync();
  }

  apply(intent, dt) {
    const f = this.fighter, g = this.game;
    const busy = BUSY.includes(f.state);
    let target = 0, dir = null;
    if (!busy && intent.move && intent.speed !== 'stop') {
      dir = intent.move;                     // 仲間AIの move は「進む向き」（単位ベクトル）
      const d = dist2(this.pos, g.hero.pos);
      target = SPEED.ally * Math.min(1, 0.6 + d * 0.12) * (1 + Math.max(0, Math.min(1.6, (d - 5) / 6)));   // 離れたら急いで追いつく。15m離れれば主人公の走り(5m/s)を超える（主人公の走りに19m離された）
    }
    this.speedNow = approach(this.speedNow, target, 9, dt);
    if (intent.startMove && !busy && intent.shoot) {
      const t = g.enemies.find(e => e.id === intent.shoot.targetId);
      if (t) { this.yaw = yawOf(t.pos.x - this.pos.x, t.pos.z - this.pos.z); this.shootTarget = t; }
      f.yaw = this.yaw;
      if (startMove(f, intent.startMove)) {
        const m = MOVES[intent.startMove];
        this.character.playMove(intent.startMove, { windup: m.windup, active: m.active, recover: m.recover }, { fade: 0.1 });
        g.audio.play('bow_draw', { pan: g.pan(this.pos), gain: 0.7 });
        this.speedNow = 0; dir = null;
      }
    }
    if (!busy) {
      if (dir) this.yaw = turnToward(this.yaw, yawOf(dir.x, dir.z), 8, dt);
      else if (intent.face != null) this.yaw = turnToward(this.yaw, intent.face, 8, dt);
    }
    if (dir && this.speedNow > 0.01 && !busy) {
      this.step(dir.x * this.speedNow * dt, dir.z * this.speedNow * dt);
    }
    if (!busy && f.state === 'idle') this.character.locomote(this.speedNow, 'injured');
  }

  onHit(res, att, hit = null) {
    const from = att ? yawOf(att.pos.x - this.pos.x, att.pos.z - this.pos.z) - this.yaw : 0;
    if (res.outcome === 'hit') { this.character.kick(1.0, from, hit?.push || null); this.game.audio.play('hurt', { pan: this.game.pan(this.pos), gain: 0.8 }); }
  }
}

// ---------------------------------------------------------------------------------------------------------------- 村人
export class NpcActor extends Actor {
  constructor(game, def) {
    super(game, { id: def.id, who: def.who, x: def.x, z: def.z, yaw: def.yaw || 0, scale: def.who === 'child' ? 1 : 0.98 + (hashId(def.id) % 5) * 0.012, style: 'villager' });
    this.def = def; this.role = def.role; this.goal = null; this.speedNow = 0; this.mode = 'idle'; this.clipT = 0; this.facePoint = null;
    this.character.time = (hashId(def.id) % 40) / 10;
  }
  runTo(x, z, then, speed = SPEED.child) { this.goal = { x, z, then, speed }; this.mode = 'run'; this.clipT = 0; }
  setCower(on) { this.mode = on ? 'cower' : 'idle'; this.clipT = 0; this.character.locoName = null; }
  lookAt(p) { this.facePoint = p; }
  idleClip() {
    switch (this.role) {
      case 'rice': return 'Pull_Radish';
      case 'old': case 'chat': return 'Stand_and_Chat';
      case 'tsubaki': case 'talk': return 'Talk_with_Hands_Open';
      case 'walker': return 'Stand_and_Chat';
      default: return 'Long_Breathe_and_Look_Around';
    }
  }
  // 里の道を往復する（着くたびに少し立ち止まる）
  setRoute(points, from = 0) { this.route = points.map(([x, z]) => ({ x, z })); this.routeI = from; this.routeDir = 1; this.mode = 'route'; this.waitT = 0; }
  update(dt) {
    const ch = this.character;
    if (this.mode === 'run' && this.goal) {
      const dx = this.goal.x - this.pos.x, dz = this.goal.z - this.pos.z, d = Math.hypot(dx, dz);
      if (d < 0.9) { const then = this.goal.then; this.goal = null; this.mode = 'idle'; this.speedNow = 0; this.clipT = 0; then?.(this); }
      else {
        this.yaw = turnToward(this.yaw, yawOf(dx, dz), 9, dt);
        this.speedNow = approach(this.speedNow, d < 3 ? Math.min(2.4, this.goal.speed) : this.goal.speed, 14, dt);
        this.step(dx / d * this.speedNow * dt, dz / d * this.speedNow * dt);
        ch.locomote(this.speedNow, 'villager');
      }
    } else if (this.mode === 'route' && this.route) {
      if (this.waitT > 0) {
        this.waitT -= dt; this.speedNow = approach(this.speedNow, 0, 6, dt);
        const clip = this.idleClip(); if (ch.currentName !== clip) { ch.play(clip, { fade: 0.35 }); ch.locoName = null; }
      } else {
        const p = this.route[this.routeI], dx = p.x - this.pos.x, dz = p.z - this.pos.z, d = Math.hypot(dx, dz);
        if (d < 0.8) { if (this.routeI + this.routeDir < 0 || this.routeI + this.routeDir >= this.route.length) this.routeDir = -this.routeDir; this.routeI += this.routeDir; this.waitT = 2.5 + (hashId(this.id) % 30) / 10; }
        else { this.yaw = turnToward(this.yaw, yawOf(dx, dz), 5, dt); this.speedNow = approach(this.speedNow, SPEED.villager, 4, dt); this.step(dx / d * this.speedNow * dt, dz / d * this.speedNow * dt); ch.locomote(this.speedNow, 'villager'); }
      }
    } else if (this.mode === 'cower') {
      if (ch.currentName !== 'Sit_Cross_Legged_on_Floor') { ch.play('Sit_Cross_Legged_on_Floor', { fade: 0.5 }); ch.locoName = null; }
    } else {
      if (this.facePoint) this.yaw = turnToward(this.yaw, yawOf(this.facePoint.x - this.pos.x, this.facePoint.z - this.pos.z), 5, dt);
      this.clipT -= dt;
      const clip = this.idleClip(), meta = ch.meta(clip);
      if (ch.currentName !== clip || this.clipT <= 0) { ch.play(clip, { fade: 0.35, restart: ch.currentName !== clip }); this.clipT = (meta?.loop ? 9999 : (meta?.seconds || 5)) + 0.6; ch.locoName = null; }
    }
    this.tickCharacter(dt);
    this.sync();
  }
}
