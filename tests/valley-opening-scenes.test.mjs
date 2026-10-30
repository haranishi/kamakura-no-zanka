import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENES, SCENE_IDS, cameraAt, flameSprites, createParticleState, particleStep, horizonColor, isVermilion, vermilionShare, flashRate } from '../dist/valley/opening-scenes.js';
import { flicker } from '../dist/valley/opening.js';

const MODELS = new Set(fs.readdirSync(new URL('../dist/assets/valley/models/', import.meta.url)).filter(f => f.endsWith('.glb')).map(f => f.replace(/\.glb$/, '')));
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const run = (id, total, dt) => { let s = createParticleState(id); const out = []; for (let t = 0; t < total - 1e-9; t += dt) { const r = particleStep(id, s, dt); s = r.state; out.push(...r.spawns); } return { state: s, spawns: out }; };

test('場面は A〜D の4つ。データは凍結され、置くのは谷の既存のモデルだけ（新しい素材を使わない）', () => {
  assert.deepEqual(SCENE_IDS, ['A', 'B', 'C', 'D']);
  assert.ok(Object.isFrozen(SCENES) && Object.isFrozen(SCENES.A.models[0]) && Object.isFrozen(SCENES.B.fires[0]));
  for (const id of SCENE_IDS) {
    const s = SCENES[id];
    for (const m of s.models) assert.ok(MODELS.has(m.key), `${id}: ${m.key} is not a valley model`);
    for (const k of ['camera', 'sky', 'fog', 'ground', 'key', 'glow', 'fires', 'particles']) assert.ok(s[k], `${id}.${k}`);
  }
  const origins = SCENE_IDS.map(id => SCENES[id].origin[0]);
  for (let i = 1; i < origins.length; i++) assert.ok(origins[i] - origins[i - 1] >= 150, 'scene groups are far apart');
});

test('燃えるのは寺と数棟の家だけ（町全体を焼かない）：Aは2棟、Bは寺だけ', () => {
  const houses = SCENES.A.models.filter(m => m.key === 'farmhouse' || m.key === 'naya');
  assert.ok(houses.length >= 4, 'the street is lined with houses');
  assert.equal(houses.filter(m => m.burning).length, 2);
  assert.deepEqual(SCENES.B.models.filter(m => m.burning).map(m => m.key), ['temple']);
  for (const id of ['C', 'D']) assert.equal(SCENES[id].models.filter(m => m.burning).length, 0, `${id} has no burning building in view`);
  assert.ok(SCENES.A.flag && SCENES.A.flag.pole.length === 2, 'A has the fallen plain flag');
});

test('カメラ：Aは低く、奥へ約4m進む。Bは石段の下から見上げる固定。世界座標で返し、k は0〜1に収める', () => {
  const a0 = cameraAt('A', 0), a1 = cameraAt('A', 1);
  assert.ok(Math.abs(dist(a0.pos, a1.pos) - 4) <= 0.3, String(dist(a0.pos, a1.pos)));
  assert.ok(a1.pos[2] < a0.pos[2], 'forward is -z');
  for (const c of [a0, a1]) assert.ok(c.pos[1] <= 1.3, 'low camera');
  const b0 = cameraAt('B', 0), b1 = cameraAt('B', 1);
  assert.deepEqual(b0, b1, 'B is fixed');
  assert.ok(b0.look[1] - b0.pos[1] > 3, 'B looks up');
  assert.equal(b0.pos[0], SCENES.B.origin[0] + SCENES.B.camera.from[0], 'world coordinates include the scene origin');
  assert.deepEqual(cameraAt('A', -1), a0); assert.deepEqual(cameraAt('A', 2), a1);
  assert.equal(cameraAt('Z', 0.5), null);
  for (let k = 0; k < 1; k += 0.01) assert.ok(dist(cameraAt('A', k).pos, cameraAt('A', k + 0.01).pos) < 0.07, `no jump at k=${k.toFixed(2)}`);
  assert.ok(dist(cameraAt('A', 0).pos, cameraAt('A', 0.01).pos) < dist(cameraAt('A', 0.5).pos, cameraAt('A', 0.51).pos), 'eases in');
});

test('炎の板：源ごとに決まった数・範囲・大きさで並び、毎回同じ（乱数と時計に依らない）', () => {
  for (const id of SCENE_IDS) {
    const a = flameSprites(id), b = flameSprites(id);
    assert.deepEqual(a, b);
    const want = SCENES[id].fires.reduce((n, f) => n + (f.shape === 'glow' ? 1 : f.n), 0);
    assert.equal(a.length, want, id);
    let i = 0;
    for (const f of SCENES[id].fires) {
      const group = a.slice(i, i += f.shape === 'glow' ? 1 : f.n);
      for (const s of group) {
        assert.ok(s.seed >= 0 && s.seed <= 1 && s.power > 0);
        if (f.shape === 'glow') { assert.equal(s.kind, 1); assert.deepEqual(s.pos, [...f.at]); continue; }
        assert.equal(s.kind, 0);
        assert.ok(s.w >= f.w[0] - 1e-9 && s.w <= f.w[1] + 1e-9 && s.h >= f.h[0] - 1e-9 && s.h <= f.h[1] + 1e-9);
        assert.ok(s.power >= f.power * 0.8 - 1e-9 && s.power <= f.power * 1.2 + 1e-9);
        if (f.shape === 'area') for (let k = 0; k < 3; k++) assert.ok(Math.abs(s.pos[k] - f.at[k]) <= f.box[k] / 2 + 1e-9, `${id} area`);
        else { const L = dist(f.from, f.to), d = dist(s.pos, f.from) + dist(s.pos, f.to); assert.ok(d <= L + 0.8, `${id} line: ${d} vs ${L}`); }
      }
    }
  }
  assert.deepEqual(flameSprites('Z'), []);
});

