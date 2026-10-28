// なぜ失敗したか: 各変異をassertionで検出する。構文・読み込みエラーは検出成功に数えない。
// 毎回と終了時に元のバイト列を復元し、復元後の試験も実行する。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const config = 'dist/valley/config.js';
const view = 'dist/valley/tree-view.js', lod = 'dist/valley/tree-lod.js', qa = 'dist/valley/qa.js';
const cases = [
  ['wide standard dither band', config, 'blend: { standard: 7, light: 6 }', 'blend: { standard: 10, light: 6 }'],
  ['wide light dither band', config, 'blend: { standard: 7, light: 6 }', 'blend: { standard: 7, light: 8 }'],
  ['only one level in overlap', view, 'if (membership[level]) {', 'if (membership[level] && !membership[level - 1]) {'],
  ['omit movement margin', lod, 'margin = 6', 'margin = 0'],
  ['different scale at each level', view, 'baseScale * (.92 + .28 * f2)', 'baseScale * (.92 + .28 * f2) * (1 + level * .2)'],
  ['remove light far thinning', view, 'this.light && level === 2 && (i & 1)', 'false'],
  ['remove understory outer cull', view, 'if (fadeWeight(distance - 6, range, this.policy.blend) <= 0) continue;', '/* missing outer cull */'],
  ['remove understory shader fade', view, 'if (cfg) shader.vertexShader =', 'if (false) shader.vertexShader ='],
  ['underallocate capacity', view, 'capacity, materials: this.materials', 'capacity: Math.max(0, capacity - 1), materials: this.materials'],
  ['leak field geometry', view, 'if (mesh) { mesh.geometry.dispose(); mesh.dispose(); }', 'if (mesh) { mesh.dispose(); }'],
  ['leak instance buffers', view, 'if (mesh) { mesh.geometry.dispose(); mesh.dispose(); }', 'if (mesh) { mesh.geometry.dispose(); }'],
  ['leak material owner', view, 'this.materials.dispose();', '/* materials leak */'],
  ['break update cadence', view, 'this.last.y) < 5', 'this.last.y) < 4'],
  ['ignore force', view, 'if (!force && Math.hypot', 'if (Math.hypot'],
  ['use height metres as scale', view, 'd.s[i] / treeGeometry(sp, 0).height', 'd.s[i]'],
  ['omit species assignment', view, 'this.species.species[i], this.species.stage[i]', 'd.kind[i], this.species.stage[i]'],
  ['LOD exit uniform disabled', lod, '[-1, -1, a - w, a + w]', '[-1, -1, -1, -1]'],
  ['unnormalized weights', lod, '[1 - enter, enter * (1 - far), far]', '[1 - enter, enter, far]'],
  ['shader distance differs from allocation', view, "'distance(treeOrigin.xz,cameraPosition.xz)'", "'distance(treeOrigin,cameraPosition)'"],
  ['QA drops total', qa, 'total += count;', 'total += 0;'],
  ...[
    ['start', 'cx === -100.5 && cz === -89'],
    ['village road', 'cx === -5 && cz === 2.2'],
    ['village centre', 'cx === -6 && cz === 20'],
    ['forest', 'cx === -36 && cz === -48'],
  ].map(([name,condition]) => [`break budget at ${name}`,view,'const membership = lodMembership(distance, this.policy);',`const membership = ${condition} ? [true,false,false] : lodMembership(distance, this.policy);`]),
];
const originals = new Map([...new Set(cases.map(c => c[1]))].map(f => [f, fs.readFileSync(f)]));
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-lod.test.mjs', 'tests/valley-tree-field.test.mjs'], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
function baseline() { const r = run(); if (r.status !== 0) throw Error('field baseline failed\n' + r.stdout + r.stderr); }
baseline(); let killed = 0;
try {
  for (const [name, file, from, to] of cases) {
    const original = originals.get(file);
    if (!original.toString().includes(from)) throw Error('mutation target missing: ' + name);
    let result;
    try { fs.writeFileSync(file, original.toString().replace(from, to)); result = run(); }
    finally { fs.writeFileSync(file, original); }
    const log = result.stdout + result.stderr;
    const ok = result.status !== 0 && /AssertionError/.test(log) && /(?:#|ℹ) fail [1-9]/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
    killed += Number(ok); console.log(`${ok ? 'killed' : 'SURVIVED'}: ${name}`);
    if (!ok) console.log(log.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g, '<module>').slice(-2000));
  }
} finally {
  for (const [f, bytes] of originals) {
    fs.writeFileSync(f, bytes);
    if (!fs.readFileSync(f).equals(bytes)) throw Error('field byte restoration failed');
  }
}
baseline(); console.log(JSON.stringify({ total: cases.length, killed, restored: true }));
if (killed !== cases.length) process.exitCode = 1;
