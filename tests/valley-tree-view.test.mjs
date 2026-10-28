// なぜ失敗したか: 円盤下地と予約隅がコイン・格子になり、灰色の針と松の絵の誤配線が白い段を作った。紙の縁の黒・固定緑の発光・風やLODの結線漏れを、GPUなしで区別する。
// 原因の型: texture/shader/wind/lod/color/instance/dispose/specimen/qa。GLSLのコンパイルは対象外。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { load, source, THREE } from './helpers/tree-modules.mjs';
import { TREES } from '../dist/valley/config.js';
import { tileStats } from './helpers/tree-texture-metrics.mjs';
import { installTreeCanvas } from './helpers/tree-canvas.mjs';
const canvas = installTreeCanvas();
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
    const a = factory(), ops = hash(canvas.drawing()), bytes = hash(Array.from(a.image.data));
    hashes.push(bytes);
    const b = factory(); assert.equal(hash(canvas.drawing()), ops, '[texture] drawing seed'); assert.equal(hash(Array.from(b.image.data)), bytes, '[texture] pixel seed');
    assert(a.isDataTexture && a.image.width <= 512 && a.image.height <= 512, '[texture] raw upload and size');
    for(let i=0;i<a.image.data.length;i+=4)if(a.image.data[i+3]<6)assert.deepEqual(Array.from(a.image.data.slice(i,i+3)),[190,190,190],'[texture-padding] transparent RGB');
    assert(a.flipY && a.generateMipmaps && a.colorSpace === THREE.SRGBColorSpace && a.minFilter === THREE.LinearMipmapLinearFilter, '[texture] mip/sRGB orientation');
    a.dispose(); b.dispose();
  }
  assert.equal(new Set(hashes).size, 4, '[texture] species images identical');
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
  const fringe=needleFringeTexture(), a=fringe.image.data;
  let upper=0,lower=0;const rgb=[0,0,0];
  for(let y=0;y<256;y++)for(let x=0;x<256;x++) { const i=(y*256+x)*4,alpha=a[i+3]; if(y<140)upper+=alpha/255;else if(alpha===0)lower++; if(alpha>=77)for(let k=0;k<3;k++)rgb[k]+=a[i+k]; }
  assert(upper/(256*140)>.95,'[fringe-alpha] upper needles too sparse');
  assert(lower/(256*116)>.10 && lower/(256*116)<.8,'[fringe-alpha] missing hanging cutout tips');
  assert(rgb[1]>rgb[0] && rgb[1]>rgb[2],'[fringe-hue] gray/snowy needles');
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

test('needle routing, untextured core and diffuse gain [texture-routing/core/color]',()=>{
  const {m}=make(), needle=m.get(0,0).leaf.map, fringe=m.get(0,1).leaf.map;
  assert.notEqual(needle,fringe,'[texture-routing] cedar fringe');
  for(const level of [0,1])assert(m.get(2,level).leaf.map===needle,'[texture-routing] pine fan requires needle map');
  for(let species=0;species<6;species++)for(let level=0;level<(species>=4?2:3);level++) {
    const pair=m.get(species,level);
    assert.equal(pair.wood.map,null,'[core] wood core must be untextured');
    if(level<2)assert.equal(pair.leaf.color.r,species>=4?1.1:[1,3].includes(species)?1.25:1,'[color-gain] gain only on near/mid broadleaf');
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
