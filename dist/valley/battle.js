// battle.js — 戦闘の結線（app層）。当たりの判定は combat.js に任せ、結果を音・火花・揺れ・敵の反応・士気・任務へ配る。
// 矢の飛行・予兆（刃の光・照準線）・掛け声・士気の伝播もここ。規則の数値は combat.js と config.js の FEEL。
import * as THREE from 'three';
import { MOVES, strike, projectileHit, cancelMove } from './combat.js';
import { adjustMorale, alertFromAlly } from './enemy-ai.js';
import { segmentBlocked } from './collision.js';
import { makeArrow } from './weapons.js';
import { STORY } from './story-data.js';
import { FEEL, AUDIO_NOISE } from './config.js';
import { yawOf, dist2 } from './actors.js';
import { TRAIL, trailStyleFor, inTrailWindow } from './slash-trail.js';
import { STRIKE, strikePoint, clashPoint, closestSegments, pushDirection } from './clash.js';

const GRAVITY = 9.8;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();
// 刀の枠（握りが原点・刃は +Y の 0.16〜0.88m）の上の点の世界位置（当たりの瞬間に1回だけ使うので、配列を作ってよい）
const bladeAt = (holder, y) => { holder.updateWorldMatrix(true, false); const e = holder.matrixWorld.elements; return [e[4] * y + e[12], e[5] * y + e[13], e[6] * y + e[14]]; };
// 予兆の光（8.3a 第2周）：金色の脈動。刃の帯（白〜青白・一瞬）と、色（赤＞緑＞青）と動き（明滅）で分ける
const GLINT = { color: [1, 0.78, 0.34], pulse: 2.5 };

