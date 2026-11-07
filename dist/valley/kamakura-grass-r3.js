// W2c-9r3 grass: carpet -> coast succession with open sand between colonies.
import { grassColony } from './kamakura-grass-look.js';
import { shoreNoise, SEA_VIS } from './kamakura-shore.js';
const smooth=(a,b,v)=>{const t=Math.max(0,Math.min(1,(v-a)/(b-a)));return t*t*(3-2*t);};
export const grassR3Enabled=search=>new URLSearchParams(search).get('grass3')!=='0';
export function coastalGrassAt(x,z,distance,refuge=0,crest=0){
  const edge=8*(shoreNoise(x/19,z/19)-.5)+3*(shoreNoise(x/5,z/5)-.5);
  const succession=.06+.94*smooth(12,65,distance+edge);
  const colony=smooth(.32,.78,grassColony(x*.75,z*.75)+.12*smooth(0,.4,crest));
  const gaps=smooth(.25,.65,shoreNoise(x/23,z/23));
  return smooth(SEA_VIS.reach+1,26,distance)*Math.max(refuge,2.4*colony*succession*(.12+.88*gaps));
}
// W2c-9r3 grass: narrow 11m fade with ±2m contour -> 20m fade with ±6m contour.
export const nearGrassR3Offset=(x,z)=>8*(shoreNoise(x/17,z/17)-.5)+4*(shoreNoise(x/5,z/5)-.5);
export const nearGrassR3DensityAt=(x,z,d)=>{d+=nearGrassR3Offset(x,z);return (1-smooth(6,26,d))*(1-.98*smooth(0,24,d));};
export const GRASS_R3_NEAR_GLSL=`
float grassBandOffset(vec2 p){return 8.0*(grassBandNoise(p/17.0)-.5)+4.0*(grassBandNoise(p/5.0)-.5);}
float nearGrassDensity(float d){return (1.0-smoothstep(6.0,26.0,d))*(1.0-.98*smoothstep(0.0,24.0,d));}
`;
// W2c-9r3 grass fix: 6% emissive / 35% sky -> 30% emissive / full sky.
// Ground Lambert leaves indirect light unshadowed; do not shadow it a second time.
export const GRASS_SHADOW_EMISSIVE_FLOOR=.30;
export const grassShadowFactors=visibility=>({emissive:GRASS_SHADOW_EMISSIVE_FLOOR+(1-GRASS_SHADOW_EMISSIVE_FLOOR)*visibility,indirect:1});
