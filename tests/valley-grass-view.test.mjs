// なぜ失敗したか: GPUなしでも実Threeの形状・転送・共有uniform・プール解放を検査し、結線漏れを捕まえる。
// 原因の型: geometry/shader/stream/budget/pool/dispose/mid-shape/atlas-edge/atlas-blade。見た目・GLSLコンパイル・GPU解放は別途ブラウザで測る。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as THREE from '../dist/vendor/three.module.min.js';
import { midTile } from '../dist/valley/grass-field.js';
import { chunkBudget } from '../dist/valley/grass-schedule.js';
const vendor = new URL('../dist/vendor/three.module.min.js', import.meta.url).href;
const asModule = source => 'data:text/javascript;base64,'+Buffer.from(source).toString('base64');
const rewrite = name => fs.readFileSync(new URL('../dist/valley/'+name,import.meta.url),'utf8')
  .replace(/from 'three'/g,`from '${vendor}'`).replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL('../dist/valley/'+p,import.meta.url).href}'`);
const grade = asModule(rewrite('grade.js'));
const { buildGrass } = await import(asModule(rewrite('grass-view.js').replace(new URL('../dist/valley/grade.js',import.meta.url).href,grade)));
// Only the canvas drawing API is stubbed. Geometry/materials/buffers are the shipped Three.js.
let fills=0, lastAtlas;
globalThis.document = { createElement(tag) {
  assert.equal(tag,'canvas','[geometry] unexpected DOM work');
  const leafCounts=[0,0,0,0], blades=[]; let variant=0, blade, stops;
  const canvas={ width:0,height:0,leafCounts,blades,getContext:()=>({
    getImageData:()=>{const data=new Uint8ClampedArray(canvas.width*canvas.height*4);
      data.set([11,11,11,0,71,71,71,128,219,219,219,255,35,35,35,5,82,82,82,6]);return {data};},
    createLinearGradient:(x,y,tx,top)=>{stops=[];blade={y,top,stops,curves:[]};return {addColorStop:(at,color)=>stops.push([at,color])};},
    beginPath(){},moveTo(x,y){variant=Math.floor(x/256);blade.x=x;blade.y=y;},
    quadraticCurveTo(...args){blade.curves.push(args);},fill(){fills++;leafCounts[variant]++;blades.push(blade);}
  }) };
  lastAtlas=canvas;return canvas;
} };
function fixture(species=0) {
  const nx=180,nz=180,n=nx*nz;
  return { seed:1333,x0:-90,z0:-90,nx,nz,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n).fill(species),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((nx+1)*(nz+1)) };
}
function view(quality='standard',species=0) {
  const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
  const grass=buildGrass({field:fixture(species),quality,wind,sunDir:new THREE.Vector3(1,.2,0)});
  return {grass,wind};
}
const camera=(x=0,z=0)=>({position:new THREE.Vector3(x,1.7,z)});
test('real ribbon/card geometry, atlas, bounds and worst-case submission including clumps',()=>{
  for(const quality of ['standard','light']) for(const species of [0,2,4]) {
    const {grass}=view(quality,species), before=fills; grass.warm(camera());
    assert.equal(grass.stats().queue,0,'[stream] warm left holes');
    const b=chunkBudget(quality), stats=grass.stats();
    assert(stats.nearBlades*6<=b.near.triangles && stats.midCards*6<=b.mid.triangles,'[budget] actual submission exceeds bound');
    for(const mesh of grass.group.children) {
      const near=mesh.name==='grass-near',g=mesh.geometry;
      assert(g.isInstancedBufferGeometry,'[geometry] missing instanced geometry');
      assert.equal(g.getAttribute('position').count,near?8:12,'[geometry] ribbon/star vertices');
      assert.equal(g.index.count,18,'[geometry] incorrect triangle count');
      assert(g.instanceCount<=g.getAttribute('iRoot').data.count,'[budget] attribute buffer overflow');
      assert(mesh.frustumCulled && g.boundingSphere?.radius>0,'[geometry] missing conservative bounds');
      assert(mesh.material.isMeshLambertMaterial && mesh.material.side===THREE.DoubleSide,'[shader] incompatible lighting');
      assert(!mesh.castShadow && mesh.receiveShadow,'[shader] grass shadow policy');
      if(!near) {
        assert(mesh.material.map.isDataTexture && mesh.material.alphaToCoverage===(quality==='standard'),'[geometry] card atlas/coverage missing');
        assert.equal(mesh.material.alphaTest,.3,'[geometry] alpha cutoff');
        assert(mesh.material.map.generateMipmaps,'[geometry] atlas mipmaps missing');
        const image=mesh.material.map.image;
        assert.equal(image.data.length,image.width*image.height*4,'[atlas-edge] incomplete RGBA upload');
        assert.deepEqual([...image.data.slice(0,20)],[190,190,190,0,71,71,71,128,219,219,219,255,190,190,190,5,82,82,82,6],'[atlas-edge] transparent RGB bleed must preserve alpha');
        assert(mesh.material.map.flipY && !mesh.material.map.premultiplyAlpha,'[atlas-edge] raw canvas orientation or alpha changed');
        assert(image.width===1024 && image.height===256,'[geometry] incorrect atlas size');
        assert(lastAtlas.leafCounts.every(n=>n===110),'[atlas-blade] each variant needs 110 narrow leaves');
        const p=g.getAttribute('position');
        for(let k=0;k<3;k++) assert(Math.abs(p.getX(k*4)+.5*Math.cos(k*Math.PI/3))<1e-6 && Math.abs(p.getZ(k*4)+.5*Math.sin(k*Math.PI/3))<1e-6,'[geometry] cards not spaced 60 degrees');
      }
      const a=g.getAttribute('iRoot').data.array, sphere=g.boundingSphere;
      for(let i=0;i<g.instanceCount;i++) {
        const p=new THREE.Vector3(a[i*15],a[i*15+1],a[i*15+2]);
        assert(sphere.containsPoint(p) && sphere.containsPoint(p.add(new THREE.Vector3(0,a[i*15+4],0))),'[geometry] root or tip outside bounds');
        for(let j=0;j<15;j++) assert(Number.isFinite(a[i*15+j]),'[geometry] nonfinite instance');
      }
    }
    assert.equal(fills,before,'[geometry] canvas redrawn during streaming');
    grass.dispose();
  }
  assert(fills>=440,'[atlas-blade] missing 110 leaves per four atlas variants');
});
test('Lambert injection composes lift, shares wind, fades both LODs, and uses sun-facing sight',()=>{
  const {grass,wind}=view();grass.warm(camera());
  const materials=[...new Set(grass.group.children.map(m=>m.material))];
  for(const material of materials) {
    const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
    material.onBeforeCompile(shader);
    for(const key of Object.keys(wind)) assert.equal(shader.uniforms[key],wind[key],'[shader] copied or missing shared wind');
    assert.match(shader.vertexShader,/transformed \+= iRoot.xyz/,'[shader] missing instance placement');
    assert.match(shader.vertexShader,/vMapUv|float widen/,'[shader] atlas/width missing');
    assert.match(shader.vertexShader,/\.045-uTime\*\.9/,'[shader] gust phase missing');
    assert.match(shader.vertexShader,/step\(\.5,uWind\)/,'[shader] reduced gust not disabled');
    assert.match(shader.vertexShader,material.map?/.85\*uGrassRadii.x,1.25\*uGrassRadii.x/:/\.75\*uGrassRadii.x,1.25\*uGrassRadii.x/,'[shader] LOD transition range');
    if(material.map) {
      assert.match(shader.vertexShader,/cross\(axis,transformed\)\*sin\(iTip.y\)/,'[mid-tilt] rotation absent');
      assert.match(shader.vertexShader,/vGrassColor = iColor/,'[mid-tilt] tilt interpreted as tip color');
      assert.match(shader.vertexShader,/mix\(\.9,1.1,t\)\*1.0/,'[mid-color] brightness exceeds individual 20%');
      assert.match(shader.fragmentShader,/backlight \*= \.6;/,'[backlight:mid] card attenuation absent');
      assert.match(shader.vertexShader,/\.45\*uGrassRadii.y,uGrassRadii.y/,'[shader] abrupt outer fade');
      assert.match(shader.vertexShader,/mix\(\.7,1.0,appear\)/,'[shader] missing card growth');
      assert.match(shader.fragmentShader,/normal \*= faceDirection;/, '[shader] mid back face lost upward light');
      assert.match(shader.vertexShader,/vec3\(0,1,0\),\.8/, '[shader] mid normal must lean 80% up');
      assert.match(shader.vertexShader,/mix\(\.9,1.1,t\)/, '[shader] mid root/tip luminance');
      assert.match(shader.fragmentShader,/texture2D\( map, vMapUv, 1.25\*smoothstep\(6.8,25.0,vGrassDistance\) \)/, '[atlas-edge] distance mip bias absent');
      assert.match(shader.fragmentShader,/diffuseColor.a \*= smoothstep\(0.0,\.18,vGrassUV.y\)/, '[atlas-edge] root softness absent');
      assert.equal(shader.uniforms.uGroundTint.value.getHexString(),'6b6a35','[shader] ground tint omitted');
      assert.match(shader.fragmentShader,/\.60\*smoothstep\(9.0,25.0/,'[shader] ground blend omitted');
    } else {
      assert.match(shader.fragmentShader,/backlight \*= \(1.0-smoothstep\(5.0,14.0,vGrassDistance\)\)/,'[backlight:near] distance attenuation absent');
      assert.match(shader.vertexShader,/mix\(1.0,1.6,fadeOut\)/,'[shader] coverage widening omitted');
    }
    assert.equal(material.emissive.getHex(),0x182212,'[shader] shared emissive floor changed');
    assert.match(shader.fragmentShader,/min\(vec3\(\.35\)/,'[shader] backlight cap missing');
    assert.match(shader.fragmentShader,/vGrassUV.y\*vGrassUV.y\*mix/,'[shader] root backlight not suppressed');
    assert.match(shader.fragmentShader,/vGrassWorld-cameraPosition/,'[shader] backlight sight reversed');
    assert.match(shader.fragmentShader,/dot\(sight,normalize\(uSunDir\)\)/,'[shader] sun not a direction');
    assert.match(shader.fragmentShader,/pow\(lc, vec3\(0.800\)\)/,'[shader] lift overwritten');
    assert(!shader.vertexShader.includes('#include <begin_vertex>'),'[shader] vertex injection failed');
    grass.setSun(new THREE.Vector3(-1,0,0));
    assert.equal(shader.uniforms.uSunDir.value.x,-1,'[shader] sun update lost');
  }
  assert.notEqual(materials[0].customProgramCacheKey(),materials[1].customProgramCacheKey(),'[shader] near and mid share program');
  grass.dispose();
});
test('subthreshold movement does not plan/build, normal frames bound builds, jumps/warm converge',()=>{
  const {grass}=view();grass.warm(camera());
  const built=grass.stats().builds;
  grass.update(camera(.1,.1));assert.equal(grass.stats().builds,built,'[stream] rebuilt on tiny movement');
  grass.update(camera(9,0));
  assert(grass.stats().builds-built<=3,'[stream] normal frame exceeds 2+1 chunks');
  for(let i=0;i<100 && grass.stats().queue;i++) grass.update(camera(9,0));
  assert.equal(grass.stats().queue,0,'[stream] stationary queue never drained');
  const a=grass.stats().builds;grass.update(camera(60,0));
  assert(grass.stats().builds>a,'[stream] teleport did no work');
  grass.warm(camera(60,0));assert.equal(grass.stats().queue,0,'[stream] teleport warm holes');
  assert(grass.stats().lastBuildMs>=0 && grass.stats().maxBuildMs>=grass.stats().lastBuildMs,'[stream] missing timing stats');
  grass.dispose();
});
test('evicted buffers are reused and every pooled resource is disposed exactly once',()=>{
  const {grass}=view();grass.warm(camera());
  const first=new Set(grass.group.children.map(m=>m.geometry));
  grass.warm(camera(60,0));
  assert(grass.group.children.some(m=>first.has(m.geometry) && m.visible),'[pool] evicted mesh not reused');
  const resources=new Set();
  for(const mesh of grass.group.children) {resources.add(mesh.geometry);resources.add(mesh.material);if(mesh.material.map)resources.add(mesh.material.map);}
  const released=new Map();for(const resource of resources)resource.addEventListener('dispose',()=>released.set(resource,(released.get(resource)||0)+1));
  grass.dispose();grass.dispose();grass.update(camera());grass.warm(camera());
  for(const resource of resources)assert.equal(released.get(resource),1,'[dispose] missing or duplicate resource release');
  assert.equal(grass.group.children.length,0,'[dispose] retained meshes');
  assert.equal(grass.stats().drawCalls,0,'[dispose] retained draw calls');
});

test('legacy group traversal reaches inactive pooled geometry, materials and canvas maps',()=>{
  const {grass}=view();grass.warm(camera());grass.warm(camera(60,0));
  const resources=new Set();
  for(const mesh of grass.group.children) {resources.add(mesh.geometry);resources.add(mesh.material);if(mesh.material.map)resources.add(mesh.material.map);}
  const released=new Set();for(const r of resources)r.addEventListener('dispose',()=>released.add(r));
  grass.group.traverse(o=>{if(!o.isMesh)return;o.geometry?.dispose();for(const m of [].concat(o.material)){m.map?.dispose();m.dispose();}});
  assert.equal(released.size,resources.size,'[dispose] legacy quality traversal missed a pooled resource');
  grass.dispose();
});

test('both app entry points supply the field and sun, warm grass, and expose QA stats',()=>{
  const read=name=>fs.readFileSync(new URL('../dist/valley/'+name,import.meta.url),'utf8');
  for(const file of ['main.js','world.js']) {
    const source=read(file);
    assert(!/scatterGrass/.test(source),'[stream] legacy scatter still allocated');
    assert.match(source,/createGrassField\(WORLD, terrain\)/,'[stream] no shared field at entry');
    assert.match(source,/sunDir: ATMOS.sunDir/,'[shader] entry omitted sun direction');
    assert.match(source,/grass.warm\(camera\)/,'[stream] entry omitted warm');
  }
  assert.equal([...read('main.js').matchAll(/createGrassField\(WORLD, terrain\)/g)].length,1,'[stream] quality change recreates field');
  assert.match(read('main.js'),/field: live.grassField/,'[stream] quality change lost field');
  assert.match(read('qa.js'),/grassStats\(\) \{ return game.veg.grass.stats\(\); \}/,'[stream] QA stats missing');
});

// なぜ失敗したか: 横長の板は細葉を幅広に引き伸ばす。近景と同じ色でも輪郭が別物になる。
test('mid tufts span the requested size and share near mean/gold colors [mid-shape]', () => {
  for (const [species, palette] of [[0,['#5b7736','#a09e56']],[3,['#426b37','#6b894b']]]) {
    const {grass}=view('standard',species); grass.warm(camera());
    const f=fixture(species), cells=new Map(), mean=new THREE.Color(palette[0]).lerp(new THREE.Color(palette[1]),.5);
    const gold=mean.clone().lerp(new THREE.Color(palette[1]),.65);
    let dry=0,total=0,minW=Infinity,maxW=0,minH=Infinity,maxH=0;
    for (const mesh of grass.group.children.filter(m=>m.name==='grass-mid')) {
      const a=mesh.geometry.getAttribute('iRoot').data.array;
      for (let i=0;i<mesh.geometry.instanceCount;i++) {
        const j=i*15,x=Math.floor(a[j]),z=Math.floor(a[j+2]),key=`${x},${z}`;
        if (!cells.has(key)) cells.set(key,midTile(f,x,z,{size:1}));
        const d=cells.get(key),k=d.x.findIndex((v,k)=>v===a[j] && d.z[k]===a[j+2]);
        assert(k>=0,'[mid-shape] packed root differs from cell data');
        assert.equal(a[j+12],d.tilt[k],'[mid-tilt] packed tilt lost');
        assert.equal(a[j+13],d.tiltYaw[k],'[mid-tilt] packed direction lost');
        const w=a[j+5]/d.s[k],h=a[j+4]/d.s[k];
        assert(w>=.55*.75-1e-6 && w<=.55*1.25+1e-6,'[mid-shape] width must stay near .55 times s');
        assert(h>=.55*.75-1e-6 && h<=.55*1.875+1e-6,'[mid-shape] height must stay near .55 times s');
        assert(w/h>=.4-1e-6 && w/h<=5/3+1e-6,'[mid-shape] atlas stretched beyond 25% plus tall tufts');
        minW=Math.min(minW,w);maxW=Math.max(maxW,w);minH=Math.min(minH,h);maxH=Math.max(maxH,h);
        const expected=(d.hue[k]<.3?gold:mean).clone().multiplyScalar(d.brightness[k]); dry+=d.hue[k]<.3;total++;
        for (const [offset,c] of [[8,expected.r],[9,expected.g],[10,expected.b]])
          assert(Math.abs(a[j+offset]-c)<1e-6,'[mid-color] expected near palette mean or dry gold');
      }
    }
    assert(dry/total>.27 && dry/total<.33,'[mid-color] dry gold population must be 30%');
    assert(maxW-minW>.27 && maxH-minH>.60,'[mid-shape] missing full size range');
    grass.dispose();
  }
});

// なぜ失敗したか: 太い少数葉と白一色では、重なった葉が切り絵に見える。
test('atlas retains thin blade widths, six seeded bundles and grayscale shading [atlas-blade]',()=>{
  const {grass}=view();
  const hash=(x,z,n)=>{const v=Math.sin(x*127.1+z*311.7+n*74.7)*43758.5453;return v-Math.floor(v);};
  for(let v=0;v<4;v++) {
    const bundles=new Set(), seed=11+v, roots=[];
    for(let i=0;i<110;i++) {
      const b=lastAtlas.blades[v*110+i], width=b.curves[2][2]-b.x;
      assert(width>=2.4 && width<=4.6,'[atlas-blade] blade width outside 2.4–4.6px');
      const k=Math.floor(hash(seed,i,7)*6);bundles.add(k);
      const center=128+(hash(seed,k,9)-.5)*110;
      const expected=v*256+center+(hash(seed,i,1)-.5)*36;
      assert(Math.abs(b.x+width/2-expected)<1e-9,'[atlas-blade] six seeded bundles or spread changed');
      assert.equal(b.y,254,'[atlas-blade] root baseline changed');
      const length=235*(.35+.65*hash(seed,i,2)*(.6+.4*hash(seed,k,8)));
      assert(Math.abs(b.top-(254-length))<1e-9,'[atlas-blade] length distribution changed');
      const dx=(hash(seed,i,3)-.5)*110,bend=(hash(seed,i,4)-.5)*40;
      assert(Math.abs(b.curves[0][0]-(expected+dx*.45+bend-width/3))<1e-9,'[atlas-blade] lean or bend changed');
      assert.deepEqual(b.stops.map(s=>s[0]),[0,.3,1],'[atlas-blade] shading stops changed');
      const values=b.stops.map(([,c])=>c.match(/[\d.]+/g).map(Number));
      for(const c of values) assert(c[0]===c[1] && c[1]===c[2],'[atlas-blade] colored atlas');
      assert(values[0][0]<values[1][0] && values[1][0]<values[2][0] && values[0][3]===.2,'[atlas-blade] grayscale gradient or root alpha lost');
      roots.push(values[0][0]);
    }
    assert.equal(bundles.size,6,'[atlas-blade] missing bundle');
    assert(Math.max(...roots)-Math.min(...roots)>30,'[atlas-blade] per-leaf shading lost');
  }
  grass.dispose();
});
