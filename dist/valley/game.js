// game.js — 隠れ谷の縦切りの本体（app層）。任務（quest.js）の効果を世界へ配り、操作・カメラ・敵・仲間・UI・保存を結ぶ。
// 規則は論理モジュールが持つ。ここは「いつ何を出し、何を見せ、どこへ戻すか」だけを決める。
import * as THREE from 'three';
import { WORLD } from './world-data.js';
import { buildColliders, rayClip } from './collision.js';
import { createAIWorld } from './ai-world.js';
import { propColliders } from './world-colliders.js';
import { HeroActor, EnemyActor, AllyActor, NpcActor, SPEED, yawOf, dist2 } from './actors.js';
import { Battle } from './battle.js';
import { CameraRig } from './camera-rig.js';
import { FX } from './fx.js';
import { createQuest, reduce, exportProgress, restoreProgress } from './quest.js';
import { STORY } from './story-data.js';
import { loadValley, saveValley } from './save.js';
import { FEEL } from './config.js';
import { mulberry32 } from './scatter.js';
import { SHOTS } from './shots.js';

const PLACE_ZONES = ['viewpoint', 'temple_steps'];
const GROUP_KINDS = { boy: 'npc', road_scout: 'enemy', village_enemies: 'enemy', escort_ambush: 'enemy' };

export class Game {
  constructor({ scene, camera, renderer, post, atmosphere, veg, props, water, terrain, scatter, roster, hud, audio, input, storage, seed = 1333 }) {
    Object.assign(this, { scene, camera, renderer, post, atmosphere, veg, props, water, terrain, scatter, roster, hud, audio, input, storage });
    this.world = WORLD; this.rng = mulberry32(seed);
    this.time = 0; this.stopT = 0; this.timers = []; this.paused = false; this.aiPaused = false;
    this.flow = 'idle';                       // idle | play | choice | dead | result
    this.enemies = []; this.npcs = new Map(); this.ally = null; this.noises = [];
    this.exitPoint = { ...WORLD.exit };
    const extra = propColliders(WORLD);
    this.col = buildColliders({ buildings: WORLD.buildings, props: WORLD.props, trees: scatter.trees, bounds: WORLD.bounds, extraCircles: extra.circles, extraBoxes: extra.boxes });
    this.aiWorld = createAIWorld({ terrain, col: this.col, bounds: WORLD.bounds, now: () => this.time });
    this.tokens = this.aiWorld.createTokens(2);
    this.rig = new CameraRig(camera);
    this.fx = new FX(scene);
    this.battle = new Battle(this);
    this.hero = new HeroActor(this, { x: WORLD.start.x, z: WORLD.start.z, yaw: WORLD.start.yaw });
    this.hero.character.root.visible = false;           // タイトルでは姿を出さない（始めたとき見せる）
    this.quest = createQuest(); this.cpPos = {}; this.inZone = {}; this.pendingDialogue = null; this.ending = null;
    this.lostFood = 0; this.pillageT = 0; this.promptKey = ''; this.deathT = 0; this.heroWasAlive = true;
    this.lock = null; this.listenerT = 0; this.markerT = 0; this.enemySnaps = null; this.enemySnapsAt = -1;
    this.cine = null; this.intro = null;
    this.stats = { kills: 0, parries: 0, stealth: 0 };
    this.settings = { sens: 1, invert: false, shake: 1, subs: true };
  }

  // ------------------------------------------------------------------ 時間・小道具
  after(sec, fn) { this.timers.push({ t: this.time + sec, fn }); }
  hitStop(sec) { this.stopT = Math.max(this.stopT, sec * (this.settings.shake > 0 ? 1 : 0.5)); }
  pan(p) {
    const dx = p.x - this.camera.position.x, dz = p.z - this.camera.position.z, l = Math.hypot(dx, dz) || 1;
    const rx = Math.cos(this.rig.yaw), rz = -Math.sin(this.rig.yaw);
    return Math.max(-1, Math.min(1, (dx * rx + dz * rz) / l * 0.8));
  }
  emitNoise(x, z, radius, kind) { this.noises.push({ t: this.time, kind, x, z, radius }); }
  alertedEnemies() { let n = 0; for (const e of this.enemies) if (e.fighter.alive && !e.departed && !e.dormant && e.brain.state === 'combat') n++; return n; }

  aiView(e) {
    if (this.enemySnapsAt !== this.time) { this.enemySnaps = this.enemies.filter(o => o.fighter.alive && !o.departed).map(o => o.snapshot()); this.enemySnapsAt = this.time; }
    return { t: this.time, self: e.snapshot(), hero: this.hero.snapshot(), allies: this.enemySnaps, noises: this.noises, world: this.aiWorld, tokens: this.tokens };
  }

  // ------------------------------------------------------------------ 世界の組み立て
  clearActors() {
    for (const e of this.enemies) e.remove();
    for (const n of this.npcs.values()) n.remove();
    this.ally?.remove();
    this.enemies = []; this.npcs.clear(); this.ally = null; this.tokens.reset(); this.aiWorld.clear(); this.battle.clear(); this.lock = null; this.hero.lockTarget = null;
  }

