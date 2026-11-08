import test from 'node:test';
import assert from 'node:assert/strict';
import { THREE, load, source } from './helpers/tree-modules.mjs';
import { prepareRivers } from '../dist/valley/kamakura-rivers.js';
import { shore6Enabled, edgeOffset6, edgeWidth6, edgeAlpha6, bankWidth6, bankDark6, riverDepth6, seaDepth6, riverHeight6, FLOW_LAYERS6, seaGlint6, SHORE_R6_GLSL } from '../dist/valley/kamakura-shore-r6.js';
import { shoreNoise } from '../dist/valley/kamakura-shore.js';
const river={id:'synthetic',xy_m:[[0,0],[16,0],[32,8]],width_m:[5,5,5],water_elev_m:[1,1,1],bed_m:[.5,.5,.5]};
const terrain={bounds:{minX:-32,maxX:64,minZ:-32,maxZ:32},heightAt:(x,z)=>Math.abs(z)*.15-.1,waterAt:()=>.2,isSea:(x,z)=>z>16,riverDistanceAt:()=>Infinity,seaDistanceAt:()=>0};
const compile=m=>{const s={uniforms:{},...THREE.ShaderLib[m.isMeshBasicMaterial?'basic':'standard']};m.onBeforeCompile(s);return s;};
function balanced(s){
  const clean=s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[],pairs={')':'(',']':'[','}':'{'};
  for(const c of clean)if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),pairs[c]);assert.equal(stack.length,0);
  let n=0;for(const line of clean.split('\n')){if(/^\s*#\s*(if|ifdef|ifndef)\b/.test(line))n++;else if(/^\s*#\s*endif\b/.test(line))assert(n-->0);}assert.equal(n,0);
  assert(!/\b(?:float|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(clean));
}
const smoothstep=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
function scalar(name,args){return Function(...args,'smoothstep','max','min','clamp','abs',SHORE_R6_GLSL.match(new RegExp(`float ${name}\\([^)]*\\)\\{([^}]+)\\}`))[1]);}
const invoke=(fn,p)=>fn(...p,smoothstep,Math.max,Math.min,(v,a,b)=>Math.max(a,Math.min(b,v)),Math.abs);
test('SH1 metre edge displacement, feather, bank width and darkening; shader scalar parity',t=>{
  const offsets=[];
  for(let x=-100;x<100;x+=.7)for(let z=-40;z<40;z+=1.3){
    const j=edgeOffset6(x,z),w=edgeWidth6(x,z);offsets.push(j);
    assert(Math.abs(j)<=.3);assert(w>=.15&&w<=.4);
    assert.equal(edgeAlpha6(-.31,x,z),0);assert.equal(edgeAlpha6(.71,x,z),1);
  }
  const mean=offsets.reduce((a,b)=>a+b)/offsets.length,sd=Math.sqrt(offsets.reduce((a,b)=>a+(b-mean)**2,0)/offsets.length);assert(sd>.1&&sd<.16);
  const gpuW=scalar('bankWidth6',['slope','speed','n']),gpuD=scalar('bankDark6',['n']);
  for(const slope of [0,.2,.5,1])for(const speed of [0,.12,.7])for(const n of [0,.5,1]){
    const width=bankWidth6(slope,speed,n);assert(width>=.4&&width<=1);assert.equal(invoke(gpuW,[slope,speed,n]),width);
    assert(bankWidth6(0,speed,n)>=bankWidth6(1,speed,n));
    assert(bankDark6(n)>=.65&&bankDark6(n)<=.75);assert.equal(invoke(gpuD,[n]),bankDark6(n));
  }
  for(const [name,fn,args] of [['riverDepth6',riverDepth6,['depth','bank']],['seaDepth6',seaDepth6,['d']]]){
    const gpu=scalar(name,args);let last=-1;for(let i=0;i<=100;i++){const p=name==='riverDepth6'?[i/50,i/10]:[i];const v=fn(...p);assert(v>=last);assert.equal(invoke(gpu,p),v);last=v;}
  }
  t.diagnostic(JSON.stringify({edgeOffsetSD:sd,edgeRange:[Math.min(...offsets),Math.max(...offsets)]}));
});
test('SH2 two oblique layers, independent speed and spacing; no repeated peaks outside the central lobe',t=>{
  const [a,b]=FLOW_LAYERS6;assert.equal(a.angle,20);assert.equal(b.angle,-20);assert(b.spacing/a.spacing>=1.6&&b.spacing/a.spacing<=2.4);assert(b.speed/a.speed>=.6&&b.speed/a.speed<=.8);
  // Continuous noise necessarily tends to correlation 1 at zero lag. Test all nonzero
  // 2m sampling-lattice lags (outside the sub-metre central lobe), in both axes.
  const points=[];for(let x=-80;x<80;x+=1.17)for(let y=-40;y<40;y+=1.93)points.push([x,y,riverHeight6(x,y,3,.3,x,y)]);
  const mean=points.reduce((s,p)=>s+p[2],0)/points.length;let maximum=-1;
  for(let dx=-12;dx<=12;dx+=2)for(let dy=-12;dy<=12;dy+=2){if(!dx&&!dy)continue;let ab=0,aa=0,bb=0;
    for(const [x,y,v] of points){const a=v-mean,b=riverHeight6(x+dx,y+dy,3,.3,x+dx,y+dy)-mean;ab+=a*b;aa+=a*a;bb+=b*b;}
    maximum=Math.max(maximum,ab/Math.sqrt(aa*bb));
  }
  assert(maximum<.5);t.diagnostic(JSON.stringify({maxNonzeroCorrelation2m:maximum}));
  // Evaluate vector arithmetic of the actual GLSL helper as scalar JS.
  assert(SHORE_R6_GLSL.includes('time*speed*.72'));assert(SHORE_R6_GLSL.includes('/vec2(1.3,3.9)'));
  for(const p of [[.1,2,1,.3,8,11],[7,9,3,-.12,-1,5]]){
    const [x,y,time,speed,wx,wz]=p,g=[.35+.65*shoreNoise(wx/16,wz/16),.65*(.35+.65*shoreNoise(wx/16+11,wz/16+11))];
    const ya=y-time*speed,yb=y-time*speed*.72;
    const h=g[0]*(shoreNoise((x*.93969262+ya*.34202014)/.65,(ya*.93969262-x*.34202014)/1.95)-.5)+g[1]*(shoreNoise((x*.93969262-yb*.34202014)/1.3,(yb*.93969262+x*.34202014)/3.9)-.5);
    assert(Math.abs(h-riverHeight6(...p))<1e-7);
  }
});
test('SH3 mirror-direction response is zero opposite sun, bounded and stronger at low sun',()=>{
  const norm=p=>{const l=Math.hypot(...p);return p.map(v=>v/l);};
  const n=[0,1,0];
  for(const height of [.1,.3,.7]){const sun=norm([.6,height,.8]),v=[-sun[0],sun[1],-sun[2]];
    const forward=seaGlint6(v,n,sun);assert(forward>0&&forward<=.65);assert.equal(seaGlint6([sun[0],sun[1],sun[2]],n,sun),0);
  }
  // Execute the scalar/vector arithmetic from the actual shader, translating only GLSL syntax.
  const body=SHORE_R6_GLSL.match(/float seaGlint6\([^)]*\)\{([^}]+)\}/)[1]
    .replace('vec3 r=reflect(-v,n);','const r=n.map((x,i)=>2*v.reduce((s,y,j)=>s+y*n[j],0)*x-v[i]);')
    .replace(/float /g,'let ').replace('dot(-v.xz,sun.xz)','(-v[0]*sun[0]-v[2]*sun[2])')
    .replace('length(v.xz)','Math.hypot(v[0],v[2])').replace('length(sun.xz)','Math.hypot(sun[0],sun[2])')
    .replace('dot(r,sun)','r.reduce((s,x,i)=>s+x*sun[i],0)').replaceAll('sun.y','sun[1]').replaceAll('v.y','v[1]');
  const gpu=Function('v','n','sun','max','min','pow','abs','smoothstep',body);
  for(let i=1;i<=60;i++){const v=norm([Math.sin(i),.1,Math.cos(i)]),sun=norm([.2,.15,.8]);assert.equal(gpu(v,n,sun,Math.max,Math.min,Math.pow,Math.abs,smoothstep),seaGlint6(v,n,sun));}
  const low=norm([0,.1,1]),high=norm([0,.7,1]);assert(seaGlint6([0,low[1],-low[2]],n,low)>seaGlint6([0,high[1],-high[2]],n,high));
});
test('SH1–SH3 shipped Three construction, legacy switch, adaptation, geometry invariance and disposal',async()=>{
  const {buildKamakuraWater}=await load('kamakura-water-view.js'),{buildKamakuraSea}=await load('kamakura-sea-view.js');balanced(SHORE_R6_GLSL);
  assert(shore6Enabled(''));assert(!shore6Enabled('?shore6=0'));assert(!shore6Enabled('?shore4=0'));
  for(const quality of ['standard','light'])for(const search of ['','?shore6=0','?shore4=0']){
    const prepared=prepareRivers({rivers:[river]}),before=prepared.chunks.map(c=>Array.from(c.positions));
    const water=buildKamakuraWater(prepared,{terrain,quality,search});
    const data={rivers:{rivers:[river]},meta:{grid:{width:17,height:17,cell_m:4},surface:{}},surface:new Uint8Array(289)};
    const sea=buildKamakuraSea({...terrain},data,{quality,search});
    for(const step of [0,2,3,0]){
      water.setAdapt(step);sea.setAdapt(step);
      const expected=search||step===3?0:quality==='light'||step>=2?.5:1;
      assert.equal(water.uniforms.uShore6.value,expected);assert.equal(sea.uniforms.uShore6.value,expected);
      for(const m of [water.material,sea.mesh.material,sea.bank.material]){const s=compile(m);balanced(s.vertexShader);balanced(s.fragmentShader);}
    }
    for(let c=0;c<prepared.chunks.length;c++)for(let i=0;i<before[c].length;i++){
      assert.equal(prepared.chunks[c].positions[i],before[c][i]);assert.equal(water.group.children[c].geometry.attributes.position.array[i],Math.fround(before[c][i]));
    }
    const seaShader=compile(sea.mesh.material).fragmentShader;
    assert(seaShader.indexOf('seaGlint6(eye6')>seaShader.indexOf('outgoingLight=mix(outgoingLight,uWaterSkyHorizon,horizon4)'));
    if(!search){assert.equal(sea.bank.material.blendSrc,THREE.DstColorFactor);assert.equal(sea.bank.material.blendDst,THREE.OneMinusSrcAlphaFactor);assert(sea.bank.material.premultipliedAlpha);const film=compile(sea.bank.material).fragmentShader;assert(film.indexOf('gl_FragColor.rgb=outgoingLight;')>film.indexOf('#include <colorspace_fragment>'));assert(film.indexOf('gl_FragColor.rgb=outgoingLight;')<film.indexOf('#include <premultiplied_alpha_fragment>'));}
    const counts=new Map();for(const resource of [water.material,...water.group.children.map(m=>m.geometry),sea.mesh.geometry,sea.mesh.material,...sea.textures,sea.bank.material]){counts.set(resource,0);resource.addEventListener('dispose',()=>counts.set(resource,counts.get(resource)+1));}
    water.dispose();sea.dispose();water.dispose();sea.dispose();for(const count of counts.values())assert.equal(count,1);
  }
  // New derivatives occur before effect branches and before discard; none in helpers.
  assert(!/\b(?:dFdx|dFdy|fwidth)\(/.test(SHORE_R6_GLSL));
  const waterSource=source('kamakura-water-view.js');assert(waterSource.indexOf('float riverPixel6=')<waterSource.indexOf('if (waterDistance >='));
  assert(waterSource.includes('float flowPixel6=max(length(fwidth('));
  assert(waterSource.indexOf('bedDx6=dFdx')<waterSource.indexOf('if (waterDistance >='));assert(waterSource.includes('bedGain6=.35*uPhotoBlend'));assert(waterSource.includes('kzPhotoHexGrad(uRiverPebbles6'));
});
