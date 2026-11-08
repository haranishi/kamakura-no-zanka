// W2c-9d: inert contacts -> bounded ripples, ballistic splash and dry dust. No Three/clock/random.
import { prepareFishRivers } from './kamakura-fish.js';
export const WATER_ALPHA = Object.freeze({ shallow: .5, deep: .9, depth: .8 });
export function riverDepthAlpha(edge, depth) {
  return WATER_ALPHA.shallow + (WATER_ALPHA.deep - WATER_ALPHA.shallow) * Math.max(0, 1 - Math.min(1, Math.abs(edge))) * Math.max(0, Math.min(1, depth / WATER_ALPHA.depth));
}
// W2c-9d3: a varying double front, with smooth lifetime fade and elongated footprint.
export function rippleBand(radius) { const t=Math.max(0,Math.min(1,(radius-.08)/1.35)); return .018+.045*Math.sin(Math.PI*t); }
export function rippleWidth(radius, angle=0) { return rippleBand(radius)*(1+.22*Math.sin(angle*3+radius*4)); }
export function rippleAlpha(age, strength=1) { const t=Math.max(0,Math.min(1,age/1.3)); return .5*Math.min(1,strength)*(1-t)*(1-t)*(1+2*t); }
export function rippleSecondary(age) { return .82 + .08*Math.max(0,Math.min(1,age/.3)); }
export function rippleAspect(strength=1) { return 1.08+.08*Math.min(1,strength); }
export function fxOptions(search = '', quality = 'standard') {
  const q = new URLSearchParams(search), light = quality === 'light';
  return { enabled: q.get('fx') !== '0', fish: q.get('fish') !== '0' && q.get('water') !== '0', particles: light ? 96 : 192, rings: light ? 12 : 24, fishLimit: light ? 28 : 56 };
}
export function bindFxContact(hero, fx) {
  const base = hero.onFootContact.bind(hero);
  hero.onFootContact = c => { base(c); fx.contact(c, hero); };
}
export function createFxState({ terrain, rivers = prepareFishRivers(null), particles = 192, rings = 24, seed = 1333, shore2 = true, shore4 = false } = {}) {
  const drops = Array.from({ length: particles }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, water: 0, size: 0, dust: false, mist: false, duration: .7, r: 0, g: 0, b: 0 }));
  const ripples = Array.from({ length: rings }, () => ({ life: 0, age: 0, x: 0, y: 0, z: 0, radius: 0, strength: 0, wake: false, yaw: 0, local: false, vx: 0, vz: 0 }));
  // W2c-10 shore4: large stationary foot rings -> smaller, single downstream ellipses.
  const flows=new Map();
  if(shore4)for(const seg of rivers.segments||[]){
    const drop=terrain.heightAt(seg.ax,seg.az)-terrain.heightAt(seg.ax+seg.dx,seg.az+seg.dz);
    const speed=(drop<0?-1:1)*(.12+Math.min(.9,Math.sqrt(Math.abs(drop)/seg.length)*2.2));
    flows.set(seg,[seg.dx/seg.length*speed,seg.dz/seg.length*speed]);
  }
  let flowRing=null,flowBest=Infinity;
  function nearestFlow(seg){
    const t=Math.max(0,Math.min(1,((flowRing.x-seg.ax)*seg.dx+(flowRing.z-seg.az)*seg.dz)/(seg.length*seg.length)));
    const d=(flowRing.x-seg.ax-seg.dx*t)**2+(flowRing.z-seg.az-seg.dz*t)**2;
    if(d>=flowBest)return;flowBest=d;const v=flows.get(seg);flowRing.vx=v[0];flowRing.vz=v[1];
  }
  let nextIdle=0;
  let capP = particles, capR = rings, pi = 0, ri = 0, time = 0, lastContact = -1, lastX = Infinity, lastZ = Infinity;
  function random() { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t ^= t + Math.imul(t ^ t >>> 7, 61 | t); return ((t ^ t >>> 14) >>> 0) / 4294967296; }
  function ripple(x, y, z, strength = 1, wake = false, yaw = 0, local = false) {
    if (!capR) return;
    // W2c-10b shore5: bounded overlapping foot fronts, fish/landing rings unchanged.
    if(shore4&&local){if(time<nextIdle)return;let live=0;for(let i=0;i<capR;i++)if(ripples[i].local&&ripples[i].life>0)live++;if(live>=3)return;}
    const r = ripples[ri++ % capR]; r.x = x; r.y = y; r.z = z; r.strength = strength; r.wake = wake; r.yaw = yaw; r.life = 1.3; r.age = 0; r.radius = .15;r.local=shore4&&local;r.vx=r.vz=0;
    if(r.local){nextIdle=time+.42;flowRing=r;flowBest=Infinity;rivers.visit?.(x,z,0,nearestFlow);r.yaw=Math.atan2(-r.vx,-r.vz);r.strength*=.65;}
  }
  // W2c-9d4: tiny flecks -> 32 drops reaching 0.3–0.7m and 0.5–0.9m mist.
  function splash(x, y, z, running) {
    if (!capP) return;
    for (let n = 0, count = running ? 32 : 19; n < count; n++) {
      const p = drops[pi++ % capP], a = random() * Math.PI * 2, speed = (.15 + random() * .45) * (running ? 1.8 : 1);
      p.x = x; p.y = y + .015; p.z = z; p.vx = Math.sin(a) * speed; p.vz = Math.cos(a) * speed; p.vy = Math.sqrt(14 * (.3 + random() * .4)) * (running ? 1 : .6); p.water = y; p.dust = false; p.mist = false; p.duration = 1; p.size = (.02 + random() * .03) * (running ? 1 : .6); p.life = 1; p.age = 0;
      const white = random(); p.r = .624 + white * .264; p.g = .768 + white * .17; p.b = .823 + white * .133;
    }
    for (let n=0;n<(running?4:2);n++) {
      const p=drops[pi++ % capP],a=random()*Math.PI*2;
      p.x=x; p.y=y+.03; p.z=z; p.vx=Math.sin(a)*.18; p.vz=Math.cos(a)*.18; p.vy=.15+random()*.1;
      p.water=y; p.dust=false; p.mist=true; p.size=(.5+random()*.4)*(running?1:.6); p.duration=.4+random()*.2; p.life=p.duration; p.age=0; p.r=.888; p.g=.939; p.b=.956;
    }
  }
  function dust(pos, n = 1) {
    if (!capP || terrain.waterAt(pos.x, pos.z) > .05) return;
    const s = terrain.surfaceAt?.(pos.x, pos.z);
    if (s && (s.grass > .5 || s.mud > .5 || s.litter > .5 || s.rock > .5)) return;
    const color = terrain.groundColorAt?.(pos.x, pos.z);
    for (let i = 0, count = Math.min(12, Math.max(5, Math.round(n * 8))); i < count; i++) {
      const p = drops[pi++ % capP], a = random() * Math.PI * 2;
      p.x = pos.x; p.y = pos.y + .04; p.z = pos.z; p.vx = Math.sin(a) * .35; p.vz = Math.cos(a) * .35; p.vy = .18 + random() * .25; p.dust = true; p.mist = false; p.duration = .9; p.size = .09 + random() * .08; p.life = .9; p.age = 0;
      p.r = (color?.[0] ?? .32) * .65 + .22; p.g = (color?.[1] ?? .27) * .65 + .22; p.b = (color?.[2] ?? .18) * .65 + .22;
    }
  }
  return { drops, ripples, api: { dust }, ripple,
    setLimits(p, r) { capP = Math.min(particles, p); capR = Math.min(rings, r); for (let i = capP; i < particles; i++) drops[i].life = 0; for (let i = capR; i < rings; i++) ripples[i].life = 0; },
    contact(c, hero) {
      const pos = hero.pos, wet = terrain.waterAt(pos.x, pos.z); if (wet <= .05 || (!shore4 && wet >= .46)) return;
      const water = rivers.sampleAt(pos.x, pos.z); if (!water.valid) return; // river only, never sea
      const run = hero.stepGait === 'run', yaw = hero.yaw || 0, side = c.foot === 'L' || c.foot === 'left' ? -.12 : .12;
      const x = pos.x + Math.cos(yaw) * side, z = pos.z - Math.sin(yaw) * side;
      ripple(x, water.y + .015, z, run ? 1 : .55, false, yaw, true); splash(x, water.y, z, run);
      if (!shore4 && time - lastContact < .85 && Math.hypot(pos.x - lastX, pos.z - lastZ) > .12) ripple(pos.x, water.y + .018, pos.z, run ? .9 : .5, true, yaw);
      lastContact = time; lastX = pos.x; lastZ = pos.z;
    },
    update(dt, hero) {
      dt = Math.max(0, dt); time += dt;
      // W2c-9r1 shore: contact-only effects -> gentle standing rings around submerged legs.
      if(shore2&&hero&&dt>0&&capR&&time>=nextIdle){
        if(!shore4)nextIdle=time+.65;
        const pos=hero.pos,wet=terrain.waterAt(pos.x,pos.z);
        if(wet>.05&&(shore4||wet<.46)){const water=rivers.sampleAt(pos.x,pos.z);if(water.valid)ripple(pos.x,water.y+.025,pos.z,shore4?.6:.28,false,hero.yaw||0,true);else if(shore4)nextIdle=time+.42;}else if(shore4)nextIdle=time+.42;
      }
      for (let i = 0; i < capR; i++) { const r = ripples[i]; if (r.life <= 0) continue; r.age += dt; r.life = Math.max(0, 1.3 - r.age); r.radius = (r.strength < .2 ? .03 : .15) + r.age / 1.3 * (r.strength < .2 ? .12 : r.strength > .8 ? 1.65 : 1.25); if(r.local){r.radius=.3+.25*r.age/1.3;r.x+=r.vx*dt;r.z+=r.vz*dt;} }
      for (let i = 0; i < capP; i++) {
        const p = drops[i]; if (p.life <= 0) continue; const gravity = p.dust ? -.12 : p.mist ? 0 : 7;
        p.age += dt; p.life = Math.max(0, p.duration - p.age);
        p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt - .5 * gravity * dt * dt; p.vy -= gravity * dt;
        if (!p.dust && !p.mist && p.y < p.water) { p.y = p.water; p.life = 0;
          ripple(p.x,p.water+.012,p.z,.12);
        }
      }
    } };
}
