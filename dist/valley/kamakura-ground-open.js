import { soilNoise, smooth } from './kamakura-ground-pattern.js';
// W2c-12 GD5: add broad ecological variation, replacing GD2's turf band on open land.
export function openSignal(x,z,{fine=true,dist=0,pixel=0}={}) {
  let n=(soilNoise(x/55+19,z/55-37)*2-1)*(fine?.35:.8)*(1-smooth(19.25,55,pixel));
  if(fine){
    n+=(soilNoise(x/18-43,z/18+71)*2-1)*.35*(1-smooth(6.3,18,pixel));
    n+=(soilNoise(x/7+23,z/7-59)*2-1)*.60*(1-smooth(2.45,7,pixel));
    n+=(soilNoise(x/2.8-17,z/2.8+41)*2-1)*.60*(1-smooth(.98,2.8,pixel));
  }
  // R6 parent tuning: a view only spans ~30m, so 55/18m bands read as a tint. The 7 and 2.8m bands give
  // visible patches; tanh keeps the +-1 bound with a readable contrast. GD2 keeps its own 0.35-5.5m turf bands.
  return Math.tanh(2*n)*(1-smooth(180,600,dist))||0;
}
export const terrainDry=(sunSide,elevation,convex,north)=>Math.max(-1,Math.min(1,.35*sunSide+.25*elevation+.25*convex-.15*north));
export function openBrightness(x,z,options={}) {return 1+(.12*openSignal(x,z,options)+.015*(options.dry||0)*(1-smooth(180,600,options.dist||0)));}
export const GROUND7_GLSL=`
uniform float uGround7,uGround7Fine;
uniform vec2 uGroundPathOrigin;
float ground7PathWeight=0.0,ground7Avoid=0.0,ground7Water=0.0;
float ground7Path(vec2 p,float dist){
  if(uGround7<=0.0 || dist>=90.0)return 0.0;
  vec2 uv=(p-uGroundPathOrigin)/128.0;
  float border=min(min(uv.x,uv.y),min(1.0-uv.x,1.0-uv.y));
  if(border<=0.0)return 0.0;
  ground7Water=textureLod(uGroundContact,vec2(clamp(uv.x,.001953125,.998046875),(2.0+clamp(uv.y,.001953125,.998046875))/3.0),0.0).r;
  return (1.0-ground7Water)*textureLod(uGroundContact,vec2(clamp(uv.x,.001953125,.998046875),(1.0+clamp(uv.y,.001953125,.998046875))/3.0),0.0).r
    *smoothstep(0.0,.00390625,border)*(1.0-smoothstep(55.0,90.0,dist))*uGround7;
}
float ground7Signal(vec2 p,float px,float dist){
  float n=(toneNoise(p/55.0+vec2(19,-37))*2.0-1.0)*(uGround7Fine>.5?.35:.8)*(1.0-smoothstep(19.25,55.0,px));
  if(uGround7Fine>.5){
    n+=(toneNoise(p/18.0+vec2(-43,71))*2.0-1.0)*.35*(1.0-smoothstep(6.3,18.0,px));
    n+=(toneNoise(p/7.0+vec2(23,-59))*2.0-1.0)*.60*(1.0-smoothstep(2.45,7.0,px));
    n+=(toneNoise(p/2.8+vec2(-17,41))*2.0-1.0)*.60*(1.0-smoothstep(.98,2.8,px));
  }
  return tanh(2.0*n)*(1.0-smoothstep(180.0,600.0,dist));
}
vec3 ground7Color(vec3 color,vec3 world,vec3 facing,float cavity,float dry,float dist,float px,float land){
  if(uGround7<=0.0)return color;
  float luminance=dot(color,vec3(.2126,.7152,.0722));
  // Derive dry earth from the existing palette, desaturate, and preserve its luminance exactly.
  vec3 earth=mix(color*vec3(1.12,.98,.80),vec3(luminance),.18);
  earth*=luminance/max(.00001,dot(earth,vec3(.2126,.7152,.0722)));
  color=mix(color,earth,.45*ground7PathWeight);
  if(land<=0.0 || dist>=600.0)return color;
  vec3 sun=vec3(0.0,1.0,0.0);
  #if NUM_DIR_LIGHTS > 0
    vec3 sunView=directionalLights[0].direction;
    sun=vec3(dot(viewMatrix[0].xyz,sunView),dot(viewMatrix[1].xyz,sunView),dot(viewMatrix[2].xyz,sunView));
  #endif
  float sunSide=clamp((dot(facing,sun)-sun.y)*2.0,-1.0,1.0);
  float bias=clamp(.35*sunSide+.25*(dry*2.0-1.0)-.25*cavity-.15*clamp(-facing.z,-1.0,1.0),-1.0,1.0);
  float fade=1.0-smoothstep(180.0,600.0,dist);
  float n=ground7Signal(world.xz,px,dist),amount=land*(1.0-ground7Avoid)*uGround7;
  // Separate zero-mean broad brightness from the small terrain bias; never double GD2 on these pixels.
  color*=1.0+amount*(.12*n+.015*bias*fade);
  vec3 chroma=vec3(1.0,-.1963087248,-1.0);
  color+=luminance*chroma*.04*clamp(n+bias,-1.0,1.0)*amount*fade;
  return color;
}
`;
// CPU colour references for luminance/bounds checks; no renderer, clock or private inputs.
export function packedEarthColor(color,weight=1) {
  const luma=c=>c[0]*.2126+c[1]*.7152+c[2]*.0722,L=luma(color);
  const earth=color.map((v,i)=>v*[1.12,.98,.80][i]*.82+L*.18),scale=L/Math.max(.00001,luma(earth));
  return color.map((v,i)=>v+(earth[i]*scale-v)*.45*weight);
}
export function openColor(color,x,z,options={}) {
  const L=color[0]*.2126+color[1]*.7152+color[2]*.0722,n=openSignal(x,z,options);
  const fade=1-smooth(180,600,options.dist||0),h=.04*Math.max(-1,Math.min(1,n+(options.dry||0)))*fade;
  const b=openBrightness(x,z,options);
  return color.map((v,i)=>v*b+L*[1,-.1963087248,-1][i]*h);
}
