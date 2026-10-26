export const VALLEY_KEY = 'kamakura-valley-progress';
export const VALLEY_SCHEMA_VERSION = 1;
const beats = ['b0_temple', 'b1_boy', 'b2_road', 'b3_viewpoint', 'b4_village', 'b5_archer', 'b6_escort', 'b7_result', 'done'];
const checkpoints = [null, 'cp_leave_temple', 'cp_viewpoint', 'cp_archer_joined', 'cp_result'];
const modes = ['follow', 'hold', 'cover', 'retreat'];
export function initialSave() {
  return { schema: 'kamakura-valley-progress', version: 1, savedAt: 0, checkpoint: null, beat: 'b0_temple',
    flags: { plan: null, approach: null, archerJoined: false, ambush: null },
    resources: { food: 60, material: 0, funds: 0, morale: 50 }, trust: 40,
    party: { archer: { joined: false, hp: 100, mode: 'follow' } }, player: { hp: 100, posture: 100 },
    world: { enemies: {} } };
}
const fail = () => { throw new TypeError('保存の値が正しくない'); };
const object = v => { if (!v || typeof v !== 'object' || Array.isArray(v) || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail(); return v; };
const number = v => { if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 1000) fail(); return v; };
const bool = v => { if (typeof v !== 'boolean') fail(); return v; };
const choice = (v, values) => { if (!values.includes(v)) fail(); return v; };
export function sanitize(raw) {
  object(raw);
  if (raw.schema !== VALLEY_KEY || raw.version !== VALLEY_SCHEMA_VERSION) fail();
  const result = initialSave();
  result.savedAt = number(raw.savedAt);
  result.checkpoint = choice(raw.checkpoint, checkpoints);
  result.beat = choice(raw.beat, beats);
  const flags = object(raw.flags);
  result.flags = { plan: choice(flags.plan, [null, 'front', 'flank']), approach: choice(flags.approach, [null, 'front', 'flank']),
    archerJoined: bool(flags.archerJoined), ambush: choice(flags.ambush, [null, 'active', 'cleared']) };
  const resources = object(raw.resources);
  for (const k of Object.keys(result.resources)) result.resources[k] = number(resources[k]);
  result.trust = number(raw.trust);
  const archer = object(object(raw.party).archer), player = object(raw.player);
  result.party.archer = { joined: bool(archer.joined), hp: number(archer.hp), mode: choice(archer.mode, modes) };
  if (result.party.archer.joined !== result.flags.archerJoined) fail();
  result.player = { hp: number(player.hp), posture: number(player.posture) };
  const enemies = object(object(raw.world).enemies);
  if (Object.keys(enemies).length > 256) fail();
  result.world.enemies = Object.fromEntries(Object.entries(enemies).map(([id, value]) => {
    if (!/^[a-zA-Z0-9_-]{1,64}$/.test(id) || ['__proto__', 'prototype', 'constructor'].includes(id)) fail();
    return [id, { alive: bool(object(value).alive) }];
  }));
  return result;
}
export function migrate(raw) {
  // 旧版は存在しない。未知版を版1と誤認させない。
  return sanitize(raw);
}
export function loadValley(storage) {
  try {
    if (!storage || typeof storage.getItem !== 'function') return { state: initialSave(), hasSave: false, notice: '保存を読み込めない' };
    const text = storage.getItem(VALLEY_KEY);
    if (text === null || text === undefined) return { state: initialSave(), hasSave: false, notice: '' };
    const raw = JSON.parse(text);
    if (raw && raw.version !== 1) return { state: initialSave(), hasSave: false, notice: '保存の版に対応していない' };
    return { state: migrate(raw), hasSave: true, notice: '' };
  } catch {
    return { state: initialSave(), hasSave: false, notice: '保存が壊れているため最初から始める' };
  }
}
export function saveValley(storage, state) {
  try {
    if (!storage || typeof storage.setItem !== 'function') return { ok: false, notice: 'この環境では保存できない' };
    const clean = sanitize(state);
    // 同じ保存枠の死亡記録は、生存スナップショットで上書きしない。
    if (typeof storage.getItem === 'function') {
      const previous = loadValley(storage);
      if (previous.hasSave) {
        for (const [id, enemy] of Object.entries(previous.state.world.enemies)) {
          if (!enemy.alive) clean.world.enemies[id] = { alive: false };
        }
      }
    }
    storage.setItem(VALLEY_KEY, JSON.stringify(sanitize(clean)));
    return { ok: true, notice: '' };
  } catch {
    return { ok: false, notice: '進行を保存できない' };
  }
}