  makeEnemies(group, { alert = 'unaware', dormant = false } = {}) {
    for (const def of WORLD.spawns[group]) {
      if (this.enemies.some(e => e.id === def.id)) continue;
      const e = new EnemyActor(this, { ...def, group }, { alert });
      e.dormant = dormant; this.enemies.push(e);
    }
  }
  makeNpc(id) {
    const def = WORLD.spawns.villagers.find(v => v.id === id);
    if (!def || this.npcs.has(id)) return this.npcs.get(id);
    const n = new NpcActor(this, def); this.npcs.set(id, n); return n;
  }
  // 里を取り戻したあと家から出てくる人々。walk=true なら戸口から持ち場へ歩く、false ならもう持ち場にいる（つづき・やり直し）
  makeRevived(walk) {
    const made = [];
    for (const d of WORLD.spawns.revived) {
      if (this.npcs.has(d.id)) continue;
      const from = walk ? d.door : d.route ? d.route[1] : d.spot;
      const n = new NpcActor(this, { id: d.id, who: d.who, x: from[0], z: from[1], yaw: d.yaw, role: d.role });
      this.npcs.set(d.id, n); made.push([n, d]);
    }
    for (const [n, d] of made) {                                    // 相手が揃ってから向きを決める
      const settle = () => { if (d.route) n.setRoute(d.route, 2); else if (d.face) n.lookAt(this.npcs.get(d.face)?.pos || null); };
      const goal = d.route ? d.route[1] : d.spot;
      if (walk) n.runTo(goal[0], goal[1], settle, SPEED.villager); else settle();
    }
  }
  makeCaptive(joined = false) {
    if (this.ally) return;
    const c = WORLD.spawns.captive;
    this.ally = new AllyActor(this, { x: c.x, z: c.z, yaw: c.yaw, captive: !joined });
  }

  // 任務の段階に合わせて、世界にいる人を作り直す（はじめから・つづきから・やり直しで共通）
  buildWorld() {
    this.clearActors();
    const q = this.quest, beat = q.beat, flags = q.flags;
    const order = ['b0_temple', 'b1_boy', 'b2_road', 'b3_viewpoint', 'b4_village', 'b5_archer', 'b6_escort', 'b7_result', 'done'];
    const at = order.indexOf(beat);
    // 里の人
    for (const id of ['v_work1', 'v_work2']) this.makeNpc(id);
    const old = this.makeNpc('v_old'), tsu = this.makeNpc('v_tsubaki');
    const raid = at <= 4;                                          // 略奪の最中は里の人が座り込んで隠れている
    old.setCower(raid); tsu.setCower(raid);
    if (at >= 1 && at <= 6) { const boy = this.makeNpc('boy'); boy.place(-88.4, -74.5, 2.3); if (at >= 2) boy.setCower(true); }
    // 敵
    if (at === 2) this.makeEnemies('road_scout', { alert: 'unaware' });
    if (at <= 4) this.makeEnemies('village_enemies', { alert: at === 4 && flags.approach === 'front' ? 'high' : 'unaware', dormant: at < 3 });
    if (at >= 5 && at <= 6) this.makeRevived(false);
    if (at <= 5 && !flags.archerJoined) this.makeCaptive(false);
    if (flags.archerJoined || at >= 6) {
      this.makeCaptive(true); this.ally.join(true);
      const h = this.hero.pos; this.ally.place(h.x - Math.sin(this.rig.yaw + 2.6) * 3, h.z - Math.cos(this.rig.yaw + 2.6) * 3);
      this.hud.setParty(true, this.modeLabel('follow'));
    } else this.hud.setParty(false);
    if (at === 6 && flags.ambush !== 'cleared') this.makeEnemies('escort_ambush', { alert: flags.ambush === 'active' ? 'high' : 'unaware', dormant: flags.ambush !== 'active' });
    if (at >= 7) this.setupResultScene(true);
    this.inZone = {};
    this.hud.setObjective(q.story.beats[beat].objective);
  }

  // ------------------------------------------------------------------ 開始・つづき・やり直し
  placeHeroAt(p, hpRatio = 1) {
    this.hero.reset(p.x, p.z, p.yaw ?? 0, hpRatio);
    this.rig.yaw = p.yaw ?? 0; this.rig.pitch = 0.2; this.rig.snap();
    this.rig.update(0.016, this.hero.pos, { rayClip: null });
  }
  startNew() {
    this.freshRun = true;
    this.quest = createQuest(); this.cpPos = {}; this.ending = null; this.lostFood = 0; this.stats = { kills: 0, parries: 0, stealth: 0 };
    this.hero.character.root.visible = true;
    const y = WORLD.zones.temple_yard;
    this.placeHeroAt({ x: WORLD.start.x, z: WORLD.start.z, yaw: yawOf(y.x - WORLD.start.x, y.z - WORLD.start.z) });
    this.buildWorld(); this.begin();
    if (this.skipIntro) this.hud.hint('move', STORY.hints.move, 9000); else this.startIntro();
  }
  continueGame() {
    const { state, hasSave } = loadValley(this.storage);
    if (!hasSave) return this.startNew();
    this.freshRun = false;
    this.quest = restoreProgress(STORY, state); this.ending = null; this.lostFood = 0;
    const cp = WORLD.checkpoints[this.quest.checkpoint] || { x: WORLD.start.x, z: WORLD.start.z, yaw: -2.2 };
    this.placeHeroAt(cp);
    this.buildWorld(); this.begin();
    if (this.quest.beat === 'done') this.showResult();
  }
  begin() {
    this.hero.character.root.visible = true;
    this.flow = this.quest.beat === 'done' ? 'result' : 'play';
    this.hud.setState('play'); this.hud.showHUD(true); this.hud.hideTitle(); this.hud.showDeath(false); this.hud.hideResult(); this.hud.fade(false);
    this.hud.setBars(this.hero.fighter.hp, this.hero.fighter.hpMax, this.hero.fighter.posture, this.hero.fighter.postureMax);
    this.input.setEnabled(true); this.heroWasAlive = true; this.deathT = 0; this.deathShown = false;
    this.hud.setObjective(this.quest.story.beats[this.quest.beat].objective);
    this.hud.setFood(this.quest.beat === 'b4_village' ? this.quest.resources.food / 100 : null);
  }
  retry() {
    if (this.flow !== 'dead') return;
    this.hud.showDeath(false); this.hud.fade(true);
    this.after(0.6, () => {
      this.dispatch({ type: 'retry' });
      const cp = WORLD.checkpoints[this.quest.checkpoint];
      const y = WORLD.zones.temple_yard;
      this.placeHeroAt(cp || { x: WORLD.start.x, z: WORLD.start.z, yaw: yawOf(y.x - WORLD.start.x, y.z - WORLD.start.z) });
      this.pendingDialogue = null; this.lostFood = 0;
      this.buildWorld();
      this.flow = 'play'; this.heroWasAlive = true; this.deathT = 0; this.deathShown = false; this.input.requestLock();
      if (this.quest.beat === 'b3_viewpoint') this.after(0.9, () => { if (this.flow === 'play' && this.quest.beat === 'b3_viewpoint') this.showChoice(); });   // 道を選び直せる
      this.hud.setBars(this.hero.fighter.hp, this.hero.fighter.hpMax, this.hero.fighter.posture, this.hero.fighter.postureMax);
      this.hud.setFood(this.quest.beat === 'b4_village' ? this.quest.resources.food / 100 : null);
      this.hud.fade(false);
    });
  }
  toCheckpoint() { if (this.flow === 'play' || this.flow === 'dead') { this.flow = 'dead'; if (!this.quest.pendingRetry) this.dispatch({ type: 'player_down' }); this.retry(); } }

