import { soilNoise, soilHash, smooth } from './kamakura-ground-pattern.js';
import { grassColony } from './kamakura-grass-look.js';
// W2c-14 GD6: same-class uniform detail -> crisp two-octave material islands.
// Original masses are debited only once. Incoming mass is never transferred again.
export const MOSAIC_PAIRS=Object.freeze([[0,5,6],[2,5,3],[5,6,3],[6,5,0]].map(Object.freeze));
export function mosaicMask(x,z,offset=0,pixel=0){
  const n=(soilNoise(x/8+19+offset,z/8-37+offset)*2+soilNoise(x/4-43+offset,z/4+71+offset))/3;
  return smooth(.49,.53,n)*(1-smooth(1.5,4,pixel));
}
export const mosaicFade=dist=>1-smooth(60,200,dist);
export function exposureIsland(x,z){
  const ix=Math.floor(x/2.4),iz=Math.floor(z/2.4),a=soilHash(ix+137,iz-53),b=soilHash(ix-61,iz+97);
  const dx=x/2.4-ix-.5,dz=z/2.4-iz-.5;
  const radius=Math.hypot(dx/(.14+.24*a),dz/(.14+.24*b));
  return 1-smooth(.65+.12*soilNoise(x/.35,z/.35),1,radius);
}
export function exposedSoil(x,z,{grass=1,pixel=0}={}){
  const sparse=1-smooth(.35,.55,grassColony(x,z));
  return .3*grass*sparse*exposureIsland(x,z)*(1-smooth(.3,1,pixel));
}
export function mosaicWeights(weights,x,z,{light=false,strength=1,dist=0,avoid=0,exposure=0,pixel=0}={}){
  const amount=Math.max(0,Math.min(1,strength))*(1-avoid)*mosaicFade(dist);
  const gate=mosaicMask(x,z,0,pixel),partner=light?0:mosaicMask(x,z,113,pixel),out=weights.slice();
  for(const [from,a,b] of MOSAIC_PAIRS){
    if(light&&from!==5&&from!==6)continue;
    const rate=from===2?Math.max(.6*gate,exposure):.6*gate;
    const mass=weights[from]*Math.min(.6,rate)*amount;
    const soilMass=from===2?Math.max(mass*(1-partner),weights[2]*Math.min(.3,exposure)*amount):mass*(1-partner);
    out[from]-=mass;out[a]+=soilMass;out[b]+=mass-soilMass;
  }
  return out;
}
export const sandTrace=(x,z,pixel=0)=>.018*(soilNoise(x/.18+2*soilNoise(x/1.7,z/1.7),z/.85)-.5)*2*(1-smooth(.04,.18,pixel));
// Exact integer FBM used by grassColony (seed 1333); no new density map or sampler.
export const GROUND8_GLSL=`
uniform float uGround8,uGround8Fine;
float ground8Expose=0.0,ground8Sand=0.0;
uint ground8Hash(ivec2 p,uint seed){
  uint h=uint(p.x)*374761393u+uint(p.y)*668265263u+seed*2246822519u;
  h=(h^(h>>13u))*1274126177u;return h^(h>>16u);
}
float ground8Noise(vec2 p,uint seed){
  ivec2 i=ivec2(floor(p));vec2 f=fract(p);f=f*f*(3.0-2.0*f);
  return mix(mix(float(ground8Hash(i,seed)),float(ground8Hash(i+ivec2(1,0),seed)),f.x),
    mix(float(ground8Hash(i+ivec2(0,1),seed)),float(ground8Hash(i+ivec2(1,1),seed)),f.x),f.y)/4294967296.0;
}
float ground8Fbm(vec2 p,uint seed){return ((ground8Noise(p,seed)*2.0-1.0)*.5+(ground8Noise(p*2.03,seed+17u)*2.0-1.0)*.25)/.75;}
float ground8Colony(vec2 p){return clamp(.5+1.5*ground8Fbm(p/12.0,2144u)+.5*ground8Fbm(p/3.0,2154u),0.0,1.0);}
float ground8Mask(vec2 p,float offset,float px){
  float n=(2.0*toneNoise(p/8.0+vec2(19,-37)+offset)+toneNoise(p/4.0+vec2(-43,71)+offset))/3.0;
  return smoothstep(.49,.53,n)*(1.0-smoothstep(1.5,4.0,px));
}
float ground8Island(vec2 p){
  vec2 cell=floor(p/2.4),v=fract(p/2.4)-.5;
  float a=toneHash(cell+vec2(137,-53)),b=toneHash(cell+vec2(-61,97));
  float radius=length(v/vec2(.14+.24*a,.14+.24*b));
  return 1.0-smoothstep(.65+.12*toneNoise(p/.35),1.0,radius);
}
void ground8Weights(inout float w[7],vec2 p,float dist,float avoid,float px){
  float amount=uGround8*(1.0-avoid)*(1.0-smoothstep(60.0,200.0,dist));
  if(amount<=0.0)return;
  float gate=ground8Mask(p,0.0,px),partner=0.0;
  if(uGround8Fine>.5)partner=ground8Mask(p,113.0,px);
  if(uGround8Fine>.5 && w[2]>.001 && px<1.0){
    float sparse=1.0-smoothstep(.35,.55,ground8Colony(p));
    ground8Expose=.30*w[2]*sparse*ground8Island(p)
      *(1.0-smoothstep(.3,1.0,px));
  }
  float old[7];for(int i=0;i<7;i++)old[i]=w[i];
  ${MOSAIC_PAIRS.map(([from,a,b])=>`${from===5||from===6?'':'if(uGround8Fine>.5)'}{
    float mass=old[${from}]*${from===2?'min(.6,max(.6*gate,ground8Expose/max(.00001,old[2])) )':'.6*gate'}*amount;
    float toA=${from===2?'max(mass*(1.0-partner),ground8Expose*amount)':'mass*(1.0-partner)'};
    w[${from}]-=mass;w[${a}]+=toA;w[${b}]+=mass-toA;
  }`).join('\n')}
  ground8Expose*=amount;
  ground8Sand=old[0]*amount;
}
vec3 ground8Color(vec3 color,vec2 p,float px){
  // Dry-earth hue from the existing palette at constant luminance; GD4 is excluded above.
  if(ground8Expose>0.0){
    float L=dot(color,vec3(.2126,.7152,.0722));
    vec3 earth=color*vec3(1.12,.98,.80);
    earth*=L/max(.00001,dot(earth,vec3(.2126,.7152,.0722)));
    color=mix(color,earth,ground8Expose*groundPhotoAmount);
  }
  if(uGround8Fine>.5 && ground8Sand>0.0 && px<.18){
    float bend=2.0*toneNoise(p/1.7);
    float trace=(toneNoise(vec2(p.x/.18+bend,p.y/.85))-.5)*2.0;
    color*=1.0+.018*trace*(1.0-smoothstep(.04,.18,px))*ground8Sand*groundPhotoAmount;
  }
  return color;
}
`;
