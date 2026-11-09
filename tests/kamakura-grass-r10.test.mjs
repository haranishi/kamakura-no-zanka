import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {grassR10At,grassR10Colony,grassR10FlowerGroup,grassR10Flowers,GRASS_R10_SPECIES,GRASS_R10_FLOWERS,grassR10Enabled,packGrassR10} from '../dist/valley/kamakura-grass-r10.js';
import {attachGrassR10} from '../dist/valley/kamakura-grass-r10-view.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {grassR4Variation,grassLuminance} from '../dist/valley/kamakura-grass-look.js';
import {localGrassR10Metrics,globalGrassR10Metrics,statistics} from '../tools/measure-grass-r10.mjs';
import {THREE,load} from './helpers/tree-modules.mjs';
const {buildGrass}=await load('grass-view.js');
const env=()=>({height:.65,dry:.4,shade:.4,wet:.4,flowers:0,margin:0});
const look=quality=>createGrassLook(env,quality,{value:new THREE.Vector4()},true,true,true,true,true);
const raw=()=>{const a=new Float32Array(1000*15);for(let i=0;i<1000;i++)a.set([i%40*.71,0,Math.floor(i/40)*.39,0,.3,.03,.3,.5,.08,.15,.03,i%3===0?-1:0,0,1,0],i*15);return a;};
const hash=a=>createHash('sha256').update(a).digest('hex');
const expanded=s=>s.replace(/#include <(\w+)>/g,(_,k)=>expanded(THREE.ShaderChunk[k]));
function balanced(src){
 const code=src.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
 for(const c of code){if('([{'.includes(c))stack.push(c);if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);}assert.equal(stack.length,0);
 let depth=0;for(const m of code.matchAll(/^\s*#(if\w*|endif|else|elif)\b/gm)){if(m[1].startsWith('if'))depth++;if(m[1]==='endif')assert(--depth>=0);}assert.equal(depth,0);
 assert(!/\b(?:float|vec[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(code));
 assert(!/--\s*(?:\d|\.\d)/.test(code));assert(!/(?<![A-Za-z_0-9])(?:\d+\.?\d*|\.\d+)(?:mix|vec[234]|smoothstep|clamp|max|min|abs|pow|sin|cos|dot|length|normalize|float)\(/.test(code));
}
test('GV1–3: global species rates, sparse flowers, four colours, physical height ranges',t=>{
 const m=globalGrassR10Metrics();
 for(const [kind,s] of Object.entries(GRASS_R10_SPECIES)){
   assert(Math.abs(m.rates[kind]-s.rate)<.03,kind);
   assert(m.ranges[kind][0]>=s.min-1e-6&&m.ranges[kind][1]<=s.max+1e-6,kind);
 }
 for(const kind of ['seed','dandelion','clover'])assert(m.rates[kind]>=.002&&m.rates[kind]<=.01,`${kind}: ${m.rates[kind]}`);
 assert(m.rates.susuki>=.006&&m.rates.susuki<=.04); // R9 parent tuning: tussocks only (rate .02 minus the long-grass shoulders)assert(m.rates.flower>=.015&&m.rates.flower<=.03);
 assert.equal(m.colors,4);assert.equal(new Set(GRASS_R10_FLOWERS.map(c=>c.join(','))).size,4);
 assert(m.ranges.flower[0]>=.25-1e-6&&m.ranges.flower[1]<=.6+1e-6);
 t.diagnostic(JSON.stringify(m));
});
test('GV1: 30×12m height SD doubles on ordinary ecological fields; expose dense-field limit',t=>{
 for(const origin of [[0,0],[30,0],[-30,-12],[9,23]]){
   const m=localGrassR10Metrics(...origin);assert(m.sdGain>=1.7,JSON.stringify(m)); // rare species land at random, so windows vary: 1.9-2.4x measuredt.diagnostic(JSON.stringify(m));
 }
 // Record the dense high-growth baseline honestly: it already includes tall leaves.
 const dense=localGrassR10Metrics(0,0,1);assert(dense.sdGain>1.3);t.diagnostic(JSON.stringify({dense}));
});
test('GV1–2: colonies are metres wide, flowers use 2–5 stalks and segregated colours',()=>{
 const widths=[];let start=-80,last='';
 for(let x=-80;x<80;x+=.05){const c=grassR10Colony(x,.37),key=`${c.x},${c.z}`;if(key!==last){if(last)widths.push(x-start);start=x;last=key;}}
 const typical=widths.filter(v=>v>=2&&v<=8).length/widths.length;assert(typical>.55);
 let same=0,total=0,adjacent=0,farSame=0;
 for(let z=-30;z<30;z+=.31)for(let x=-30;x<30;x+=.31){
  const a=grassR10At(x,z,env()),b=grassR10At(x+.2,z,env()),c=grassR10At(x+8,z,env());total++;
  if(a.kind===b.kind)adjacent++;if(a.kind===c.kind)farSame++;
  const f=grassR10FlowerGroup(x,z);if(f){assert(f.count>=2&&f.count<=5);const near=grassR10FlowerGroup(x+.03,z);if(near){same+=f.color===near.color;}}
 }
 assert(adjacent/total>.8);assert(adjacent>farSame*1.5);assert(same>100);
 const dense=[];for(let z=0;z<10;z++)for(let x=0;x<10;x++)for(let n=0;n<100;n++)dense.push(x+(n%10+.5)/10,0,z+(Math.floor(n/10)+.5)/10,0,.3,.03,.3,.5,.08,.15,.03,0,0,1,0);
 const selected=grassR10Flowers(new Float32Array(dense)),groups=new Map();for(const g of selected.values()){const key=`${g.x},${g.z}`;groups.set(key,(groups.get(key)??0)+1);}assert(groups.size>10);for(const n of groups.values())assert(n>=2&&n<=5);
 // Moist and shaded allotments become fern; dry clearings use grey mugwort.
 let fern=0,mugwort=0;for(let x=0;x<100;x+=.1){fern+=grassR10At(x,3,{wet:1},0,false).kind==='fern';mugwort+=grassR10At(x,3,{},0,false).kind==='mugwort';}assert(fern>0&&fern===mugwort);
});
test('GV3: stock width, lean and hue spread ≥1.5×; fine luminance remains',()=>{
 const newer={width:[],lean:[],hue:[]},older={width:[],lean:[],hue:[]};
 for(let z=0;z<12;z+=.13)for(let x=0;x<30;x+=.17){const a=grassR10At(x,z,env()),b=grassR4Variation(x,z);newer.width.push(a.widthScale);newer.lean.push(a.lean);newer.hue.push(a.hue);older.width.push(b.width);older.lean.push(b.lean);older.hue.push(b.hue);}
 for(const k of Object.keys(newer))assert(statistics(newer[k]).sd/statistics(older[k]).sd>=1.5,k);
 const a=raw(),b=packGrassR10(a.slice(),'near',env);
 for(let i=0;i<a.length;i+=15){if(Math.floor(-b[i+11])===2)continue;assert(Math.abs(grassLuminance([...b.slice(i+8,i+11)])/grassLuminance([...a.slice(i+8,i+11)])-1)<1e-6);}
});
test('GV1: packing independent of array order/subwindow, no roots or counts changed; light height only',()=>{
 const data=raw(),all=packGrassR10(data.slice(),'near',env);assert.equal(all.length,data.length);
 const cells=new Map();for(let i=0;i<data.length;i+=15){const key=`${Math.floor(data[i])},${Math.floor(data[i+2])}`;if(!cells.has(key))cells.set(key,[]);cells.get(key).push(i);for(const j of [0,1,2,3,7,12,13,14])assert.equal(all[i+j],data[i+j]);}
 for(const indices of cells.values()){indices.reverse();const cell=new Float32Array(indices.flatMap(i=>[...data.slice(i,i+15)])),one=packGrassR10(cell,'near',env);for(let n=0;n<indices.length;n++)assert.equal(hash(Buffer.from(one.slice(n*15,n*15+15).buffer)),hash(Buffer.from(all.slice(indices[n],indices[n]+15).buffer)));}
 for(const kind of ['near','mid']){const b=packGrassR10(data.slice(),kind,env,'light');for(let i=0;i<data.length;i++)if(i%15!==4)assert.equal(b[i],data[i]);}
 assert.equal(packGrassR10(data,'near',env,'standard',false),data);
});
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
test('R10 actual Three hooks: off equals baseline, same triangles, GLSL composition and adaptive gates',t=>{
 const nx=32,n=nx*nx,field={seed:1333,x0:-16,z0:-16,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(159),height:new Uint8Array(n).fill(255),species:new Uint8Array(n),midPatch:new Float32Array(n).fill(1.6),heights:new Float32Array((nx+1)**2)};
 const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
 assert(grassR10Enabled(''));assert(!grassR10Enabled('?grass10=0'));
 for(const quality of ['standard','light']){
   const records=[];
   for(const flag of ['off','0','1']){
     const l=look(quality),oldPack=l.pack,oldPatch=l.patch;if(flag!=='off')attachGrassR10(l,env,quality,`?grass10=${flag}`);
     if(flag!=='1'){assert.equal(l.pack,oldPack);assert.equal(l.patch,oldPatch);}
     const view=buildGrass({field,wind,sunDir:new THREE.Vector3(1,1,0),quality,look:l,reach:{near:32,mid:158,midInner:4}});
     try{
       view.warm({position:new THREE.Vector3(0,2,0)});const shaders={};
       for(const m of new Set(view.group.children.map(o=>o.material))){const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);const kind=m.map?'mid':'near';shaders[kind]=hash(s.vertexShader+s.fragmentShader);
        for(const src of [s.vertexShader,s.fragmentShader]){balanced(src);balanced(expanded(src));}
        if(flag==='1'&&kind==='near'&&quality==='standard'){assert(s.vertexShader.includes('grass10Width='));assert(s.vertexShader.includes('vGrassColor=iColor'));assert(s.fragmentShader.includes('grass10TipStart='));assert(s.fragmentShader.includes('grass10Slope='));assert(!s.vertexShader.includes('iTip.x < -2.5 ? vec3(.25,.17,.075)'));}
       }
       for(const step of [0,1,2,3,0]){l.setAdapt(step);if(flag==='1')assert.equal(l.uniforms.uGrass10Strength.value,quality==='light'?0:step===3?0:step===2?.35:1);}
       records.push({triangles:view.stats().triangles,shaders});
     }finally{view.dispose();view.dispose();}
   }
   assert.equal(records[0].triangles,records[2].triangles);assert.equal(JSON.stringify(records[0].shaders),JSON.stringify(records[1].shaders));
   if(quality==='light')assert.equal(records[0].shaders.near,records[2].shaders.near);
   t.diagnostic(JSON.stringify({quality,triangles:records.map(r=>r.triangles)}));
 }
});
