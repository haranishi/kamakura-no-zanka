// W2c-13 grass GR1–GR3: world-keyed blades, one sky deficit, bounded rounding.
import { grassHash, grassR4Pigment, grassLuminance } from './kamakura-grass-look.js';
const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export const grassR7Enabled=search=>new URLSearchParams(search).get('grass7')!=='0';
export const grassR7Variation=(x,z)=>({blade:.75+.50*grassHash(x,z,1213),hue:-.025+.05*grassHash(x,z,1709)});
export function packGrassR7(data,kind,quality) {
  if(kind!=='near')return data;
  for(let i=0;i<data.length;i+=15){
    if(data[i+11]<-1.5)continue; // Keep flowers and seed heads.
    const x=data[i],z=data[i+2],v=grassR7Variation(x,z);
    // Replace only the old ±4% blade factor; stock brightness/hue remain intact.
    const color=grassR4Pigment(Array.from(data.subarray(i+8,i+11)),x,z,
      {brightness:v.blade/(.96+.08*grassHash(x,z,1213)),blade:1,hue:quality==='light'?0:v.hue},1);
    data.set(color,i+8);
  }
  return data;
}
// R7 parent tuning: the first gradient (0.65-1.20) and tip lift (0.12) gave no screen change; x2 reads.
export const grassR7Gradient=t=>.40+1.00*Math.sqrt(clamp(t));
export const grassR7Angle=u=>(clamp(u)*2-1)*25*Math.PI/180;
export const grassR7RoundGain=(flat,rounded)=>1+Math.max(-.1,Math.min(.1,.1*(rounded-flat)/Math.sin(25*Math.PI/180)));
// Reference for the single post-lighting shader deficit. No second floor is added.
export function grassR7Shade(color,sky,radiance,directY,sunY,t,strength=1) {
  const dusk=1-smooth(.12,.55,sunY),dark=1-smooth(.020,.025,directY);
  const gate=dark*strength,gradient=1+(grassR7Gradient(t)-1)*gate;
  const base=color.map((c,i)=>Math.max(c,.001)*sky[i]*(.08-.02*dusk));
  const y=grassLuminance(base),tip=smooth(.18,1,t)*(.28-.12*dusk)*gate;
  const tipColor=sky.map((c,i)=>c*[1.06,1.02,.86][i]);
  const tipY=grassLuminance(tipColor),skyY=grassLuminance(sky);
  const tipBase=color.map((c,i)=>Math.max(c,.001)*tipColor[i]*skyY/Math.max(tipY,1e-6)*tip);
  const target=Math.max(.02*(1-.5*dusk),y)*gradient+grassLuminance(tipBase);
  const current=radiance.map(c=>c*gradient),deficit=Math.max(0,target-grassLuminance(current))*dark*strength;
  const floorColor=base.map((c,i)=>c*gradient+tipBase[i]),floorY=grassLuminance(floorColor);
  return current.map((c,i)=>c+floorColor[i]/Math.max(floorY,1e-6)*deficit);
}
