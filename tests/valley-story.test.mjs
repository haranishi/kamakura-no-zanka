// 物語の本体（S5・S6）：掛け合いの選び方・断片の記録と回収・結末の段・調べる物・台詞の検査（design-narrative.md §3〜§7）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STORY, SPEAKERS } from '../dist/valley/story-data.js';
import { matches, stepBanter, createBanterState, lineSeconds, trustTier, areasAt, BANTER_GAP, BANTER_CALM } from '../dist/valley/banter.js';
import { linesFor, endingTier, relicInReach, ringPlacement } from '../dist/valley/narrative.js';
import { createQuest, reduce, exportProgress, restoreProgress } from '../dist/valley/quest.js';
import { storyProblems } from '../tools/lib/story-check.mjs';
import { initialSave, sanitize, loadValley, saveValley, VALLEY_KEY } from '../dist/valley/save.js';

const run = (s, type, f = {}) => reduce(s, { type, ...f }).state;
const sources = ['quest.js', 'game.js'].map(f => fs.readFileSync(new URL('../dist/valley/' + f, import.meta.url), 'utf8')).join('\n');
const problems = story => storyProblems({ story, speakers: SPEAKERS, sources });

test('story data passes every check: ids, one-screen lines, speakers, conditions that can be met, fragments, relics, called dialogues, words', () => {
  assert.deepEqual(problems(STORY), []);
});
// 検査が本当に見つけるか：わざと壊したデータで、それぞれの問題が報告される（効かない検査を残さない）
test('the story check catches each kind of mistake it claims to', () => {
  const broken = (edit, expect) => { const s = structuredClone(STORY); edit(s); const p = problems(s); assert(p.some(m => expect.test(m)), `${expect} not reported: ${JSON.stringify(p)}`); };
  broken(s => s.banter.push({ ...s.banter[0] }), /duplicate id b0_alive/);
  broken(s => { s.dialogues.result[0].text = '字'.repeat(41); }, /41 characters/);
  broken(s => { s.barks.raid[0] = '字'.repeat(15); }, /bark raid/);
  broken(s => { s.banter[0].lines[0].speaker = '知らない人'; }, /unknown speaker/);
  broken(s => { s.banter[1].lines[0].text = s.banter[0].lines[0].text; }, /duplicate line/);
  broken(s => { s.banter[0].when.beat = ['b0_temple']; }, /unknown condition key "beat"/);
  broken(s => { s.banter[2].when.areas = ['uper_road']; }, /unknown area/);
  broken(s => { s.banter[3].when.after = 'scout_kiled'; }, /unknown event/);
  broken(s => { s.banter[0].when = { beats: ['b0_temple'], companion: true }; }, /b0_alive: the condition can never be met/);
  broken(s => { s.dialogues.ending_coda[0].when = { fragments: [6, null] }; }, /can never be met/);
  broken(s => { s.dialogues.village_cleared[3].when.food = [null, 45]; }, /village_cleared: 0 lines in group kyusaku_first for flank/);
  broken(s => { s.dialogues.result[3].when.trust = 'high'; }, /result: 2 lines in group kyusaku_result/);
  broken(s => { delete s.dialogues.archer_joins[3].fragment; }, /F4: carried by 0 lines/);
  broken(s => { s.fragments[4].dialogue = 'result'; }, /F5: lives in ambush_cleared/);
  broken(s => { s.relics[0].dialogue = 'relic_none'; }, /sode: no dialogue/);
  broken(s => { s.dialogues.orphan = [{ speaker: '榊三郎景継', text: '誰にも呼ばれない。' }]; }, /dialogue orphan is never called/);
  broken(s => { s.banter[0].lines[0].text = '斥候だ。'; }, /斥候/);
});

