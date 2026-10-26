const EPS = 1e-10;
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const positive = v => Math.max(0, finite(v));
// 60分の1秒を整数で表せる格子にそろえ、30Hz/60Hz間の蓄積誤差を除く。
const PRECISION = 60e9;
const round = v => Math.abs(v) > Number.MAX_VALUE / PRECISION ? v : Math.round(v * PRECISION) / PRECISION;
const freezeRows = rows => Object.freeze(Object.fromEntries(
  Object.entries(rows).map(([id, row]) => [id, Object.freeze(row)])));

// 種別の数値は仕様に未記載なので、調整可能な暫定値をここだけに置く。
export const STATS = freezeRows({
  hero: {hp: 100, posture: 100, radius: .3, armor: 'none'},
  archer_ally: {hp: 60, posture: 60, radius: .3, armor: 'none'},
  soldier: {hp: 60, posture: 50, radius: .3, armor: 'light'},
  archer: {hp: 40, posture: 40, radius: .3, armor: 'none'},
  officer: {hp: 200, posture: 120, radius: .3, armor: 'heavy'},
});
const move = (id, windup, active, recover, damage, posture, reach, arcDeg, clip, extra = {}) =>
  ({id, kind: 'melee', windup, active, recover, damage, posture, reach, arcDeg,
    lunge: 0, blockable: true, telegraph: 0, clip, ...extra});
export const MOVES = freezeRows({
  light1: move('light1', .17, .10, .26, 12, 10, 1.9, 100, 'Katana_Kesa_Cut'),
  light2: move('light2', .15, .10, .28, 12, 10, 1.9, 110, 'Katana_Gyakukesa_Cut',
    {chainFrom: 'light1', chainWindow: .30}),
  light3: move('light3', .20, .12, .46, 18, 20, 1.9, 140, 'Katana_Yokonagi_Cut',
    {chainFrom: 'light2', chainWindow: .30}),
  heavy: move('heavy', .42, .12, .55, 30, 36, 2, 90, 'Katana_Karatake_Heavy'),
  finisher: move('finisher', .25, .10, .65, 60, 0, 1.6, 90, 'Katana_Finisher', {blockable: false}),
  soldier_slash: move('soldier_slash', .55, .12, .70, 10, 12, 1.7, 100, 'Katana_Kesa_Cut', {telegraph: .55}),
  soldier_thrust: move('soldier_thrust', .70, .10, .80, 12, 14, 2.6, 40, 'Katana_Thrust', {telegraph: .70}),
  officer_a: move('officer_a', .35, .12, .30, 14, 14, 2, 110, 'Officer_Attack', {telegraph: .35}),
  // 二段目の威力・間合いは未記載のため一段目を引き継ぐ。
  officer_b: move('officer_b', .40, .12, .30, 14, 14, 2, 110, 'Officer_Attack',
    {telegraph: .40, chainFrom: 'officer_a', chainWindow: .30}),
  officer_c: move('officer_c', .45, .14, .80, 22, 24, 2.2, 120, 'Officer_Attack',
    {telegraph: .45, chainFrom: 'officer_b', chainWindow: .30}),
  // 弾きの直後だけ出せる反撃（RULES.counterWindow）。受け止めた勢いで斬り返すので、予備が短く構え削りが大きい。
  counter: move('counter', .12, .10, .42, 26, 32, 2, 110, 'Katana_Counter_Cut', {counter: true}),
  archer_shot: move('archer_shot', .90, .05, 1.2, 12, 8, 24, 0, 'Archery_Shot', {kind: 'shot', telegraph: .90}),
  ally_shot: move('ally_shot', .90, .05, 1.2, 10, 8, 24, 0, 'Archery_Shot', {kind: 'shot', telegraph: .90}),
});
// stagger は敵の構え崩れ（とどめを刺す猶予）。主人公の構え崩れは短く（袋叩きの時間を減らす）。
const RULES = Object.freeze({regenDelay: 1.2, regen: 18, stagger: 2.2, heroStagger: 1.4, dodge: .52,
  invStart: .06, invEnd: .30, dodgeCost: 12, parry: .2, parryDamage: 40,
  recoil: .5, hit: .3, blockArc: 120, counterWindow: .9});

