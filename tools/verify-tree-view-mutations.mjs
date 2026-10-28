// なぜ失敗したか: 風・色・溶かし・資源の退行をassertionで検出し、元のバイト列へ戻す。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const material = 'dist/valley/tree-materials.js', texture = 'dist/valley/tree-textures.js';
const cases = [
  ['standard dither restored', material, "fadeMode === 'coverage'", "fadeMode === 'never'"],
  ['light coverage fade', material, "quality === 'light' ? 'dither' : 'coverage'", "'coverage'"],
  ['coverage disabled on opaque meshes', material, "alphaToCoverage: quality !== 'light'", "alphaToCoverage: !!map && quality !== 'light'"],
  ['coverage disabled everywhere', material, "alphaToCoverage: quality !== 'light'", "alphaToCoverage: false"],
  ['weight before alpha test', material, 'm.customProgramCacheKey = () =>', `const compile = m.onBeforeCompile;
    m.onBeforeCompile = shader => {
      compile(shader);
      shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', '').replace('diffuseColor.a *= vTreeWeight;', 'diffuseColor.a *= vTreeWeight;\\n#include <alphatest_fragment>');
    };
    m.customProgramCacheKey = () =>`],
  ['algorithm omitted from program cache', material, '${quality}-${fadeMode}`', '${quality}`'],
  ['missing cedar profile', material, 'transformed.xz *= prof;', 'transformed.xz *= 1.0;'],
  ['cedar profile on all species', material, "${species === 0 ? `// Position-stable", "${true ? `// Position-stable"],
  ['dark veins returned', texture, 'gray(v * .72); g.lineWidth = .8', 'gray(v * .55); g.lineWidth = .8'],

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
  ['gain applied to conifers', material, 'if (leaf && !conifer) m.color', 'if (leaf) m.color'],
  ['unscaled wind', material, '*flutter)*uWind;', '*flutter);'],
  ['gust without threshold', material, '*step(.5,uWind)', '*1.0'],
  ['unlimited backlight', material, 'min(vec3(.35)', 'min(vec3(3.5)'],
  ['complementary dither returned', material, 'if (n >= vTreeWeight) discard;', 'if (uSunDir.x > .5) { if (n < 1.0-vTreeWeight) discard; } else { if (n >= vTreeWeight) discard; }'],
  ['fixed emissive color', material, 'totalEmissiveRadiance += diffuseColor.rgb*', 'totalEmissiveRadiance += vec3(.1,.2,.1)*'],
  ['texture disposal leak', material, 'for (const t of textures) t.dispose();', 'for (const t of []) t.dispose();'],
  ['material disposal leak', material, 'for (const m of owned) m.dispose();', 'for (const m of []) m.dispose();'],
  ['transparent black edge', texture, 'pixels.data[i + 2] = 190', 'pixels.data[i + 2] = 0'],
  ['no transmission attenuation', material, '1.0-smoothstep(30.0,100.0,vTreeDistance)', '1.0'],
  ['light coverage enabled', material, "quality !== 'light'", "quality === 'light'"],
  ['sapling texture variant ignored', material, 'species === 4 && variant === 1', 'species === 4 && variant === 9'],
  ['understory adult gain', material, 'species >= 4 ? TREES.understoryLeafGain : TREES.leafGain', 'TREES.leafGain'],
  ['narrow tint spread', 'dist/valley/tree-view.js', '.88 + .24 * clamp(tint)', '.9 + .2 * clamp(tint)'],
  // 独立レビューが写しで通してしまった退行。
  ['single-sided foliage', material, 'side: leaf ? THREE.DoubleSide : THREE.FrontSide', 'side: THREE.FrontSide'],
  ['wind ignores instance rotation and scale', material, 'treeBasis = mat3(modelMatrix)*mat3(instanceMatrix);', 'treeBasis = mat3(modelMatrix);'],
  ['wind basis not divided by axis length', material, '/max(dot(treeBasis[0],treeBasis[0]),.0001)', ''],
  ['cedar height for every species', material, '${heights[species].toFixed(1)}', '${heights[0].toFixed(1)}'],
  ['maple far crown uses zelkova mean', material, 'means[conifer ? 0 : species === 3 ? 2 : 1]', 'means[conifer ? 0 : 1]'],
  ['alpha cut raised to .5', material, 'alphaTest: map ? .3 : 0', 'alphaTest: map ? .5 : 0'],
  ['far broadleaf without gain', material, 'if (leaf && !conifer) m.color', 'if (leaf && !conifer && level < 2) m.color'],
  ['mean of sRGB bytes', material, 'sum[k] += linear[a[i + k]] * w;\n  }\n  return new THREE.Color().setRGB(...sum.map(v => v / (weight || 1)), THREE.LinearSRGBColorSpace);', 'sum[k] += a[i + k] / 255 * w;\n  }\n  return new THREE.Color().setRGB(...sum.map(v => v / (weight || 1)), THREE.SRGBColorSpace);'],
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
