const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
const pos = p => ({x: finite(p?.x), z: finite(p?.z)});
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const yawTo = (a, b) => Math.atan2(-(b.x - a.x), -(b.z - a.z)) || 0;
const idle = () => ({move: null, speed: 'stop', face: null, startMove: null, block: false, dodge: false, say: null});

function random(brain) {
  brain.seed = (brain.seed + 0x6D2B79F5) >>> 0;
  brain.randomCounter++;
  let n = brain.seed;
  n = Math.imul(n ^ n >>> 15, n | 1);
  n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}

export function createBrain(kind, {id, home, patrol = [], seed = 1, exit} = {}) {
  if (!['soldier', 'archer', 'officer'].includes(kind)) throw new TypeError('Unknown enemy kind');
  return {
    id, kind, home: pos(home), position: pos(home), exit: exit ? pos(exit) : null,
    patrol: patrol.map(pos), patrolIndex: 0, state: 'patrol', awareness: 0,
    lastSeen: null, searchTimer: 0, morale: 100, isolated: false,
    seed: finite(seed, 1) >>> 0, randomCounter: 0, allyAlert: null,
    orbitTimer: 0, orbitDirection: 1, orbitRadius: null, aimTimer: 0,
    tokenHeld: false, attackObserved: false, combo: 0, comboTimer: 0,
    rallied: false, departed: false, heard: false, noiseKeys: [],
  };
}

export function hear(brain, noise) {
  if (['retreat', 'surrendered'].includes(brain.state)) return;
  if (!Number.isFinite(noise?.radius) || noise.radius < 0 ||
      !Number.isFinite(noise.x) || !Number.isFinite(noise.z)) return;
  if (distance(brain.position, noise) > noise.radius) return;
  brain.awareness = clamp(brain.awareness + 0.5, 0, 1);
  brain.lastSeen = pos(noise); brain.heard = true;
}

export function adjustMorale(brain, delta, reason) {
  brain.morale = clamp(brain.morale + finite(delta), 0, 100);
  brain.moraleReason = typeof reason === 'string' ? reason : null;
}

export function alertFromAlly(brain, location) {
  if (brain.allyAlert || ['combat', 'retreat', 'surrendered'].includes(brain.state)) return;
  brain.allyAlert = {remaining: 0.6 + random(brain) * 0.6, point: pos(location)};
}

function release(brain, tokens) {
  if (brain.tokenHeld) tokens.release(brain.id);
  brain.tokenHeld = false;
  brain.attackObserved = false;
}

function moveTo(intent, self, goal, world, speed) {
  if (!goal || distance(self, goal) < 0.1) return false;
  const path = world.pathTo(self, goal);
  if (!Array.isArray(path) || !path.length) return false;
  const next = path.find(p => Number.isFinite(p.x) && Number.isFinite(p.z) && distance(self, p) > 0.1);
  if (!next || !world.walkable(next.x, next.z)) return false;
  intent.move = pos(next); intent.speed = speed; intent.face = yawTo(self, next);
  return true;
}

