import { soilNoise, smooth } from './kamakura-ground-pattern.js';
// W2c-11 ground6: flat turf -> three zero-centred, world-anchored value-noise bands.
export const TURF_BANDS=Object.freeze([[.35,.2],[1.4,.35],[5.5,.45]].map(Object.freeze));
export function turfSignal(x,z,pixel=0,fine=true,dist=0) {
  let n=0;
  for(let i=fine?0:1;i<3;i++){
    const [scale,weight]=TURF_BANDS[i];
    n+=(soilNoise(x/scale+31*i,z/scale-47*i)*2-1)*weight*(1-smooth(scale*.35,scale,pixel));
  }
  return n*(1-smooth(200,600,dist));
}
export const turfBrightness=(x,z,pixel=0,fine=true,dist=0)=>1+.1*turfSignal(x,z,pixel,fine,dist);
export function turfColor(color,x,z,{pixel=0,fine=true,dist=0,dry=.5,weight=1,strength=1}={}) {
  const n=turfSignal(x,z,pixel,fine,dist),luma=color[0]*.2126+color[1]*.7152+color[2]*.0722;
  const hue=.03*Math.max(-1,Math.min(1,n+dry-.5))*weight*strength*(1-smooth(200,600,dist));
  return color.map((v,i)=>v*(1+.1*n*weight*strength)+luma*[1,-.2972595078,0][i]*hue);
}
export const GROUND6_GLSL=`
uniform sampler2D uGroundContact;
uniform vec2 uGroundContactOrigin,uGroundClassSize;
uniform float uGround6,uGround6Fine;
// Reuse the existing class sampler as a two-layer atlas: still 15 ground samplers + sun shadow.
vec4 ground6Class(vec2 uv,float layer){
  uv=clamp(uv,.5/uGroundClassSize,1.0-.5/uGroundClassSize);
  return textureLod(uGroundPhotoA,vec2(uv.x,(uv.y+layer)*.5),0.0);
}
float ground6Turf(vec2 p,float px,float dist){
  float n=0.0;
  if(uGround6Fine>.5 && px<.35)n=(toneNoise(p/.35)-.5)*2.0*.2*(1.0-smoothstep(.1225,.35,px));
  if(px<1.4)n+=(toneNoise(p/1.4+vec2(31,-47))-.5)*2.0*.35*(1.0-smoothstep(.49,1.4,px));
  if(px<5.5)n+=(toneNoise(p/5.5+vec2(62,-94))-.5)*2.0*.45*(1.0-smoothstep(1.925,5.5,px));
  return n*(1.0-smoothstep(200.0,600.0,dist));
}
vec3 ground6Color(vec3 color,vec2 p,float dist,float px,float turf,float dry){
  if(dist>=600.0 || uGround6<=0.0)return color;
  float n=ground6Turf(p,px,dist);
  // Luminance-neutral yellow/green axis; dry biases hue, never brightness.
  vec3 chroma=vec3(1.0,-.2972595078,0.0);
  float luminance=dot(color,vec3(.2126,.7152,.0722));
  color=color*(1.0+.1*n*turf*uGround6)+luminance*chroma*.03*clamp(n+dry-.5,-1.0,1.0)*turf*uGround6*(1.0-smoothstep(200.0,600.0,dist));
  if(dist>=80.0)return color;
  vec2 uv=(p-uGroundContactOrigin)/128.0;
  // Half-texel guard fades to neutral before clamping can stretch the window edge.
  float border=min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y));
  if(border<=0.0)return color;
  float support=smoothstep(0.0,.00390625,border)*(1.0-smoothstep(45.0,80.0,dist));
  float ao=textureLod(uGroundContact,clamp(uv,0.0,1.0),0.0).r;
  float root=(1.0-ao)/.55*support*uGround6;
  // Root dirt warms the local albedo; retain the existing photographic modulation.
  vec3 earth=color*vec3(1.0,.80,.62);
  color=mix(color,earth,.15*root);
  return color*mix(1.0,ao,support*uGround6);
}
`;
