// Pure contact observation. Each actor/clip has a cursor and a bounded identity ledger.
export function createContactTracker() { return { actors: [] }; }
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
function invalid(reason) { throw new TypeError(`Invalid foot contacts: ${reason}`); }
function validate(obs, table) {
  if (!object(table)) invalid('table');
  for (const entry of Object.values(table)) {
    if (!object(entry) || !Number.isFinite(entry.duration) || entry.duration <= 0 || entry.loop !== true || !Array.isArray(entry.contacts)) invalid('clip table');
    let previous = -1;
    // 同じ足が1周に何回着いてもよい（村人の歩きは4.2秒に3回）。通知の識別は、表の中の番号（index）で行う。
    for (const c of entry.contacts) {
      if (!object(c) || !['left', 'right'].includes(c.foot) || !Number.isFinite(c.t) || c.t < 0 || c.t >= entry.duration || c.t < previous) invalid('contact table/order');
      previous = c.t;
    }
  }
  if (!object(obs) || typeof obs.actor !== 'string' || !obs.actor || !Array.isArray(obs.sources)) invalid('observation/actor');
  for (const key of ['moving', 'airborne', 'near', 'reset']) if (typeof obs[key] !== 'boolean') invalid(key);
  const clips = new Set();
  for (const s of obs.sources) {
    if (!object(s) || typeof s.clip !== 'string' || !Object.hasOwn(table, s.clip)) invalid('unknown clip');
    if (![s.time, s.weight, s.speed].every(Number.isFinite)) invalid('non-finite source');
    if (s.time < 0 || s.time > table[s.clip].duration || s.weight < 0 || typeof s.target !== 'boolean' || clips.has(s.clip)) invalid('source range/target/duplicate clip');
    if (s.restart !== undefined && typeof s.restart !== 'boolean') invalid('restart');
    clips.add(s.clip);
  }
}

// Returns a new state; caller-owned state, observations and tables are never changed.
export function observeContacts(state, obs, table) {
  validate(obs, table);
  const actors = state.actors.map(a => ({ ...a, clips: a.clips.map(c => ({ ...c, emitted: { ...c.emitted } })) }));
  let actor = actors.find(a => a.actor === obs.actor);
  if (!actor) { actor = { actor: obs.actor, selected: null, clips: [] }; actors.push(actor); }
  const contacts = [];
  // Discard observation cursors, but retain consumed identities across resets/absence.
  if (obs.reset || !obs.near) {
    actor.selected = null;
    for (const c of actor.clips) c.time = null;
  }
  if (!obs.near) return { state: { actors }, contacts };
  let source = null;
  for (const s of obs.sources) {
    if (s.weight > 0 && (!source || s.weight > source.weight || (s.weight === source.weight && s.target && !source.target))) source = s;
  }
  for (const c of actor.clips) if (!obs.sources.some(s => s.clip === c.clip)) c.time = null;
  for (const s of obs.sources) {
    let cursor = actor.clips.find(c => c.clip === s.clip);
    if (!cursor) { cursor = { clip: s.clip, time: null, loop: 0, emitted: {} }; actor.clips.push(cursor); }
    // The caller rewound this action to start a new stride (play()): fresh identities and a new baseline. An unflagged rewind stays silent via the ledger.
    else if (s.restart) { cursor.loop++; cursor.time = null; }
    const duration = table[s.clip].duration;
    const previous = cursor.time === null ? null : cursor.loop * duration + cursor.time;
    // A reverse action is silent and must not turn every backwards tick into a loop.
    if (cursor.time !== null && s.time < cursor.time && s.speed > 0) cursor.loop++;
    const now = cursor.loop * duration + s.time;
    const selected = source === s;
    if (selected && actor.selected === s.clip && previous !== null && obs.moving && !obs.airborne && s.speed > 0) {
      // Include both sides of a wrap; duration itself and next loop's zero are one instant.
      const firstLoop = Math.floor(previous / duration);
      for (let loop = firstLoop; loop <= cursor.loop + (s.time === duration ? 1 : 0); loop++) {
        table[s.clip].contacts.forEach((c, index) => {
          const contactTime = loop * duration + c.t;
          if (contactTime > previous && contactTime <= now && (cursor.emitted[index] ?? -1) < loop) {
            contacts.push({ actor: obs.actor, clip: s.clip, loop, index, foot: c.foot, contactTime, ago: (now - contactTime) / s.speed });
            cursor.emitted[index] = loop;
          }
        });
      }
    }
    cursor.time = s.time;
  }
  actor.selected = source?.clip ?? null;
  return { state: { actors }, contacts };
}
