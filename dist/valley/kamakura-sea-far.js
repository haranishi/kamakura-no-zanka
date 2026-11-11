// W2c-18 seaedge: pure mirrors and shader additions; colours come from shore4's deep band.
import { seaColor4, seaBand4, SEA_BANDS4 } from './kamakura-shore-r4.js';
import { SEA_PALETTE, shoreNoise } from './kamakura-shore.js';
export const SEA3 = Object.freeze({
  fromM:40, toM:90, // 3D camera metres: near/far surf exchange.
  positionsM:Object.freeze([5,16,30,50,80]), // metres offshore at birth, shared inward phase with sea2.
  widthsM:Object.freeze([1.2,1.6,2,2.5,3]), // metres: crest-to-tail widths before along-front variation.
  reducedLines:3, // fronts 0/2/4 in light or adapt 2; adapt 3 restores sea2.
  edgeM:.45, tailWidths:2.5, // metres shoreward rise / offshore decay length in width units.
  fineM:1.2, coarseM:4, // metres: two foam-hole scales (reduced quality uses coarse only).
  holeLow:.24, holeHigh:.58, filteredFoam:.55, // noise thresholds and unresolved mean coverage.
  foamDrift:.06, textureOffset:13, // noise cells/second / independent hole offset.
  densityMin:.45, densityM:23, // minimum along-front density / metres of density variation.
  wanderM:90, wanderFraction:.18, // metre correlation length / maximum shift as share of minimum neighbouring gap.
  widthNoiseM:17, widthOffset:19, widthMin:.5, widthMax:1.8, // metre width-noise scale / offset / width multiplier bounds.
  strength:1, // white-film coverage; gaps and perforation reduce the local maximum.
  washPeriodS:6, washAmplitudeM:1.5, // seconds / metres of shoreline swash.
  scallopM:11, scallopAmplitudeM:1, // metres: shell-edge correlation length and displacement.
  washEdgeM:.7, washTrailM:2.5, washTrailGain:.4, washStrength:.9, // metres of waterline edge / residual trail / coverage gains.
  washLimitM:6, limitM:110, // metre evaluation bounds; pixel footprint extends the outer bound.
  shallowEndM:12, middleEndM:45, deepEndM:120, colorBlendM:12, // metres of shallow/middle/deep bands and first transition width.
  sandMix:.2, middleDeepMix:.4, // existing sand contribution / deep absorption contribution, no new colour table.
  colorAngleStartDeg:9, colorAngleFullDeg:17, // degrees: preserve low-angle reflection, then reveal sand/depth.
  debugGain:3, // diagnostic coverage amplification (no effect on normal rendering).
  debugShallow:Object.freeze([0,.8,.15]), debugDeep:Object.freeze([0,.12,.03]), // diagnostic shallow/deep green.
  debugTail:Object.freeze([0,.8,1]), debugWash:Object.freeze([1,1,0]), // diagnostic cyan tail / yellow shoreline.
});
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

