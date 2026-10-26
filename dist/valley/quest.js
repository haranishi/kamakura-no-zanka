import { STORY } from './story-data.js';
import { initialSave, sanitize } from './save.js';
const copy = v => JSON.parse(JSON.stringify(v));
const validNumber = n => typeof n === 'number' && Number.isFinite(n) && n >= 0;
const snapshot = s => ({ beat: s.beat, flags: copy(s.flags), resources: copy(s.resources), trust: s.trust,
  down: copy(s.down), captiveFreed: s.captiveFreed });
const objective = s => ({ type: 'objective', text: s.story.beats[s.beat].objective });
export function createQuest(story = STORY) {
  const s = { story: copy(story), beat: 'b0_temple', flags: { plan: null, approach: null, archerJoined: false, ambush: null },
    resources: copy(story.resources), trust: story.trust, checkpoint: null, checkpointState: null,
    down: {}, captiveFreed: false, pendingRetry: false };
  return s;
}
export function reduce(state, event) {
  const s = copy(state), effects = [];
  const emit = (type, data = {}) => effects.push({ type, ...data });
  const dialogue = id => emit('dialogue', { id });
  const advance = beat => { s.beat = beat; effects.push(objective(s)); };
  const checkpoint = id => { s.checkpoint = id; s.checkpointState = snapshot(s); emit('checkpoint', { id }); };
  if (!event || typeof event.type !== 'string') return { state: s, effects };
  if (event.type === 'player_down' && !s.pendingRetry && s.beat !== 'done') s.pendingRetry = true;
  else if (event.type === 'retry' && s.pendingRetry) {
    const restored = s.checkpointState ? copy(s.checkpointState) : snapshot(createQuest(s.story));
    Object.assign(s, restored, { pendingRetry: false });
    for (const group of [...Object.keys(s.story.groups), 'village_enemies_rest']) emit('despawn', { group });
    effects.push(objective(s));
  } else if (!s.pendingRetry) {
    if (s.beat === 'b0_temple' && event.type === 'enter_zone' && event.zone === 'temple_yard') {
      dialogue('boy_arrives'); emit('spawn', { group: 'boy' }); advance('b1_boy');
    } else if (s.beat === 'b1_boy' && event.type === 'dialogue_end' && event.id === 'boy_arrives') {
      advance('b2_road'); checkpoint('cp_leave_temple'); emit('spawn', { group: 'road_scout' });
    } else if (s.beat === 'b2_road' && event.type === 'arrived' && event.place === 'viewpoint') {
      advance('b3_viewpoint'); checkpoint('cp_viewpoint'); dialogue('viewpoint_overlook');
    } else if (s.beat === 'b3_viewpoint' && event.type === 'choose_plan' && ['front', 'flank'].includes(event.plan)) {
      s.flags.plan = event.plan;
    } else if (s.beat === 'b3_viewpoint' && event.type === 'enter_zone' && ['village_front', 'village_north', 'village_south'].includes(event.zone)) {
      s.flags.approach = event.zone === 'village_front' ? 'front' : 'flank';
      emit('spawn', { group: 'village_enemies', alert: s.flags.approach === 'front' ? 'high' : 'unaware' });
      advance('b4_village');
    } else if (s.beat === 'b4_village' && event.type === 'pillage_tick' && validNumber(event.dt) && validNumber(event.pillagers)) {
      const rate = s.story.pillage[s.flags.approach];
      // 上限を先に設け、巨大な有限入力同士の積でもInfinityを状態へ渡さない。
      const loss = Math.min(s.resources.food, Math.min(event.dt, 1e6) * Math.min(event.pillagers, 1e6) * rate);
      if (loss > 0) { s.resources.food -= loss; emit('resources', { delta: { food: -loss } }); }
    } else if (['b4_village', 'b6_escort'].includes(s.beat) && event.type === 'enemy_down' && ['killed', 'routed', 'surrendered'].includes(event.how)) {
      const group = s.beat === 'b4_village' ? 'village_enemies' : 'escort_ambush';
      if (s.story.groups[group].includes(event.id) && !s.down[event.id] && (group !== 'escort_ambush' || s.flags.ambush === 'active')) {
        s.down[event.id] = event.how;
        if (group === 'village_enemies' && (event.id === 'officer' || s.story.groups[group].every(id => s.down[id]))) {
          dialogue('village_cleared'); advance('b5_archer'); emit('despawn', { group: 'village_enemies_rest' });
        } else if (group === 'escort_ambush' && s.story.groups[group].every(id => s.down[id])) {
          s.flags.ambush = 'cleared'; dialogue('ambush_cleared');
        }
      }
    } else if (s.beat === 'b5_archer' && event.type === 'interact' && event.id === 'archer_captive' && !s.captiveFreed) {
      s.captiveFreed = true; dialogue('archer_joins');
    } else if (s.beat === 'b5_archer' && s.captiveFreed && event.type === 'party_joined' && event.id === 'archer') {
      s.flags.archerJoined = true;
      const delta = Math.min(15, 1000 - s.resources.morale);
      s.resources.morale += delta; emit('resources', { delta: { morale: delta } });
      advance('b6_escort'); checkpoint('cp_archer_joined');
    } else if (s.beat === 'b6_escort' && event.type === 'enter_zone' && event.zone === 'ambush_trigger' && s.flags.ambush === null) {
      s.flags.ambush = 'active'; emit('spawn', { group: 'escort_ambush' });
    } else if (s.beat === 'b6_escort' && event.type === 'arrived' && event.place === 'temple_steps' && s.flags.ambush !== 'active') {
      advance('b7_result'); checkpoint('cp_result'); dialogue('result'); emit('ending', { summary: summarize(s) });
    } else if (s.beat === 'b7_result' && event.type === 'dialogue_end' && event.id === 'result') advance('done');
  }
  return { state: s, effects };
}
export function summarize(s) {
  const { food, morale } = s.resources, approach = s.flags.approach;
  return { saved: s.flags.archerJoined ? 4 : 3, food, morale, trust: s.trust, approach,
    lines: [s.story.results[approach || 'none'], s.story.results[food >= 50 ? 'plentiful' : 'scarce'],
      morale >= 60 ? '仲間と帰る灯がある。' : '里の灯を絶やすな。', s.trust >= 50 ? '里は門を開く。' : '信頼はこれからだ。'] };
}
export function exportProgress(state) {
  // 戦闘中の保存は、消費された資源を含め直前の区切りへ戻す。
  const s = state.checkpointState ? { ...state, ...copy(state.checkpointState) } : createQuest(state.story);
  const saved = initialSave();
  Object.assign(saved, { checkpoint: state.checkpoint, beat: s.beat, flags: copy(s.flags), resources: copy(s.resources), trust: s.trust });
  saved.party.archer.joined = s.flags.archerJoined;
  saved.world.enemies = Object.fromEntries(Object.keys(s.down).map(id => [id, { alive: false }]));
  return saved;
}
export function restoreProgress(story = STORY, saved) {
  let clean;
  try { clean = sanitize(saved); } catch { return createQuest(story); }
  const s = createQuest(story);
  Object.assign(s, { beat: clean.beat, checkpoint: clean.checkpoint, flags: copy(clean.flags), resources: copy(clean.resources), trust: clean.trust });
  s.down = Object.fromEntries(Object.entries(clean.world.enemies).filter(([, e]) => !e.alive).map(([id]) => [id, 'killed']));
  s.captiveFreed = s.flags.archerJoined;
  if (s.checkpoint) s.checkpointState = snapshot(s);
  return s;
}
