import test from 'node:test';
import assert from 'node:assert/strict';
import { soilGrain,soilFine,soilNoise,soilHash,scatterStone,scatterFade,smooth } from '../dist/valley/kamakura-ground-pattern.js';
import { toneGrain,tonePebble,toneChannel,grassTintAt } from '../dist/valley/kamakura-ground-tone-rules.js';
import { TONE_GLSL } from '../dist/valley/kamakura-ground-tone.js';
const mean=a=>a.reduce((s,v)=>s+v,0)/a.length;
const sigma=a=>{const m=mean(a);return Math.sqrt(mean(a.map(v=>(v-m)**2)));};
function blur(a,w,h,s){
  const r=Math.ceil(3*s),k=Array.from({length:r*2+1},(_,i)=>Math.exp(-.5*((i-r)/s)**2)),norm=k.reduce((a,b)=>a+b,0);
  const b=new Float64Array(a.length),out=new Float64Array(a.length);
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let j=-r;j<=r;j++)b[y*w+x]+=a[y*w+Math.max(0,Math.min(w-1,x+j))]*k[j+r]/norm;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++)for(let j=-r;j<=r;j++)out[y*w+x]+=b[Math.max(0,Math.min(h-1,y+j))*w+x]*k[j+r]/norm;
  return out;
}
const encode=v=>255*(1.055*v**(1/2.4)-.055);
const luma=[.2126,.7152,.0722],base=[.25,.27,.19];
function bands(kernel,use,broken=false){
  const w=192,h=128,a=[];
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){
    // Flat pinhole-like footprint: 2–8m, off-axis world coordinates, constant neutral lighting.
    const d=2+6*j/(h-1),px=d*.003,x=13.37+(i-w/2)*px,z=7.91+d;
    const grain=kernel(x,z,d,px),pebble=kernel===toneGrain?tonePebble(x,z,d,px):0;
    const u=(x+Math.sin(z*.11)*.22)/.14,v=(z+Math.sin(x*.09)*.22)/.14;
    const disk=(soilHash(Math.floor(u),Math.floor(v))>=.68?1-smooth(.18,.38,Math.hypot(u-Math.floor(u)-.5,v-Math.floor(v)-.5)):0)-.08;
    a.push(base.reduce((v,b,c)=>v+encode(broken?(b*[1.30,1.25,1.13][c]+[.035,.032,.022][c])*(1+.8*grain+.85*disk):kernel===toneGrain?toneChannel(b,c,0,0,0,use,1,grain,1,0,.5,1,pebble):b*(1+.8*grain))*luma[c],0));
  }
  const g=[1,3,8].map(s=>blur(a,w,h,s));
  return [0,1].map(k=>sigma(Array.from(g[k],(v,i)=>v-g[k+1][i])));
}
const old=(x,z,d,px)=>soilGrain(x+Math.sin(z*.11)*.22,z+Math.sin(x*.09)*.22,.06)*soilFine(d,px,.06);
test('R2 synthetic 2–8m luminance bands stay within 1–2x legacy, inside and outside; regular R1 fails',t=>{
  const before=bands(old,0);
  for(const use of [0,1]){
    const after=bands(toneGrain,use),ratios=after.map((v,i)=>v/before[i]);
    t.diagnostic(`use=${use}: old=${before.map(v=>v.toFixed(4))}, new=${after.map(v=>v.toFixed(4))}, ratios=${ratios.map(v=>v.toFixed(3))}`);
    for(const r of ratios)assert(r>=1&&r<=2,'band sigma ratio must be 1–2');
  }
  const broken=bands(old,1,true).map((v,i)=>v/before[i]);
  assert(broken.some(r=>r>2),'restoring R1 must violate the same band limit');
  t.diagnostic(`R1 mutation band ratios=${broken.map(v=>v.toFixed(3))}`);
});
function autocorrelation(fn,lag){
  const a=[],b=[];for(let j=0;j<40;j++)for(let i=0;i<400;i++){const x=i*.0027,z=j*.0131;a.push(fn(x,z));b.push(fn(x+lag,z));}
  const ma=mean(a),mb=mean(b);let n=0,da=0,db=0;
  for(let i=0;i<a.length;i++){n+=(a[i]-ma)*(b[i]-mb);da+=(a[i]-ma)**2;db+=(b[i]-mb)**2;}
  return n/Math.sqrt(da*db);
}
test('R2 size distribution and off-grid centres reject the regular centred disk mutation',t=>{
  function inspect(fn){
    const widths=[],centres=[];
    for(let j=0;j<160;j++){
      const line=Array.from({length:240},(_,i)=>Math.abs(fn((j%10+i/240)*.16,(Math.floor(j/10)+.5)*.16,.16)));
      const peak=Math.max(...line);if(peak<.02)continue;
      const indices=line.map((v,i)=>v>peak*.5?i:-1).filter(i=>i>=0);
      widths.push(indices.length);centres.push((indices[0]+indices.at(-1))/480);
    }
    return {sizes:sigma(widths),centres:sigma(centres)};
  }
  const real=inspect(scatterStone),broken=inspect(soilGrain);
  const accept=v=>assert(v.sizes>8&&v.centres>.04);
  accept(real);assert.throws(()=>accept(broken),assert.AssertionError);
  const regular=autocorrelation((x,z)=>(Math.abs(soilGrain(x,z,.08))>.001?1:0),.08),irregular=autocorrelation((x,z)=>(Math.abs(scatterStone(x,z,.08))>.001?1:0),.08);
  assert(regular>.7);assert(Math.abs(irregular)<.25);
  t.diagnostic(`size sigma=${real.sizes.toFixed(3)} samples; centre sigma=${real.centres.toFixed(3)} cells; autocorrelation grid lag old=${regular.toFixed(3)}, new=${irregular.toFixed(3)}`);
});
test('R2 fade varies within each row, adjacent rows are smooth, and scale transitions differ',t=>{
  let maxJump=0,minVariation=1;
  for(const cell of [.08,.16,.32])for(let d=15;d<200;d+=2){
    const row=Array.from({length:100},(_,i)=>scatterFade(i*.8,13,d,.035,cell));
    if(mean(row)>.02&&mean(row)<.98)minVariation=Math.min(minVariation,sigma(row));
    const next=Array.from({length:100},(_,i)=>scatterFade(i*.8,13.1,d+.1,.035,cell));
    maxJump=Math.max(maxJump,Math.abs(mean(next)-mean(row)));
  }
  assert(minVariation>.001);assert(maxJump<.008);
  assert(scatterFade(5,7,80,.01,.32)>scatterFade(5,7,80,.01,.08));
  t.diagnostic(`min within-row sigma=${minVariation.toFixed(5)}, max adjacent mean delta=${maxJump.toFixed(5)}`);
});
test('R2 grass has visible root-coloured variation, fades out at 1.5km, no hard ground distance cutoff',t=>{
  const values=[];
  for(let x=-400;x<400;x+=4)for(let z=-400;z<400;z+=4){
    values.push(grassTintAt(x,z,150)*.307092);
    assert.equal(Math.abs(grassTintAt(x,z,1500)),0);assert.equal(Math.abs(grassTintAt(x,z,5000)),0);
  }
  assert(Math.max(...values)>.08);assert(Math.min(...values)<-.08);assert(Math.abs(mean(values))<.005);
  assert(!/\bstep\([^)]*dist/.test(TONE_GLSL));
  t.diagnostic(`grass relative luma range ${Math.min(...values).toFixed(4)}..${Math.max(...values).toFixed(4)}, mean=${mean(values).toFixed(5)}; >=1500m added shift=0`);
});

test('R2 stone peaks stay within +35% and aerial natural ground converges to source RGB',()=>{
  for(let j=0;j<80;j++)for(let i=0;i<160;i++){
    const x=i*.0131,z=j*.0173,grain=toneGrain(x,z,2,.006),pebble=tonePebble(x,z,2,.006);
    for(const use of [0,1])for(let c=0;c<3;c++){
      const plain=toneChannel(base[c],c,0,0,0,use,1,0,1,0,.5,1,0);
      const textured=toneChannel(base[c],c,0,0,0,use,1,grain,1,0,.5,1,pebble);
      assert(textured<=plain*1.35+1e-12 && textured>=plain*.65-1e-12);
      assert.equal(toneChannel(base[c],c,0,0,grassTintAt(x,z,5000),0,1,toneGrain(x,z,5000,1),1,0,.5,1,tonePebble(x,z,5000,1)),base[c]);
    }
  }
});
