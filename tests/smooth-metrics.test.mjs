// smooth-metrics（走り・歩きの滑らかさの指標）が門番になっていることを、合成の記録で確かめる：
// きれいな歩きでは0に近く、わざと入れた欠陥（滑る足・跳ねる関節・向きの跳ね・歩容の往復・跳ぶカメラ・速さの段差）にだけ反応する。
import test from 'node:test';
import assert from 'node:assert/strict';
import { smoothMetrics, footSlip, windowDrift, jointPops, facingJumps, gaitFlips, cameraMotion, speedJumps, percentile, rotvec, BONES } from '../tools/lib/smooth-metrics.mjs';

const DT = 1 / 60, ID = [0, 0, 0, 1];
const qz = deg => { const a = deg * Math.PI / 360; return [0, 0, Math.sin(a), Math.cos(a)]; };

// きれいな歩き：体は +x へ v m/秒。0.6秒の周期で左右の足が交互に着き、着いている足は世界に止まる。カメラは体の後ろを等速で追う
function walker({ v = 2, seconds = 3, slip = 0 } = {}) {
  const frames = [], n = Math.round(seconds / DT), anchor = [null, null];
  for (let i = 0; i < n; i++) {
    const t = i * DT, x = v * t, ph = (t / 0.6) % 1, contact = [ph < 0.5, ph >= 0.5], bones = {};
    for (const b of BONES) bones[b] = [x, 1, 0, ...ID];
    ['LeftFoot', 'RightFoot'].forEach((foot, s) => {
      if (contact[s]) { anchor[s] ||= [x + 0.3, 0.08, s ? 0.1 : -0.1]; anchor[s][0] += slip; bones[foot] = [...anchor[s], ...ID]; }
      else { anchor[s] = null; bones[foot] = [x, 0.2, s ? 0.1 : -0.1, ...ID]; }
    });
    frames.push({ t, tag: t < 1 ? 'a' : 'b', event: i === 0 ? 'start' : null, pos: [x, 0, 0], yaw: 0, modelYaw: Math.PI, speed: v, gait: 'jog', contact, bones, cam: [x - 3, 1.6, 0, ...ID, 58] });
  }
  return { dt: DT, frames };
}

test('a clean walk scores (near) zero on every defect metric', () => {
  const m = smoothMetrics(walker());
  assert.equal(m.slip.total.cmPerM, 0);
  assert.equal(m.windows.max, 0);
  assert.equal(m.pops.legs.over45 + m.pops.arms.over45, 0);
  assert.equal(m.facing.yaw.over + m.facing.modelYaw.over, 0);
  assert.equal(m.gait.flips, 0);
  assert(m.camera.posJerkP99 < 1e-6 && m.camera.rotAccelP99 < 1e-6, JSON.stringify(m.camera));
  assert.equal(m.speed.logical + m.speed.travel, 0);
});

test('a sliding stance foot raises the slip per metre and the window drift', () => {
  const clean = footSlip(walker().frames), bad = footSlip(walker({ slip: 0.01 }).frames);   // 着いている足が1コマ1cm前へ流れる
  assert.equal(clean.total.cmPerM, 0);
  // 1コマ1cm・接地は両足のどちらかが常に着く → 毎秒60cm、2m/秒で進むので 30cm/m 前後
  assert(bad.total.cmPerM > 25 && bad.total.cmPerM < 31, String(bad.total.cmPerM));
  const w = windowDrift(walker({ slip: 0.01 }).frames);
  assert(w.byKind.start >= 16 && w.byKind.start <= 18, JSON.stringify(w.byKind));   // 1回の接地は0.3秒＝18コマ → 着いた点から最大17cm
  assert.equal(windowDrift(walker().frames).max, 0);
});

test('the window drift counts only the motion inside the window, not what the foot did before it opened', () => {
  // 両足が着いたまま、左足が最初の10コマで20cm流れ（止まった直後に足を待ちの姿へ寄せた動き）、あとは止まっている
  const frames = [];
  for (let i = 0; i < 80; i++) {
    const bones = {};
    for (const b of BONES) bones[b] = [0, 1, 0, ...ID];
    bones.LeftFoot = [Math.min(i, 10) * 0.02, 0.08, -0.1, ...ID]; bones.RightFoot = [0, 0.08, 0.1, ...ID];
    frames.push({ t: i * DT, tag: 'a', event: i === 4 ? 'stop' : i === 40 ? 'reverse' : null, pos: [0, 0, 0], yaw: 0, modelYaw: 0, speed: 0, gait: 'idle', contact: [true, true], bones, cam: [0, 1.6, 0, ...ID, 58] });
  }
  const w = windowDrift(frames), stop = w.list.find(e => e.kind === 'stop'), reverse = w.list.find(e => e.kind === 'reverse');
  assert(stop.maxCm >= 11.5 && stop.maxCm <= 12.5, `the slide inside the stop window: ${stop.maxCm}`);   // 4コマ目（8cm）から10コマ目（20cm）まで＝12cm
  assert.equal(reverse.maxCm, 0);   // 窓の前の動きは数えない（接地の始めからの累積なら、ここも20cm になる）
});

