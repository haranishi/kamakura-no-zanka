// Load dist/valley view modules in Node without a runtime dependency or import map: 'three' becomes the shipped build,
// the GLTF loader becomes a stub (the builders under test never load files) and relative imports are rewritten recursively.
import fs from 'node:fs';
export * as THREE from '../../dist/vendor/three.module.min.js';
const base = new URL('../../dist/valley/', import.meta.url), three = new URL('../../dist/vendor/three.module.min.js', import.meta.url).href;
const loaderStub = 'data:text/javascript,' + encodeURIComponent('export class GLTFLoader { loadAsync() { return Promise.reject(Error("no GLTF loading in Node tests")); } }');
const memo = new Map();
export const viewSource = name => fs.readFileSync(new URL(name, base), 'utf8');
export function viewModuleURL(name) {
  if (memo.has(name)) return memo.get(name);
  const s = viewSource(name).replace(/from 'three'/g, `from '${three}'`)
    .replace(/from 'three\/addons\/loaders\/GLTFLoader\.js'/g, `from '${loaderStub}'`)
    .replace(/from '\.\/([^']+)'/g, (_, p) => `from '${viewModuleURL(p)}'`)
    .replace(/import\.meta\.url/g, JSON.stringify(new URL(name, base).href));          // 素材の場所は元のファイルから数える
  const url = 'data:text/javascript;base64,' + Buffer.from(s).toString('base64'); memo.set(name, url); return url;
}
export const loadView = name => import(viewModuleURL(name));
// The banner cloth paints a canvas; Node has none. A recording 2D context is enough for the builders.
export function installCanvasStub() {
  globalThis.document ??= { createElement: tag => { if (tag !== 'canvas') throw Error('unexpected DOM element ' + tag); return { width: 0, height: 0, getContext: () => new Proxy({}, { get: (t, k) => (k in t ? t[k] : () => {}) }) }; } };
}
