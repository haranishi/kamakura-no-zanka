import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { THREE, source } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { createFarGroundField } from '../dist/valley/kamakura-ground-density.js';
import { toneChannel, toneRelief } from '../dist/valley/kamakura-ground-tone-rules.js';
import { groundContactFor, CONTACT } from '../dist/valley/kamakura-ground-contact.js';
import { groundPathFor } from '../dist/valley/kamakura-ground-path.js';
import { adaptPolicy } from '../dist/valley/kamakura-adapt.js';
import { vegPolicy } from '../dist/valley/kamakura-veg.js';
import { kamakuraPaths } from '../dist/valley/kamakura-roads.js';
import { STAND_COLOR } from '../dist/valley/kamakura-stands.js';
import { registerShoreView, unregisterShoreView } from '../dist/valley/kamakura-shore.js';
import { GROUND_FAR as C, GROUND_FAR_GLSL, groundFarToneWeight, groundFarChannel, groundFarCanopy, groundFarCrownFade, groundFarRoadCoverage, groundFarCanopyColor } from '../dist/valley/kamakura-ground-far.js';

function data(){
  const d=fixture({width:33,height:33,cell:4});d.meta.surface={};d.ground=new Uint8Array(33*33*3).fill(140);d.surface=new Uint8Array(33*33).fill(4);
  d.roads={road:{xyz_m:[[-48,30,0],[48,-30,0]],width_m:8}};
  d.veg=[{x:36,z:-36,crown:22,sourceSpecies:0,tier:2}];return d;
}
function setup(search='',quality='standard',d=data(),shore=false){
  if(shore)registerShoreView(d,{});
  const material=new THREE.MeshLambertMaterial({vertexColors:true});
  const owner=installGroundDetail(THREE,material,d,{search,quality});
  const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};
  material.onBeforeCompile(shader);
  return {d,owner,shader,material,dispose(){owner.dispose();material.dispose();if(shore)unregisterShoreView(d);}};
}
function bake(d){const f=createFarGroundField(d,C,groundFarRoadCoverage);let calls=0;
  while(!f.done){const before=f.work;f.step(64);assert(f.work-before<=64);assert(++calls<1000000);}
  return f;
}
function fieldAt(f,x,z,channel=0){const i=Math.floor((x/f.spanX+.5)*f.size),j=Math.floor((z/f.spanZ+.5)*f.size);return f.bytes[(j*f.size+i)*4+channel]/255;}
function expanded(s){return s.replace(/#include <(\w+)>/g,(_,name)=>{assert.equal(typeof THREE.ShaderChunk[name],'string');return expanded(THREE.ShaderChunk[name]);});}
function validateGLSL(s){
  const clean=expanded(s).replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
  assert(!/--\s*\d|\b\d+(?:\.\d*)?(?:mix|vec\d|clamp)\s*\(/.test(clean));
  assert(!/\b(?:float|vec[234]|int)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(clean));
  const declared=new Map();
  for(const m of clean.matchAll(/\buniform\s+(?:(?:lowp|mediump|highp)\s+)?\w+\s+([^;]+);/g))for(const x of m[1].split(','))declared.set(x.trim().match(/^\w+/)[0],m.index);
  for(const m of clean.matchAll(/\bu[A-Z]\w*\b/g)){assert(declared.has(m[0]),m[0]+' absent');assert(declared.get(m[0])<=m.index,m[0]+' used before declaration');}
  for(const name of ['groundFarField','groundFarContact','groundFarToneWeight','groundFarColor']){
    const call=clean.match(new RegExp(`\\b${name}\\s*\\(`));if(call){const decl=clean.match(new RegExp(`\\b(?:float|vec[234])\\s+${name}\\s*\\(`));assert(decl&&decl.index<=call.index,name+' missing forward declaration');}
  }
  // New scalar GLSL arguments are floats, including generated constants, never integer literals.
  for(const args of GROUND_FAR_GLSL.matchAll(/(?:smoothstep|step|pow|max|min)\(([^()]+)\)/g))for(const arg of args[1].split(','))assert(!/^\s*-?\d+\s*$/.test(arg));
  return clean;
}

test('G1 exact walking mirror, monotone slant-distance fade and <=15% far patch range',()=>{
  for(let d=0;d<=250;d+=5)for(const n of [0,.1,.5,.9,1])for(let c=0;c<3;c++){
    const relief=toneRelief(25,.9,.1,.2,n);
    assert.equal(groundFarChannel(.3,c,relief,.1,.2,.3,d),toneChannel(.3,c,relief,.1,.2,.3));
    assert.equal(groundFarChannel(.3,c,relief,.1,.2,.3,3000,false),toneChannel(.3,c,relief,.1,.2,.3));
  }
  let previous=1;for(let d=0;d<4000;d++){const w=groundFarToneWeight(d);assert(w<=previous);previous=w;}
  assert.equal(groundFarToneWeight(250),1);assert(groundFarToneWeight(700)<=.15);
  assert.equal(groundFarToneWeight(Math.hypot(0,900)),0);
  assert.equal(groundFarChannel(.3,0,.85,0,0,0,700),groundFarChannel(.3,0,-.85,0,0,0,700));
});

test('G1 gfar=0 shaders match pre-change HEAD byte for byte; no far resources, hooks or cache key',()=>{
  // Hash only fixed shader strings, not generated trigonometric tables or private data.
  const expected=['0897399f735433eec58f69ac860fc00ef9403736f23e3b2c389dafa2bb90ff15','edbf8ef9bcfae48fe36b81565358c58db532b94029325ed521bbaeb54e1caa36','8c28e006d6fa6aae069e3a548f19589e9b450b63875ce5fe06b997da620f43bc'];
  for(const [i,flags] of ['', '&ground6=0&ground7=0','&slope7=0'].entries()){
    const d=fixture({width:9,height:9,cell:2});d.meta.surface={};d.ground=new Uint8Array(243).fill(140);d.surface=new Uint8Array(81).fill(4);
    const h=setup('?gfar=0&cliff=0'+flags,'standard',d);try{
      assert.equal(createHash('sha256').update(h.shader.vertexShader+'\n'+h.shader.fragmentShader).digest('hex'),expected[i]);
      assert.equal(h.owner.far,undefined);assert(!h.shader.fragmentShader.includes('groundFar'));
      assert(!h.material.customProgramCacheKey().includes('ground-far'));
    }finally{h.dispose();}
  }
});

test('G2 density law, height-independent canopy, 100m transition, cliffs and filtered mean',()=>{
  for(const quality of ['standard','light']){
    const range=vegPolicy(quality).range;
    for(const d of [0,100,range])assert.equal(groundFarCanopy(1,d,1,3,quality),0);
    assert.equal(groundFarCanopy(.25,range+100,1,3,quality),0);
    assert.equal(groundFarCanopy(.6,range+100,1,3,quality),.9);
    assert.equal(groundFarCanopy(.6,Math.hypot(0,900),1,3,quality),.9);
    for(const code of [0,1,5])assert.equal(groundFarCanopy(1,3000,1,code,quality),0);
    assert.equal(groundFarCanopy(1,3000,.5,3,quality),0);
    const epsilon=.001;assert(groundFarCanopy(1,range+epsilon,1,3,quality)<1e-8);
    assert(.9-groundFarCanopy(1,range+100-epsilon,1,3,quality)<1e-8);
  }
  assert.equal(groundFarCrownFade(C.crownMeters),0);assert.equal(groundFarCrownFade(0),1);
  const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  for(const [k,value] of groundFarCanopyColor().entries()){
    const mean=STAND_COLOR.reduce((s,c)=>s+linear(c[k]/C.standLightGain/255),0)/STAND_COLOR.length;
    // Far crowns are about twice the stand palette (STANDS2.gain, tuned in real Chrome), so half a sunlit crown is about the palette itself.
    assert(Math.abs(value/mean-C.canopyShade)<1e-12);assert(value>=mean*.9&&value<=mean*1.5);
  }
  assert(!/cameraPosition\.y/.test(GROUND_FAR_GLSL));assert(GROUND_FAR_GLSL.includes('fwidth(p)'));
});

test('G2 all tiers outside walk area, resolution, deterministic coverage, empty input and protected shores/rock',()=>{
  const d=data();d.walk.fill(0);const f=bake(d),same=bake(d);
  assert(f.metersPerTexel<=24);assert.deepEqual(f.bytes,same.bytes);assert(fieldAt(f,36,-36)>C.densityFrom);
  d.veg.push(...d.veg,...d.veg);assert(fieldAt(bake(d),36,-36)>=C.densityTo);assert(fieldAt(f,-48,48)<.25);
  d.veg=[];assert.equal(bake(d).forestShare,0);
  d.veg=[{x:0,z:0,crown:24,sourceSpecies:6,tier:0}];assert(bake(d).forestShare>0);
  d.veg[0].sourceSpecies=4;assert.equal(bake(d).forestShare,0);
  for(const code of [0,1,5]){d.veg=[{x:36,z:-36,crown:22,sourceSpecies:0,tier:2}];d.surface.fill(code);const f=bake(d);for(let i=0;i<f.bytes.length;i+=4)assert.equal(f.bytes[i],0);}
  const huge=data();huge.meta.grid.cell_m=C.maxSize*C.texelMeters;assert.throws(()=>bake(huge),RangeError);
});

test('G3 line coverage conserves width below a pixel, includes all routes and handles worlds without roads',()=>{
  for(const width of [1,4,12])for(const pixel of [.5,3,16,64]){
    let area=0;const step=.025,extent=width+pixel;
    for(let d=-extent;d<=extent;d+=step)area+=groundFarRoadCoverage(d,width,pixel)*step;
    assert(Math.abs(area-width)<.03);assert(groundFarRoadCoverage(0,width,pixel)<=Math.min(1,width/pixel)+1e-10);
  }
  const d=data();d.patches={paths:{pass:{xyz_m:[[-48,-48,0],[48,-48,0]],width_m:3}}};d.sando={approach:{xyz_m:[[-48,48,0],[48,48,0]],width_m:12}};
  const f=bake(d);assert.equal(f.roadCount,Object.keys(kamakuraPaths(d)).length);
  for(const p of Object.values(kamakuraPaths(d)))for(let k=0;k<=20;k++){
    const a=p.xyz_m[0],b=p.xyz_m[1],t=k/20;assert(fieldAt(f,a[0]+t*(b[0]-a[0]),-a[1]-t*(b[1]-a[1]),1)>0,'continuous diagonal/narrow road');
  }
  d.rivers={rivers:[{xy_m:[[-48,0],[48,0]],width_m:[4,4]}]};const protectedField=bake(d);assert.equal(fieldAt(protectedField,0,0,1),0);assert(fieldAt(protectedField,0,0,2)>0);
  const empty=data();delete empty.roads;assert.equal(bake(empty).roadCount,0);
  const nearest=f.nearest({x:0,y:900,z:0});assert(nearest.distance>=900);assert(nearest.bearing>=0&&nearest.bearing<360);
});

test('G4/G5 assembled GLSL, real include hooks, max 16 samplers including shadow, quality/adapt and debug cleanup',async t=>{
  for(const quality of ['standard','light'])for(const flags of ['', '&ground6=0&ground7=0','&slope7=0','&photo=0'])for(const shore of [false,true]){
    const h=setup('?debug=1&gfardebug=1'+flags,quality,data(),shore);try{
      await h.owner.far.ready;
      const s=validateGLSL(h.shader.fragmentShader);validateGLSL(h.shader.vertexShader);
      const samplers=new Set([...s.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(',').map(x=>x.trim())));
      // Unexpanded directional shadow arrays are included in the parser; 1 active sun sampler is added separately.
      const projectSamplers=[...samplers].filter(x=>!x.includes('[')&&!['map','alphaMap','aoMap','lightMap','emissiveMap','specularMap','envMap','bumpMap','normalMap'].includes(x));
      const custom=new Set([...h.shader.fragmentShader.matchAll(/uniform sampler2D\s+([^;]+);/g)].flatMap(m=>m[1].split(',')));
      assert(custom.size+1<=16);assert(projectSamplers.length>0);
      assert(h.shader.fragmentShader.includes('groundFarColor(diffuseColor.rgb,vGroundWorld,vGroundSlope,distance(vGroundWorld,cameraPosition))'));
      assert(h.shader.fragmentShader.includes('if(uGroundFarDebug>0.5)gl_FragColor.rgb=groundFarDebugColor;'));
      assert(h.shader.fragmentShader.includes('if(dist>250.0)relief*=groundFarToneWeight(dist);'));
      assert(h.shader.fragmentShader.includes('slope7Forest')||flags.includes('slope7=0'));
      const far=h.owner.far,u=far.uniforms;
      assert.equal(u.uGroundFarDebug.value,1);assert.equal(globalThis.__kzGroundFar().enabled,true);
      assert(far.stats.mipBytes<=2*1024*1024);assert(far.textures.length<=2);
      const before=u.uGroundFarFineDistance.value;h.owner.setAdapt(1);assert(u.uGroundFarFineDistance.value<before);
      h.owner.setAdapt(2);assert.equal(u.uGroundFarFine.value,0);h.owner.setAdapt(3);assert.equal(u.uGroundFarFine.value,0);
      assert.equal(u.uGroundFarCanopyRange.value.x,vegPolicy(quality).range*adaptPolicy(3).impostorRange);
      assert.equal(globalThis.__kzGroundFar().canopy.from,u.uGroundFarCanopyRange.value.x);
      h.owner.setAdapt(0);assert.equal(u.uGroundFarFine.value,quality==='light'?0:1);
      h.owner.far.update({x:0,y:900,z:0});assert(globalThis.__kzGroundFar().nearest.distance>=900);
      t.diagnostic(JSON.stringify({quality,shore,customSamplers:custom.size,extraTriangles:far.stats.triangles,extraDrawCalls:far.stats.drawCalls,work:far.stats.work,mipBytes:far.stats.mipBytes}));
    }finally{h.dispose();assert.equal(globalThis.__kzGroundFar,undefined);}
  }
  for(const hook of ['common','begin_vertex'])assert(THREE.ShaderLib.lambert.vertexShader.includes('#include <'+hook+'>'));
  for(const hook of ['normal_fragment_begin','color_fragment','dithering_fragment'])assert(THREE.ShaderLib.lambert.fragmentShader.includes('#include <'+hook+'>'));
});

test('G5 packed near fields retain exact LOD0 bytes after contact/path changes; dispose once, cancelled bake, frame allocations',async()=>{
  const h=setup();try{
    const contact=groundContactFor(h.d),path=groundPathFor(h.d),texture=h.owner.far.textures[0];
    const field=h.owner.far.field,bytes=field.bytes;await h.owner.far.ready;
    const pos={x:0,y:0,z:0},boxes=[{x:0,z:0,w:2,d:2}],circles=[];
    contact.update(pos,boxes,circles);path.update(pos,kamakuraPaths(h.d));
    const atlas=texture.image;
    for(let j=0;j<field.size;j++)for(let i=0;i<field.size;i++)for(let c=0;c<3;c++)assert.equal(atlas.data[(contact.texture.image.height+c*field.size+j)*atlas.width+i],field.bytes[(j*field.size+i)*4+c]);
    assert.equal(h.owner.uniforms.uGroundContact.value,texture);
    for(let j=0;j<contact.texture.image.height;j++)for(let i=0;i<CONTACT.size;i++)assert.equal(atlas.data[j*atlas.width+i],contact.texture.image.data[j*CONTACT.size+i]);
    for(let i=0;i<1000;i++){h.owner.far.update(pos);contact.update(pos,boxes,circles);path.update(pos,kamakuraPaths(h.d));}
    assert.equal(h.owner.far.field,field);assert.equal(h.owner.far.field.bytes,bytes);assert.equal(texture.image,atlas);
    const functions=source('kamakura-ground-far.js').match(/function syncNear\(\)[\s\S]*?\n  }/)[0];assert(!/new |\.map\(|\.slice\(|\.subarray\(|=>/.test(functions));
    let farDispose=0,nearDispose=0;texture.addEventListener('dispose',()=>farDispose++);contact.texture.addEventListener('dispose',()=>nearDispose++);
    h.owner.dispose();h.owner.dispose();assert.equal(farDispose,1);assert.equal(nearDispose,1);
  }finally{h.dispose();}
  const cancelled=setup('?debug=1');cancelled.dispose();await cancelled.owner.far.ready;assert.equal(cancelled.owner.far.uniforms.uGroundFarReady.value,0);
});

test('private G1–G5 no exceptions, field resolution/capacity and forest share only',async t=>{
  if(!process.env.KZ_WORLD_DIR){t.skip('KZ_WORLD_DIR未設定');return;}
  const {loadKamakura}=await import('../dist/valley/kamakura-data.js');
  const d=await loadKamakura(async url=>{const bytes=await readFile(join(process.env.KZ_WORLD_DIR,url.replace('/world-private/','')));return {ok:true,json:async()=>JSON.parse(bytes.toString()),arrayBuffer:async()=>bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength)};});
  const h=setup('?debug=1','standard',d);try{
    await h.owner.far.ready;const f=h.owner.far.field,stats=h.owner.far.stats;
    assert(f.metersPerTexel<=C.texelMeters);assert(stats.mipBytes<=2*1024*1024);assert(f.forestShare>=0&&f.forestShare<=1);
    for(let i=0;i<f.bytes.length;i+=4)if(f.bytes[i+2]>0)assert.equal(f.bytes[i+1],0);
    t.diagnostic(JSON.stringify({forestShare:f.forestShare,addedTextureBytesWithMips:stats.mipBytes,extraTriangles:stats.triangles,extraDrawCalls:stats.drawCalls,bakeWork:stats.work,maxSliceMs:stats.maxSliceMs}));
  }finally{h.dispose();}
});
