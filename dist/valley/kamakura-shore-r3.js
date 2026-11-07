// W2c-9r3 shore: grey wash / equal dashes -> chromatic depth and multiscale foam.
export const shore3Enabled=search=>{const q=new URLSearchParams(search);return q.get('shore2')!=='0'&&q.get('shore3')!=='0';};
const smooth=v=>{const t=Math.max(0,Math.min(1,v));return t*t*(3-2*t);};
export const FOAM_LINEAR_MAX=.69; // linear .69 -> sRGB .849 before tone mapping
export function riverWaterTone(bank,depth,out){
  const t=smooth(Math.min(Math.max(0,bank)/3,Math.max(0,depth)/.8));
  out[0]=.16+(.025-.16)*t;out[1]=.21+(.145-.21)*t;out[2]=.13+(.20-.13)*t;
  return Math.min(.85,.32+.53*t);
}
export const surfWetWidth=(reach,footprint=0)=>Math.max(Math.max(1.5,Math.min(4,reach*.45)),Math.min(120,Math.max(0,footprint)*24));
// Half-strength wet width alone spans >=12px (up to 5m/pixel), across oblique shores too.
export const surfFrontWidth=(noise,footprint=0)=>Math.max(.3+.7*noise,Math.min(48,Math.max(0,footprint)*2));
export const foamWidth3=(coarse,fine,bend=0,slope=0)=>.045+.95*coarse*coarse*(.35+.65*fine)*(1+.35*Math.min(1,Math.abs(bend))+.25*Math.min(1,Math.max(0,slope)));
export const foamGaps3=(coarse,fine)=>smooth((coarse*.65+fine*.35-.36)/.28);
export const SHORE_R3_GLSL=`
uniform float uShore3;
float surfWetWidth3(float reach,float footprint){return max(clamp(reach*.45,1.5,4.0),min(120.0,max(0.0,footprint)*24.0));}
float riverFoamWidth3(vec2 p,float bend,float slope){
  float coarse=shoreNoise(p/8.3+vec2(17.0,3.0)),fine=shoreNoise(p/1.7+vec2(4.0,29.0));
  return .045+.95*coarse*coarse*(.35+.65*fine)*(1.0+.35*min(1.0,abs(bend))+.25*clamp(slope,0.0,1.0));
}
float riverBankFoam3(float d,vec2 p,float time,float footprint,float bend,float slope){
  if(d<0.0||d>1.8)return 0.0;
  float width=riverFoamWidth3(p,bend,slope);
  float centre=.12+width*.65+.18*shoreNoise(p/4.1);
  float gaps=smoothstep(.36,.64,.65*shoreNoise(p/13.7+9.0)+.35*shoreNoise(p/2.1+23.0));
  float lace=.25+.75*shoreNoise(p*2.1+vec2(time*.16,-time*.23));
  float jitter=.8+.4*shoreNoise(p/7.0);
  return (1.0-smoothstep(0.0,width,abs(d-centre)))*gaps*lace*(1.0-smoothstep(.15*jitter,1.4*jitter,footprint));
}
float shoreSurf3(float d,float wave,vec2 p,float band,float footprint){
  if(d < -4.0 || d > 120.0)return 0.0;
  float n=shoreNoise(p/19.0+band);
  float centre=.5+band+2.0*(1.0-wave)+1.2*(n-.5);
  float width=max(.3+.7*shoreNoise(p/7.0+band),min(48.0,footprint*2.0));
  float gaps=smoothstep(.22,.58,.65*shoreNoise(p/13.0+band)+.35*shoreNoise(p/3.1+band+8.0));
  return (1.0-smoothstep(0.0,width,abs(d-centre)))*gaps;
}
`;
