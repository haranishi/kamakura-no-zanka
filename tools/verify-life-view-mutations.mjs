// S7-A（暮らしの小物）の変異試験：出し入れ・距離・烏・当たり・踏み固めた土・型・配線・配置の表を、わざと1か所ずつ壊し、
// tests/valley-life-{view,places,wiring}.test.mjs のどれかが落ちることを確かめる。失敗した回も含めて finally で元のバイト列へ戻す。
// 使い方: node tools/verify-life-view-mutations.mjs
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const at = name => new URL('../dist/valley/' + name, import.meta.url);
const tests = ['view', 'places', 'wiring'].map(n => new URL(`../tests/valley-life-${n}.test.mjs`, import.meta.url).pathname);
const cases = [
  ['state ignored', 'life-view.js', 'if (show.state && !show.state.includes(it.state)) return false;', ''],
  ['min ignored', 'life-view.js', 'if (show.min != null && it.count < show.min) return false;', ''],
  ['max ignored', 'life-view.js', 'if (show.max != null && it.count > show.max) return false;', ''],
  ['no distance limit', 'life-view.js', '(!st.small[k] || !cam || Math.hypot(d.x - cam.x, d.z - cam.z) < far)', 'true'],
  ['light as far as standard', 'life-view.js', 'light: 15', 'light: 25'],
  ['quality change ignored', 'life-view.js', ' || qn !== lastQuality', ''],
  ['crows never leave', 'life-view.js', 'if (leaving && crows.leaveAt == null) crows.leaveAt = time;', ''],
  ['crows always drawn', 'life-view.js', 'if (crows.gone > 320) mesh.visible = false;', ''],
  ['crows not called back', 'life-view.js', 'if (!leaving) { crows.leaveAt = null; crows.gone = 0; }', ''],
  ['disc under stacked things', 'life-view.js', 'if ((d.lift || 0) > 0.2) continue;', ''],
  ['collider on a vanishing item', 'world-colliders.js', 'if (!d.hit || d.show) continue;', 'if (!d.hit) continue;'],
  ['no life colliders', 'world-colliders.js', 'if (!d.hit || d.show) continue;', 'continue;'],
  ['collider offset ignored', 'world-colliders.js', 'const x = d.hit.x ?? d.x, z = d.hit.z ?? d.z;', 'const x = d.x, z = d.z;'],
  ['grass on the camp', 'grass-field.js', "    if ((world.life?.trodden || []).some(t => Math.hypot(x - t.x, z - t.z) < t.r)) continue;", ''],
  ['grass floor at the camp', 'terrain-height.js', "    for (const t of world.life?.trodden || []) dirt = Math.max(dirt, (1 - smooth(t.r * 0.55, t.r, Math.hypot(x - t.x, z - t.z))) * 0.85);", ''],
  ['props cast shadows', 'life-kit.js', 'mesh.castShadow = false;', 'mesh.castShadow = true;'],
  ['long bale', 'life-kit.js', 'L = 0.36, R = 0.205', 'L = 0.5, R = 0.205'],
  ['rope span', 'life-kit.js', 'const SPAN = 0.8, TIE = 1.0;', 'const SPAN = 0.9, TIE = 1.0;'],
  ['marks float', 'life-kit.js', 'const LIFT = 0.035;', 'const LIFT = 0.2;'],
  ['marks write depth', 'life-kit.js', 'transparent: true, depthWrite: false,', 'transparent: true, depthWrite: true,'],
  ['embers do not glow', 'life-kit.js', "emissive: new THREE.Color('#ff5a14')", "emissive: new THREE.Color('#000000')"],
  ['house smoke in the raid', 'game.js', "if (this.lifeShows('house_smoke')) for", 'for'],
  ['camp smoke after the rescue', 'game.js', "this.lifeShows('camp_smoke') &&", 'true &&'],
  ['no refresh on events', 'game.js', '    this.syncLife();\n    this.log?.push', '    this.log?.push'],
  ['no refresh on rebuild', 'game.js', 'this.clearActors(); this.syncLife();', 'this.clearActors();'],
  ['stacked bale off the pile', 'world-data.js', "{ id: 'bale_5', kind: 'bale', x: -28.45, z: 5.65,", "{ id: 'bale_5', kind: 'bale', x: -27.45, z: 5.65,"],
  ['stake on the road', 'world-data.js', "{ id: 'north_stake_1', kind: 'stake', x: -36.9, z: -18.18,", "{ id: 'north_stake_1', kind: 'stake', x: -39.0, z: -18.6,"],
  ['collider on a stacked bale', 'world-data.js', "show: { item: 'bale_row', min: 6 } },", "show: { item: 'bale_row', min: 6 }, hit: { r: 0.4, height: 0.4 } },"],
  ['rope off its posts', 'world-data.js', "{ id: 'rope_tied', kind: 'rope_tied', x: -27.32, z: -7.86,", "{ id: 'rope_tied', kind: 'rope_tied', x: -27.12, z: -7.86,"],
  ['bow follows the rope', 'world-data.js', "show: { item: 'captive_bow', state: ['on_cart'] } },\n      { id: 'captive_quiver'", "show: { item: 'boundary_rope', state: ['cut'] } },\n      { id: 'captive_quiver'"],
];
const run = () => spawnSync(process.execPath, ['--test', ...tests], { encoding: 'utf8', timeout: 180000 });
const baseline = run();
if (baseline.status !== 0) throw Error('Life mutation baseline failed\n' + baseline.stdout + baseline.stderr);
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
const survived = results.filter(r => !r.killed);
console.log(JSON.stringify({ total: results.length, killed: results.length - survived.length, survived: survived.map(r => r.name) }, null, 2));
if (survived.length) process.exitCode = 1;
