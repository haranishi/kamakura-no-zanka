// W2c-9p optional CPU benchmark. Run from repository root; emits aggregates only.
import fs from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(), mod=n=>import(`file://${root}/dist/valley/${n}.js`);
const {houseTextureData}=await mod('kamakura-house-texture');
const {loadKamakura}=await mod('kamakura-data'),{kamakuraSpawn}=await mod('kamakura-spawn');
let terrainModule=await mod('kamakura-terrain');
// Optional instrumentation also sees waterAt's closed-over reach=0 calls.
if(process.env.KZ_PROFILE_RIVERS){
  let source=await fs.readFile(`${root}/dist/valley/kamakura-terrain.js`,'utf8');
  source=source.replace(/from '(\.\/[^']+)'/g,(_,p)=>`from '${new URL(p,`file://${root}/dist/valley/kamakura-terrain.js`).href}'`);
  source=source.replace('const { riverDistanceAt } = createRiverIndex(rivers, 32);','const riverIndex = createRiverIndex(rivers,32); const riverDistanceAt=(x,z,reach)=>globalThis.__bootRiverProbe(riverIndex.riverDistanceAt,x,z,reach);');
  terrainModule=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
}
const {createKamakuraTerrain}=terrainModule;
const {prepareFishRivers}=await mod('kamakura-fish');
const {createGrassEnvironment}=await mod('kamakura-grass-look'),{createGrassCell,createGrassWindows,grassExclusions}=await mod('kamakura-grass-field'),{createSurfaceCodeAt}=await mod('kamakura-surface');
const {prepareVeg,vegCircles}=await mod('kamakura-veg'),{buildColliders}=await mod('collision');
const {loadHouseView}=await import(`file://${root}/tests/helpers/kamakura-house-view.mjs`),{loadFacilityView}=await import(`file://${root}/tests/helpers/kamakura-facility-view.mjs`),{THREE,load}=await import(`file://${root}/tests/helpers/tree-modules.mjs`);
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const dir=process.env.KZ_WORLD_DIR;if(!dir){console.log('KZ_WORLD_DIR未設定：私有v0.9測定をスキップ');process.exit(0);}
const data=await loadKamakura(async url=>{const b=await fs.readFile(path.join(dir,path.basename(url)));return {ok:true,json:async()=>JSON.parse(b),arrayBuffer:async()=>b.buffer.slice(b.byteOffset,b.byteOffset+b.byteLength)};});
let calls=0,ms=0;globalThis.__bootRiverProbe=(fn,...a)=>{const start=performance.now();const value=fn(...a);ms+=performance.now()-start;calls++;return value;};
const terrain=createKamakuraTerrain(data),spawn=kamakuraSpawn(terrain,''),scene=new THREE.Scene();
const {buildKamakuraHouses}=await loadHouseView(),{buildKamakuraFacilities}=await loadFacilityView();
const houses=await buildKamakuraHouses(data.houses,terrain,scene,{search:'?htex=0'}),facilities=await buildKamakuraFacilities(data.facilities,terrain,scene,'standard',{search:'?ftex=0'});
const boxes=[...houses.boxes,...facilities.exclusionBoxes],prepared=prepareVeg(data.veg,terrain,{boxes,paths:data.patches?.paths||{},spawn}),{vegHeight}=await load('kamakura-veg-view.js');
const colliders=buildColliders({bounds:terrain.bounds,extraBoxes:boxes,extraCircles:vegCircles(prepared,vegHeight)}),surface=createSurfaceCodeAt(data.meta,data.surface),sites=[spawn];let grass=false,forest=false;
const {width,height,cell_m:cell}=data.meta.grid;
for(let j=0;j<height&&(!grass||!forest);j+=7)for(let i=0;i<width&&(!grass||!forest);i+=7){const x=(i-(width-1)/2)*cell,z=(j-(height-1)/2)*cell,code=surface(x,z);if(((code===2&&!grass)||(code===3&&!forest))&&terrain.walkable(x,z)&&terrain.slopeAt(x,z)<20&&terrain.waterAt(x,z)===0){sites.push({x,z});if(code===2)grass=true;else forest=true;}}
const original=terrain.riverDistanceAt;if(!process.env.KZ_PROFILE_RIVERS)terrain.riverDistanceAt=(...a)=>globalThis.__bootRiverProbe(original,...a);
const measure=fn=>{calls=ms=0;const start=performance.now();fn();return {cpuMs:+(performance.now()-start).toFixed(2),riverCalls:calls,riverMs:+ms.toFixed(2)};};
console.log('atlas',measure(()=>houseTextureData()));
console.log('fish',measure(()=>prepareFishRivers(data.rivers,terrain.vscale,terrain)));
const {buildKamakuraGrass}=await load('kamakura-grass-view.js');
for(const quality of ['standard','light'])for(let i=0;i<sites.length;i++){
 const pos=sites[i],camera={position:new THREE.Vector3(pos.x,terrain.heightAt(pos.x,pos.z)+1.7,pos.z)},wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
 const v=buildKamakuraGrass({data,terrain,colliders,wind,sunDir:new THREE.Vector3(1,1,0),quality});
 console.log(quality,i,'warm',measure(()=>v.warm(camera,pos)));
 console.log(quality,i,'settle',measure(()=>{for(let j=0;j<2000;j++){v.update(camera,pos);if(!v.stats().pending&&!v.stats().queue)break;}}));v.dispose();
}
houses.dispose();facilities.dispose();delete globalThis.__bootRiverProbe;
