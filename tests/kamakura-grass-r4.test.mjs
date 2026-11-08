import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {grassR4Enabled,grassR4Variation,grassR4Pigment,grassLuminance,grassR4Coast,packGrassR4,packGrassLook} from '../dist/valley/kamakura-grass-look.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {sunBacklight} from '../dist/valley/kamakura-atmosphere.js';
import {fixture} from './helpers/kamakura-fixture.mjs';
import {THREE,load} from './helpers/tree-modules.mjs';
const {buildGrass,buildKamakuraGrass}=Object.assign({},await load('grass-view.js'),await load('kamakura-grass-view.js'));
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
const terrain={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>50};
const environment=()=>({height:1,dry:.4,shade:0,flowers:0,margin:0});
const camera={position:new THREE.Vector3(0,12,0)};
const expanded=s=>s.replace(/#include <(\w+)>/g,(_,k)=>expanded(THREE.ShaderChunk[k]));
function balanced(s){
  const stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of s.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,'')){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
  let depth=0;for(const m of s.matchAll(/^\s*#(if\w*|endif|else|elif)\b/gm)){if(m[1].startsWith('if'))depth++;if(m[1]==='endif')assert(--depth>=0);}assert.equal(depth,0);
  assert(!/\b(?:float|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(s));
}
const shaderFor=m=>{const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);return s;};
const cv=a=>{const m=a.reduce((s,v)=>s+v,0)/a.length;return Math.sqrt(a.reduce((s,v)=>s+(v-m)**2,0)/a.length)/m;};
const hash=a=>createHash('sha256').update(Buffer.from(a.buffer,a.byteOffset,a.byteLength)).digest('hex');
const smoothstep=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
function fixShader(kind='near',quality='standard'){
  const look=createGrassLook(environment,quality,{value:new THREE.Vector4()},true,true,true);
  const view=buildGrass({field:syntheticField(),wind,sunDir:new THREE.Vector3(1,1,0),quality,look});
  try{view.warm(camera);return shaderFor(view.group.children.find(o=>!!o.material.map===(kind==='mid')).material);}
  finally{view.dispose();}
}
function syntheticField(){const nx=64,n=nx*nx;return {seed:1333,x0:-32,z0:-32,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((nx+1)**2)};}

test('R4 world pigment has bounded stock/leaf variation, lower saturation and conserved mean luminance',t=>{
  const bs=[],hs=[],ws=[],tips=[];let meanY=0,newY=0,oldSat=0,newSat=0;const rgb=[.07,.16,.025];
  for(let z=-40;z<40;z++)for(let x=-40;x<40;x++){
    const v=grassR4Variation(x+.1,z+.2),c=grassR4Pigment(rgb,x+.1,z+.2);
    assert(v.brightness>=.82&&v.brightness<=1.18);assert(v.hue>=-.03&&v.hue<=.02);assert(v.tipStart>=.75&&v.tipStart<=.85);
    assert(c.every(n=>n>0));assert(Math.abs(grassLuminance(c)/grassLuminance(rgb)-v.brightness*v.blade)<1e-12);
    assert.deepEqual(v,grassR4Variation(x+.1,z+.2));
    bs.push(v.brightness);hs.push(v.height);ws.push(v.width);tips.push(v.tipStart);
    meanY+=grassLuminance(rgb);newY+=grassLuminance(c);oldSat+=1-Math.min(...rgb)/Math.max(...rgb);newSat+=1-Math.min(...c)/Math.max(...c);
  }
  assert(cv(bs)>.09&&cv(hs)>.15&&cv(ws)>.15);assert(Math.abs(newY/meanY-1)<.02);assert(newSat<oldSat*.94);
  t.diagnostic(JSON.stringify({stockBrightnessCV:cv(bs),heightCV:cv(hs),widthCV:cv(ws),linearLumaRatio:newY/meanY,linearSaturationBefore:oldSat/6400,linearSaturationAfter:newSat/6400,tipFraction:[1-Math.max(...tips),1-Math.min(...tips)]}));
});
test('R4 pack keeps buffer lengths/root positions, world consistency, markers; coast depends on altitude AND sea distance',()=>{
  const raw=new Float32Array(400*15);for(let i=0;i<400;i++)raw.set([i*.17,10,i*.21,0,.3,.03,.3,.5,.2,.3,.1,0,0,1,0],i*15);
  for(const kind of ['near','mid']){
    const old=packGrassLook(raw,kind,environment),next=packGrassR4(old.slice(),kind,environment);
    assert.equal(old.length,next.length);assert.equal(hash(next),hash(packGrassR4(old.slice(),kind,environment)));
    for(let i=0;i<old.length;i+=15){for(const j of [0,1,2,3,7,11,13,14])assert.equal(old[i+j],next[i+j]);}
    if(kind==='mid')for(let i=0;i<old.length;i+=15){assert.equal(Math.sign(next[i+6]),old[i+6]<0?-1:1);assert(Math.abs(next[i+6]-Math.sign(next[i+6])*next[i+4]/old[i+4])<1e-6);}
    const half=old.length/2/15|0,overlap=old.subarray(half*15);
    assert.equal(hash(packGrassR4(overlap.slice(),kind,environment)),hash(next.subarray(half*15)));
    const light=packGrassR4(old.slice(),kind,environment,'light');for(let i=0;i<old.length;i+=15)for(const j of [4,5,6,12])assert.equal(light[i+j],old[i+j]);
  }
  for(const axis of ['height','width','density']){
    assert(grassR4Coast(20,1)[axis]<grassR4Coast(70,1)[axis]);assert(grassR4Coast(40,1)[axis]<grassR4Coast(40,7)[axis]);
  }
});
test('R4 generated shaders compose at all stages, share sun visibility, and add no texture reads/triangles',t=>{
  const totals=[];
  for(const quality of ['standard','light'])for(const r4 of [false,true]){
    const look=createGrassLook(environment,quality,{value:new THREE.Vector4()},true,true,r4);
    const v=buildGrass({field:syntheticField(),wind,sunDir:new THREE.Vector3(1,1,0),quality,look,reach:{near:32,mid:158,midInner:8}});
    try{v.warm(camera);totals.push({quality,r4,triangles:v.stats().triangles});for(const stage of [0,1,2,3]){
      v.setLookQuality(stage);
      for(const m of new Set(v.group.children.map(o=>o.material))){
        const s=shaderFor(m),vs=s.vertexShader,fs=s.fragmentShader;
        for(const code of [vs,fs]){balanced(code);balanced(expanded(code));}
        if(!r4){
          assert(!vs.includes('vGrass4'));
          // Captured from the pre-change R3 hook and shipped renderer, not R4's off branch.
          const expected={standard:{near:'c6b4f34dc62879d8012b1e539d4817eef4b69829e5890a3855c9a9a891bc3b2e',mid:'4d66e57cda64aac60953cf3c7b7932c5aa1c062737390d684be07e1f78146860'},light:{near:'905810a6a6051e8f16ca2cf4fffc6f86f3d41692ab61f789754262fd9fa6daaf',mid:'3a492ad176cb626f49dc11332d7536c4b0654d2cb4c4704595f42c561af6d06d'}};
          assert.equal(createHash('sha256').update(vs).update(fs).digest('hex'),expected[quality][m.map?'mid':'near']);continue;
        }
        assert(vs.includes('vGrass4=vec4('),'varying assigned in main');if(!m.map)assert(vs.includes('vGrassColor=mix('));
        assert.equal(s.uniforms.uGrass4Strength.value,stage>=3?0:stage>=2?.35:1);
        assert.equal((fs.match(/getShadow\( directionalShadowMap/g)||[]).length,1);
        const at=fs.indexOf('// W2c-10 grass GR1/GR4'),end=fs.indexOf('#include <alphatest_fragment>',at);
        // FIX2 GX3 intentionally removes near-only contact/tips from mid cards.
        if(quality==='standard'&&!m.map){
          assert(at>=0);assert(!/texture\w*\(/.test(fs.slice(at,end)));assert(fs.includes('smoothstep(.02,.04,max(0.0,vGrassWorld.y-vGrass4.z))'));
          // Evaluate the exact generated floor and tip expressions, including near-zero albedo.
          const expression=fs.match(/diffuseColor.rgb\+=vec3\((max\(0.0,.012-grass4Floor\))\);/)[1];
          const floor=new Function('grass4Floor','max',`return ${expression}`);
          for(const y of [0,1e-6,.0001,.005,.012,.02,.4])assert(y+floor(y,Math.max)>=.012-1e-12);
          const tip=new Function('vGrass4','vGrassUV','smoothstep','mix',`return ${fs.match(/float grass4Tip=([^;]+);/)[1]}`);
          const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
          for(const y of [0,.5,.74,.9,1])assert(tip({w:.8,x:1},{y},smooth,(a,b,t)=>a*(1-t)+b*t)>=tip({w:.8,x:0},{y},smooth,(a,b,t)=>a*(1-t)+b*t));
        }else assert(at<0,'mid and light omit contact and tip processing');
        const expr=fs.match(/float grass4Transmission=([^;]+);/)[1],transmit=new Function('grass4Back','grassSunVisibility','uGrass4Strength',`return ${expr}`);
        for(const dir of [[-1,0,0],[1,0,0],[0,0,1]])for(const visibility of [0,.25,1]){
          const back=sunBacklight(dir,[1,0,0]);const value=transmit(back,visibility,1);
          if(!visibility||dir[0]>=0||m.map)assert.equal(value,0);else assert(value>0);
        }
        assert(fs.indexOf('grass4Transmission')>fs.indexOf('grassSunVisibility = ( directLight.visible'));
        assert(!fs.includes('totalEmissiveRadiance += min(vec3(.35)'));
        assert(fs.includes('grass4KeepLuma(grass4Direct*grass4Warm'));
      }
    }}finally{v.dispose();}
  }
  for(let i=0;i<totals.length;i+=2)assert.equal(totals[i].triangles,totals[i+1].triangles);
  t.diagnostic(JSON.stringify({syntheticSubmittedTriangles:totals}));
});
test('R4 off matches omitted R4 hook byte-for-byte; URL retains all older opt-outs',()=>{
  assert(grassR4Enabled(''));assert(!grassR4Enabled('?grass4=0'));
  const a=createGrassLook(environment,'standard',{value:new THREE.Vector4()},true,true),b=createGrassLook(environment,'standard',{value:new THREE.Vector4()},true,true,false);
  for(const kind of ['near','mid']){const first={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader},second=structuredClone(first);a.patch(first,kind);b.patch(second,kind);assert.equal(first.vertexShader,second.vertexShader);assert.equal(first.fragmentShader,second.fragmentShader);}
  const data=fixture();data.meta.surface={};data.surface=new Uint8Array(data.meta.grid.width*data.meta.grid.height).fill(2);
  for(const [search,r4] of [['',true],['?grass4=0',false],['?grass3=0',false],['?gband=0',false],['?glook=0',false],['?grass=0',true]]){
    const v=buildKamakuraGrass({data,terrain,search,wind,sunDir:new THREE.Vector3(1,1,0)});
    try{v.warm(camera);assert.equal(v.stats().r4,r4);if(search==='?grass=0')assert.equal(v.group.children.length,0);}finally{v.dispose();}
  }
});

test('FIX1 GX1 generated additive light is bounded, resolved, sunlit and within eight metres',t=>{
  let maximum=0,physicalMaximum=0;
  for(const quality of ['standard','light'])for(const kind of ['near','mid']){
    const fs=fixShader(kind,quality).fragmentShader;
    const expression=name=>fs.match(new RegExp(`float ${name}=([^;]+);`))[1];
    const width=new Function('vGrassUV','fwidth','max',`return ${expression('grass4PixelWidth')}`);
    const coverage=new Function('grass4PixelWidth','smoothstep',`return ${expression('grass4Coverage')}`);
    const near=new Function('vGrassDistance','smoothstep',`return ${expression('grass4Near')}`);
    const add=new Function('grass4Transmission','grass4SunSide','grass4Edge','grass4TipEdge','glint','vGrassUV','grass4Coverage','grass4Near','min','max',`return ${expression('grass4Add')}`);
    const transmit=new Function('grass4Back','grassSunVisibility','uGrass4Strength',`return ${expression('grass4Transmission')}`);
    // FIX2 GX5 shares FIX1's cap across transmission and edge lighting.
    assert(fs.includes('totalEmissiveRadiance+=min(vec3(.12),grass4ThroughColor+vec3(1.0,.625,.1875)*grass4Add);'));
    assert(fs.indexOf('fwidth(vGrassUV.x)')<fs.indexOf('#include <alphatest_fragment>'));
    if(kind==='near'){
      const norm=new Function('lookHalf','inversesqrt','max','dot',`return ${fs.match(/lookHalf\*=([^;]+);/)[1]}`);
      for(const vector of [[0,0,0],[1e-20,0,0],[1,0,0],[0,1,1]]){
        const scale=norm(vector,x=>1/Math.sqrt(x),Math.max,(a,b)=>a.reduce((s,v,i)=>s+v*b[i],0));
        assert(vector.map(v=>v*scale).every(Number.isFinite));
      }
    }
    // Evaluate the emitted formulas, including zero width, grazing angles and aligned sun/view.
    for(const pixels of [0,1e-9,.1,.999,1,1.01,1.5,2,100])for(const d of [0,6,7,8,8.01,100])
      for(const visibility of [0,.25,1])for(const back of [0,.5,1])for(const glint of [0,.5,1,1e6]){
        const projected=width({x:.5},()=>pixels===0?Infinity:1/pixels,Math.max);
        const value=add(transmit(back,visibility,1),1,1,1,glint,{y:1},coverage(projected,smoothstep),near(d,smoothstep),Math.min,Math.max);
        assert(Number.isFinite(value)&&value>=0&&value<=.12);
        if(pixels<=1||d>=8||visibility===0||back===0)assert.equal(value,0);
        maximum=Math.max(maximum,value);
        if(glint<=1)physicalMaximum=Math.max(physicalMaximum,value);
      }
    // FIX2 GX3 keeps mid cards at their baseline lighting.
    if(kind==='near')assert(add(transmit(1,1,1),1,1,1,1,{y:1},1,1,Math.min,Math.max)>0);
    else assert.equal(add(transmit(1,1,1),1,1,1,1,{y:1},1,1,Math.min,Math.max),0);
  }
  t.diagnostic(JSON.stringify({maximumLinearAddition:maximum,physicalMaximum}));
});

test('FIX1 GX2 final soil/blade pigment of 6400 stocks meets saturation and luminance targets',t=>{
  // Green species spanning yellow/blue drift, each initially HSV S=.83.
  // No private terrain colours; these linear reflectances are synthetic inputs.
  const ground=[.09,.16,.0272],raw=new Float32Array(6400*15);
  for(let z=0;z<80;z++)for(let x=0;x<80;x++){
    const rgb=[.025+.04*x/79,.16,.0272];
    // Keep the blue channel the minimum, including the bluest end of the field.
    rgb[0]=Math.max(.0272,rgb[0]);
    raw.set([x+.1,10,z+.2,0,.3,.03,.3,.5,...rgb,0,0,1,0],(z*80+x)*15);
  }
  const packed=packGrassR4(raw.slice(),'near',environment);
  const fs=fixShader().fragmentShader,vs=fixShader().vertexShader;
  const groundWeight=Number(vs.match(/mix\(vGrassColor,grass4Ground,(\.[0-9]+)\)/)[1]);
  const greyWeight=Number(fs.match(/vec3\(grass4FinalY\),(\.[0-9]+)\*uGrass4Strength/)[1]);
  assert.equal(greyWeight,.25);assert(groundWeight>.32);
  assert(fs.indexOf('float grass4FinalY=')>fs.indexOf('float grass4Floor='));
  const sat=c=>1-Math.min(...c)/Math.max(...c);let before=0,after=0,yBefore=0,yAfter=0;
  for(let i=0;i<packed.length;i+=15){
    const c=Array.from(packed.subarray(i+8,i+11)),y=grassLuminance(c);
    const mixed=c.map((v,j)=>v*(1-groundWeight)+ground[j]*y/grassLuminance(ground)*groundWeight);
    const out=mixed.map(v=>v*(1-greyWeight)+grassLuminance(mixed)*greyWeight);
    const original=Array.from(raw.subarray(i+8,i+11));
    before+=sat(original);after+=sat(out);yBefore+=grassLuminance(original);yAfter+=grassLuminance(out);
    assert(Math.abs(grassLuminance(out)-y)<1e-7);
  }
  assert(Math.abs(before/6400-.83)<1e-6);
  assert(after/6400>=.65&&after/6400<=.72,`saturation ${after/6400}`);
  assert(Math.abs(yAfter/yBefore-1)<=.05);
  t.diagnostic(JSON.stringify({stocks:6400,linearHsvBefore:before/6400,linearHsvAfter:after/6400,linearLuminanceRatio:yAfter/yBefore}));
});

test('FIX2 GX3/GX6 mid preserves synthetic yellow-green saturation and luminance, with bounded growth',t=>{
  const ground=[.12,.18,.06],base=ground.map(v=>v*.68),raw=new Float32Array(6400*15);
  for(let i=0;i<6400;i++)raw.set([i%80+.1,10,(i/80|0)+.2,0,.4,.3,i%2?-1:1,.5,...base,0,0,1,0],i*15);
  const vs=fixShader('mid').vertexShader,fs=fixShader('mid').fragmentShader;
  assert(vs.includes('clamp(abs(iShape.z),.80,1.25)'));
  for(const nearOnly of ['grass4Tip=','grass4Root=','grass4Litter=','grass4FinalY='])assert(!fs.includes(nearOnly));
  assert(!vs.includes('grass4Ground='),'mid keeps baseline hue, without a second soil mix');
  const sat=c=>1-Math.min(...c)/Math.max(...c);let minSat=Infinity,minY=Infinity,maxY=0,minGrowth=Infinity,maxGrowth=0;
  for(const sand of [false,true]){
    const result=packGrassR4(raw.slice(),'mid',()=>({sand,sea:0,elevation:0}));
    for(let i=0;i<result.length;i+=15){
      const c=Array.from(result.subarray(i+8,i+11)),y=grassLuminance(c)/grassLuminance(ground),s= sat(c)/sat(ground);
      const growth=Math.abs(result[i+6]);
      assert(growth>=.80-1e-6&&growth<=1.25+1e-6);
      assert(Math.abs(result[i+4]/raw[i+4]-growth)<1e-6);
      assert(y>=.55&&y<=1);assert(s>=.90);
      minSat=Math.min(minSat,s);minY=Math.min(minY,y);maxY=Math.max(maxY,y);minGrowth=Math.min(minGrowth,growth);maxGrowth=Math.max(maxGrowth,growth);
    }
  }
  t.diagnostic(JSON.stringify({midMinSaturationRatio:minSat,midLuminanceRatio:[minY,maxY],midGrowth:[minGrowth,maxGrowth]}));
});

test('FIX2 GX4/GX5 emitted gain and transmission preserve shade, bound addition and light back-facing sunlit leaves',t=>{
  let maximum=0;
  for(const quality of ['standard','light']){
    const fs=fixShader('near',quality).fragmentShader;
    const expression=name=>fs.match(new RegExp(`float ${name}=([^;]+);`))[1];
    const transmit=new Function('grass4Back','grassSunVisibility','uGrass4Strength',`return ${expression('grass4Transmission')}`);
    const through=new Function('grass4Transmission','vGrassUV','grass4Evening','grass4Coverage','mix',`return ${expression('grass4Through')}`);
    const gainExpression=fs.match(/reflectedLight.directDiffuse=mix\([^;]+\)\*(\([^;]+\));/)[1];
    const gain=new Function('uGrass4Strength','grassSunVisibility',`return ${gainExpression}`);
    assert(fs.includes('grass4ThroughColor=diffuseColor.rgb*directionalLights[0].color*grass4Warm*grass4Through;'));
    assert(fs.includes('#if NUM_DIR_LIGHTS > 0\n      grass4ThroughColor='));
    assert(fs.includes('min(vec3(.12),grass4ThroughColor+'));
    for(const visibility of [0,.25,1])for(const back of [0,.5,1])for(const strength of [0,.35,1])
      for(const tip of [0,.5,1])for(const coverage of [0,.5,1])for(const evening of [0,1]){
        const g=gain(strength,visibility);assert(g>=1&&g<=1.12);if(!visibility)assert.equal(g,1);
        const value=through(transmit(back,visibility,strength),{y:tip},evening,coverage,(a,b,t)=>a*(1-t)+b*t);
        // Evaluate the emitted product and the shared component-wise cap at extreme solar intensities.
        for(const sun of [0,1,20])for(const pigment of [0,.16,1]){
          const added=Math.min(.12,pigment*sun*1.65*value+.016*transmit(back,visibility,strength)*coverage);
          assert(Number.isFinite(added)&&added>=0&&added<=.12);
          if(!visibility||!back||!strength||!coverage)assert.equal(added,0);
          maximum=Math.max(maximum,added);
        }
      }
    // Direct diffuse is deliberately zero: transmission depends on pigment and solar colour instead.
    const resolved=through(transmit(1,1,1),{y:1},1,1,(a,b,t)=>a*(1-t)+b*t);
    assert.equal(resolved,quality==='light'?.14:.28);
    assert(.16*resolved>0);
  }
  t.diagnostic(JSON.stringify({maximumCombinedLinearAddition:maximum,directAlbedoGain:1.12,standardTransmission:.28,lightTransmission:.14}));
});
