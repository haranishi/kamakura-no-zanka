import { load, THREE } from './tree-modules.mjs';
export { THREE };
// Field allocation tests only need canvas API compatibility, not pixel rendering.
globalThis.document = { createElement() {
  const c = { width: 0, height: 0 };
  c.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: new Uint8ClampedArray(c.width * c.height * 4).fill(180) }) }, { get: (o, k) => o[k] ?? (() => {}) });
  return c;
} };
export const { TreeField } = await load('tree-view.js');
export const wind = { uTime: { value: 0 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uGuideMix: { value: 0 } };
export const camera = (x = 0, z = 0) => ({ position: { x, z } });
export function data(points = []) {
  const d = Object.fromEntries(['x','y','z','s','rot','kind','tint','species','stage','variant'].map(k => [k, []]));
  for (const p of points) for (const k in d) d[k].push(p[k] ?? ({ s: 1, tint: .43, stage: 128 }[k] ?? 0));
  return d;
}
export const field = (points, opts = {}) => new TreeField({ data: data(points), wind, sunDir: new THREE.Vector3(1,1,1), ...opts });
export const setAt = (f, sp, level, variant = 0) => f.sets.find(s => s.species === sp && s.level === level && s.variant === variant);
