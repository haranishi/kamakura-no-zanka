// W2c-9c2: synthetic geometry/color comparisons and expanded GLSL structural safety.
import test from 'node:test';
import assert from 'node:assert/strict';
import {midTile} from '../dist/valley/grass-field.js';
import {grassEcology,grassGroundTint,MID_GRASS} from '../dist/valley/kamakura-grass-look.js';
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {createGrassCell,createGrassWindows} from '../dist/valley/kamakura-grass-field.js';
import {load,THREE} from './helpers/tree-modules.mjs';
const {buildGrass}=await load('grass-view.js');
globalThis.document={createElement(){const c={width:0,height:0,getContext:()=>({createLinearGradient:()=>({addColorStop(){}}),beginPath(){},moveTo(){},quadraticCurveTo(){},fill(){},getImageData:()=>({data:new Uint8ClampedArray(c.width*c.height*4)})})};return c;}};
const wind={uTime:{value:0},uWind:{value:1},uWindDir:{value:new THREE.Vector2(1,0)},uGuideMix:{value:0}};
const flat={heightAt:()=>10,slopeAt:()=>0,waterAt:()=>0,walkable:()=>true,riverDistanceAt:()=>Infinity};
function field(slope=0){const nx=256,n=nx*nx,f={seed:1333,x0:-128,z0:-128,nx,nz:nx,placeable:new Uint8Array(n).fill(1),density:new Uint8Array(n).fill(128),height:new Uint8Array(n).fill(128),species:new Uint8Array(n),midPatch:new Float32Array(n).fill(1),heights:new Float32Array((nx+1)**2)};for(let j=0;j<=nx;j++)for(let i=0;i<=nx;i++)f.heights[j*(nx+1)+i]=10+(i-128)*slope;return f;}
function balanced(source){
  const s=source.replace(/\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,''),stack=[],branches=[];
  for(const line of s.split('\n')){
    if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(line))branches.push(line);
    if(/^\s*#\s*(else|elif)\b/.test(line))assert(branches.length,'orphan else/elif');
    if(/^\s*#\s*endif\b/.test(line))assert(branches.pop(),'orphan endif');
    for(const c of line){if('({['.includes(c))stack.push(c);else if(')}]'.includes(c))assert.equal(stack.pop(),{')':'(','}':'{',']':'['}[c]);}
  }assert.equal(stack.length,0);assert.equal(branches.length,0);
}
function expanded(s,chain=[]){return s.replace(/#include <([\w]+)>/g,(_,k)=>{assert(!chain.includes(k));assert(THREE.ShaderChunk[k]!==undefined,k);return expanded(THREE.ShaderChunk[k],[...chain,k]);});}
test('GLSL braces, parentheses, brackets and conditional directives balance after every hook and include',()=>{
  for(const quality of ['standard','light'])for(const improved of [false,true]){
    const look=improved?createGrassLook((x,z)=>grassEcology(x,z),quality,{value:new THREE.Vector4()}):undefined;
    const v=buildGrass({field:field(),wind,sunDir:new THREE.Vector3(1,1,0),quality,look});v.warm({position:new THREE.Vector3(0,12,0)});
    for(const m of new Set(v.group.children.map(o=>o.material))){const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);for(const code of [s.vertexShader,s.fragmentShader]){balanced(code);balanced(expanded(code));}if(improved&&m.alphaTest){assert(s.fragmentShader.includes('.4*smoothstep')||s.fragmentShader.includes('0.40*smoothstep'));assert(s.vertexShader.includes('smoothstep(.04,.16,cardFace)'));}}
    v.dispose();
  }
  for(const bad of ['void main(){foo(;}','#endif','#ifdef X\nvoid main(){}'])assert.throws(()=>balanced(bad));
});
test('shaded target has bounded blend and a dusk floor; refuge density rises, roads recede',()=>{
  assert(MID_GRASS.blend>=.35&&MID_GRASS.blend<=.45);assert(MID_GRASS.groundScale>=.65&&MID_GRASS.groundScale<=.75);
  assert.deepEqual(grassGroundTint([.2,.3,.4]),[.2*.68,.3*.68,.4*.68]);assert(grassGroundTint([0,.001,.02]).every(v=>v>=.035));
  for(const axis of ['house','river']){let last=Infinity;for(const d of [0,2,5,9,15,30]){const e=grassEcology(17,31,{[axis]:d});assert(e.midDensity<=last);last=e.midDensity;}}
  for(const axis of ['shade','slopeBreak'])assert(grassEcology(17,31,{[axis]:1}).midDensity>grassEcology(17,31).midDensity);
  let last=0;for(const path of [2.5,3,4,5,10]){const e=grassEcology(17,31,{path});assert(e.midDensity>=last);last=e.midDensity;}
  const cell=createGrassCell(flat,{surfaceCodeAt:()=>2,environmentAt:(x,z)=>grassEcology(x,z)}),w=createGrassWindows(cell,{size:352});
  w.plan({x:0,z:0});w.work(()=>0);w.commit();w.plan({x:32,z:0});w.work(()=>0);const a=w.commit();
  const cold=createGrassWindows(cell,{size:352});cold.plan({x:32,z:0});cold.work(()=>0);const b=cold.commit();assert.deepEqual(a.midPatch,b.midPatch);
});
test('mid roots interpolate four corners and sink 12cm; >36 degree and steep hidden corners are rejected',()=>{
  for(const degrees of [0,20,35,37,50]){const f=field(Math.tan(degrees*Math.PI/180)),d=midTile(f,0,0,{...{sink:MID_GRASS.sink,maxSlope:MID_GRASS.maxSlope}});if(degrees>36)assert.equal(d.count,0);else {assert(d.count>0);for(let i=0;i<d.count;i++)assert(Math.abs(d.y[i]-(10+d.x[i]*Math.tan(degrees*Math.PI/180)-.12))<2e-5);}}
  assert.equal(createGrassCell({...flat,slopeAt:()=>37},{surfaceCodeAt:()=>2})(0,0).placeable,0);
  const f=field();f.heights[128*257+128]=20;assert(midTile(f,0,0,{size:1,maxSlope:36}).count===0);
});
const lab=c=>{const a=[(c[0]*.4124564+c[1]*.3575761+c[2]*.1804375)/.95047,c[0]*.2126729+c[1]*.7151522+c[2]*.072175,(c[0]*.0193339+c[1]*.119192+c[2]*.9503041)/1.08883].map(v=>v>.008856?Math.cbrt(v):7.787*v+16/116);return [116*a[1]-16,500*(a[0]-a[1]),200*(a[1]-a[2])];};
const delta=(a,b)=>Math.hypot(...lab(a).map((v,i)=>v-lab(b)[i]));
test('pre-9b 25m vs current 120m: same synthetic sites retain more 12–60m tufts and ground DeltaE',t=>{
  const ground=[.25,.32,.13],rows=[];
  for(const x of [0,24])for(const improved of [false,true]){
    const f=field();if(improved)for(let j=0;j<f.nz;j++)for(let i=0;i<f.nx;i++)f.midPatch[j*f.nx+i]*=grassEcology(f.x0+i+.5,f.z0+j+.5).midDensity;
    const look=improved?createGrassLook((x,z)=>grassEcology(x,z),'standard',{value:new THREE.Vector4()}):undefined;
    const v=buildGrass({field:f,wind,sunDir:new THREE.Vector3(1,1,0),look,...(improved?{reach:{near:10,mid:120}}:{})});v.warm({position:new THREE.Vector3(x,12,0)});
    let count=0,height=0,width=0,contrast=0,tail=0;
    for(const o of v.group.children.filter(o=>o.name==='grass-mid')){const a=o.geometry.attributes.iRoot.data.array;for(let i=0;i<o.geometry.instanceCount;i++){const k=i*15,d=Math.hypot(a[k]-x,a[k+2]),w=a[k+7],r=improved?120:25;if(d<12||d>=r)continue;if(!improved){const q=Math.max(0,Math.min(1,(d-.45*r)/(.55*r))),fade=q*q*(3-2*q);if(w<fade)continue;}if(d>60){const t=Math.max(0,Math.min(1,(d-60)/35));if(!improved||(w*17.31)%1<1-.88*t*t*(3-2*t))tail++;continue;}count++;height+=a[k+4];width+=a[k+5];const blendT=Math.max(0,Math.min(1,(d-9)/16)),mix=(improved?.4:.6)*blendT*blendT*(3-2*blendT),target=improved?grassGroundTint(ground):new THREE.Color('#6b6a35').toArray();contrast+=delta(ground,target.map((c,j)=>a[k+8+j]*.62*(1-mix)+c*mix));}}
    rows.push({site:x===0?'A':'B',mode:improved?'9c2':'pre9b',count,height:height/count,width:width/count,deltaE:contrast/count,tail});v.dispose();
  }
  t.diagnostic(JSON.stringify(rows));
  for(let i=0;i<rows.length;i+=2){assert(rows[i+1].count>=rows[i].count);assert(rows[i+1].deltaE>=rows[i].deltaE);assert(rows[i+1].tail>0);}
});
