// W2c-11 grass: camera-wide contours -> complementary, root-keyed handoff.
import { midGrassBandOffset } from './kamakura-grass-band.js';
import { grassHash, grassR4Variation, grassLuminance } from './kamakura-grass-look.js';
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export const grassR5Enabled=search=>new URLSearchParams(search).get('grass6')!=='0';
// Integer arithmetic matches WebGL2 uints; sin hashes disagree across CPU/GPU.
export const grassR5Jitter=(x,z)=>{
  let h=(Math.imul(Math.floor(x*16),1664525)+Math.imul(Math.floor(z*16),1013904223)+1327)>>>0;
  h=Math.imul(h^(h>>>16),2246822519)>>>0;h=(h^(h>>>13))>>>0;
  return .75+.5*(h&65535)/65535;
};
export function nearGrassR5DensityAt(x,z,distance) {
  const j=grassR5Jitter(x,z),d=distance/(j+(1-j)*smooth(40,120,distance));
  return (1-smooth(6,26,d))*(1-.98*smooth(0,24,d))*(1-.30*smooth(4,18,d));
}
export function grassR5Weights(x,z,distance) {
  const j=grassR5Jitter(x,z),d=distance/(j+(1-j)*smooth(40,120,distance));
  const oldNear=(1-smooth(6,26,d))*(1-.98*smooth(0,24,d));
  const oldMid=smooth(6,26,d)*(1-.50*smooth(28,110,d))*(1-smooth(80,144,d));
  const near=oldNear*(1-.30*smooth(4,18,d));
  const farD=distance+midGrassBandOffset(x,z)*smooth(30,70,distance);
  const far=smooth(6,26,farD)*(1-.50*smooth(28,110,farD))*(1-smooth(80,144,farD));
  const blend=smooth(30,40,distance),mid=(oldMid+oldNear-near)*(1-blend)+far*blend;
  return {near,mid,total:near+mid};
}
export const GRASS_R5_GLSL=`
float grass6Jitter(vec2 p){
  uint h=uint(int(floor(p.x*16.0)))*1664525u+uint(int(floor(p.y*16.0)))*1013904223u+1327u;
  h=(h^(h>>16u))*2246822519u;h=h^(h>>13u);
  return .75+.5*float(h&65535u)/65535.0;
}
float grass6Distance(vec2 p,float d){return d/mix(grass6Jitter(p),1.0,smoothstep(40.0,120.0,d));}
vec2 grass6Weights(float d){
  float oldNear=(1.0-smoothstep(6.0,26.0,d))*(1.0-.98*smoothstep(0.0,24.0,d));
  float oldMid=smoothstep(6.0,26.0,d)*(1.0-.50*smoothstep(28.0,110.0,d))*(1.0-smoothstep(80.0,144.0,d));
  float nearWeight=oldNear*(1.0-.30*smoothstep(4.0,18.0,d));
  return vec2(nearWeight,oldMid+oldNear-nearWeight);
}
`;
// Preparation only. Reuse the near ecological palette and stock growth; no new buffers.
export function packGrassR5(data,kind,ecology,quality) {
  if(kind!=='mid')return data;
  for(let i=0;i<data.length;i+=15){
    const x=data[i],z=data[i+2],e=ecology(Math.floor(x)+.5,Math.floor(z)+.5),h=grassHash(x,z,113);
    const v=grassR4Variation(x,z),inland=smooth(10,75,e.sea??Infinity),dune=smooth(.5,6.5,e.elevation??0);
    const coast=e.sand?.45+.35*inland+.20*dune:1;
    const height=e.margin?.5+.3*h:Math.max(.20,Math.min(.60,(.20+.40*h)*e.height));
    data[i+4]=(quality==='light'||h>.92?height:height*v.height*coast)*(.8+.3*grassHash(x,z,1333))+.12;
  }
  return data;
}
// Linear-radiance reference for Node checks; the emitted shader uses the same gates.
export function grassR5Floor(color,sky,radiance,directY,sunY,strength=1) {
  const night=1-smooth(.12,.55,sunY),minimum=.02*(1-.5*night);
  const base=color.map((c,i)=>Math.max(c,.001)*sky[i]*(.08-.02*night));
  const y=grassLuminance(base),target=Math.max(minimum,y);
  const deficit=Math.max(0,target-grassLuminance(radiance))*(1-smooth(.020,.025,directY))*strength;
  return base.map(c=>c/Math.max(y,1e-6)*deficit);
}
