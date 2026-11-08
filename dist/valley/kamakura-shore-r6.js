// W2c-11 shore6: straight rims / parallel ripples -> metre-based broken banks and two oblique layers.
import { shoreNoise } from './kamakura-shore.js';
import { shore4Enabled } from './kamakura-shore-r4.js';
export const shore6Enabled=search=>shore4Enabled(search)&&new URLSearchParams(search).get('shore6')!=='0';
const clamp=v=>Math.max(0,Math.min(1,v));
const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export const FLOW_LAYERS6=Object.freeze([{angle:20,spacing:.65,speed:1},{angle:-20,spacing:1.3,speed:.72}].map(Object.freeze));
export const edgeOffset6=(x,z)=>.3*(2*shoreNoise(x/3.7,z/3.7)-1);
export const edgeWidth6=(x,z)=>.15+.25*shoreNoise(x/6.1+9,z/6.1+9);
export const edgeAlpha6=(d,x,z)=>smooth(0,edgeWidth6(x,z),d+edgeOffset6(x,z));
export const bankWidth6=(slope,speed,n)=>.4+.6*(1-clamp(slope))*(.7+.3*clamp(Math.abs(speed)/.7))*(.7+.3*n);
export const bankDark6=n=>.65+.1*n;
export const riverDepth6=(depth,bank)=>smooth(0,1,Math.max(0,Math.min(depth/.9,bank/2.4)));
export const seaDepth6=d=>smooth(2,36,d);
export function riverHeight6(across,along,time,speed,x,z){
  let h=0;
  for(let i=0;i<2;i++){
    const l=FLOW_LAYERS6[i],a=l.angle*Math.PI/180,y=along-time*speed*l.speed;
    const u=(across*Math.cos(a)+y*Math.sin(a))/l.spacing,v=(y*Math.cos(a)-across*Math.sin(a))/(l.spacing*3);
    h+=(i?.65:1)*(.35+.65*shoreNoise(x/16+i*11,z/16+i*11))*(shoreNoise(u,v)-.5);
  }return h;
}
// V points from surface to eye. No horizontal back-facing sun response; linear addition <= .65.
export function seaGlint6(v,n,sun){
  const dot=(a,b)=>a.reduce((s,x,i)=>s+x*b[i],0),cos=dot(v,n),r=n.map((x,i)=>2*cos*x-v[i]);
  const facing=Math.max(0,(sun[0]*-v[0]+sun[2]*-v[2])/Math.max(.0001,Math.hypot(sun[0],sun[2])*Math.hypot(v[0],v[2])));
  const a=Math.max(0,dot(r,sun)),evening=1-smooth(.15,.65,sun[1]);
  return Math.min(.65,facing**12*(a**96*.5+a**18*.22)*(.12+.88*evening)*(1-Math.abs(v[1]))**2);
}
export const SHORE_R6_GLSL=`
uniform float uShore6;
float edgeOffset6(vec2 p){return .3*(2.0*shoreNoise(p/3.7)-1.0);}
float edgeWidth6(vec2 p){return .15+.25*shoreNoise(p/6.1+9.0);}
float edgeAlpha6(float d,vec2 p){return smoothstep(0.0,edgeWidth6(p),d+edgeOffset6(p));}
float bankWidth6(float slope,float speed,float n){return .4+.6*(1.0-clamp(slope,0.0,1.0))*(.7+.3*clamp(abs(speed)/.7,0.0,1.0))*(.7+.3*n);}
float bankDark6(float n){return .65+.1*n;}
float riverDepth6(float depth,float bank){return smoothstep(0.0,1.0,max(0.0,min(depth/.9,bank/2.4)));}
float seaDepth6(float d){return smoothstep(2.0,36.0,d);}
float riverHeight6(vec2 p,float time,float speed,vec2 gain){
  float y=p.y-time*speed;
  vec2 a=vec2(p.x*.93969262+y*.34202014,y*.93969262-p.x*.34202014)/vec2(.65,1.95);
  y=p.y-time*speed*.72;
  vec2 b=vec2(p.x*.93969262-y*.34202014,y*.93969262+p.x*.34202014)/vec2(1.3,3.9);
  return gain.x*(shoreNoise(a)-.5)+gain.y*(shoreNoise(b)-.5);
}
float riverFoam6(float d,vec2 p,float time,float footprint,float turn,float across){
  float offset=edgeOffset6(p),width=max(.12,footprint);
  float centre=.26+.12*shoreNoise(p/2.9);
  float body=(1.0-smoothstep(width,width+max(.15,footprint),abs(d+offset-centre)))*(.12/max(.12,footprint));
  float gaps=smoothstep(.38,.7,shoreNoise(p/2.1+vec2(time*.07,0.0)));
  float outer=max(0.0,-sign(turn)*across)*smoothstep(.015,.25,abs(turn));
  return body*gaps*(.12+.65*outer);
}
float surf6(float d,float wave,vec2 p,float band,float footprint){
  float n=shoreNoise(p/9.0+band),core=.28+.65*n;
  float centre=.8+band+2.2*(1.0-wave)+1.4*(shoreNoise(p/17.0+band)-.5);
  float width=max(core,footprint);
  float body=1.0-smoothstep(width,width+max(.3,footprint),abs(d-centre));
  return body*(core/width)*smoothstep(.25,.65,shoreNoise(p/6.0+band))*(1.0-smoothstep(24.0,40.0,d));
}
float seaGlint6(vec3 v,vec3 n,vec3 sun){
  vec3 r=reflect(-v,n);
  float facing=max(0.0,dot(-v.xz,sun.xz)/max(.0001,length(v.xz)*length(sun.xz)));
  float a=max(0.0,dot(r,sun)),evening=1.0-smoothstep(.15,.65,sun.y);
  return min(.65,pow(facing,12.0)*(pow(a,96.0)*.5+pow(a,18.0)*.22)*(.12+.88*evening)*pow(1.0-abs(v.y),2.0));
}
`;
