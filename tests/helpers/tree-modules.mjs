// Load shipped Three.js in Node without introducing a runtime dependency or import map.
import fs from 'node:fs';
export * as THREE from '../../dist/vendor/three.module.min.js';
const base = new URL('../../dist/valley/', import.meta.url), memo = new Map();
export const source = name => fs.readFileSync(new URL(name, base), 'utf8');
export function moduleURL(name) {
  if (memo.has(name)) return memo.get(name);
  let s = source(name).replace(/from 'three'/g, `from '${new URL('../../dist/vendor/three.module.min.js', import.meta.url).href}'`);
  s = s.replace(/from '(\.\/[^']+)'/g, (_, p) => `from '${p.startsWith('./tree-') ? moduleURL(p.slice(2)) : new URL(p, base).href}'`);
  s = s.replace(/import\('(\.\/[^']+)'\)/g, (_, p) => `import('${p.startsWith('./tree-') || p === './atmosphere.js' ? moduleURL(p.slice(2)) : new URL(p, base).href}')`);
  const url = 'data:text/javascript;base64,' + Buffer.from(s).toString('base64'); memo.set(name, url); return url;
}
export const load = name => import(moduleURL(name));
