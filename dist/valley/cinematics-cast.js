// cinematics-cast.js — 演出の間の「人物の見た目」と「景色」（app層・C1）。cinematics-view.js の CinematicDirector が毎コマ呼ぶ。
// 世界は止めたまま（論理・判断・戦闘・乱数 game.rng は触らない）。ここが動かすのは見た目だけ：
//  ・人物：表の cast に挙げた人物の動作を、足音・動作の終了の通知を外して進め（息づかい）、骨の後処理でうなずき・視線・袖印を持つ手を足す。
//  ・景色：焚き火の炎（粒は fx の Math.random。game.rng は使わない）、袖印が手から火へ落ちる動き、くべたあと炎が上がる間。
// 毎コマの新しい確保をしない（作業用のベクトルは使い回す）。
import * as THREE from 'three';
import { WORLD } from './world-data.js';

const UP = new THREE.Vector3(0, 1, 0), AX = new THREE.Vector3(), PQ = new THREE.Quaternion(), Q = new THREE.Quaternion(), P = new THREE.Vector3();
const clamp01 = v => Math.max(0, Math.min(1, v));
const smooth = k => k * k * (3 - 2 * k);
const RATE = 4;                                                   // 身振りの重みが目標へ寄る速さ（1/秒）。ショットの切り替えで姿勢が跳ばない
const TWIST = [['Spine', 0.16], ['Spine01', 0.18], ['Spine02', 0.2], ['neck', 0.22], ['Head', 0.24]];   // 振り向きの配り方（腰から頭へ）
const FIRE_TICK = 0.06;                                           // 焚き火の粒を出す間隔（game.updateAmbientFx と同じ）
const FLARE_SEC = 1.6;                                            // 袖印をくべたあと炎が高い間（既存の sode_burn と同じ）
const FALL = { start: 0.2, dur: 0.7, arc: 0.35, fireY: 0.3, still: 0.8, hang: 0.17, tilt: 1.25 };   // 手から火へ：ショット開始0.2秒後から0.7秒、弧の高さ、火の高さ、静止版の代表の位置、指から垂れる分、手に持つ起こし

const TOUCHED = ['Spine', 'Spine01', 'Spine02', 'neck', 'Head', 'RightArm', 'RightForeArm'];
// 世界の向きの軸で骨を回す（親の世界の向きで、その軸を骨の局所へ直す）
function turnBone(bone, axis, angle) {
  if (!bone || !angle) return;
  bone.parent.updateWorldMatrix(true, false); bone.parent.getWorldQuaternion(PQ);
  AX.copy(axis).applyQuaternion(PQ.invert());
  bone.quaternion.premultiply(Q.setFromAxisAngle(AX, angle));
}

export class CinemaCast {
  constructor(game) { this.g = game; this.on = false; this.fxDt = 0; this.last = null; }

  // 演出の開始：cast の人物を集め、景色の状態を作る
  begin(entry) {
    const g = this.g;
    this.cast = (entry.cast || []).map(name => this.actor(name)).filter(Boolean).map(actor => ({ actor, w: { hold: 0, look: 0 }, target: { hold: 0, look: 0 }, lookAt: null, lookFire: false, lookH: 0, nodT: null,
      // 後処理を当てる骨ごとに、当てる前と後の向き。動作の値が変わらないコマは mixer が骨を書き直さない（three の PropertyMixer）ので、
      // 前のコマの後処理が残っていたら当てる前へ戻してから当て直す（戻さないと、止めた動作の上でうなずきが毎コマ積み重なった）
      bones: TOUCHED.map(n => actor.character.bone(n)).filter(Boolean).map(bone => ({ bone, pre: new THREE.Quaternion(), post: new THREE.Quaternion(), set: false })),
      armRelax: actor.character.armRelax }));
    this.fire = WORLD.props.find(p => p.id === 'bonfire');
    this.fireT = 0; this.tick = 0; this.flare = 0; this.burnAt = null; this.handAt = null; this.sode = null; this.fxDt = 0;
    this.last = { id: entry.id, variant: entry.variant ?? null, burned: false, burnAt: null, sodeSeen: false, cast: this.cast.map(c => c.actor.id || c.actor.who) };
    for (const c of this.cast) c.actor.character.cinePose = ch => this.pose(c, ch);
    this.on = this.cast.length > 0 || entry.shots.some(s => s.scenery.length) || !!entry.variants;
    if (this.on) g.relicView.update([], 0, g.camera, true);      // 地面の調べる物は演出の間は出さない（結末の場面には無い）
  }
  actor(name) { const g = this.g; return name === 'hero' ? g.hero : name === 'ally' ? g.ally : g.npcs.get(name) || null; }

