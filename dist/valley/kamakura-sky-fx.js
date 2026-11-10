import { MIST_GLSL } from './kamakura-mist.js';
// R10: pure light policy and matching CPU/GLSL cloud field. No world data is retained.
export const LIGHT_TIMES = Object.freeze({
  noon: Object.freeze({ shafts: .15, cloud: .30 }),
  morning: Object.freeze({ shafts: .5, cloud: .25 }),
  golden: Object.freeze({ shafts: .6, cloud: .25 }),
  evening: Object.freeze({ shafts: .7, cloud: .12 }),
});
// gain 1: a cloud core takes the time-of-day strength off sunlit ground (noon .30). At .18 no cloud could be seen (real Chrome).
// low/high are wide apart so an edge takes a few hundred metres to fade; the third octave is weak or the edge turns into specks.
export const CLOUD = Object.freeze({ height: 700, scale: 520, speed: 10, low: .46, high: .80, gain: 1, octaves: Object.freeze([.62, .28, .10]) });
// How strongly the shafts are added (linear light, before the tone map), their cap, and how wide they reach around the sun.
export const SHAFT = Object.freeze({ gain: 1.05, cap: .6, reach: .45, sky: .4, source: .35 });
// High-altitude multiplier: metres above local terrain, smooth transition.
export const CLOUD_HIGH = Object.freeze({ low:250, high:750, scale:3, strength:.45 });
export function cloudHigh(height, enabled, out) {
  const t=enabled ? smooth(CLOUD_HIGH.low,CLOUD_HIGH.high,height) : 0;
  out.height=height; out.scale=1+(CLOUD_HIGH.scale-1)*t; out.strength=(1-t)+CLOUD_HIGH.strength*t;
  return out;
}
export const SHAFT_TAPS = 24;
const clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export function lightSettings(time) { return Object.hasOwn(LIGHT_TIMES,time) ? LIGHT_TIMES[time] : LIGHT_TIMES.noon; }
export function shaftVisibility(x, y, strength) {
  // The sun may sit a little outside the frame (rays still enter from the edge); strength already fades beyond the edge.
  return strength * smooth(-.25, -.05, Math.min(x, y, 1-x, 1-y));
}
export function cloudShadeWeight(luminance) { return smooth(.08, .65, luminance); }
export function cloudAttenuation(density, strength, luminance) {
  return density * strength * CLOUD.gain * cloudShadeWeight(luminance);
}
export function advanceCloudTime(time, elapsedMs) { return time + Math.max(0, Math.min(.1, elapsedMs/1000)); }
const fract = x => x-Math.floor(x);
function hash(x,y) { return fract(Math.sin(x*127.1+y*311.7)*43758.5453); }
function noise(x,y) {
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const u=fx*fx*(3-2*fx), v=fy*fy*(3-2*fy);
  const a=hash(ix,iy), b=hash(ix+1,iy), c=hash(ix,iy+1), d=hash(ix+1,iy+1);
  return (a+(b-a)*u)*(1-v)+(c+(d-c)*u)*v;
}
// The field translates by +direction * 10m/s; sample at x+10*dt to follow a cloud.
export function cloudDensity(x, z, time, dirX = 1, dirZ = 0) {
  let px=(x-dirX*CLOUD.speed*time)/CLOUD.scale, pz=(z-dirZ*CLOUD.speed*time)/CLOUD.scale;
  const a=noise(px,pz);
  const qx=1.6*px-1.2*pz+17.1, qz=1.2*px+1.6*pz+9.2;
  px=1.6*qx-1.2*qz+17.1; pz=1.2*qx+1.6*qz+9.2;
  return smooth(CLOUD.low,CLOUD.high,a*CLOUD.octaves[0]+noise(qx,qz)*CLOUD.octaves[1]+noise(px,pz)*CLOUD.octaves[2]);
}
export const DEPTH_GLSL = `
uniform sampler2D depthTex;
uniform mat4 inverseProjection, cameraWorld;
uniform float viewFar;
bool kzSky(float depthValue) { return depthValue >= .9999999; }
vec3 kzViewPosition(vec2 uv, float depthValue) {
  vec4 pointView=inverseProjection*vec4(uv*2.-1.,depthValue*2.-1.,1.);
  return pointView.xyz/pointView.w;
}
vec3 kzWorldPosition(vec3 pointView) { return (cameraWorld*vec4(pointView,1.)).xyz; }
`;
export const CLOUD_GLSL = `
uniform vec3 lightDirection;
uniform vec2 cloudDirection;
uniform float cloudTime, cloudStrength;
float kzCloudHash(vec2 p) { return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453); }
float kzCloudNoise(vec2 p) {
  vec2 cell=floor(p), f=fract(p), u=f*f*(3.-2.*f);
  return mix(mix(kzCloudHash(cell),kzCloudHash(cell+vec2(1.,0.)),u.x),
    mix(kzCloudHash(cell+vec2(0.,1.)),kzCloudHash(cell+vec2(1.,1.)),u.x),u.y);
}
float kzCloudDensity(vec2 xz) {
  vec2 p=(xz-cloudDirection*${CLOUD.speed.toFixed(1)}*cloudTime)/${CLOUD.scale.toFixed(1)};
  float density=kzCloudNoise(p)*${CLOUD.octaves[0].toFixed(2)};
  p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(17.1,9.2); density+=kzCloudNoise(p)*${CLOUD.octaves[1].toFixed(2)};
  p=mat2(1.6,1.2,-1.2,1.6)*p+vec2(17.1,9.2); density+=kzCloudNoise(p)*${CLOUD.octaves[2].toFixed(2)};
  return smoothstep(${CLOUD.low.toFixed(2)},${CLOUD.high.toFixed(2)},density);
}
float kzCloudAmount(vec3 pointWorld, vec3 colorValue) {
  vec2 cloudXZ=pointWorld.xz+lightDirection.xz*((${CLOUD.height.toFixed(1)}-pointWorld.y)/max(.08,lightDirection.y));
  float lum=dot(colorValue,vec3(.2126,.7152,.0722));
  return kzCloudDensity(cloudXZ)*cloudStrength*${CLOUD.gain.toFixed(2)}*smoothstep(.08,.65,lum);
}
`;
export const SHAFT_SHADERS = {
  mask: `varying vec2 vUv; uniform sampler2D depthTex; uniform vec2 sunUV, depthPixel; uniform float aspect;
    float skyAt(vec2 uv){ return step(.9999999,texture2D(depthTex,uv).x); }
    void main(){
      vec2 d=(vUv-sunUV)*vec2(aspect,1.);
      float openSky=(skyAt(vUv+depthPixel*vec2(-.5,-.5))+skyAt(vUv+depthPixel*vec2(.5,-.5))+
        skyAt(vUv+depthPixel*vec2(-.5,.5))+skyAt(vUv+depthPixel*vec2(.5,.5)))*.25;
      gl_FragColor=vec4(vec3(openSky*exp(-dot(d,d)/${SHAFT.source.toFixed(2)})),1.);
    }`,
  radial: `varying vec2 vUv; uniform sampler2D maskTex; uniform vec2 sunUV;
    void main(){
      // Spatially fixed sub-step jitter avoids 24 coherent bands, with no temporal shimmer.
      float jitter=fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
      vec2 stride=(sunUV-vUv)/${SHAFT_TAPS.toFixed(1)};
      vec2 uv=vUv+stride*jitter;
      float ray=0., weight=1., totalWeight=0.;
      for(int i=0;i<${SHAFT_TAPS};i++){
        ray+=texture2D(maskTex,uv).r*weight; totalWeight+=weight; weight*=.96; uv+=stride;
      }
      gl_FragColor=vec4(vec3(ray/totalWeight),1.);
    }`,
};
// Keep the disabled final program byte-for-byte identical to the shipped R9 program.
export function lightFinalShader(legacy, options) {
  if (!options.shafts && !options.cloud && !options.mist && !options.postdebug) return legacy;
  if (!legacy.includes('void main(){') || !legacy.includes('if(bloomStrength>0.)')) throw Error('Post composite shader boundary missing');
  const depth=options.shafts || options.cloud || options.mist;
  const mode=options.postdebug;
  const declarations=(depth ? DEPTH_GLSL : '')+(options.cloud ? (options.cloudhigh ? CLOUD_GLSL.replace('cloudTime, cloudStrength;', 'cloudTime, cloudStrength, cloudScale;').replace('/'+CLOUD.scale.toFixed(1)+';', '/('+CLOUD.scale.toFixed(1)+'*cloudScale);') : CLOUD_GLSL) : '')+(options.mist ? MIST_GLSL : '')+
    (options.shafts ? '\nuniform sampler2D shaftTex; uniform float shaftStrength;\n' : '');
  let start='';
  if(depth) start+=`float depthValue=texture2D(depthTex,vUv).x; bool skyPixel=kzSky(depthValue);
    vec3 pointView=kzViewPosition(vUv,depthValue);`;
  if(mode==='depth') start+=depth ? 'gl_FragColor=vec4(vec3(skyPixel?1.:clamp(length(pointView)/viewFar,0.,1.)),1.); return;' : 'gl_FragColor=vec4(0.,0.,0.,1.); return;';
  if(mode==='shafts') start+=options.shafts ? 'gl_FragColor=vec4(vec3(shaftStrength>0.?texture2D(shaftTex,vUv).r*shaftStrength:0.),1.); return;' : 'gl_FragColor=vec4(0.,0.,0.,1.); return;';
  if(mode==='valley') start+=options.mist ? 'gl_FragColor=vec4(vec3(skyPixel?0.:kzValley(kzWorldPosition(pointView).xz).r),1.); return;' : 'gl_FragColor=vec4(0.,0.,0.,1.); return;';
  const cloud=options.cloud ? 'float cloudAmount=skyPixel?0.:kzCloudAmount(kzWorldPosition(pointView),c);' : '';
  const mist=options.mist ? 'float mistAmount=skyPixel?0.:kzMistAmount(kzWorldPosition(pointView));' : '';
  const effect=cloud+(mode==='cloud' ? `gl_FragColor=vec4(vec3(${options.cloud ? '1.-cloudAmount' : '1.'}),1.); return;` : '')+
    (options.cloud ? 'c*=vec3(1.-cloudAmount*1.03,1.-cloudAmount,1.-cloudAmount*.82);' : '')+
    mist+(mode==='mist' ? `gl_FragColor=vec4(vec3(${options.mist ? 'mistAmount' : '0.'}),1.); return;` : '')+
    (options.mist ? 'if(mistAmount>0.) c=mix(c,kzMistColor(kzWorldPosition(pointView)),mistAmount);' : '')+
    (options.shafts ? `vec2 rayDelta=(vUv-sunUV)*vec2(aspect,1.);
      if(shaftStrength>0.) c+=sunColor*min(${SHAFT.cap.toFixed(2)},texture2D(shaftTex,vUv).r*shaftStrength*${SHAFT.gain.toFixed(2)})*exp(-dot(rayDelta,rayDelta)/${SHAFT.reach.toFixed(2)})*(skyPixel?${SHAFT.sky.toFixed(2)}:1.);` : '');
  return declarations+legacy.replace('void main(){','void main(){'+start)
    .replace('if(bloomStrength>0.)',effect+'\n      if(bloomStrength>0.)');
}
