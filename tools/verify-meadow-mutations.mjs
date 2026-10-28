// なぜ失敗したか: 被覆の密度・境界・シェーダー結線・解放の退行を構文エラーと区別する。
// Sequential mutations restore exact bytes, including a dirty working tree.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const cases = [
  ["smoothing omitted", "dist/valley/grass-field.js", "data[j * nx + i] = Math.round(sum / 9);", "data[j * nx + i] = source[j * nx + i];"],
  ["density ignored", "dist/valley/grass-field.js", "density[k] / maxDensity", "1"],
  ["ineligible source included", "dist/valley/grass-field.js", "placeable[k] && density[k] > 0", "density[k] > 0"],
  ["zero density included", "dist/valley/grass-field.js", "placeable[k] && density[k] > 0", "placeable[k]"],
  ["floor omitted", "dist/valley/grass-field.js", "0.6 + 0.4 * density[k] / maxDensity", "density[k] / maxDensity"],
  ["wrong maximum", "dist/valley/grass-field.js", "if (placeable[k]) maxDensity", "if (true) maxDensity"],
  ["border wraps", "dist/valley/grass-field.js", "sum += source[z * nx + x]", "sum += source[z * nx + x]; else sum += source[0]"],
  ["wrong divisor", "dist/valley/grass-field.js", "Math.round(sum / 9)", "Math.round(sum / 4)"],
  ["blur biased", "dist/valley/grass-field.js", "let dx = -1; dx <= 1", "let dx = 0; dx <= 1"],
  ["in-place blur", "dist/valley/grass-field.js", "sum += source[z * nx + x]", "sum += data[z * nx + x]"],
  ["cover unused", "dist/valley/terrain.js", "float k = cover * uMeadow;", "float k = 0.0;"],
  ["rock weight changed", "dist/valley/terrain.js", "w[1] *= (1.0 - k);", "w[2] *= (1.0 - k); w[1] *= (1.0 - k);"],
  ["bounds omitted", "dist/valley/terrain.js", "cover = 0.0;", "cover *= 1.0;"],
  ["far mip omitted", "dist/valley/terrain.js", "7.0).rgb, farMix", "7.0).rgb, 0.0"],
  ["half-cell offset", "dist/valley/terrain.js", "value.set(x0, z0)", "value.set(x0 - .5, z0 - .5)"],
  ["nearest filter", "dist/valley/terrain.js", "texture.minFilter = texture.magFilter = THREE.LinearFilter", "texture.minFilter = texture.magFilter = THREE.NearestFilter"],
  ["replacement leaked", "dist/valley/terrain.js", "coverUniforms.uCover.value.dispose();", "/* leaked */"],
  ["teardown leaked", "dist/valley/terrain.js", "material.addEventListener('dispose', () => coverUniforms.uCover.value.dispose());", "/* leaked */"],
  ["unbounded tint", "dist/valley/terrain.js", "cover * 0.25 * smoothstep", "cover * 0.5 * smoothstep"],
  ["soil not reduced", "dist/valley/terrain.js", "w[4] *= (1.0 - k);", "w[4] *= 1.0;"],
];
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-meadow-cover.test.mjs', 'tests/valley-meadow-terrain.test.mjs'], { encoding: 'utf8', timeout: 30000 });
const files = [...new Set(cases.map(c => c[1]))], originals = new Map(files.map(file => [file, fs.readFileSync(file)]));
const baseline = run();
if (baseline.status !== 0) throw Error('Meadow mutation baseline failed\n' + baseline.stdout + baseline.stderr);
const results = [];
try {
  for (const [name, file, from, to] of cases) {
    const source = originals.get(file).toString();
    if (!source.includes(from)) throw Error(`Mutation not found: ${name}`);
    let result;
    try { fs.writeFileSync(file, source.replace(from, to)); result = run(); }
    finally { fs.writeFileSync(file, originals.get(file)); }
    const log = result.stdout + result.stderr;
    const failures = Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
    const killed = result.status !== 0 && failures > 0 && /AssertionError/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
    results.push({ name, killed: !!killed, failures });
    console.log(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failures})`);
  }
} finally {
  for (const [file, source] of originals) {
    fs.writeFileSync(file, source);
    if (!fs.readFileSync(file).equals(source)) throw Error(`Restoration failed: ${file}`);
  }
}
const restored = run();
if (restored.status !== 0) throw Error('Restored meadow baseline failed\n' + restored.stdout + restored.stderr);
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, restored: true, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