  // 毎コマ：v は cinematicView の見え方、player は再生の状態、dt はこのコマに進んだ演出の秒（休止明けは0）
  update(v, player, dt, reduced) {
    if (!this.on) { this.fxDt = 0; return; }
    const shot = player.entry.shots[Math.max(0, player.shotIndex)], playing = player.phase === 'playing';
    const t = playing ? player.shotTimeSec : 0;
    // 人物：目標の重み（ショットの身振り）へ寄せ、見た目だけ進める。準備・復帰の間は目標0（遊びの姿勢へ戻る）
    for (const c of this.cast) { c.target.hold = 0; c.target.look = 0; c.nodT = null; }
    for (const cue of v.gestures) this.cue(cue, t, reduced);
    const k = reduced ? 1 : 1 - Math.exp(-RATE * dt);
    for (const c of this.cast) {
      c.w.hold += (c.target.hold - c.w.hold) * k; c.w.look += (c.target.look - c.w.look) * k;
      const ch = c.actor.character, seg = ch.segment, onEnd = ch.onSegmentEnd, onContact = ch.onContact;
      ch.segment = null; ch.onSegmentEnd = null; ch.onContact = null;   // 動作の終了・足音から論理への通知を遮る
      // 動きを減らす設定では動作を止め（dt=0）、代表の姿勢だけ当てる。止めた動作では mixer が骨を書き直さないので、
      // 腕の力の抜き（relaxArms）が毎コマ積み重なって腕が上がっていった。止めている間だけ外す（直前の抜き具合は骨に残る）
      ch.armRelax = reduced ? false : c.armRelax;
      ch.update(reduced ? 0 : dt);
      ch.segment = seg; ch.onSegmentEnd = onEnd; ch.onContact = onContact;
    }
    this.scenery(shot.scenery, playing, t, dt, reduced);   // 炎は準備・復帰の間も（最初・最後のショットの景色）。袖印は再生中だけ
  }
  cue(cue, t, reduced) {
    const [kind, who] = cue.split(':'), [a, b] = (who || '').split('>');
    const c = this.cast.find(x => x.actor === this.actor(a)); if (!c) return;
    if (kind === 'hold') c.target.hold = 1;
    else if (kind === 'release') c.target.hold = !reduced && t < FALL.start ? 1 : 0;   // 手を開くまで（袖印が離れるまで）は差し出したまま
    else if (kind === 'look' || kind === 'gaze') {
      const o = b === 'fire' ? null : this.actor(b);
      c.target.look = 1; c.lookFire = !o; c.lookAt = o ? o.pos : this.fire; c.lookH = o ? o.character.height : 0;
    }
    else if (kind === 'nod') c.nodT = reduced ? 0.65 : t;          // 静止版はうなずきの深い所
  }
  // 骨の後処理（Character.update の中、握りの層より前）。重みはこのコマの値
  pose(c, ch) {
    for (const b of c.bones) { if (b.set && b.bone.quaternion.equals(b.post)) b.bone.quaternion.copy(b.pre); b.pre.copy(b.bone.quaternion); }
    this.posePart(c, ch);
    for (const b of c.bones) { b.post.copy(b.bone.quaternion); b.set = true; }
  }
  posePart(c, ch) {
    const actor = c.actor, yaw = actor.yaw, fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    const look = c.w.look || 0;
    if (look > 1e-3 && c.lookAt) {
      const dx = c.lookAt.x - actor.pos.x, dz = c.lookAt.z - actor.pos.z;
      const turn = Math.max(-1.25, Math.min(1.25, Math.atan2(fz * dx - fx * dz, fx * dx + fz * dz)));
      for (const [name, share] of TWIST) turnBone(ch.bone(name), UP, turn * share * look);
      // 上下：火は足もとを見下ろす。人は頭の高さの差（子は低く、大人は高い）
      const d = Math.hypot(dx, dz) || 1, dh = c.lookFire ? -ch.height * 0.85 : (c.lookH - ch.height) * 0.95;
      const pitch = Math.max(-0.5, Math.min(0.4, Math.atan2(dh, d)));
      const cy = Math.cos(turn * look), sy = Math.sin(turn * look), lx = fx * cy + fz * sy, lz = -fx * sy + fz * cy;
      AX.set(lz, 0, -lx); P.copy(AX);                               // 上×向き：前へ倒す軸。下を見るのは正の角
      for (const name of ['neck', 'Head']) turnBone(ch.bone(name), P, -pitch * 0.5 * look);
    }
    if (c.nodT != null) {                                         // うなずき：0.3秒から0.7秒で1回、深さ0.3rad
      const n = Math.sin(Math.PI * clamp01((c.nodT - 0.3) / 0.7)) * 0.3;
      P.set(fz, 0, -fx); for (const name of ['neck', 'Head']) turnBone(ch.bone(name), P, n * 0.5);
    }
    const hold = c.w.hold || 0;
    if (hold > 1e-3) {                                            // 右手で袖印を火の方へ差し出す（腕を前へ、肘を曲げる）
      P.set(-fz, 0, fx);
      turnBone(ch.bone('RightArm'), P, 0.95 * hold); turnBone(ch.bone('RightForeArm'), P, 0.75 * hold);
    }
  }