test('火の粉・煙：1秒あたりの数を守り、刻みの細かさに依らず同じ粒が同じ順に出る', () => {
  for (const id of SCENE_IDS) {
    const coarse = run(id, 10, 1), fine = run(id, 10, 1 / 60);
    assert.equal(coarse.spawns.length, fine.spawns.length, id);
    SCENES[id].particles.forEach((p, i) => assert.ok(Math.abs(coarse.state[i].n - p.rate * 10) <= 1, `${id} source ${i}: ${coarse.state[i].n}`));
    const key = s => s.kind + s.pos.map(v => v.toFixed(6)).join();
    assert.deepEqual(new Set(coarse.spawns.map(key)), new Set(fine.spawns.map(key)));
  }
  const s0 = createParticleState('A');
  for (const dt of [0, -1, NaN, Infinity]) { const r = particleStep('A', s0, dt); assert.equal(r.spawns.length, 0, String(dt)); assert.deepEqual(r.state, s0, `state unchanged for dt=${dt}`); }
  assert.deepEqual(particleStep('Z', s0, 1), { state: s0, spawns: [] });
});

test('火の粉は上り、煙と火の粉は場面の風下へ流れる（風向をそろえる）', () => {
  for (const id of SCENE_IDS) {
    const w = SCENES[id].wind, { spawns } = run(id, 5, 1 / 30);
    for (const kind of ['ember', 'smoke']) {
      const list = spawns.filter(s => s.kind === kind); if (!list.length) continue;
      const mean = [0, 2].map(k => list.reduce((a, s) => a + s.vel[k], 0) / list.length);
      assert.ok(mean[0] * w[0] + mean[1] * w[1] > 0, `${id} ${kind} drifts downwind`);
      assert.ok(list.every(s => s.vel[1] > 0 && s.life > 0 && s.size > 0), `${id} ${kind} rises`);
    }
  }
});

test('地平の色：空の式と同じ。炎の方角ほど明るく、にじみが無ければ地平と中空の混ぜ色', () => {
  const sky = SCENES.A.sky, lum = h => [1, 3, 5].reduce((a, i) => a + parseInt(h.slice(i, i + 2), 16), 0);
  assert.match(horizonColor(sky, [0, -1]), /^#[0-9a-f]{6}$/);
  assert.ok(lum(horizonColor(sky, sky.glowDir)) > lum(horizonColor(sky, [-sky.glowDir[0], -sky.glowDir[1]])));
  assert.equal(horizonColor({ ...sky, glowAmt: 0 }, [1, 0]), horizonColor({ ...sky, glowAmt: 0 }, [0, 1]));
  assert.equal(horizonColor({ ...sky, hor: '#404040', mid: '#404040', glowAmt: 0 }, [1, 0]), '#404040');
});

test('朱の画素：赤〜橙で彩度と明るさのあるものだけ。上下の帯は数えない', () => {
  for (const c of ['#e36b48', '#c0401c', '#ff7a32', '#b8461c']) assert.equal(isVermilion(...[1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))), true, c);
  for (const c of ['#fff0d0', '#3a1610', '#2050a0', '#5e4c3e', '#000000', '#eee9dc', '#6a8a30']) assert.equal(isVermilion(...[1, 3, 5].map(i => parseInt(c.slice(i, i + 2), 16))), false, c);
  const W = 10, H = 8, img = new Uint8Array(W * H * 4);
  const fill = (y, rgb) => { for (let x = 0; x < W; x++) img.set([...rgb, 255], (y * W + x) * 4); };
  for (let y = 0; y < H; y++) fill(y, [10, 10, 10]);
  fill(0, [230, 90, 40]); fill(H - 1, [230, 90, 40]);        // 帯の中の朱は数えない
  fill(3, [230, 90, 40]); fill(4, [230, 90, 40]);
  assert.equal(vermilionShare(img, W, H, { bar: 0.125 }), 2 / 6);
  assert.equal(vermilionShare(img, W, H), 4 / 8);
});

test('明滅の数え方：1Hzの揺れは1秒に約1回、5Hzは約5回、一定なら0。炎の揺らぎ（flicker）は1秒に3回以下', () => {
  const wave = (hz, amp) => Array.from({ length: 180 }, (_, i) => 0.5 + amp * Math.sin(2 * Math.PI * hz * i / 60));
  assert.ok(Math.abs(flashRate(wave(1, 0.3), 60) - 1) <= 0.35, String(flashRate(wave(1, 0.3), 60)));
  assert.ok(Math.abs(flashRate(wave(5, 0.3), 60) - 5) <= 0.5, String(flashRate(wave(5, 0.3), 60)));
  assert.equal(flashRate(new Array(120).fill(0.4), 60), 0);
  assert.equal(flashRate(wave(5, 0.03), 60), 0, 'small ripples are not flashes');
  assert.equal(flashRate([], 60), 0);
  const gain = Array.from({ length: 600 }, (_, i) => (0.9 + 0.1 * flicker(i / 60, 2)) * 0.6);
  assert.ok(flashRate(gain, 60, 0.02) <= 3, String(flashRate(gain, 60, 0.02)));
});
