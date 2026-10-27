// 足の接地位相の実データ（anim-contacts.js）の検査。
//
// なぜ失敗したか（2026-10-27）:
// 1. 足音を「歩いた距離」で鳴らしていたため、足が着く瞬間とずれた（要件15.1）。接地位相は clips.json（Blender の焼き込み）にあったが、
//    実際の骨の動きと合っているかを確かめていなかった。測ると、剣を構えた歩き（Walk_Fight_Forward）の左足は、足が体に対して最も前に出きる前（62ms早く）に
//    着くことになっていた。接地の瞬間は定義で数十ms動くので、データを、骨の動きから測った2つの境界（E：足が最も前に出た瞬間、P：足が地面に止まる瞬間）の間に収めた。
// 2. 同じ足が1周に3回着くクリップ（村人の歩き）を、通知の論理が弾いた。純粋な論理は合成した表だけで検査していたので、実データで初めて落ちた。
//    実データの全クリップで、通知が欠落・二重なく出ることを、ここで縛る。
// 3. anim-contacts.js は、測定結果と clips.json から作った物。手で書き換えると、見た目とのずれが静かに戻る。作り直した内容との一致を縛る。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FOOT_CONTACTS } from '../dist/valley/anim-contacts.js';
import { LOCOMOTION } from '../dist/valley/anim-data.js';
import { createContactTracker, observeContacts } from '../dist/valley/foot-contacts.js';
import { buildFootContacts, renderModule, bracketOffsets, MARGIN_S, LOCOMOTION_CLIPS } from '../tools/build-foot-contacts.mjs';

const read = rel => fs.readFileSync(new URL(rel, import.meta.url), 'utf8');
const clipsJson = JSON.parse(read('../dist/assets/characters/clips.json'));
const measured = JSON.parse(read('../reports/audio/foot-contacts-measured.json'));

test('移動で使う全クリップに、接地位相がある（結線で未知のクリップに当たらない） [coverage]', () => {
  const used = new Set(Object.values(LOCOMOTION).flatMap(t => [t.walk, t.jog, t.run]));
  for (const clip of used) assert(FOOT_CONTACTS[clip], `[coverage] ${clip} に接地位相が無い。型: LOCOMOTION に足したクリップを、tools/build-foot-contacts.mjs で作り直していない`);
  assert.deepEqual(Object.keys(FOOT_CONTACTS).sort(), [...LOCOMOTION_CLIPS].sort(), '[coverage] 使っていないクリップのデータを出荷している（測っていない物を出荷しない）');
});

test('表の形: 昇順・範囲内・長さがclips.jsonと一致・左右が交互 [structure]', () => {
  for (const [clip, c] of Object.entries(FOOT_CONTACTS)) {
    assert(c.contacts.length >= 2 && c.loop === true, `[structure] ${clip}: 接地が2つ未満、または周回でない`);
    assert(Math.abs(c.duration - clipsJson.clips[clip].seconds) < 1e-3, `[structure] ${clip}: duration が clips.json と違う`);
    c.contacts.forEach((x, i) => {
      assert(x.t >= 0 && x.t < c.duration, `[structure] ${clip}[${i}]: 時刻が範囲外`);
      if (i) assert(x.t >= c.contacts[i - 1].t, `[structure] ${clip}[${i}]: 昇順でない`);
      if (i) assert.notEqual(x.foot, c.contacts[i - 1].foot, `[structure] ${clip}[${i}]: 同じ足が続く。型: 歩きの接地が左右交互でない`);
    });
    assert.notEqual(c.contacts[0].foot, c.contacts.at(-1).foot, `[structure] ${clip}: 周回の継ぎ目で同じ足が続く`);
  }
});

test('実データの全クリップで、通知が欠落・二重なく出る（60Hz・30Hz・不規則・5周） [real-data]', () => {
  for (const [clip, c] of Object.entries(FOOT_CONTACTS)) for (const steps of [[1 / 60], [1 / 30], [0.013, 0.071, 0.021, 0.049]]) {
    let state = createContactTracker(), time = 0, i = 0;
    const end = c.duration * 5 - 0.01, got = [];
    const at = t => { const r = observeContacts(state, { actor: 'a', sources: [{ clip, time: t % c.duration, weight: 1, speed: 1, target: false }], moving: true, airborne: false, near: true, reset: false }, FOOT_CONTACTS); state = r.state; got.push(...r.contacts); };
    at(0);
    while (time < end) { time = Math.min(end, time + steps[i++ % steps.length]); at(time); }
    // 観測は t=0 から始まる。基準の時刻 0 に着く接地は、区間 (前回, 今回] に入らないので数えない。
    let expected = 0;
    for (let loop = 0; loop < 5; loop++) for (const x of c.contacts) { const at = loop * c.duration + x.t; if (at > 0 && at <= end) expected++; }
    assert.equal(got.length, expected, `[real-data] ${clip}: 通知 ${got.length} 件、期待 ${expected} 件。型: 欠落または二重通知`);
    assert.equal(new Set(got.map(x => `${x.loop}/${x.index}`)).size, got.length, `[real-data] ${clip}: (loop, index) が重複`);
    assert.deepEqual(got.map(x => x.contactTime), [...got.map(x => x.contactTime)].sort((a, b) => a - b), `[real-data] ${clip}: 通知が時刻順でない`);
  }
});

test('anim-contacts.js は、測定結果と clips.json から作った内容と一致する（手で書き換えない） [generated]', () => {
  const { table } = buildFootContacts(clipsJson, measured);
  assert.equal(read('../dist/valley/anim-contacts.js'), renderModule(table), '[generated] anim-contacts.js が作り直した内容と違う。型: 手で書き換えた／測定を更新して作り直していない（node tools/build-foot-contacts.mjs）');
});

test('各接地は、測った境界 E・P の間（40msの余裕つき）に入る。元のデータからの移動は70ms以内 [bracket]', () => {
  const { adjustments } = buildFootContacts(clipsJson, measured);
  for (const a of adjustments) assert(Math.abs(a.shiftMs) <= 70, `[bracket] ${a.clip} ${a.foot}: 境界へ収める移動が ${a.shiftMs}ms。元のデータか測定が怪しい`);
  for (const [clip, c] of Object.entries(FOOT_CONTACTS)) for (const x of c.contacts) {
    const { eRel, pRel } = bracketOffsets(measured, clip, x.foot, x.t);
    if (eRel !== null) assert(eRel <= MARGIN_S + 1e-6, `[bracket] ${clip} ${x.foot} t=${x.t}: 足が最も前に出る ${(eRel * 1000).toFixed(0)}ms 前に着くことになっている。型: 接地が早すぎる（足が空中で鳴る）`);
    if (pRel !== null) assert(pRel >= -MARGIN_S - 1e-6, `[bracket] ${clip} ${x.foot} t=${x.t}: 足が止まった ${(-pRel * 1000).toFixed(0)}ms 後に着くことになっている。型: 接地が遅すぎる`);
  }
});
