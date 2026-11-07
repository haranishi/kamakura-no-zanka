import { soilNoise, soilHash, scatterStone, scatterFade, smooth } from './kamakura-ground-pattern.js';

// W2c-9r3 ground: uniform yards -> macro soil, entrance axes and untended margins.
// These are visual wear hypotheses inferred from placements, not historical routes.
export function groundAxes(data, boxes=[]) {
  const sites=new Map();
  for(const n of data.facilities?.nodes||[])if(n.facility){
    if(!sites.has(n.facility))sites.set(n.facility,[]);sites.get(n.facility).push(n);
  }
  const axes=[];
  const centre=n=>[n.anchor_xz[0]+(n.bbox_min[0]+n.bbox_max[0])/2,n.anchor_xz[1]+(n.bbox_min[2]+n.bbox_max[2])/2];
  for(const parts of sites.values()){
    const hall=parts.find(n=>n.part==='hall'),gate=parts.find(n=>n.part==='torii')||parts.find(n=>n.part==='gate'||n.part==='romon');
    if(!hall||!gate)continue;
    const [x,z]=centre(gate),[hx,hz]=centre(hall),length=Math.hypot(hx-x,hz-z);
    if(length>1)axes.push({x,z,dx:(hx-x)/length,dz:(hz-z)/length,length});
  }
  // W2c-9r3 ground fix: gate axes miss entrance aprons and off-axis yards.
  // One inferred route per box, from the open end of its long axis to the
  // nearest occupied box centre. This covers aprons outside the gate axis.
  for(const b of boxes){
    const cx=(b.x0+b.x1)/2,cz=(b.z0+b.z1)/2;
    if(!b.yard&&boxes.some(y=>y.yard&&cx>=y.x0&&cx<=y.x1&&cz>=y.z0&&cz<=y.z1))continue;
    const targets=boxes.filter(t=>!t.yard&&(t.x0+t.x1)/2>=b.x0&&(t.x0+t.x1)/2<=b.x1&&(t.z0+t.z1)/2>=b.z0&&(t.z0+t.z1)/2<=b.z1);
    const tx=targets.length?targets.reduce((s,t)=>s+(t.x0+t.x1)/2,0)/targets.length:cx;
    const tz=targets.length?targets.reduce((s,t)=>s+(t.z0+t.z1)/2,0)/targets.length:cz;
    let x=cx,z=cz,nearest=Infinity;
    if(b.x1-b.x0>b.z1-b.z0)x=tx>cx?b.x0:b.x1;else z=tz>cz?b.z0:b.z1;
    let hx=cx,hz=cz;nearest=Infinity;
    if(b.yard)for(const target of boxes){
      if(target.yard)continue;
      const tx=(target.x0+target.x1)/2,tz=(target.z0+target.z1)/2;
      if(tx<b.x0||tx>b.x1||tz<b.z0||tz>b.z1)continue;
      const d=Math.hypot(tx-x,tz-z);if(d>1&&d<nearest){nearest=d;hx=tx;hz=tz;}
    }
    const length=Math.hypot(hx-x,hz-z);
    if(length>1)axes.push({x,z,dx:(hx-x)/length,dz:(hz-z)/length,length,fallback:true});
  }
  return axes;
}
// Shared coefficients keep the CPU thresholds tied to the shipped shader.
export const YARD=Object.freeze({macroNear:70,macroFar:150,macroA:.21,macroB:.16,track:.18,margin:.09,desaturate:.10,gamma:2.2});
export const yardMacro=(x,z)=>(soilNoise(x/YARD.macroNear,z/YARD.macroNear)-.5)*YARD.macroA+(soilNoise((.8*x+.6*z)/YARD.macroFar,(-.6*x+.8*z)/YARD.macroFar)-.5)*YARD.macroB;
// A perceptual brightness change needs a larger linear multiplier. Grey mixing
// preserves linear luminance; the slight margin green also preserves luminance.
export function yardColor(base,track,margin,broad,strength=1){
  const luma=base[0]*.2126+base[1]*.7152+base[2]*.0722;
  const gain=Math.pow(1+strength*(broad+track*YARD.track-margin*YARD.margin),YARD.gamma);
  return base.map((v,c)=>(v+(luma-v)*track*YARD.desaturate*strength)*gain*(1+margin*strength*[-.035,.013937360179,-.035][c]));
}
export const yardDensity=(x,z)=>.65+.7*soilNoise(x/31+19,z/31-7);
export const yardStone=(x,z,cell,density)=>scatterStone(x,z,cell)*smooth(soilHash(Math.floor(x/cell)+213,Math.floor(z/cell)-97)-.06,soilHash(Math.floor(x/cell)+213,Math.floor(z/cell)-97)+.06,density*.85);
export function yardGrain(x,z,d,px) {
  const density=yardDensity(x,z);
  return yardStone(x,z,.08,density)*scatterFade(x,z,d,px,.08)*1.2
    +yardStone(x+13.7,z-9.3,.16,density)*scatterFade(x,z,d,px,.16)*.95
    +yardStone(x-5.1,z+17.9,.32,density)*scatterFade(x,z,d,px,.32)*.8;
}
export const yardWander=(x,z)=>(soilNoise(x/9,z/9)-.5)*.8;
export const yardTrack=(side,x,z,px=0)=>(1-smooth(1.5,2.5+px,Math.abs(side-yardWander(x,z))));
export const yardEdge=d=>smooth(0,5,d)*(1-smooth(5,15,d));
// Encode signed perpendicular distance, endpoint support, margin. Signed distance
// interpolates linearly across a 4m cell, preserving a 3–5m band unlike a baked mask.
export function yardTexel(boxes,axes,x,z,bytes,k) {
  let side=32,valid=0,nearest=Infinity,depth=-Infinity;
  for(const b of boxes){
    if(!b.yard)continue;
    const d=Math.min(x-b.x0,b.x1-x,z-b.z0,b.z1-z);depth=Math.max(depth,d);
  }
  for(const a of axes){
    if(x<Math.min(a.x,a.x+a.dx*a.length)-36||x>Math.max(a.x,a.x+a.dx*a.length)+36||z<Math.min(a.z,a.z+a.dz*a.length)-36||z>Math.max(a.z,a.z+a.dz*a.length)+36)continue;
    const along=(x-a.x)*a.dx+(z-a.z)*a.dz,s=(x-a.x)*-a.dz+(z-a.z)*a.dx;
    const end=Math.max(-along,0,along-a.length),distance=Math.hypot(s,end);
    if(distance<nearest){nearest=distance;side=s;valid=(1-smooth(0,4,end))*(1-smooth(8,12,Math.abs(s)));}
  }
  bytes[k]=Math.round(Math.max(0,Math.min(1,side/64+.5))*255);
  bytes[k+1]=Math.round(valid*255);bytes[k+2]=Math.round(yardEdge(depth)*255);bytes[k+3]=255;
}
export const YARD_GLSL=`
float yardStone(vec2 p,float cell,float density){
  float seed=groundScatterHash(floor(p/cell)+vec2(213,-97));
  return groundScatter(p,cell)*smoothstep(seed-.06,seed+.06,density*.85);
}
float yardMacro(vec2 p){return (toneNoise(p/${YARD.macroNear.toFixed(1)})-.5)*${YARD.macroA}+(toneNoise(mat2(.8,-.6,.6,.8)*p/${YARD.macroFar.toFixed(1)})-.5)*${YARD.macroB};}
vec3 yardColor(vec3 base,float track,float margin,float broad,float strength){
  float luma=dot(base,vec3(.2126,.7152,.0722));
  float gain=pow(1.0+strength*(broad+track*${YARD.track}-margin*${YARD.margin}),${YARD.gamma.toFixed(1)});
  return mix(base,vec3(luma),track*${YARD.desaturate}*strength)*gain*(1.0+margin*strength*vec3(-.035,.013937360179,-.035));
}
float yardDensity(vec2 p){return .65+.7*toneNoise(p/31.0+vec2(19,-7));}
float yardTrack(float side,vec2 p,float px){return 1.0-smoothstep(1.5,2.5+px,abs(side-(toneNoise(p/9.0)-.5)*.8));}
`;
