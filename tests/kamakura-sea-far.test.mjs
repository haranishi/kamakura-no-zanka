import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {SEA_FAR as C,sea2Enabled,seaGrazing,seaSkyTint,seaSwellGain,seaLineGain,seaLineCount,seaLineCentre,seaLineWidth,seaLineGap,seaOffshoreColor,seaFinalColor,SEA_FAR_GLSL,SHADER_ANCHORS} from '../dist/valley/kamakura-sea-far.js';
import {seaBand4} from '../dist/valley/kamakura-shore-r4.js';
import {kamakuraAtmosphere} from '../dist/valley/kamakura-atmosphere.js';
import {THREE,load,source} from './helpers/tree-modules.mjs';
const {ATMOS}=await load('atmosphere.js');
const {buildKamakuraSea}=await load('kamakura-sea-view.js');
const terrain=()=>({bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},cell:4,heightAt:(_x,z)=>-z*.05,isSea:(_x,z)=>z>0,riverDistanceAt:()=>Infinity,seaDistanceAt:(_x,z)=>Math.max(0,-z)});
const data=()=>({rivers:[],meta:{grid:{width:51,height:51,cell_m:4},surface:{}},surface:new Uint8Array(2601)});
const shader=view=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};view.mesh.material.onBeforeCompile(s);return s;};
const luminance=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722;

test('S1 grazing endpoints and monotonic transition preserve five walking views exactly',()=>{
  assert(sea2Enabled(''));assert(!sea2Enabled('?sea2=0'));
  for(let angle=0,previous=1;angle<=90;angle+=.25){const g=seaGrazing(Math.sin(angle*Math.PI/180));assert(g<=previous+1e-12);if(angle<=C.grazingFullDeg)assert.equal(g,1);if(angle>=C.grazingEndDeg)assert.equal(g,0);previous=g;}
  const lit=[.021,.08,.12],sky=[.8,.7,.6];
  for(const range of [200,300,600,1200,2400]){
    const actual=seaFinalColor(lit,240,2.5/Math.hypot(range,2.5),sky),h=seaBand4(240,200);
    assert.deepEqual(actual,lit.map((v,i)=>v+(sky[i]-v)*h));
  }
});

test('S1 offshore colour is independent of the capped shore field and stays dark at all four times',()=>{
  for(const time of ['noon','morning','golden','evening']){
    const a=kamakuraAtmosphere(time,{...ATMOS,sunDir:ATMOS.sunDir.toArray()}),h=new THREE.Color(a.horizon).toArray();
    for(const angle of [17,22,45,90]){
      const cosine=Math.sin(angle*Math.PI/180),a=seaFinalColor([.5,.5,.5],240,cosine,h),b=seaFinalColor([.5,.5,.5],3000,cosine,h);
      assert.deepEqual(a,b);assert(luminance(a)<=luminance(h)*.45);assert(a.every((v,i)=>Math.abs(v-seaOffshoreColor(cosine,h)[i])<1e-12));
    }
  }
  assert(C.reflectionMin>=.02&&C.reflectionMin<=.05);assert(Object.isFrozen(C)&&Object.isFrozen(C.deep));
});

test('S2 unequal fronts advance one band each 25 seconds, break up and conserve coverage when widened',()=>{
  assert.deepEqual(C.linePositionsM,[6,22,48,85]);assert.equal(seaLineCount(),4);
  for(let i=0;i<4;i++){
    assert(seaLineCentre(i,1)<seaLineCentre(i,0));
    assert.equal(seaLineCentre(i,25),seaLineCentre(i,0));
    const near=seaLineCentre(i,-C.linePhase*C.linePeriodS+.001),end=seaLineCentre(i,(1-C.linePhase)*C.linePeriodS-.001);
    assert(Math.abs(near-C.linePositionsM[i])<.01);assert(Math.abs(end-(i?C.linePositionsM[i-1]:0))<.01);
    let gaps=0,body=0;
    for(let x=0;x<2000;x+=2){const n=seaLineGap(x,0,i);if(n===0)gaps++;if(n>.8)body++;}
    assert(gaps>0&&body>0);
    for(const footprint of [0,.1,1,10,100]){const w=seaLineWidth(i,footprint);assert(w.width>=footprint*1.5);assert.equal(w.width*w.alpha,C.lineWidthsM[i]);}
  }
  for(const r of [0,100,150])assert.equal(seaLineGain(r),0);
  assert.equal(seaLineGain(400),1);assert.equal(seaSwellGain(300),0);assert.equal(seaSwellGain(800),1);assert.equal(seaSwellGain(30000),1);
  assert.equal(seaLineCount('light'),2);assert.equal(seaLineCount('standard',2),2);assert.equal(seaLineCount('standard',3),0);
});