  // ------------------------------------------------------------------ 冒頭の目覚め・演出カメラ
  // 廃寺の庭で目覚める（横たわる → 頭をもたげる → 立ち上がる）。E・Space・クリックで飛ばせる。
  startIntro() {
    const h = this.hero, st = WORLD.start;
    h.scripted = true; h.place(st.x, st.z, yawOf(-0.6, 0.8));
    h.character.armRelax = false; h.character.playAction('wake', { timeScale: 1.25 });
    this.intro = { t: 0, stood: false };
    this.flow = 'intro';
    this.hud.showHUD(false); this.hud.fadeInstant(true);
    this.after(0.3, () => this.hud.fade(false));
    this.setCine({ pos: [st.x + 5.2, 0.95, st.z + 5.6], look: [st.x, 0.45, st.z], fov: 42 }, 1);
  }
  updateIntro(dt) {
    const it = this.intro; if (!it) return;
    it.t += dt;
    const skip = this.input.wasPressed('KeyE') || this.input.wasPressed('Space') || this.input.mouseWasPressed(0);
    if (it.t > 2.7 && !it.stood) { it.stood = true; this.hero.character.playAction('getup', { timeScale: 1.45 }); this.cine && (this.cine.shot = { pos: [WORLD.start.x + 4.2, 1.5, WORLD.start.z + 4.6], look: [WORLD.start.x, 1.0, WORLD.start.z], fov: 44 }); }
    if (it.t > 5.2 || (skip && it.t > 0.6)) this.endIntro();
  }
  endIntro() {
    const h = this.hero; this.intro = null;
    h.scripted = false; h.character.armRelax = true; h.character.locoName = null; h.character.gait = 'idle';
    this.flow = 'play'; this.clearCine();
    // 起き上がった向きのまま、庭（廃寺の石段の方）へ向けてカメラを置く
    const y = WORLD.zones.temple_yard; this.rig.yaw = yawOf(y.x - h.pos.x, y.z - h.pos.z); this.rig.pitch = 0.2;
    this.hud.showHUD(true); this.hud.hint('move', STORY.hints.move, 9000);
  }
  // 固定の演出カメラへ滑らかに移る（k が 0→1）。解除すると元のカメラへ戻る。pos/look の y は地面からの高さ（m）
  setCine(shot, k0 = 0) { this.cine = { shot, k: k0, target: 1 }; }
  clearCine() { if (this.cine) this.cine.target = 0; }
  applyCine(dt) {
    const c = this.cine; if (!c) return;
    c.k += (c.target - c.k) * (1 - Math.exp(-(c.target ? 3.2 : 4.5) * dt));
    if (c.target === 0 && c.k < 0.01) { this.cine = null; return; }
    const sh = c.shot, T = this.terrain, pos = new THREE.Vector3(sh.pos[0], sh.pos[1] + T.heightAt(sh.pos[0], sh.pos[2]), sh.pos[2]);
    const look = new THREE.Vector3(sh.look[0], sh.look[1] + T.heightAt(sh.look[0], sh.look[2]), sh.look[2]);
    const m = new THREE.Matrix4().lookAt(pos, look, new THREE.Vector3(0, 1, 0)), q = new THREE.Quaternion().setFromRotationMatrix(m);
    const e = c.k * c.k * (3 - 2 * c.k);
    this.camera.position.lerp(pos, e); this.camera.quaternion.slerp(q, e);
    if (sh.fov) { const f = this.camera.fov + (sh.fov - this.camera.fov) * e; if (Math.abs(f - this.camera.fov) > 0.01) { this.camera.fov = f; this.camera.updateProjectionMatrix(); } }
  }

  // ------------------------------------------------------------------ 任務
  dispatch(event) {
    const prev = this.quest.beat;
    const { state, effects } = reduce(this.quest, event);
    this.quest = state;
    for (const fx of effects) this.applyEffect(fx);
    if (state.beat !== prev) this.onBeatChange(prev, state.beat);
    this.log?.push({ t: +this.time.toFixed(2), event, beat: state.beat });
  }
  applyEffect(e) {
    switch (e.type) {
      case 'objective': this.hud.setObjective(e.text); break;
      case 'dialogue': this.queueDialogue(e.id); break;
      case 'spawn': this.activateGroup(e.group, e.alert, e.late); break;
      case 'despawn': this.despawnGroup(e.group); break;
      case 'checkpoint': this.saveCheckpoint(e.id); break;
      case 'resources': this.onResources(e.delta); break;
      case 'ending': this.ending = e.summary; break;
      case 'toast': this.hud.toast(e.text); break;
      default: break;
    }
  }
  onBeatChange(prev, next) {
    if (next === 'b3_viewpoint') for (const e of this.enemies) if (e.group === 'village_enemies') e.dormant = false;
    if (next === 'b6_escort') this.makeEnemies('escort_ambush', { alert: 'unaware', dormant: true });
    if (next === 'b7_result') this.setupResultScene(false);
    if (next !== 'b4_village') this.hud.setFood(null);
    const hints = { b2_road: 'crouch', b6_escort: 'command' };
    if (hints[next]) this.hud.hint(hints[next], STORY.hints[hints[next]], 7000);
  }
  reportDown(enemy, how, extra = {}) {
    if (enemy.reported) return;
    enemy.reported = how; this.tokens.release(enemy.id); this.aiWorld.forget(enemy.id);
    if (how === 'killed') this.stats.kills++;
    this.dispatch({ type: 'enemy_down', id: enemy.id, how, ...extra });
  }
  onResources(delta) {
    if (delta.food) {
      this.lostFood += -delta.food;
      if (this.lostFood >= 5) { this.lostFood = 0; this.hud.toast('倉の米が荷車へ運ばれていく', 1600); }
      this.hud.setFood(this.quest.resources.food / 100);
    }
    if (delta.morale) this.hud.toast('仲間の士気が上がった', 1800);
  }
  saveCheckpoint(id) {
    const p = this.hero.pos;
    this.cpPos[id] = { x: p.x, z: p.z, yaw: this.hero.yaw };
    if (id !== 'cp_result') this.hud.toast('区切りを保存した', 1400);
    this.persist();
  }
  // 保存。はじめからの最初の保存だけは、前の遊びの記録を引き継がない
  persist() {
    const r = saveValley(this.storage, exportProgress(this.quest), { fresh: this.freshRun });
    if (r.ok) this.freshRun = false;
  }

