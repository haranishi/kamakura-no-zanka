// narrative.js — 会話の組み立てと、調べられる物の判定（純粋層）。台詞の文は story-data.js、拾った断片の記録は quest.js が持つ。
// ・会話の行は when（banter.js の matches）で選ぶ：久作の第一声は道×食糧、結末は拾った断片の数で一言深くなる。
// ・結末は result → ending_truth → ending_coda の三つの会話（1回あたり約5行）。game.js が ENDING_NEXT でつなぐ。
// 時計・乱数・DOM に触れない。
import { matches, trustTier } from './banter.js';

export const ENDING_NEXT = { result: 'ending_truth', ending_truth: 'ending_coda' };
// 結末の段（R20.3）：0〜2は真相の3行だけ、3〜4は一言深く、5は袖印をくべる
export const endingTier = n => (n >= 5 ? 'full' : n >= 3 ? 'deep' : 'plain');

// 会話の行が読む状況（任務の状態から）
export function dialogueSituation(q) {
  return { beat: q.beat, plan: q.flags.plan, approach: q.flags.approach, ambush: q.flags.ambush, companion: q.flags.archerJoined,
    captiveFreed: q.captiveFreed, seen: q.seen, trust: q.trust, food: q.resources.food, fragments: (q.flags.fragments || []).length };
}
// 会話 id の行を、いまの状況で選ぶ。無い id は null
export function linesFor(story, id, q) {
  const lines = story.dialogues[id];
  if (!lines) return null;
  const sit = dialogueSituation(q);
  return lines.filter(l => matches(l.when, sit));
}

// いま「調べる」の案内を出す物（無ければ null）。sit: { beat, pos, fragments, clues（読んだ手がかりの id）, drops（落ちた物の位置）, danger（気づいた敵が近い） }
export function relicInReach(story, sit) {
  if (sit.danger) return null;
  let best = null, bestD = Infinity;
  for (const r of story.relics || []) {
    if (!r.beats.includes(sit.beat)) continue;
    if (r.fragment && (sit.fragments || []).includes(r.fragment)) continue;
    if (r.clue && (sit.clues || []).includes(r.clue)) continue;
    const at = r.drop ? sit.drops?.[r.id] : r.at;
    if (!at) continue;
    const d = Math.hypot(sit.pos.x - at.x, sit.pos.z - at.z);
    if (d < r.r && d < bestD) { best = r; bestD = d; }
  }
  return best;
}

// 焚き火の輪との距離（§5.3。見た目だけ）。信頼が高いほど輪の内側に座り、低いと少し離れて立つ
export function ringPlacement(trust) {
  return { high: { scale: 0.78, sit: true }, mid: { scale: 1.0, sit: false }, low: { scale: 1.8, sit: false } }[trustTier(trust)];
}
