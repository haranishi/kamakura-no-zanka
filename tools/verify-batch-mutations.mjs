// まとめ描き（batch.js・props.js・buildings.js・grade.js）の変異試験：置き方をわざと1か所ずつ壊し、
// tests/valley-batch.test.mjs（複製で置いていた頃との照合）が落ちることを確かめる。失敗した回も含めて finally で元へ戻す。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const at = name => new URL('../dist/valley/' + name, import.meta.url);
const test = new URL('../tests/valley-batch.test.mjs', import.meta.url);
const cases = [
  ['part chain order', 'batch.js', 'chain.premultiply(localMatrix(n))', 'chain.multiply(localMatrix(n))'],
  ['placement turn', 'batch.js', 'anchor.rotation.set(0, rotY, 0)', 'anchor.rotation.set(0, -rotY, 0)'],
  ['shadow flags', 'batch.js', 'castShadow: o.castShadow, receiveShadow: o.receiveShadow', 'castShadow: true, receiveShadow: true'],
  ['one cull for all copies', 'batch.js', 'Object.assign(mesh, { name: o.name,', 'Object.assign(mesh, { perObjectFrustumCulled: false, name: o.name,'],
  ['fence height', 'props.js', '[s, 0.9, s]', '[s, s, s]'],
  ['fence sink', 'props.js', 'rot, [s, 0.9, s], -0.05', 'rot, [s, 0.9, s], 0'],
  ['shrine sink', 'props.js', "p.kind === 'shrine' ? -0.06 : -0.04", '-0.04'],
  ['firewood size', 'props.js', 'd.scale || 1.2, -0.03', 'd.scale || 1, -0.03'],
  ['banner sway phase', 'props.js', 'Math.sin(time * 1.3 + b.z)', 'Math.sin(time * 1.3 + b.x)'],
  ['banner looks merged', 'props.js', "const look = (d.color || '#7b1f1a') + (d.mark || '#e8dfc6');", "const look = 'one';"],
  ['farm tint lost', 'buildings.js', "colors.push(new THREE.Color(tints[v % 3] || '#ffffff'))", "colors.push(new THREE.Color('#ffffff'))"],
  ['farm tint after grade', 'buildings.js', '{ whiteMax: 0.46, tintFirst: true }', '{ whiteMax: 0.46 }'],
  ['farm size', 'buildings.js', 'scale = 0.98 + v * 0.04', 'scale = 0.98'],
  ['grade keeps both colours', 'grade.js', "const fs = tintFirst ? shader.fragmentShader.replace('#include <color_fragment>', '') : shader.fragmentShader;", 'const fs = shader.fragmentShader;'],
];
const run = () => spawnSync(process.execPath, ['--test', test.pathname], { encoding: 'utf8', timeout: 60000 });
const baseline = run();
if (baseline.status !== 0) throw Error('Batch mutation baseline failed\n' + baseline.stdout + baseline.stderr);
const results = [];
for (const [name, file, original, replacement] of cases) {
  const source = fs.readFileSync(at(file));
  if (!source.toString().includes(original)) throw Error(`Mutation not found: ${name}`);
  let result;
  try {
    fs.writeFileSync(at(file), source.toString().replace(original, replacement));
    result = run();
  } finally { fs.writeFileSync(at(file), source); }
  const log = result.stdout + result.stderr;
  const failed = Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1] || 0);
  const killed = result.status !== 0 && failed > 0 && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !result.error;
  results.push({ name, killed: Boolean(killed), failed });
  console.error(`${killed ? 'killed' : 'SURVIVED'}: ${name} (${failed})`);
}
console.log(JSON.stringify({ total: cases.length, killed: results.filter(r => r.killed).length, results }, null, 2));
if (results.some(r => !r.killed)) process.exitCode = 1;
