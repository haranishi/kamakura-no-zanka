// なぜ失敗したか: 円盤下地と予約隅がコイン・格子になり、灰色の針と松の絵の誤配線が白い段を作った。紙の縁の黒・固定緑の発光・風やLODの結線漏れを、GPUなしで区別する。
// 原因の型: texture/shader/wind/lod/color/instance/dispose/specimen/qa、独立レビュー後は side/alpha-test/wind-basis/wind-height/far-mean。GLSLのコンパイルは対象外。
// 第3弾（8.1a）: 杉の房の絵（2枚の帳）、広葉の葉ごとの向きと色（詳細の画像）、樹皮、樹冠としての照らし方、段の傾き、輪郭の葉の欠け。
// 第2周: 遠景の絵の板（焼き付けと材質）、カメラの近くの葉の薄め、葉の群れでの縁の欠けと隙間、逆光の縁、夕景の空気、根元の苔。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load, source, THREE } from './helpers/tree-modules.mjs';
import { TREES } from '../dist/valley/config.js';
import { tileStats } from './helpers/tree-texture-metrics.mjs';
import { installTreeCanvas } from './helpers/tree-canvas.mjs';
const canvas = installTreeCanvas();
const { needleTexture, mapleLeafTexture, zelkovaLeafTexture, cedarSprayTexture, leafDetailTexture, barkTexture } = await load('tree-textures.js');
const { treeMaterials } = await load('tree-materials.js');
const { createTreeSet, buildSpecimens, stageColor } = await load('tree-view.js');
const { impostorMaterial, treeImpostors, impostorGeometry } = await load('tree-bake.js');
import { impostorView, IMPOSTOR, frameFit } from '../dist/valley/tree-impostor.js';
import { nearFade } from '../dist/valley/tree-lod.js';
import { stubRenderer } from './helpers/tree-field.mjs';
const { treeGeometry } = await load('tree-geometry.js');
const wind = () => ({ uTime: { value: 5 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uGuideMix: { value: 0 } });
const sunDir = new THREE.Vector3(.5, .2, .85).normalize();
const make = (quality = 'standard') => { const w = wind(); return { w, m: treeMaterials({ wind: w, sunDir, quality }) }; };
function compile(m) {
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <color_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <alphatest_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>' };
  m.onBeforeCompile(shader); return shader;
}
const hash = obj => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
test('three deterministic procedural textures retain padding and drawing grammar [texture]', () => {
  const hashes = [];
  for (const factory of [needleTexture, mapleLeafTexture, zelkovaLeafTexture]) {
    const a = factory(), ops = hash(canvas.drawing()), bytes = hash(Array.from(a.image.data));
    hashes.push(bytes);
    const b = factory(); assert.equal(hash(canvas.drawing()), ops, '[texture] drawing seed'); assert.equal(hash(Array.from(b.image.data)), bytes, '[texture] pixel seed');
    assert(a.isDataTexture && a.image.width <= 512 && a.image.height <= 512, '[texture] raw upload and size');
    // Grey leaves pad with grey (they are tinted per tree). The coloured needles pad with their own mean (8.1a second round):
    // grey padding bled into the mip levels and the middle pines stood pale and snowy.
    const d=a.image.data,sum=[0,0,0];let n=0;for(let i=0;i<d.length;i+=4)if(d[i+3]>=77){n++;for(let k=0;k<3;k++)sum[k]+=d[i+k];}
    const pad=factory===needleTexture?sum.map(v=>Math.round(v/n)):[190,190,190];
    for(let i=0;i<d.length;i+=4)if(d[i+3]<6)assert.deepEqual(Array.from(d.slice(i,i+3)),pad,'[texture-padding] transparent RGB');
    assert(a.flipY && a.generateMipmaps && a.colorSpace === THREE.SRGBColorSpace && a.minFilter === THREE.LinearMipmapLinearFilter, '[texture] mip/sRGB orientation');
    a.dispose(); b.dispose();
  }
  assert.equal(new Set(hashes).size, 3, '[texture] species images identical');
  for (const [factory, count] of [[mapleLeafTexture, 300], [zelkovaLeafTexture, 215]]) {
    const map=factory(), stats=tileStats(map);
    assert(canvas.drawing().filter(op=>op[0]==='fill').every(op=>op[1]<100 && op[2]<100),'[texture-disc] large filled underlay instead of leaf union');
    console.log(`[texture-metrics] ${factory.name} ${JSON.stringify(stats)}`);
    assert.equal(map.userData.leafCount,count,'[texture-leaf-count] small overlapping leaves missing');
    assert.equal(map.wrapS,THREE.RepeatWrapping,'[texture-uv] repeat wrapping');
    assert.equal(map.wrapT,THREE.RepeatWrapping,'[texture-uv] vertical repeat');
    assert(stats.holes>=.10 && stats.holes<=.25,'[texture-coverage] tile holes outside 10–25%');
    assert(stats.seamX<.08 && stats.seamY<.08,'[texture-seam] opposite edge coverage differs');
    assert(stats.largest<=.40,'[texture-disc] large connected opaque region');
    const a=map.image.data;
    for(let i=0;i<a.length;i+=4)if(a[i+3]>=77)assert(a[i]===a[i+1]&&a[i+1]===a[i+2],'[texture-value] leaf must be neutral gray');
    const corner=[];
    for(let y=240;y<256;y++)for(let x=0;x<16;x++)corner.push(a[(y*256+x)*4]);
    assert(new Set(corner).size>10,'[texture-reservation] uniform reserved corner returned');
    map.dispose();
  }
});
// なぜ失敗したか（8.1a）: 杉の近景・中景の房が松の針の絵を共有し、遠景は一色だった。房は2種の杉の枝葉を1枚の帳に並べ、縁の透明は針の平均色で埋める（灰色だと遠くで縁が白く抜けた）。
test('cedar spray atlas: two green sprays, margins, mean padding and the far forest colour [texture-spray]', () => {
  const a = cedarSprayTexture(), ops = hash(canvas.drawing()), bytes = hash(Array.from(a.image.data)), b = cedarSprayTexture();
  assert.equal(hash(canvas.drawing()), ops, '[texture-spray] drawing seed'); assert.equal(hash(Array.from(b.image.data)), bytes, '[texture-spray] pixel seed');
  assert(a.isDataTexture && a.image.width === 512 && a.image.height === 256 && a.userData.variants === 2, '[texture-spray] two-cell atlas size');
  assert(a.flipY && a.generateMipmaps && a.colorSpace === THREE.SRGBColorSpace && a.wrapS === THREE.ClampToEdgeWrapping, '[texture-spray] clamp/mip/sRGB');
  const d = a.image.data, cell = [[0, 0, 0, 0], [0, 0, 0, 0]], mean = [0, 0, 0]; let opaque = 0;
  for (let y = 0; y < 256; y++) for (let x = 0; x < 512; x++) {
    const i = (y * 512 + x) * 4, k = x >> 8; if (d[i + 3] >= 77) { cell[k][0]++; for (let q = 0; q < 3; q++) { cell[k][q + 1] += d[i + q]; mean[q] += d[i + q]; } opaque++; }
    // Margins: the outer columns and the seam between the cells stay clear, so mip levels do not bleed one spray into the other.
    if ([0, 1, 2, 253, 254, 255, 256, 257, 258, 509, 510, 511].includes(x)) assert(d[i + 3] < 6, '[texture-spray] spray touches a cell edge');
  }
  for (const [n, r, g, bl] of cell) assert(n / 65536 > .25 && n / 65536 < .7 && g > r && g > bl, '[texture-spray] sparse, solid or grey spray');
  let differ = 0; for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) if ((d[(y * 512 + x) * 4 + 3] >= 77) !== (d[(y * 512 + x + 256) * 4 + 3] >= 77)) differ++;
  assert(differ / 65536 > .08, '[texture-spray] the two sprays share one silhouette');   // measured 12.7%
  const pad = mean.map(v => Math.round(v / opaque));
  for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 6) assert.deepEqual(Array.from(d.slice(i, i + 3)), pad, '[texture-spray] transparent texels not padded with the needle mean');
  // The far forest (cedar L2) takes this image's mean: keep it within 12% of the old pine needle image per channel.
  const needle = linearMean(needleTexture()), spray = linearMean(a);
  spray.forEach((v, q) => assert(Math.abs(v / needle[q] - 1) < .12, `[texture-spray] far forest colour shifts (${q}: ${v.toFixed(4)} vs ${needle[q].toFixed(4)})`));
  a.dispose(); b.dispose();
});
// なぜ失敗したか（8.1a）: 広葉の殻は殻の向きだけで照らされ、葉の凹凸が無かった。詳細の画像は葉の絵と同じ配置で、葉ごとの傾き（RGB）と色の揺らぎ（A）を持つ。
test('leaf detail maps tilt each leaf on the leaf layout and stay neutral on average [texture-detail]', () => {
  for (const kind of ['maple', 'zelkova']) {
    const detail = leafDetailTexture(kind), leaf = (kind === 'maple' ? mapleLeafTexture : zelkovaLeafTexture)(), d = detail.image.data, l = leaf.image.data;
    assert(detail.colorSpace === THREE.NoColorSpace && detail.flipY === leaf.flipY && detail.wrapS === THREE.RepeatWrapping && detail.wrapT === THREE.RepeatWrapping, '[texture-detail] linear repeat map aligned with the leaf image');
    assert.equal(detail.userData.leafCount, leaf.userData.leafCount, '[texture-detail] layout differs from the leaf image');
    let tilted = 0, n = 0, hue = 0, unit = 0; const hues = new Set();
    for (let i = 0; i < d.length; i += 4) if (l[i + 3] >= 77) {
      const v = [d[i] / 127.5 - 1, d[i + 1] / 127.5 - 1, d[i + 2] / 127.5 - 1]; n++;
      assert(v[2] > .5, '[texture-detail] leaf normal tipped over');
      // Leaf edges blend two leaves' normals (shorter than 1); the leaf bodies stay unit.
      if (Math.abs(Math.hypot(...v) - 1) < .08) unit++;
      if (Math.hypot(v[0], v[1]) > .2) tilted++;
      hue += d[i + 3]; hues.add(d[i + 3]);
    }
    assert(unit / n > .95, '[texture-detail] leaf normals are not unit vectors');
    assert(tilted / n > .8, '[texture-detail] leaves lie flat on the shell');
    assert(Math.abs(hue / n / 255 - .5) < .08 && hues.size > 40, '[texture-detail] colour jitter biased or uniform');
    detail.dispose(); leaf.dispose();
  }
});
test('bark texture is a linear repeating data map [texture-bark]', () => {
  const bark = barkTexture();
  assert(bark.isDataTexture && bark.image.width === 128 && bark.image.height === 256 && bark.colorSpace === THREE.NoColorSpace, '[texture-bark] linear 128x256 data');
  assert(bark.wrapS === THREE.RepeatWrapping && bark.wrapT === THREE.RepeatWrapping && bark.generateMipmaps, '[texture-bark] repeat/mip');
  bark.dispose();
});
test('Lambert color, two-layer wind, shared objects and limited transmission [shader]', () => {
  const { w, m } = make(), keys = new Set();
  for (let species = 0; species < 6; species++) for (let level = 0; level < (species >= 4 ? 2 : 3); level++) {
    const pair = m.get(species, level);
    assert.equal(pair, m.get(species, level), '[shader] material cache');
    for (const kind of ['leaf', 'wood']) {
      const mat = pair[kind], s = compile(mat), v = s.vertexShader, f = s.fragmentShader;
      assert(mat instanceof THREE.MeshLambertMaterial && mat.vertexColors, '[shader] matte vertex color');
      assert.equal(mat.emissive.getHex(), 0, '[shader] fixed colored emission');
      if(kind==='leaf' && level===2)assert(mat.color.r<.8 && mat.color.g<.8 && mat.color.b<.8,'[color] far crown lost texture mean');
      assert(!keys.has(mat.customProgramCacheKey()), '[shader] cache collision'); keys.add(mat.customProgramCacheKey());
      for (const key of Object.keys(w)) assert.equal(s.uniforms[key], w[key], `[wind] ${key} object identity`);
      assert.equal(s.uniforms.uSunDir.value, sunDir, '[shader] shared sun');
      assert.match(v, /attribute float aSway/, '[wind] flutter attribute');
      assert.match(v, /heightRatio\*heightRatio/, '[wind] squared crown motion');
      assert.match(v, /dot\(treeOrigin.xz,uWindDir\)\*\.045-uTime\*\.9/, '[wind] grass phase');
      assert.match(v, /step\(\.5,uWind\)/, '[wind] reduced gust threshold');
      assert.match(v, /1\.0\+\.6\*uGuideMix/, '[wind] guide boost');
      assert.match(v, /vec2 treeMotion = \(uWindDir\*\(slow\+gust\)\+vec2\(-uWindDir.y,uWindDir.x\)\*flutter\)\*uWind;/, '[wind] all displacements scaled by uWind');
      assert.equal((v.match(/transformed \+=/g) || []).length, 1, '[wind] unscaled extra displacement');
      assert(!/objectNormal\s*=/.test(v), '[wind] normals moved');
      assert.match(v, /treeOrigin = instanceMatrix\[3\].xyz/, '[lod] distance from instance origin');
      assert.match(v, /distance\(treeOrigin,cameraPosition\)/, '[lod] full camera distance');
      assert.match(f, /totalEmissiveRadiance \+= diffuseColor.rgb\*/, '[color] diffuse-proportional lift');
      assert.match(f, /#include <color_fragment>/, '[color] instanceColor support');
      assert.match(v, /#include <color_vertex>/, '[color] instance color vertex chunk');
      assert.match(THREE.ShaderChunk.color_vertex, /vColor.xyz \*= instanceColor.xyz/, '[color] shipped Three instanceColor contract');
      if (kind === 'leaf') {
        assert.match(f, /pow\(max\(0.0,dot\(sight,normalize\(uSunDir\)\)\),3.0\)/, '[shader] sun backlight');
        assert.match(f, /min\(vec3\(\.35\),diffuseColor.rgb\*/, '[shader] bounded diffuse-proportional transmission');
        assert.match(f, /1.0-smoothstep\(30.0,100.0,vTreeDistance\)/, '[shader] transmission distance');
        // 8.1a second round: conifer sprays pass more light (.2 -> TREES.backlight.conifer) and thin edges glow (blind review: backlit).
        assert(f.includes(`backlight*${species === 0 || species === 2 ? TREES.backlight.conifer.toFixed(2) : '1.0'}`), '[shader] species transmission');
        if (level < 2) assert(f.includes(`leafThrough *= 1.0 + ${TREES.backlight.edge.toFixed(2)}*(1.0-smoothstep(.3, .95, leafAlpha));`) && f.indexOf('float leafAlpha = diffuseColor.a;') < f.indexOf('leafThrough *='), '[shader] backlit edge glow');
      }
    }
  }
  assert(m.get(1, 0).leaf.alphaToCoverage, '[shader] standard coverage'); m.dispose();
  const light = make('light').m; assert(!light.get(1, 0).leaf.alphaToCoverage, '[shader] light coverage'); light.dispose();
});
test('same-direction stable dither only in color pass [lod]', () => {
  const { m } = make('light'); const mat = m.get(1, 1).leaf, s = compile(mat);
  assert.deepEqual(s.uniforms.uLod.value.toArray(), [-1,-1,-1,-1], '[lod] specimen fade disabled');
  assert.match(s.vertexShader, /uLod.x < 0.0 \? 1.0 : smoothstep\(uLod.x,uLod.y,vTreeDistance\)/, '[lod] entering weight');
  assert.match(s.vertexShader, /uLod.z < 0.0 \? 1.0 : 1.0-smoothstep\(uLod.z,uLod.w,vTreeDistance\)/, '[lod] leaving weight');
  assert.match(s.vertexShader, /vTreeWeight = enter\*leave/, '[lod] weight product');
  assert.match(s.fragmentShader, /gl_FragCoord.xy,vec2\(\.06711056,\.00583715\)/, '[lod] stable interleaved noise');
  assert.match(s.fragmentShader, /if \(n >= vTreeWeight\) discard;/, '[lod-hole] all levels keep n < weight');
  assert(!/vTreeEntering|1.0-vTreeWeight/.test(s.vertexShader+s.fragmentShader),'[lod-hole] complementary dither returned');
  const set = createTreeSet({ species: 1, level: 0, capacity: 1, materials: m });
  assert(!set.leaf.customDepthMaterial, '[lod] custom dithered depth');
  assert(!set.wood.customDepthMaterial, '[lod] wood depth override');
  assert(!/customDepthMaterial\s*=|MeshDepthMaterial/.test(source('tree-view.js') + source('tree-materials.js')), '[lod] depth path must stay unpatched');
  for (const mesh of Object.values(set)) { mesh.geometry.dispose(); mesh.dispose(); } m.dispose();
});
test('wind expression scales slow and flutter to .4, zero stops everything [wind]', () => {
  const {m}=make(), v=compile(m.get(1,0).leaf).vertexShader;
  // Evaluate the actual GLSL scalar expressions for the two amplitudes at several phases.
  const scalar = name => v.match(new RegExp(`float ${name} = ([^;]+);`))[1];
  const slow = new Function('uTime','ph','heightRatio',`return ${scalar('slow').replaceAll('sin(', 'Math.sin(')}`);
  const flutter = new Function('uTime','ph','position','aSway',`return ${scalar('flutter').replaceAll('sin(', 'Math.sin(')}`);
  const multiplier = v.match(/vec2 treeMotion = ([^;]+);/)[1].endsWith('*uWind') ? u => u : () => 1;
  for (const t of [0,1,5]) for (const h of [.2,.8,1]) {
    const base=slow(t,.7,h)+flutter(t,.7,{y:4},.8);
    assert(Math.abs(base*multiplier(.4)-base*.4)<1e-12,'[wind] reduced motion amplitude');
    assert(base*multiplier(0)===0,'[wind] zero wind');
  }
  m.dispose();
});
test('instance capacity and stage colors use linear palette interpolation [instance/color]', () => {
  const {m}=make();
  for (const level of [0,1,2]) {
    const set=createTreeSet({species:1,level,capacity:7,materials:m});
    for (const mesh of Object.values(set)) {
      assert(mesh instanceof THREE.InstancedMesh && mesh.instanceMatrix.count===7 && mesh.instanceColor.count===7,'[instance] capacity');
      assert.equal(mesh.count,0,'[instance] initial active count');
      assert(!mesh.frustumCulled && mesh.receiveShadow===(level<2) && mesh.castShadow===(level===0),'[instance] culling/shadow');
      assert(mesh.instanceMatrix.usage===THREE.DynamicDrawUsage && mesh.instanceColor.usage===THREE.DynamicDrawUsage,'[instance] dynamic buffers');
      assert.notEqual(mesh.geometry,treeGeometry(1,level).leaf,'[dispose] borrowed template'); mesh.geometry.dispose(); mesh.dispose();
    }
  }
  for (const [species,key,variant] of [[1,'zelkova',0],[3,'maple',0],[4,'maple',1],[5,'shrub',0]]) {
    const colors=TREES.palette[key].map(c=>new THREE.Color(c));
    for(let k=0;k<colors.length-1;k++) for(const f of [0,.2,.5,.8,1]) {
      const c=stageColor(species,(k+f)/(colors.length-1),.5,variant), expected=colors[k].clone().lerp(colors[k+1],f);
      assert(c.toArray().every((v,i)=>Math.abs(v-expected.toArray()[i])<1e-6),'[color] piecewise monotonic interpolation');
    }
  }
  assert.deepEqual(stageColor(0,0).toArray(),stageColor(0,1).toArray(),'[color] cedar hue independent of stage');
  assert.deepEqual(stageColor(2,0).toArray(),stageColor(2,1).toArray(),'[color] pine hue independent of stage');
  assert.notDeepEqual(stageColor(4,.8,.5,0).toArray(),stageColor(4,.8,.5,1).toArray(),'[color] sapling variant');
  assert.notEqual(m.get(4,0,0).leaf.map,m.get(4,0,1).leaf.map,'[texture] variant map');
  assert.equal(m.get(4,0,1).leaf.map,m.get(3,0).leaf.map,'[texture] maple reuse');
  assert.equal(m.get(5,0).leaf.map,m.get(1,0).leaf.map,'[texture] shrub reuse');
  m.dispose();
});
test('specimen placement, variants and complete idempotent ownership disposal [specimen/dispose]', () => {
  const items=[{species:1,level:0,stage:.5},{species:4,level:1,stage:.8,variant:1,scale:1.2},{species:0,level:2,stage:0}];
  const spec=buildSpecimens({terrain:{heightAt:(x,z)=>x*.2+z*.1},wind:wind(),sunDir,at:[2,4],yaw:Math.PI/2,spacing:6,items});
  assert.equal(spec.items.length,3,'[specimen] item count');
  for(let k=0;k<3;k++) {
    const i=spec.items[k]; assert(Math.abs(i.x-2)<1e-6 && Math.abs(i.z-(10-k*6))<1e-6,'[specimen] Three Y rotation convention');
    assert.equal(i.y,i.x*.2+i.z*.1,'[specimen] terrain placement');
    const actual=new THREE.Color();spec.group.children[k*2].getColorAt(0,actual);
    const expectedColor=stageColor(i.species,i.stage,.5,items[k].variant??0);
    assert(actual.toArray().every((v,j)=>Math.abs(v-expectedColor.toArray()[j])<1e-6),'[color] specimen instance color');
    assert.equal(i.height,treeGeometry(i.species,i.level).height*(items[k].scale??1),'[specimen] scaled height');
    assert.deepEqual(Object.keys(i),['species','level','stage','x','y','z','height'],'[specimen] plain metadata');
  }
  const group=spec.group, resources=new Set(), events=new Map();
  group.traverse(mesh=>{if(!mesh.isMesh)return;for(const r of [mesh,mesh.geometry,mesh.material,mesh.material.map].filter(Boolean))resources.add(r);});
  for(const r of resources)r.addEventListener('dispose',()=>events.set(r,(events.get(r)||0)+1));
  const parent=new THREE.Group();parent.add(group); spec.dispose();spec.dispose();
  assert.equal(parent.children.length,0,'[dispose] scene removal');
  assert.equal(group.children.length,0,'[dispose] group clearing');
  for(const r of resources)assert.equal(events.get(r),1,`[dispose] ${r.type||'texture'} not released exactly once`);
  const {m}=make();const p=m.get(1,0);let materialDisposals=0,textureDisposals=0;
  for(const mat of [p.leaf,p.wood])mat.addEventListener('dispose',()=>materialDisposals++);
  // All seven owned textures, even those unused in this material pair, must be freed: four leaf images, two leaf
  // detail maps and the bark image (held in a shader uniform, not in a material slot).
  const maps=new Set([m.get(0,0).leaf.map,m.get(1,0).leaf.map,m.get(3,0).leaf.map,m.get(2,0).leaf.map,m.get(1,0).leaf.normalMap,m.get(3,0).leaf.normalMap,compile(m.get(1,0).wood).uniforms.uBark.value]);
  assert.equal(maps.size,7,'[dispose] owned texture set');
  for(const map of maps)map.addEventListener('dispose',()=>textureDisposals++);
  m.dispose();m.dispose();assert.equal(materialDisposals,2,'[dispose] materials');assert.equal(textureDisposals,7,'[dispose] textures');
  assert.throws(()=>m.get(1,0),/disposed/,'[dispose] use after disposal');
});
test('QA lazily installs, replaces and clears specimens with plain JSON [qa]', async()=>{
  globalThis.window={};
  const {installQA}=await load('qa.js');
  const scene=new THREE.Scene(), game={input:{},scene,terrain:{heightAt:()=>2},veg:{wind:wind()},post:{quality:'standard'}};
  const api=installQA(game,{}), opts={at:[0,0],yaw:0,spacing:5,items:[{species:3,level:0,stage:.5}]};
  assert.equal(scene.children.length,0,'[qa] eager specimens');
  const a=await api.treeSpecimens(opts);assert.equal(scene.children.length,1,'[qa] scene not attached');
  assert.deepEqual(JSON.parse(JSON.stringify(a)),a,'[qa] JSON metadata');assert.deepEqual(Object.keys(a),['items'],'[qa] Three object escaped');
  let disposed=0;scene.children[0].children[0].geometry.addEventListener('dispose',()=>disposed++);
  await api.treeSpecimens(opts);assert.equal(scene.children.length,1,'[qa] previous specimen retained');assert.equal(disposed,1,'[qa] replacement leak');
  api.clearTreeSpecimens();assert.equal(scene.children.length,0,'[qa] clear failed');
  const pending=api.treeSpecimens(opts);api.clearTreeSpecimens();await pending;assert.equal(scene.children.length,0,'[qa] asynchronous resurrection');
  assert(!/^import .*tree-(view|materials|geometry|textures)/m.test(source('qa.js')),'[qa] eager tree module import');
  assert.match(source('main.js'),/if \(QA\) installQA/,'[qa] normal play guard');
});

test('needle routing, untextured core and diffuse gain [texture-routing/core/color]',()=>{
  // 8.1a: near and middle cedar tufts share the spray atlas; the pine fans keep the needle image; the fringe left with the skirts.
  const {m}=make(), spray=m.get(0,0).leaf.map, needle=m.get(2,0).leaf.map;
  assert(spray.userData.variants===2 && m.get(0,1).leaf.map===spray,'[texture-routing] cedar tufts need the spray atlas at L0 and L1');
  assert.notEqual(needle,spray,'[texture-routing] pine shares the cedar spray');
  for(const level of [0,1])assert(m.get(2,level).leaf.map===needle,'[texture-routing] pine fan requires needle map');
  for(let species=0;species<6;species++)for(let level=0;level<(species>=4?2:3);level++) {
    const pair=m.get(species,level);
    assert.equal(pair.wood.map,null,'[core] wood core must be untextured');
    if(level<2)assert.equal(pair.leaf.color.r,species>=4?1.1:[1,3].includes(species)?1.25:1,'[color-gain] near/mid gain must follow broadleaf/understory/conifer');
    assert.equal(pair.wood.color.r,1,'[color-gain] wood tinted by gain');
    if(level===2)assert.equal(pair.leaf.map,null,'[texture-routing] far uses mean');
  }
  m.dispose();
});

// なぜ失敗したか: ライムと色玉が夕景から浮いた。段階表と個体の明度幅を分けて固定する。
test('muted seasonal palettes and twelve percent brightness spread [palette/tint]',()=>{
  assert.deepEqual(TREES.palette.zelkova,['#6a7f3a','#a09a45','#c2a040','#96683a'],'[palette] saturated zelkova');
  assert.deepEqual(TREES.palette.shrub,['#4a6234','#6f7a3c','#85603a'],'[palette] saturated shrub');
  assert.deepEqual(TREES.palette.maple,['#5d7a35','#b88a30','#c2652c','#a2412c'],'[palette] protected maple');
  for(const sp of [1,3,4,5])for(const tint of [0,.25,.5,1]) {
    const base=stageColor(sp,.53,.5).toArray(),actual=stageColor(sp,.53,tint).toArray();
    actual.forEach((v,i)=>assert(Math.abs(v/base[i]-(.88+.24*tint))<1e-6,'[tint] brightness spread must be .88–1.12'));
  }
});

// なぜ失敗したか: 山腹の杉が同じ錐に並び、葉脈が布の模様になった。
test('cedar position-stable height profile precedes wind at every level [cedar-profile]',()=>{
  const {m}=make();
  for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++)for(const kind of ['leaf','wood']) {
    const v=compile(m.get(sp,l)[kind]).vertexShader;
    assert.equal(v.includes('transformed.xz *= prof;'),sp===0,'[cedar-profile] wrong species/profile missing');
    if(sp!==0)continue;
    assert(v.includes(`float prof = 1.0 + ${[.06,.12,.16][l].toFixed(2)} * (0.6*sin(ph1 + position.y*0.55) + 0.4*sin(ph2 + position.y*1.3));`),'[cedar-profile] amplitude/frequency contract');
    assert(v.includes('dot(treeOrigin.xz,vec2(12.9898,78.233))') && v.includes('dot(treeOrigin.xz,vec2(39.346,11.135))'),'[cedar-phase] phases must depend on individual position');
    assert(v.indexOf('transformed.xz *= prof;')<v.indexOf('float slow ='),'[cedar-order] profile after wind');
  }
  m.dispose();
});
test('soft leaf veins retain bright edges [texture-vein]',()=>{
  assert.match(source('tree-textures.js'),/gray\(v \* \.72\); g.lineWidth = \.8/,'[texture-vein] veins too dark');
  assert.match(source('tree-textures.js'),/gray\(Math.min\(1, v \* 1.12\)\)/,'[texture-edge] bright edge lost');
});

// なぜ失敗したか: MSAAの前に重みを掛けると葉の切り抜きが痩せ、OPAQUEでは溶かしが消える。
test('quality selects coverage after alpha test for every color material [coverage/order]',()=>{
  for(const quality of ['standard','light']) {
    const {m}=make(quality),coverage=quality!=='light';
    for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++)for(const kind of ['leaf','wood']) {
      const mat=m.get(sp,l)[kind],s=compile(mat),f=s.fragmentShader;
      assert.equal(mat.alphaToCoverage,coverage,'[coverage/opaque] every standard material needs coverage');
      assert.equal(f.includes('diffuseColor.a *= vTreeWeight;'),coverage,'[coverage/mode] wrong fade algorithm');
      assert.equal(f.includes('if (n >= vTreeWeight) discard;'),!coverage,'[coverage/dither] light only');
      if(coverage)assert.match(f,/#include <alphatest_fragment>\s*diffuseColor.a \*= vTreeWeight;/,'[coverage/order] weight must follow alpha test coverage');
      assert(mat.customProgramCacheKey().endsWith(coverage?'-coverage':'-dither'),'[coverage/cache] algorithm missing');
      assert.deepEqual(s.uniforms.uLod.value.toArray(),[-1,-1,-1,-1],'[coverage/disabled] specimen weight');
    }
    m.dispose();
  }
  assert.match(THREE.ShaderChunk.alphatest_fragment,/ALPHA_TO_COVERAGE/,'[coverage/chunk] shipped alpha test contract');
  assert.match(THREE.ShaderChunk.opaque_fragment,/#ifdef OPAQUE/,'[coverage/opaque] shipped opaque contract');
});

// なぜ失敗したか: 葉を片面にすると殻の内側が抜けて樹冠に穴が開き、切り抜きの閾値を変えると葉の被覆が変わる。材質の値を見る試験が無かった。
test('foliage is double-sided with a fixed .3 alpha cut; wood is front-sided and uncut [side/alpha-test]',()=>{
  for(const quality of ['standard','light']) {
    const {m}=make(quality);
    for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++) {
      const {leaf,wood}=m.get(sp,l);
      assert.equal(leaf.side,THREE.DoubleSide,'[side] foliage must be double-sided');
      assert.equal(wood.side,THREE.FrontSide,'[side] wood must be front-sided');
      assert.equal(leaf.alphaTest,leaf.map?.3:0,'[alpha-test] foliage cut threshold changed');
      assert.equal(wood.alphaTest,0,'[alpha-test] wood must not be cut');
    }
    m.dispose();
  }
});

// The shipped basis block uses only mat3/vec3/dot/max; translate it to JS (instancing on) and run it.
function windToLocal(block) {
  const body=block.replace(/#ifdef USE_INSTANCING|#endif/g,'').replace(/\b(?:mat3|vec3) (\w+) =/g,'let $1 =')
    .replace(/(mat3\(\w+\))\*(mat3\(\w+\))/g,'mul($1,$2)').replace(/transformed \+= ([\s\S]+);\s*$/,'transformed = add(transformed,$1);');
  let fn;
  try { fn=new Function('mat3','mul','vec3','dot','max','add','modelMatrix','instanceMatrix','treeMotion',`let transformed=[0,0,0];\n${body}\nreturn transformed;`); }
  catch { assert.fail('[wind-basis] basis block is no longer the expected mat3/vec3 subset'); }
  const mat3=m=>[0,1,2].map(c=>[0,1,2].map(r=>m.elements[c*4+r]));
  const mul=(a,b)=>b.map(col=>[0,1,2].map(r=>a[0][r]*col[0]+a[1][r]*col[1]+a[2][r]*col[2]));
  const vec3=(...v)=>v,dot=(a,b)=>a[0]*b[0]+a[1]*b[1]+a[2]*b[2],add=(a,b)=>a.map((v,i)=>v+b[i]);
  return (model,instance,motion)=>fn(mat3,mul,vec3,dot,Math.max,add,model,instance,motion);
}
// なぜ失敗したか: 風の変位を世界のまま局所へ足すと、回した・傾けた・伸ばした個体で風向きと振幅が狂う。式の文字の有無だけでは退行を見逃した。
test('wind displacement returns the world wind through the instance basis [wind-basis]',()=>{
  const {m}=make();
  for(const [sp,l] of [[0,0],[1,1],[2,2],[3,0],[5,1]]) {
    const v=compile(m.get(sp,l).leaf).vertexShader,block=v.slice(v.indexOf('mat3 treeBasis'),v.indexOf('vec4 treeWorld'));
    assert.match(block,/#ifdef USE_INSTANCING\s*treeBasis = mat3\(modelMatrix\)\*mat3\(instanceMatrix\);\s*#endif/,'[wind-basis] instance rotation/scale ignored');
    const toLocal=windToLocal(block);
    for(const yaw of [0,.7,2.4])for(const [sx,sy] of [[1,1],[1.3,.9],[.85,1.3]])for(const model of [new THREE.Matrix4(),new THREE.Matrix4().makeRotationY(.3)]) {
      const instance=new THREE.Matrix4().compose(new THREE.Vector3(5,1,-3),new THREE.Quaternion().setFromEuler(new THREE.Euler(.05,yaw,-.04,'YXZ')),new THREE.Vector3(sx,sy,sx));
      const local=toLocal(model,instance,{x:.3,y:-.2});
      const world=new THREE.Vector3(...local).applyMatrix3(new THREE.Matrix3().setFromMatrix4(model.clone().multiply(instance)));
      assert(Math.abs(world.x-.3)<1e-9&&Math.abs(world.y)<1e-9&&Math.abs(world.z+.2)<1e-9,'[wind-basis] local displacement does not reproduce the world wind');
    }
  }
  m.dispose();
});

// なぜ失敗したか: 揺れの高さ比を全種で杉の20mで割ると、低木・楓・若木がほとんど揺れない。2乗の項の有無しか見ていなかった。
test('wind height ratio uses each species height [wind-height]',()=>{
  const {m}=make();
  for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++)for(const kind of ['leaf','wood'])
    assert(compile(m.get(sp,l)[kind]).vertexShader.includes(`float heightRatio = clamp(position.y/${treeGeometry(sp,l).height.toFixed(1)},0.0,1.0);`),`[wind-height] species ${sp} sways against another height`);
  m.dispose();
});

// sRGB bytes decode to linear light (IEC 61966-2-1) before the alpha-weighted mean; .3 is the alpha cut.
const toLinear=c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4;
function linearMean(texture) {
  const a=texture.image.data,sum=[0,0,0];let weight=0;
  for(let i=0;i<a.length;i+=4)if(a[i+3]>=Math.ceil(.3*255)){const w=a[i+3]/255;weight+=w;for(let k=0;k<3;k++)sum[k]+=toLinear(a[i+k]/255)*w;}
  return sum.map(v=>v/weight);
}
// なぜ失敗したか: 遠景の平均色をsRGBの値のまま平均すると約5%暗く、楓に欅の絵の平均を使っても、広葉の遠景にゲインが無くても、「0.8未満」の検査は通った。
test('far crowns take the linear-light mean of their own near texture [far-mean/color-gain]',()=>{
  const {m}=make();
  for(const sp of [0,1,2,3]) {
    const expected=linearMean(m.get(sp,0).leaf.map).map(v=>v*([1,3].includes(sp)?TREES.leafGain:1)),actual=m.get(sp,2).leaf.color.toArray();
    assert(actual.every((v,i)=>Math.abs(v-expected[i])<1e-6),`[far-mean] species ${sp} far colour is not its near texture mean in linear light (broadleaf gain ${TREES.leafGain}, conifer none)`);
  }
  assert.notDeepEqual(m.get(1,2).leaf.color.toArray(),m.get(3,2).leaf.color.toArray(),'[far-mean] maple and zelkova share one far mean');
  m.dispose();
});

// なぜ失敗したか（8.1a）: 幹は無地、広葉の葉は殻の向きだけで照らされ、杉の房はカードごとに表裏で明暗が反転した。段は個体どうしで水平にそろった。
test('wood samples the shared bark only off foliage cores; leaves never do [bark-shader]',()=>{
  for(const quality of ['standard','light']) {
    const {m}=make(quality);let bark=null;
    for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++) {
      const wood=compile(m.get(sp,l).wood),leaf=compile(m.get(sp,l).leaf);
      assert(wood.uniforms.uBark?.value?.isDataTexture,'[bark-shader] wood lacks the bark image');
      bark??=wood.uniforms.uBark.value;assert.equal(wood.uniforms.uBark.value,bark,'[bark-shader] bark image not shared');
      assert.equal(wood.uniforms.uBarkRelief.value,TREES.bark.relief,'[bark-shader] relief uniform');
      assert(wood.vertexShader.includes('vBarkUv = uv; vBarkHeight = position.y;'),'[bark-shader] bark UV varying');
      assert(wood.fragmentShader.includes('float barkOn = step(-0.5, vBarkUv.x);'),'[bark-shader] foliage cores (UV -1) not masked');
      assert(wood.fragmentShader.includes('diffuseColor.rgb *= mix(1.0, barkTexel.r*2.0, barkOn);'),'[bark-shader] bark brightness (mean gain 1)');
      assert(/smoothstep\(-0\.15, 1\.1, vBarkHeight\)/.test(wood.fragmentShader),'[bark-shader] ground contact darkening');
      assert.equal(wood.fragmentShader.includes(`mix(1.0, ${TREES.bark.crownShade.toFixed(2)}, smoothstep(2.6, 5.5, vBarkHeight)*barkOn)`),sp===0,'[bark-shader] cedar crown shade on the wrong species');
      assert(/barkT\*\(barkTilt\.x\*barkScale\)/.test(wood.fragmentShader)&&wood.fragmentShader.indexOf('#include <normal_fragment_maps>')<wood.fragmentShader.indexOf('barkQ0'),'[bark-shader] bark relief after the normal setup');
      assert(!leaf.uniforms.uBark && !/barkTexel|vBarkUv/.test(leaf.vertexShader+leaf.fragmentShader),'[bark-shader] foliage samples bark');
    }
    m.dispose();
  }
});
test('broadleaf leaves carry per-leaf normals, colour jitter and rim erosion; conifers do not [leaf-detail]',()=>{
  const {m}=make();
  for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++) {
    const mat=m.get(sp,l).leaf,f=compile(mat).fragmentShader,broad=sp!==0&&sp!==2&&l<2;
    assert.equal(!!mat.normalMap,broad,'[leaf-detail] detail map on the wrong leaves');
    if(broad) {
      assert(mat.normalMap===m.get(sp,l).leaf.normalMap && mat.normalMap.userData.leafCount===mat.map.userData.leafCount,'[leaf-detail] detail map does not follow the leaf image');
      assert.equal(mat.normalScale.x,TREES.leafDetail.normal,'[leaf-detail] normal strength');
      assert(f.includes('vec4 leafDetail = texture2D(normalMap, vNormalMapUv);'),'[leaf-detail] colour jitter source');
      assert(f.includes(`1.0+${TREES.leafDetail.hue.toFixed(3)}*leafHue`)&&f.includes(`1.0-${TREES.leafDetail.hue.toFixed(3)}*leafHue`),'[leaf-detail] warm/cool jitter');
      assert(f.indexOf('diffuseColor.a *= smoothstep(.12, .46')<f.indexOf('#include <alphatest_fragment>'),'[leaf-detail] rim erosion must cut before the alpha test');
      assert(f.includes(`(leafDetail.a-.5)*${TREES.leafDetail.rim.toFixed(2)}`),'[leaf-detail] rim erosion ignores the leaf');
      assert(/leafThrough = \.55 \+ \.45\*max\(0\.0, dot\(normal/.test(f),'[leaf-detail] transmission ignores the leaf orientation');
    } else assert(!/leafDetail|leafHue/.test(f),'[leaf-detail] jitter on leaves without a detail map');
  }
  m.dispose();
});
test('cedar tufts are lit as one crown and fade when seen edge-on [crown-lit]',()=>{
  const {m}=make();
  for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++) {
    const f=compile(m.get(sp,l).leaf).fragmentShader,cedar=sp===0&&l<2;
    assert.equal(f.includes('normal = normalize(vNormal); nonPerturbedNormal = normal;'),cedar,'[crown-lit] per-card flip on cedar tufts, or crown lighting elsewhere');
    assert(!cedar||f.indexOf('normal = normalize(vNormal);')>f.indexOf('#include <normal_fragment_begin>'),'[crown-lit] reset must follow the face flip');
    assert.equal(f.includes('vec3 cardFace = cross(dFdx(vViewPosition), dFdy(vViewPosition));')&&f.includes('diffuseColor.a *= smoothstep(.04, .22, abs(dot(cardFace, normalize(vViewPosition))) / max(length(cardFace), 1e-8));'),cedar,'[crown-lit] edge-on card fade');
  }
  m.dispose();
});
// The tier tilt is a position-stable shear: evaluate the shipped GLSL expression and check direction and amplitude per band.
test('cedar tiers lean a position-dependent way at every level [tier-tilt]',()=>{
  const {m}=make();
  for(let sp=0;sp<6;sp++)for(let l=0;l<(sp>=4?2:3);l++)for(const kind of ['leaf','wood']) {
    const v=compile(m.get(sp,l)[kind]).vertexShader;
    assert.equal(v.includes('float tierTurn = ph1*1.7 + position.y*0.43;'),sp===0,'[tier-tilt] tilt on the wrong species');
    if(sp!==0)continue;
    assert(v.includes(`* ${TREES.tierTilt[l].toFixed(3)} * (0.55 + 0.45*sin(ph2 + position.y*0.91));`),'[tier-tilt] amplitude per level');
    assert(v.indexOf('transformed.xz *= prof;')<v.indexOf('float tierTurn')&&v.indexOf('float tierTurn')<v.indexOf('float slow ='),'[tier-tilt] tilt must follow the profile and precede wind');
  }
  assert(TREES.tierTilt[0]<TREES.tierTilt[1]&&TREES.tierTilt[1]<=TREES.tierTilt[2]&&TREES.tierTilt[0]<=.06,'[tier-tilt] near tilt must stay small (shadow map is untilted)');
  const tilt=(x,z,y,ph1,ph2,amp)=>{const turn=ph1*1.7+y*.43;return (x*Math.cos(turn)+z*Math.sin(turn))*amp*(.55+.45*Math.sin(ph2+y*.91));};
  const bands=[3,5,7,9,11].map(y=>Math.atan2(tilt(0,1,y,1.3,.4,1),tilt(1,0,y,1.3,.4,1)));
  assert(new Set(bands.map(a=>a.toFixed(1))).size===5,'[tier-tilt] bands lean the same way');
  m.dispose();
});

// --- 8.1a second round ---------------------------------------------------------------------------------------------
const fullShader = () => ({ uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <color_vertex>', fragmentShader: '#include <common>\n#include <map_fragment>\n#include <color_fragment>\n#include <alphatest_fragment>\n#include <normal_fragment_begin>\n#include <normal_fragment_maps>\n#include <emissivemap_fragment>\n#include <fog_fragment>' });
function compileFull(m) { const shader = fullShader(); m.onBeforeCompile(shader); return shader; }
// The shipped GLSL frame choice, translated to JS: atan(x,z), mod, floor, smoothstep, as the vertex stage evaluates them.
function glslView(v) {
  const expr = name => v.match(new RegExp(`${name} = ([^;]+);`))[1];
  const js = e => e.replace(/atan\(/g, 'Math.atan2(').replace(/floor\(/g, 'Math.floor(').replace(/mod\(/g, 'mod(').replace(/smoothstep\(/g, 'smoothstep(');
  const mod = (x, y) => x - y * Math.floor(x / y), smoothstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  const u = new Function('impDir', 'mod', `return ${js(expr('float impU'))}`), b = new Function('impA', 'mod', `return ${js(expr('impB'))}`), t = new Function('impU', 'impA', 'smoothstep', `return ${js(expr('vImpT'))}`);
  return az => { const impDir = { x: Math.sin(az), y: Math.cos(az) }, U = u(impDir, mod), A = Math.floor(U); return { a: A, b: b(A, mod), t: t(U, A, smoothstep) }; };
}
// なぜ失敗したか（第2周）: 遠景の円錐は見晴らしで段の針葉樹に見えた。絵の板は、木の局所の方位で8枚の絵から2枚を選び、帯の中だけ混ぜる。
// GLSLの選び方が純粋な層（tree-impostor.js）とずれると、回ると絵が跳ねる。全方位でGLSLとJSを照合する。
test('impostor shader picks the same frames as the pure view choice [impostor-view]', () => {
  const w = wind(), atlas = { albedo: new THREE.Texture(), normal: new THREE.Texture() };
  for (const quality of ['standard', 'light']) {
    const m = impostorMaterial({ wind: w, sunDir, quality, frame: [.1, .2, .05, .06], atlas, height: 12 }), s = compileFull(m), v = s.vertexShader, f = s.fragmentShader;
    const view = glslView(v);
    for (let k = 0; k <= 720; k++) {
      const az = k / 720 * Math.PI * 2 - .001, got = view(az), want = impostorView(((az % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2));
      // The shader's 6.2831853 differs from 2π in the ninth digit; the GPU computes in float32 anyway.
      assert(got.a === want.a && got.b === want.b && Math.abs(got.t - want.t) < 1e-6, `[impostor-view] frame choice differs at ${az.toFixed(3)}`);
    }
    assert(v.includes('vImpUvA = uImpFrame.xy + vec2(impA * uImpStep, 0.0) + uv * uImpFrame.zw;') && v.includes('vImpUvB = uImpFrame.xy + vec2(impB * uImpStep, 0.0) + uv * uImpFrame.zw;'), '[impostor-view] frame UVs');
    assert.equal(s.uniforms.uImpStep.value, 1 / IMPOSTOR.views, '[impostor-view] column step');
    assert(v.includes('transformed = impRight * position.x + vec3(0.0, position.y, 0.0);'), '[impostor-view] board does not turn to the camera');
    assert(v.indexOf('transformed = impRight') < v.indexOf('transformed +=') && (v.match(/transformed \+=/g) || []).length === 1, '[wind] board sway must follow the turn, once');
    for (const key of Object.keys(w)) assert.equal(s.uniforms[key], w[key], `[wind] ${key} object identity`);
    assert(v.includes('float heightRatio = clamp(position.y/12.0,0.0,1.0);') && /step\(\.5,uWind\)/.test(v) && /\*uWind;/.test(v), '[wind] board sway');
    assert(v.includes('vTreeDistance = distance(treeOrigin,cameraPosition);') && v.includes('vTreeWeight = enter*leave;'), '[lod] board LOD weights');
    assert.equal(m.alphaToCoverage, quality !== 'light', '[coverage/opaque] board coverage');
    assert.equal(f.includes('diffuseColor.a *= vTreeWeight;'), quality !== 'light', '[coverage/mode] board fade');
    assert.equal(f.includes('if (n >= vTreeWeight) discard;'), quality === 'light', '[coverage/dither] board dither');
    assert(f.includes('diffuseColor.rgb *= mix(vec3(vImpWood), vColor.rgb, step(.5, impNormal.a));'), '[impostor] leaves take the instance colour, trunks the bark brightness');
    assert(f.includes('normal = normalize(impN.x * vImpRight + impN.y * vImpUp + impN.z * vImpFwd);'), '[impostor] baked normal not rebuilt on the board');
    assert(f.indexOf('impAlbedo.a = min(1.0') > f.indexOf('vec4 impAlbedo'), '[impostor] far alpha thins out with the mip level');
    assert.equal(m.alphaTest, TREES.impostor.alphaTest, '[impostor] alpha cut');
    assert(m.customProgramCacheKey() === impostorMaterial({ wind: w, sunDir, quality, frame: [.5, .5, .1, .1], atlas }).customProgramCacheKey(), '[impostor] families must share one program');
    m.dispose();
  }
});
// 板の大きさは、焼いた枠と同じ（幹を中心、根元を下端）。uv は枠の0〜1。
test('impostor boards span their baked frame [impostor-board]', () => {
  const fit = frameFit({ half: 3.4, bottom: -.1, top: 20.2 }), g = impostorGeometry(fit), p = g.getAttribute('position'), uv = g.getAttribute('uv');
  assert.equal(g.index.count, 6, '[impostor-board] two triangles');
  const xs = Array.from({ length: 4 }, (_, i) => p.getX(i)), ys = Array.from({ length: 4 }, (_, i) => p.getY(i));
  const close = (a, b) => Math.abs(a - b) < 1e-6;
  assert(close(Math.min(...xs), -3.4) && close(Math.max(...xs), 3.4) && close(Math.min(...ys), -.1) && close(Math.max(...ys), 20.2), '[impostor-board] board does not match the frame');
  for (let i = 0; i < 4; i++) assert(Math.abs(uv.getX(i) - (p.getX(i) + 3.4) / 6.8) < 1e-6 && Math.abs(uv.getY(i) - (p.getY(i) + .1) / 20.3) < 1e-6, '[impostor-board] uv does not follow the board');
  g.dispose();
});
// 焼き付けは2回（色・法線）だけ描き、描き先・消去色・自動消去を元に戻し、一時の形と材質を捨てる。
test('the bake renders both atlases once and restores the renderer [impostor-bake]', () => {
  const { w, m } = make(), r = stubRenderer(), imp = treeImpostors({ wind: w, sunDir, materials: m });
  const ms = imp.bake(r), renders = r.calls.filter(c => c[0] === 'render');
  assert(Number.isFinite(ms) && imp.baked, '[impostor-bake] not baked');
  assert.deepEqual(renders.map(c => c[3]), [imp.targets.albedo, imp.targets.normal], '[impostor-bake] atlases rendered out of order or twice');
  assert(renders.every(c => c[4] === true), '[impostor-bake] atlases not cleared before the bake');
  assert.equal(r.state.target, 'screen', '[impostor-bake] render target not restored'); assert.equal(r.state.alpha, .25, '[impostor-bake] clear alpha not restored');
  assert.equal(r.state.color.getHex(), 0x123456, '[impostor-bake] clear colour not restored'); assert.equal(r.state.autoClear, false, '[impostor-bake] autoClear not restored');
  const scene = renders[0][1];
  assert.equal(scene.children.length, 0, '[impostor-bake] temporary meshes kept in the bake scene');
  assert(imp.targets.albedo.texture.colorSpace === THREE.SRGBColorSpace && imp.targets.normal.texture.colorSpace === THREE.NoColorSpace, '[impostor-bake] atlas colour spaces');
  assert(imp.targets.albedo.texture.generateMipmaps && imp.targets.albedo.samples === 0 && imp.targets.normal.samples === 0, '[impostor-bake] atlas mips, or multisample buffers kept after the bake');
  const lost = treeImpostors({ wind: w, sunDir, materials: m }), fail = stubRenderer({ fail: true });
  assert.throws(() => lost.bake(fail), /context lost/, '[impostor-bake] bake error swallowed');
  assert.equal(fail.state.target, 'screen', '[impostor-bake] failed bake left its target bound');
  let disposed = 0; for (const t of Object.values(imp.targets)) t.addEventListener('dispose', () => disposed++);
  const mat = imp.material(0, 0); let matDisposed = 0; mat.addEventListener('dispose', () => matDisposed++);
  imp.dispose(); imp.dispose(); assert(disposed === 2 && matDisposed === 1, '[impostor-bake] owned resources not released exactly once');
  assert.throws(() => imp.material(0, 0), /disposed/, '[impostor-bake] use after disposal');
  lost.dispose(); m.dispose();
});
// なぜ失敗したか（第2周）: カメラが樹冠に入ると画面が緑一色になった。近くの葉だけ距離で薄くする（影はそのまま）。
test('near and middle foliage thins out right in front of the camera [near-fade]', () => {
  for (const quality of ['standard', 'light']) {
    const { m } = make(quality);
    for (let sp = 0; sp < 6; sp++) for (let l = 0; l < (sp >= 4 ? 2 : 3); l++) for (const kind of ['leaf', 'wood']) {
      const f = compileFull(m.get(sp, l)[kind]).fragmentShader, on = kind === 'leaf' && l < 2;
      const line = `float nearKeep = smoothstep(${TREES.nearFade[0].toFixed(2)}, ${TREES.nearFade[1].toFixed(2)}, length(vViewPosition));`;
      assert.equal(f.includes(line), on, `[near-fade] ${sp}/${l}/${kind}`);
      if (!on) continue;
      assert(f.indexOf(line) > f.indexOf('#include <alphatest_fragment>'), '[near-fade] fade must follow the alpha test');
      assert(f.includes(quality === 'light' ? 'if (n >= nearKeep) discard;' : 'diffuseColor.a *= nearKeep;'), '[near-fade] wrong fade mode');
    }
    m.dispose();
  }
  const [a, b] = TREES.nearFade, smoothstep = (x, y, d) => { const t = Math.max(0, Math.min(1, (d - x) / (y - x))); return t * t * (3 - 2 * t); };
  for (let d = 0; d <= 3; d += .05) assert(Math.abs(nearFade(d, TREES.nearFade) - smoothstep(a, b, d)) < 1e-12, '[near-fade] shader and pure fade disagree');
  assert(a < b && b < 2.4 && a > 0, '[near-fade] distances outside the third-person camera (3.6m)');
  assert(!/customDepthMaterial|MeshDepthMaterial/.test(source('tree-materials.js')), '[near-fade] shadows must keep the full crown');
});
// なぜ失敗したか（第2周）: 広葉の房が丸い球に見えた。葉の群れ（約0.4m）で縁を欠き、隙間を開け、隙間から見える内側は陰にする。
test('broadleaf clusters break their rims by leaf groups and open shaded gaps [leaf-group]', () => {
  const { m } = make();
  for (let sp = 0; sp < 6; sp++) for (let l = 0; l < (sp >= 4 ? 2 : 3); l++) {
    const mat = m.get(sp, l).leaf, f = compileFull(mat).fragmentShader, on = !!mat.normalMap;
    // Understory leaves are drawn larger: milder groups and fewer gaps (adult strengths read as moth-eaten saplings).
    const group = sp >= 4 ? TREES.leafDetail.smallGroup : TREES.leafDetail.group, gap = sp >= 4 ? TREES.leafDetail.smallGap : TREES.leafDetail.gap;
    assert.equal(f.includes(`(leafGroup-.5)*${group.toFixed(2)}`), on, '[leaf-group] rim erosion by leaf groups');
    assert.equal(f.includes(`smoothstep(${gap.toFixed(2)}, ${(gap + .08).toFixed(2)}, texture2D(normalMap, vNormalMapUv*.23+.61).a)`), on, '[leaf-group] gaps');
    assert.equal(f.includes(`if (!gl_FrontFacing) diffuseColor.rgb *= ${TREES.leafDetail.inner.toFixed(2)};`), on, '[leaf-group] inner face shade');
    if (on) assert(f.indexOf('leafGroup') < f.indexOf('#include <alphatest_fragment>'), '[leaf-group] erosion must cut before the alpha test');
  }
  assert(TREES.leafDetail.inner < .8 && TREES.leafDetail.gap > 0 && TREES.leafDetail.gap < .3, '[leaf-group] gap and inner shade out of range');
  assert(TREES.leafDetail.smallGroup < TREES.leafDetail.group && TREES.leafDetail.smallGap < TREES.leafDetail.gap, '[leaf-group] understory as eroded as the adults');
  // The bake erodes the same way, or far crowns would be rounder than near ones.
  assert(source('tree-bake.js').includes('(leafGroup - .5) * ${TREES.leafDetail.group.toFixed(2)}'), '[leaf-group] bake keeps round rims');
  m.dispose();
});
// なぜ失敗したか（第2周）: 黄緑の葉が夕景の中で明るすぎた。葉は距離で彩度だけを落とす（明るさは保つ）。遠景の板も同じ。
test('foliage loses saturation with distance, not brightness [leaf-air]', () => {
  const { w, m } = make(), luma = c => .2126 * c[0] + .7152 * c[1] + .0722 * c[2];
  const board = compileFull(impostorMaterial({ wind: w, sunDir, quality: 'standard', frame: [0, 0, .1, .1], atlas: { albedo: null, normal: null } })).fragmentShader;
  for (const f of [compileFull(m.get(0, 0).leaf).fragmentShader, compileFull(m.get(3, 1).leaf).fragmentShader, board]) {
    assert(f.includes(`float leafAir = ${TREES.leafAir.amount.toFixed(2)}*smoothstep(${TREES.leafAir.near.toFixed(1)}, ${TREES.leafAir.far.toFixed(1)}, length(vViewPosition));`), '[leaf-air] missing');
    assert(f.indexOf('float leafAir') > f.indexOf('#include <fog_fragment>'), '[leaf-air] must follow the fog');
    assert(f.includes('gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(.2126,.7152,.0722)))*vec3(.94,.98,1.08), leafAir);'), '[leaf-air] haze target is not the luminance grey');
  }
  assert(!compileFull(m.get(0, 0).wood).fragmentShader.includes('leafAir'), '[leaf-air] on wood');
  // The grey target keeps luminance within 6%: a saturated yellow-green does not brighten.
  const c = [.3, .42, .08], grey = luma(c), mixed = c.map((v, k) => v + (grey * [.94, .98, 1.08][k] - v) * TREES.leafAir.amount);
  assert(Math.abs(luma(mixed) / luma(c) - 1) < .06 && mixed[1] - mixed[2] < c[1] - c[2], '[leaf-air] haze brightens or keeps the yellow-green');
  m.dispose();
});
// なぜ失敗したか（第2周）: 樹皮が等間隔の縞で、根元がまっすぐ地面に刺さって見えた。根元の溝に少し苔。
test('wood settles moss in the grooves of its foot [bark-moss]', () => {
  const { m } = make();
  for (let sp = 0; sp < 6; sp++) {
    const f = compileFull(m.get(sp, 0).wood).fragmentShader;
    assert(f.includes(`float barkMoss = (1.0-smoothstep(0.0, 1.3, vBarkHeight)) * barkTexel.a * barkOn * ${TREES.bark.moss.toFixed(2)};`), '[bark-moss] moss missing');
    assert(f.indexOf('barkMoss') > f.indexOf('smoothstep(-0.15, 1.1, vBarkHeight)'), '[bark-moss] moss before the soil shade');
    assert(f.includes('diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*vec3(.72,1.08,.55) + vec3(.006,.012,.003), barkMoss);'), '[bark-moss] moss computed but never applied');
  }
  assert(TREES.bark.relief >= 1 && TREES.bark.contact <= .55, '[bark] relief or foot shade weakened');
  m.dispose();
});
