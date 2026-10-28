// なぜ失敗したか: 風・色・溶かし・資源の退行をassertionで検出し、元のバイト列へ戻す。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const material = 'dist/valley/tree-materials.js', texture = 'dist/valley/tree-textures.js';
const cases = [
  ['missing fringe routing', material, 'species === 2 || level === 0 ? 0 : 3', 'true ? 0 : 3'],
  ['pine routed to fringe', material, 'species === 2 || level === 0 ? 0 : 3', 'species === 0 && level === 0 ? 0 : 3'],
  ['too few small maple leaves', texture, 'maple ? 300 : 215', 'maple ? 100 : 80'],
  ['solid fringe lower edge', texture, 'strokes(1500, 100, 255, 3);', 'g.fillStyle=green(.5,.5); g.fillRect(0,150,S,106);'],
  ['sparse fringe upper edge', texture, 'g.fillRect(0, 0, S, 150);', '/* omit dense base */'],
  ['gray fringe', texture, 'Math.round(54 + 62 * t + 12 * r)', 'Math.round(30 + 40 * t + 10 * r)'],
  ['clamped foliage UV', texture, 'map.wrapS = map.wrapT = THREE.RepeatWrapping', 'map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping'],
  ['seams not wrapped', texture, 'for (const ox of [-S, 0, S]) for (const oy of [-S, 0, S])', 'for (const ox of [0]) for (const oy of [0])'],
  ['remove transparent leaf separation', texture, "g.globalCompositeOperation = 'destination-out'", "g.globalCompositeOperation = 'source-over'"],
  ['opaque disk under leaves', texture, "g.lineJoin = 'round'; g.lineCap = 'round';", "g.fillStyle='rgb(190,190,190)'; g.beginPath(); for(let i=0;i<=64;i++){const a=i/64*TAU; if(i===0)g.moveTo(128+120*Math.cos(a),128+120*Math.sin(a));else g.lineTo(128+120*Math.cos(a),128+120*Math.sin(a));}g.closePath();g.fill();g.lineJoin = 'round'; g.lineCap = 'round';"],
  ['reserved opaque corner', texture, 'const map = repeat(c, g); map.userData.leafCount', "g.fillStyle='rgb(158,158,158)';g.fillRect(0,240,16,16);const map = repeat(c, g); map.userData.leafCount"],
  ['omit leaf gain', material, 'm.color.multiplyScalar(species >= 4 ? TREES.understoryLeafGain : TREES.leafGain)', 'm.color.multiplyScalar(1)'],
  ['gain applied to conifers', material, 'leaf && !conifer && level < 2', 'leaf && level < 2'],
  ['unscaled wind', material, '*flutter)*uWind;', '*flutter);'],
  ['gust without threshold', material, '*step(.5,uWind)', '*1.0'],
  ['unlimited backlight', material, 'min(vec3(.35)', 'min(vec3(3.5)'],
  ['same dither direction', material, 'if (n < 1.0-vTreeWeight) discard;', 'if (n >= vTreeWeight) discard;'],
  ['fixed emissive color', material, 'totalEmissiveRadiance += diffuseColor.rgb*', 'totalEmissiveRadiance += vec3(.1,.2,.1)*'],
  ['texture disposal leak', material, 'for (const t of textures) t.dispose();', 'for (const t of []) t.dispose();'],
  ['material disposal leak', material, 'for (const m of owned) m.dispose();', 'for (const m of []) m.dispose();'],
  ['transparent black edge', texture, 'pixels.data[i + 2] = 190', 'pixels.data[i + 2] = 0'],
  ['no transmission attenuation', material, '1.0-smoothstep(30.0,100.0,vTreeDistance)', '1.0'],
  ['light coverage enabled', material, "quality !== 'light'", "quality === 'light'"],
  ['sapling texture variant ignored', material, 'species === 4 && variant === 1', 'species === 4 && variant === 9'],
  ['understory adult gain', material, 'species >= 4 ? TREES.understoryLeafGain : TREES.leafGain', 'TREES.leafGain'],
  ['narrow tint spread', 'dist/valley/tree-view.js', '.88 + .24 * clamp(tint)', '.9 + .2 * clamp(tint)'],
];
const originals = new Map([...new Set(cases.map(c => c[1]))].map(f => [f, fs.readFileSync(f)]));
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-view.test.mjs'], { encoding: 'utf8', timeout: 30000, maxBuffer: 8 * 1024 * 1024 });
function baseline() { const r=run(); if(r.status!==0) throw Error('view baseline failed\n'+r.stdout+r.stderr); }
baseline(); let killed=0;
try {
  for (const [name, file, from, to] of cases) {
    const original=originals.get(file); if(!original.toString().includes(from)) throw Error('mutation target missing: '+name);
    let r;try {fs.writeFileSync(file,original.toString().replace(from,to));r=run();}finally{fs.writeFileSync(file,original);}
    const log=r.stdout+r.stderr;
    const ok=r.status!==0 && /AssertionError/.test(log) && /(?:#|ℹ) fail [1-9]/.test(log) && !/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log) && !r.error;
    killed+=Number(ok);console.log(`${ok?'killed':'SURVIVED'}: ${name}`);
    if(!ok)console.log(JSON.stringify({status:r.status,error:r.error?.message,signal:r.signal})+' '+log.replace(/data:text\/javascript;base64,[A-Za-z0-9+/=]+/g,'<module>').slice(-1500));
  }
} finally {for(const [f,b] of originals){fs.writeFileSync(f,b);if(!fs.readFileSync(f).equals(b))throw Error('view byte restoration failed');}}
baseline();console.log(JSON.stringify({total:cases.length,killed,restored:true}));if(killed!==cases.length)process.exitCode=1;
