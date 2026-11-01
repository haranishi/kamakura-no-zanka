// S7-A の配線（game.js）：任務が変わるたびに life-rules の場面を置き物へ配り、煙を場面で切り替える。
// game.js は Node で丸ごと読めない（人物の模型の道具に依る）ので、該当するメソッドの本文だけを取り出し、試験用の代役に載せて動かす。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { lifeScene, lifeInputFromQuest, lifeItem } from '../dist/valley/life-rules.js';

const src = fs.readFileSync(new URL('../dist/valley/game.js', import.meta.url), 'utf8');
// クラスの中の「  名前(…) {」から、対応する閉じ括弧までを返す
function method(name) {
  const at = src.search(new RegExp(`\\n  ${name}\\([^)]*\\) \\{`));
  assert(at >= 0, `game.js has no method ${name}`);
  let depth = 0, i = src.indexOf('{', at);
  for (let k = i; k < src.length; k++) { if (src[k] === '{') depth++; else if (src[k] === '}' && --depth === 0) return src.slice(at + 1, k + 1); }
  throw Error('unbalanced ' + name);
}
const proto = new Function('WORLD', 'lifeScene', 'lifeInputFromQuest', 'lifeItem', `return { ${['syncLife', 'lifeShows', 'updateAmbientFx'].map(method).join(',\n')} };`)(WORLD, lifeScene, lifeInputFromQuest, lifeItem);
const terrain = createTerrain(WORLD), hearth = WORLD.life.items.find(d => d.id === 'hearth');
function fakeGame(quest) {
  const applied = [], smoke = [];
  const g = Object.assign(Object.create(proto), { quest, applied, smoke, terrain, flow: 'play', rng: () => 0.99, hero: { pos: { x: -40, y: 10, z: -25 } },
    props: { life: { apply: s => applied.push(s) } }, fx: { flame() {}, ember() {}, smoke() {}, mote() {}, chimney: (p, c) => smoke.push({ p, grey: !!c }) } });
  return g;
}
const quest = (beat, extra = {}) => ({ beat, flags: { approach: 'front', ...extra }, resources: { food: 60 }, trust: 40 });

test('syncLife hands the scene of life-rules to the life view, and lifeShows reads it [life-wiring-sync]', () => {
  const g = fakeGame(quest('b4_village'));
  g.syncLife();
  assert.equal(g.applied.length, 1);
  assert.deepEqual(g.applied[0], lifeScene(lifeInputFromQuest(g.quest)), '[life-wiring-sync] the view gets exactly the life-rules scene');
  assert.equal(g.lifeShows('camp_smoke'), true); assert.equal(g.lifeShows('house_smoke'), false);
  g.quest = quest('b5_archer'); g.syncLife();
  assert.equal(g.lifeShows('camp_smoke'), false); assert.equal(g.lifeShows('house_smoke'), true);
  assert.equal(Object.assign(fakeGame(null), { lifeState: null }).lifeShows('house_smoke'), false, '[life-wiring-sync] no scene, no smoke');
});

test('smoke: during the raid one grey plume from the camp embers and no kitchen smoke from the houses; after the rescue the houses smoke again [life-wiring-smoke]', () => {
  for (const [beat, camp, houses] of [['b3_viewpoint', 1, 0], ['b4_village', 1, 0], ['b5_archer', 0, 5], ['b7_result', 0, 5]]) {
    const g = fakeGame(quest(beat)); g.syncLife(); g.updateAmbientFx(0.1);
    const grey = g.smoke.filter(s => s.grey), plain = g.smoke.filter(s => !s.grey);
    assert.equal(grey.length > 0, camp > 0, `[life-wiring-smoke] ${beat}: camp plume`);
    assert.equal(plain.length, houses, `[life-wiring-smoke] ${beat}: house chimneys`);
    for (const s of grey) assert(Math.hypot(s.p.x - hearth.x, s.p.z - hearth.z) < 0.5, '[life-wiring-smoke] the grey plume rises from the camp hearth');
  }
});

test('the life scene is refreshed on every quest event and every rebuild of the world [life-wiring-calls]', () => {
  assert.match(method('dispatch'), /this\.onBeatChange\(prev, state\.beat\);\s*\n\s*this\.syncLife\(\);/, '[life-wiring-calls] dispatch must refresh after the effects and the beat change');
  assert.match(method('buildWorld'), /this\.clearActors\(\); this\.syncLife\(\);/, '[life-wiring-calls] buildWorld must refresh (new game, continue, retry)');
  assert.match(method('updateWorld'), /this\.props\?\.life\?\.update\(this\.time, this\.camera, this\.veg\.wind\)/, '[life-wiring-calls] the view moves with the same wind as the grass');
});