// W2c-19: the scalar bodies below are shared verbatim by JS and GLSL.
// This small emitter changes declarations only; neither noise nor arithmetic has a second implementation.
export const sea3Enabled = search => new URLSearchParams(search).get('sea3') !== '0';
export const sea3Gain = range => smooth(SEA3.fromM,SEA3.toM,range);
export const sea3Count = (quality='standard',step=0) => step>=3?0:quality==='light'||step>=2?SEA3.reducedLines:SEA3.positionsM.length;
const fract3=x=>x-Math.floor(x),mix3=(a,b,t)=>a+(b-a)*t;
function scalar3(args,body) {
  const js=Function('smoothstep','clamp','mix','fract','sin','max','min','abs','shoreNoise',`return function(${args}){${body.replace(/float /g,'let ')}}`)(smooth,(x,a,b)=>Math.max(a,Math.min(b,x)),mix3,fract3,Math.sin,Math.max,Math.min,Math.abs,shoreNoise);
  return {js,glsl:name=>`float ${name}(${args.split(',').map(a=>'float '+a).join(',')}){${body}}`};
}
const S=SEA3;
const phase3=scalar3('time',`return fract(time/${f(C.linePeriodS)}+${f(C.linePhase)});`);
const shift3=scalar3('x,z,offset,gap',`return (shoreNoise(x/${f(S.wanderM)}+offset,z/${f(S.wanderM)}+offset)*2.0-1.0)*gap*${f(S.wanderFraction)};`);
const width3=scalar3('x,z,offset',`return mix(${f(S.widthMin)},${f(S.widthMax)},shoreNoise(x/${f(S.widthNoiseM)}+offset+${f(S.widthOffset)},z/${f(S.widthNoiseM)}+offset));`);
const density3=scalar3('x,z,offset',`return mix(${f(S.densityMin)},1.0,shoreNoise(x/${f(S.densityM)}+offset,z/${f(S.densityM)}+offset));`);
const texture3=scalar3('x,z,time,footprint,detail',`
  float large=shoreNoise(x/${f(S.coarseM)}+${f(S.textureOffset)},z/${f(S.coarseM)}+${f(S.textureOffset)});
  float coarseHole=mix(smoothstep(${f(S.holeLow)},${f(S.holeHigh)},large),${f(S.filteredFoam)},smoothstep(${f(S.coarseM/2)},${f(S.coarseM)},footprint));
  if(detail<.5)return coarseHole;
  float small=shoreNoise(x/${f(S.fineM)}+time*${f(S.foamDrift)},z/${f(S.fineM)}-time*${f(S.foamDrift)});
  float fineHole=mix(smoothstep(${f(S.holeLow)},${f(S.holeHigh)},small),${f(S.filteredFoam)},smoothstep(${f(S.fineM/2)},${f(S.fineM)},footprint));
  return coarseHole*fineHole;
`);
const profile3=scalar3('delta,width,footprint',`
  float pixel=max(0.0,footprint)*${f(C.linePixels)};
  float edge=max(${f(S.edgeM)},pixel);
  float tail=max(width*${f(S.tailWidths)},pixel);
  return smoothstep(-edge,0.0,delta)*(1.0-smoothstep(0.0,tail,delta))*min(1.0,(${f(S.edgeM)}+width*${f(S.tailWidths)})/(edge+tail));
`);
const crest3=scalar3('delta,width,footprint',`
  return 1.0-smoothstep(0.0,max(width,footprint*${f(C.linePixels)}),max(0.0,delta));
`);
const wash3=scalar3('x,z,time',`
  return ${f(S.washAmplitudeM)}*sin(time*${f(2*Math.PI/S.washPeriodS)})+(shoreNoise(x/${f(S.scallopM)},z/${f(S.scallopM)})*2.0-1.0)*${f(S.scallopAmplitudeM)};
`);
const washProfile3=scalar3('d,x,z,time,footprint',`
  float centre=${f(S.washAmplitudeM)}*sin(time*${f(2*Math.PI/S.washPeriodS)})+(shoreNoise(x/${f(S.scallopM)},z/${f(S.scallopM)})*2.0-1.0)*${f(S.scallopAmplitudeM)};
  float edge=max(${f(S.washEdgeM)},footprint*${f(C.linePixels)});
  float head=1.0-smoothstep(edge,edge*2.0,abs(d-centre));
  float trail=smoothstep(0.0,edge,d-centre)*(1.0-smoothstep(0.0,${f(S.washTrailM)},d-centre))*${f(S.washTrailGain)};
  return max(head*min(1.0,${f(S.washEdgeM)}/edge),trail);
`);
export const sea3Phase=phase3.js,sea3Shift=shift3.js,sea3WidthScale=width3.js,sea3Density=density3.js,sea3Texture=texture3.js,sea3Profile=profile3.js,sea3Crest=crest3.js,sea3WashCentre=wash3.js,sea3WashProfile=washProfile3.js;
export function sea3Centre(i,x,z,time) {
  const phase=sea3Phase(time),p=S.positionsM,previous=i?p[i-1]:0;
  const gap=Math.min(p[i]-previous,i?previous-(i>1?p[i-2]:0):p[0]);
  return mix3(p[i],previous,phase)+sea3Shift(x,z,i*C.gapOffset,gap);
}
// Caller-owned output keeps the preview and diagnostic sampling allocation-free.
export function sea3Sample(d,x,z,time,footprint=0,range=300,quality='standard',step=0,out={}) {
  let crest=0,tail=0,wash=0;const gain=sea3Gain(range),detail=quality==='light'||step>=2?0:1;
  if(gain>0&&step<3&&d>=-S.washLimitM&&d<S.limitM+footprint*C.linePixels){
    const phase=sea3Phase(time),birth=smooth(0,C.lineFadePhase,phase)*(1-smooth(1-C.lineFadePhase,1,phase));
    for(let i=0;i<S.positionsM.length;i++){
      if(!detail&&i%2)continue;
      const offset=i*C.gapOffset,delta=d-sea3Centre(i,x,z,time),width=S.widthsM[i]*sea3WidthScale(x,z,offset);
      const profile=sea3Profile(delta,width,footprint);
      if(profile<=0)continue;
      const alpha=profile*seaLineGap(x,z,i)*sea3Density(x,z,offset)*sea3Texture(x,z,time,footprint,detail)*birth;
      const head=sea3Crest(delta,width,footprint);crest+=alpha*head;tail+=alpha*(1-head);
    }
    wash=sea3WashProfile(d,x,z,time,footprint)*sea3Texture(x,z,time,footprint,detail)*S.washStrength;
  }
  out.crest=clamp(crest)*gain*S.strength;out.tail=clamp(tail)*gain*S.strength;out.wash=wash*gain;
  out.foam=clamp(out.crest+out.tail+out.wash);return out;
}
// Derive all three absorption colours from the existing sand, coastal palette and sea2 deep source.
const linear3=n=>n<=.04045?n/12.92:((n+.055)/1.055)**2.4;
const palette3=i=>SEA_PALETTE[i][1].slice(1).match(/../g).map(s=>linear3(parseInt(s,16)/255));
const sand3=seaColor4(0,zero,zero),near3=palette3(0),mid3=palette3(1);
const colors3=Object.freeze([Object.freeze(near3.map((v,i)=>mix3(v,sand3[i],S.sandMix))),Object.freeze(mid3.map((v,i)=>mix3(v,SEA_DEEP[i],S.middleDeepMix))),SEA_DEEP]);
export function sea3Color(d,out=[0,0,0]) {
  const a=smooth(S.shallowEndM-S.colorBlendM/2,S.shallowEndM+S.colorBlendM/2,d),b=smooth(S.middleEndM,S.deepEndM,d);
  for(let i=0;i<3;i++)out[i]=mix3(mix3(colors3[0][i],colors3[1][i],a),colors3[2][i],b);return out;
}
export const sea3ColorGain=(cosine,range)=>smooth(Math.sin(S.colorAngleStartDeg*Math.PI/180),Math.sin(S.colorAngleFullDeg*Math.PI/180),Math.abs(cosine))*sea3Gain(range);
const scalarDefs3=[[phase3,'sea3Phase'],[shift3,'sea3Shift'],[width3,'sea3WidthScale'],[density3,'sea3Density'],[texture3,'sea3Texture'],[profile3,'sea3Profile'],[crest3,'sea3Crest'],[wash3,'sea3WashCentre'],[washProfile3,'sea3WashProfile']];
export const SEA3_SCALAR_GLSL=scalarDefs3.map(([body,name])=>body.glsl(name)).join('\n');
// shoreNoise takes a vec2 in GLSL, two scalars in JS; adapt only this call signature.
export const SEA3_GLSL=`
uniform float uSea3,uSea3Lines,uSea3Detail,uSea3Debug;
${SEA3_SCALAR_GLSL.replace(/shoreNoise\(([^,()]+),([^()]+?)\)/g,'shoreNoise(vec2($1,$2))')}
float sea3Gain(float range){return smoothstep(${f(S.fromM)},${f(S.toM)},range);}
vec2 sea3Line(float d,vec2 p,float time,float footprint,float centre,float previous,float gap,float width,float offset){
  float phase=sea3Phase(time),moving=mix(centre,previous,phase)+sea3Shift(p.x,p.y,offset,gap);
  float delta=d-moving,physical=width*sea3WidthScale(p.x,p.y,offset);
  float profile=sea3Profile(delta,physical,footprint);
  if(profile<=0.0)return vec2(0.0);
  float alpha=profile*smoothstep(${f(C.gapLow)},${f(C.gapHigh)},shoreNoise(p/${f(C.gapScaleM)}+offset))*sea3Density(p.x,p.y,offset)*sea3Texture(p.x,p.y,time,footprint,uSea3Detail)*smoothstep(0.0,${f(C.lineFadePhase)},phase)*(1.0-smoothstep(${f(1-C.lineFadePhase)},1.0,phase));
  float head=sea3Crest(delta,physical,footprint);return alpha*vec2(head,1.0-head);
}
vec3 sea3Surf(float d,vec2 p,float time,float footprint,float range,float beach){
  if(d<${f(-S.washLimitM)}||d>${f(S.limitM)}+footprint*${f(C.linePixels)})return vec3(0.0);
  vec2 fronts=vec2(0.0);
  ${S.positionsM.map((v,i)=>{
    const prev=i?S.positionsM[i-1]:0,gap=Math.min(v-prev,i?prev-(i>1?S.positionsM[i-2]:0):S.positionsM[0]);
    return `if(uSea3Lines>.5${i%2?'&&uSea3Lines>3.5':''})fronts+=sea3Line(d,p,time,footprint,${f(v)},${f(prev)},${f(gap)},${f(S.widthsM[i])},${f(i*C.gapOffset)});`;
  }).join('\n  ')}
  float wash=sea3WashProfile(d,p.x,p.y,time,footprint)*sea3Texture(p.x,p.y,time,footprint,uSea3Detail)*${f(S.washStrength)};
  return vec3(clamp(fronts,0.0,1.0)*${f(S.strength)}*beach,wash)*sea3Gain(range);
}
vec3 sea3Color(float d){
  vec3 c=mix(vec3(${colors3[0].map(f).join(',')}),vec3(${colors3[1].map(f).join(',')}),smoothstep(${f(S.shallowEndM-S.colorBlendM/2)},${f(S.shallowEndM+S.colorBlendM/2)},d));
  return mix(c,vec3(${colors3[2].map(f).join(',')}),smoothstep(${f(S.middleEndM)},${f(S.deepEndM)},d));
}
`;
export function sea3Fragment(fragment) {
  return fragment.replace(SHADER_ANCHORS.pars,`${SHADER_ANCHORS.pars}\n${SEA3_GLSL}`)
    .replace('bool sea2Inside=', 'vec3 sea3Foam=vec3(0.0);\n      bool sea2Inside=')
    // Crossfade the complete legacy surf, not just surf6. No double exposure.
    .replace(`if(seaRange>${f(C.linesStartM)}&&sea2Inside`, `if(uSea3<.5&&seaRange>${f(C.linesStartM)}&&sea2Inside`)
    .replace('// Foam is a white surface film',`if(uSea3>.5&&uShoreReady>.5&&sea2Inside&&seaRange>${f(S.fromM)}){
      sea3Foam=sea3Surf(landDistance,vSeaWorld.xz,uShoreTime,shoreFootprint,seaRange,sea2Shore.g);
      seaFoam=seaFoam*(1.0-sea3Gain(seaRange))+clamp(sea3Foam.x+sea3Foam.y+sea3Foam.z,0.0,1.0);
      float cosine3=abs(normalize(cameraPosition-vSeaWorld).y);
      float colorGain3=smoothstep(${f(Math.sin(S.colorAngleStartDeg*Math.PI/180))},${f(Math.sin(S.colorAngleFullDeg*Math.PI/180))},cosine3)*sea3Gain(seaRange)*(1.0-smoothstep(${f(S.deepEndM)},${f(S.deepEndM+S.colorBlendM)},landDistance));
      float reflection3=${f(C.reflectionMin)}+${f(1-C.reflectionMin)}*pow(1.0-clamp(cosine3,0.0,1.0),5.0);
      outgoingLight=mix(outgoingLight,mix(sea3Color(landDistance),uWaterSkyHorizon,reflection3),colorGain3);
    }
    // Foam is a white surface film`)
    .replace(SHADER_ANCHORS.output,`${SHADER_ANCHORS.output}
      if(uSea3Debug>.5&&uSea3>.5){
        float depth3=mix(0.0,.5,smoothstep(${f(S.shallowEndM-S.colorBlendM/2)},${f(S.shallowEndM+S.colorBlendM/2)},landDistance));
        depth3=mix(depth3,1.0,smoothstep(${f(S.middleEndM)},${f(S.deepEndM)},landDistance));
        vec3 debug3=mix(vec3(${S.debugShallow.map(f).join(',')}),vec3(${S.debugDeep.map(f).join(',')}),depth3);
        debug3=mix(debug3,vec3(${S.debugTail.map(f).join(',')}),clamp(sea3Foam.y*${f(S.debugGain)},0.0,1.0));
        debug3=mix(debug3,vec3(1.0),clamp(sea3Foam.x*${f(S.debugGain)},0.0,1.0));
        debug3=mix(debug3,vec3(${S.debugWash.map(f).join(',')}),clamp(sea3Foam.z*${f(S.debugGain)},0.0,1.0));
        gl_FragColor=vec4(debug3,1.0);
      }`);
}
