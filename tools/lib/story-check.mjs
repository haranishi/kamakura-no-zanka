// 物語のデータの検査（design-narrative.md §7）。tools/check-valley.mjs と tests/valley-story.test.mjs が使う。
// 見るもの：id の重複／一画面40字（掛け声14字）／未知の話者／条件の書き間違い／条件が一度も満たされない台詞／
// 言い換えの組が各場合に一つだけ／断片 id の欠け／調べる物と手がかりの指す行／どこからも呼ばれない会話／画面に出さない語。
import { matches, WHEN_KEYS, BANTER_EVENTS } from '../../dist/valley/banter.js';
import { ENDING_NEXT } from '../../dist/valley/narrative.js';

const len = t => [...String(t)].length;
// 遊びで起こりうる状況（段ごとに取りうる値だけ）
export function* situations(story) {
  const beats = Object.keys(story.beats);
  for (const beat of beats) {
    const i = beats.indexOf(beat);
    for (const approach of i >= 4 ? ['front', 'flank'] : [null]) for (const plan of i >= 3 ? [null, 'front', 'flank'] : [null])
      for (const ambush of i === 6 ? [null, 'active', 'cleared'] : i > 6 ? ['cleared'] : [null]) for (const captiveFreed of i === 5 ? [false, true] : [i > 5])
        for (const seen of i >= 4 ? [false, true] : [false]) for (const events of i >= 2 ? [[], ...BANTER_EVENTS.map(e => [e])] : [[]])
          for (const areas of [[], ...Object.keys(story.areas).map(a => [a])]) for (const trust of i >= 4 ? [40, 50, 60] : [40])
            for (const food of i >= 4 ? [20, 40, 55] : [60]) for (const fragments of [0, 3, 5]) for (const beatT of [0, 30])
              yield { t: 100, beat, beatT, areas, events, plan, approach, ambush, companion: i >= 6, captiveFreed, seen, trust, food, fragments, blocked: false };
  }
}
export const reachable = (story, when) => { for (const s of situations(story)) if (matches(when, s)) return true; return false; };

