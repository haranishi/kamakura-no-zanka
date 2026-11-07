import test from 'node:test';
import assert from 'node:assert/strict';
import { groundAxes,yardMacro,yardDensity,yardWander,yardTrack,yardEdge,yardTexel,yardGrain,yardColor,YARD,YARD_GLSL } from '../dist/valley/kamakura-ground-yard.js';
import { groundUseBoxes,grassTintAt,toneGrain,tonePebble } from '../dist/valley/kamakura-ground-tone-rules.js';
import { installGroundDetail } from '../dist/valley/kamakura-ground-detail.js';
import { THREE } from './helpers/tree-modules.mjs';
import { fixture } from './helpers/kamakura-fixture.mjs';
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const sigma=a=>{const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)));};
const node=(part,x,z)=>({part,facility:'synthetic',anchor_xz:[x,z],bbox_min:[-10,0,-10],bbox_max:[10,5,10]});
const data={facilities:{nodes:[node('gate',-30,-40),node('hall',30,40)]}};
const axes=groundAxes(data),boxes=groundUseBoxes(data);
function lattice(x,z){
  const x0=Math.floor(x/4)*4,z0=Math.floor(z/4)*4,u=(x-x0)/4,v=(z-z0)/4,result=[0,0,0];
  for(let j=0;j<2;j++)for(let i=0;i<2;i++){
    const bytes=new Uint8Array(4);yardTexel(boxes,axes,x0+i*4,z0+j*4,bytes,0);
    const w=(i?u:1-u)*(j?v:1-v);for(let c=0;c<3;c++)result[c]+=bytes[c]/255*w;
  }
  return [(result[0]-.5)*64,result[1],result[2]];
}
test('R3 signed 4m field preserves rotated entrance-to-hall 3–5m wear, noisy margins and endpoints',t=>{
  assert.equal(axes.length,1);assert.equal(axes[0].length,100);
  assert.equal(groundAxes({facilities:{nodes:[node('hall',0,0)]}}).length,0);
  const widths=[],centres=[];
  const a=axes[0];
  for(let along=10;along<=90;along+=5){
    let lo=Infinity,hi=-Infinity;
    for(let side=-4;side<=4;side+=.01){
      const x=a.x+a.dx*along-a.dz*side,z=a.z+a.dz*along+a.dx*side,[signed,valid]=lattice(x,z);
      if(yardTrack(signed,x,z)*valid>.5){lo=Math.min(lo,side);hi=Math.max(hi,side);}
    }
    widths.push(hi-lo);centres.push((hi+lo)/2);
  }
  const check=w=>assert(w.every(v=>v>=3&&v<=5));check(widths);
  assert.throws(()=>check(widths.map(()=>8)),'wide mutant fails same bounds');
  assert(sigma(centres)>.04,'noisy band centre must wander');
  assert.throws(()=>assert(sigma(centres.map(()=>0))>.04));
  assert(yardTrack(0,0,0)>.9);assert.equal(yardTrack(6,0,0),0);
  const behind=lattice(a.x-a.dx*12,a.z-a.dz*12);assert.equal(behind[1],0);
  for(const d of [-10,0,15,30])assert.equal(yardEdge(d),0);assert.equal(yardEdge(5),1);
  for(const s of [-40,-32,-28,28,32,40]){
    const [side,valid]=lattice(a.x+a.dx*50-a.dz*s,a.z+a.dz*50+a.dx*s);
    assert.equal(yardTrack(side,0,0)*valid,0,'no false parallel band at signed-distance support boundary');
  }
  t.diagnostic(`decoded band width ${Math.min(...widths).toFixed(3)}..${Math.max(...widths).toFixed(3)}m; centre sigma ${sigma(centres).toFixed(4)}m`);
});
test('R3 70/150m soil mean is neutral, stones vary by place, grass reaches ±12% luma',t=>{
  const macro=[],density=[],grass=[];
  for(let x=-2000;x<2000;x+=13)for(let z=-2000;z<2000;z+=17){
    macro.push(yardMacro(x,z));density.push(yardDensity(x,z));grass.push(grassTintAt(x,z,150)*.307092);
  }
  assert(Math.abs(mean(macro))<.005);assert(sigma(macro)>=.028&&sigma(macro)<=.045);
  assert.throws(()=>assert(sigma(macro.map(v=>v*.5))>=.05));
  assert.throws(()=>assert(Math.abs(mean(macro.map(v=>v+.1)))<.005));
  assert(Math.min(...density)<.7&&Math.max(...density)>1.3);assert(sigma(density)>.12);
  assert(Math.min(...grass)<-.12&&Math.max(...grass)>.12);assert(Math.abs(mean(grass))<.005);
  assert(yardWander(10,20)!==yardWander(80,30));
  t.diagnostic(`macro mean=${mean(macro).toFixed(6)} sigma=${sigma(macro).toFixed(5)}; density sigma=${sigma(density).toFixed(5)}; grass range=${Math.min(...grass).toFixed(4)}..${Math.max(...grass).toFixed(4)}`);
});
function correlation(fn,lag){
  const a=[],b=[];for(let i=0;i<5000;i++){const x=13+i*.0037,z=27+i*.0061;a.push(fn(x,z));b.push(fn(x+lag,z));}
  const ma=mean(a),mb=mean(b);return mean(a.map((v,i)=>(v-ma)*(b[i]-mb)))/(sigma(a)*sigma(b));
}
test('R3 variable-density stones retain irregular positions and converge at distance/pixel integration',t=>{
  const c=correlation((x,z)=>yardGrain(x,z,4,.008),.32);
  assert(Math.abs(c)<.2);assert.throws(()=>assert(Math.abs(correlation(x=>Math.sin(x*Math.PI*2/.32),.32))<.2));
  for(let x=0;x<100;x+=.37){assert.equal(Math.abs(yardGrain(x,17,500,.01)),0);assert.equal(Math.abs(yardGrain(x,17,2,1)),0);}
  t.diagnostic(`.32m autocorrelation=${c.toFixed(4)}`);
});
function blur(a,w,h,s){
  const r=Math.ceil(s*3),k=Array.from({length:r*2+1},(_,i)=>Math.exp(-.5*((i-r)/s)**2)),norm=mean(k)*k.length;
  const tmp=new Float64Array(a.length),out=new Float64Array(a.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let j=-r;j<=r;j++)tmp[y*w+x]+=a[y*w+Math.max(0,Math.min(w-1,x+j))]*k[j+r]/norm;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let j=-r;j<=r;j++)out[y*w+x]+=tmp[Math.max(0,Math.min(h-1,y+j))*w+x]*k[j+r]/norm;
  return out;
}
test('R3 synthetic plaza broadens low-frequency luma without restoring R1 high-frequency dots',t=>{
  const w=192,h=128,old=[],next=[];
  const encode=v=>255*(1.055*v**(1/2.4)-.055);
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    const d=2+98*j/(h-1),px=d*.003,x=13.37+(i-w/2)*px,z=7.91+d;
    old.push(encode(.27*(1+toneGrain(x,z,d,px)*.8+tonePebble(x,z,d,px)*.22)));
    next.push(encode(yardColor([.27,.27,.27],0,0,yardMacro(x,z))[0]*(1+yardGrain(x,z,d,px)*.8+tonePebble(x,z,d,px)*.22)));
  }
  const bands=a=>{const g=[1,3,8,24].map(s=>blur(a,w,h,s));return [0,1,2].map(k=>sigma(Array.from(g[k],(v,i)=>v-g[k+1][i])));};
  const before=bands(old),after=bands(next),ratios=after.map((v,i)=>v/before[i]);
  t.diagnostic(`ratios=${ratios.map(v=>v.toFixed(4))}`);assert(ratios[0]>=.8&&ratios[0]<=1.2);assert(ratios[1]>=.8&&ratios[1]<=1.2);assert(ratios[2]>=2);
  assert.throws(()=>assert(before[2]/before[2]>=2),'removing macro fails the same low-frequency condition');
  t.diagnostic(`synthetic Gaussian 1–3 / 3–8 / 8–24px sigma ratios=${ratios.map(v=>v.toFixed(3)).join('/')}`);
});
test('R3 shipped Three owns mip-safe field, starts neutral, switches back to R2 and adapts without replacing resources',async()=>{
  for(const search of ['', '?gyard=0'])for(const quality of ['standard','light']){
    const d=fixture({width:100,height:100,cell:4});d.meta.surface={};d.meta.ground={};d.surface=new Uint8Array(10000).fill(4);d.ground=new Uint8Array(30000).fill(140);d.facilities=data.facilities;
    const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,{search,quality}),tone=owner.tone;
    try{
      assert.equal(tone.uniforms.uToneBlend.value,0);assert(tone.textures[0].version>0);
      await tone.ready;
      const tex=tone.uniforms.uToneYard.value;assert.equal(tex.internalFormat,'RGBA8');assert.equal(tex.image.width,tone.textures[1].image.width);assert(tex.generateMipmaps&&tex.version>0);
      const shader={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(shader);
      assert(shader.fragmentShader.includes('toneShadowEdge*uToneR3'));assert(shader.fragmentShader.includes('1.0/toneFineMultiplier'));assert(shader.fragmentShader.includes('vec3 wear=vec3(32.0,0.0,0.0)'));
      const enabled=search==='',value=enabled?(quality==='light'?.45:1):0;assert.equal(tone.uniforms.uToneR3.value,value);
      owner.setAdapt(2);assert.equal(tone.uniforms.uToneR3.value,enabled?.45:0);owner.setAdapt(3);assert.equal(tone.uniforms.uToneR3.value,0);owner.setAdapt(0);assert.equal(tone.uniforms.uToneR3.value,value);
      let disposals=0;tex.addEventListener('dispose',()=>disposals++);owner.dispose();owner.dispose();assert.equal(disposals,1);
    }finally{owner.dispose();m.dispose();}
  }
});