// ---------------------------------------------------------------------------------------------- 掛け合いの選び方
const sit = (over = {}) => ({ t: 100, beat: 'b0_temple', beatT: 30, areas: [], events: [], plan: null, approach: null, ambush: null, companion: false, captiveFreed: false, seen: false, trust: 40, food: 60, fragments: 0, blocked: false, ...over });
const LIST = [
  { id: 'a', when: { beats: ['b0_temple'] }, lines: [{ speaker: '榊三郎景継', text: '一' }] },
  { id: 'b', group: 'g', when: { beats: ['b0_temple'] }, lines: [{ speaker: '梓弥十郎', text: '二の上' }, { speaker: '榊三郎景継', text: '二の下' }] },
  { id: 'c', group: 'g', when: { beats: ['b0_temple'] }, lines: [{ speaker: '榊三郎景継', text: '三' }] },
  { id: 'd', when: { beats: ['b2_road'] }, lines: [{ speaker: '榊三郎景継', text: '四' }] },
];
// 時刻 t0 から dt 刻みで回し、出た行を記録する
function play(list, frames, { t0 = 0, dt = 0.25, over = () => ({}) } = {}) {
  let state = createBanterState(); const shown = [];
  for (let i = 0; i < frames; i++) {
    const t = t0 + i * dt, r = stepBanter(state, sit({ t, ...over(t) }), list);
    state = r.state; if (r.show) shown.push({ t, ...r.show });
  }
  return { state, shown };
}
test('banter: waits for calm, then shows lines in data order, once each, one per group, with the gap between entries', () => {
  const { shown } = play(LIST, 400);
  assert.deepEqual(shown.map(s => s.text), ['一', '二の上', '二の下']);              // c は b と同じ group、d は場面が違う
  assert(shown[0].t >= BANTER_CALM, 'starts only after the calm time');
  const firstEnd = shown[0].t + lineSeconds('一');
  assert(shown[1].t >= firstEnd + BANTER_GAP - 1e-9, 'the next entry waits the gap after the previous one ends');
  assert(Math.abs(shown[2].t - (shown[1].t + lineSeconds('二の上'))) < 0.26, 'the second line of an exchange follows the first');
});
test('banter: blocked (combat, dialogue, hint, bark, subtitles off) shows nothing and cuts an exchange short', () => {
  assert.deepEqual(play(LIST, 400, { over: () => ({ blocked: true }) }).shown, []);
  // 掛け合いの1行目の最中に止められたら、2行目は出さない
  const once = play([LIST[1]], 400, { over: t => ({ blocked: t > 3 && t < 5 }) });
  assert.deepEqual(once.shown.map(s => s.text), ['二の上']);
  const input = createBanterState(); const frozen = JSON.stringify(input);
  stepBanter(input, sit({ t: 50 }), LIST); assert.equal(JSON.stringify(input), frozen, 'the state passed in is not changed');
});
test('banter: a showing hint holds back a new entry but lets a started exchange finish; waiting tells the slow hint to yield', () => {
  // 案内が出ているあいだは始めない（静まってから2秒）
  const held = play(LIST, 400, { over: t => ({ held: t < 10 }) });
  assert(held.shown[0].t >= 10 + BANTER_CALM - 1e-9, `started at ${held.shown[0].t}`);
  // 掛け合いの1行目のあとに案内が出ても、2行目は出る
  const both = play([LIST[1]], 400, { over: t => ({ held: t > 3 && t < 5 }) });
  assert.deepEqual(both.shown.map(s => s.text), ['二の上', '二の下']);
  // 出せる台詞が静まるのを待つ間と、掛け合いの最中は waiting
  let st = createBanterState();
  const step = (t, over = {}) => { const r = stepBanter(st, sit({ t, ...over }), LIST); st = r.state; return r; };
  assert.equal(step(0).waiting, true, 'eligible and waiting for calm');
  assert.equal(step(2.1).show?.text, '一');
  assert.equal(step(3).waiting, true, 'playing');
  assert.equal(step(30, { beat: 'b5_archer' }).waiting, false, 'nothing eligible');
});
test('banter: only an entry marked overHint may start beside a showing hint (the waking line)', () => {
  const list = [{ id: 'w', overHint: true, when: { beats: ['b0_temple'] }, lines: [{ speaker: '榊三郎景継', text: '起' }] }, ...LIST];
  const r = play(list, 80, { over: () => ({ held: true }) });
  assert.deepEqual(r.shown.map(s => s.text), ['起']);
  assert(r.shown[0].t >= BANTER_CALM - 1e-9);
  assert.equal(STORY.banter.filter(e => e.overHint).map(e => e.id).join(), 'b0_alive');
});
test('banter: conditions read place, events, plan, companion, ambush, trust, food and fragments', () => {
  assert(matches({ areas: ['upper_road'] }, sit({ areas: areasAt(STORY.areas, { x: -62, z: -60 }) })));
  assert(!matches({ areas: ['upper_road'] }, sit({ areas: areasAt(STORY.areas, { x: 0, z: 0 }) })));
  assert(matches({ after: 'scout_killed' }, sit({ events: ['scout_killed'] })) && !matches({ after: 'scout_killed' }, sit()));
  assert(matches({ ambush: null }, sit()) && !matches({ ambush: null }, sit({ ambush: 'cleared' })));
  assert(matches({ companion: true }, sit({ companion: true })) && !matches({ companion: true }, sit()));
  assert.deepEqual([40, 47.9, 48, 57.9, 58, 100].map(trustTier), ['low', 'low', 'mid', 'mid', 'high', 'high']);
  assert(matches({ food: [35, 50] }, sit({ food: 35 })) && !matches({ food: [35, 50] }, sit({ food: 50 })));
  assert(matches({ minBeatT: 4 }, sit({ beatT: 4 })) && !matches({ minBeatT: 4 }, sit({ beatT: 3.9 })));
  assert.deepEqual([1, 20, 40].map(n => lineSeconds('字'.repeat(n))), [2.4, 3.6, 4.6]);
});
test('banter: the real data plays the escort exchanges in order and only one trust line', () => {
  const over = () => ({ beat: 'b6_escort', companion: true, captiveFreed: true, approach: 'front', trust: 50, food: 40 });
  const { shown } = play(STORY.banter, 1200, { over });
  const ids = [...new Set(shown.map(s => s.id))];
  assert.deepEqual(ids, ['b6_burden', 'b6_way_front', 'b6_trust_mid']);
  assert(!ids.includes('b6_after') && !ids.includes('b6_boy'), 'the apology and the boy wait for the ambush to clear');
  const after = play(STORY.banter, 1200, { over: () => ({ ...over(), ambush: 'cleared' }) }).shown;
  assert.deepEqual([...new Set(after.map(s => s.id))], ['b6_after', 'b6_boy']);
});

