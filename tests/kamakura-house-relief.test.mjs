import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {HOUSE_RELIEF as R, houseRoofRelief, houseInteriorTone, houseTextureData, facilityInterior, houseHash} from '../dist/valley/kamakura-house-texture.js';
import {THREE,loadHouseMaterials} from './helpers/kamakura-house-view.mjs';
import {loadFacilityView} from './helpers/kamakura-facility-view.mjs';
import {neutralGray} from '../dist/valley/kamakura-post.js';
import {buildGlb} from '../tools/lib/glb.mjs';
const shaderFor=material=>{const shader={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};material.onBeforeCompile(shader);return shader;};
const stats=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length;return {mean,sd:Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length)};};
function kit() {
  // Three disconnected real members in one anonymous white primitive, plus a dark recess.
  const boxes=[[.24,3,.24,-3,1.5,0],[4,.22,.22,0,2.6,1],[3,2,.2,1,1.1,2]];
  const values=[];
  for(const [w,h,d,x,y,z] of boxes){const g=new THREE.BoxGeometry(w,h,d).toNonIndexed();g.translate(x,y,z);values.push(...g.attributes.position.array);g.dispose();}
  const bin=Buffer.from(new Float32Array(values).buffer);
  const json={asset:{version:'2.0'},scene:0,scenes:[{nodes:[0]}],nodes:[{name:'synthetic',mesh:0}],buffers:[{byteLength:bin.length}],bufferViews:[{buffer:0,byteLength:bin.length}],accessors:[{bufferView:0,componentType:5126,type:'VEC3',count:values.length/3,min:[-4,0,-1],max:[4,4,3]}],meshes:[{primitives:[{attributes:{POSITION:0},material:0},{attributes:{POSITION:0},material:1}]}],materials:[{pbrMetallicRoughness:{baseColorFactor:[.7,.7,.7,1]}},{pbrMetallicRoughness:{baseColorFactor:[.04,.043,.045,1]}}]};
  const buffer=buildGlb({json,bin});
  return {kit:buffer.buffer.slice(buffer.byteOffset,buffer.byteOffset+buffer.byteLength),nodes:[{part:'hall',node:'synthetic',soft:false,triangles:72,anchor_xz:[0,0],rel_anchor:0}]};
}
test('R3 straw has metre density on either roof slope, stronger fine contrast, zero mean and footprint convergence',async t=>{
  const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial(),m=createHouseMaterial(base,{parts:true});
  try{
    const {vertexShader,fragmentShader}=shaderFor(m);
    assert(vertexShader.includes('vHouseRoofP *= houseScale'));
    assert(fragmentShader.includes('dot(vHouseRoofP,across)'));assert(fragmentShader.includes('dot(vHouseRoofP,down)'));
    assert(fragmentShader.includes('roofSurface=mix(roofSurface,.5+strawDetail,houseRelief)'));
    const lines=['su','sw','sf','sa','sc','strawDetail'].map(name=>fragmentShader.match(new RegExp(`float ${name}=([^;]+);`))[0]).join('\n')
      .replace(/float /g,'let ').replace(/\b(sin|exp|pow)\(/g,'Math.$1(').replace(/strawUV\.x/g,'x').replace(/strawUV\.y/g,'y');
    const actual=new Function('x','y','fwidth',lines+'return strawDetail;');
    const values=[];
    for(let i=0;i<10000;i++){
      const x=i*.0017,y=i*.0003,v=actual(x,y,()=>0);values.push(v);
      assert(Math.abs(v-houseRoofRelief(x,y))<1e-7);
      assert(Math.abs(houseRoofRelief(x,y,1))<1e-8);
    }
    const s=stats(values);assert(Math.abs(s.mean)<.01);assert(s.sd>.11&&s.sd<.16);
    const atlas=houseTextureData(),old=[];for(let i=0;i<atlas.length;i+=4)old.push(atlas[i]/255-.5);
    const contrastRatio=s.sd/stats(old).sd;assert(contrastRatio>=1.5);
    assert(R.straw>=.08&&R.straw<=.14);assert(R.bundle>=.25&&R.bundle<=.4);
    // Enlarging a face adds repeats instead of stretching each repeat.
    const crossings=length=>{let n=0,last=houseRoofRelief(0,1);for(let x=.002;x<length;x+=.002){const v=houseRoofRelief(x,1);if(last<=0&&v>0)n++;last=v;}return n;};
    const short=crossings(4),long=crossings(12);assert(long/short>2.7&&long/short<3.3);
    t.diagnostic(JSON.stringify({strawMetres:R.straw,bundleMetres:R.bundle,reliefMean:s.mean,reliefSD:s.sd,syntheticContrastRatio:contrastRatio,repeatGrowth:long/short}));
  }finally{m.dispose();base.dispose();}
});
test('R3 actual facility path separates existing posts/beams from plaster; dark recess has bounded depth and fill',async t=>{
  const {buildKamakuraFacilities}=await loadFacilityView(),fields=[];
  try{
    for(const search of ['', '?hrelief=0','?hparts=0'])fields.push(await buildKamakuraFacilities(kit(),{heightAt:()=>0},new THREE.Scene(),'standard',{search}));
    const meshes=fields[0].records[0].meshes,white=meshes.find(m=>m.material.userData.houseUniforms.houseInterior.value===0),dark=meshes.find(m=>m.material.userData.houseUniforms.houseInterior.value===1);
    assert(white&&dark);const weights=white.geometry.attributes.houseTimber.array;
    assert.equal(weights.length,108);assert(Array.from(weights.slice(0,72)).every(v=>v===1));assert(Array.from(weights.slice(72)).every(v=>v===0));
    const whiteCode=shaderFor(white.material).fragmentShader;
    assert(whiteCode.includes('vHouseTimber*houseRelief'));assert(whiteCode.includes('(1.0-roof)*(1.0-stone)*(1.0-post)'));
    assert(whiteCode.includes('target = mix(target,house_post,post)'));
    const code=shaderFor(dark.material).fragmentShader;
    assert(code.includes('totalEmissiveRadiance += houseInteriorFill'));assert(code.includes('houseInteriorFill=(recess*.65+vec3(.031))*houseRelief*houseFade'));
    const expression=code.match(/float it=clamp\(([^;]+)\);/)[1];
    const actual=new Function('iy','ib','ip',`return Math.min(${R.interiorMax},Math.max(${R.interiorMin},${expression.slice(0,expression.lastIndexOf(','+R.interiorMin))}));`);
    const values=[];
    for(let i=0;i<=100;i++)for(let x=0;x<12;x++){
      const y=i/100,beam=Math.exp(-(((y-.78)/.045)**2)),tone=houseInteriorTone(y,x*.32);
      assert(tone>=R.interiorMin&&tone<=R.interiorMax);values.push(tone);
      // Evaluate emitted GPU expression including its clamp and spatial inputs.
      const plank=houseHash(Math.floor((x*.32)/.32),17)-.5;
      assert(Math.abs(actual(y,beam,plank)-tone)<1e-9);
    }
    assert(houseInteriorTone(.1,0)>houseInteriorTone(.95,0));
    assert(houseInteriorTone(.78,0)<(houseInteriorTone(.68,0)+houseInteriorTone(.88,0))/2);
    const srgb=v=>255*(v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055),s=stats(values.map(srgb));assert(s.sd>3);assert(Math.min(...values.map(srgb))>=20);
    // The shipped neutral transfer crushes unlit dark colors. Include its toe and grade,
    // rather than reporting a source pigment floor as a screen brightness guarantee.
    const shadow=values.map(v=>{const toned=neutralGray(v*.89*.65+.031);const shaped=toned**1.025;return srgb(shaped/(shaped+(1-toned)**1.025)*.9);});
    assert(Math.min(...shadow)>=15);assert(stats(shadow).sd>=3);
    for(let i=1;i<fields.length;i++){
      const old=fields[i].records[0].meshes[0];assert.equal(old.material.userData.houseUniforms.houseRelief.value,0);
      assert.deepEqual(old.geometry.attributes.position.array,white.geometry.attributes.position.array);
      assert.deepEqual(fields[i].boxes,fields[0].boxes);
    }
    assert(!facilityInterior([.55,.045,.02],2));assert(!facilityInterior([.04,.04,.04],6));
    t.diagnostic(JSON.stringify({syntheticTimberVertices:72,plasterVertices:36,interiorMinSRGB:Math.min(...values.map(srgb)),interiorToneSD:s.sd,syntheticUnlitNeutralMin:Math.min(...shadow),syntheticUnlitNeutralSD:stats(shadow).sd}));
  }finally{fields.forEach(f=>{f.dispose();f.dispose();});}
});
test('R3 lime joints are weak, irregular and remain in the actual shader; quality/adaptation are reversible',async t=>{
  const data=houseTextureData(),gaps=[];
  for(let y=40;y<460;y+=41){let previous=-1;for(let x=1;x<511;x++){
    const value=data[(y*512+x)*4+3];
    if(value<116&&value<data[(y*512+x-1)*4+3]&&value<=data[(y*512+x+1)*4+3]){if(previous>=0)gaps.push((x-previous)*8/511);previous=x;}
  }}
  assert(gaps.length>30);assert(stats(gaps).sd>.06);
  const {createHouseMaterial}=await loadHouseMaterials(),base=new THREE.MeshStandardMaterial();
  try{for(const quality of ['standard','light']){
    const material=createHouseMaterial(base,{parts:true,facilityRole:8,quality}),u=material.userData.houseUniforms;
    const code=shaderFor(material).fragmentShader;assert(code.includes('mix(.20,1.15,houseRelief)'));
    assert(code.includes('target=mix(house_lime,house_oldLime'));assert(u.houseRelief.value>0&&u.houseRelief.value<=1);
    for(const step of [2,3,0]){material.userData.setHouseAdapt(step);assert.equal(u.houseRelief.value,step===3?0:step===2?.55:quality==='light'?.7:1);}
    material.dispose();
  }}finally{base.dispose();}
  t.diagnostic(JSON.stringify({jointGapSDMetres:stats(gaps).sd}));
});
test('R3 private halls contain detected timber and interiors; source vermilion stays protected', {skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有施設が必要'},async()=>{
  const dir=process.env.KZ_WORLD_DIR,bin=await fs.readFile(path.join(dir,'facilities.glb')),catalog=JSON.parse(await fs.readFile(path.join(dir,'facilities.json')));
  const {buildKamakuraFacilities}=await loadFacilityView();
  // Every hall standing: the default since W2c-18 leaves the Great Buddha's hall out (open-air Buddha).
  const field=await buildKamakuraFacilities({nodes:catalog.nodes,kit:bin.buffer.slice(bin.byteOffset,bin.byteOffset+bin.byteLength)},{heightAt:()=>0},new THREE.Scene(),'standard',{search:'?buddha=hall'});
  try{
    let timber=false,interior=false,red=false;
    for(const r of field.records)for(const mesh of r.meshes){
      if(r.node.part==='hall'&&mesh.geometry.attributes.houseTimber.array.some(v=>v===1))timber=true;
      for(const m of [].concat(mesh.material)){
        const u=m.userData.houseUniforms;interior ||=u.houseInterior.value===1;
        if(m.color.r>m.color.g*2.5&&m.color.r>m.color.b*3){red=true;assert.equal(u.houseKeepPigment.value,1);assert.equal(u.houseInterior.value,0);}
      }
    }
    assert(timber&&interior&&red);
  }finally{field.dispose();}
});
test('R3 fix roof straw spacing wanders instead of repeating like corrugated iron',()=>{
  const gaps=[];let last=houseRoofRelief(0,1),previous=null;
  for(let x=.001;x<30;x+=.001){const v=houseRoofRelief(x,1);if(last<=0&&v>0){if(previous!==null)gaps.push(x-previous);previous=x;}last=v;}
  const mean=gaps.reduce((a,b)=>a+b)/gaps.length,sd=Math.sqrt(gaps.reduce((a,g)=>a+(g-mean)**2,0)/gaps.length);
  assert(gaps.length>200);assert(Math.abs(mean-R.straw)<.01,`mean spacing ${mean}`);
  assert(sd/mean>=.25,`spacing variation ${sd/mean}`); // the periodic version measured 0.10
});
