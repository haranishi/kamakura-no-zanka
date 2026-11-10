import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE,load,source } from './helpers/tree-modules.mjs';
import { createFarShadowView } from '../dist/valley/kamakura-far-shadow-view.js';
import { FAR_SHADOW as C,farShadowBox,farShadowTownBounds,createFarShadowGrid } from '../dist/valley/kamakura-far-shadow.js';
import { createFarGroundField } from '../dist/valley/kamakura-ground-density.js';
import { GROUND_FAR,groundFarRoadCoverage } from '../dist/valley/kamakura-ground-far.js';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
import { loadKamakura } from '../dist/valley/kamakura-data.js';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { KAMAKURA_TIMES } from '../dist/valley/kamakura-atmosphere.js';
const {createKamakuraPost}=await load('kamakura-post-view.js');
function renderer(){let target=null;const draws=[],resources=new Map();
  const track=r=>{if(!r||resources.has(r))return;resources.set(r,0);r.addEventListener('dispose',()=>resources.set(r,resources.get(r)+1));};
  return {draws,resources,autoClear:false,shadowMap:{enabled:true},toneMapping:THREE.NoToneMapping,toneMappingExposure:1,
    getRenderTarget:()=>target,getDrawingBufferSize:v=>v.set(640,360),setRenderTarget(t){target=t;track(t);track(t?.depthTexture);},
    render(scene,camera){const geometries=[];scene.traverse(o=>{if(!scene.userData.fixtureSource){track(o.geometry);track(o.material);}if(o.geometry)geometries.push(o.geometry);});
      draws.push({target,shadowEnabled:this.shadowMap.enabled,geometries,material:scene.children[0]?.material,camera});}
  };
}
function fixture(){
  const terrain={bounds:{minX:-64,maxX:64,minZ:-64,maxZ:64},heightAt:(x,z)=>10+x*.01+z*.02};
  const data={meta:{grid:{width:17,height:17,cell_m:8}},veg:[]};
  const world=new THREE.Scene(),geometry=new THREE.BoxGeometry(4,8,5).toNonIndexed(),mesh=new THREE.Mesh(geometry,new THREE.MeshBasicMaterial());
  world.userData.fixtureSource=true;geometry.computeBoundingSphere();mesh.name='house-far';mesh.visible=false;mesh.material.onBeforeCompile=()=>assert.fail('masked original material must not be used');world.add(mesh);
  const facility=new THREE.Mesh(new THREE.BoxGeometry(),new THREE.MeshBasicMaterial());world.add(facility);
  let flying=false;
  const houses={boxes:[{x:0,z:0,w:4,d:5,height:8,rotY:0}]},facilities={records:[{bounds:{x:20,z:0,w:6,d:7,minY:10,maxY:22,rotY:.4},meshes:[facility]}]};
  const sources={data,houses:()=>houses,facilities:()=>facilities,flying:()=>flying};
  return {terrain,data,world,mesh,sources,setFlying(value){flying=value;},sunDir:new THREE.Vector3(-.8,.37,.47).normalize()};
}
test('two depth draws occur on separate frames after presentation and house completion; all geometry releases once; no rebakes in 1000 frames',t=>{
  const f=fixture(),r=renderer(),view=createFarShadowView({THREE,renderer:r,...f,params:KAMAKURA_TIMES.golden,time:'golden',search:'?debug=1',now:()=>0});
  view.advance(f.world);assert.equal(r.draws.length,0);assert.equal(globalThis.__kzFarShadow().work,0);
  f.mesh.geometry.boundingSphere=null;
  for(let i=0;i<30;i++)view.advance(f.world);assert.equal(r.draws.length,0);assert(!view.ready);
  f.mesh.geometry.computeBoundingSphere();
  let townFrame=0,wholeFrame=0;
  for(let i=1;i<30&&!view.ready;i++){const n=r.draws.length;view.advance(f.world);if(r.draws.length>n){if(n===0)townFrame=i;else wholeFrame=i;}}
  assert(view.ready);assert(wholeFrame>townFrame);assert.equal(r.draws.length,2);
  const stats=globalThis.__kzFarShadow();assert.equal(stats.casters.houses,1);assert.equal(stats.casters.facilities,1);
  assert.equal(stats.maps.town.size,4096);assert.equal(stats.maps.whole.size,2048);assert.equal(stats.mapBytes,60*1024**2);assert.equal(stats.bakeDraws,6);assert.equal(stats.bakeTriangles,2*(512+12+12));
  const depth=r.draws[0].target.depthTexture;assert.equal(depth.type,THREE.UnsignedShortType);assert.equal(r.draws[0].target.texture.internalFormat,'R8');
  const point=new THREE.Vector3(1,12,2),projected=point.clone().project(r.draws[0].camera).multiplyScalar(.5).addScalar(.5),mapped=point.clone().applyMatrix4(view.uniforms.farTownMatrix.value);
  assert(projected.distanceTo(mapped)<1e-10,'post lookup and rendered solar camera agree');
  const proxyHouse=r.draws[0].geometries[4];assert.deepEqual(proxyHouse.attributes.position.array,f.mesh.geometry.attributes.position.array);
  assert.notEqual(proxyHouse.attributes.position,f.mesh.geometry.attributes.position);
  for(const geometry of r.draws[0].geometries)assert.equal(r.resources.get(geometry),1);
  assert.equal(r.resources.get(f.mesh.geometry),undefined,'source shape was not disposed or rendered');
  const refs=Object.values(view.uniforms).map(u=>u.value),size=r.resources.size;
  for(let i=0;i<1000;i++){view.advance(f.world);view.update({position:{x:0,y:5,z:0}});}assert.equal(r.draws.length,2);assert.equal(r.resources.size,size);
  assert.deepEqual(Object.values(view.uniforms).map(u=>u.value),refs);
  view.setAdapt(1);assert.equal(view.uniforms.farTaps.value,4);view.dispose();view.dispose();assert.equal(globalThis.__kzFarShadow,undefined);
  for(const count of r.resources.values())assert.equal(count,1);
  t.diagnostic(JSON.stringify({syntheticCasters:stats.casters,preparationWork:stats.work,bakeDraws:stats.bakeDraws,shadowMapBytes:stats.mapBytes,steadyAdditionalDraws:0}));
});
test('post=0, light, initial adapt2, farshadow=0 construct no map or field; enabled post uses existing final pass and disables scene shadow only in ready flight',()=>{
  for(const args of [{quality:'light'},{search:'?post=0'},{search:'?farshadow=0'},{adapt:2}]){
    const f=fixture(),r=renderer(),p=createKamakuraPost({renderer:r,...f,terrain:{...f.terrain,heightAt:()=>assert.fail('disabled terrain read')},farSources:f.sources,params:KAMAKURA_TIMES.golden,...args,search:'?mist=0&cloud=0&shafts=0&'+(args.search||'').replace('?', '')});
    if(args.adapt)p.setAdapt(args.adapt);
    for(let i=0;i<20;i++)p.render(f.world,new THREE.PerspectiveCamera());
    assert(!r.draws.some(d=>d.target?.depthTexture?.type===THREE.UnsignedShortType));p.dispose();
  }
  const f=fixture(),r=renderer(),p=createKamakuraPost({renderer:r,...f,farSources:f.sources,params:KAMAKURA_TIMES.golden,search:'?debug=1&mist=0&cloud=0&shafts=0&bloom=0',now:()=>0}),camera=new THREE.PerspectiveCamera();
  for(let i=0;i<50&&!globalThis.__kzFarShadow?.().ready;i++)p.render(f.world,camera);
  assert(globalThis.__kzFarShadow().ready);r.draws.length=0;p.render(f.world,camera);assert.equal(r.draws.length,2);assert(r.draws[0].shadowEnabled);
  f.setFlying(true);r.draws.length=0;p.render(f.world,camera);assert.equal(r.draws.length,2);assert.equal(r.draws[0].shadowEnabled,false);assert.equal(r.shadowMap.enabled,true);
  f.setFlying(false);r.draws.length=0;p.render(f.world,camera);assert.equal(r.draws[0].shadowEnabled,true);
  const mat=r.draws[1].material,shader=mat.fragmentShader;assert(shader.indexOf('c=kzFarApply')<shader.indexOf('if(bloomStrength>0.)'));
  const before=r.resources.size;for(let i=0;i<1000;i++)p.render(f.world,camera);assert.equal(r.resources.size,before);
  p.setAdapt(2);assert.equal(mat.uniforms.farReady.value,0);assert.equal(globalThis.__kzFarShadow,undefined);p.dispose();p.dispose();
  for(const count of r.resources.values())assert.equal(count,1);
});
test('early cancellation releases all allocated resources exactly once, including a failed depth render; housefar=0 falls back to boxes',()=>{
  for(const stop of [0,1,3,6,12,30]){
    const f=fixture(),r=renderer(),v=createFarShadowView({THREE,renderer:r,...f,params:KAMAKURA_TIMES.golden,time:'golden',search:'?debug=1&housefar=0',now:()=>0});
    f.mesh.removeFromParent();for(let i=0;i<stop;i++)v.advance(f.world);v.dispose();v.dispose();for(const n of r.resources.values())assert.equal(n,1);
  }
  const f=fixture(),r=renderer(),v=createFarShadowView({THREE,renderer:r,...f,params:KAMAKURA_TIMES.golden,time:'golden',search:'',now:()=>0});
  const render=r.render;r.render=function(s,c){render.call(r,s,c);throw Error('synthetic context loss');};
  assert.throws(()=>{for(let i=0;i<30;i++)v.advance(f.world);},/context loss/);assert.equal(r.getRenderTarget(),null);assert.equal(r.autoClear,false);v.dispose();for(const n of r.resources.values())assert.equal(n,1);
});
test('private world: bounded grids, valid heights and 16-bit precision, reports only triangle/work aggregates', {skip:!process.env.KZ_WORLD_DIR&&'私有地形未指定'},async t=>{
  const data=await loadKamakura(async url=>{const bytes=await readFile(join(process.env.KZ_WORLD_DIR,url.replace('/world-private/','')));return {ok:true,json:async()=>JSON.parse(bytes.toString()),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};}),terrain=createKamakuraTerrain(data),field=createFarGroundField(data,GROUND_FAR,groundFarRoadCoverage);
  while(!field.done)field.step(4096);
  const bounds=farShadowTownBounds(terrain,data),whole=createFarShadowGrid(terrain,terrain.bounds,C.wholeCell,field,bounds),town=createFarShadowGrid(terrain,bounds,C.townCell,field);
  while(!whole.ready)whole.step(4096);while(!town.ready)town.step(4096);
  for(const grid of [town,whole]){for(const y of grid.positions)assert(Number.isFinite(y));assert(grid.indices.length/3<1000000);assert(grid.canopyCount/3<1000000);}
  for(const time of Object.values(KAMAKURA_TIMES))for(const [area,size] of [[bounds,C.townSize],[terrain.bounds,C.wholeSize]]){
    const b=farShadowBox(area,whole.minY,whole.maxY,time.sunDir??[.5,.17,.85],size);assert(b.depthStep<=b.metersPerTexel*C.precisionShare);
  }
  t.diagnostic(JSON.stringify({terrainTriangles:(town.terrainCount+whole.terrainCount)/3,canopyTriangles:(town.canopyCount+whole.canopyCount)/3,work:town.work+whole.work+field.work,mapBytes:(C.townSize**2+C.wholeSize**2)*3}));
});
test('farshadow=0 with real source wiring retains the legacy final string, targets and calls',()=>{
  const shaders=[],calls=[];
  for(const enabled of [false,true]){const f=fixture(),r=renderer(),p=createKamakuraPost({renderer:r,...f,params:KAMAKURA_TIMES.golden,farSources:enabled?f.sources:null,search:'?farshadow=0&mist=0'});
    p.render(f.world,new THREE.PerspectiveCamera());shaders.push(r.draws.at(-1).material.fragmentShader);calls.push(r.draws.length);p.dispose();}
  assert.equal(shaders[0],shaders[1]);assert.equal(calls[0],calls[1]);
});
test('new steady frame code has no allocations and disabled route never invokes the far owner',()=>{
  const code=source('kamakura-far-shadow-view.js'),steady=code.split('function advance(world){')[1].split('preparationFrames++')[0];
  assert(!/\bnew\s|\.map\(|\.slice\(|\.clone\(/.test(steady));
  const post=source('kamakura-post-view.js');assert.match(post,/if\(options.farshadow\)\{/);assert.match(post,/farShadow\?\.advance\(world\)/);
});