const encode=v=>v<=.0031308?12.92*v:1.055*v**(1/2.4)-.055;
const luminance=c=>c.reduce((s,v,i)=>s+encode(v)*[.2126,.7152,.0722][i],0);
const chroma=c=>{const y=c.reduce((s,v,i)=>s+v*[.2126,.7152,.0722][i],0);return (Math.max(...c)-Math.min(...c))/y;};
test('R3 fix quiet wear: displayed track +6–10%, margin −4–7%, desaturation and neutral broad mean',t=>{
  const base=[.25,.27,.19],plain=luminance(base);
  const accept=fn=>{
    const track=fn(base,1,0,0),edge=fn(base,0,1,0);
    const gain=luminance(track)/plain-1,loss=luminance(edge)/plain-1;
    assert(gain>=.06&&gain<=.10,`displayed track gain ${gain}`);
    assert(loss<=-.04&&loss>=-.07,`displayed margin loss ${loss}`);
    assert(Math.abs(chroma(track)/chroma(base)-.9)<1e-6);
    assert(edge[1]/edge[0]>base[1]/base[0]);
    return [gain,loss];
  };
  const [gain,loss]=accept(yardColor);
  assert.throws(()=>accept((base,track,margin)=>base.map(v=>v*(1+track*.07-margin*.045))));
  const changes=[],warmth=[];
  for(let x=-2000;x<2000;x+=23)for(let z=-2000;z<2000;z+=29){
    const color=yardColor(base,0,0,yardMacro(x,z));
    changes.push(luminance(color)/plain-1);
    warmth.push(255*((encode(color[0])-encode(color[2]))-(encode(base[0])-encode(base[2]))));
  }
  assert(sigma(changes)>=.028&&sigma(changes)<=.045);assert(Math.abs(mean(changes))<.005);
  assert(Math.abs(mean(warmth))<3);
  for(const strength of [0,.45]){
    const color=yardColor(base,1,1,.08,strength);
    assert(luminance(color)<luminance(yardColor(base,1,1,.08)));
    if(strength===0)assert.deepEqual(color,base);
  }
  // The tested coefficients are emitted into GLSL, rather than an unrelated reference.
  for(const expression of [`track*${YARD.track}`,`margin*${YARD.margin}`,`track*${YARD.desaturate}`,YARD.gamma.toFixed(1)])assert(YARD_GLSL.includes(expression));
  t.diagnostic(`display luma track +${(gain*100).toFixed(2)}%, margin ${(loss*100).toFixed(2)}%; macro sigma ${(sigma(changes)*100).toFixed(2)}%, mean ${(mean(changes)*100).toFixed(3)}%; mean R−B delta ${mean(warmth).toFixed(3)}/255`);
});

