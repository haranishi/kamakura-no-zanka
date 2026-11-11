import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateMeta} from '../dist/valley/kamakura-data.js';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {shoreNoise,createSignedShoreJob} from '../dist/valley/kamakura-shore.js';
import {SEA3 as S,SEA4 as V,SEA_FAR as C,SEA4_GLSL,SEA4_SCALAR_GLSL,sea3Centre,sea4Centre,sea3Texture,sea4Texture,sea4Edge,sea4Glitter,sea4GlitterEnabled,sea3Color,sea4Color,sea4Sample,seaLineCentre} from '../dist/valley/kamakura-sea-far.js';
import {THREE,load} from './helpers/tree-modules.mjs';
const {buildKamakuraSea}=await load('kamakura-sea-view.js');
const terrain=()=>({cell:2,bounds:{minX:-100,maxX:100,minZ:-100,maxZ:100},heightAt:(_x,z)=>-z*.2,isSea:(_x,z)=>z>=0,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>0});
const data=sea=>({rivers:[],meta:{grid:{width:101,height:101,cell_m:2},surface:{},...(sea?{sea}:{})},surface:new Uint8Array(10201)});
const compile=v=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.standard.vertexShader,fragmentShader:THREE.ShaderLib.standard.fragmentShader};v.mesh.material.onBeforeCompile(s);return s;};
const hash=v=>{const s=compile(v);return createHash('sha256').update(s.vertexShader+'\n'+s.fragmentShader).digest('hex');};
const finish=j=>{while(!j.step(4096));return j;};
const smoothstep=(a,b,x)=>{const t=Math.max(0,Math.min(1,(x-a)/(b-a)));return t*t*(3-2*t);};

