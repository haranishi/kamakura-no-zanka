// W2c-9b: deterministic, periodic ground detail; no renderer or private data here.
const GRASS_AMOUNTS = Object.freeze([0.08,0,1,0.45,0.15,0,0,0.7]);
export const grassAmount = code => GRASS_AMOUNTS[code] ?? 0;
export const smooth = (a,b,x) => { const t=Math.max(0,Math.min(1,(x-a)/(b-a))); return t*t*(3-2*t); };
export const slopeAmount = y => smooth(.45,.85,y);
export const detailAmplitude = d => smooth(18,55,d)*(1-smooth(700,2500,d));
export const boundaryWarp = (x,z) => [Math.sin(x*.13+Math.sin(z*.09))*.85,Math.sin(z*.11+Math.sin(x*.07))*.85];
// W2c-9b2: shared constants emit the GLSL expressions as well as their CPU references.
export const SOIL = Object.freeze({ slopeStart: Math.cos(35*Math.PI/180), slopeFull: Math.cos(50*Math.PI/180), fineNear:12, fineFar:60, macroNear:700, macroFar:2500 });
export const soilTexture = code => ({3:'litter',4:'soil',5:'rock',6:'gravel',7:'furrows',255:'soil'}[code] ?? 'none');
export const soilSlope = y => 1-smooth(SOIL.slopeFull,SOIL.slopeStart,y);
export const soilFine = (d,pixelWidth=0,scale=.05) => (1-smooth(SOIL.fineNear,SOIL.fineFar,d))*(1-smooth(scale*.35,scale,pixelWidth));
export const soilMacroFade = d => 1-smooth(SOIL.macroNear,SOIL.macroFar,d);
export const soilHash = (x,z) => {const v=Math.sin(x*127.1+z*311.7)*43758.5453123;return v-Math.floor(v);};
// W2c-9r1 ground round 3: keep the legacy soil's point kernel in both render paths.
export function soilGrain(x,z,cell) {
  const u=x/cell,v=z/cell;
  return (soilHash(Math.floor(u),Math.floor(v))-.5)*(1-smooth(.16,.38,Math.hypot(u-Math.floor(u)-.5,v-Math.floor(v)-.5)));
}
export const SOIL_GRAIN_GLSL=`
float groundSoilGrain(vec2 q,float cell){
  vec2 g=q/cell;
  float seed=fract(sin(dot(floor(g),vec2(127.1,311.7)))*43758.5453123);
  return (seed-.5)*(1.0-smoothstep(.16,.38,length(fract(g)-.5)));
}
`;
export function soilNoise(x,z) {
  const i=Math.floor(x),j=Math.floor(z),u=smooth(0,1,x-i),v=smooth(0,1,z-j);
  return (1-v)*((1-u)*soilHash(i,j)+u*soilHash(i+1,j))+v*((1-u)*soilHash(i,j+1)+u*soilHash(i+1,j+1));
}
export function soilMacro(x,z,d=0) {
  const warp=soilNoise(x/300,z/300)*16;
  const n=(soilNoise((x+warp)/40,(z-warp)/40)*.45+soilNoise((.8*x+.6*z)/170,(-.6*x+.8*z)/170)*.55)*2-1;
  const fade=soilMacroFade(d);
  return {lightness:1+.08*n*fade,saturation:1+.1*n*fade,hue:3*n*fade||0};
}
// Grass fraction of the full 3x3 neighbourhood, clamped at the map boundary.
export function soilEdge(surface,w,h,index) {
  const x=index%w,z=Math.floor(index/w);let sum=0;
  for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++)sum+=grassAmount(surface[Math.max(0,Math.min(h-1,z+j))*w+Math.max(0,Math.min(w-1,x+i))]);
  return sum/9;
}
export function groundPattern(seed=19391,size=256) {
  let state=seed>>>0;
  const rand=()=>{state=(Math.imul(state,1664525)+1013904223)>>>0;return state/4294967296;};
  const waves=Array.from({length:24},(_,i)=>({x:1+Math.floor(rand()*(i<8?4:50)),z:Math.floor(rand()*(i<8?4:8)),p:rand()*Math.PI*2,a:i<8?.07:.018}));
  const data=new Uint8Array(size*size*4); let mean=0;
  for(let j=0;j<size;j++)for(let i=0;i<size;i++){
    const x=i%(size-1),z=j%(size-1);
    let v=.5;for(const w of waves)v+=w.a*Math.sin(2*Math.PI*(w.x*x+w.z*z)/(size-1)+w.p);
    const k=(j*size+i)*4, dry=.5+.25*Math.sin(2*Math.PI*(2*x+3*z)/(size-1));
    data[k]=Math.round(Math.max(0,Math.min(1,v))*255);data[k+1]=data[k];data[k+2]=Math.round(dry*255);data[k+3]=255;mean+=data[k]/255;
  }
  return {data,size,mean:mean/(size*size)};
}