// 問題の一覧を返す（空なら合格）。sources は会話を呼ぶ側のソース（quest.js・game.js の本文）
export function storyProblems({ story, speakers, sources }) {
  const out = [], bad = m => out.push(m);
  const beats = Object.keys(story.beats);
  const dlg = Object.entries(story.dialogues).flatMap(([id, lines]) => lines.map(l => ({ id, ...l })));
  const ban = story.banter.flatMap(e => e.lines.map(l => ({ id: e.id, ...l })));
  for (const [name, list] of [['banter', story.banter], ['relics', story.relics], ['fragments', story.fragments], ['clues', story.clues]]) {
    const ids = list.map(x => x.id);
    for (const id of ids.filter((x, i) => ids.indexOf(x) !== i)) bad(`${name}: duplicate id ${id}`);
  }
  for (const l of [...dlg, ...ban]) {
    if (!speakers.includes(l.speaker)) bad(`${l.id}: unknown speaker "${l.speaker}"`);
    if (!(len(l.text) > 0 && len(l.text) <= 40)) bad(`${l.id}: "${l.text}" is ${len(l.text)} characters`);
  }
  const texts = [...dlg, ...ban].filter(l => !l.pause).map(l => l.text);
  for (const t of texts.filter((x, i) => texts.indexOf(x) !== i)) bad(`duplicate line "${t}"`);
  for (const [k, list] of Object.entries(story.barks)) for (const t of list) if (len(t) > 14) bad(`bark ${k}: "${t}" is ${len(t)} characters`);
  for (const c of story.clues) if (c.text && (len(c.text) > 40 || !speakers.includes(c.speaker))) bad(`clue ${c.id}: text or speaker`);
  // 条件：鍵と値の書き間違い、一度も満たされない条件
  const whens = [...story.banter.map(e => [e.id, e.when]), ...dlg.filter(l => l.when).map(l => [`${l.id} "${l.text}"`, l.when])];
  for (const [who, w] of whens) {
    if (!w) continue;
    for (const k of Object.keys(w)) if (!WHEN_KEYS.includes(k)) bad(`${who}: unknown condition key "${k}"`);
    for (const b of w.beats || []) if (!beats.includes(b)) bad(`${who}: unknown beat ${b}`);
    for (const a of w.areas || []) if (!story.areas[a]) bad(`${who}: unknown area ${a}`);
    if (w.after && !BANTER_EVENTS.includes(w.after)) bad(`${who}: unknown event ${w.after}`);
    if (w.trust && !['high', 'mid', 'low'].includes(w.trust)) bad(`${who}: trust ${w.trust}`);
    for (const k of ['plan', 'approach']) if (k in w && ![null, 'front', 'flank'].includes(w[k])) bad(`${who}: ${k} ${w[k]}`);
    if ('ambush' in w && ![null, 'active', 'cleared'].includes(w.ambush)) bad(`${who}: ambush ${w.ambush}`);
    for (const k of ['food', 'fragments']) if (w[k] && !(Array.isArray(w[k]) && w[k].length === 2)) bad(`${who}: ${k} must be [min, max)`);
    if (!reachable(story, w)) bad(`${who}: the condition can never be met`);
  }
  for (const e of story.banter) if (!e.lines?.length) bad(`banter ${e.id}: no lines`);
  // 言い換えの組（久作の第一声・結果の一言）：道×蓄え×信頼×見つかったか の各場合に、ちょうど一行
  for (const [id, lines] of Object.entries(story.dialogues)) {
    const groups = new Set(lines.filter(l => l.group).map(l => l.group));
    for (const g of groups) for (const approach of ['front', 'flank']) for (const food of [0, 20, 34.99, 35, 40, 49.99, 50, 60])
      for (const trust of [40, 47.9, 48, 57.9, 58, 70]) for (const seen of [false, true]) {
        const n = lines.filter(l => l.group === g && matches(l.when, { approach, food, trust, seen })).length;
        if (n !== 1) { bad(`${id}: ${n} lines in group ${g} for ${approach}, food ${food}, trust ${trust}, seen ${seen}`); break; }
      }
  }
  // 断片：各 id がちょうど一行に乗り、その行は条件なしで、断片の会話にある
  for (const f of story.fragments) {
    const carriers = dlg.filter(l => l.fragment === f.id);
    if (carriers.length !== 1) bad(`${f.id}: carried by ${carriers.length} lines`);
    else if (carriers[0].id !== f.dialogue) bad(`${f.id}: lives in ${carriers[0].id}, not ${f.dialogue}`);
    else if (carriers[0].when) bad(`${f.id}: must not depend on a condition`);
  }
  for (const l of dlg) if (l.fragment && !story.fragments.some(f => f.id === l.fragment)) bad(`${l.id}: unknown fragment ${l.fragment}`);
  for (const r of story.relics) {
    if (!story.dialogues[r.dialogue]) { bad(`${r.id}: no dialogue ${r.dialogue}`); continue; }
    if (r.fragment && !story.dialogues[r.dialogue].some(l => l.fragment === r.fragment)) bad(`${r.id}: its dialogue lacks ${r.fragment}`);
    if (r.clue && !story.dialogues[r.dialogue].some(l => l.clue === r.clue)) bad(`${r.id}: its dialogue lacks ${r.clue}`);
    if (!(r.beats?.length && r.beats.every(b => beats.includes(b)) && r.prompt && r.r > 0 && (r.at || r.drop))) bad(`${r.id}: beats, prompt, r or place`);
  }
  // 会話：どこからも呼ばれないもの（quest.js・game.js の文字列、調べる物、結末のつなぎ）
  const called = new Set([...sources.matchAll(/'([a-z0-9_]+)'/g)].map(m => m[1]));
  for (const r of story.relics) called.add(r.dialogue);
  for (const id of Object.values(ENDING_NEXT)) called.add(id);
  for (const id of Object.keys(story.dialogues)) if (!called.has(id)) bad(`dialogue ${id} is never called`);
  // 画面に出す語は裏取りした範囲（「斥候」「割り符」「足軽」は出さない）
  const shown = JSON.stringify([story.dialogues, story.banter, story.barks, story.hints, story.clues, story.relics.map(r => r.prompt), story.beats, story.results]);
  for (const word of ['斥候', '割り符', '足軽']) if (shown.includes(word)) bad(`on-screen text uses ${word}`);
  return out;
}
