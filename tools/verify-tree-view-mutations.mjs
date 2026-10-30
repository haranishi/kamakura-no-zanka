// なぜ失敗したか: 風・色・溶かし・資源の退行をassertionで検出し、元のバイト列へ戻す。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const material = 'dist/valley/tree-materials.js', texture = 'dist/valley/tree-textures.js', bake = 'dist/valley/tree-bake.js';
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

  ['too few small maple leaves', texture, 'maple ? 300 : 215', 'maple ? 100 : 80'],
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
  ['material disposal leak', material, 'for (const m of owned) m.dispose();', 'for (const m of []) m.dispose();'],
  ['transparent black edge', texture, 'function upload(c, g, pad = [190, 190, 190]) {', 'function upload(c, g, pad = [0, 0, 0]) {'],
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
  ['alpha cut raised to .5', material, 'alphaTest: map ? .3 : 0', 'alphaTest: map ? .5 : 0'],
  ['far broadleaf without gain', material, 'if (leaf && !conifer) m.color', 'if (leaf && !conifer && level < 2) m.color'],
  ['mean of sRGB bytes', material, 'sum[k] += linear[a[i + k]] * w;\n  }\n  return new THREE.Color().setRGB(...sum.map(v => v / (weight || 1)), THREE.LinearSRGBColorSpace);', 'sum[k] += a[i + k] / 255 * w;\n  }\n  return new THREE.Color().setRGB(...sum.map(v => v / (weight || 1)), THREE.SRGBColorSpace);'],
  ['maple far crown uses zelkova mean', material, 'export function farImage(species, variant = 0) { return leafImage(species, 0, variant); }', 'export function farImage(species, variant = 0) { return species === 3 ? 1 : leafImage(species, 0, variant); }'],
  ['texture disposal leak', material, 'for (const t of [...textures, ...Object.values(details), bark]) t.dispose();', 'for (const t of textures) t.dispose();'],
  // 8.1a（房の帳・葉の詳細・樹皮・樹冠の照らし方・段の傾き）。
  ['cedar tufts share the pine needles', material, 'if (species === 0) return 3;', 'if (species === 0) return 0;'],
  ['bark on foliage cores', material, 'float barkOn = step(-0.5, vBarkUv.x);', 'float barkOn = 1.0;'],
  ['bark brightness doubled', material, 'barkTexel.r*2.0, barkOn', 'barkTexel.r*3.0, barkOn'],
  ['no ground contact', material, 'smoothstep(-0.15, 1.1, vBarkHeight)', 'smoothstep(-0.15, 1.1, 9.0)'],
  ['crown shade on every species', material, '${species === 0 ? `\n        // Inside the cedar crown', '${true ? `\n        // Inside the cedar crown'],
  ['leaf detail on conifers', material, 'const detail = leaf && map && details[image] ? details[image] : null;', 'const detail = leaf && map ? details[image] ?? details[1] : null;'],
  ['rim erosion ignores the leaf', material, '(leafDetail.a-.5)*${TREES.leafDetail.rim.toFixed(2)}', '(0.0)*${TREES.leafDetail.rim.toFixed(2)}'],
  ['crown lighting off', material, 'const crownLit = leaf && species === 0 && level < 2;', 'const crownLit = false;'],
  ['edge-on card fade missing', material, 'diffuseColor.a *= smoothstep(.04, .22, abs(dot(cardFace, normalize(vViewPosition))) / max(length(cardFace), 1e-8));', 'diffuseColor.a *= 1.0;'],
  ['tier tilt ignores its level', material, '${TREES.tierTilt[level].toFixed(3)}', '${TREES.tierTilt[2].toFixed(3)}'],
  ['detail jitter biased warm', texture, 'hg.fillStyle = gray(.5 + .5 * hue)', 'hg.fillStyle = gray(.75 + .25 * hue)'],
  ['flat leaf detail', texture, 'const base = [Math.sin(tilt) * Math.cos(angle), Math.sin(tilt) * Math.sin(angle), Math.cos(tilt)];', 'const base = [0, 0, 1];'],
  ['detail map flipped against the leaf image', texture, 'map.flipY = true; map.colorSpace = THREE.NoColorSpace;', 'map.flipY = false; map.colorSpace = THREE.NoColorSpace;'],
  ['spray padded grey', texture, "upload(c, g, 'mean')", 'upload(c, g)'],
  ['spray wider than its card', texture, 'Math.min(1, 116 / half,', 'Math.min(1.6, 180 / half,'],
  // 8.1a second round: near-camera fade, leaf groups and gaps, backlit edges, evening air, moss, pine padding, the far boards.
  ['no near fade', material, 'const nearFade = leaf && level < 2;', 'const nearFade = false;'],
  ['near fade on trunks', material, 'const nearFade = leaf && level < 2;', 'const nearFade = level < 2;'],
  ['near fade modes swapped', material, "${fadeMode === 'coverage' ? 'diffuseColor.a *= nearKeep;' : 'if (n >= nearKeep) discard;'}", "${fadeMode === 'coverage' ? 'if (n >= nearKeep) discard;' : 'diffuseColor.a *= nearKeep;'}"],
  ['round cluster rims', material, '+ (leafGroup-.5)*${group.toFixed(2)});', ');'],
  ['no gaps in clusters', material, "diffuseColor.a *= smoothstep(${gap.toFixed(2)}, ${(gap + .08).toFixed(2)}, texture2D(normalMap, vNormalMapUv*.23+.61).a);", ''],
  ['understory as eroded as adults', material, 'const group = species >= 4 ? TREES.leafDetail.smallGroup : TREES.leafDetail.group', 'const group = TREES.leafDetail.group'],
  ['lit inner faces', material, 'if (!gl_FrontFacing) diffuseColor.rgb *= ${TREES.leafDetail.inner.toFixed(2)};', ''],
  ['conifer transmission back to .2', material, "${conifer ? TREES.backlight.conifer.toFixed(2) : '1.0'}", "${conifer ? '.2' : '1.0'}"],
  ['no backlit edge glow', material, 'leafThrough *= 1.0 + ${TREES.backlight.edge.toFixed(2)}*(1.0-smoothstep(.3, .95, leafAlpha));', ''],
  ['evening air brightens', material, 'vec3(dot(gl_FragColor.rgb, vec3(.2126,.7152,.0722)))*vec3(.94,.98,1.08), leafAir);`', 'vec3(1.0), leafAir);`'],
  ['no moss at the foot', material, 'diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.72,1.08,.55) + vec3(.006,.012,.003), barkMoss);', ''],
  ['grey needle padding', texture, "  return upload(c, g, 'mean');\n}", '  return upload(c, g);\n}'],
  ['board shows one frame twice', bake, 'vImpUvB = uImpFrame.xy + vec2(impB * uImpStep, 0.0) + uv * uImpFrame.zw;', 'vImpUvB = uImpFrame.xy + vec2(impA * uImpStep, 0.0) + uv * uImpFrame.zw;'],
  ['board view half a step off', bake, '/ 6.2831853 * ${cfg.views.toFixed(1)}, ${cfg.views.toFixed(1)});', '/ 6.2831853 * ${cfg.views.toFixed(1)} + 0.5, ${cfg.views.toFixed(1)});'],
  ['board blends everywhere', bake, 'vImpT = smoothstep(${f3(.5 - cfg.band / 2)}, ${f3(.5 + cfg.band / 2)}, impU - impA);', 'vImpT = smoothstep(0.0, 1.0, impU - impA);'],
  ['board does not face the camera', bake, 'transformed = impRight * position.x + vec3(0.0, position.y, 0.0);', 'transformed = vec3(position);'],
  ['seasonal tint on far trunks', bake, 'diffuseColor.rgb *= mix(vec3(vImpWood), vColor.rgb, step(.5, impNormal.a));', 'diffuseColor.rgb *= vColor.rgb;'],
  ['bake leaves its atlas bound', bake, 'renderer.setRenderTarget(prev.target); renderer.setClearColor', 'renderer.setClearColor'],
  ['bake keeps its temporary meshes', bake, '    scene.clear();\n  }', '  }'],
  ['far rims stay round in the bake', bake, ' + (leafGroup - .5) * ${TREES.leafDetail.group.toFixed(2)});', ');'],
];
const originals = new Map([...new Set(cases.map(c => c[1]))].map(f => [f, fs.readFileSync(f)]));
// 90s: since 8.1a round 2 the view test also bakes 13 tree families in Node (~14s); some texture mutations slow it past 30s.
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-view.test.mjs'], { encoding: 'utf8', timeout: 90000, maxBuffer: 8 * 1024 * 1024 });
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
