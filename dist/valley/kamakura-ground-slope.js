import { soilNoise, smooth } from './kamakura-ground-pattern.js';
const clamp=v=>Math.max(-1,Math.min(1,v));
// W2c-13 SL1: leave existing detail intact; add independent 4/12/40 m ecological bands.
export function slopeSignal(x,z,{fine=true,pixel=0}={}){
  let n=(soilNoise(x/40+61,z/40-83)-soilNoise(x/40+61.5,z/40-82.5))*.25*(1-smooth(14,40,pixel));
  if(fine){
    n+=(soilNoise(x/12-31,z/12+47)-soilNoise(x/12-30.5,z/12+47.5))*.4*(1-smooth(4.2,12,pixel));
    n+=(soilNoise(x/4+17,z/4-29)-soilNoise(x/4+17.5,z/4-28.5))*1.8*(1-smooth(1.4,4,pixel));
  }
  return Math.tanh(1.65*n)||0;
}
export function slopeWeights(signal,{sun=0,convex=0,north=0,steep=0}={}){
  const bias=clamp(.35*sun+.3*convex-.25*north+.1*steep),clay=Math.max(0,Math.min(1,.5+.45*signal+.18*bias));
  const moss=(1-clay)*Math.max(0,Math.min(1,.5+.25*north-.25*convex));
  return {clay,moss,humus:1-clay-moss,bias};
}
export function slopeEnvelope(ny){
  // smooth() requires increasing bounds; normal Y decreases as the angle rises.
  return (1-smooth(Math.cos(20*Math.PI/180),Math.cos(15*Math.PI/180),ny))*smooth(Math.cos(45*Math.PI/180),Math.cos(40*Math.PI/180),ny);
}
export function slopeColor(color,x,z,{normalY=Math.cos(Math.PI/6),dist=0,strength=1,...options}={}){
  const n=slopeSignal(x,z,options),w=slopeWeights(n,{...options,steep:(1-normalY)/(1-Math.SQRT1_2)}),amount=slopeEnvelope(normalY)*(1-smooth(180,600,dist))*strength;
  const L=color[0]*.2126+color[1]*.7152+color[2]*.0722;
  // R7 parent tuning: the first strengths (0.1/0.08/0.04) gave a +-2% screen change; x3 reads on a slope.
  const gain=clamp(n+.1*w.bias)*.3,ochre=(w.clay-.5)*.2,green=(w.moss-w.humus)*.1;
  const hue=Math.max(-.12,Math.min(.12,ochre-green));
  return color.map((v,i)=>v*(1+gain*amount)+L*[1,-.1963087248,-1][i]*hue*amount);
}
export const farAmount=dist=>smooth(300,3000,dist);
export function forestColor(color,density,dist,strength=1){
  const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
  const forest=[0x31,0x40,0x2a].map(v=>linear(v/255)),a=.4*Math.max(0,Math.min(1,density))*farAmount(dist)*strength;
  return color.map((v,i)=>v+(forest[i]-v)*a);
}
// Airlight is applied to linear outgoing light, before tone mapping and the existing fog.
// Limit the total saturation loss of this addition to 25%, including the fog mix.
export function slopeHaze(color,fog,dist,strength=1){
  const a=farAmount(dist)*strength;if(a===0)return color.slice();
  const sat=c=>(Math.max(...c)-Math.min(...c))/Math.max(.00001,Math.max(...c));
  const before=sat(color),out=color.map((v,i)=>v+(fog[i]-v)*.35*a);
  const L=out[0]*.2126+out[1]*.7152+out[2]*.0722,hi=Math.max(...out),lo=Math.min(...out);
  const target=Math.max(before*(1-.25*a),Math.min(before,sat(out)));
  const k=target*L/Math.max(.00001,hi-lo-target*(hi-L));
  return out.map(v=>L+(v-L)*k);
}
export const SLOPE7_GLSL=`
uniform float uSlope7,uSlope7Fine;
// Parent: no far haze or forest tint from the overview/flight altitudes; they wash the whole map pale.
float slope7Far(float dist){return smoothstep(300.0,3000.0,dist)*uSlope7*uPhotoBlend*uGroundPhotoEnabled*(1.0-smoothstep(300.0,900.0,cameraPosition.y));}
float slope7Signal(vec2 p,float px){
  float n=(toneNoise(p/40.0+vec2(61,-83))-toneNoise(p/40.0+vec2(61.5,-82.5)))*.25*(1.0-smoothstep(14.0,40.0,px));
  if(uSlope7Fine>.5){
    n+=(toneNoise(p/12.0+vec2(-31,47))-toneNoise(p/12.0+vec2(-30.5,47.5)))*.4*(1.0-smoothstep(4.2,12.0,px));
    n+=(toneNoise(p/4.0+vec2(17,-29))-toneNoise(p/4.0+vec2(17.5,-28.5)))*1.8*(1.0-smoothstep(1.4,4.0,px));
  }
  return tanh(1.65*n);
}
vec3 slope7Color(vec3 color,vec3 world,vec3 facing,float ny,float cavity,float dist,float px,float land){
  if(uSlope7<=0.0 || dist>=600.0)return color;
  float band=(1.0-smoothstep(.939692621,.965925826,ny))*smoothstep(.707106781,.766044443,ny);
  if(band<=0.0)return color;
  vec3 sun=vec3(0,1,0);
  #if NUM_DIR_LIGHTS > 0
    vec3 sunView=directionalLights[0].direction;
    sun=vec3(dot(viewMatrix[0].xyz,sunView),dot(viewMatrix[1].xyz,sunView),dot(viewMatrix[2].xyz,sunView));
  #endif
  float north=clamp(-facing.z,-1.0,1.0),sunSide=clamp((dot(facing,sun)-sun.y)*2.0,-1.0,1.0);
  float bias=clamp(.35*sunSide-.3*cavity-.25*north+.1*(1.0-ny)/.292893219,-1.0,1.0);
  float n=slope7Signal(world.xz,px),clay=clamp(.5+.45*n+.18*bias,0.0,1.0);
  float moss=(1.0-clay)*clamp(.5+.25*north+.25*cavity,0.0,1.0),humus=1.0-clay-moss;
  float amount=band*land*(1.0-smoothstep(180.0,600.0,dist))*uSlope7*uPhotoBlend*uGroundPhotoEnabled;
  float L=dot(color,vec3(.2126,.7152,.0722));
  color*=1.0+.3*clamp(n+.1*bias,-1.0,1.0)*amount;
  float hue=clamp((clay-.5)*.2-(moss-humus)*.1,-.12,.12);
  color+=L*vec3(1,-.1963087248,-1)*hue*amount;
  return color;
}
vec3 slope7Forest(vec3 color,vec2 p,float dist){
  float a=slope7Far(dist);
  if(a<=0.0 || uToneBlend<=0.0)return color;
  float density=texture2D(uToneYard,p/uToneWeightSpan+.5).a*uToneBlend;
  return mix(color,vec3(.030713444,.051269458,.023153366),.4*density*a);
}
vec3 slope7Haze(vec3 color,vec3 fog,float dist){
  float a=slope7Far(dist);if(a<=0.0)return color;
  float hi=max(max(color.r,color.g),color.b),lo=min(min(color.r,color.g),color.b);
  float before=(hi-lo)/max(.00001,hi);
  vec3 air=mix(color,fog,.35*a);
  float L=dot(air,vec3(.2126,.7152,.0722));
  hi=max(max(air.r,air.g),air.b);lo=min(min(air.r,air.g),air.b);
  float target=clamp((hi-lo)/max(.00001,hi),before*(1.0-.25*a),before);
  float k=target*L/max(.00001,hi-lo-target*(hi-L));
  return vec3(L)+(air-vec3(L))*k;
}
`;