  // 敵・村人の出現と退場
  activateGroup(group, alert, late = false) {
    if (GROUP_KINDS[group] === 'npc') { this.startBoy(); return; }
    if (group === 'road_scout') this.makeEnemies('road_scout', { alert: 'unaware' });
    if (group === 'village_enemies') {
      this.makeEnemies('village_enemies', { alert: alert === 'high' ? 'high' : 'unaware' });
      for (const e of this.enemies) {
        if (e.group !== 'village_enemies') continue;
        e.dormant = false;
        if (alert === 'high' && e.brain.state !== 'combat') { e.brain.state = 'combat'; e.brain.awareness = 1; e.brain.lastSeen = { x: this.hero.pos.x, z: this.hero.pos.z }; e.fighter.aware = true; }
        if (e.reported) this.after(0.1, () => this.dispatch({ type: 'enemy_down', id: e.id, how: e.reported }));   // 里に入る前に倒してしまった分も数える
      }
      this.hud.setFood(this.quest.resources.food / 100);
      this.pillageT = 0;
    }
    if (group === 'escort_ambush') {
      this.makeEnemies('escort_ambush', { alert: 'high' });
      for (const e of this.enemies) if (e.group === 'escort_ambush') {
        e.dormant = false;
        if (e.brain.state !== 'combat') { e.brain.state = 'combat'; e.brain.awareness = 1; e.brain.lastSeen = { x: this.hero.pos.x, z: this.hero.pos.z }; e.fighter.aware = true; }
      }
      this.audio.play('taiko', { gain: 0.8 });
      if (late) this.hud.toast('追手が、寺まで追ってきた', 2800);          // 待ち伏せを避けても、石段で追いつかれる
    }
  }
  despawnGroup(group) {
    if (group === 'village_enemies_rest') {
      // 侍大将が崩れたら、残りは退いていく
      for (const e of this.enemies) if (e.group === 'village_enemies' && e.fighter.alive && !e.departed && e.brain.state !== 'surrendered') { e.brain.state = 'retreat'; e.dormant = false; }
      return;
    }
    const keep = [];
    for (const e of this.enemies) { if (e.group === group) e.remove(); else keep.push(e); }
    this.enemies = keep;
    if (group === 'boy') { this.npcs.get('boy')?.remove(); this.npcs.delete('boy'); }
  }

  // 穂太が来られなかったとき、主人公の少し手前（歩いてきた向き）へ置く
  seatBoy(boy) {
    const h = this.hero.pos, d = Math.hypot(h.x - boy.pos.x, h.z - boy.pos.z) || 1, k = 2.6 / d;
    boy.goal = null; boy.place(h.x - (h.x - boy.pos.x) * k, h.z - (h.z - boy.pos.z) * k, yawOf(h.x - boy.pos.x, h.z - boy.pos.z));
    boy.arrived = true; boy.mode = 'idle'; boy.lookAt(h);
  }
  startBoy() {
    const boy = this.makeNpc('boy');
    boy.place(-66, -58, yawOf(this.hero.pos.x + 66, this.hero.pos.z + 58));
    boy.setCower(false); boy.arrived = false;
    const toward = () => { const h = this.hero.pos, d = Math.hypot(h.x - boy.pos.x, h.z - boy.pos.z) || 1; return { x: h.x - (h.x - boy.pos.x) / d * 2.4, z: h.z - (h.z - boy.pos.z) / d * 2.4 }; };
    const t = toward();
    boy.runTo(t.x, t.z, b => { b.arrived = true; b.lookAt(this.hero.pos); b.character.play('Catching_Breath', { fade: 0.2, from: 2.2, restart: true }); });
  }

