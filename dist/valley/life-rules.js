// life-rules.js — 谷の暮らしの「見せる物」を決める純粋な層（S7-0。画面への配線は S7-A 以降の life-view が受け持つ）。
// 入力＝場面（b0〜b7・done）・選んだ道（正面 front／脇道 flank）・結果（里の米・信頼・弥十郎・待ち伏せ・物見）。
// 出力＝場所ごとの「出す物と状態」の一覧。Three.js・DOM・乱数・時計に触れない（tools/check-valley.mjs が見張る）。
// 番号（寺2・入3 など）は design-valley-life-places.md の表。ここには場面と選択で姿の変わる物だけを置く（動かない飾りは配置の表へ）。
// 本人の決定（2026-11-01・design-valley-life.md）：
//   問1 荒らされている間（b0〜b4）は、はっきり荒れる。火は使わない：炎を出すのは灯籠（灯）だけ。野営の炊き場も燠と煙までにする。
//       荒れ方は、選んだ道と、減った米で変わる（正面ほど・米が減るほど荒れる）。荒れた跡は、救ったあとも結果として残す。
//   問2 救ったあと（b5〜）は暮らしが動き出す：働く人が2〜3人増え、田の二人は仕事へ戻り、夕餉の煙が戻る。結末で寺の灯籠に火が入る。
//   問3 謎「門を離れた夜」は、廃寺の出口に門の礎石と焦げた横木だけを置く。言葉では触れず、調べる対象にもしない。
import { STORY } from './story-data.js';

const BEATS = ['b0_temple', 'b1_boy', 'b2_road', 'b3_viewpoint', 'b4_village', 'b5_archer', 'b6_escort', 'b7_result', 'done'];
// 境目は quest.js の summarize（結果の文）と同じ値。台詞と絵を食い違わせない（tests/valley-life-rules.test.mjs が照合する）。
export const FOOD_PLENTIFUL = 50, FOOD_MEAGER = 35, TRUST_HIGH = 58, TRUST_MID = 48;
export const LIFE_PLACES = ['temple', 'road', 'viewpoint', 'entrance', 'village', 'captive', 'return'];
export const DAMAGE_NAMES = { 1: 'raided', 2: 'trampled', 3: 'ravaged' };          // 荒らされた／踏み荒らされた／ひどく荒れた

// 場面の番号（0〜8）。'b0'〜'b7' の短い名も受ける。知らない値は始まり（b0）とみなす。
export function stageOf(beat) {
  if (typeof beat !== 'string') return 0;
  const i = BEATS.indexOf(beat);
  if (i >= 0) return i;
  const m = /^b([0-7])$/.exec(beat);
  return m ? Number(m[1]) : 0;
}

// 里の段階：raid＝兵がいる（b0〜b4）、saved＝救ったあと（b5・b6）、ending＝結末（b7・done）。
export function phaseOf(stage) { return stage <= 4 ? 'raid' : stage <= 6 ? 'saved' : 'ending'; }

const finite = (v, fallback) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);
const ROUTES = ['front', 'flank'];

// 入力をそろえる。欠けた・壊れた値は物語の初期値（米60・信頼40）か、いちばん控えめな状態へ戻す。
export function normalizeLifeInput(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const stage = stageOf(r.beat), archerJoined = r.archerJoined === true;
  return {
    stage, beat: BEATS[stage],
    route: ROUTES.includes(r.approach) ? r.approach : ROUTES.includes(r.plan) ? r.plan : null,   // 里へ入った道。入る前は見晴らしで選んだ道
    entered: stage >= 4,                                                                          // 里へ入った（道が荒れ方に効く）
    food: Math.max(0, finite(r.food, STORY.resources.food)),
    trust: Math.min(100, Math.max(0, finite(r.trust, STORY.trust))),
    archerJoined, captiveFreed: r.captiveFreed === true || archerJoined,
    ambush: ['active', 'cleared'].includes(r.ambush) ? r.ambush : null,
    scoutDown: r.scoutDown === true,                                                              // 林道の物見を倒した（刀が道に残る）
  };
}