// ---------------------------------------------------------------------------------------------- 断片の記録・保存・やり直し
const toViewpoint = () => { let s = run(createQuest(STORY), 'enter_zone', { zone: 'temple_yard' }); s = run(s, 'dialogue_end', { id: 'boy_arrives' }); return run(s, 'arrived', { place: 'viewpoint' }); };
function fullRun({ sode = true, far = true } = {}) {
  let s = run(createQuest(STORY), 'enter_zone', { zone: 'temple_yard' });
  if (sode) s = run(s, 'examine', { relic: 'sode' });
  s = run(s, 'dialogue_end', { id: 'boy_arrives' }); s = run(s, 'arrived', { place: 'viewpoint' });
  if (far) s = run(s, 'examine', { relic: 'far_look' });
  s = run(s, 'enter_zone', { zone: 'village_north' }); s = run(s, 'enemy_down', { id: 'officer', how: 'routed' });
  s = run(s, 'interact', { id: 'archer_captive' }); s = run(s, 'party_joined', { id: 'archer' });
  s = run(s, 'enter_zone', { zone: 'ambush_trigger' });
  for (const id of STORY.groups.escort_ambush) s = run(s, 'enemy_down', { id, how: 'killed' });
  return run(s, 'arrived', { place: 'temple_steps' });
}
test('fragments: the three spoken ones come with their conversations, the two relics only when examined; the ending deepens with the count', () => {
  const all = fullRun();
  assert.equal(all.beat, 'b7_result'); assert.deepEqual(all.flags.fragments, ['F1', 'F2', 'F3', 'F4', 'F5']);
  const spoken = fullRun({ sode: false, far: false });
  assert.deepEqual(spoken.flags.fragments, ['F3', 'F4', 'F5']);
  assert.deepEqual(fullRun({ sode: false }).flags.fragments, ['F2', 'F3', 'F4', 'F5']);
  const texts = (q, id) => linesFor(STORY, id, q).map(l => l.text);
  const none = { ...spoken, flags: { ...spoken.flags, fragments: [] } };
  // 真相の3行は、断片が0でも必ず出る（R20.3）
  for (const q of [none, spoken, all]) for (const t of ['あの夜、門を離れたのは、泣いている子がいたからだ。', '……その子は。', '山へ逃がした。名も知らぬ。']) assert(texts(q, 'ending_truth').includes(t));
  assert.equal(texts(none, 'ending_truth').length, 3); assert.equal(texts(spoken, 'ending_truth').length, 5); assert.equal(texts(all, 'ending_truth').length, 5);
  assert(!texts(spoken, 'ending_coda').includes('もう、いい。') && texts(all, 'ending_coda').includes('もう、いい。'));
  for (const q of [none, spoken, all]) assert(texts(q, 'ending_coda').includes('燃え残った火は、谷で、人の灯になった。') && texts(q, 'ending_coda').includes('……明日、考える。'));
  assert.deepEqual([0, 2, 3, 4, 5].map(endingTier), ['plain', 'plain', 'deep', 'deep', 'full']);
});
test('fragments: examining twice, out of place, while down or an unknown relic adds nothing; the effect fires once', () => {
  let s = run(createQuest(STORY), 'enter_zone', { zone: 'temple_yard' });
  const r1 = reduce(s, { type: 'examine', relic: 'sode' });
  assert.deepEqual(r1.effects.filter(e => e.type === 'fragment'), [{ type: 'fragment', id: 'F1', count: 1 }]);
  assert(r1.effects.some(e => e.type === 'dialogue' && e.id === 'relic_sode'));
  s = r1.state;
  assert.deepEqual(reduce(s, { type: 'examine', relic: 'sode' }).effects, [], 'the same relic again does nothing');
  assert.deepEqual(reduce(s, { type: 'examine', relic: 'far_look' }).effects, [], 'the far view belongs to the viewpoint');
  assert.deepEqual(reduce(s, { type: 'examine', relic: 'nothing' }).effects, []);
  assert.deepEqual(reduce(run(s, 'player_down'), { type: 'examine', relic: 'sode' }).effects, []);
  // 手がかりの物（断片なし）は、そのたびに会話を出す。出し直しの見張りは game.js
  const road = run(s, 'dialogue_end', { id: 'boy_arrives' });
  assert.deepEqual(reduce(road, { type: 'examine', relic: 'scout_note' }).effects, [{ type: 'dialogue', id: 'clue_scout_note' }]);
});
test('fragments: retry rewinds what was picked after the checkpoint, and picking again never counts twice', () => {
  let s = run(toViewpoint(), 'examine', { relic: 'far_look' });                  // 見晴らしの区切りのあとで拾った
  assert.deepEqual(s.flags.fragments, ['F2']);
  s = run(run(s, 'enter_zone', { zone: 'village_front' }), 'player_down');
  s = run(s, 'retry');
  assert.equal(s.beat, 'b3_viewpoint'); assert.deepEqual(s.flags.fragments, [], 'back at the checkpoint, the view can be taken again');
  s = run(run(s, 'examine', { relic: 'far_look' }), 'examine', { relic: 'far_look' });
  assert.deepEqual(s.flags.fragments, ['F2']);
  // 保存に入っていた断片の会話がもう一度出ても、数えない（書き換えた保存・区切りの前後の食い違い）
  let u = toViewpoint(); u = { ...u, flags: { ...u.flags, fragments: ['F3'] } };
  const cleared = reduce(run(u, 'enter_zone', { zone: 'village_front' }), { type: 'enemy_down', id: 'officer', how: 'routed' });
  assert.deepEqual(cleared.state.flags.fragments, ['F3']); assert(!cleared.effects.some(e => e.type === 'fragment'));
  // 区切りより前に拾った断片は、やり直しでも残る
  let t = run(run(createQuest(STORY), 'enter_zone', { zone: 'temple_yard' }), 'examine', { relic: 'sode' });
  t = run(run(t, 'dialogue_end', { id: 'boy_arrives' }), 'player_down');
  assert.deepEqual(run(t, 'retry').flags.fragments, ['F1']);
});
test('save: fragments round-trip in story order; an old save without them reads as none; broken lists are refused; the version stays 1', () => {
  const st = (() => { const m = new Map(); return { getItem: k => m.get(k) ?? null, setItem: (k, v) => m.set(k, v) }; })();
  const q = fullRun();
  const saved = exportProgress(q);
  assert.equal(saved.version, 1); assert.deepEqual(saved.flags.fragments, ['F1', 'F2', 'F3', 'F4', 'F5']);
  assert.equal(saveValley(st, saved).ok, true);
  assert.deepEqual(restoreProgress(STORY, loadValley(st).state).flags.fragments, ['F1', 'F2', 'F3', 'F4', 'F5']);
  const old = initialSave(); delete old.flags.fragments; old.beat = 'b6_escort'; old.checkpoint = 'cp_archer_joined'; old.flags.archerJoined = true; old.party.archer.joined = true;
  st.setItem(VALLEY_KEY, JSON.stringify(old));
  const r = loadValley(st); assert.equal(r.hasSave, true); assert.deepEqual(r.state.flags.fragments, []);
  assert.deepEqual(restoreProgress(STORY, r.state).flags.fragments, []);
  assert.deepEqual(sanitize({ ...initialSave(), flags: { ...initialSave().flags, fragments: ['F5', 'F1'] } }).flags.fragments, ['F1', 'F5']);
  for (const bad of ['F1', ['F9'], ['F1', 'F1'], [1], null, {}]) assert.throws(() => sanitize({ ...initialSave(), flags: { ...initialSave().flags, fragments: bad } }), TypeError, JSON.stringify(bad));
});