  // ------------------------------------------------------------------ 会話
  queueDialogue(id) {
    // 子が駆けつけてから話し始める（間に合わなくても6秒で始める）。結果は場面の入れ替え（暗転）が終わってから
    this.pendingDialogue = { id, since: this.time, delay: id === 'result' ? 1.1 : 0 };
  }
  startDialogue(id) {
    this.pendingDialogue = null;
    if (id === 'viewpoint_overlook') { const o = SHOTS.overlook; this.setCine({ pos: [o.pos[0], o.eye, o.pos[1]], look: [o.look[0], o.look[2] ?? 1.2, o.look[1]], fov: o.fov }); }
    const lines = STORY.dialogues[id]; if (!lines) return;
    this.hud.startDialogue(id, lines, did => this.onDialogueEnd(did));
    this.audio.play('dialogue');
  }
  onDialogueEnd(id) {
    this.dispatch({ type: 'dialogue_end', id });
    if (id === 'viewpoint_overlook') this.after(0.2, () => this.clearCine());
    if (id === 'boy_arrives') { const boy = this.npcs.get('boy'); if (boy) boy.runTo(-88.4, -74.5, b => { b.setCower(true); }); }
    if (id === 'viewpoint_overlook') this.showChoice();
    if (id === 'village_cleared') this.healHero(40, 'つばきが傷の手当てをしてくれた');
    if (id === 'ambush_cleared') {
      this.healHero(25, '弥十郎が傷に布を巻いてくれた');
      const z = WORLD.zones.temple_steps;
      if (Math.hypot(this.hero.pos.x - z.x, this.hero.pos.z - z.z) < z.r) this.inZone.temple_steps = false;   // 石段で待ち伏せを退けたなら、もう一度「着いた」を数える
    }
    if (id === 'village_cleared') { for (const n of ['v_old', 'v_tsubaki']) this.npcs.get(n)?.setCower(false); this.after(1.2, () => { if (this.quest.beat === 'b5_archer' || this.quest.beat === 'b6_escort') this.makeRevived(true); }); }
    if (id === 'archer_joins') {
      this.ally?.join(false);
      this.after(2.6, () => { this.dispatch({ type: 'party_joined', id: 'archer' }); this.hud.setParty(true, this.modeLabel('follow')); this.hud.hint('command', STORY.hints.command, 7000); });
    }
    if (id === 'result') this.after(0.4, () => { this.persist(); this.showResult(); });
  }
  // 体力と構えを戻す（里を守ったあと・待ち伏せを退けたあと。戦いの合間に息をつける）
  healHero(amount, text) {
    const f = this.hero.fighter; if (!f.alive) return;
    f.hp = Math.min(f.hpMax, f.hp + amount); f.posture = f.postureMax;
    this.hud.setBars(f.hp, f.hpMax, f.posture, f.postureMax); this.hud.toast(text, 2600);
  }
  showChoice() {
    this.flow = 'choice'; this.input.releaseLock();
    this.hud.clearTransient();                       // 案内・通知が選択の枠に重ならないよう、選ぶあいだは消す
    this.hud.showChoice(true, plan => { this.hud.showChoice(false); this.dispatch({ type: 'choose_plan', plan }); this.flow = 'play'; this.input.requestLock(); this.hud.toast(plan === 'front' ? '正面から入る' : '脇道から回る', 1400); });
  }
  showResult() {
    const s = this.ending || { saved: this.quest.flags.archerJoined ? 4 : 3, food: this.quest.resources.food, morale: this.quest.resources.morale, trust: this.quest.trust, lines: [] };
    this.flow = 'result'; this.input.releaseLock();
    this.hud.showResult(s);
  }
  worldInteract() {
    const a = this.ally;
    if (this.quest.beat === 'b5_archer' && a && a.role === 'captive' && dist2(this.hero.pos, a.pos) < 2.8 && !this.quest.captiveFreed) this.dispatch({ type: 'interact', id: 'archer_captive' });
  }

  // 結果の場面：焚き火のそばに弥十郎が座り、村人が食糧を運んでくる。暗転のあいだに全員を輪に並べ、廃寺を背に火を囲む画角へ
  setupResultScene(instant) {
    const place = () => {
      const f = WORLD.props.find(p => p.id === 'bonfire'), at = (dx, dz, from = { x: f.x, z: f.z }) => ({ x: f.x + dx, z: f.z + dz, yaw: yawOf(from.x - (f.x + dx), from.z - (f.z + dz)) });
      const h = at(1.0, -2.5); this.hero.place(h.x, h.z, h.yaw);
      const old = at(-2.0, 1.6), tsu = at(2.5, -0.4);
      // 里の人々も焚き火に集まる（里を救った結果。カメラの反対側＝奥に座を作る）
      this.makeRevived(false);
      for (const [id, dx, dz] of [['r_man', -3.6, -2.3], ['r_woman', -1.2, -3.7], ['r_child', -4.2, 0.9]]) {
        const n = this.npcs.get(id); if (!n) continue;
        const p = at(dx, dz); n.place(p.x, p.z, p.yaw); n.mode = 'idle'; n.route = null; n.goal = null; n.lookAt({ x: f.x, z: f.z });
      }
      const walker = this.npcs.get('r_walker'); if (walker) { walker.remove(); this.npcs.delete('r_walker'); }
      this.npcs.get('v_old')?.place(old.x, old.z, old.yaw); this.npcs.get('v_old')?.setCower(false);
      this.npcs.get('v_tsubaki')?.place(tsu.x, tsu.z, tsu.yaw); this.npcs.get('v_tsubaki')?.setCower(false);
      for (const id of ['v_old', 'v_tsubaki']) this.npcs.get(id)?.lookAt(this.hero.pos);
      if (this.ally) { const a = at(-2.1, -0.9); this.ally.place(a.x, a.z, a.yaw); this.ally.role = 'captive'; this.ally.character.weapons.yumi.holder.visible = true; this.ally.character.play('Sit_Cross_Legged_on_Floor', { fade: 0.2 }); }
      this.hud.setParty(false);
      this.lock = null; this.hero.lockTarget = null;
      this.rig.yaw = yawOf(f.x - h.x, f.z - h.z); this.rig.snap();
      this.hud.clearTransient();
      if (!instant) this.setCine({ pos: [f.x + 6.0, 1.6, f.z + 3.2], look: [f.x - 0.5, 1.0, f.z - 0.6], fov: 48 }, 1);
    };
    if (instant) place(); else { this.hud.fade(true); this.after(0.7, () => { place(); this.hud.fade(false); }); }
  }

  // ------------------------------------------------------------------ 主人公の死・仲間への指示
  onHeroDown() {
    if (this.quest.pendingRetry) return;
    this.hero.die(); this.dispatch({ type: 'player_down' }); this.flow = 'dead'; this.deathT = 0;
    this.battle.clear();
  }
  modeLabel(mode) { return { follow: '同行', hold: '待機', cover: '援護', retreat: '撤退' }[mode]; }
  commandAlly(mode) {
    if (!this.ally?.inParty) return;
    if (mode === 'next') { const order = ['follow', 'hold', 'cover', 'retreat']; mode = order[(order.indexOf(this.ally.companion.mode) + 1) % 4]; }
    this.ally.setMode(mode); this.hud.setParty(true, this.modeLabel(mode));
    this.hud.toast('弥十郎：' + this.modeLabel(mode), 1200); this.audio.play('ui');
  }