// W2c-9r2 ground: centred equal disks -> inset, rotated ellipses with independent sizes/tones.
// The support stays inside its cell, so no neighbour search or clipped cell-edge seams are needed.
export function scatterStone(x,z,cell) {
  const i=Math.floor(x/cell),j=Math.floor(z/cell),a=soilHash(i+17,j-29),b=soilHash(i-43,j+11);
  const cx=.2+.6*a,cz=.2+.6*b;
  const r=Math.min(.16+.14*soilHash(i+71,j+53),cx,cz,1-cx,1-cz),aspect=.5+.45*soilHash(i-7,j-83),angle=a*6.28318530718;
  const u=x/cell-i-cx,v=z/cell-j-cz;
  const radius=Math.hypot((u*Math.cos(angle)+v*Math.sin(angle))/r,(-u*Math.sin(angle)+v*Math.cos(angle))/(r*aspect));
  return (1-smooth(.55,1,radius))*(soilHash(i+101,j-59)-.5);
}
export function scatterFade(x,z,d,px,cell) {
  const jitter=.8+.4*soilNoise(x/7+cell*31,z/7-cell*19);
  return (1-smooth(12*cell/.08,65*cell/.08,d/jitter))*(1-smooth(cell*.18,cell*.75,px/jitter));
}
export const SCATTER_GLSL=`
float groundScatterHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453123);}
float groundScatterNoise(vec2 p){
  vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(groundScatterHash(i),groundScatterHash(i+vec2(1,0)),f.x),mix(groundScatterHash(i+vec2(0,1)),groundScatterHash(i+vec2(1,1)),f.x),f.y);
}
float groundScatter(vec2 p,float cell){
  vec2 g=p/cell,i=floor(g);
  float a=groundScatterHash(i+vec2(17,-29)),b=groundScatterHash(i+vec2(-43,11));
  vec2 centre=vec2(.2)+.6*vec2(a,b);
  float r=min(.16+.14*groundScatterHash(i+vec2(71,53)),min(min(centre.x,centre.y),min(1.0-centre.x,1.0-centre.y))),aspect=.5+.45*groundScatterHash(i+vec2(-7,-83)),angle=a*6.28318530718;
  vec2 v=fract(g)-centre;
  float radius=length(vec2((v.x*cos(angle)+v.y*sin(angle))/r,(-v.x*sin(angle)+v.y*cos(angle))/(r*aspect)));
  return (1.0-smoothstep(.55,1.0,radius))*(groundScatterHash(i+vec2(101,-59))-.5);
}
float groundScatterFade(vec2 p,float d,float px,float cell){
  float jitter=.8+.4*groundScatterNoise(p/7.0+cell*vec2(31,-19));
  return (1.0-smoothstep(12.0*cell/.08,65.0*cell/.08,d/jitter))*(1.0-smoothstep(cell*.18,cell*.75,px/jitter));
}
`;