function senses(brain, view, dt, events) {
  const {self, hero, world} = view;
  for (const noise of view.noises || []) {
    const key = JSON.stringify([noise.t, noise.kind, noise.x, noise.z, noise.radius]);
    if (brain.noiseKeys.includes(key)) continue;
    brain.noiseKeys.push(key);
    if (brain.noiseKeys.length > 128) brain.noiseKeys.shift();
    hear(brain, noise);
  }
  const heard = brain.heard;
  brain.heard = false;
  let confirmedByAlly = false;
  if (brain.allyAlert) {
    brain.allyAlert.remaining -= dt;
    if (brain.allyAlert.remaining <= 1e-10) {
      brain.lastSeen = brain.allyAlert.point;
      brain.awareness = Math.max(0.35, brain.awareness);
      brain.allyAlert = null; confirmedByAlly = true;
    }
  }
  const d = distance(self, hero);
  const forward = d > 0 ? (-(hero.x - self.x) * Math.sin(self.yaw) - (hero.z - self.z) * Math.cos(self.yaw)) / d : 1;
  const range = 20 * (hero.crouching ? 0.5 : 1) * (hero.inTallGrass ? 0.5 : 1);
  const alive = hero.alive !== false && hero.hp > 0;
  const visible = alive && d <= range && forward >= Math.cos(55 * Math.PI / 180) && world.los(self, hero);
  const nearby = alive && d <= 3 && forward >= 0 && forward < Math.cos(55 * Math.PI / 180);
  const tracking = brain.state === 'combat' && alive && world.los(self, hero);
  if (tracking) brain.lastSeen = pos(hero);
  if (visible || nearby) {
    const duration = 0.9 + clamp((d - 5) / 15, 0, 1) * 0.6;
    brain.awareness = clamp(brain.awareness + dt * (visible ? 1 / duration : 0.4), 0, 1);
    brain.lastSeen = pos(hero);
  } else if (!confirmedByAlly && !heard) brain.awareness = clamp(brain.awareness - dt * 0.4, 0, 1);

  if (brain.awareness >= 1 - 1e-10 && brain.state !== 'combat') {
    brain.awareness = 1; brain.state = 'combat'; brain.searchTimer = 0;
    events.push({type: 'alerted', id: brain.id, ...brain.lastSeen});
  } else if (confirmedByAlly && brain.state !== 'combat') {
    if (brain.state === 'patrol') events.push({type: 'suspicious', id: brain.id, ...brain.lastSeen});
    brain.state = 'search'; brain.searchTimer = 0;
  } else if (brain.state === 'patrol' && brain.awareness >= 0.35) {
    brain.state = 'suspicious';
    events.push({type: 'suspicious', id: brain.id, ...brain.lastSeen});
  }
  if (brain.state === 'combat' && !visible && !nearby && !tracking) {
    brain.state = 'search'; brain.searchTimer = 0;
  } else if (brain.state === 'suspicious' && (!visible || (brain.lastSeen && distance(self, brain.lastSeen) < 0.5))) {
    brain.state = 'search'; brain.searchTimer = 0;
  }
  if (brain.state === 'search') {
    brain.searchTimer = visible || nearby ? 0 : brain.searchTimer + dt;
    if (brain.searchTimer >= 5) {
      brain.state = 'patrol'; brain.awareness = 0; brain.lastSeen = null; brain.searchTimer = 0;
    }
  }
  return {visible, d};
}

function retreat(brain, view, intent, events) {
  const {self, hero, world} = view;
  if (brain.departed) return;
  if (brain.exit && distance(self, brain.exit) <= 0.6) { brain.departed = true; return; }
  const escaped = brain.exit && moveTo(intent, self, brain.exit, world, 'run');
  // 出口への道を主人公が塞ぐ場合、開けた場所なら横へ逃がす。
  const trapped = escaped && distance(self, hero) <= 3 &&
    (intent.move.x - self.x) * (hero.x - self.x) + (intent.move.z - self.z) * (hero.z - self.z) > 0;
  if (trapped) {
    const d = distance(self, hero), ux = d ? (hero.x - self.x) / d : 1, uz = d ? (hero.z - self.z) / d : 0;
    for (const side of [1, -1]) {
      const goal = {x: self.x - uz * side * 3, z: self.z + ux * side * 3};
      const lateral = idle();
      if (world.walkable(goal.x, goal.z) && moveTo(lateral, self, goal, world, 'run') &&
          (lateral.move.x - self.x) * ux + (lateral.move.z - self.z) * uz <= 0.1) {
        Object.assign(intent, lateral); return;
      }
    }
  }
  if (!escaped || trapped) {
    Object.assign(intent, idle()); brain.state = 'surrendered';
    events.push({type: 'surrendered', id: brain.id});
  }
}

function orbit(brain, view, intent, dt) {
  brain.orbitTimer += dt;
  if (brain.orbitRadius === null) {
    brain.orbitRadius = 2.5 + random(brain) * 1.5;
    brain.orbitDirection = random(brain) < 0.5 ? -1 : 1;
  }
  if (brain.orbitTimer >= 10) {
    if (Math.floor(brain.orbitTimer / 10) % 2) brain.orbitDirection *= -1;
    brain.orbitTimer %= 10;
  }
  const {self, hero, world} = view;
  const angle = Math.atan2(self.z - hero.z, self.x - hero.x) + brain.orbitDirection * 0.45;
  const goal = {x: hero.x + Math.cos(angle) * brain.orbitRadius, z: hero.z + Math.sin(angle) * brain.orbitRadius};
  moveTo(intent, self, goal, world, 'walk');
  intent.face = yawTo(self, hero);
}