// 荒れ方の段階（1〜3）。里へ入る前は1。入ったあとは道と残った米で決まり、救ったあとも変わらない（結果として残る）。
// 正面：米35以上で2・未満で3。脇道：米50以上で1（静かに片づけた）・未満で2（気づかれた。結果の文の flankLoud と同じ境目）。
export function damageOf(input) {
  const { entered, route, food } = input;
  if (!entered) return 1;
  if (route === 'front') return food >= FOOD_MEAGER ? 2 : 3;
  if (route === 'flank') return food >= FOOD_PLENTIFUL ? 1 : 2;
  return food >= FOOD_PLENTIFUL ? 1 : food >= FOOD_MEAGER ? 2 : 3;              // 道の記録が無い古い保存：米だけで決める
}

const fireRing = trust => (trust >= TRUST_HIGH ? 'inner' : trust >= TRUST_MID ? 'edge' : 'apart');
const resultRice = food => (food >= FOOD_PLENTIFUL ? ['bales', 3] : food >= FOOD_MEAGER ? ['bales', 2] : ['basket', 1]);

// 物の表。rule(c) は { show, state, count?, flame? } を返す。c＝{ ...入力, phase, damage }。
// count は見せる数（隠すときは0）。flame は炎を出すか（灯籠だけが true になれる。問1）。
export const LIFE_ITEMS = [
  // 廃寺の庭（b0・b1・b7）
  { id: 'gate_ruin', place: 'temple', ref: '寺2', states: ['quiet'], rule: () => ({ show: true, state: 'quiet' }) },               // 問3：最初から最後まで同じ姿
  { id: 'fire_ring', place: 'temple', ref: '寺4', states: ['unused', 'inner', 'edge', 'apart'],
    rule: c => ({ show: true, state: c.phase === 'ending' ? fireRing(c.trust) : 'unused' }) },                                       // 里の人が座る所（信頼で変わる）
  { id: 'temple_lantern', place: 'temple', ref: '寺5', states: ['unlit', 'lit'], rule: c => lantern(c.phase === 'ending') },
  { id: 'result_rice', place: 'temple', ref: '寺6', states: ['none', 'bales', 'basket'],
    rule: c => { if (c.phase !== 'ending') return { show: false, state: 'none' }; const [state, count] = resultRice(c.food); return { show: true, state, count }; } },
  // 石段〜林道（b2・b6）
  { id: 'steps_lantern', place: 'road', ref: '道6', states: ['unlit', 'lit'], rule: c => lantern(c.stage >= 6) },                 // 帰り道で穂太が灯をともして待つ
  { id: 'scout_sword', place: 'road', ref: '帰3', states: ['none', 'dropped'], rule: c => ({ show: c.scoutDown, state: c.scoutDown ? 'dropped' : 'none' }) },
  // 見晴らし岩から見える煙と鳥（b3・b6）
  { id: 'house_smoke', place: 'viewpoint', ref: '見4', states: ['stopped', 'rising'], rule: c => ({ show: c.phase !== 'raid', state: c.phase === 'raid' ? 'stopped' : 'rising' }) },
  { id: 'camp_smoke', place: 'viewpoint', ref: '見4', states: ['none', 'rising'], rule: c => ({ show: c.phase === 'raid', state: c.phase === 'raid' ? 'rising' : 'none' }) },   // 灰色の煙を1本だけ
  { id: 'crows', place: 'viewpoint', ref: '見5', states: ['circling', 'to_peak'], rule: c => ({ show: true, state: c.phase === 'ending' ? 'to_peak' : 'circling' }) },
  // 里の入口（b3・b4）
  { id: 'raid_marks', place: 'entrance', ref: '入4', states: Object.values(DAMAGE_NAMES), rule: c => ({ show: true, state: DAMAGE_NAMES[c.damage], count: c.damage }) },
  { id: 'fallen_fence', place: 'entrance', ref: '入4', states: ['fallen'], rule: c => ({ show: true, state: 'fallen', count: c.damage >= 3 ? 2 : 1 }) },   // 柵が1〜2区画倒れる
  { id: 'bale_row', place: 'entrance', ref: '入1', states: ['carried_out', 'left_behind'],
    rule: c => ({ show: true, state: c.phase === 'raid' ? 'carried_out' : 'left_behind', count: 3 + c.damage }) },                // 蔵から荷車まで4〜6個（1つは破れる）
  { id: 'camp_kitchen', place: 'entrance', ref: '入2', states: ['embers', 'cold'], rule: c => ({ show: true, state: c.phase === 'raid' ? 'embers' : 'cold' }) },   // 空の鍋。炎は出さない
  { id: 'boundary_rope', place: 'entrance', ref: '入3', states: ['cut', 'retied'], rule: c => ({ show: true, state: c.phase === 'raid' ? 'cut' : 'retied' }) },
  { id: 'captive_bow', place: 'entrance', ref: '入6', states: ['none', 'on_cart'], rule: c => ({ show: !c.archerJoined, state: c.archerJoined ? 'none' : 'on_cart' }) },
  // 里の中（b4〜b6）
  { id: 'threshing_floor', place: 'village', ref: '中1', states: ['scattered', 'tidy'], rule: c => ({ show: true, state: c.phase === 'raid' ? 'scattered' : 'tidy' }) },
  { id: 'laundry', place: 'village', ref: '中4', states: ['fallen', 'hung'], rule: c => ({ show: true, state: c.phase === 'raid' ? 'fallen' : 'hung' }) },
  { id: 'extra_workers', place: 'village', ref: '中6', states: ['away', 'working'],
    rule: c => (c.phase === 'raid' ? { show: false, state: 'away', count: 0 } : { show: true, state: 'working', count: c.food >= FOOD_PLENTIFUL ? 3 : 2 }) },   // 米が多く残れば3人
  { id: 'paddy_workers', place: 'village', ref: '中7', states: ['hiding', 'working'], rule: c => ({ show: true, state: c.phase === 'raid' ? 'hiding' : 'working', count: 2 }) },
  // 縛られた弥十郎の場所（b5）
  { id: 'captive_rope', place: 'captive', ref: '縛1', states: ['tied', 'cut'], rule: c => ({ show: true, state: c.captiveFreed ? 'cut' : 'tied' }) },   // 解いたあとは切れた縄が残る
  // 廃寺へ戻る道（b6）
  { id: 'ambush_birds', place: 'return', ref: '帰1', states: ['perched', 'flown'],
    rule: c => ({ show: c.stage === 6, state: c.ambush === null ? 'perched' : 'flown' }) },                                         // 待ち伏せの前に飛び立つ
];