// ---------------------------------------------------------------------------------------------- 会話の組み立て・調べる物・焚き火の輪
test('village_cleared: the first word follows the road, the stores and whether the village saw you; F3 is always the second line', () => {
  const at = (approach, food, seen) => linesFor(STORY, 'village_cleared', { ...createQuest(STORY), beat: 'b5_archer', seen, flags: { ...createQuest(STORY).flags, approach }, resources: { ...STORY.resources, food } });
  const cases = [['front', 40, false, 'あんたの戦で'], ['front', 34.9, true, '畑も倉も'], ['flank', 50, false, 'いつの間に'], ['flank', 49.9, false, '足音は聞こえなんだ'],
    ['flank', 50, true, '騒ぎには'], ['flank', 49.9, true, '静かに、とは']];
  for (const [approach, food, seen, start] of cases) {
    const lines = at(approach, food, seen);
    assert(lines[0].text.startsWith(start), `${approach} ${food} ${seen}: ${lines[0].text}`);
    assert.equal(lines[1].fragment, 'F3'); assert.equal(lines.length, 4);
  }
});
test('relics: the prompt shows only in its scene, near it, before it is taken, and never with an alerted enemy close', () => {
  const sode = STORY.relics.find(r => r.id === 'sode'), near = { x: sode.at.x + 0.5, z: sode.at.z };
  const base = { beat: 'b0_temple', pos: near, fragments: [], clues: [], drops: {}, danger: false };
  assert.equal(relicInReach(STORY, base)?.id, 'sode');
  assert.equal(relicInReach(STORY, { ...base, danger: true }), null);
  assert.equal(relicInReach(STORY, { ...base, fragments: ['F1'] }), null);
  assert.equal(relicInReach(STORY, { ...base, beat: 'b3_viewpoint' }), null);
  assert.equal(relicInReach(STORY, { ...base, pos: { x: sode.at.x + 3, z: sode.at.z } }), null);
  const drop = { x: -45, z: -45 }, road = { ...base, beat: 'b2_road', pos: { x: -45.6, z: -45 } };
  assert.equal(relicInReach(STORY, road), null, 'the note appears only where the scout fell');
  assert.equal(relicInReach(STORY, { ...road, drops: { scout_note: drop } })?.id, 'scout_note');
  assert.equal(relicInReach(STORY, { ...road, drops: { scout_note: drop }, clues: ['C1'] }), null);
  const far = STORY.relics.find(r => r.id === 'far_look');
  assert.equal(relicInReach(STORY, { ...base, beat: 'b3_viewpoint', pos: far.at })?.id, 'far_look');
});
test('result: Kyusaku welcomes only as far as the trust earned; the seen record survives the save and old saves read as unseen', () => {
  const say = trust => linesFor(STORY, 'result', { ...fullRun(), trust }).find(l => l.speaker === '久作').text;
  assert(say(60).includes('違ったな')); assert(say(50).includes('分からん')); assert(say(40).includes('米で返した'));
  let s = run(toViewpoint(), 'enter_zone', { zone: 'village_north' });
  s = run(run(s, 'noticed'), 'enemy_down', { id: 'officer', how: 'routed' });
  s = run(run(s, 'interact', { id: 'archer_captive' }), 'party_joined', { id: 'archer' });
  const saved = exportProgress(s);
  assert.equal(saved.flags.seen, true); assert.equal(restoreProgress(STORY, saved).seen, true);
  assert.equal('seen' in restoreProgress(STORY, saved).flags, false, 'the quest keeps seen outside its flags');
  const old = initialSave(); delete old.flags.seen;
  assert.equal(sanitize(old).flags.seen, false); assert.equal(restoreProgress(STORY, old).seen, false);
  assert.throws(() => sanitize({ ...initialSave(), flags: { ...initialSave().flags, seen: 'yes' } }), TypeError);
});
test('the fire ring follows trust: inside and seated when high, at the edge when middling, apart when low', () => {
  assert.deepEqual(ringPlacement(60), { scale: 0.78, sit: true });
  assert.deepEqual(ringPlacement(50), { scale: 1.0, sit: false });
  assert.deepEqual(ringPlacement(40), { scale: 1.8, sit: false });
});