function decoded(boxes,axes,x,z,dx=4,dz=4,ox=0,oz=0){
  const u=(x-ox)/dx,v=(z-oz)/dz,i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,channels=[0,0,0];
  for(let yy=0;yy<2;yy++)for(let xx=0;xx<2;xx++){
    const bytes=new Uint8Array(4);yardTexel(boxes,axes,ox+(i+xx)*dx,oz+(j+yy)*dz,bytes,0);
    const w=(xx?a:1-a)*(yy?b:1-b);for(let c=0;c<3;c++)channels[c]+=w*bytes[c]/255;
  }
  return {track:yardTrack((channels[0]-.5)*64,x,z)*channels[1],valid:channels[1],edge:channels[2]};
}
test('R3 fallback traverses a gate-free box and an off-axis entrance, without distant interpolation ghosts',()=>{
  const box={x0:-40,x1:40,z0:-50,z1:50,yard:true};
  for(const d of [{},data]){
    const route=groundAxes(d,[box]);assert(route.some(a=>a.fallback));
    const a=route.find(a=>a.fallback),x=a.x+a.dx*a.length*.3,z=a.z+a.dz*a.length*.3;
    assert(decoded([box],route,x,z).track>.7);
    if(!d.facilities)assert.equal(decoded([box],groundAxes(d),x,z).track,0);
    for(const a of route){const x=a.x+a.dx*a.length*.4-a.dz*30,z=a.z+a.dz*a.length*.4+a.dx*30;
      const min=route.reduce((n,r)=>{
        const along=Math.max(0,Math.min(r.length,(x-r.x)*r.dx+(z-r.z)*r.dz));
        return Math.min(n,Math.hypot(x-r.x-r.dx*along,z-r.z-r.dz*along));
      },Infinity);
      if(min>16)assert.equal(decoded([box],route,x,z).track,0);
    }
  }
});

