// なぜ失敗したか: 風・色・溶かし・資源の退行をassertionで検出し、元のバイト列へ戻す。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const material = 'dist/valley/tree-materials.js', view = 'dist/valley/tree-view.js', texture = 'dist/valley/tree-textures.js';
const cases = [
  ['missing fringe routing', material, 'species === 0 && level === 0 ? 0 : 3', 'true ? 0 : 3'],
  ['too few small maple leaves', texture, 'maple ? 26 : 56', 'maple ? 12 : 30'],
  ['transparent core corner', texture, 'r.pixel(x,y,.62);', 'r.pixel(x,y,.62,0);'],
  ['solid fringe lower edge', texture, 'const end=150+Math.floor(hash(x,12)*106);', 'const end=256;'],
  ['sparse fringe upper edge', texture, 'solid ? 255 :', 'solid ? 90 :'],
  ['clamped foliage UV', texture, 'map.wrapS=map.wrapT=THREE.RepeatWrapping', 'map.wrapS=map.wrapT=THREE.ClampToEdgeWrapping'],
  ['unscaled wind', material, '*flutter)*uWind;', '*flutter);'],
  ['gust without threshold', material, '*step(.5,uWind)', '*1.0'],
  ['unlimited backlight', material, 'min(vec3(.35)', 'min(vec3(3.5)'],
  ['same dither direction', material, 'if (n < 1.0-vTreeWeight) discard;', 'if (n >= vTreeWeight) discard;'],
  ['dithered shadow pass', view, 'm.castShadow = level === 0;', 'm.customDepthMaterial = material; m.castShadow = level === 0;'],
  ['fixed emissive color', material, 'totalEmissiveRadiance += diffuseColor.rgb*', 'totalEmissiveRadiance += vec3(.1,.2,.1)*'],
  ['texture disposal leak', material, 'for (const t of textures) t.dispose();', 'for (const t of []) t.dispose();'],
  ['material disposal leak', material, 'for (const m of owned) m.dispose();', 'for (const m of []) m.dispose();'],
  ['geometry disposal leak', view, 'mesh.geometry.dispose();', '/* leaked geometry */'],
  ['instance buffer disposal leak', view, 'mesh.dispose();', '/* leaked instance buffers */'],
  ['transparent black edge', texture, 'pixels.data[i + 2] = 190', 'pixels.data[i + 2] = 0'],
  ['no transmission attenuation', material, '1.0-smoothstep(30.0,100.0,vTreeDistance)', '1.0'],
  ['light coverage enabled', material, "quality !== 'light'", "quality === 'light'"],
  ['sapling texture variant ignored', material, 'species === 4 && variant === 1', 'species === 4 && variant === 9'],
  ['instance color omitted', view, "kind === 'leaf' ? stageColor(species, stage, .5, variant) : new THREE.Color(0xffffff)", 'new THREE.Color(0xffffff)'],
];
const originals = new Map([...new Set(cases.map(c => c[1]))].map(f => [f, fs.readFileSync(f)]));
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-view.test.mjs'], { encoding: 'utf8', timeout: 30000 });
function baseline() { const r=run(); if(r.status!==0) throw Error('view baseline failed\n'+r.stdout+r.stderr); }
baseline(); let killed=0;
try {
  for (const [name, file, from, to] of cases) {
    const original=originals.get(file); if(!original.toString().includes(from)) throw Error('mutation target missing: '+name);
    let r;try {fs.writeFileSync(file,original.toString().replace(from,to));r=run();}finally{fs.writeFileSync(file,original);}
    const log=r.stdout+r.stderr;
    const ok=r.status!==0 && /AssertionError/.test(log) && /(?:#|ℹ) fail [1-9]/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !r.error;
    killed+=Number(ok);console.log(`${ok?'killed':'SURVIVED'}: ${name}`);
  }
} finally {for(const [f,b] of originals){fs.writeFileSync(f,b);if(!fs.readFileSync(f).equals(b))throw Error('view byte restoration failed');}}
baseline();console.log(JSON.stringify({total:cases.length,killed,restored:true}));if(killed!==cases.length)process.exitCode=1;