function lantern(lit) { return { show: true, state: lit ? 'lit' : 'unlit', flame: lit }; }

// 場面と選択から、場所ごとの「出す物と状態」を返す。呼ぶたびに新しい物を返し、入力を書き換えない。
export function lifeScene(raw) {
  const input = normalizeLifeInput(raw), phase = phaseOf(input.stage), damage = damageOf(input), c = { ...input, phase, damage };
  const places = Object.fromEntries(LIFE_PLACES.map(p => [p, []]));
  for (const item of LIFE_ITEMS) {
    const r = item.rule(c);
    places[item.place].push({ id: item.id, ref: item.ref, show: r.show, state: r.state, count: r.show ? (r.count ?? 1) : 0, flame: r.flame === true });
  }
  return { stage: input.stage, beat: input.beat, phase, route: input.route, damage: { level: damage, name: DAMAGE_NAMES[damage] }, places };
}

// 一覧から1つ取り出す（配線と試験の手間を減らす）。
export function lifeItem(scene, id) {
  for (const list of Object.values(scene.places)) { const hit = list.find(i => i.id === id); if (hit) return hit; }
  return null;
}

// quest.js の状態から入力を作る。物見を倒したかは quest が持たないので、呼ぶ側（game.js）が渡す。
export function lifeInputFromQuest(q, { scoutDown = false } = {}) {
  const s = q && typeof q === 'object' ? q : {};
  return { beat: s.beat, approach: s.flags?.approach ?? null, plan: s.flags?.plan ?? null, food: s.resources?.food, trust: s.trust,
    archerJoined: s.flags?.archerJoined === true, captiveFreed: s.captiveFreed === true, ambush: s.flags?.ambush ?? null, scoutDown: scoutDown === true };
}
