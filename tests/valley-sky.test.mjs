import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { WORLD } from '../dist/valley/world-data.js';
import { createTerrain } from '../dist/valley/terrain-height.js';
import { shotOverride } from '../dist/valley/shots.js';
const { ATMOS, LEGACY_ATMOS, SKY, valleyAtmosphere, skyMaterial, legacySkyMaterial, cloudWarmth, installFog, createAtmosphere } = await load('atmosphere.js');
const { buildRidges, RIDGES, MIST, ridgeHeight, mistSites, mistNearFade } = await load('ridges.js');
const hash = a => createHash('sha256').update(Buffer.from(a.buffer)).digest('hex');
const snapshot = () => Object.fromEntries(['fog_pars_vertex','fog_vertex','fog_pars_fragment','fog_fragment'].map(k => [k, THREE.ShaderChunk[k]]));

test('sun defaults to low northeast; old lighting is exact and look overrides still run last', () => {
  const a = valleyAtmosphere(''), old = valleyAtmosphere('?sun=old');
  assert(Math.abs(a.sunDir.length() - 1) < 1e-12);
  const bearing = Math.atan2(a.sunDir.x, -a.sunDir.z) * 180 / Math.PI;
  const height = Math.asin(a.sunDir.y) * 180 / Math.PI;
  // The valley rim stands 12 to 15 degrees high towards the sun: a lower sun never clears it, and the valley has no visible sunset.
  // Third round: the sun moved from bearing 55 to 40, over the notch at the head of the valley, inside the overlook's frame.
  assert(bearing >= 35 && bearing <= 65); assert(height >= 14 && height <= 18); assert(a.fogDensity > old.fogDensity);
  assert.deepEqual(old.sunDir.toArray(), new THREE.Vector3(.5, .17, .85).normalize().toArray());
  for (const key of ['sunColor','sunIntensity','hemiSky','hemiGround','hemiIntensity','envIntensity','fillColor','fillIntensity']) assert.equal(old[key], LEGACY_ATMOS[key]);
  assert(a.hemiIntensity > old.hemiIntensity && a.fillIntensity > old.fillIntensity);
  assert(source('main.js').indexOf('applyLookOverrides()') < source('main.js').indexOf('ATMOS.sunDir.set'));
  for (const mark of ['sunDir: ATMOS.sunDir','SUN_DIR_W = { value: sunDir.clone().normalize() }']) {
    assert((source('main.js') + source('water.js')).includes(mark));
  }
  assert.match(source('tree-materials.js'), /const sun = \{ value: sunDir \}/);
  assert.match(source('tree-bake.js'), /sunDir/);
  assert.match(source('grass-view.js'), /copy\(sunDir\)/);
  assert.match(source('atmosphere.js'), /addScaledVector\(a.sunDir/);
});

test('Kamakura consumers explicitly retain the old palette, fog and exact sky program', () => {
  for (const name of ['kamakura-atmosphere-view.js','kamakura-water-view.js','kamakura-sea-view.js']) assert.match(source(name), /LEGACY_ATMOS as ATMOS/);
  const old = skyMaterial(LEGACY_ATMOS, {value:0}), original = legacySkyMaterial(LEGACY_ATMOS, {value:0});
  assert.equal(old.fragmentShader, original.fragmentShader);
  assert.equal(old.vertexShader, original.vertexShader);
  assert.notEqual(ATMOS.sunDir, LEGACY_ATMOS.sunDir);
  old.dispose(); original.dispose();
});

test('cloud warmth is monotonic, output noise is bounded, flags restore the old sky and fog bands', () => {
  for (let i = 1; i <= 100; i++) assert(cloudWarmth(i / 100) >= cloudWarmth((i - 1) / 100));
  assert.equal(cloudWarmth(0), 0); assert.equal(cloudWarmth(1), 1);
  assert(SKY.dither / 2 <= 1 / 255);
  const m = skyMaterial(ATMOS, {value:0});
  assert.match(m.fragmentShader, /vec3 shade = mix\(zenith, mid/);
  assert.match(m.fragmentShader, /vec3 lit = mix\(horizon, sunColor, warm\)/);
  assert.match(m.fragmentShader, /uniform float uTime/);
  assert.match(source('post.js'), /c = srgb[\s\S]*max\(grain/);
  const off = valleyAtmosphere('?sky2=0&mist2=0&sun=old');
  const b = skyMaterial(off, {value:0}), c = legacySkyMaterial(LEGACY_ATMOS, {value:0});
  assert.equal(b.fragmentShader, c.fragmentShader);
  const before = snapshot();
  try { installFog(ATMOS); assert(!THREE.ShaderChunk.fog_fragment.includes('float bandY'));
    installFog(off); assert(THREE.ShaderChunk.fog_fragment.includes('float bandY'));
  } finally { Object.assign(THREE.ShaderChunk, before); m.dispose(); b.dispose(); c.dispose(); }
});

test('four different skyline profiles remain separated in the concept northward sector and grow paler', () => {
  const a = buildRidges({search:'?mist3=0'}), b = buildRidges({search:'?mist3=0'});
  a.userData.configure({a:ATMOS}); b.userData.configure({a:ATMOS});
  const mesh = a.getObjectByName('ridge-layers'), other = b.getObjectByName('ridge-layers');
  assert.equal(hash(mesh.geometry.attributes.position.array), hash(other.geometry.attributes.position.array));
  assert.equal(hash(mesh.geometry.attributes.color.array), hash(other.geometry.attributes.color.array));
  let previous = 0;
  for (const layer of RIDGES.layers) {
    const c = new THREE.Color(layer.color), luminance = c.r * .2126 + c.g * .7152 + c.b * .0722;
    assert(luminance > previous); previous = luminance;
  }
  // The fixed overlook itself (dist/valley/shots.js), rays from its own eye: a hand-copied camera put the fourth skyline exactly on its top edge.
  const terrain = createTerrain(WORLD), view = shotOverride('concept', terrain), camera = new THREE.PerspectiveCamera(view.fov,16/9,.15,2200);
  camera.position.set(...view.pos);camera.lookAt(...view.look);camera.updateMatrixWorld();
  const [ex,,ez]=view.pos;
  for (const bearing of [5,15,25]) {
    const angle=bearing*Math.PI/180, dx=Math.sin(angle), dz=-Math.cos(angle);
    let terrainAngle=-Math.PI/2;
    for(let d=30;d<850;d+=4)terrainAngle=Math.max(terrainAngle,Math.atan2(terrain.heightAt(ex+dx*d,ez+dz*d)-camera.position.y,d));
    let visible=0, last=terrainAngle;
    for(const layer of RIDGES.layers) {
      const ox=ex-WORLD.valley.cx,oz=ez-WORLD.valley.cz,b=ox*dx+oz*dz;
      const distance=-b+Math.sqrt(b*b-(ox*ox+oz*oz-layer.radius**2));
      const x=ex+dx*distance,z=ez+dz*distance;
      const height=ridgeHeight(layer,Math.atan2(z-WORLD.valley.cz,x-WORLD.valley.cx),ATMOS.sunDir);
      const screen=new THREE.Vector3(x,height,z).project(camera),elevation=Math.atan2(height-camera.position.y,distance);
      if(elevation>last&&Math.abs(screen.x)<1&&Math.abs(screen.y)<1)visible++;
      last=Math.max(last,elevation);
    }
    assert(visible>=3,`bearing ${bearing}: ${visible} visible skylines`);
  }
  for (const g of [a,b]) g.traverse(o => { o.geometry?.dispose(); o.material?.dispose(); });
});

test('quality and adaptive tiers reduce mountain and mist work within the triangle and draw budgets', t => {
  const g = buildRidges({search:'?mist3=0'}), stats = [];
  const originalIndices = hash(g.getObjectByName('valley-mist').geometry.index.array);
  for (const [quality,tier,layers] of [['standard',0,4],['standard',1,3],['standard',2,2],['standard',3,2],['light',0,2]]) {
    g.userData.configure({quality,tier,a:ATMOS}); const s = g.userData.stats();
    assert.equal(s.ridgeLayers,layers); assert(s.triangles - 2160 <= 20000); assert(s.drawCalls - 3 <= 3);
    assert.equal(g.getObjectByName('ridge-layers').geometry.drawRange.count / 3, layers * 720);
    assert.equal(g.getObjectByName('valley-mist').geometry.drawRange.count / 3, s.mistBands * 512);
    if(quality==='light') {
      const mist=g.getObjectByName('valley-mist'), p=mist.geometry.attributes.position;
      for(let i=0;i<mist.geometry.drawRange.count;i++) {
        const at=mist.geometry.index.array[i];assert(Math.hypot(p.getX(at)-WORLD.valley.cx,p.getZ(at)-WORLD.valley.cz)<=RIDGES.layers[1].radius+1);
      }
    }
    stats.push({quality,tier,...s});
  }
  assert.equal(stats[4].mistBands, Math.ceil(stats[0].mistBands / 2));
  assert(stats[3].triangles < stats[2].triangles);
  g.userData.configure({quality:'standard',tier:0,a:ATMOS});
  assert.equal(hash(g.getObjectByName('valley-mist').geometry.index.array), originalIndices);
  t.diagnostic(JSON.stringify(stats));
  g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('mist locations follow river and sampled terrain lows; proximity, opacity and debug are explicit', () => {
  const terrain = createTerrain(WORLD), sites = mistSites(WORLD,terrain);
  assert.deepEqual(sites,mistSites(WORLD,terrain));
  for (const s of sites) {
    assert.equal(s.y,terrain.heightAt(s.x,s.z) + MIST.height);
    if(s.kind==='river') assert(WORLD.river.points.some(p=>p[0]===s.x&&p[1]===s.z));
    else for (const dx of [-MIST.basinStep,0,MIST.basinStep]) for (const dz of [-MIST.basinStep,0,MIST.basinStep]) {
      if (Math.sign(s.x + dx - WORLD.valley.cx) === Math.sign(s.x - WORLD.valley.cx) && Math.sign(s.z + dz - WORLD.valley.cz) === Math.sign(s.z - WORLD.valley.cz) && Math.abs(s.x+dx-WORLD.valley.cx)<=128 && Math.abs(s.z+dz-WORLD.valley.cz)<=128) assert(terrain.heightAt(s.x,s.z)<=terrain.heightAt(s.x+dx,s.z+dz));
    }
  }
  assert.equal(mistNearFade(0),0); assert.equal(mistNearFade(MIST.near),0); assert.equal(mistNearFade(MIST.far),1);
  for(let i=1;i<200;i++)assert(mistNearFade(i)>=mistNearFade(i-1));
  assert(MIST.opacity<=.5);
  const g=buildRidges({search:'?mist3=0&mist2debug=1&ridges2debug=1'});g.userData.configure({a:ATMOS});
  assert.equal(g.getObjectByName('valley-mist').material.uniforms.debug.value,1);
  assert.equal(g.getObjectByName('ridge-layers').material.uniforms.debug.value,1);
  assert.equal(g.getObjectByName('valley-mist').material.depthWrite,false);
  g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
  const old=buildRidges({search:'?ridges2=0&mist2=0'});assert.equal(old.children.length,3);assert.equal(old.userData.stats().triangles,2160);
  old.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('atmosphere hooks expose quality and adaptive counts without new main wiring', () => {
  let target=null,pixelRatio=1.5;
  const renderer={xr:{enabled:false},autoClear:true,toneMapping:THREE.NoToneMapping,
    state:{buffers:{depth:{getReversed:()=>false}}},getRenderTarget:()=>target,getActiveCubeFace:()=>0,getActiveMipmapLevel:()=>0,
    getClearColor:c=>c.set(0),setRenderTarget:t=>{target=t;},compile(){},render(){},getPixelRatio:()=>pixelRatio};
  const scene=new THREE.Scene(),g=buildRidges({search:'?mist3=0'});scene.add(g);
  const atmosphere=createAtmosphere({scene,renderer}),camera=new THREE.PerspectiveCamera();camera.position.set(10,5,10);
  assert.equal(atmosphere.stats().ridgeLayers,4);assert.equal(atmosphere.stats().skyAddedDrawCalls,0);
  for(const [ratio,layers,bands] of [[1.275,3,9],[1.05,2,6],[.87,2,4],[1.5,4,11]]){
    pixelRatio=ratio;atmosphere.update(camera,1/60);const stats=atmosphere.stats();
    assert.equal(stats.ridgeLayers,layers);assert.equal(stats.mistBands,bands);
  }
  atmosphere.setQuality('light');assert.equal(atmosphere.stats().ridgeLayers,2);
  assert.equal(atmosphere.stats().mistBands,6);assert.equal(atmosphere.sun.shadow.mapSize.x,2048);
  atmosphere.setQuality('standard');assert.equal(atmosphere.stats().ridgeLayers,4);
  const work=atmosphere.stats().work;
  for(let i=0;i<120;i++)atmosphere.update(camera,1/60);
  assert.equal(atmosphere.stats().work,work,'steady updates never rebuild geometry');
  const targetPoint=new THREE.Vector3(10,0,10);atmosphere.follow(targetPoint);
  assert(atmosphere.sun.position.clone().sub(atmosphere.sun.target.position).normalize().distanceTo(ATMOS.sunDir)<1e-12);
  g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
});

test('fog anchors exist in bundled Three, GLSL variants compile including deliberate undeclared-name rejection', t => {
  const compiler=spawnSync('glslc',['--version'],{encoding:'utf8'});
  if(compiler.error?.code==='ENOENT')return t.skip('glslc unavailable; browser validation remains required');
  assert.equal(compiler.status,0);
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'valley-sky-glsl-')), before=snapshot();let count=0;
  const prefix=`#version 310 es\nprecision highp float;precision highp int;\n#define varying in\nout vec4 outputColour;\n#define gl_FragColor outputColour\nuniform vec3 cameraPosition;uniform mat4 viewMatrix;\n`;
  const vertexPrefix=`#version 310 es\nprecision highp float;precision highp int;\n#define varying out\n#define attribute in\nuniform mat4 projectionMatrix,modelViewMatrix;in vec3 position,color;\n`;
  function compile(code,success=true,stage='frag'){const file=path.join(dir,'test.'+stage);fs.writeFileSync(file,(stage==='frag'?prefix:vertexPrefix)+code);
    const result=spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',path.join(dir,'out.spv')],{encoding:'utf8'});
    if(success)assert.equal(result.status,0,result.stderr);else assert.notEqual(result.status,0);count++;
  }
  try {
    for(const a of [ATMOS,valleyAtmosphere('?sky2debug=1'),valleyAtmosphere('?sun=old&sky2=0&mist2=0'),LEGACY_ATMOS]) {
      const m=skyMaterial(a,{value:0});compile(m.fragmentShader);compile(m.vertexShader,true,'vert');m.dispose();
      installFog(a);
      for(const kind of ['FOG_EXP2','LINEAR']) compile('#define USE_FOG\n'+(kind==='FOG_EXP2'?'#define FOG_EXP2\n':'')+THREE.ShaderChunk.fog_pars_fragment+'\nvoid main(){gl_FragColor=vec4(1.0);'+THREE.ShaderChunk.fog_fragment+'\n}');
    }
    const g=buildRidges({search:'?mist3=0'});for(const mesh of g.children){compile(mesh.material.fragmentShader);compile(mesh.material.vertexShader,true,'vert');}
    compile('void main(){gl_FragColor=vec4(undeclaredValue);}',false);
    g.traverse(o=>{o.geometry?.dispose();o.material?.dispose();});
    for(const key of ['fog_pars_vertex','fog_vertex','fog_pars_fragment','fog_fragment'])assert(Object.hasOwn(THREE.ShaderChunk,key));
    t.diagnostic(JSON.stringify({compiledPrograms:count-1,negativeCompilerChecks:1}));
  } finally {Object.assign(THREE.ShaderChunk,before);fs.rmSync(dir,{recursive:true,force:true});}
});
