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
`;
