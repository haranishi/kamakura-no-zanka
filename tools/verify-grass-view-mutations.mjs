// なぜ失敗したか: 平均密度・正方形の板・葉の陰影の退行を、構文エラーと区別して検出する。
// Mutations must cause assertion failures, never syntax/import failures. Restore exact bytes.
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const rules = 'dist/valley/grass-view.js';
const cases = [
  ['near distance backlight omitted', rules, '(1.0-smoothstep(5.0,14.0,vGrassDistance))', '1.0'],
  ['mid backlight attenuation omitted', rules, " : '.6'};", " : '1.0'};"],
  ['mid brightness omitted', rules, 'color.multiplyScalar(brightness)', 'color.multiplyScalar(1)'],
  ['mid tilt omitted', rules, 'cross(axis,transformed)*sin(iTip.y)', 'cross(axis,transformed)*0.0'],
  ['mid tilt packing omitted', rules, "kind === 'mid' ? tilt : tc.r", "kind === 'mid' ? 0 : tc.r"],
  ['leaf shading overwritten', rules, 'if (pixels.data[i + 3] < 6)', 'if (true)'],
  ['alpha bleed threshold changed', rules, 'pixels.data[i + 3] < 6', 'pixels.data[i + 3] < 7'],
  ['blade width widened', rules, 'width = 2.4 + 2.2', 'width = 5 + 4'],
  ['atlas seed changed', rules, 'seed = 11 + v', 'seed = 10 + v'],
  ['bundle spread changed', rules, 'hash(seed, k, 9) - .5) * 110', 'hash(seed, k, 9) - .5) * 50'],
  ['bundle selection changed', rules, 'hash(seed, i, 7) * 6', 'hash(seed, i, 7) * 3'],
  ['leaf shade fixed', rules, 'shade = .82 + .30 * hash(seed, i, 6)', 'shade = 1'],
  ['leaf gradient flattened', rules, 'gv(.62)', 'gv(1)'],
  ['blade lean changed', rules, 'hash(seed, i, 3) - .5) * 110', 'hash(seed, i, 3) - .5) * 150'],

  ['card width stretched', rules, 'GRASS.card.size * d.sx[i]', 'GRASS.card.size * d.sx[i] * 2.3'],
  ['card height undersized', rules, 'GRASS.card.size * d.sy[i]', 'GRASS.card.size * d.sy[i] * .5'],
  ['dry gold omitted', rules, 'if (hue < .3)', 'if (hue < 0)'],
  ['mean color darkened', rules, 'color.copy(p[0]).lerp(p[1], .5)', 'color.copy(p[0]).lerp(p[1], .1)'],
  ['transparent RGB black', rules, 'pixels.data[i + 2] = 190', 'pixels.data[i + 2] = 0'],
  ['mid normal lowered', rules, "kind === 'mid' ? '.8'", "kind === 'mid' ? '.2'"],
  ['mid root darkened', rules, 'mix(.9,1.1,t)', 'mix(.75,1.15,t)'],
  ['distance blur omitted', rules, '1.25*smoothstep(6.8,25.0,vGrassDistance)', '0.0*smoothstep(6.8,25.0,vGrassDistance)'],
  ['root softness omitted', rules, 'diffuseColor.a *= smoothstep(0.0,.18,vGrassUV.y)', 'diffuseColor.a *= 1.0'],
  ['light coverage enabled', rules, "&& quality === 'standard'", "&& quality !== 'standard'"],
  ['back face darkened', rules, 'normal *= faceDirection;', 'normal *= 1.0;'],
  ['sparse card leaves', rules, 'i < 110', 'i < 30'],
  ['two card plates', rules, 'k < 3; k++', 'k < 2; k++'],
  ['right angle cards', rules, 'k * Math.PI / 3', 'k * Math.PI / 2'],
  ['old alpha cutoff', rules, "kind === 'mid' ? .3", "kind === 'mid' ? .42"],
  ['mipmaps disabled', rules, 'map.generateMipmaps = true', 'map.generateMipmaps = false'],
  ['old near fade', rules, '.75*uGrassRadii.x,1.25*uGrassRadii.x', '.7*uGrassRadii.x,uGrassRadii.x'],
  ['old mid appearance', rules, '.85*uGrassRadii.x,1.25*uGrassRadii.x', '.8*uGrassRadii.x,1.1*uGrassRadii.x'],
  ['abrupt mid end', rules, '.45*uGrassRadii.y,uGrassRadii.y', '.88*uGrassRadii.y,uGrassRadii.y'],
  ['coverage widening omitted', rules, 'mix(1.0,1.6,fadeOut)', 'mix(1.0,1.0,fadeOut)'],
  ['card growth omitted', rules, 'mix(.7,1.0,appear)', 'mix(1.0,1.0,appear)'],
  ['ground blend omitted', rules, '.60*smoothstep(9.0,25.0', '.0*smoothstep(12.0,25.0'],
  ['backlight cap omitted', rules, 'min(vec3(.35)', 'min(vec3(1.0)'],
  ['root backlight added', rules, 'backlight*vGrassUV.y*vGrassUV.y*mix', 'backlight*mix'],
];
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-grass-view.test.mjs'], { encoding: 'utf8', timeout: 30000 });
const files = [...new Set(cases.map(c => c[1]))], originals = new Map(files.map(file => [file, fs.readFileSync(file)]));
const baseline = run();
if (baseline.status !== 0) throw Error('Grass view mutation baseline failed\n' + baseline.stdout + baseline.stderr);
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
if (restored.status !== 0) throw Error('Restored grass view baseline failed\n' + restored.stdout + restored.stderr);
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, restored: true, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
