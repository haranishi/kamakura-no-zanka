// 縦切り（dist/valley/）の配布検査。ブラウザなしで、ファイルの欠け・読み込みの鎖・純粋な層の汚れ・GLBの中身・出所の記録を確かめる。
// 実行：node tools/check-valley.mjs（tools/check-package.mjs からも呼ばれる）
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = path.join(root, 'dist/valley');
const read = f => fs.readFileSync(path.join(root, f), 'utf8');

// 1 入口・主要なモジュールと素材がある
const modules = ['actors', 'ai-world', 'anim-data', 'atmosphere', 'audio-valley', 'battle', 'bow', 'buildings', 'camera-rig', 'characters', 'collision', 'combat', 'companion-ai', 'config',
  'enemy-ai', 'fx', 'game', 'guide', 'grade', 'hud', 'input', 'main', 'nav', 'perf-stats', 'wind', 'post', 'props', 'qa', 'quest', 'ridges', 'save', 'scatter', 'shots', 'story-data', 'terrain-height', 'terrain', 'vegetation', 'water', 'weapons', 'world-colliders', 'world-data'];
for (const m of modules) assert(fs.statSync(path.join(dir, m + '.js')).size > 0, `missing dist/valley/${m}.js`);
for (const f of ['index.html', 'valley.css']) assert(fs.statSync(path.join(dir, f)).size > 0, `missing dist/valley/${f}`);

// 2 import の鎖が切れていない（相対 import は実在し、export 名が実在する）
const exportsOf = src => { const out = new Set(); for (const m of src.matchAll(/export\s+(?:async\s+)?(?:function\*?|class|const|let|var)\s+([A-Za-z0-9_$]+)/g)) out.add(m[1]); for (const m of src.matchAll(/export\s*\{([^}]+)\}/g)) for (const n of m[1].split(',')) out.add(n.trim().split(/\s+as\s+/).pop()); return out; };
const sources = Object.fromEntries(fs.readdirSync(dir).filter(f => f.endsWith('.js')).map(f => [f, fs.readFileSync(path.join(dir, f), 'utf8')]));
for (const [file, src] of Object.entries(sources)) {
  for (const m of src.matchAll(/import\s+(?:\*\s+as\s+\w+|\{([^}]*)\}|(\w+))\s+from\s+'(\.[^']+)'/g)) {
    const target = m[3].replace(/^\.\//, '');
    if (target.startsWith('../')) { assert(fs.existsSync(path.join(dir, target)), `${file}: ${m[3]} not found`); continue; }
    assert(sources[target], `${file}: import './${target}' not found`);
    if (m[1]) {
      const have = exportsOf(sources[target]);
      for (const raw of m[1].split(',')) { const name = raw.trim().split(/\s+as\s+/)[0]; if (name) assert(have.has(name), `${file}: './${target}' has no export '${name}'`); }
    }
  }
}