  // 景色：焚き火の炎・袖印・炎が上がる間
  scenery(cues, playing, t, dt, reduced) {
    const g = this.g, f = this.fire, hero = g.hero;
    const fire = cues.includes('fire'), sodeHand = playing && cues.includes('sode_hand'), sodeFall = playing && cues.includes('sode_fall');
    this.fxDt = fire ? dt : 0;
    if (fire) {
      const p = { x: f.x, y: g.terrain.heightAt(f.x, f.z) + 0.15, z: f.z };
      for (this.fireT += dt; this.fireT >= FIRE_TICK; this.fireT -= FIRE_TICK) {
        const n = this.tick++;
        g.fx.flame(p); if (n % 3 === 0) g.fx.ember({ ...p, y: p.y + 0.4 }); if (n % 8 === 0) g.fx.smoke({ ...p, y: p.y + 0.9 });
        if (this.flare > 0) { this.flare -= FIRE_TICK; for (let i = 0; i < 2; i++) g.fx.flame({ ...p, y: p.y + 0.15 + i * 0.14 }); g.fx.ember({ ...p, y: p.y + 0.6 }); }
      }
    }
    let item = null;
    if (sodeHand || sodeFall) {
      const hand = hero.character.bone('RightHand');
      if (sodeHand || !this.handAt) {
        hand.updateWorldMatrix(true, false); hand.getWorldPosition(P);
        this.handAt = { x: P.x, z: P.z, y: P.y - g.terrain.heightAt(P.x, P.z) - FALL.hang };
      }
      const h = this.handAt, c = g.camera.position, face = Math.atan2(c.x - h.x, c.z - h.z);   // 布の面をカメラへ向ける（寝かせたままでは横から線にしか見えない）
      if (sodeHand) item = { id: 'sode_burn', kind: 'sode', x: h.x, z: h.z, y: h.y, yaw: 0, tilt: FALL.tilt, face };
      else {
        const k = reduced ? FALL.still : clamp01((t - FALL.start) / FALL.dur);
        if (k >= 1) this.burn();
        else item = { id: 'sode_burn', kind: 'sode', x: h.x + (f.x - h.x) * k, z: h.z + (f.z - h.z) * k,
          y: h.y + (FALL.fireY - h.y) * smooth(k) + FALL.arc * Math.sin(Math.PI * k), yaw: k * 2.2, tilt: FALL.tilt * (1 - smooth(k)) + 0.06, face };
      }
    }
    if (playing && cues.includes('fire_flare')) this.burn();                 // 静止版・時間の端数でも、炎が上がる画では燃えている
    if (item) this.last.sodeSeen = true;
    g.relicView.update(item ? [item] : [], 0, g.camera, true);
  }
  burn() {
    if (this.last.burned) return;
    this.last.burned = true; this.last.burnAt = +this.g.cinema.active?.player.elapsedSec.toFixed(3);
    this.flare = FLARE_SEC;
  }

  // 片づけ：身振りの後処理を外す（次のコマから動作の骨は元の動作に戻る）。足の接地は区切り直す（止めていた間の分を足音にしない）
  end() {
    for (const c of this.cast || []) {
      c.actor.character.cinePose = null; c.actor.character.resetContacts(); c.actor.character.armRelax = c.armRelax;
      for (const b of c.bones) if (b.set && b.bone.quaternion.equals(b.post)) b.bone.quaternion.copy(b.pre);   // 後処理を残さない
    }
    if (this.on) this.g.relicView.drop('sode_burn');
    this.cast = []; this.on = false; this.fxDt = 0;
  }
}
