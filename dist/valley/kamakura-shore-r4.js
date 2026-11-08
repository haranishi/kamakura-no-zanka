// W2c-10 shore4: world-axis drift / fixed pigment -> metre-based advection and sky-linked absorption.
import { shoreNoise } from './kamakura-shore.js';
export const shore4Enabled = search => new URLSearchParams(search).get('shore4') !== '0';
const clamp = v => Math.max(0, Math.min(1, v));
const smooth = (a,b,v) => { const t=clamp((v-a)/(b-a));return t*t*(3-2*t); };
export function riverFlow(ribbon, terrain) {
  const p=ribbon.positions,n=p.length-6;
  if(n<6)return {sign:1,slope:0,speed:.12,amplitude:.18};
  const x=(p[0]+p[3])/2,z=(p[2]+p[5])/2,ex=(p[n]+p[n+3])/2,ez=(p[n+2]+p[n+5])/2;
  const drop=terrain?terrain.heightAt(x,z)-terrain.heightAt(ex,ez):p[1]-p[n+1];
  const length=Math.max(1,ribbon.uvs.at(-1)-ribbon.uvs[1]),slope=Math.abs(drop)/length;
  return {sign:drop<0?-1:1,slope,speed:.12+Math.min(.9,Math.sqrt(slope)*2.2),amplitude:.18+Math.min(.5,Math.sqrt(slope)*1.2)};
}
export function flowVelocity(tx,tz,flow,across=0,out=[0,0]) {
  const speed=flow.sign*flow.speed*(1-.6*clamp(Math.abs(across))**2);
  out[0]=tx*speed;out[1]=tz*speed;return out;
}
// Same two value-noise components as riverHeight4; dominant correlation length ratio is 5.
export function riverHeight4(across,along,time,speed,edge=0,detail=1) {
  const y=along-time*speed*(1-.6*edge*edge);
  return shoreNoise(across*2,y*.4)+detail*.1*shoreNoise(across*3+y*.08,y*.65-across*.12);
}
export const waterFresnel4 = cosine => .02+.98*(1-clamp(Math.abs(cosine)))**5;
export function waterAlpha4(depth,bank=Infinity,cosine=1) {
  const d=Math.max(0,Math.min(depth,bank*.6));
  return (1-Math.exp(-1.1552453*d/Math.max(.35,Math.abs(cosine))))*(1-waterFresnel4(cosine)*.15);
}
export function riverColor4(depth,mid,horizon,out=[0,0,0]) {
  const d=Math.max(0,depth),t=[Math.exp(-2.4*d),Math.exp(-1.15*d),Math.exp(-.85*d)],pigment=[.02,.10,.12];
  for(let i=0;i<3;i++)out[i]=pigment[i]*(1-t[i])+(mid[i]*.35+horizon[i]*.65)*t[i]*.22;
  return out;
}
export function riverFoamGain4(speed,half,turn,across){return Math.max(.65,Math.min(1.8,.65+Math.abs(speed)/Math.max(1,half)*1.8+Math.max(0,-Math.sign(turn)*across)*Math.abs(turn)));}
export const SEA_BANDS4=Object.freeze([5,20,60,200]);
export const seaBand4=(distance,edge,footprint=0)=>smooth(edge-Math.max(edge*.35,footprint*2),edge+Math.max(edge*.35,footprint*2),distance);
export function seaColor4(distance,mid,horizon,footprint=0,out=[0,0,0]) {
  const sand=[.22,.21,.15],shallow=[.08,.18,.17],deep=[.025,.085,.12];
  for(let i=0;i<3;i++){
    let c=sand[i]+(shallow[i]-sand[i])*seaBand4(distance,5,footprint);
    c+=(deep[i]-c)*seaBand4(distance,20,footprint);
    c+=(mid[i]*.24-c)*seaBand4(distance,60,footprint);
    out[i]=c+(horizon[i]-c)*seaBand4(distance,200,footprint);
  }return out;
}
// W2c-10b shore5: continuous white rails -> shallow, energetic, broken foam.
export const FOAM_LINEAR_MAX5=.42;
export function riverFoam5(depth,slope,speed,bend){
  return (1-smooth(.12,.65,depth))*smooth(.08,.65,slope)*smooth(.14,.7,Math.abs(speed))*(.015+.985*smooth(.03,.4,Math.abs(bend)));
}
// 48m lattice: strength and spacing share broad stationary patches, not camera bands.
export const riverMacro5=(x,z)=>shoreNoise(x/48,z/48);
export const riverStreak5=(speed,across,macro)=>clamp(Math.abs(speed)/.22)*(1-.6*clamp(Math.abs(across))**2)*(.45+.55*macro);
export function riverColor5(depth,mid,horizon,out=[0,0,0]){
  riverColor4(depth,mid,horizon,out);
  const l=.2126*out[0]+.7152*out[1]+.0722*out[2];
  for(let i=0;i<3;i++)out[i]=l+(out[i]-l)*.75;
  return out;
}
// W2c-10b shore5: shallow top view stays transparent; grazing angles hold reflection.
export function waterOpacity5(depth,bank,cosine){
  const a=waterAlpha4(depth,bank,cosine),f=smooth(.02,.8,waterFresnel4(cosine));
  return a+(Math.max(a,.82)-a)*f;
}
// Full-strength core is >=2 pixels; the feather lies outside that core.
export const surfCore5=footprint=>Math.max(.22,Math.max(0,footprint));
export const SHORE_R4_GLSL=`
uniform float uShore4,uShore4Detail;
uniform vec3 uWaterSkyMid,uWaterSkyHorizon;
float waterFresnel4(float cosine){return .02+.98*pow(1.0-clamp(abs(cosine),0.0,1.0),5.0);}
float waterAlpha4(float depth,float bank,float cosine){float d=max(0.0,min(depth,bank*.6));return (1.0-exp(-1.1552453*d/max(.35,abs(cosine))))*(1.0-waterFresnel4(cosine)*.15);}
vec3 riverColor4(float depth){vec3 t=exp(-vec3(2.4,1.15,.85)*max(0.0,depth));return vec3(.02,.10,.12)*(1.0-t)+(uWaterSkyMid*.35+uWaterSkyHorizon*.65)*t*.22;}
float riverHeight4(vec2 p,float time,float speed,float edge){
  float y=p.y-time*speed*(1.0-.6*edge*edge);
  return shoreNoise(vec2(p.x*2.0,y*.4))+uShore4Detail*.1*shoreNoise(vec2(p.x*3.0+y*.08,y*.65-p.x*.12));
}
float riverFoamGain4(float speed,float halfWidth,float turn,float across){return clamp(.65+abs(speed)/max(1.0,halfWidth)*1.8+max(0.0,-sign(turn)*across)*abs(turn),.65,1.8);}
float seaBand4(float d,float edge,float footprint){float w=max(edge*.35,footprint*2.0);return smoothstep(edge-w,edge+w,d);}
vec3 seaColor4(float d,float footprint){
  vec3 c=mix(vec3(.22,.21,.15),vec3(.08,.18,.17),seaBand4(d,5.0,footprint));
  c=mix(c,vec3(.025,.085,.12),seaBand4(d,20.0,footprint));
  c=mix(c,uWaterSkyMid*.24,seaBand4(d,60.0,footprint));
  return mix(c,uWaterSkyHorizon,seaBand4(d,200.0,footprint));
}
float riverFoam5(float depth,float slope,float speed,float bend){
  return (1.0-smoothstep(.12,.65,depth))*smoothstep(.08,.65,slope)*smoothstep(.14,.7,abs(speed))*(.015+.985*smoothstep(.03,.4,abs(bend)));
}
float riverMacro5(vec2 p){return shoreNoise(p/48.0);}
float riverStreak5(float speed,float across,float broad){return clamp(abs(speed)/.22,0.0,1.0)*(1.0-.6*pow(clamp(abs(across),0.0,1.0),2.0))*(.45+.55*broad);}
vec3 riverColor5(float depth){vec3 c=riverColor4(depth);float l=dot(c,vec3(.2126,.7152,.0722));return mix(vec3(l),c,.75);}
float waterOpacity5(float depth,float bank,float cosine){float a=waterAlpha4(depth,bank,cosine);float f=smoothstep(.02,.8,waterFresnel4(cosine));return mix(a,max(a,.82),f);}
float surfCore5(float footprint){return max(.22,max(0.0,footprint));}
float shoreSurf5(float d,float wave,vec2 p,float band,float footprint){
  float n=shoreNoise(p/23.0+band);
  float centre=.6+band+2.0*(1.0-wave)+1.1*(n-.5);
  float core=surfCore5(footprint);
  float profile=1.0-smoothstep(core,core+max(.35,footprint),abs(d-centre));
  float gaps=.25+.75*smoothstep(.22,.62,shoreNoise(p/17.0+band));
  return profile*gaps*(1.0-smoothstep(24.0,40.0,d));
}
`;