test('A1 optional independent sea entries use a strict whitelist and finite ranges',()=>{
  for(const sea of [{},{surf_scale:.25},{surf_scale:1.5},{swell_from_deg:0},{surf_scale:.4,swell_from_deg:360}]){const f=fixture();f.meta.sea=sea;assert.equal(validateMeta(f.meta),f.meta);}
  for(const sea of [{surf_scale:.249},{surf_scale:1.501},{surf_scale:'1'},{surf_scale:NaN},{surf_scale:Infinity},{surf_scale:null},{surf_scale:1,unknown:0},{swell_from_deg:null}]){const f=fixture();f.meta.sea=sea;assert.throws(()=>validateMeta(f.meta));}
  const a=finish(createSignedShoreJob(terrain())),b=finish(createSignedShoreJob(terrain(),{sea:{surf_scale:.4}}));
  assert.deepEqual(a.field.data,b.field.data);assert.deepEqual(a.field.openness,b.field.openness);assert.equal(a.work,b.work);assert(!b.field.swellGain);
});
test('A1 physical centres, widths and colour boundaries scale; adjacent centres never cross',()=>{
  for(const scale of [.25,.4,1,1.5])for(let time=0;time<25;time+=.53)for(let x=0;x<80;x+=3.13){
    let previous=-Infinity;
    for(let i=0;i<S.positionsM.length;i++){
      const a=sea4Centre(i,x,3,time,scale,0),jitter=sea4Edge(x,3,0);
      assert(Math.abs(a-jitter-sea3Centre(i,x,3,time)*scale)<1e-12);assert(a>previous);previous=a;
      assert.equal(seaLineCentre(Math.min(i,3),time,scale),seaLineCentre(Math.min(i,3),time)*scale);
    }
  }
  for(const d of [0,4,8,16,28,50,70,150])for(const scale of [.25,.4,1.5])assert.deepEqual(sea4Color(d*scale,[],scale),sea4Color(d));
  const v=buildKamakuraSea(terrain(),data({surf_scale:.4}),{search:'?bankwet=0'}),s=compile(v);
  assert.equal(s.uniforms.uSurfScale.value,.4);
  for(const part of ['physical=width*uSurfScale*sea3WidthScale','moving=(mix(centre,previous,phase)+sea3Shift(p.x,p.y,offset,gap))*uSurfScale','d>110.00000000*uSurfScale','d/=uSurfScale','landDistance/uSurfScale','sea2Distance/uSurfScale','mix(centre,previous,phase)*uSurfScale'])assert(s.fragmentShader.includes(part),part);
  for(let d=60;d<100;d+=.5)assert.equal(sea4Sample(d,0,1,2,0,700,'standard',0,{},1,.4).foam,0);
  v.dispose();
});
test('A1 enlarged surf keeps its beach-gain channel beyond the former offshore bound',()=>{
  const t={...terrain(),bounds:{minX:-100,maxX:100,minZ:-100,maxZ:240}},v=buildKamakuraSea(t,data({surf_scale:1.5}),{search:'?bankwet=0&shelter=0'});
  for(let i=0;i<200&&!v.preparedShore;i++)v.update(.016,{x:0,z:10},2);
  assert(v.preparedShore);const f=t.shoreSigned,col=Math.round((0-f.x0)/f.cell),row=Math.round((116-f.z0)/f.cell),k=row*f.w+col;
  assert(f.data[k]>C.linePositionsM.at(-1)+C.cliffProbeM);assert(THREE.DataUtils.fromHalfFloat(v.textures.at(-1).image.data[k*2+1])>0);v.dispose();
});
test('A2 rotated foam stays bounded, keeps mean within 10%, and converges to its mean',t=>{
  let old=0,now=0,n=0;
  for(let x=0;x<110;x+=.37)for(let z=0;z<90;z+=.41){const a=sea4Texture(x,z,2,0,1);assert(a>=0&&a<=1);old+=sea3Texture(x,z,2,0,1);now+=a;n++;}
  assert(Math.abs(now/old-1)<.1);assert(Math.abs(now/n-V.foamMean**2)<.03);
  for(const detail of [0,1])for(const p of [[0,0],[21,7],[100,-200]])assert.equal(sea4Texture(...p,2,8,detail),V.foamMean**(detail?2:1));
  t.diagnostic(JSON.stringify({foamMeanOld:old/n,foamMeanNew:now/n,ratio:now/old}));
});
test('A2 no dominant square-grid axis: zero and thirty degree autocorrelations agree',t=>{
  const correlations=[];
  for(const angle of [0,Math.PI/6]){
    let aa=0,bb=0,ab=0,a=0,b=0,n=0;
    for(let x=0;x<100;x+=.83)for(let z=0;z<100;z+=.79){const u=sea4Texture(x,z,2,0,1),v=sea4Texture(x+Math.cos(angle)*1.1,z+Math.sin(angle)*1.1,2,0,1);a+=u;b+=v;aa+=u*u;bb+=v*v;ab+=u*v;n++;}
    correlations.push((ab-a*b/n)/Math.sqrt((aa-a*a/n)*(bb-b*b/n)));
  }
  assert(Math.abs(correlations[0]-correlations[1])<.08);t.diagnostic(JSON.stringify({correlations}));
});
test('A3 offshore absorption darkens smoothly; the nearshore is identical',()=>{
  for(const scale of [.4,1]){
    for(const d of [0,3,8,28])assert.deepEqual(sea4Color(d*scale,[],scale),sea3Color(d));
    const old=sea3Color(150),now=sea4Color(150*scale,[],scale);for(let i=0;i<3;i++)assert(Math.abs(now[i]/old[i]-V.deepGain*V.deepTint[i])<1e-12);
    for(let d=28;d<100;d+=.1){const a=sea4Color(d*scale,[],scale),b=sea4Color((d+.1)*scale,[],scale);assert(a.every((v,i)=>Math.abs(v-b[i])<.002));}
  }
});
test('A3 glitter lobe maximum, opposite zero, height, mean filtering and strength bounds',t=>{
  let sum=0,n=0;for(let x=0;x<90;x+=.31)for(let z=0;z<70;z+=.43){
    const peak=sea4Glitter(x,z,2,0,1,360);assert(peak>=0&&peak<=V.glitterStrength);assert.equal(sea4Glitter(x,z,2,0,-1,360),0);assert.equal(sea4Glitter(x,z,2,0,1,40),0);
    assert(sea4Glitter(x,z,2,0,.5,360)<=peak);assert.equal(sea4Glitter(x,z,2,5,1,360),V.glitterMean*V.glitterStrength);sum+=peak/V.glitterStrength;n++;
  }
  assert(Math.abs(sum/n-V.glitterMean)<.015);t.diagnostic(JSON.stringify({resolvedGlitterMean:sum/n,filteredGlitterMean:V.glitterMean}));
});
test('A3/A4 quality, flag, diagnostics, resource cost and release',()=>{
  for(const quality of ['standard','light'])for(const search of ['?debug=1&bankwet=0','?debug=1&bankwet=0&glitter=0']){
    const v=buildKamakuraSea(terrain(),data({surf_scale:.4}),{quality,search}),s=compile(v);
    assert.equal(s.uniforms.uSea4Glitter.value,+sea4GlitterEnabled(search,quality));assert.equal(globalThis.__kzSea3().surfScale,.4);
    v.setAdapt(2);assert.equal(s.uniforms.uSea4Glitter.value,0);assert.equal(globalThis.__kzSea3().glitter,false);v.setAdapt(0);assert.equal(s.uniforms.uSea4Glitter.value,+sea4GlitterEnabled(search,quality));
    assert.equal(v.mesh.geometry.index.count/3,2);assert.equal(v.group.children.filter(o=>o===v.mesh).length,1);assert.equal((s.fragmentShader.match(/texture2D\(uShoreLand,seaUV\)/g)||[]).length,1);
    assert(s.fragmentShader.includes('sea3Foam=sea2Inside?sea3Surf(landDistance,vSeaWorld.xz,uShoreTime,shoreFootprint,seaRange,sea2Shore.g):vec3(0.0);'));assert(s.fragmentShader.includes('if(false){'));assert(s.fragmentShader.includes('reflect(-SUN_DIR_W,vec3(0.0,1.0,0.0))'));
    v.dispose();assert.equal(globalThis.__kzSea3,undefined);
  }
});
test('A1 missing metadata retains HEAD program hashes and exact field bytes',()=>{
  // Frozen from the pre-sea4 HEAD compiler, including shelter and directional variants.
  for(const [sea,expected] of [[undefined,'9b400c5d5b67dee037f9f0e8649ed812bd54c1a8df59b5b3a09de1b42b62048d'],[{swell_from_deg:180},'ff0f630e9cb1d400f0c6914f09377e765731861d08fe894a4f1a7e455a02b756']]){
    const v=buildKamakuraSea(terrain(),data(sea),{search:'?bankwet=0'});assert.equal(hash(v),expected);assert(!compile(v).fragmentShader.includes('sea4Glitter'));v.dispose();
  }
});
test('A2/A3 shared JS/GLSL arithmetic and actual shader delimiters, identifiers, declaration order',()=>{
  for(const [name,fn] of Object.entries({sea4Texture,sea4Edge,sea4Glitter})){
    const m=SEA4_SCALAR_GLSL.match(new RegExp('float '+name+'\\(([^)]*)\\)\\{([\\s\\S]*?)\\}'));
    const mirror=Function('shoreNoise','smoothstep','mix','fract','sin','max','min','abs','clamp','pow',`return function(${m[1].replace(/float /g,'')}){${m[2].replace(/float /g,'let ')}}`)(shoreNoise,smoothstep,(a,b,t)=>a+(b-a)*t,x=>x-Math.floor(x),Math.sin,Math.max,Math.min,Math.abs,(x,a,b)=>Math.max(a,Math.min(b,x)),Math.pow);
    for(let n=0;n<30;n++){const args=m[1].split(',').map((_,i)=>n*.71+i*.36);assert.equal(mirror(...args),fn(...args));}
  }
  for(const flags of ['','&sea3=0','&sea2=0','&shelter=0']){
    const v=buildKamakuraSea(terrain(),data({surf_scale:.4,swell_from_deg:180}),{search:'?bankwet=0'+flags}),s=compile(v).fragmentShader.replace(/\/\/[^\n]*/g,'');v.dispose();const stack=[];
    for(const c of s){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
    for(const statement of s.split(';'))assert.equal((statement.match(/\?/g)||[]).length,(statement.match(/:/g)||[]).length,'unbalanced ternary expression');
    assert(!/--\s*\d|\b(?:float|vec[234])\s+(?:input|output|sample|patch|filter|common|active)\b/.test(s));
    const declared=new Set([...s.matchAll(/\b(?:float|vec[234]|bool)\s+(sea4\w+|uSea4\w+|uSurfScale)/g)].map(m=>m[1]));for(const m of s.matchAll(/\b(?:sea4\w+|uSea4\w+|uSurfScale)\b/g))assert(declared.has(m[0]),m[0]);
    if(!flags.includes('sea3=0')&&!flags.includes('sea2=0')){assert(s.includes(SEA4_GLSL));assert(s.indexOf('float shoreNoise(')<s.indexOf('float sea4Texture('));}
  }
  // Every GLSL noise call must have exactly one vec2 argument, including rotated coordinates.
  for(const m of SEA4_GLSL.matchAll(/shoreNoise\(/g))assert(SEA4_GLSL.slice(m.index).startsWith('shoreNoise(vec2('));
});