// 3 純粋な層（規則・データ）は Three.js・DOM・乱数・時計に触れない
const pure = ['guide', 'perf-stats', 'wind', 'combat', 'enemy-ai', 'companion-ai', 'quest', 'save', 'nav', 'terrain-height', 'scatter', 'collision', 'anim-data', 'world-data', 'world-colliders', 'story-data', 'ai-world'];
for (const m of pure) {
  const code = sources[m + '.js'].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
  for (const bad of [/from\s+'three/, /\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/, /\bdocument\./, /\bwindow\./, /\blocalStorage\b/]) assert(!bad.test(code), `${m}.js (pure layer) uses ${bad}`);
}

// 植生4種は同じ一組の風uniformを共有する。生成を各材質へ分散させない。
const vegetation = sources['vegetation.js'].replace(/\/\/.*$/gm, '').replace(/\/\*[\s\S]*?\*\//g, '');
assert.equal([...vegetation.matchAll(/(?<!function\s)\bwindUniforms\s*\(/g)].length, 1, 'vegetation must call windUniforms once');
assert.match(vegetation, /const wind = windUniforms\(\)/, 'vegetation must bind the shared wind');
for (const [name, factory] of [['trees', 'new TreeField'], ['grass', 'makeTufts'], ['rice', 'makeTufts'], ['crops', 'makeTufts']]) {
  const line = vegetation.split('\n').find(line => line.includes(`const ${name} =`));
  assert(line?.includes(factory) && /\bwind\s*[,}]/.test(line) && !/\bwind\s*:/.test(line), `${name} must receive the shared wind`);
}

// 4 index.html：id の重複なし。hud.js・main.js が引く id がすべて存在する
const html = read('dist/valley/index.html');
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'duplicate ids in index.html: ' + ids.filter((x, i) => ids.indexOf(x) !== i).join(','));
const wanted = new Set();
for (const f of ['hud.js', 'main.js']) {
  for (const m of sources[f].matchAll(/\$\('([^']+)'\)/g)) wanted.add(m[1]);
  for (const m of sources[f].matchAll(/getElementById\('([^']+)'\)/g)) wanted.add(m[1]);
}
const hudList = sources['hud.js'].match(/Object\.fromEntries\(\[([\s\S]*?)\]\.map/);
if (hudList) for (const m of hudList[1].matchAll(/'([^']+)'/g)) wanted.add(m[1]);
for (const id of wanted) assert(ids.includes(id), `index.html lacks id="${id}" (used by hud.js/main.js)`);

// 5 GLB：ヘッダ・内蔵画像・予算。人物は動作が入っている
const glbInfo = f => {
  const b = fs.readFileSync(f);
  assert.equal(b.toString('ascii', 0, 4), 'glTF', f); assert.equal(b.readUInt32LE(4), 2, f); assert.equal(b.readUInt32LE(8), b.length, f);
  const json = JSON.parse(b.toString('utf8', 20, 20 + b.readUInt32LE(12)));
  assert((json.images || []).every(x => x.bufferView !== undefined && !x.uri), f + ': images must be embedded');
  return { json, bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') };
};
const characters = ['hero', 'archer', 'soldier', 'officer', 'villager_m', 'villager_f', 'child'];
let total = 0; const shas = {};
for (const c of characters) {
  const f = path.join(root, 'dist/assets/characters', c + '.glb'), g = glbInfo(f);
  assert((g.json.animations || []).length >= 30, `${c}.glb has too few clips`); assert(g.json.skins?.length === 1, `${c}.glb needs one skin`);
  assert(g.bytes <= 12 * 1024 * 1024, `${c}.glb over 12 MB`); total += g.bytes; shas['dist/assets/characters/' + c + '.glb'] = g.sha256;
}
const clips = JSON.parse(read('dist/assets/characters/clips.json'));
for (const c of characters) assert(clips.characters[c]?.clips?.length >= 30, `clips.json lacks ${c}`);
const props = ['farmhouse', 'temple', 'bridge', 'fence', 'boulder', 'firewood', 'well', 'cart', 'lantern', 'hasa', 'jizo', 'firepit', 'gatehouse', 'fort', 'barricade', 'dozo', 'naya', 'wara', 'kakashi', 'hokora', 'boulder_lo'];
const limitMB = { temple: 11, farmhouse: 7 };      // 建物は大きい。それ以外の小道具は 2MB まで
for (const p of props) { const f = path.join(root, 'dist/assets/valley/models', p + '.glb'), g = glbInfo(f), lim = limitMB[p] ?? 2; assert(g.bytes <= lim * 1024 * 1024, `${p}.glb over ${lim} MB`); total += g.bytes; shas['dist/assets/valley/models/' + p + '.glb'] = g.sha256; }
assert(total <= 115 * 1024 * 1024, `model budget exceeded: ${(total / 1048576).toFixed(1)} MB`);

// 6 出所：Meshy で作った素材は provenance/meshy-v19.json に task_id と SHA256 がある
const prov = JSON.parse(read('provenance/meshy-v19.json'));
for (const [file, sha] of Object.entries(shas)) {
  const e = prov.assets.find(a => a.file === file);
  if (!e) continue;                       // Drive由来の建物などは別の記録（provenance/valley-textures.json 等）
  assert(e.task_id && e.sha256, `provenance entry incomplete: ${file}`);
  assert.equal(e.sha256, sha, `provenance sha256 differs from the shipped file: ${file}`);
}
for (const c of characters) assert(prov.assets.some(a => a.file === 'dist/assets/characters/' + c + '.glb'), `provenance lacks ${c}`);
for (const p of ['well', 'cart', 'lantern', 'hasa', 'jizo', 'firepit', 'gatehouse', 'fort', 'barricade', 'dozo', 'naya', 'wara', 'kakashi', 'hokora']) assert(prov.assets.some(a => a.file === 'dist/assets/valley/models/' + p + '.glb'), `provenance lacks ${p}`);

console.log(`Valley check passed: ${modules.length} modules, imports resolved, ${pure.length} pure layers clean, ${wanted.size} HTML ids, ${characters.length + props.length} GLBs (${(total / 1048576).toFixed(1)} MB), provenance matched.`);
