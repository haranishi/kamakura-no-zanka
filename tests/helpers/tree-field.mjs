import { load, THREE } from './tree-modules.mjs';
export { THREE };
// Field allocation tests only need canvas API compatibility, not pixel rendering.
globalThis.document = { createElement() {
  const c = { width: 0, height: 0 };
  c.getContext = () => new Proxy({ createLinearGradient: () => ({ addColorStop() {} }), getImageData: () => ({ data: new Uint8ClampedArray(c.width * c.height * 4).fill(180) }) }, { get: (o, k) => o[k] ?? (() => {}) });
  return c;
} };
export const { TreeField, treeShape } = await load('tree-view.js');
export const wind = { uTime: { value: 0 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uGuideMix: { value: 0 } };
export const camera = (x = 0, z = 0) => ({ position: { x, z } });
export function data(points = []) {
  const d = Object.fromEntries(['x','y','z','s','rot','kind','tint','species','stage','variant'].map(k => [k, []]));
  for (const p of points) for (const k in d) d[k].push(p[k] ?? ({ s: 1, tint: .43, stage: 128 }[k] ?? 0));
  return d;
}
export const field = (points, opts = {}) => new TreeField({ data: data(points), wind, sunDir: new THREE.Vector3(1,1,1), ...opts });
export const setAt = (f, sp, level, variant = 0) => f.sets.find(s => s.species === sp && s.level === level && s.variant === variant);

// A recording stand-in for WebGLRenderer: the far boards bake through it in Node (no GPU, the atlases stay blank).
// fail=true makes render throw, as a lost context would, so the field must fall back to its far meshes.
export function stubRenderer({ fail = false } = {}) {
  const state = { target: 'screen', color: new THREE.Color(0x123456), alpha: .25, autoClear: false }, calls = [];
  return { calls, state,
    getRenderTarget: () => state.target, setRenderTarget(t) { calls.push(['target', t]); state.target = t; },
    getClearColor: c => c.copy(state.color), getClearAlpha: () => state.alpha,
    setClearColor(c, a) { calls.push(['clear', c.clone(), a]); state.color.copy(c); state.alpha = a; },
    get autoClear() { return state.autoClear; }, set autoClear(v) { state.autoClear = v; },
    render(scene, camera) { if (fail) throw new Error('context lost'); calls.push(['render', scene, camera, state.target, state.autoClear]); },
  };
}