test('S1 sea2=0 retains the pre-change shader bytes, resource format and program key',()=>{
  const v=buildKamakuraSea(terrain(),data(),{search:'?sea2=0&bankwet=0'}),s=shader(v);
  // Recorded from HEAD before W2c-18: shader source, not a floating-point-generated geometry hash.
  assert.equal(createHash('sha256').update(s.vertexShader+'\n'+s.fragmentShader).digest('hex'),'281fcef06279bb44f9ce15ef8d9759b194c532572b9bc85cc5e5005c669c27b3');
  assert.equal(v.mesh.material.customProgramCacheKey(),'kamakura-sea-11-shore6');assert(!s.fragmentShader.includes('sea2Grazing'));
  assert.equal(v.textures[0].format,THREE.RedFormat);assert(!('uSea2' in v.uniforms));v.dispose();
});

function checkGLSL(s){
  s=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');const stack=[];
  for(const ch of s){if('([{'.includes(ch))stack.push(ch);else if(')]}'.includes(ch))assert.equal(stack.pop(),'([{'[')]}'.indexOf(ch)]);}assert.equal(stack.length,0);
  assert(!/--\s*\d/.test(s));assert(!/\b\d+(?:\.\d*)?[A-Za-z_]\w*\s*\(/.test(s));
  assert(!/\b(?:float|int|bool|vec[234]|mat[234]|sampler2D)\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(s));
  // Added functions exclusively use float operations; an integer literal cannot silently enter an overload.
  if(s===SEA_FAR_GLSL)assert(!/(?<![\w.])\d+(?![\w.])/.test(s.replace(/vec[234]|sampler2D/g,'')));
}
// Resolve branches before checking braces: stock Three has alternative function headers with a shared body.
function preprocess(s,defines={}){
  const macros={...defines},stack=[],out=[];let active=true;
  const evaluate=expr=>{
    const text=expr.replace(/defined\s*\(\s*(\w+)\s*\)|defined\s+(\w+)/g,(_,a,b)=>Object.hasOwn(macros,a||b)?'1':'0').replace(/\b[A-Za-z_]\w*\b/g,n=>String(macros[n]??0));
    assert(/^[\d\s.()!<>=&|+*/%-]+$/.test(text));return !!Function('return ('+text+')')();
  };
  for(const line of s.split('\n')){
    const match=line.match(/^\s*#(\w+)\s*(.*)$/);
    if(!match){if(active)out.push(line);continue;}
    const [,kind,body]=match;
    if(['if','ifdef','ifndef'].includes(kind)){
      const yes=kind==='if'?evaluate(body):kind==='ifdef'?Object.hasOwn(macros,body.trim()):!Object.hasOwn(macros,body.trim());
      stack.push({parent:active,taken:yes});active=active&&yes;
    }else if(kind==='elif'){const frame=stack.at(-1),yes=!frame.taken&&evaluate(body);frame.taken ||= yes;active=frame.parent&&yes;}
    else if(kind==='else'){const frame=stack.at(-1);active=frame.parent&&!frame.taken;frame.taken=true;}
    else if(kind==='endif'){active=stack.pop().parent;}
    else if(kind==='define'&&active){const [name,value]=body.trim().split(/\s+/);if(/^\w+$/.test(name))macros[name]=/^[\d.]+$/.test(value)?Number(value):1;}
    else if(kind==='undef'&&active)delete macros[body.trim()];
  }
  assert.equal(stack.length,0);return out.join('\n');
}
function expand(s){return s.replace(/#include <(\w+)>/g,(_,key)=>{assert.equal(typeof THREE.ShaderChunk[key],'string',key);return expand(THREE.ShaderChunk[key]);});}
test('S2/S4 shipped shader hooks and expanded GLSL are balanced; added names and uniforms are declared',()=>{
  for(const marker of Object.values(SHADER_ANCHORS))assert(THREE.ShaderLib.standard.fragmentShader.includes(marker));
  checkGLSL(SEA_FAR_GLSL);
  for(const search of ['','?shore4=0','?shore6=0','?sea2debug=1']){
    const v=buildKamakuraSea(terrain(),data(),{search:'?bankwet=0&'+search.slice(1)}),s=shader(v);
    assert(s.fragmentShader.indexOf('float shoreNoise(')<s.fragmentShader.indexOf('float sea2Line('),'GLSL dependencies must be declared before added function bodies');
    assert(s.fragmentShader.indexOf('uniform vec3 uWaterSkyMid,uWaterSkyHorizon;')<s.fragmentShader.indexOf('vec3 sea2Deep('));
    checkGLSL(s.fragmentShader);for(const defines of [{NUM_DIR_LIGHTS:0},{USE_FOG:1,FOG_EXP2:1,NUM_DIR_LIGHTS:1}]){checkGLSL(preprocess(expand(s.fragmentShader),defines));checkGLSL(preprocess(expand(s.vertexShader),defines));}
    for(const name of ['uSea2','uSea2Swell','uSea2Lines','uSea2Debug']){assert(new RegExp(`uniform float [^;]*\\b${name}\\b`).test(s.fragmentShader));assert(name in s.uniforms);}
    const declarations=new Set([...s.fragmentShader.matchAll(/\b(?:float|vec[234]|bool)\s+(sea2\w+)/g)].map(m=>m[1]));
    for(const name of [...s.fragmentShader.matchAll(/\bsea2\w+\b/g)].map(m=>m[0]))assert(declarations.has(name)||['sea2Lines','sea2Brightness'].includes(name),name);
    v.dispose();
  }
  for(const bad of ['float patch;','float x=1.--0.2;','float x=0mix(0.,1.,.5);','void main(){float x=(1.;}'])assert.throws(()=>checkGLSL(bad));
});

test('S2 texture gains distinguish beach/cliff without extra textures; adaptation/debug/disposal remain bounded',()=>{
  for(const quality of ['standard','light']){
    const v=buildKamakuraSea(terrain(),data(),{quality,search:'?sea3=0&debug=1&sea2debug=1&bankwet=0'}),c=new THREE.PerspectiveCamera();c.position.set(0,700,0);c.lookAt(0,0,-1000);c.updateMatrixWorld();v.mesh.onBeforeRender(null,null,c);
    assert.equal(v.textures[0].format,THREE.RGFormat);assert.equal(v.uniforms.uSea2Lines.value,quality==='light'?2:4);
    v.update(.016,c.position,1);assert(globalThis.__kzSea2().swell>0);v.setAdapt(2);assert.equal(v.uniforms.uSea2Lines.value,2);assert.equal(v.uniforms.uSea2Swell.value,.5);
    v.setAdapt(3);assert.equal(v.uniforms.uSea2.value,0);assert.equal(globalThis.__kzSea2().enabled,false);v.setAdapt(0);assert.equal(v.uniforms.uSea2.value,1);
    const resources=[v.mesh.geometry,v.mesh.material,...v.textures],counts=resources.map(()=>0);resources.forEach((r,i)=>r.addEventListener('dispose',()=>counts[i]++));v.dispose();v.dispose();assert(counts.every(n=>n===1));assert.equal(globalThis.__kzSea2,undefined);
  }
  const beach=buildKamakuraSea(terrain(),data(),{search:'?bankwet=0'}),cliff=buildKamakuraSea({...terrain(),heightAt:(_x,z)=>-z*2},data(),{search:'?bankwet=0'});
  const gain=v=>{const a=v.textures[0].image.data;let sum=0,n=0;for(let i=0;i<a.length;i+=2){if(THREE.DataUtils.fromHalfFloat(a[i])>0&&THREE.DataUtils.fromHalfFloat(a[i])<85){sum+=THREE.DataUtils.fromHalfFloat(a[i+1]);n++;}}return sum/n;};
  assert(gain(beach)>gain(cliff)*2);beach.dispose();cliff.dispose();
  const update=source('kamakura-sea-view.js').split('update(dt,pos,audioTime)')[1].split('setAdapt(value)')[0];
  assert(!/=>|\.map\(|\.filter\(|\.slice\(/.test(update)); // no new per-frame closures or arrays.
});

test('S1 far water mirrors the warm horizon towards the sun and a cooler, darker sky away from it', () => {
  assert.deepEqual(seaSkyTint(1), [1, 1, 1]); assert.deepEqual(seaSkyTint(0), [...C.skyCool]); assert.deepEqual(seaSkyTint(-1), [...C.skyCool]);
  const half = seaSkyTint(.5); for (let i = 0; i < 3; i++) assert(half[i] > C.skyCool[i] && half[i] < 1);
  assert(C.skyCool[0] < C.skyCool[1] && C.skyCool[1] < C.skyCool[2], 'cooler means less red than blue');
  assert(SEA_FAR_GLSL.includes('vec3 sea2Sky(vec3 ray)'));
});
