import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SCENES, SCENE_IDS, cameraAt, flameSprites, createParticleState, particleStep, horizonColor, isVermilion, vermilionShare, flashRate, heroAt, particleSources, fireRoot, townHouses, townLights, scatterGround, rimShade, figureAt, smoothNormals } from '../dist/valley/opening-scenes.js';
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

test('燃えるのは寺と数棟の家だけ（町全体を焼かない）：Aは2棟、Bは寺だけ、Cは対岸の2棟、Dは町の一区画', () => {
  const houses = SCENES.A.models.filter(m => m.key === 'farmhouse' || m.key === 'naya');
  assert.ok(houses.length >= 4, 'the street is lined with houses');
  assert.equal(houses.filter(m => m.burning).length, 2);
  assert.deepEqual(SCENES.B.models.filter(m => m.burning).map(m => m.key), ['temple']);
  const cBurn = SCENES.C.models.filter(m => m.burning);
  assert.equal(cBurn.length, 2, 'C: two houses burn on the far banks');
  for (const m of cBurn) assert.ok(m.at[2] < -20, 'C: the burning houses stand beyond the bridge');
  assert.equal(SCENES.D.models.filter(m => m.burning).length, 0);
  const town = townHouses(SCENES.D.town), burnt = town.filter(h => h.burn).length;
  assert.ok(burnt > 0 && burnt / town.length <= 0.1, `D: one district burns, not the whole town (${burnt}/${town.length})`);
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
        const hMin = f.top === undefined ? f.h[0] : f.h[0] * 0.4;                          // 先の上限で縮めるときだけ、短くなってよい
        assert.ok(s.w >= f.w[0] * 0.75 - 1e-9 && s.w <= f.w[1] * 1.1 + 1e-9 && s.h >= hMin - 1e-9 && s.h <= f.h[1] + 1e-9, `${id} size ${s.w} ${s.h}`);
        assert.ok(s.power >= f.power * 0.8 - 1e-9 && s.power <= f.power * 1.2 + 1e-9);
        const y0 = (f.shape === 'area' ? f.at[1] : Math.min(f.from[1], f.to[1])) - (f.box ? f.box[1] / 2 : 0), y1 = (f.shape === 'area' ? f.at[1] : Math.max(f.from[1], f.to[1])) + (f.box ? f.box[1] / 2 : 0);
        const jy = (f.jitterY ?? 0.35) * f.h[0] / 2;
        assert.ok(s.pos[1] >= y0 - jy - (f.sink ?? 0) * f.h[1] - 1e-9 && s.pos[1] <= y1 + jy + 1e-9, `${id} root height`);
        if (f.shape === 'area') for (const k of [0, 2]) assert.ok(Math.abs(s.pos[k] - f.at[k]) <= f.box[k] / 2 + 1e-9, `${id} area`);
        else { const flat = p => [p[0], 0, p[2]], L = dist(flat(f.from), flat(f.to)), d = dist(flat(s.pos), flat(f.from)) + dist(flat(s.pos), flat(f.to)); assert.ok(d <= L + 0.8, `${id} line: ${d} vs ${L}`); }
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

test('炎の柵にしない：舌の高さは短い舌を多めに散らし、根元の高さもずらす。先の上限（top）を越えない', () => {
  for (const id of SCENE_IDS) {
    const all = flameSprites(id); let i = 0;
    for (const f of SCENES[id].fires) {
      const group = all.slice(i, i += f.shape === 'glow' ? 1 : f.n);
      if (f.shape === 'glow' || f.n < 5) continue;                                         // 4本以下の小さな火は、数が少なく比べにくい
      const hs = group.map(s => s.h), ys = group.map(s => s.pos[1]);
      assert.ok(Math.max(...hs) / Math.min(...hs) >= 1.5, `${id}: heights vary (${Math.min(...hs).toFixed(2)}–${Math.max(...hs).toFixed(2)})`);
      assert.ok(Math.max(...ys) - Math.min(...ys) >= 0.12 * f.h[0], `${id}: the roots are not on one line`);
      const short = hs.filter(h => h < (f.h[0] + f.h[1]) / 2).length;
      assert.ok(short >= hs.length / 2, `${id}: more short tongues than tall ones`);
      if (f.top !== undefined) for (const s of group) assert.ok(s.pos[1] + s.h <= f.top + 1e-9, `${id}: the tip stays under ${f.top}`);
    }
  }
});

test('煙は炎の根元から立つ：smoke を持つ炎ごとに、その足もとから出る源がある。出たばかりは朱茶、昇るほど暗い', () => {
  for (const id of SCENE_IDS) {
    const srcs = particleSources(id);
    SCENES[id].fires.forEach((f, fi) => {
      if (!f.smoke) return;
      const src = srcs.find(p => p.fire === fi); assert.ok(src, `${id}: fire ${fi} has its smoke`);
      const lo = f.shape === 'line' ? [Math.min(f.from[0], f.to[0]), Math.min(f.from[2], f.to[2])] : [f.at[0] - f.box[0] / 2, f.at[2] - f.box[2] / 2];
      const hi = f.shape === 'line' ? [Math.max(f.from[0], f.to[0]), Math.max(f.from[2], f.to[2])] : [f.at[0] + f.box[0] / 2, f.at[2] + f.box[2] / 2];
      const baseY = f.shape === 'line' ? f.from[1] : f.at[1];
      assert.ok(src.at[0] >= lo[0] - 1e-9 && src.at[0] <= hi[0] + 1e-9 && src.at[2] >= lo[1] - 1e-9 && src.at[2] <= hi[1] + 1e-9, `${id}: rooted in the fire's footprint`);
      assert.ok(src.at[1] >= baseY - 0.5 && src.at[1] <= baseY + f.h[0], `${id}: starts among the flames, not above them (${src.at[1]} vs ${baseY})`);
      const sum = c => c[0] + c[1] + c[2];
      assert.ok(src.color[0] > src.color[2] * 3 && sum(src.color) > sum(src.colorEnd) * 3, `${id}: lit vermilion at the root, dark above`);
    });
    const { spawns } = run(id, 3, 1 / 20);
    for (const p of spawns.filter(p => p.colorEnd)) assert.ok(p.colorEnd[0] < p.color[0], 'the smoke darkens as it rises');
  }
  for (const id of ['B', 'C', 'D']) assert.ok(SCENES[id].fires.some(f => f.smoke), `${id}: the big fire has a smoke column`);
  assert.deepEqual(fireRoot({ shape: 'area', at: [1, 2, 3], box: [4, 1, 2], h: [2, 3] }).at, [1, 2.6, 3]);
});

test('影の人物：輪郭の明かりは炎の側の縁だけ（正面・はっきり裏を向く面・炎の反対側は光らない）', () => {
  for (const ndl of [0.3, 0.8, 1]) for (const ndv of [-1, -0.7, -0.6, 0.6, 0.8, 1]) assert.ok(rimShade(ndv, ndl) < 0.07, `facing the camera or clearly away ${ndv}`);
  for (const ndl of [-1, -0.6, -0.35]) for (const ndv of [-0.1, 0, 0.05, 0.2]) assert.equal(rimShade(ndv, ndl), 0, 'the side away from the fire');
  assert.ok(rimShade(0.05, 0.9) > 0.8 && rimShade(0.05, 0.9) <= 1, 'a bright edge toward the fire');
  for (let v = 0; v < 0.99; v += 0.01) assert.ok(rimShade(v + 0.01, 0.9) <= rimShade(v, 0.9) + 1e-12, 'fades toward the camera-facing middle');
  for (let v = -1; v <= 1; v += 0.01) for (let l = -1; l <= 1; l += 0.1) assert.ok(rimShade(v, l) <= 1 && rimShade(v, l) >= 0);
  assert.ok(SCENES.C.rim.power <= 1 && SCENES.D.hero.rim.power <= 1, 'the rim is not a glowing outline');
});

// 法線をならす：大きな形の向きは残し、頂点ごとの細かな向きの乱れ（布のひだ）を消す。継ぎ目で分かれた頂点はそろえ、薄い布の表と裏は混ぜない
const angle = (a, i, b, j) => Math.acos(Math.max(-1, Math.min(1, a[i * 3] * b[j * 3] + a[i * 3 + 1] * b[j * 3 + 1] + a[i * 3 + 2] * b[j * 3 + 2])));
function sphere(nu = 48, nv = 24, r = 0.15) {           // 経線の0と1周は同じ位置の別の頂点（UVの継ぎ目）
  const pos = [], nor = [], idx = [];
  for (let j = 0; j <= nv; j++) for (let i = 0; i <= nu; i++) {
    const th = Math.PI * (0.08 + 0.84 * j / nv), ph = 2 * Math.PI * i / nu, n = [Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph)];
    pos.push(...n.map(c => c * r)); nor.push(...n);
  }
  for (let j = 0; j < nv; j++) for (let i = 0; i < nu; i++) { const a = j * (nu + 1) + i, b = a + nu + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
  return { pos: Float32Array.from(pos), nor: Float32Array.from(nor), idx: Uint32Array.from(idx), nu };
}
test('人物の法線をならす：大きな形は残り、細かな乱れは消える（白い粒の元）', () => {
  const s = sphere(), n = s.pos.length / 3;
  const keep = smoothNormals(s.pos, s.nor, s.idx);
  let worst = 0, rim = 0; for (let i = 0; i < n; i++) { const j = Math.floor(i / (s.nu + 1)), d = angle(keep, i, s.nor, i); if (j >= 3 && j <= 21) worst = Math.max(worst, d); else rim = Math.max(rim, d); }
  assert.ok(worst < 0.06 && rim < 0.3, `a smooth shape keeps its normals (inside ${(worst * 57.3).toFixed(1)}°, open rim ${(rim * 57.3).toFixed(1)}°)`);
  for (let j = 0; j <= 24; j++) { const a = j * (s.nu + 1), b = a + s.nu; for (let k = 0; k < 3; k++) assert.ok(Math.abs(keep[a * 3 + k] - keep[b * 3 + k]) < 1e-6, 'the seam duplicates agree'); }
  // 頂点ごとに約35°ずらした乱れ（布のひだの代わり）。ならすと、元の球の向きとの差が3分の1未満になる
  const noisy = Float32Array.from(s.nor), r = (i, k) => Math.sin(i * 12.9898 + k * 78.233) * 43758.5453 % 1;
  for (let i = 0; i < n; i++) { for (let k = 0; k < 3; k++) noisy[i * 3 + k] += 0.75 * r(i, k); const l = Math.hypot(noisy[i * 3], noisy[i * 3 + 1], noisy[i * 3 + 2]); for (let k = 0; k < 3; k++) noisy[i * 3 + k] /= l; }
  const before = Array.from({ length: n }, (_, i) => angle(noisy, i, s.nor, i)).reduce((a, b) => a + b) / n;
  const out = smoothNormals(s.pos, noisy, s.idx), after = Array.from({ length: n }, (_, i) => angle(out, i, s.nor, i)).reduce((a, b) => a + b) / n;
  assert.ok(before > 0.4 && after < before / 3, `noise ${(before * 57.3).toFixed(1)}° → ${(after * 57.3).toFixed(1)}°`);
  for (let i = 0; i < n; i++) assert.ok(Math.abs(Math.hypot(out[i * 3], out[i * 3 + 1], out[i * 3 + 2]) - 1) < 1e-5, 'unit length');
  assert.deepEqual(Array.from(s.nor.slice(0, 6)), Array.from(sphere().nor.slice(0, 6)), 'the input is not rewritten');
});
test('人物の法線をならす：薄い布の表と裏（同じ位置・縁でつながる）は混ぜない', () => {
  const g = 5, pos = [], nor = [], idx = [], at = (s, i, j) => s * g * g + j * g + i;
  for (const [s, y, ny] of [[0, 0, 1], [1, 0, -1]]) for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) { pos.push(i * 0.02, y, j * 0.02); nor.push(0, ny, 0); }
  for (let j = 0; j < g - 1; j++) for (let i = 0; i < g - 1; i++) for (const s of [0, 1]) idx.push(at(s, i, j), at(s, i, j + 1), at(s, i + 1, j), at(s, i + 1, j), at(s, i, j + 1), at(s, i + 1, j + 1));
  for (let k = 0; k < g - 1; k++) for (const [a, b] of [[at(0, k, 0), at(0, k + 1, 0)], [at(0, 0, k), at(0, 0, k + 1)]]) idx.push(a, b, b + g * g, a, b + g * g, a + g * g);   // 縁で表と裏をつなぐ
  const out = smoothNormals(Float32Array.from(pos), Float32Array.from(nor), Uint32Array.from(idx));
  for (let v = 0; v < 2 * g * g; v++) assert.ok(out[v * 3 + 1] * nor[v * 3 + 1] > 0.95, `vertex ${v} keeps its side`);
});

test('D：眼下の町は家並みと灯の帯。燃える区画のまわりは朱の熾火、ほかはまばらな暗い灯。小石は足もとを避ける', () => {
  const T = SCENES.D.town, h = townHouses(T), l = townLights(T);
  assert.equal(h.length, T.n); assert.deepEqual(h, townHouses(T));
  for (const x of h) assert.ok(x.at[0] >= T.x[0] && x.at[0] <= T.x[1] && x.at[2] <= T.z[0] && x.at[2] >= T.z[1] && x.at[1] === T.y);
  assert.equal(l.length, T.lights);
  const near = l.filter(d => d.near), far = l.filter(d => !d.near);
  assert.ok(near.length > 0 && far.length > near.length * 0.8);
  for (const d of near) assert.ok(Math.hypot(d.at[0] - T.burn.at[0], d.at[2] - T.burn.at[1]) <= T.burn.r * 1.5 + 1e-9);
  assert.ok(Math.min(...near.map(d => d.color[0])) > Math.max(...far.map(d => d.color[0])) * 0.9, 'embers are brighter than the lanterns');
  const st = SCENES.D.stones, v = st.avoid;
  for (const s of scatterGround(st, 'stone')) assert.ok(!(s.at[0] > v[0] && s.at[0] < v[1] && s.at[2] > v[2] && s.at[2] < v[3]), 'no stone under the feet');
  assert.ok(SCENES.D.ridges.length >= 3 && SCENES.D.mist.length >= 1, 'mountains frame the valley, mist lies in the middle');
});

test('C：橋を渡る影は子ども・老人・武士を含み、場面の終わりまで橋の上を左から右へ歩く', () => {
  const C = SCENES.C, half = 6.06 * C.models.find(m => m.key === 'bridge').scale[0] / 2, dur = 9.5;
  assert.ok(['child', 'villager_m', 'soldier'].every(w => C.figures.some(f => f.who === w)));
  for (const f of C.figures) {
    assert.ok(f.speed > 0.3 && f.speed < 1.4, `${f.who} walks`);
    const end = f.from[0] + f.speed * dur;
    assert.ok(end > f.from[0] && end <= half, `${f.who} stays on the bridge: ${end.toFixed(2)} <= ${half.toFixed(2)}`);
    assert.ok(Math.abs(f.from[2]) < 1.2, 'on the deck');
  }
  assert.ok(C.rim && C.key.at[2] < -20, 'backlit from the far bank');
  assert.ok(C.figures.length >= 7, 'a crowd flees, not four people');
  assert.ok(C.figures.filter(f => f.who === 'child').length >= 2, 'children walk with the adults');
  const loads = C.figures.map(f => f.load).filter(Boolean);
  assert.ok(loads.filter(k => k === 'pack' || k === 'pole').length >= 2 && loads.includes('baby'), 'they carry bundles and a child');
  for (const f of C.figures) for (const t of [0, 2.5, 7.5, 9.5]) {                     // 岸では地面に立ち、橋の上では床に立つ（宙に浮かない）
    const p = figureAt(f, t);
    if (Math.abs(p[0]) <= C.bridgeHalf - 1.4) assert.equal(p[1], f.from[1]);
    if (Math.abs(p[0]) >= C.bridgeHalf) assert.equal(p[1], 0, `${f.who} on the bank at ${t}s`);
  }
});

test('D：景継は見返ったあと、場面の終わりの少し前に向き直って歩き出す。どの瞬間も顔をカメラへ向けない', () => {
  const H = SCENES.D.hero, o = SCENES.D.origin;
  for (const dur of [11.5, 3.5]) {
    const a = heroAt(0, dur), z = heroAt(dur, dur);
    assert.equal(a.moving, false); assert.deepEqual(a.pos, H.at); assert.ok(Math.abs(a.yaw - Math.atan2(H.face[0], H.face[1])) < 1e-9);
    assert.ok(z.moving && z.walk > 0, `walks before the end (${dur}s)`);
    assert.ok(Math.abs(Math.cos(z.yaw) - Math.cos(Math.atan2(H.turnTo[0], H.turnTo[1]))) < 1e-9 && Math.abs(Math.sin(z.yaw) - Math.sin(Math.atan2(H.turnTo[0], H.turnTo[1]))) < 1e-9);
    assert.ok(Math.abs(z.yaw - a.yaw) <= Math.PI, 'turns the short way');
    for (let t = 0; t <= dur; t += 0.05) {
      const h = heroAt(t, dur), cam = cameraAt('D', t / dur), to = [cam.pos[0] - o[0] - h.pos[0], cam.pos[2] - o[2] - h.pos[2]];
      const facing = [Math.sin(h.yaw), Math.cos(h.yaw)], cos = (facing[0] * to[0] + facing[1] * to[1]) / Math.hypot(...to);
      assert.ok(cos < Math.cos(125 * Math.PI / 180), `face hidden at ${t.toFixed(2)}s of ${dur}s (cos ${cos.toFixed(2)})`);   // 125°より後ろ向き（横顔の線も見せない）
    }
  }
  assert.ok(heroAt(5, 11.5).walk === 0 && heroAt(11.2, 11.5).walk > heroAt(10.4, 11.5).walk, 'walk grows only after the turn');
  const across = { ...H, face: [-0.15, -1], turnTo: [0.1, -1] };                 // 向きの角が ±π をまたぐ向き直り（約14°）
  assert.ok(Math.abs(heroAt(11.5, 11.5, across).yaw - heroAt(0, 11.5, across).yaw) < 0.5, 'turns the short way across ±π');
});
