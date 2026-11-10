// Pure development camera rules. x=east, y=up, z=south; positive pitch looks down.
import { pointDeparture } from './kamakura-spawn.js';
export const FLY = Object.freeze({ speed: 80, minSpeed: 5, maxSpeed: 2000, maxHeight: 12000, topHeight: 7500, distance: 14000, builds: 8 });
const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const flyOption = search => { const v = new URLSearchParams(search).get('fly'); return v === '1' ? 'fly' : v === 'top' ? 'top' : 'walk'; };
export const flySpeed = (speed, steps) => clamp(speed * 1.25 ** clamp(steps, -100, 100), FLY.minSpeed, FLY.maxSpeed);
// &cam=east,north,height,bearing,pitch[,fov]: a fixed fly pose for repeatable wide shots (with &fly=1).
// Metres and degrees. Height is above sea level, bearing is a compass bearing, positive pitch looks down.
// &cam=overlook needs no numbers: it looks back up the avenue from above the sea, on the line through two named places.
export const OVERLOOK = Object.freeze({ far: 'tsurugaoka', near: 'wakamiya_oji', back: 2300, height: 700, pitch: 22, fov: 40 });
export function overlookPose(places, view = OVERLOOK) {
  const a = places?.find?.(p => p.id === view.far), b = places?.find?.(p => p.id === view.near);
  if (!a || !b) return null;
  const east = b.x - a.x, north = b.y - a.y, length = Math.hypot(east, north);
  if (!(length >= 1)) return null;
  return { pos: { x: b.x + east / length * view.back, y: view.height, z: -(b.y + north / length * view.back) },
    yaw: -Math.atan2(-east, -north), pitch: view.pitch * Math.PI / 180, fov: view.fov };
}
export function camOption(search, places) {
  const v = new URLSearchParams(search).get('cam'); if (!v) return null;
  if (v === 'overlook') return overlookPose(places);
  const n = v.split(',').map(s => s.trim() === '' ? NaN : Number(s));
  if (n.length < 5 || n.length > 6 || n.some(x => !Number.isFinite(x))) return null;
  return { pos: { x: n[0], y: clamp(n[2], -100, FLY.maxHeight), z: -n[1] }, yaw: -n[3] * Math.PI / 180,
    pitch: clamp(n[4], -89, 89) * Math.PI / 180, fov: n.length === 6 ? clamp(n[5], 8, 90) : null };
}
export function topPose(bounds) {
  return { pos: { x: (bounds.minX + bounds.maxX) / 2, y: FLY.topHeight, z: (bounds.minZ + bounds.maxZ) / 2 }, yaw: 0, pitch: Math.PI / 2 };
}
// Fit the entire frame at a fixed altitude, including narrow portrait screens.
export function topFov(bounds, aspect, surfaceHeight = 0) {
  const half = Math.max((bounds.maxZ - bounds.minZ) / 2, (bounds.maxX - bounds.minX) / (2 * aspect));
  return 2 * Math.atan(half * 1.04 / Math.max(1, FLY.topHeight - surfaceHeight)) * 180 / Math.PI;
}
export function flyLanding(terrain, pose) {
  const p = pointDeparture(terrain, new URLSearchParams({ pos: `${pose.pos.x},${-pose.pos.z}`, yaw: `${-pose.yaw * 180 / Math.PI}` }), 80);
  return p ? { ...p, y: terrain.heightAt(p.x, p.z) } : null;
}
export function createFly(search, terrain, spawn) {
  const mode = flyOption(search);
  const cam = mode === 'fly' ? camOption(search, terrain.meta?.places) : null;
  const pose = cam
    ? { pos: { x: cam.pos.x, y: Math.max(cam.pos.y, terrain.heightAt(cam.pos.x, cam.pos.z) + 2), z: cam.pos.z }, yaw: cam.yaw, pitch: cam.pitch }
    : { pos: { x: spawn.x, y: terrain.heightAt(spawn.x, spawn.z) + 900, z: spawn.z }, yaw: -Math.PI / 4, pitch: 35 * Math.PI / 180 };
  return { mode, pose: mode === 'top' ? topPose(terrain.bounds) : pose, speed: FLY.speed, returnPose: mode === 'top' ? pose : null, fov: cam?.fov ?? null };
}
export function flyAction(state, action, terrain, eye) {
  if (action === 'F') return { ...state, mode: state.mode === 'walk' ? 'fly' : 'walk', pose: state.mode === 'walk' ? { ...eye, pos: { ...eye.pos } } : state.pose, returnPose: null };
  if (action === 'R') return { ...state, speed: FLY.speed };
  if (action === 'M') return state.mode === 'top'
    ? { ...state, mode: 'fly', pose: state.returnPose, returnPose: null }
    : { ...state, mode: 'top', returnPose: state.mode === 'walk' ? { ...eye, pos: { ...eye.pos } } : state.pose, pose: topPose(terrain.bounds) };
  if (action === 'G' && state.mode !== 'walk') {
    const landing = flyLanding(terrain, state.pose);
    return landing ? { ...state, mode: 'walk', landing, returnPose: null } : { ...state, landing: null };
  }
  return state;
}
export function stepFly(state, input, dt, heightAt) {
  if (state.mode === 'walk') return state;
  const speed = input.reset ? FLY.speed : flySpeed(state.speed, input.speedSteps || 0);
  if (state.mode === 'top') return { ...state, speed };
  const old = state.pose, yaw = old.yaw - (input.dx || 0) * .0024;
  const pitch = clamp(old.pitch + (input.dy || 0) * .0024, -89 * Math.PI / 180, 89 * Math.PI / 180);
  const f = input.forward || 0, r = input.right || 0, u = input.up || 0;
  let x = -Math.sin(yaw) * Math.cos(pitch) * f + Math.cos(yaw) * r;
  let y = -Math.sin(pitch) * f + u, z = -Math.cos(yaw) * Math.cos(pitch) * f - Math.sin(yaw) * r;
  const length = Math.max(1, Math.hypot(x, y, z)), distance = speed * (input.boost ? 5 : 1) * Math.max(0, dt);
  x = old.pos.x + x / length * distance; y = old.pos.y + y / length * distance; z = old.pos.z + z / length * distance;
  return { ...state, speed, pose: { pos: { x, y: clamp(y, heightAt(x, z) + 2, FLY.maxHeight), z }, yaw, pitch } };
}