export function createFighter({id, team = 'enemy', kind = 'soldier', x = 0, z = 0,
  yaw = 0, hp, posture} = {}) {
  if (!Object.hasOwn(STATS, kind)) throw new RangeError('Unknown fighter kind');
  if (!['hero', 'ally', 'enemy'].includes(team)) throw new RangeError('Unknown fighter team');
  if (typeof id !== 'string' && !Number.isFinite(id)) throw new TypeError('Fighter id required');
  const s = STATS[kind];
  const hpMax = Math.max(1, finite(hp, s.hp));
  const postureMax = Math.max(1, finite(posture, s.posture));
  const alive = finite(hp, s.hp) > 0;
  const broken = alive && finite(posture, s.posture) <= 0;
  return {id, team, kind, x: finite(x), z: finite(z), yaw: finite(yaw),
    hp: alive ? hpMax : 0, hpMax, posture: broken ? 0 : postureMax, postureMax,
    radius: s.radius, armor: s.armor, alive, state: !alive ? 'down' : broken ? 'stagger' : 'idle',
    blocking: false, parryT: 0, counterT: 0, move: null, dodgeT: 0, staggerT: broken ? RULES.stagger : 0,
    hitT: 0, recoilT: 0, noRegenT: 0, telegraphing: false, aware: true,
    pendingEvents: broken ? [{type: 'stagger_start', id}] : []};
}

const ready = f => f.alive && f.state === 'idle' && !f.blocking;
function begin(f, id, targetId = null) {
  f.move = {id, t: 0, phase: 'windup', struck: [], targetId};
  f.state = 'attack';
  f.telegraphing = MOVES[id].telegraph > 0;
  f.noRegenT = RULES.regenDelay;
  f.pendingEvents.push({type: 'phase', id: f.id, moveId: id, phase: 'windup'});
  return true;
}
export function startMove(f, moveId) {
  if (!Object.hasOwn(MOVES, moveId) || moveId === 'finisher' || !f.alive || f.blocking) return false;
  const m = MOVES[moveId];
  if (m.counter && !(f.counterT > EPS && ready(f))) return false;
  if (f.state === 'attack' && f.move) {
    const old = MOVES[f.move.id];
    const end = old.windup + old.active + old.recover;
    if (m.chainFrom !== old.id || f.move.phase !== 'recover' ||
      f.move.t + EPS < end - m.chainWindow || f.move.t >= end - EPS) return false;
    return begin(f, moveId);
  }
  if (!ready(f) || m.chainFrom) return false;
  if (m.counter) f.counterT = 0;
  return begin(f, moveId);
}
export function setBlock(f, on) {
  if (!f.alive) return false;
  if (!on) { f.blocking = false; f.parryT = 0; return true; }
  // 主人公は、斬りの戻りの後半から受けへ切り替えられる（戻りの終わりを待つと、侍大将の刃の光を見ても間に合わなかった）。転がりへの切り替えは前から戻りの途中で出せる
  if (f.team === 'hero' && f.state === 'attack' && f.move?.phase === 'recover') {
    const m = MOVES[f.move.id];
    if (m.kind !== 'shot' && m.id !== 'finisher' && f.move.t + EPS >= m.windup + m.active + m.recover * 0.5) { interrupt(f); f.state = 'idle'; }
  }
  if (f.state !== 'idle') return false;
  // 押しっぱなしで毎フレーム弾き窓を再装填しない。
  if (!f.blocking) f.parryT = RULES.parry;
  f.blocking = true;
  return true;
}
function interrupt(f) {
  f.move = null;
  f.telegraphing = false;
  f.blocking = false;
  f.parryT = 0;
  f.hitT = f.recoilT = f.dodgeT = 0;
}
// 振っている途中の技を無かったことにする。里が片づいた瞬間に退く兵の、これから当たる一撃を止めるのに使う。
export function cancelMove(f) {
  if (!f.alive || f.state !== 'attack') return false;
  interrupt(f);
  f.state = 'idle';
  return true;
}
function stagger(f) {
  if (f.state === 'stagger') return;
  interrupt(f);
  f.state = 'stagger';
  f.staggerT = f.team === 'hero' ? RULES.heroStagger : RULES.stagger;
  f.pendingEvents.push({type: 'stagger_start', id: f.id});
}
export function startDodge(f, yaw = f.yaw) {
  if (!ready(f) || f.posture < RULES.dodgeCost) return false;
  f.posture = round(f.posture - RULES.dodgeCost);
  f.noRegenT = RULES.regenDelay;
  if (f.posture === 0) { stagger(f); return true; }
  f.yaw = finite(yaw, f.yaw);
  f.state = 'dodge';
  f.dodgeT = 0;
  return true;
}

