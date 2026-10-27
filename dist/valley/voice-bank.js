// Pure bundle scheduler. Times are monotonic milliseconds supplied by the caller.
export const PRIORITY = Object.freeze({ otherStep: 0, heroStep: 1, otherCombat: 2, heroCombat: 3, ui: 4 });
export const VOICE_LIMIT = 28;
export const AMBIENT_KINDS = Object.freeze(['canopy', 'wind', 'river', 'insects', 'crow', 'fire', 'village']);
function integer(n, min, max) { if (!Number.isInteger(n) || n < min || n > max) throw new TypeError('Invalid voice count/priority'); return n; }
function time(bank, now) { if (!Number.isFinite(now) || now < bank.now) throw new TypeError('Invalid/non-monotonic voice time'); }
export function createVoiceBank({ limit = VOICE_LIMIT, waitLimit = VOICE_LIMIT, fadeMs = 10 } = {}) {
  integer(limit, 1, VOICE_LIMIT); integer(waitLimit, 0, VOICE_LIMIT);
  if (!Number.isFinite(fadeMs) || fadeMs <= 0) throw new TypeError('Invalid voice fade');
  return { limit, waitLimit, fadeMs, now: -Number.MAX_VALUE, sequence: 0, active: [], pending: [], ambient: [], requested: 0, started: 0, rejected: 0, stolen: 0 };
}
export function stats(bank) { return { requested: bank.requested, started: bank.started, rejected: bank.rejected, stolen: bank.stolen, active: bank.active.length, pending: bank.pending.length, ambient: bank.ambient.length }; }
// Return commands for the adapter; retain no source, node, callback, or external object.
export function tick(bank, now) {
  time(bank, now);
  const events = [];
  while (true) {
    const stop = bank.active.filter(v => v.fadeEnd !== null && v.fadeEnd <= now).sort((a, b) => a.fadeEnd - b.fadeEnd || a.order - b.order)[0];
    const start = bank.pending.filter(v => v.startAt <= now).sort((a, b) => a.startAt - b.startAt || a.order - b.order)[0];
    if (!stop && !start) break;
    if (stop && (!start || stop.fadeEnd <= start.startAt)) {
      bank.active.splice(bank.active.indexOf(stop), 1); events.push({ action: 'stop', id: stop.id, at: stop.fadeEnd });
    } else {
      bank.pending.splice(bank.pending.indexOf(start), 1); bank.active.push(start);
      events.push({ action: 'start', id: start.id, at: start.startAt });
      if (start.fadeEnd !== null) events.push({ action: 'fade', id: start.id, at: start.startAt, end: start.fadeEnd });
    }
  }
  bank.now = now;
  return events;
}
export function request(bank, { id, priority, kind, now, ambient = false, children = 1 }) {
  time(bank, now); integer(priority, 0, 4); integer(children, 1, Number.MAX_SAFE_INTEGER);
  if (typeof id !== 'string' || !id || typeof kind !== 'string' || !kind) throw new TypeError('Invalid voice identity');
  if ([...bank.active, ...bank.pending, ...bank.ambient].some(v => v.id === id)) throw new TypeError('Duplicate voice id');
  if (ambient && !AMBIENT_KINDS.includes(kind)) throw new TypeError('Unknown ambient voice');
  const events = tick(bank, now);
  bank.requested++;
  const reject = () => { bank.rejected++; return { accepted: false, action: 'reject', events }; };
  const voice = { id, priority, kind, order: bank.sequence++, startAt: now, fadeEnd: null, children, tailDone: false, slot: null };
  const usedSlots = new Set([...bank.active, ...bank.pending].map(v => v.slot));
  if (ambient) {
    if (bank.ambient.some(v => v.kind === kind)) return reject();
    bank.ambient.push(voice);
  } else if (usedSlots.size < bank.limit) {
    voice.slot = Array.from({ length: bank.limit }, (_, i) => i).find(i => !usedSlots.has(i));
    bank.active.push(voice);
  } else {
    if (bank.pending.length >= bank.waitLimit) return reject();
    // Prefer the oldest eligible active bundle. A fading bundle already owns a reservation.
    const candidates = bank.active.filter(v => v.fadeEnd === null && v.priority <= priority).sort((a, b) => a.startAt - b.startAt || a.order - b.order);
    let victim = candidates[0];
    const action = victim ? 'steal' : 'wait';
    // A queued bundle can itself yield after it starts, giving every success a fixed start time.
    if (!victim) victim = bank.pending.filter(v => v.fadeEnd === null && v.priority <= priority).sort((a, b) => a.startAt - b.startAt || a.order - b.order)[0];
    if (!victim) return reject();
    victim.fadeEnd = Math.max(now, victim.startAt) + bank.fadeMs;
    voice.startAt = victim.fadeEnd; voice.slot = victim.slot;
    if (action === 'steal') events.push({ action: 'fade', id: victim.id, at: now, end: victim.fadeEnd });
    bank.pending.push(voice); bank.stolen++; bank.started++;
    return { accepted: true, action, startAt: voice.startAt, victim: victim.id, events };
  }
  bank.started++;
  events.push({ action: 'start', id, at: now });
  return { accepted: true, action: 'start', startAt: now, events };
}
// Adapter calls release only after all children AND the resonance tail have finished.
// Pending cancellation keeps successors' reserved times; they never start early.
export function release(bank, id) {
  for (const key of ['active', 'pending', 'ambient']) {
    const i = bank[key].findIndex(v => v.id === id);
    if (i >= 0) { bank[key].splice(i, 1); return true; }
  }
  return false;
}
export function endChild(bank, id) {
  const v = [...bank.active, ...bank.ambient].find(v => v.id === id);
  if (!v) return false;
  v.children = Math.max(0, v.children - 1);
  return v.children === 0 && v.tailDone ? release(bank, id) : false;
}
export function endTail(bank, id) {
  const v = [...bank.active, ...bank.ambient].find(v => v.id === id);
  if (!v) return false;
  v.tailDone = true;
  return v.children === 0 ? release(bank, id) : false;
}
export function clear(bank) {
  const ids = [...bank.active, ...bank.pending, ...bank.ambient].map(v => v.id);
  bank.active = []; bank.pending = []; bank.ambient = [];
  return ids;
}
