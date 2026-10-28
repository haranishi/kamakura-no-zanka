// なぜ失敗したか: 紙の縁の黒・固定緑の発光・風やLODの結線漏れを、GPUなしで区別する。
// 原因の型: texture/shader/wind/lod/color/instance/dispose/specimen/qa。GLSLのコンパイルは対象外。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load, source, THREE } from './helpers/tree-modules.mjs';
import { TREES } from '../dist/valley/config.js';
let drawing = [], canvases = [];
// Only the legacy needle canvas is fake; broadleaf and fringe tests read their real RGBA bytes.
globalThis.document = { createElement(tag) {
  assert.equal(tag, 'canvas', '[texture] unexpected DOM');
  const ops = [], c = { width: 0, height: 0 }; canvases.push({ c, ops });
  const ctx = new Proxy({
    getImageData() { const data = new Uint8ClampedArray(c.width * c.height * 4); data.set([12, 13, 14, 0, 145, 145, 145, 255, 91, 91, 91, 5, 185, 185, 185, 6]); return { data }; },
    createLinearGradient(...v) { ops.push(['gradient', ...v]); return { addColorStop(...args) { ops.push(['stop', ...args]); } }; },
  }, { get(target, key) { return target[key] ?? ((...v) => { ops.push([key, ...v]); }); }, set(target, key, value) { ops.push([key, value]); target[key] = value; return true; } });
  c.getContext = () => ctx; drawing = ops; return c;
} };
const { needleTexture, needleFringeTexture, mapleLeafTexture, zelkovaLeafTexture } = await load('tree-textures.js');
const { treeMaterials } = await load('tree-materials.js');
const { createTreeSet, buildSpecimens, stageColor } = await load('tree-view.js');
const { treeGeometry } = await load('tree-geometry.js');
const wind = () => ({ uTime: { value: 5 }, uWind: { value: 1 }, uWindDir: { value: new THREE.Vector2(1, 0) }, uGuideMix: { value: 0 } });
const sunDir = new THREE.Vector3(.5, .2, .85).normalize();
const make = (quality = 'standard') => { const w = wind(); return { w, m: treeMaterials({ wind: w, sunDir, quality }) }; };
function compile(m) {
  const shader = { uniforms: {}, vertexShader: '#include <common>\n#include <beginnormal_vertex>\n#include <begin_vertex>\n#include <color_vertex>', fragmentShader: '#include <common>\n#include <color_fragment>\n#include <map_fragment>\n#include <alphatest_fragment>\n#include <emissivemap_fragment>' };
  m.onBeforeCompile(shader); return shader;
}
const hash = obj => createHash('sha256').update(JSON.stringify(obj)).digest('hex');
test('four deterministic procedural textures retain padding and drawing grammar [texture]', () => {
  const hashes = [];
  for (const factory of [needleTexture, needleFringeTexture, mapleLeafTexture, zelkovaLeafTexture]) {
    const a = factory(), ops = hash(drawing), bytes = hash(Array.from(a.image.data));
    hashes.push(bytes);
    const b = factory(); assert.equal(hash(drawing), ops, '[texture] drawing seed'); assert.equal(hash(Array.from(b.image.data)), bytes, '[texture] pixel seed');
    assert(a.isDataTexture && a.image.width <= 512 && a.image.height <= 512, '[texture] raw upload and size');
    if(factory===needleTexture)assert.deepEqual(Array.from(a.image.data.slice(0, 16)), [190,190,190,0,145,145,145,255,190,190,190,5,185,185,185,6], '[texture] padding RGB or shaded pixels overwritten');
    assert(a.flipY && a.generateMipmaps && a.colorSpace === THREE.SRGBColorSpace && a.minFilter === THREE.LinearMipmapLinearFilter, '[texture] mip/sRGB orientation');
    a.dispose(); b.dispose();
  }
  assert.equal(new Set(hashes).size, 4, '[texture] species images identical');
  for (const [factory, count] of [[mapleLeafTexture, 26], [zelkovaLeafTexture, 56]]) {
    const map=factory();
    assert.equal(map.userData.leafCount,count,'[texture-leaf-count] small overlapping leaves missing');
    assert.equal(map.wrapS,THREE.RepeatWrapping,'[texture-uv] repeat wrapping');
    assert.equal(map.wrapT,THREE.RepeatWrapping,'[texture-uv] vertical repeat');
    const a=map.image.data;
    let covered=0;
    for(let i=0;i<a.length;i+=4)if(a[i+3]>=77) {
      covered++;
      assert(a[i]===a[i+1] && a[i+1]===a[i+2] && a[i]>=153,'[texture-value] foliage must be neutral gray');
    }
    assert(covered/65536>=.65 && covered/65536<=.76,'[texture-coverage] cluster interior sparse or edge solid');
    for(let v=0;v<16;v++)for(let u=0;u<16;u++) {
      const i=((255-v)*256+u)*4;
      assert.equal(a[i+3],255,'[core-alpha] reserved corner is transparent');
      assert(Math.abs(a[i]/255-.62)<.005,'[core-alpha] reserved corner value');
    }
    map.dispose();
  }
  const fringe=needleFringeTexture(), a=fringe.image.data;
  let upper=0,lower=0;
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) { const alpha=a[(y*256+x)*4+3]; if(y<140)upper+=alpha/255;else if(alpha===0)lower++; }
  assert(upper/(256*140)>.95,'[fringe-alpha] upper needles too sparse');
  let bottom=0;
  for(let x=0;x<256;x++)if(a[(255*256+x)*4+3]>0)bottom++;
  assert(bottom/256<.08,'[fringe-alpha] uniformly long lower needles');
  assert(lower/(256*116)>.15 && lower/(256*116)<.8,'[fringe-alpha] missing hanging cutout tips');
  assert(fringe.wrapS===THREE.RepeatWrapping && fringe.wrapT===THREE.RepeatWrapping,'[texture-uv] fringe repeat');
  fringe.dispose();
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
        assert(f.includes(`backlight*${species === 0 || species === 2 ? '.2' : '1.0'}`), '[shader] species transmission');
      }
    }
  }
  assert(m.get(1, 0).leaf.alphaToCoverage, '[shader] standard coverage'); m.dispose();
  const light = make('light').m; assert(!light.get(1, 0).leaf.alphaToCoverage, '[shader] light coverage'); light.dispose();
});
test('complementary stable dither only in color pass [lod]', () => {
  const { m } = make(); const mat = m.get(1, 1).leaf, s = compile(mat);
  assert.deepEqual(s.uniforms.uLod.value.toArray(), [-1,-1,-1,-1], '[lod] specimen fade disabled');
  assert.match(s.vertexShader, /uLod.x < 0.0 \? 1.0 : smoothstep\(uLod.x,uLod.y,vTreeDistance\)/, '[lod] entering weight');
  assert.match(s.vertexShader, /uLod.z < 0.0 \? 1.0 : 1.0-smoothstep\(uLod.z,uLod.w,vTreeDistance\)/, '[lod] leaving weight');
  assert.match(s.vertexShader, /vTreeWeight = enter\*leave/, '[lod] weight product');
  assert.match(s.fragmentShader, /gl_FragCoord.xy,vec2\(\.06711056,\.00583715\)/, '[lod] stable interleaved noise');
  assert.match(s.fragmentShader, /if \(vTreeEntering > .5\) \{ if \(n < 1.0-vTreeWeight\) discard; \}/, '[lod] far keeps n >= 1-w');
  assert.match(s.fragmentShader, /else \{ if \(n >= vTreeWeight\) discard; \}/, '[lod] near keeps n < w');
  for (const t of [0,.01,.2,.5,.8,.99,1]) for (let k=0;k<100;k++) { const n=k/100, w=t*t*(3-2*t); assert.equal(Number(n<1-w)+Number(n>=1-w),1,'[lod] gap or double'); }
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
      assert(!mesh.frustumCulled && mesh.receiveShadow===(level===0) && mesh.castShadow===(level===0),'[instance] culling/shadow');
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
  // All four owned maps, even those unused in this material pair, must be freed.
  const maps=new Set([m.get(0,0).leaf.map,m.get(1,0).leaf.map,m.get(3,0).leaf.map,m.get(0,1).leaf.map]);
  for(const map of maps)map.addEventListener('dispose',()=>textureDisposals++);
  m.dispose();m.dispose();assert.equal(materialDisposals,2,'[dispose] materials');assert.equal(textureDisposals,4,'[dispose] textures');
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

test('fringe map routing and actual core texel sampling [texture-routing/core-alpha]',()=>{
  const {m}=make(), fringe=m.get(0,1).leaf.map;
  assert.equal(m.get(2,0).leaf.map,fringe,'[texture-routing] pine near fringe');
  assert.equal(m.get(2,1).leaf.map,fringe,'[texture-routing] pine mid fringe');
  assert.notEqual(m.get(0,0).leaf.map,fringe,'[texture-routing] cedar near needles preserved');
  for(const species of [1,3])for(const level of [0,1]) {
    const g=treeGeometry(species,level).leaf, uv=g.getAttribute('uv'), map=m.get(species,level).leaf.map;
    for(const part of g.userData.parts.filter(p=>p.core))for(let i=part.first;i<part.first+(part.sides+1)*(part.bands+1);i++) {
      const x=Math.floor(uv.getX(i)*256), y=255-Math.floor(uv.getY(i)*256);
      assert.equal(map.image.data[(y*256+x)*4+3],255,'[core-alpha] geometry samples transparent pixel');
    }
  }
  m.dispose();
});