test('a forearm that snaps 60 degrees in one frame counts once over 45 and not over 90; 120 counts over 90', () => {
  const r = walker();
  r.frames[50].bones.LeftForeArm = [0, 1, 0, ...qz(60)];      // 跳んで、次のコマで戻る → 2回（行きと帰り）
  let p = jointPops(r.frames);
  assert.equal(p.arms.over45, 2); assert.equal(p.arms.over90, 0); assert.equal(p.legs.over45, 0);
  assert.equal(p.worst.arms.bone, 'LeftForeArm');
  r.frames[90].bones.RightLeg = [0, 1, 0, ...qz(120)];
  p = jointPops(r.frames);
  assert.equal(p.legs.over90, 2);
  // 体全体が回るだけ（親と子が同じだけ回る）なら数えない
  const turn = walker(); turn.frames.forEach((f, i) => { if (i >= 60) for (const b of BONES) f.bones[b] = [f.bones[b][0], 1, 0, ...qz(80)]; });
  assert.equal(jointPops(turn.frames).legs.over45, 0);
});

test('facing jumps, gait flips, camera jumps and speed steps are each detected', () => {
  const r = walker();
  r.frames[40].modelYaw += 0.8;                              // 46°跳んで戻る
  assert.equal(facingJumps(r.frames).modelYaw.over, 2);
  assert.equal(facingJumps(r.frames).yaw.over, 0);
  r.frames[70].gait = 'walk'; r.frames[71].gait = 'walk';      // jog→walk→jog が 2コマで
  assert.equal(gaitFlips(r.frames).flips, 1);
  const g = walker(); for (let i = 70; i < 120; i++) g.frames[i].gait = 'walk';   // 0.83秒後に戻るのは往復ではない
  assert.equal(gaitFlips(g.frames).flips, 0);
  const c = walker(); for (let i = 100; i < c.frames.length; i++) c.frames[i].cam[0] += 0.3;   // カメラが30cm跳ぶ
  assert(cameraMotion(c.frames, DT).posJerkMax > 1e5);
  const q = walker(); for (let i = 100; i < q.frames.length; i++) q.frames[i].cam.splice(3, 4, ...qz(20));   // 向きが20°跳ぶ
  assert(cameraMotion(q.frames, DT).rotAccelMax > 1000);
  const s = walker(); for (let i = 120; i < s.frames.length; i++) { s.frames[i].pos = [...s.frames[119].pos]; s.frames[i].speed = 0; }   // 1コマで止まる
  const sj = speedJumps(s.frames, DT);
  assert.equal(sj.logical, 1); assert.equal(sj.travel, 1);
});

test('helpers: percentile is nearest-rank, rotvec handles the double cover', () => {
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 99), 10);
  assert.equal(percentile([1, 2, 3, 4], 50), 2);
  const a = rotvec(qz(30)), b = rotvec(qz(30).map(x => -x));
  assert(Math.abs(a[2] - Math.PI / 6) < 1e-9 && Math.abs(b[2] - Math.PI / 6) < 1e-9);
});

test('the low-contact slip and the camera exclusion read only what they are told to', () => {
  const r = walker({ slip: 0.01 });
  r.frames.forEach(f => { f.low = [false, false]; });                 // 地面の近くの足が無ければ、低い接地の滑りは0
  assert.equal(footSlip(r.frames, 'low').total.cmPerM, 0);
  assert(footSlip(r.frames).total.cmPerM > 25);
  const c = walker(); for (let i = 100; i < c.frames.length; i++) c.frames[i].cam[0] += 0.3;
  c.frames.forEach(f => { if (f.t >= 1.6 && f.t < 1.8) f.tag = 'turn'; });   // 跳びを含む区間だけを外すと、要約の p99 は0に戻る
  assert(cameraMotion(c.frames, DT).posJerkP99 > 0 || cameraMotion(c.frames, DT).posJerkMax > 1e5);
  assert.equal(cameraMotion(c.frames, DT, ['turn']).posJerkMax > 1e5, true);
  assert.equal(cameraMotion(c.frames, DT, ['turn']).posJerkP99, 0);
});