export class Battle {
  constructor(game) {
    this.g = game; this.arrows = []; this.barkAt = -9; this.lastAlertAt = -99; this.aimLines = []; this.glints = [];
    this.arrowModel = makeArrow();
    const geo = new THREE.BoxGeometry(0.012, 0.012, 1);
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xff9650, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending }));
      m.visible = false; m.frustumCulled = false; m.renderOrder = 6; game.scene.add(m); this.aimLines.push(m);
    }
  }

  update(dt) {
    this.resolveMelee();
    this.updateArrows(dt);
    this.updateAimLines();
    this.updateGlints(dt);
    this.dimBlades();
    this.updateTrails();
  }

  // ---------------------------------------------------------------- 近接
  // swing は、その振りの技の1回ぶん（刃の軌跡の持ち主）。弾かれると論理が技を消すので、当たりの判定の前に控えておく
  resolveMelee() {
    const g = this.g, hero = g.hero, hf = hero.fighter;
    if (hf.alive && hf.state === 'attack' && hf.move?.phase === 'active') {
      const swing = hf.move;
      for (const e of g.enemies) {
        if (!e.fighter.alive || e.departed || e.brain.state === 'surrendered') continue;
        const res = strike(hf, e.fighter);
        if (res) this.onStrike(hero, e, res, { swing });
      }
    }
    for (const e of g.enemies) {
      const f = e.fighter;
      if (!f.alive || e.departed || f.state !== 'attack' || f.move?.phase !== 'active' || MOVES[f.move.id].kind === 'shot') continue;
      if (e.brain.state === 'retreat' || e.brain.state === 'surrendered') continue;       // 背を向けた兵の振りは当たらない
      const swing = f.move;
      if (hf.alive && !g.heroProtected()) { const res = strike(f, hf); if (res) this.onStrike(e, hero, res, { swing }); }
      const ally = g.ally;
      if (ally?.inParty && !ally.down) { const res = strike(f, ally.fighter); if (res) this.onStrike(e, ally, res, { swing }); }
    }
  }

  // 当たった点と刃の進む向き（8.3a 第2周）。点は、相手の刃の中ほど〜切先と、受けた人の胴の軸（胸の骨 Spine02 の上下）の最も近い所
  // （刃が胴の外なら、胴の表面の刃の側。clash.js）。向きは、帯の切先の最新の速度（帯が無ければ null＝放射状）。矢と刀の無い者は胸のまま。
  // push は、ひるみ（見た目だけ）の押す向き：相手から自分へ＋刃の進む向き。
  strikeGeometry(att, def, swing, arrow) {
    const pos = def.chest(); pos.y += 0.1;
    const v = !arrow && this.g.fx.trails.velocityOf(swing), travel = v ? [v[0], v[1], v[2]] : null;
    const out = { pos, travel, push: pushDirection(att.pos.x, att.pos.z, def.pos.x, def.pos.z, travel), inside: false };
    const w = att.character?.weapons?.tachiDrawn, spine = def.character?.bones.get('Spine02');
    if (arrow || !w || !w.holder.visible || !spine) return out;
    spine.getWorldPosition(_a);
    const s = strikePoint(bladeAt(w.holder, 0.52), bladeAt(w.holder, 0.88), [_a.x, _a.y - STRIKE.torsoHalf, _a.z], [_a.x, _a.y + STRIKE.torsoHalf, _a.z]);
    out.pos = { x: s.point[0], y: s.point[1], z: s.point[2] }; out.inside = s.inside;
    return out;
  }
  // 弾き（8.3a 第2周）：主人公の刀を相手の刃へ伸ばして打ち合わせ（sword-rig.js の clash。見た目だけ）、打ち合った点を返す。
  // 点は、相手の刃の上で主人公の右肩に最も近い所。合わせたあとの2本の刃の最も近い2点の中ほどに火花を置く。
  parryClash(att, def) {
    const wa = att.character?.weapons?.tachiDrawn, wd = def.character?.weapons?.tachiDrawn, rig = def.character?.sword, sh = def.character?.bones.get('RightArm');
    if (!wa || !wd || !rig?.clash || !sh || !wa.holder.visible || !wd.holder.visible) return null;
    const root = bladeAt(wa.holder, 0.16), tip = bladeAt(wa.holder, 0.88);
    sh.getWorldPosition(_a);
    rig.clash(clashPoint(root, tip, [_a.x, _a.y, _a.z]));
    const c = closestSegments(root, tip, bladeAt(wd.holder, 0.16), bladeAt(wd.holder, 0.88));
    this.lastClash = { gap: c.d };                                  // 検査用：打ち合ったときの2本の刃の距離（m）
    return { x: (c.p[0] + c.q[0]) / 2, y: (c.p[1] + c.q[1]) / 2, z: (c.p[2] + c.q[2]) / 2 };
  }

  onStrike(att, def, res, { arrow = false, swing = null } = {}) {
    const g = this.g, geo = this.strikeGeometry(att, def, swing, arrow), pos = geo.pos;
    const dx = def.pos.x - att.pos.x, dz = def.pos.z - att.pos.z, dl = Math.hypot(dx, dz) || 1, dir = { x: dx / dl, z: dz / dl };
    const pan = g.pan(def.pos), heroDef = def === g.hero, heroAtt = att === g.hero;
    switch (res.outcome) {
      case 'hit': case 'stealth': {
        if (res.outcome === 'stealth' && heroAtt) { g.stats.stealth++; if (!res.dead) def.stealthStruck = true; }       // 闇討ちで倒れなかった侍大将が気づく反応は、「見つかった」に数えない
        const strong = res.moveId === 'heavy' || res.moveId === 'finisher' || res.outcome === 'stealth' || res.damage >= 20;
        // 三段目（締めの一撃）：規則では強い技（combat.js の STRONG）。停止の長さ（時間の進み）は変えず、火花・音・揺れだけを強い側へ寄せる（8.3a）
        const finale = !strong && res.moveId === 'light3';
        g.fx.hit(pos, dir, { strong: strong || finale, travel: geo.travel });
        g.audio.play(arrow ? 'arrow_hit' : strong || finale ? 'hit_heavy' : 'hit', { pan });
        g.hitStop(strong ? FEEL.hitStop.heavy : FEEL.hitStop.hit);
        if (heroDef) { g.rig.kick(0.7); g.rig.punchFov(1.8); g.hud.hurt(); g.hud.hint('dodge', STORY.hints.dodge); }
        else if (heroAtt) { g.rig.kick(strong ? 0.5 : finale ? 0.42 : 0.25); g.rig.punchFov(strong ? 1.6 : finale ? 1.3 : 0.8); }
        break;
      }
      case 'blocked':
        g.fx.hit(pos, dir, { blocked: true, travel: geo.travel });
        g.audio.play(arrow ? 'arrow_hit' : 'block', { pan });
        g.hitStop(FEEL.hitStop.hit * 0.8);
        if (heroDef) { g.rig.kick(0.35); g.hud.hint('parry', STORY.hints.parry); }
        break;
      case 'parried': {
        if (heroDef) g.stats.parries++;
        const at = (!arrow && this.parryClash(att, def)) || pos;     // 刃同士が触れる点（8.3a 第2周）
        g.fx.parry(at, dir, g.fx.trails.velocityOf(swing));             // 火花は、弾かれた刃が逸れる向きへ（8.3a）
        g.audio.play('parry', { pan });
        g.hitStop(FEEL.hitStop.parry);
        if (heroDef) { g.rig.kick(0.5); g.rig.punchFov(3.2); g.hud.toast('弾いた', 900); g.hud.hint('finisher', STORY.hints.finisher); }
        break;
      }
      default: return;
    }
    def.onHit?.(res, att, geo);
    if (res.outcome === 'parried') {
      att.onHit?.(res, def);
      if (att.brain) adjustMorale(att.brain, FEEL.parriedMorale, 'parried');
    }
    // 闇討ちは静かな技。周りを呼ぶ音は3m（普通に斬る12m、受け・弾きの金属音18m）
    g.emitNoise(def.pos.x, def.pos.z, AUDIO_NOISE[res.outcome === 'stealth' ? 'stealth' : res.outcome === 'hit' ? 'hit' : 'clash'].radius, 'clash');
    if (res.dead) this.onDeath(def, att, res);
  }

  onDeath(def, att, res) {
    const g = this.g;
    if (def === g.hero) { g.onHeroDown(); return; }
    if (!def.brain) return;
    g.reportDown(def, 'killed', { stealth: res?.outcome === 'stealth' });
    for (const o of g.enemies) if (o !== def && o.fighter.alive && !o.departed && dist2(o.pos, def.pos) < 12) adjustMorale(o.brain, FEEL.deathMorale, 'ally_down');
  }

  // ---------------------------------------------------------------- 敵の反応
  onEnemyAlerted(e) {
    const g = this.g;
    if (e.group === 'village_enemies' && !e.stealthStruck) g.dispatch({ type: 'noticed' });
    g.audio.play('alert', { gain: 0.7, pan: g.pan(e.pos) });
    if (g.time - this.lastAlertAt > 25) g.audio.play('taiko', { gain: 0.7, pan: g.pan(e.pos) });
    this.lastAlertAt = g.time;
    this.bark(e, 'alert');
    for (const o of g.enemies) if (o !== e && o.fighter.alive && !o.departed && dist2(o.pos, e.pos) < FEEL.alertShareRadius) alertFromAlly(o.brain, { x: g.hero.pos.x, z: g.hero.pos.z });
    g.hud.hint('attack', STORY.hints.attack, 6000);
  }
  onEnemyShout(e, ev) {
    const g = this.g;
    this.bark(e, 'rally'); g.audio.play('taiko', { gain: 0.85, pan: g.pan(e.pos) });
    for (const o of g.enemies) if (o !== e && o.fighter.alive && !o.departed && dist2(o.pos, e.pos) <= (ev.radius || 14)) adjustMorale(o.brain, FEEL.rallyMorale, 'rally');
  }
  onEnemyRouted(e, ev) {
    const g = this.g;
    this.bark(e, 'retreat');
    g.reportDown(e, 'routed');
    for (const o of g.enemies) {
      if (o === e || !o.fighter.alive || o.departed) continue;
      if (ev.type === 'leader_fled') adjustMorale(o.brain, FEEL.leaderFledMorale, 'leader_fled');
      else if (dist2(o.pos, e.pos) < 10) adjustMorale(o.brain, -8, 'ally_routed');
    }
  }
  onEnemySurrendered(e) { this.bark(e, 'surrender'); this.g.reportDown(e, 'surrendered'); }

  bark(actor, key) {
    const g = this.g, lines = STORY.barks[key];
    if (!lines || g.time - this.barkAt < 1.6 || dist2(actor.pos, g.hero.pos) > 40) return;
    this.barkAt = g.time;
    g.hud.subtitle(actor.kind === 'officer' ? '侍大将' : '追手', lines[(g.rng() * lines.length) | 0], 1800);
  }

  // 近接の予兆：当たりの少し前に刃を光らせる（弾きの窓に間に合う長さ）
  telegraph(actor, move) {
    if (move.kind === 'shot') return;
    const g = this.g, id = move.id;
    g.after(Math.max(0, move.windup - 0.30), () => {
      const f = actor.fighter;
      if (!f.alive || f.state !== 'attack' || f.move?.id !== id) return;
      const p = actor.chest(), fx = -Math.sin(actor.yaw), fz = -Math.cos(actor.yaw);
      g.fx.add.emit({ pos: [p.x + fx * 0.55, p.y + 0.4, p.z + fz * 0.55], vel: [0, 0, 0], life: 0.17, size: 0.4, sizeEnd: 0.12, color: GLINT.color, alpha: 0.9 });          // 胸の前の閃光は小さく（大きいと敵の胴が白く飛んだ）
      g.audio.play('alert', { gain: 0.55, pan: g.pan(actor.pos), pitch: 1.5 });
      this.glints.push({ actor, t: 0.34 });
      if (dist2(actor.pos, g.hero.pos) < 16) {
        // 弾きの案内を見せたあとの侍大将の光で、連続技の案内を出す（同時には出せない）
        if (!g.hud.hint('parry', STORY.hints.parry) && actor.kind === 'officer' && !g.hud.hintBusy()) g.hud.hint('officer', STORY.hints.officer);
      }
    });
  }
  // 予兆の光：振りかぶる刃に沿って光の粒を並べる（光る刃が弾きの合図。胸の前の光だけだと主人公の陰で見えなかった）
  updateGlints(dt) {
    const g = this.g;
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const gl = this.glints[i]; gl.t -= dt;
      const w = gl.actor.character?.weapons?.tachiDrawn || gl.actor.character?.weapons?.naginata;
      // 振りが始まったら新しい光の粒を足さない。予兆は「振る前」、刃の軌跡は「振っている間」と時機を分ける（8.3a）。
      // 第2周：帯を出し始める所（接触＝判定の始めの0.08秒前）で止める。予備の終わりまで出すと、突きの振り出しに金色が重なり、突きの光の線が埋もれた
      const mv = gl.actor.fighter.move;
      if (gl.t <= 0 || !w || !w.holder.visible || !gl.actor.fighter.alive || mv?.phase !== 'windup' || mv.t >= MOVES[mv.id].windup - TRAIL.lead) { this.glints.splice(i, 1); continue; }
      const len = w === gl.actor.character.weapons.naginata ? 1.7 : 0.95;
      w.holder.updateWorldMatrix(true, false);
      // 細かい光の粒を、間隔より大きく重ねて刃に沿った一本の線にする（粒が離れると「白い玉の数珠」に見えた）。切先ほど明るく太い。
      // 金色で、明滅する（予兆の0.34秒に約2.5回。8.3a 第2周）。粒の寿命は短く、明滅が粒の重なりで消えないようにする
      const beat = 0.35 + 0.65 * Math.pow(0.5 + 0.5 * Math.cos((0.34 - gl.t) * GLINT.pulse * 2 * Math.PI), 2);
      for (let k = 0; k < 22; k++) {
        const t = 0.2 + k * 0.04;
        _a.set(0, t * len, 0); w.holder.localToWorld(_a);
        g.fx.add.emit({ pos: [_a.x, _a.y, _a.z], vel: [0, 0, 0], life: 0.07, size: (0.05 + 0.07 * t) * (0.7 + 0.3 * beat), sizeEnd: 0.02, color: GLINT.color, alpha: (0.5 + 0.4 * t) * beat });
      }
    }
  }
  // 敵の刃の照り返し（8.3a 第2周）：夕日の直射を映した鋼が、戻りや構えの間にも金色ににじみ（ブルーム）、予兆と見分けがつかなかった。
  // 予兆の間（刃の光の粒を出している間）だけ元の鋼、ほかは地の色を #9a9a9a へ落としてにじまない明るさにする
  // （照り返しの強さ・粗さだけでは直射の光沢が残った。戻りの0.87秒のコマで撮り比べた）。材質は人物ごとに1つ。見た目だけ。
  dimBlades() {
    const glinting = this.glintActors || (this.glintActors = new Set());
    glinting.clear(); for (const gl of this.glints) glinting.add(gl.actor);
    const mats = this.bladeMats || (this.bladeMats = new WeakMap());
    for (const e of this.g.enemies) {
      const w = e.character?.weapons?.tachiDrawn;
      if (!w) continue;
      let m = mats.get(w);
      if (m === undefined) { m = w.object.getObjectByName('blade')?.material || null; mats.set(w, m); }
      if (!m) continue;
      const lit = glinting.has(e), u = m.userData;
      if (u.lit === lit) continue;
      if (!u.steel) u.steel = { color: m.color.getHex(), roughness: m.roughness, env: m.envMapIntensity };
      u.lit = lit; m.color.setHex(lit ? u.steel.color : 0x9a9a9a); m.roughness = lit ? u.steel.roughness : 0.38; m.envMapIntensity = lit ? u.steel.env : 0.6;
    }
  }

  // ---------------------------------------------------------------- 刃の軌跡（8.3a）
  // 振りの間（接触＝判定の始めの0.08秒前〜判定の終わり。戻りには足さない）、刀の帯のサンプルを足す。帯の持ち主は技の1回ぶん（f.move）。
  // 刀が見えない・抜刀納刀の層が動いている・死んだ・離脱した・区間の外のコマは足さない（足さなかった帯は閉じて0.05秒で消える）。時刻はゲーム内の秒。
  updateTrails() {
    const g = this.g, trails = g.fx.trails;
    trails.clock[0] = g.time;
    this.trailActor(g.hero, trails);
    for (const e of g.enemies) this.trailActor(e, trails);
    trails.update(g.camera);
  }
  trailActor(actor, trails) {
    const f = actor.fighter, ch = actor.character, w = ch?.weapons?.tachiDrawn;
    if (!w || !f?.alive || actor.departed || !w.holder.visible || ch.sword?.active) return;
    if (f.state === 'attack' && f.move) {
      const m = MOVES[f.move.id], style = m.kind === 'melee' && inTrailWindow(m, f.move.t) ? trailStyleFor(m.id, f.team) : null;
      if (style) trails.sample(f.move, style, w.holder);
      return;
    }
    const cue = actor.trailCue;                              // 闇討ち：論理の技ではない演出の時間割（actors.js の tryInteract）
    if (!cue) return;
    const t = this.g.time - cue.t0;
    if (t > cue.windup + cue.active + 1) { actor.trailCue = null; return; }
    if (inTrailWindow(cue, t)) trails.sample(cue, trailStyleFor('stealth', f.team), w.holder);
  }

  // ---------------------------------------------------------------- 矢
  fireArrow(shooter, moveId) {
    const g = this.g, m = MOVES[moveId], ally = shooter.fighter.team === 'ally';
    const target = ally ? shooter.shootTarget : g.hero;
    if (!target || !target.fighter.alive) return;
    const fx = -Math.sin(shooter.yaw), fz = -Math.cos(shooter.yaw);
    const from = new THREE.Vector3(shooter.pos.x + fx * 0.5, shooter.pos.y + shooter.character.height * 0.82, shooter.pos.z + fz * 0.5);
    const tp = target.chest(), dist = Math.hypot(tp.x - from.x, tp.z - from.z), speed = FEEL.arrowSpeed, t = dist / speed;
    const tv = target === g.hero ? g.hero.speed : (target.speedNow || 0);
    const aim = new THREE.Vector3(tp.x - Math.sin(target.yaw) * tv * t * 0.7, tp.y + 0.5 * GRAVITY * t * t, tp.z - Math.cos(target.yaw) * tv * t * 0.7);
    const dir = aim.sub(from).normalize();
    const spread = FEEL.arrowSpread * (1 + dist / 18);
    dir.x += (g.rng() - 0.5) * spread * 2; dir.y += (g.rng() - 0.5) * spread; dir.z += (g.rng() - 0.5) * spread * 2; dir.normalize();
    const mesh = this.arrowModel.clone(); mesh.position.copy(from); g.scene.add(mesh);
    this.arrows.push({ mesh, pos: from, vel: dir.multiplyScalar(speed), owner: shooter, ally, move: m, life: 4, stuck: false, t: 0 });
    g.audio.play('bow_release', { pan: g.pan(shooter.pos) });
    if (this.arrows.length > 24) this.removeArrow(this.arrows[0]);
  }

  // 矢は参照で取り除く。命中の処理が主人公の死を通じて全部の矢を片づける（clear）ことがあり、添字では消えた矢を指して落ちた（矢で倒れると止まった）
  removeArrow(a) { a.mesh.removeFromParent(); const i = this.arrows.indexOf(a); if (i >= 0) this.arrows.splice(i, 1); }

  updateArrows(dt) {
    const g = this.g;
    for (const a of [...this.arrows].reverse()) {
      if (!this.arrows.includes(a)) continue;                       // この周で片づけられた矢
      if (a.stuck) { a.t += dt; if (a.t > 12) this.removeArrow(a); continue; }
      a.life -= dt;
      const sub = Math.max(1, Math.ceil(a.vel.length() * dt / 0.4)), h = dt / sub;
      for (let s = 0; s < sub && !a.stuck; s++) {
        _a.copy(a.pos);
        a.vel.y -= GRAVITY * h; a.pos.addScaledVector(a.vel, h);
        if (this.arrowHitActor(a)) { a.stuck = true; a.hitActor = true; break; }
        if (a.pos.y < g.terrain.heightAt(a.pos.x, a.pos.z) + 0.03 || segmentBlocked(g.col, g.terrain, { x: _a.x, y: _a.y, z: _a.z }, { x: a.pos.x, y: a.pos.y, z: a.pos.z })) { a.stuck = true; a.t = 0; }
      }
      if (a.hitActor) { this.removeArrow(a); continue; }
      a.mesh.position.copy(a.pos);
      _b.copy(a.vel).normalize(); a.mesh.quaternion.copy(_q.setFromUnitVectors(_up, _b));
      if (a.life <= 0 && !a.stuck) this.removeArrow(a);
    }
  }

  arrowHitActor(a) {
    const g = this.g, targets = a.ally ? g.enemies : [g.hero, ...(g.ally?.inParty && !g.ally.down ? [g.ally] : [])];
    for (const d of targets) {
      if (!d.fighter.alive || d.departed || (d.brain && d.brain.state === 'surrendered')) continue;
      if (d === g.hero && g.heroProtected()) continue;                // 会話の最中は主人公に当たらない
      if (Math.hypot(a.pos.x - d.pos.x, a.pos.z - d.pos.z) > 0.5 || a.pos.y < d.pos.y - 0.1 || a.pos.y > d.pos.y + d.character.height + 0.15) continue;
      const fromYaw = yawOf(a.owner.pos.x - d.pos.x, a.owner.pos.z - d.pos.z);
      const res = projectileHit(d.fighter, { damage: a.move.damage, posture: a.move.posture, fromYaw, blockable: true });
      if (!res) continue;
      this.onStrike(a.owner, d, res, { arrow: true });
      return true;
    }
    return false;
  }

  // 弓兵の照準線：射る前の0.9秒、射手から主人公へ細い光を引く
  updateAimLines() {
    const g = this.g; let n = 0;
    for (const e of g.enemies) {
      const f = e.fighter;
      if (n >= this.aimLines.length) break;
      if (!f.alive || e.departed || f.state !== 'attack' || !f.move || f.move.phase !== 'windup' || MOVES[f.move.id].kind !== 'shot') continue;
      const m = MOVES[f.move.id], line = this.aimLines[n++], from = e.chest(), to = g.hero.chest();
      from.y += 0.15;
      _a.set(from.x, from.y, from.z); _b.set(to.x, to.y, to.z);
      const len = _a.distanceTo(_b);
      line.position.copy(_a).lerp(_b, 0.5); line.lookAt(_b); line.scale.set(1, 1, len);
      const near = Math.min(1, Math.max(0.15, (len - 2) / 8));      // 射手の手前では細く薄く（画面いっぱいに伸びる線にならないよう）
      line.material.opacity = (0.10 + 0.5 * Math.min(1, f.move.t / m.windup)) * near;
      line.visible = true;
    }
    for (let i = n; i < this.aimLines.length; i++) this.aimLines[i].visible = false;
  }

  // 戦いが決した瞬間（里を守った・待ち伏せを退けた）：背を向けた兵の振りと、飛んでいる敵の矢を止める。
  // 止めないと、会話の最中にその一撃が当たって倒れ、守ったはずの里が見晴らしからやり直しになった（第2周の評価）
  ceaseFire() {
    for (const e of this.g.enemies) if (e.brain.state === 'retreat' || e.brain.state === 'surrendered') { if (cancelMove(e.fighter)) e.lunge = null; }
    for (const a of [...this.arrows]) if (!a.ally) this.removeArrow(a);
  }

  clear() {
    this.glints.length = 0;
    for (const a of [...this.arrows]) this.removeArrow(a);
    for (const l of this.aimLines) l.visible = false;
  }
}
