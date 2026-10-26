// battle.js — 戦闘の結線（app層）。当たりの判定は combat.js に任せ、結果を音・火花・揺れ・敵の反応・士気・任務へ配る。
// 矢の飛行・予兆（刃の光・照準線）・掛け声・士気の伝播もここ。規則の数値は combat.js と config.js の FEEL。
import * as THREE from 'three';
import { MOVES, strike, projectileHit } from './combat.js';
import { adjustMorale, alertFromAlly } from './enemy-ai.js';
import { segmentBlocked } from './collision.js';
import { makeArrow } from './weapons.js';
import { STORY } from './story-data.js';
import { FEEL } from './config.js';
import { yawOf, dist2 } from './actors.js';

const GRAVITY = 9.8;
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _q = new THREE.Quaternion();

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
  }

  // ---------------------------------------------------------------- 近接
  resolveMelee() {
    const g = this.g, hero = g.hero, hf = hero.fighter;
    if (hf.alive && hf.state === 'attack' && hf.move?.phase === 'active') {
      for (const e of g.enemies) {
        if (!e.fighter.alive || e.departed || e.brain.state === 'surrendered') continue;
        const res = strike(hf, e.fighter);
        if (res) this.onStrike(hero, e, res);
      }
    }
    for (const e of g.enemies) {
      const f = e.fighter;
      if (!f.alive || e.departed || f.state !== 'attack' || f.move?.phase !== 'active' || MOVES[f.move.id].kind === 'shot') continue;
      if (hf.alive) { const res = strike(f, hf); if (res) this.onStrike(e, hero, res); }
      const ally = g.ally;
      if (ally?.inParty && !ally.down) { const res = strike(f, ally.fighter); if (res) this.onStrike(e, ally, res); }
    }
  }

  onStrike(att, def, res, { arrow = false } = {}) {
    const g = this.g, pos = def.chest(); pos.y += 0.1;
    const dx = def.pos.x - att.pos.x, dz = def.pos.z - att.pos.z, dl = Math.hypot(dx, dz) || 1, dir = { x: dx / dl, z: dz / dl };
    const pan = g.pan(def.pos), heroDef = def === g.hero, heroAtt = att === g.hero;
    switch (res.outcome) {
      case 'hit': case 'stealth': {
        if (res.outcome === 'stealth' && heroAtt) g.stats.stealth++;
        const strong = res.moveId === 'heavy' || res.moveId === 'finisher' || res.outcome === 'stealth' || res.damage >= 20;
        g.fx.hit(pos, dir, { strong });
        g.audio.play(arrow ? 'arrow_hit' : strong ? 'hit_heavy' : 'hit', { pan });
        g.hitStop(strong ? FEEL.hitStop.heavy : FEEL.hitStop.hit);
        if (heroDef) { g.rig.kick(0.7); g.rig.punchFov(1.8); g.hud.hurt(); g.hud.hint('dodge', STORY.hints.dodge); }
        else if (heroAtt) { g.rig.kick(strong ? 0.5 : 0.25); g.rig.punchFov(strong ? 1.6 : 0.8); }
        break;
      }
      case 'blocked':
        g.fx.hit(pos, dir, { blocked: true });
        g.audio.play(arrow ? 'arrow_hit' : 'block', { pan });
        g.hitStop(FEEL.hitStop.hit * 0.8);
        if (heroDef) { g.rig.kick(0.35); g.hud.hint('parry', STORY.hints.parry); }
        break;
      case 'parried':
        if (heroDef) g.stats.parries++;
        g.fx.parry(pos);
        g.audio.play('parry', { pan });
        g.hitStop(FEEL.hitStop.parry);
        if (heroDef) { g.rig.kick(0.5); g.rig.punchFov(3.2); g.hud.toast('弾いた', 900); g.hud.hint('finisher', STORY.hints.finisher); }
        break;
      default: return;
    }
    def.onHit?.(res, att);
    if (res.outcome === 'parried') {
      att.onHit?.(res, def);
      if (att.brain) adjustMorale(att.brain, FEEL.parriedMorale, 'parried');
    }
    g.emitNoise(def.pos.x, def.pos.z, res.outcome === 'hit' ? 12 : 18, 'clash');
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
      g.fx.add.emit({ pos: [p.x + fx * 0.55, p.y + 0.4, p.z + fz * 0.55], vel: [0, 0, 0], life: 0.17, size: 1.0, sizeEnd: 0.25, color: [1, 0.88, 0.6], alpha: 1 });
      g.audio.play('alert', { gain: 0.55, pan: g.pan(actor.pos), pitch: 1.5 });
      this.glints.push({ actor, t: 0.34 });
      if (dist2(actor.pos, g.hero.pos) < 16) g.hud.hint('parry', STORY.hints.parry);
    });
  }
  // 予兆の光：振りかぶる刃に沿って光の粒を並べる（光る刃が弾きの合図。胸の前の光だけだと主人公の陰で見えなかった）
  updateGlints(dt) {
    const g = this.g;
    for (let i = this.glints.length - 1; i >= 0; i--) {
      const gl = this.glints[i]; gl.t -= dt;
      const w = gl.actor.character?.weapons?.tachiDrawn || gl.actor.character?.weapons?.naginata;
      if (gl.t <= 0 || !w || !w.holder.visible || !gl.actor.fighter.alive) { this.glints.splice(i, 1); continue; }
      const len = w === gl.actor.character.weapons.naginata ? 1.7 : 0.95;
      w.holder.updateWorldMatrix(true, false);
      // 細かい光の粒を刃に沿って詰める（丸い大きな玉だと「白い玉が3つ浮く」に見えた）。切先ほど明るく太い
      for (let k = 0; k < 11; k++) {
        const t = 0.22 + k * 0.08;
        _a.set(0, t * len, 0); w.holder.localToWorld(_a);
        g.fx.add.emit({ pos: [_a.x, _a.y, _a.z], vel: [0, 0, 0], life: 0.12, size: 0.07 + 0.1 * t, sizeEnd: 0.03, color: [1, 0.92, 0.68], alpha: 0.55 + 0.4 * t });
      }
    }
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

  clear() {
    this.glints.length = 0;
    for (const a of [...this.arrows]) this.removeArrow(a);
    for (const l of this.aimLines) l.visible = false;
  }
}