  // ------------------------------------------------------------------ 毎フレーム
  controlFrame() {
    const input = this.input, yaw = this.rig.yaw, ax = input.axis();
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
    const vx = fx * ax.forward + rx * ax.right, vz = fz * ax.forward + rz * ax.right, vl = Math.hypot(vx, vz) || 1;
    return { input, axis: ax, moveYaw: yawOf(vx, vz), moveDir: { x: vx / vl, z: vz / vl },
      talking: this.hud.talking || !!this.pendingDialogue, frozen: this.flow !== 'play', worldInteract: () => this.worldInteract() };
  }

  update(rawDt) {
    let dt = Math.min(rawDt, 0.05);
    if (this.paused) return;
    // 命中の停止：時間を完全には止めず、ごく遅くする
    if (this.stopT > 0) { this.stopT -= dt; dt *= FEEL.hitStopScale; }
    this.time += dt;
    this.hud.tick(rawDt);
    this.runTimers();
    const input = this.input;
    if (this.flow === 'idle') { this.fx.update(dt, this.camera, this.renderer.domElement.clientHeight || 800); this.updateAmbientFx(dt); this.updateWorld(dt); input.endFrame(); return; }

    if (this.god) { const f = this.hero.fighter; if (f.alive) { f.hp = f.hpMax; f.posture = f.postureMax; } }
    const ctl = this.controlFrame();          // 会話を閉じる E が、同じ瞬間に別の操作にならないよう先に作る
    this.handleUiKeys();
    if (this.pendingDialogue) {
      const pd = this.pendingDialogue, boy = this.npcs.get('boy');
      const near = boy && dist2(boy.pos, this.hero.pos) < 4.5;
      const waiting = (pd.id === 'boy_arrives' && boy && !boy.arrived && !near && this.time - pd.since < 10) || this.time - pd.since < pd.delay;
      if (!waiting && !this.hud.talking) {
        if (pd.id === 'boy_arrives' && boy && !boy.arrived && !near) this.seatBoy(boy);      // 間に合わなければ、主人公の近くへ置いてから話す（画面の外から話しかけない）
        this.startDialogue(pd.id);
      }
    }
    this.hero.update(dt, ctl);
    for (const e of this.enemies) e.update(dt);
    this.ally?.update(dt);
    for (const n of this.npcs.values()) n.update(dt);
    this.separateActors();
    this.battle.update(dt);
    this.noises = this.noises.filter(n => this.time - n.t < 0.6);
    if (this.flow === 'intro') this.updateIntro(dt);
    if (this.flow === 'play' || this.flow === 'dead') { this.updateZones(); this.updatePillage(dt); }
    this.updateLock(input);
    this.updateCamera(dt);
    this.updatePrompt();
    this.updateHud(dt);
    this.updateDeath(dt);
    this.fx.update(dt, this.camera, this.renderer.domElement.clientHeight || 800);
    this.updateAmbientFx(dt);
    this.updateWorld(dt);
    input.endFrame();
  }

