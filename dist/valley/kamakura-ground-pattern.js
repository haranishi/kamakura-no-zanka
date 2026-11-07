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
