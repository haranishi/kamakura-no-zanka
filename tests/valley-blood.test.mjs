// 設定「血の表現」（R18.11・8.4b）の純粋な規則。実ゲームの結線は tools/scenarios/regress-blood.mjs。
import test from 'node:test';
import assert from 'node:assert/strict';
import { BLOOD_LEVELS, BLOOD_DEFAULT, BLOOD_CAP, normalizeBlood, bloodRecipe, bloodKind, bloodBudget, bloodSeed, bloodRng, sprayDrop, sprayStain, createSpray } from '../dist/valley/blood.js';

test('段階の正規化：3段階はそのまま、未設定・未知の値は既定「ひかえめ」', () => {
  assert.equal(BLOOD_DEFAULT, 'subtle');
  for (const lv of BLOOD_LEVELS) assert.equal(normalizeBlood(lv), lv);
  for (const bad of [undefined, null, '', 'none', 'Standard', 'bold', 0, 1, {}, ['off']]) assert.equal(normalizeBlood(bad), 'subtle', String(bad));
});

test('表の単調性：なし＜ひかえめ＜標準（粒・速さ・寿命）。しみは標準だけ1枚以上', () => {
  for (const q of ['standard', 'light']) for (const k of ['hit', 'strong', 'kill']) {
    const [o, s, t] = BLOOD_LEVELS.map(lv => bloodRecipe(lv, q, k));
    assert.equal(o.drops, 0); assert.equal(o.stains, 0);
    assert(s.drops > 0 && t.drops > s.drops, `${q}/${k} 粒 ${s.drops} ${t.drops}`);
    assert(t.speed[1] >= s.speed[1] && t.life[1] >= s.life[1] && t.size[1] >= s.size[1], `${q}/${k} 見た目の幅`);
    assert.equal(s.stains, 0, 'ひかえめはしみなし');
    assert(t.stains >= 1, `${q}/${k} 標準のしみ`);
    for (const r of [s, t]) { assert(r.speed[0] > 0 && r.life[0] > 0 && r.size[0] > 0 && r.stretch[0] > 0); assert(r.life[1] < 1, '飛沫は短命'); }
    assert(t.stainLife[1] <= 5, 'しみは数秒で薄れる');
  }
});

test('強い技・倒れる瞬間は少し多い。軽量は減らすが、ひかえめでも0にしない', () => {
  for (const q of ['standard', 'light']) for (const lv of ['subtle', 'standard']) {
    const [h, s, k] = ['hit', 'strong', 'kill'].map(kind => bloodRecipe(lv, q, kind).drops);
    assert(h < s && s < k, `${q}/${lv} ${h} ${s} ${k}`);
  }
  for (const lv of ['subtle', 'standard']) for (const k of ['hit', 'strong', 'kill']) {
    const st = bloodRecipe(lv, 'standard', k), li = bloodRecipe(lv, 'light', k);
    assert(li.drops > 0 && li.drops <= st.drops && li.stains <= st.stains, `${lv}/${k}`);
  }
  assert.equal(bloodKind({ dead: true, strong: false }), 'kill');
  assert.equal(bloodKind({ strong: true }), 'strong');
  assert.equal(bloodKind({}), 'hit');
  assert.equal(bloodRecipe('nope', 'ultra', 'zzz'), bloodRecipe('subtle', 'standard', 'hit'), '未知の値は既定へ');
});

test('同時の上限：飛沫64・しみ16を超えない（1回の最大でも上限以内）', () => {
  assert.deepEqual({ ...BLOOD_CAP }, { drops: 64, stains: 16 });
  for (const q of ['standard', 'light']) for (const lv of BLOOD_LEVELS) for (const k of ['hit', 'strong', 'kill']) {
    const r = bloodRecipe(lv, q, k); assert(r.drops <= BLOOD_CAP.drops && r.stains <= BLOOD_CAP.stains);
  }
  assert.equal(bloodBudget(0, 12, 64), 12);
  assert.equal(bloodBudget(60, 12, 64), 4);
  assert.equal(bloodBudget(64, 12, 64), 0);
  assert.equal(bloodBudget(70, 12, 64), 0, '超えていても負にしない');
  // 連続の命中を詰めても、出ている数は上限を超えない
  let active = 0; for (let i = 0; i < 40; i++) { active += bloodBudget(active, bloodRecipe('standard', 'standard', 'kill').drops, BLOOD_CAP.drops); assert(active <= 64); }
  assert.equal(active, 64);
});

test('飛沫は種で決まり、当たった向き・刃の進む向きへ散る。色は朱〜濃い赤（墨を少し）', () => {
  const r = bloodRecipe('standard', 'standard', 'hit'), a = createSpray(), b = createSpray();
  const ra = bloodRng(bloodSeed(3)), rb = bloodRng(bloodSeed(3));
  let forward = 0, n = 400, ink = 0;
  for (let i = 0; i < n; i++) {
    sprayDrop(ra, r, 1, 0, [0, 0, 1], a); sprayDrop(rb, r, 1, 0, [0, 0, 1], b);
    assert.deepEqual(a, b, '同じ種なら同じ');
    if (a.vel[0] > 0 && a.vel[2] > 0) forward++;
    const sp = Math.hypot(...a.vel); assert(sp >= r.speed[0] - 1e-9 && sp <= r.speed[1] + 1e-9);
    assert(a.color[0] >= a.color[1] && a.color[0] >= a.color[2], '赤が主');
    if (a.color[0] < 0.2) ink++;
  }
  assert(forward / n > 0.9, `前方へ ${forward / n}`);
  assert(ink > 0 && ink / n < 0.35, `墨の割合 ${ink / n}`);
  assert.notDeepEqual(sprayDrop(bloodRng(bloodSeed(1)), r, 1, 0, null, createSpray()).vel, sprayDrop(bloodRng(bloodSeed(2)), r, 1, 0, null, createSpray()).vel, '種が違えば違う');
  const s = sprayStain(bloodRng(9), r, 0, 1, createSpray()), d = Math.hypot(s.dx, s.dz);
  assert(d >= r.stainReach[0] - 1e-9 && d <= r.stainReach[1] + 1e-9 && s.dz > 0, 'しみは当たった向きの少し先');
});
