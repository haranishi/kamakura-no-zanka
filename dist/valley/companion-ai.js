const modes = ['follow', 'hold', 'cover', 'retreat'];
const finite = n => typeof n === 'number' && Number.isFinite(n);
const point = p => p && finite(p.x) && finite(p.z) && Math.abs(p.x) <= 1e9 && Math.abs(p.z) <= 1e9;
const countdown = (remaining, dt) => Math.max(0, remaining - dt) < 1e-9 ? 0 : remaining - dt;
const distance = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
export function createCompanion({ id, mode = 'follow', holdPoint } = {}) {
  const c = { id, mode: 'follow', holdPoint: null, state: 'ready', retryIn: 0, shotIn: 0, safeTime: 0 };
  setMode(c, mode, holdPoint);
  return c;
}
export function setMode(c, mode, p) {
  if (!modes.includes(mode)) return false;
  c.mode = mode;
  if (point(p)) c.holdPoint = { x: p.x, z: p.z };
  c.retryIn = 0;
  if (c.state !== 'down') c.state = 'ready';
  return true;
}
export function thinkCompanion(c, view, dt) {
  const intent = { move: null, speed: 'stop', face: null, shoot: null, startMove: null, say: null, block: false, dodge: false };
  const events = [];
  const { self, hero, world = {} } = view;
  const elapsed = finite(dt) && dt > 0 ? Math.min(dt, 1000) : 0;
  if (!point(self) || !point(hero)) return { intent, events };
  const enemies = (view.enemies || []).filter(e => point(e) && e.alive !== false && e.hp > 0 && !['routed', 'surrendered'].includes(e.state));
  c.shotIn = countdown(c.shotIn, elapsed);
  // 倒れた仲間は戦闘側の死亡状態からも救い、復帰を同じスナップショットへ返す。
  if (self.hp <= 0 || c.state === 'down') {
    self.alive = true;
    self.state = 'down';
    if (c.state !== 'down') {
      c.state = 'down'; c.safeTime = 0;
      events.push({ type: 'down', id: c.id });
    }
    if (!enemies.some(e => distance(e, self) <= 8)) c.safeTime = Math.min(8, c.safeTime + elapsed);
    if (c.safeTime >= 8 - 1e-9) {
      self.hp = (finite(self.hpMax) && self.hpMax > 0 ? self.hpMax : 100) * 0.3;
      self.state = 'idle'; c.state = 'ready'; c.safeTime = 0;
      events.push({ type: 'recovered', id: c.id });
    }
    return { intent, events };
  }
  c.retryIn = countdown(c.retryIn, elapsed);
  const yaw = finite(hero.yaw) ? hero.yaw : 0;
  const forward = { x: -Math.sin(yaw), z: -Math.cos(yaw) };
  const left = { x: -Math.cos(yaw), z: Math.sin(yaw) };
  const rear = c.mode === 'cover' ? 6.5 : 3.25;
  let goal = c.mode === 'hold' || c.mode === 'retreat' ? c.holdPoint : {
    x: hero.x - forward.x * rear + left.x, z: hero.z - forward.z * rear + left.z,
  };
  // 脇の通れない細道では後方の中心へ寄せる。
  if (point(goal) && world.walkable && !world.walkable(goal.x, goal.z) && ['follow', 'cover'].includes(c.mode)) {
    goal = { x: hero.x - forward.x * rear, z: hero.z - forward.z * rear };
  }
  if (point(goal) && distance(self, goal) > 0.35 && c.retryIn === 0) {
    const path = world.pathTo ? world.pathTo(self, goal) : null;
    const next = Array.isArray(path) ? path.find(p => point(p) && distance(self, p) > 0.05) : null;
    if (!next) {
      c.state = 'repath'; c.retryIn = 2; intent.say = '道を探す';
    } else {
      let dx = next.x - self.x, dz = next.z - self.z;
      const length = Math.hypot(dx, dz);
      dx /= length; dz /= length;
      const ahead = (self.x - hero.x) * forward.x + (self.z - hero.z) * forward.z;
      const along = dx * forward.x + dz * forward.z;
      // 経路が主人公の前へ回り込む場合も、後方の半平面から出ない。
      if (!['follow', 'cover'].includes(c.mode) || along <= 0 || ahead + along * elapsed * 2.1 <= -0.5) {
        intent.move = { x: dx, z: dz }; intent.speed = 'walk';
        intent.face = Math.atan2(-dx, -dz);
      }
      c.state = 'ready';
    }
  }
  if (['follow', 'cover'].includes(c.mode) && c.shotIn === 0 && self.ready === true) {
    const target = enemies.filter(e => distance(self, e) <= 24 && world.los?.(self, e) === true)
      .sort((a, b) => distance(self, a) - distance(self, b) || String(a.id).localeCompare(String(b.id)))[0];
    if (target) {
      intent.shoot = { targetId: target.id }; intent.startMove = 'ally_shot';
      intent.face = Math.atan2(self.x - target.x, self.z - target.z);
      c.shotIn = 2.4; events.push({ type: 'shot', id: c.id });
    }
  }
  return { intent, events };
}
