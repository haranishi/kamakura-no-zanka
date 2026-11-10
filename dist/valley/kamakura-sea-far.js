// W2c-18 seaedge: pure mirrors and shader additions; colours come from shore4's deep band.
import { seaColor4, seaBand4, SEA_BANDS4 } from './kamakura-shore-r4.js';
import { shoreNoise } from './kamakura-shore.js';
const zero = Object.freeze([0, 0, 0]);
export const SEA_FAR = Object.freeze({
  grazingFullDeg: 1.2, // degrees below horizontal: preserve the walking sea (eye height, 200m offshore is 0.7 degrees).
  grazingEndDeg: 9, // degrees below horizontal: no horizon replacement. 17 left the sea cream from a pass or a low flight:
  // water reflects the low sky only at a few degrees; by ten degrees it shows its own colour.
  get deep() { return SEA_DEEP; }, // linear RGB, shared deep absorption × .9.
  deepGain: .9, // fractional gain on the existing deep-band source (deep above).
  deepTint: Object.freeze([.42, .9, .74]), // per-channel share of that source: seen from above the open sea is a deep blue-green, not slate.
  reflectionMin: .025, // fraction of sky reflected straight down.
  skyCool: Object.freeze([.5, .64, .82]), // share of the horizon colour mirrored by far water facing away from the sun (a cooler, darker low sky).
  skySunPower: 2, // exponent on the sunward cosine: how tightly the warm horizon is kept around the sun.
  offshoreM: 200, // metres: original horizon-distance band.
  deepStartM: 60, // metres: blend the coastal surface into deep water.
  outsideM: 3000, // metres: synthetic offshore distance outside the shore grid.
  swellStartM: 300, swellFullM: 800, // 3D camera metres: far swell entrance.
  swellWavelengthM: Object.freeze([110, 73]), // metres: dominant shoreward and oblique waves.
  swellSpeed: Object.freeze([.23, .31]), // radians / second, positive phase travels shoreward.
  swellSlope: .03, swellContrast: .11, // normal slope and fractional brightness amplitude.
  swellAngleDeg: 53.13010235415598, // degrees between the two wave directions.
  swellSecondary: .4, // fraction of second wave (first wave = .6).
  linesStartM: 150, linesFullM: 400, // 3D camera metres: keep nearby surf unchanged.
  linePositionsM: Object.freeze([6, 22, 48, 85]), // metres offshore, deliberately unequal spacing.
  lineWidthsM: Object.freeze([3, 4, 5, 7]), // full widths in metres.
  linePeriodS: 25, linePhase: .25, // seconds per inward band and initial phase.
  lineFadePhase: .1, lineFeather: .25, // phase birth/death fraction and edge feather / physical width.
  linePixels: 1.5, lineStrength: .8, // minimum pixel width, surface-film fraction.
  gapOffset: 7, // noise-cell offset between successive fronts.
  gapScaleM: 38, gapLow: .38, gapHigh: .62, // metre noise scale and broken-front thresholds.
  cliffProbeM: 16, cliffSlopeStart: .12, cliffSlopeEnd: .65, cliffGain: .18, // inland rise/run attenuation.
  glintDrift: .1, glintFilterPixels: 2, // noise cells / second and pixel footprint multiplier.
  glintStrength: .14, glintPower: 12, glintCellM: 3, glintLow: .86, glintHigh: .98, // bounded high-view sparkle.
  reducedSwell: .5, reducedLines: 2, // light / adapt 2 budgets.
});
const SEA_DEEP=Object.freeze(seaColor4(SEA_BANDS4[1]*2,zero,zero).map((v,i)=>v*SEA_FAR.deepGain*SEA_FAR.deepTint[i]));
const C = SEA_FAR, clamp = x => Math.max(0, Math.min(1, x));
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export const sea2Enabled = search => new URLSearchParams(search).get('sea2') !== '0';
export const seaGrazing = cosine => 1-smooth(Math.sin(C.grazingFullDeg*Math.PI/180),Math.sin(C.grazingEndDeg*Math.PI/180),Math.abs(cosine));
// The low sky the far water mirrors: the warm horizon towards the sun, a cooler and darker sky away from it.
export function seaSkyTint(sunward,out=[0,0,0]) {
  const w=clamp(sunward)**C.skySunPower;for(let i=0;i<3;i++)out[i]=C.skyCool[i]+(1-C.skyCool[i])*w;return out;
}
export const seaSwellGain = range => smooth(C.swellStartM,C.swellFullM,range);
export const seaLineGain = range => smooth(C.linesStartM,C.linesFullM,range);
export const seaLineCount = (quality='standard',step=0) => step>=3?0:quality==='light'||step>=2?C.reducedLines:C.linePositionsM.length;
export const seaLineCentre = (i,time) => {
  const phase=((time/C.linePeriodS+C.linePhase)%1+1)%1;
  return C.linePositionsM[i]+((i?C.linePositionsM[i-1]:0)-C.linePositionsM[i])*phase;
};
export function seaLineWidth(i,footprint,out={}) {
  out.width=Math.max(C.lineWidthsM[i],Math.max(0,footprint)*C.linePixels);
  out.alpha=C.lineWidthsM[i]/out.width;return out;
}
export const seaLineGap = (x,z,i) => smooth(C.gapLow,C.gapHigh,shoreNoise(x/C.gapScaleM+i*C.gapOffset,z/C.gapScaleM+i*C.gapOffset));
export function seaOffshoreColor(cosine,horizon,out=[0,0,0]) {
  const f=C.reflectionMin+(1-C.reflectionMin)*(1-clamp(Math.abs(cosine)))**5;
  for(let i=0;i<3;i++)out[i]=C.deep[i]+(horizon[i]-C.deep[i])*f;
  return out;
}
// Mirrors the exact walking horizon path; full grazing leaves the old lit colour untouched.
export function seaFinalColor(lit,distance,cosine,horizon,footprint=0,out=[0,0,0]) {
  const g=seaGrazing(cosine),weight=seaBand4(distance,C.deepStartM,footprint)*(1-g);
  seaOffshoreColor(cosine,horizon,out);
  const h=seaBand4(distance,C.offshoreM,footprint)*g;
  for(let i=0;i<3;i++){const c=lit[i]+(out[i]-lit[i])*weight;out[i]=c+(horizon[i]-c)*h;}
  return out;
}
const f = n => Number(n).toFixed(8);
export const SEA_FAR_GLSL = `
uniform float uSea2,uSea2Swell,uSea2Lines,uSea2Debug;
float sea2Grazing(float cosine){return 1.0-smoothstep(${f(Math.sin(C.grazingFullDeg*Math.PI/180))},${f(Math.sin(C.grazingEndDeg*Math.PI/180))},abs(cosine));}
float sea2SwellGain(float range){return smoothstep(${f(C.swellStartM)},${f(C.swellFullM)},range)*uSea2Swell;}
vec2 sea2Phases(vec2 p,vec2 direction,float time){
  vec2 oblique=vec2(direction.x*${f(Math.cos(C.swellAngleDeg*Math.PI/180))}-direction.y*${f(Math.sin(C.swellAngleDeg*Math.PI/180))},direction.x*${f(Math.sin(C.swellAngleDeg*Math.PI/180))}+direction.y*${f(Math.cos(C.swellAngleDeg*Math.PI/180))});
  return vec2(dot(p,direction)*${f(2*Math.PI/C.swellWavelengthM[0])}+time*${f(C.swellSpeed[0])},dot(p,oblique)*${f(2*Math.PI/C.swellWavelengthM[1])}+time*${f(C.swellSpeed[1])});
}
float sea2Line(float d,vec2 p,float time,float footprint,float centre,float previous,float width,float offset){
  float phase=fract(time/${f(C.linePeriodS)}+${f(C.linePhase)});
  float moving=mix(centre,previous,phase),fullWidth=max(width,footprint*${f(C.linePixels)});
  float core=fullWidth*.5,edge=max(footprint*.5,width*${f(C.lineFeather)});
  float profile=1.0-smoothstep(max(0.0,core-edge),core+edge,abs(d-moving));
  float gaps=smoothstep(${f(C.gapLow)},${f(C.gapHigh)},shoreNoise(p/${f(C.gapScaleM)}+offset));
  return profile*(width/fullWidth)*gaps*smoothstep(0.0,${f(C.lineFadePhase)},phase)*(1.0-smoothstep(${f(1-C.lineFadePhase)},1.0,phase));
}
float sea2Surf(float d,vec2 p,float time,float footprint,float range,float beach){
  float result=0.0;
  ${C.linePositionsM.map((d,i)=>`if(uSea2Lines>${f(i+.5)})result+=sea2Line(d,p,time,footprint,${f(d)},${f(i?C.linePositionsM[i-1]:0)},${f(C.lineWidthsM[i])},${f(i*C.gapOffset)});`).join('\n  ')}
  return clamp(result,0.0,1.0)*smoothstep(${f(C.linesStartM)},${f(C.linesFullM)},range)*beach*${f(C.lineStrength)};
}
vec3 sea2Sky(vec3 ray){
  float sunward=max(0.0,dot(ray.xz,SUN_DIR_W.xz)/max(.0001,length(ray.xz)*length(SUN_DIR_W.xz)));
  return uWaterSkyHorizon*mix(vec3(${C.skyCool.map(f).join(',')}),vec3(1.0),pow(sunward,${f(C.skySunPower)}));
}
vec3 sea2Deep(float cosine){
  float fresnel=${f(C.reflectionMin)}+${f(1-C.reflectionMin)}*pow(1.0-clamp(abs(cosine),0.0,1.0),5.0);
  return mix(vec3(${C.deep.map(f).join(',')}),uWaterSkyHorizon,fresnel);
}
`;
// Applied only when sea2 is enabled. The legacy compiler and cache key stay byte-identical when disabled.
export function seaFarFragment(fragment) {
  return fragment.replace(SHADER_ANCHORS.pars,`${SHADER_ANCHORS.pars}\n${SEA_FAR_GLSL}`)
    .replace('float landDistance=texture2D(uShoreLand,seaUV).r;','vec2 sea2Shore=texture2D(uShoreLand,seaUV).rg;float landDistance=sea2Shore.r;')
    .replace('float seaRange=distance(vSeaWorld,cameraPosition);',`float seaRange=distance(vSeaWorld,cameraPosition);
      float sea2G=sea2Grazing(normalize(cameraPosition-vSeaWorld).y),sea2Lines=0.0,sea2Brightness=0.0;
      bool sea2Inside=all(greaterThanEqual(seaUV,vec2(0.0)))&&all(lessThanEqual(seaUV,vec2(1.0)));
      float sea2Distance=sea2Inside?landDistance:${f(C.outsideM)};`)
    .replace('vec3 nw=normalize(vec3(slopes.x,1.0,slopes.y));',`if(uSea2>.5&&seaRange>${f(C.swellStartM)}){
        vec2 phases=sea2Phases(p,direction,uShoreTime);
        vec2 secondary=vec2(direction.x*${f(Math.cos(C.swellAngleDeg*Math.PI/180))}-direction.y*${f(Math.sin(C.swellAngleDeg*Math.PI/180))},direction.x*${f(Math.sin(C.swellAngleDeg*Math.PI/180))}+direction.y*${f(Math.cos(C.swellAngleDeg*Math.PI/180))});
        float gain=sea2SwellGain(seaRange);
        slopes+=${f(C.swellSlope)}*gain*(direction*cos(phases.x)*${f(1-C.swellSecondary)}+secondary*cos(phases.y)*${f(C.swellSecondary)});
        sea2Brightness=dot(sin(phases),vec2(${f(1-C.swellSecondary)},${f(C.swellSecondary)}))*gain;
      }
      vec3 nw=normalize(vec3(slopes.x,1.0,slopes.y));`)
    .replace('float horizon4=seaBand4(landDistance,200.0,shoreFootprint);',`float horizon4=seaBand4(landDistance,200.0,shoreFootprint);
      if(uSea2>.5)horizon4=seaBand4(landDistance,${f(C.offshoreM)},shoreFootprint)*sea2G;`)
    .replace('outgoingLight=mix(outgoingLight,uWaterSkyHorizon,horizon4);','outgoingLight=mix(outgoingLight,uSea2>.5?sea2Sky(vSeaWorld-cameraPosition):uWaterSkyHorizon,horizon4);')
    .replace('// Match the final lit far sea',`if(uSea2>.5){
      float deepWeight=seaBand4(sea2Distance,${f(C.deepStartM)},shoreFootprint)*(1.0-sea2G);
      outgoingLight=mix(outgoingLight,sea2Deep(normalize(cameraPosition-vSeaWorld).y),deepWeight);
      outgoingLight*=1.0+${f(C.swellContrast)}*sea2Brightness;
    }
    // Match the final lit far sea`)
    .replace('// Foam is a white surface film',`if(uSea2>.5){
      if(seaRange>${f(C.linesStartM)}&&sea2Inside&&landDistance>=0.0&&landDistance<${f(C.linePositionsM.at(-1)+C.lineWidthsM.at(-1))}+shoreFootprint*${f(C.linePixels)}){
        sea2Lines=sea2Surf(landDistance,vSeaWorld.xz,uShoreTime,shoreFootprint,seaRange,sea2Shore.g);
        seaFoam=max(seaFoam,sea2Lines);
      }
      if(!sea2Inside)seaFoam*=sea2G;
      if(seaRange>${f(C.swellStartM)}&&sea2G<1.0){
      vec3 eye2=normalize(cameraPosition-vSeaWorld);
      float facing2=max(0.0,dot(-eye2.xz,SUN_DIR_W.xz)/max(.0001,length(eye2.xz)*length(SUN_DIR_W.xz)));
      float sparkle=shoreNoise(vSeaWorld.xz/max(${f(C.glintCellM)},length(fwidth(vSeaWorld.xz))*${f(C.glintFilterPixels)})+uShoreTime*${f(C.glintDrift)});
      outgoingLight+=clamp(uSeaSun,vec3(0.0),vec3(1.0))*${f(C.glintStrength)}*pow(facing2,${f(C.glintPower)})*smoothstep(${f(C.glintLow)},${f(C.glintHigh)},sparkle)*(1.0-sea2G)*sea2SwellGain(seaRange);
      }
    }
    // Foam is a white surface film`)
    .replace(SHADER_ANCHORS.output,`${SHADER_ANCHORS.output}
      if(uSea2Debug>.5&&uSea2>.5)gl_FragColor=vec4(sea2Lines,.5+.5*sea2Brightness,seaBand4(landDistance,${f(C.offshoreM)},shoreFootprint)*sea2G,1.0);`);
}
export const SHADER_ANCHORS=Object.freeze({pars:'#include <clipping_planes_pars_fragment>',output:'#include <dithering_fragment>'});