test('R3 private 12 foreground gains a fallback band after 4m quantization and interpolation',{
  skip:!process.env.KZ_WORLD_DIR&&'KZ_WORLD_DIR未設定：私有施設が必要'
},async t=>{
  const {readFile}=await import('node:fs/promises'),{join}=await import('node:path');
  const dir=process.env.KZ_WORLD_DIR,meta=JSON.parse(await readFile(join(dir,'meta.json'),'utf8'));
  const d={meta,facilities:JSON.parse(await readFile(join(dir,meta.facilities.file),'utf8'))};
  const {toneWeightGrid}=await import('../dist/valley/kamakura-ground-tone-rules.js');
  const grid=toneWeightGrid(d),boxes=groundUseBoxes(d),all=groundAxes(d,boxes),old=groundAxes(d);
  const sample=(axes,x,z)=>decoded(boxes,axes,x,z,grid.dx,grid.dz,-(grid.width-1)*grid.dx/2,-(grid.height-1)*grid.dz/2).track;
  const check=axes=>{
    let added=false;
    // Public brief URL position (east,north); catalog/shader z points south.
    for(let f=2;f<80;f+=2)for(let side=-.65*f;side<=.65*f;side+=1){
      const x=-366+side,z=-230-f;
      if(sample(axes,x,z)>.5&&sample(old,x,z)<.05)added=true;
    }
    assert(added,'12 must gain a new foreground band, not merely retain the old gate axis');
  };
  check(all);assert.throws(()=>check(old));
  assert(sample(all,-2200,700)>.5,'11 original band remains');
  t.diagnostic('11 retained; 12 gains a visible fallback band in forward view; private coordinates and counts omitted');
});

test('R3 gyard=2 debug is opt-in, bypasses illumination, and respects adaptation',async()=>{
  for(const search of ['', '?gyard=0','?gyard=2','?gtone=0&gyard=2']){
    const d=fixture({width:40,height:40,cell:4});d.meta.surface={};d.meta.ground={};d.surface=new Uint8Array(1600).fill(4);d.ground=new Uint8Array(4800).fill(140);d.facilities=data.facilities;
    const m=new THREE.MeshLambertMaterial({vertexColors:true}),owner=installGroundDetail(THREE,m,d,{search});
    try{
      if(search.includes('gtone=0')){assert.equal(owner.tone,undefined);continue;}
      const s={uniforms:{},vertexShader:THREE.ShaderLib.lambert.vertexShader,fragmentShader:THREE.ShaderLib.lambert.fragmentShader};m.onBeforeCompile(s);
      const u=owner.tone.uniforms;assert.equal(u.uToneYardDebug.value,search==='?gyard=2'?1:0);
      assert(u.uToneBlend.value<1);await owner.tone.ready;
      assert(s.fragmentShader.includes('vec3(track,wear.z,clamp(.5+broad*4.0'));
      assert(s.fragmentShader.indexOf('gl_FragColor.rgb=toneYardDebug')>s.fragmentShader.indexOf('#include <fog_fragment>'));
      assert(s.fragmentShader.includes('uToneYardDebug>0.5 && uToneR3>0.0 && uToneStrength>0.0'));
      owner.setAdapt(3);assert.equal(u.uToneR3.value,0);owner.setAdapt(0);assert.equal(u.uToneR3.value,search==='?gyard=0'?0:1);
    }finally{owner.dispose();m.dispose();}
  }
});