  // 人物どうしが重ならないよう、近すぎる組を左右へ押し分ける（死んだ・倒れた・降った者は押さない）
  separateActors() {
    const list = [this.hero];
    for (const e of this.enemies) if (e.fighter.alive && !e.departed && !e.dormant && e.brain.state !== 'surrendered') list.push(e);
    if (this.ally?.inParty && !this.ally.down) list.push(this.ally);
    if (list.length < 2 || !this.hero.alive) return;
    const MIN = 0.72;
    for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      if (a.fighter.team === b.fighter.team && a !== this.hero && b !== this.hero) { /* 敵どうし・味方どうしも離す */ }
      const dx = b.pos.x - a.pos.x, dz = b.pos.z - a.pos.z, d = Math.hypot(dx, dz);
      if (d >= MIN) continue;
      const ux = d > 1e-4 ? dx / d : Math.cos(i * 2.4 + j), uz = d > 1e-4 ? dz / d : Math.sin(i * 2.4 + j), push = (MIN - d);
      // 主人公は動かされにくい（操作が乱れないよう3割）。それ以外は半分ずつ
      const ka = a === this.hero ? 0.3 : 0.5, kb = b === this.hero ? 0.3 : 0.5, sum = ka + kb;
      a.step(-ux * push * ka / sum, -uz * push * ka / sum); b.step(ux * push * kb / sum, uz * push * kb / sum);
    }
  }

  // 世界の見た目の更新（大気・風・木の近さ・影の追従・環境音）
  updateWorld(dt) {
    this.atmosphere.update(this.camera, dt);
    this.veg.wind.uTime.value += dt; this.veg.trees.update(this.camera); this.veg.grass.update(this.camera); this.veg.rice.update(this.camera); this.veg.crops?.update(this.camera); this.props?.update(this.time); this.water?.update(this.time);
    const h = this.hero.pos;
    this.atmosphere.follow(new THREE.Vector3(h.x - Math.sin(this.rig.yaw) * 8, h.y, h.z - Math.cos(this.rig.yaw) * 8));
    this.listenerT -= dt;
    if (this.listenerT <= 0) {
      this.listenerT = 0.5;
      const bonfire = WORLD.props.find(p => p.id === 'bonfire');
      this.audio.updateListener({ river: Math.max(0, this.terrain.riverInfo(h.x, h.z).d - WORLD.river.halfWidth), fire: Math.hypot(h.x - bonfire.x, h.z - bonfire.z) });
    }
  }
  runTimers() {
    if (!this.timers.length) return;
    const due = this.timers.filter(t => t.t <= this.time);
    if (!due.length) return;
    this.timers = this.timers.filter(t => t.t > this.time);
    for (const t of due) t.fn();
  }

  handleUiKeys() {
    const input = this.input;
    if (this.hud.talking) {
      if (input.wasPressed('KeyE') || input.mouseWasPressed(0) || input.wasPressed('Space')) { this.hud.advanceDialogue(); this.audio.play('dialogue'); }
      return;
    }
    if (this.flow !== 'play') return;
    if (input.wasPressed('Tab')) this.toggleLock();
    if (input.wasPressed('KeyQ')) this.commandAlly('next');
    for (const [k, m] of [['Digit1', 'follow'], ['Digit2', 'hold'], ['Digit3', 'cover'], ['Digit4', 'retreat']]) if (input.wasPressed(k)) this.commandAlly(m);
    if (input.wasPressed('KeyH')) document.body.classList.toggle('hide-hud');
  }

  toggleLock() {
    if (this.lock) { this.lock = null; this.hero.lockTarget = null; return; }
    let best = null, bd = FEEL.lockRange;
    for (const e of this.enemies) {
      if (!e.fighter.alive || e.departed || e.dormant || e.brain.state === 'surrendered') continue;
      const d = dist2(e.pos, this.hero.pos);
      const ang = Math.abs(((yawOf(e.pos.x - this.hero.pos.x, e.pos.z - this.hero.pos.z) - this.rig.yaw + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
      const score = d + ang * 6;
      if (d < bd && score < (best?.score ?? 1e9)) { best = { e, score }; }
    }
    if (best) { this.lock = best.e; this.hero.lockTarget = best.e; }
  }
  updateLock() {
    if (!this.lock) return;
    const l = this.lock;
    if (!l.fighter.alive || l.departed || l.brain.state === 'surrendered' || dist2(l.pos, this.hero.pos) > FEEL.lockRange + 6) { this.lock = null; this.hero.lockTarget = null; }
  }

  updateCamera(dt) {
    const look = this.input.look(dt);
    // 戦闘中、カメラを動かしていなければ、いちばん近い敵の方へゆるくカメラを向ける（敵が主人公の陰に隠れないよう）
    if (Math.abs(look.dx) + Math.abs(look.dy) > 2) this.lastLookT = this.time;
    if (this.flow === 'play' && !this.lock && !this.camOverride && !this.cine && this.time - (this.lastLookT ?? -9) > 1.0 && this.alertedEnemies() > 0) {
      let best = null, bd = 9;
      for (const e of this.enemies) if (e.fighter.alive && !e.departed && !e.dormant && e.brain.state === 'combat') { const d = dist2(e.pos, this.hero.pos); if (d < bd) { bd = d; best = e; } }
      if (best) {
        const want = yawOf(best.pos.x - this.hero.pos.x, best.pos.z - this.hero.pos.z), diff = Math.atan2(Math.sin(want - this.rig.yaw), Math.cos(want - this.rig.yaw));
        if (Math.abs(diff) > 0.45) this.rig.yaw += Math.sign(diff) * Math.min(Math.abs(diff) - 0.35, 0.9 * dt) * 1.0;
      }
    }
    if (this.camOverride) {                  // 検査用：カメラを固定して撮る（?qa=1）
      const c = this.camOverride; this.camera.position.set(...c.pos); this.camera.lookAt(...c.look);
      if (c.fov && this.camera.fov !== c.fov) { this.camera.fov = c.fov; this.camera.updateProjectionMatrix(); }
      return;
    }
    const lockTarget = this.lock && this.flow === 'play' ? this.lock.pos : null;
    const frozen = this.flow === 'choice' || this.flow === 'result';
    this.rig.update(dt, this.hero.pos, {
      lookDx: frozen ? 0 : look.dx, lookDy: frozen ? 0 : look.dy, lockTarget,
      rayClip: (a, b) => rayClip(this.col, this.terrain, a, b, 0.45), groundAt: (x, z) => this.terrain.heightAt(x, z), zoom: this.input.wheel,
    });
    this.applyCine(dt);
  }

  // 範囲に入った瞬間を任務へ知らせる
  updateZones() {
    if (!this.hero.alive) return;
    const p = this.hero.pos;
    for (const [name, z] of Object.entries(WORLD.zones)) {
      const inside = Math.hypot(p.x - z.x, p.z - z.z) < z.r;
      if (inside && !this.inZone[name]) {
        this.inZone[name] = true;
        this.dispatch({ type: 'enter_zone', zone: name });
        if (PLACE_ZONES.includes(name)) this.dispatch({ type: 'arrived', place: name });
      } else if (!inside) this.inZone[name] = false;
    }
  }
  updatePillage(dt) {
    if (this.quest.beat !== 'b4_village') return;
    this.pillageT += dt;
    if (this.pillageT < 0.5) return;
    const dtp = this.pillageT; this.pillageT = 0;
    let raiders = 0, loud = false;
    for (const e of this.enemies) if (e.group === 'village_enemies' && e.fighter.alive && !e.departed && !['retreat', 'surrendered'].includes(e.brain.state)) { raiders++; if (e.brain.state === 'combat') loud = true; }
    this.dispatch({ type: 'pillage_tick', dt: dtp * FEEL.pillageScale, pillagers: raiders, loud });
  }

  // ------------------------------------------------------------------ HUD
  objectiveTarget() {
    const z = WORLD.zones, b = this.quest.beat;
    switch (b) {
      case 'b0_temple': return z.temple_yard;
      case 'b1_boy': return this.npcs.get('boy')?.pos || null;
      case 'b2_road': return z.viewpoint;
      case 'b3_viewpoint': return this.quest.flags.plan === 'flank' ? z.village_north : z.village_front;
      case 'b4_village': { let best = null, bd = 1e9; for (const e of this.enemies) if (e.group === 'village_enemies' && e.fighter.alive && !e.departed) { const d = dist2(e.pos, this.hero.pos); if (d < bd) { bd = d; best = e.pos; } } return best; }
      case 'b5_archer': return this.ally?.role === 'captive' ? this.ally.pos : null;
      case 'b6_escort': return z.temple_steps;
      default: return null;
    }
  }
  updatePrompt() {
    let text = '';
    if (this.flow === 'play' && !this.hud.talking && this.hero.alive) {
      const h = this.hero, f = h.fighter;
      for (const e of this.enemies) if (e.fighter.alive && e.fighter.state === 'stagger' && dist2(e.pos, h.pos) < 3.4) { text = 'とどめを刺す'; break; }
      if (!text) for (const e of this.enemies) {
        if (!e.fighter.alive || e.fighter.aware !== false) continue;
        const dx = h.pos.x - e.pos.x, dz = h.pos.z - e.pos.z, d = Math.hypot(dx, dz);
        if (d <= 1.9 && (-Math.sin(e.yaw + Math.PI) * dx - Math.cos(e.yaw + Math.PI) * dz) / (d || 1) >= Math.cos(Math.PI / 4)) { text = '背後から闇討ち'; break; }
      }
      if (!text && this.quest.beat === 'b5_archer' && this.ally?.role === 'captive' && dist2(h.pos, this.ally.pos) < 2.8) text = '縛めを解く';
      if (f.state !== 'idle') text = '';
    }
    let key = 'E';
    if (this.flow === 'play' && this.hero.alive && this.hero.fighter.counterT > 0 && this.hero.fighter.state === 'idle') { text = '弾いた。いま反撃'; key = '左クリック'; }
    if (text !== this.promptKey) { this.promptKey = text; this.hud.prompt(text, key); }
    if (text === 'とどめを刺す') this.hud.hint('finisher', STORY.hints.finisher);
    if (text === '背後から闇討ち') this.hud.hint('stealth', STORY.hints.stealth);
  }
  updateHud(dt) {
    const f = this.hero.fighter;
    this.hud.setBars(f.hp, f.hpMax, f.posture, f.postureMax);
    const t = this.objectiveTarget();
    if (t && this.flow === 'play') {
      const dx = t.x - this.hero.pos.x, dz = t.z - this.hero.pos.z;
      const rel = Math.atan2(Math.sin(this.rig.yaw - yawOf(dx, dz)), Math.cos(this.rig.yaw - yawOf(dx, dz)));
      this.hud.setCompass(rel, Math.hypot(dx, dz), true);
    } else this.hud.setCompass(0, 0, false);
    // 官名つきの体力帯（侍大将）
    const off = this.enemies.find(e => e.kind === 'officer' && e.fighter.alive && !e.departed && !e.dormant && e.brain.state === 'combat');
    this.hud.setBoss(!!off, '追手の侍大将', off ? off.fighter.hp / off.fighter.hpMax : 0);
    this.markerT -= dt;
    if (this.markerT <= 0) { this.markerT = 0.033; this.updateMarkers(); }
  }
  updateMarkers() {
    const list = [], el = this.renderer.domElement, W = el.clientWidth, H = el.clientHeight, v = new THREE.Vector3();
    if (this.flow === 'play') for (const e of this.enemies) {
      const f = e.fighter, b = e.brain;
      if (!f.alive || e.departed || e.dormant || b.state === 'surrendered') continue;
      const d = dist2(e.pos, this.hero.pos);
      if (d > FEEL.markerRange) continue;
      const combat = b.state === 'combat', sus = b.state === 'suspicious' || b.state === 'search' || (b.state === 'patrol' && b.awareness > 0.05);
      if (!combat && !sus && d > 12 && this.lock !== e) continue;
      v.set(e.pos.x, e.pos.y + e.character.height + 0.35, e.pos.z).project(this.camera);
      if (v.z > 1 || v.z < -1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) continue;
      const state = f.telegraphing ? 'tele' : combat ? 'alert' : sus ? 'sus' : '';
      list.push({ id: e.id, x: (v.x * 0.5 + 0.5) * W, y: (-v.y * 0.5 + 0.5) * H, ratio: combat ? f.posture / f.postureMax : b.awareness, state, locked: this.lock === e, hideBar: !combat && !sus && this.lock !== e });
    }
    this.hud.updateMarkers(list);
  }
  updateDeath(dt) {
    if (this.flow !== 'dead') return;
    this.deathT += dt;
    if (this.deathT > 1.9 && !this.deathShown) { this.hud.showDeath(true); this.deathShown = true; this.input.releaseLock(); }
  }

  // 焚き火・煙・舞う塵などの常時の演出
  updateAmbientFx(dt) {
    this.fxT = (this.fxT || 0) - dt;
    if (this.fxT > 0) return;
    this.fxT = 0.06;
    const hp = this.hero.pos, f = WORLD.props.find(p => p.id === 'bonfire');
    if (Math.hypot(hp.x - f.x, hp.z - f.z) < 90) {
      const p = { x: f.x, y: this.terrain.heightAt(f.x, f.z) + 0.15, z: f.z };
      this.fx.flame(p); if (this.rng() < 0.4) this.fx.ember({ ...p, y: p.y + 0.4 }); if (this.rng() < 0.12) this.fx.smoke({ ...p, y: p.y + 0.9 });
    }
    // 農家の煙突から細い煙（近くの家だけ）
    this.chimneyT = (this.chimneyT || 0) - 0.06;
    if (this.chimneyT <= 0) {
      this.chimneyT = 0.45;
      for (const b of WORLD.buildings) {
        if (b.kind !== 'farmhouse' || Math.hypot(hp.x - b.x, hp.z - b.z) > 140) continue;
        const y = this.terrain.heightAt(b.x, b.z) + 5.6 * (0.98 + (b.variant || 0) * 0.04);
        this.fx.chimney({ x: b.x + Math.sin(b.rotY) * 0.8, y, z: b.z + Math.cos(b.rotY) * 0.8 });
      }
    }
    // 光の筋の中を舞う塵（主人公のまわり）
    if (this.rng() < 0.45 && this.flow !== 'idle') this.fx.mote({ x: hp.x + (this.rng() - 0.5) * 14, y: hp.y + 0.4 + this.rng() * 3.2, z: hp.z + (this.rng() - 0.5) * 14 });
  }

  render(dt) { this.renderer.info.reset(); this.post.render(this.scene, this.camera, dt); }
}