function phaseEvent(f, phase, events) {
  events.push({type: 'phase', id: f.id, moveId: f.move.id, phase});
  f.move.phase = phase;
}
// 境界ごとに時間を分け、余った時間も回復へ渡す。刻み幅で回復量を変えない。
export function tick(f, dt) {
  const events = f.pendingEvents.splice(0);
  if (!f.alive || !Number.isFinite(dt) || dt <= 0) return events;
  let remaining = dt;
  while (remaining > EPS) {
    let boundary = remaining;
    if (f.noRegenT > EPS) boundary = Math.min(boundary, f.noRegenT);
    if (f.state === 'attack' && f.move) {
      const m = MOVES[f.move.id];
      const end = f.move.phase === 'windup' ? m.windup : f.move.phase === 'active' ?
        m.windup + m.active : m.windup + m.active + m.recover;
      boundary = Math.min(boundary, Math.max(0, end - f.move.t));
    } else if (f.state === 'dodge') boundary = Math.min(boundary, RULES.dodge - f.dodgeT);
    else if (f.state === 'stagger') boundary = Math.min(boundary, f.staggerT);
    else if (f.state === 'hit') boundary = Math.min(boundary, f.hitT);
    else if (f.state === 'recoil') boundary = Math.min(boundary, f.recoilT);
    const regen = f.noRegenT <= EPS && !f.blocking && !['attack', 'stagger'].includes(f.state);
    if (regen) f.posture = round(Math.min(f.postureMax, f.posture + RULES.regen * boundary));
    f.noRegenT = round(Math.max(0, f.noRegenT - boundary));
    f.parryT = round(Math.max(0, f.parryT - boundary));
    f.counterT = round(Math.max(0, f.counterT - boundary));
    if (f.state === 'attack' && f.move) {
      const m = MOVES[f.move.id];
      f.move.t = round(f.move.t + boundary);
      if (f.move.phase === 'windup' && f.move.t + EPS >= m.windup) phaseEvent(f, 'active', events);
      else if (f.move.phase === 'active' && f.move.t + EPS >= m.windup + m.active) phaseEvent(f, 'recover', events);
      else if (f.move.phase === 'recover' && f.move.t + EPS >= m.windup + m.active + m.recover) {
        phaseEvent(f, 'end', events);
        f.move = null;
        f.state = 'idle';
      }
      f.telegraphing = !!f.move && f.move.phase === 'windup' && f.move.t < m.telegraph - EPS;
    } else if (f.state === 'dodge') {
      f.dodgeT = round(f.dodgeT + boundary);
      if (f.dodgeT + EPS >= RULES.dodge) { f.state = 'idle'; f.dodgeT = 0; }
    } else if (f.state === 'stagger') {
      f.staggerT = round(Math.max(0, f.staggerT - boundary));
      if (f.staggerT <= EPS) {
        f.state = 'idle'; f.posture = f.postureMax * .5;
        events.push({type: 'stagger_end', id: f.id});
      }
    } else if (f.state === 'hit' || f.state === 'recoil') {
      const key = f.state === 'hit' ? 'hitT' : 'recoilT';
      f[key] = round(Math.max(0, f[key] - boundary));
      if (f[key] <= EPS) f.state = 'idle';
    }
    remaining = Math.max(0, remaining - boundary);
  }
  return events;
}

function inArc(yaw, dx, dz, arc) {
  const distance = Math.hypot(dx, dz);
  if (distance <= EPS) return true;
  return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / distance + EPS >= Math.cos(arc * Math.PI / 360);
}
const inReach = (a, d, reach, arc) =>
  Math.hypot(d.x - a.x, d.z - a.z) <= reach + STATS[d.kind].radius + EPS &&
  inArc(a.yaw, d.x - a.x, d.z - a.z, arc);
// 転がりの無敵に加えて、とどめを刺している最中（崩れた敵に集中する1.0秒）は、斬りも矢も当たらない。
// 無いと、侍大将の一段目をとどめの最中に受け、そのまま続けて斬られて倒れた（第3周の評価。倒れた8回の受けた63発のうち65%が侍大将）。
const invulnerable = f => (f.state === 'dodge' && f.dodgeT + EPS >= RULES.invStart && f.dodgeT <= RULES.invEnd + EPS) ||
  (f.state === 'attack' && f.move?.id === 'finisher');
const result = (outcome, damage, postureDamage, def, moveId = null, attackerId = null) =>
  ({outcome, damage, postureDamage, staggered: def.state === 'stagger', dead: !def.alive,
    moveId, attackerId, defenderId: def.id});