function combat(brain, view, intent, dt, d) {
  const {self, hero, world, tokens} = view;
  intent.face = yawTo(self, hero);
  if (brain.kind === 'archer') {
    if (d < 6 || d > 24) {
      brain.aimTimer = 0;
      const ux = d > 0 ? (self.x - hero.x) / d : 1;
      const uz = d > 0 ? (self.z - hero.z) / d : 0;
      const goal = d < 6 ? {x: hero.x + ux * 8 - uz * 3, z: hero.z + uz * 8 + ux * 3} :
        {x: hero.x + ux * 20, z: hero.z + uz * 20};
      moveTo(intent, self, goal, world, 'run');
      intent.face = yawTo(self, hero);
    } else if (self.ready && world.los(self, hero)) {
      brain.aimTimer += dt;
      if (brain.aimTimer >= 1 - 1e-10) { intent.startMove = 'archer_shot'; brain.aimTimer = 0; }
    } else brain.aimTimer = 0;
    return;
  }
  if (brain.tokenHeld && self.state === 'attack') brain.attackObserved = true;
  if (brain.tokenHeld && self.state === 'attack' && !self.ready) return;
  if (brain.tokenHeld && self.state !== 'attack') release(brain, tokens);
  if (!self.ready) return;
  // combatをimportせず、斬り1.7m・突き2.6mの間合いから安全幅0.3mを取る。
  const reach = brain.kind === 'officer' ? 2.0 : d >= 2 ? 2.3 : 1.4;
  if (d <= 4 && !brain.tokenHeld) {
    if (!tokens.tryAcquire(brain.id)) { orbit(brain, view, intent, dt); return; }
    brain.tokenHeld = true;
  }
  if (d > reach) {
    release(brain, tokens);
    const goal = {x: hero.x + (self.x - hero.x) / d * reach * 0.9, z: hero.z + (self.z - hero.z) / d * reach * 0.9};
    moveTo(intent, self, goal, world, 'run'); return;
  }
  if (!brain.tokenHeld && !tokens.tryAcquire(brain.id)) { orbit(brain, view, intent, dt); return; }
  brain.tokenHeld = true;
  if (brain.kind === 'officer') {
    intent.startMove = ['officer_a', 'officer_b', 'officer_c'][brain.combo];
    brain.combo = (brain.combo + 1) % 3; brain.comboTimer = 0;
  } else intent.startMove = d >= 2 || random(brain) < 0.3 ? 'soldier_thrust' : 'soldier_slash';
}

export function think(brain, view, dt) {
  dt = Math.max(0, finite(dt));
  const intent = idle(), events = [], {self, hero, tokens} = view;
  brain.position = pos(self);
  if (self.alive === false || self.hp <= 0 || brain.state === 'surrendered' || brain.departed) {
    release(brain, tokens); return {intent, events};
  }
  if (brain.state === 'retreat') { retreat(brain, view, intent, events); return {intent, events}; }

  const moraleWasLow = brain.morale < 30;
  const alliesNearby = (view.allies || []).some(a => a.id !== self.id && a.alive !== false && a.hp > 0 && distance(self, a) <= 10);
  if (!alliesNearby && !brain.isolated) { adjustMorale(brain, -10, 'isolated'); brain.isolated = true; }
  if (alliesNearby) adjustMorale(brain, dt, 'allies');
  if (brain.kind === 'officer' && self.hp <= self.hpMax * 0.5 && !brain.rallied) {
    brain.rallied = true; intent.say = 'rally';
    events.push({type: 'shout', id: brain.id, radius: 14, ...pos(self)});
  }
  const leaderFled = brain.kind === 'officer' && self.hp <= self.hpMax * 0.25;
  if (moraleWasLow || brain.morale < 30 || leaderFled) {
    brain.state = 'retreat'; release(brain, tokens);
    events.push({type: leaderFled ? 'leader_fled' : 'routed', id: brain.id});
    retreat(brain, view, intent, events); return {intent, events};
  }

  const {d} = senses(brain, view, dt, events);
  const interrupted = ['hit', 'stagger', 'recoil', 'down', 'dodge'].includes(self.state);
  brain.comboTimer += self.state === 'attack' ? 0 : dt;
  if (interrupted || brain.comboTimer > 1.2 || brain.state !== 'combat') brain.combo = 0;
  if (brain.state !== 'combat' || interrupted) { release(brain, tokens); brain.aimTimer = 0; }
  if (interrupted) return {intent, events};
  if (brain.state === 'combat') combat(brain, view, intent, dt, d);
  else if (brain.state === 'search' || brain.state === 'suspicious') {
    if (brain.lastSeen) {
      moveTo(intent, self, brain.lastSeen, view.world, 'walk');
      intent.face = yawTo(self, brain.lastSeen);
    }
  } else {
    const goal = brain.patrol.length ? brain.patrol[brain.patrolIndex] : brain.home;
    if (distance(self, goal) < 0.5 && brain.patrol.length) brain.patrolIndex = (brain.patrolIndex + 1) % brain.patrol.length;
    moveTo(intent, self, brain.patrol.length ? brain.patrol[brain.patrolIndex] : goal, view.world, 'walk');
  }
  return {intent, events};
}