// 軽い鎧の兵も、強い技（三段目・強斬り・反撃）の直撃ではひるむ。鎧なしはどの技でもひるむ。重い鎧は構えが崩れるまでひるまない。
const STRONG = new Set(['light3', 'heavy', 'counter']);
function damageFighter(f, hp, posture, flinch = true, strong = false) {
  if (!f.alive) return null;
  const damage = positive(hp), postureDamage = positive(posture);
  f.hp = round(Math.max(0, f.hp - damage));
  f.posture = round(Math.max(0, f.posture - postureDamage));
  if (damage > 0 || postureDamage > 0) f.noRegenT = RULES.regenDelay;
  if (f.hp === 0) {
    interrupt(f); f.staggerT = 0; f.alive = false; f.state = 'down';
  } else if (f.posture === 0) stagger(f);
  else if (flinch && damage > 0 && (f.armor === 'none' || (strong && f.armor === 'light')) && f.state !== 'stagger') {
    interrupt(f); f.state = 'hit'; f.hitT = RULES.hit;
  }
  return result('hit', damage, postureDamage, f);
}
export function applyDamage(f, hp, posture, strong = false) {
  return damageFighter(f, hp, posture, true, strong);
}
function recoil(f) {
  if (!f.alive || f.state === 'stagger') return;
  interrupt(f); f.state = 'recoil'; f.recoilT = RULES.recoil;
}
// 受けで削られても被弾硬直にせず、受け続けられる。
function blockedDamage(f, damage, posture) {
  return damageFighter(f, damage, posture, false);
}
export function strike(att, def) {
  const instance = att.move;
  if (!att.alive || !def.alive || att.state !== 'attack' || !instance || instance.phase !== 'active') return null;
  const m = MOVES[instance.id];
  if (m.kind === 'shot' || instance.struck.includes(def.id) || !inReach(att, def, m.reach, m.arcDeg)) return null;
  if (m.id === 'finisher' && (def.state !== 'stagger' || instance.targetId !== def.id)) return null;
  instance.struck.push(def.id);
  const response = (o, d = 0, p = 0) => result(o, d, p, def, m.id, att.id);
  if (m.id === 'finisher') {
    const damage = def.kind === 'officer' ? def.hpMax * .30 : m.damage;
    applyDamage(def, damage, 0);
    return response('hit', damage);
  }
  if (invulnerable(def)) return response('evaded');
  if (def.blocking && m.blockable && inArc(def.yaw, att.x - def.x, att.z - def.z, RULES.blockArc)) {
    if (def.parryT > EPS) {
      // 弾きの構え削りは鎧にかかわらず反動を起こす。
      blockedDamage(att, 0, RULES.parryDamage);
      recoil(att);
      def.counterT = RULES.counterWindow;
      return response('parried', 0, RULES.parryDamage);
    }
    blockedDamage(def, m.damage * .15, m.posture * .5);
    if (m.id === 'heavy') recoil(att);
    return response('blocked', m.damage * .15, m.posture * .5);
  }
  applyDamage(def, m.damage, m.posture, STRONG.has(m.id));
  return response('hit', m.damage, m.posture);
}
export function canFinish(att, def) {
  return ready(att) && def.alive && def.state === 'stagger' && inReach(att, def, MOVES.finisher.reach, MOVES.finisher.arcDeg);
}
export function finish(att, def) {
  return canFinish(att, def) ? begin(att, 'finisher', def.id) : false;
}
export function stealthStrike(att, def) {
  if (!ready(att) || !def.alive || def.aware !== false ||
    Math.hypot(att.x - def.x, att.z - def.z) > 1.9 + EPS ||
    !inArc(def.yaw + Math.PI, att.x - def.x, att.z - def.z, 90)) return null;
  const damage = def.kind === 'officer' ? def.hp * .45 : def.hp;
  applyDamage(def, damage, def.posture);
  def.aware = true;
  return result('stealth', damage, 0, def, null, att.id);
}
export function projectileHit(def, {damage = 0, posture = 0, fromYaw, blockable = true} = {}) {
  if (!def.alive) return null;
  if (invulnerable(def)) return result('evaded', 0, 0, def);
  const blocked = def.blocking && blockable && Number.isFinite(fromYaw) &&
    inArc(def.yaw, -Math.sin(fromYaw), -Math.cos(fromYaw), RULES.blockArc);
  const hp = positive(damage) * (blocked ? .4 : 1);
  const po = positive(posture) * (blocked ? .5 : 1);
  (blocked ? blockedDamage : applyDamage)(def, hp, po);
  return result(blocked ? 'blocked' : 'hit', hp, po, def);
}
