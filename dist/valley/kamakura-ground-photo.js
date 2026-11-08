import { PHOTO_GLSL, PHOTO_TEX_DATA, photoSampler, photoBlendUniform } from './kamakura-photo-tex.js';

// W2c-10 ground: procedural spots -> CC0 normal/ratio detail; palette remains with groundTone.
export const GROUND_PHOTO_KEYS=Object.freeze(['groundSand','groundSandWet','groundTurf','groundDark','groundNeedles','groundSoil','groundPebbles']);
// Measured from the shipped JPEG B channel, integrating bilinear filtering of each float box mip before squaring.
// Correct the sqrt packing's Jensen bias: an averaged B squared is not an averaged ratio.
export const GROUND_PHOTO_MEANS=Object.freeze([
  [0.996088,0.989867,0.985882,0.983353,0.981730,0.980632,0.979853,0.979332,0.978877,0.978606,0.978556],
  [0.997728,0.997432,0.997101,0.996791,0.996514,0.996337,0.996271,0.996254,0.996249,0.996248],
  [0.998919,0.995786,0.994275,0.993258,0.992424,0.991814,0.991403,0.991276,0.991236,0.991230],
  [0.996341,0.989185,0.985759,0.984129,0.983319,0.982832,0.982380,0.982081,0.981907,0.981882],
  [0.989284,0.976962,0.972751,0.971060,0.970114,0.969316,0.968718,0.968266,0.968041,0.967945],
  [0.990227,0.972119,0.957770,0.948410,0.943325,0.940510,0.938531,0.936484,0.934550,0.933024,0.932389],
  [0.995747,0.984470,0.969518,0.951443,0.933529,0.921143,0.914825,0.911762,0.910966,0.910819],
].map(Object.freeze));
// W2c-10 ground (parent tuning): river pebbles carry far more contrast than soil or sand, so a gravel yard read as a cobble field.
// Per-material scale of (normal, ratio-1) after de-meaning; the mean ratio stays 1. Order = GROUND_PHOTO_KEYS.
// R4 critic (04): the 15 m sand tile carries broad dark blotches that read as a muddy path, and the 4 m soil tile has dark smudges that
// made the halls' yards look neglected; both lose contrast (grain and relief stay). R3's 70/150 m yard macro is deliberately untouched.
export const GROUND_PHOTO_CONTRAST=Object.freeze([.5,.7,1,1,.9,.7,.5]);
export function groundPhotoMean(id,lod){const a=GROUND_PHOTO_MEANS[id],v=Math.max(0,Math.min(a.length-1,lod)),i=Math.floor(v);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(v-i);}
export function selectGroundPhotos(weights,light=false){
  let first=-1,second=-1;
  for(let i=0;i<weights.length;i++)if(weights[i]>=.15){
    if(first<0||weights[i]>weights[first]){second=first;first=i;}
    else if(second<0||weights[i]>weights[second])second=i;
  }
  return first<0?[]:light||second<0?[first]:[first,second];
}
export function groundPhotoUniforms(textures,quality,search,shared){
  const uniforms={uGroundPhotoA:{value:textures[0]},uGroundPhotoB:{value:textures[1]},uPhotoBlend:photoBlendUniform,
    uGroundPhotoEnabled:{value:new URLSearchParams(search).get('photo')==='0'?0:1},uGroundPhotoLight:{value:quality==='light'?1:0}};
  GROUND_PHOTO_KEYS.forEach((key,i)=>{uniforms[`uGroundPhoto${i}`]=photoSampler(key);});
  uniforms.uGroundPhotoSky=shared.uSeaSky||{value:null};
  if(shared.uShoreSea)uniforms.uGroundPhotoShore=shared.uShoreReady||{value:0};
  else uniforms.uGroundPhotoShore={value:0};
  return uniforms;
}
export const GROUND_PHOTO_DECL=`
varying vec3 vGroundPhotoView;
uniform vec3 uGroundPhotoSky;
uniform sampler2D uGroundPhotoA,uGroundPhotoB;
uniform sampler2D ${GROUND_PHOTO_KEYS.map((_,i)=>`uGroundPhoto${i}`).join(',')};
uniform float uPhotoBlend,uGroundPhotoEnabled,uGroundPhotoLight,uGroundPhotoShore;
float groundPhotoAmount=0.0,groundPhotoRatio=1.0,groundPhotoWet=0.0,groundPhotoSand=0.0,groundPhotoGravel=0.0,groundPhotoEarth=0.0;
vec2 groundPhotoNormal=vec2(0.0);
float groundPhotoNormalFade=0.0,groundPhotoMeanValue=1.0;
// De-mean each source BEFORE hex tiling centres it around 1, then normalise the selected mixture's weights.
${PHOTO_GLSL.replace('3.*s.b*s.b','3.*s.b*s.b/groundPhotoMeanValue')}
`;
const meanGLSL=GROUND_PHOTO_MEANS.map((a,i)=>`if(id==${i}){${a.slice(0,-1).map((v,j)=>`if(lod<${j+1}.0)return mix(${v.toFixed(6)},${a[j+1].toFixed(6)},clamp(lod-${j}.0,0.0,1.0));`).join('')}return ${a.at(-1).toFixed(6)};}`).join('\n');
const lookups=GROUND_PHOTO_KEYS.map((key,i)=>{
  const {meters,size}=PHOTO_TEX_DATA[key];
  return `if(id==${i}){vec2 uv=p/${meters.toFixed(2)},gx=dx/${meters.toFixed(2)},gy=dy/${meters.toFixed(2)};
    // Approximate the anisotropic minor-axis LOD; mean correction is tested on float mips, GPU quantisation remains a real-device check.
    float lod=max(0.0,log2(max(min(length(gx),length(gy))*${size}.0,1.0)));
    groundPhotoMeanValue=groundPhotoMipMean(id,lod);
    if(uGroundPhotoLight>.5)return kzPhotoGrad(uGroundPhoto${i},uv,gx,gy);
    return kzPhotoHexGrad(uGroundPhoto${i},uv,1.2,1.0,gx,gy);}`;
}).join('\n');
export const GROUND_PHOTO_GLSL=`
float groundPhotoMipMean(int id,float lod){${meanGLSL}return 1.0;}
float groundPhotoContrast(int id){${GROUND_PHOTO_CONTRAST.map((k,i)=>`if(id==${i})return ${k.toFixed(3)};`).join('')}return 1.0;}
vec3 groundPhotoRead(int id,vec2 p,vec2 dx,vec2 dy){${lookups}return vec3(0.0,0.0,1.0);}
void groundPhotoPrepare(vec3 world,float dist){
  vec2 p=world.xz,dx=dFdx(p),dy=dFdy(p);
  float noisyDist=max(0.0,dist+(toneNoise(p/29.0)-.5)*18.0);
  groundPhotoNormalFade=1.0-smoothstep(25.0,90.0,noisyDist);
  groundPhotoAmount=uPhotoBlend*uGroundPhotoEnabled*uToneBlend*step(.001,uToneStrength)*(1.0-smoothstep(60.0,200.0,noisyDist));
  if(dist>=312.0)groundPhotoAmount=0.0;
  if(groundPhotoAmount<=0.0)return;
  vec2 warp=1.6*(vec2(toneNoise(p/23.0),toneNoise((p+vec2(71.0,-37.0))/23.0))-.5);
  vec2 uv=(p+warp)/uToneWeightSpan+.5;
  vec4 a=texture2D(uGroundPhotoA,uv),b=texture2D(uGroundPhotoB,uv);
  groundPhotoSand=a.r+a.g;groundPhotoGravel=b.b;
  float use=texture2D(uToneWeights,uv).b*smoothstep(.55,.9,vGroundSlope);
  groundPhotoEarth=b.r*(1.0-use)+use;
  groundPhotoWet=0.0;
  // G3: shared sea distance only. The current shore registry exposes no river-distance uniform.
#ifdef GROUND_PHOTO_SHORE
  float shoreD=-texture2D(uShoreSea,(p-uShoreGrid.xy+4.0)/uShoreGrid.zw).r;
  groundPhotoWet=(1.0-smoothstep(0.0,2.4,max(0.0,shoreD)))*uGroundPhotoShore;
#endif
  float forest=clamp(toneNoise(p/7.3),.2,.8);
  float w[7];
  w[0]=a.r;w[1]=a.g;w[2]=a.b;w[3]=a.a*(1.0-forest)+b.a;
  w[4]=a.a*forest;w[5]=b.r;w[6]=b.b;
  // Rock stays procedural, and does not spend a photographic lookup.
  for(int i=0;i<7;i++)w[i]*=1.0-use;
  w[5]+=use*.62;w[6]+=use*.38;
  float moist=(w[0]+w[5])*groundPhotoWet;
  w[0]*=1.0-groundPhotoWet;w[5]*=1.0-groundPhotoWet;w[1]+=moist;
  int first=-1,second=-1;float best=0.0,next=0.0;
  for(int i=0;i<7;i++)if(w[i]>=.15){
    if(w[i]>best){second=first;next=best;first=i;best=w[i];}
    else if(w[i]>next){second=i;next=w[i];}
  }
  if(uGroundPhotoLight>.5){second=-1;next=0.0;}
  vec3 d=vec3(0.0);float total=best+next;
  if(first>=0){vec3 s=groundPhotoRead(first,p,dx,dy);float k=groundPhotoContrast(first);d+=vec3(s.xy*k,1.0+(s.z-1.0)*k)*best;}
  if(second>=0){vec3 s=groundPhotoRead(second,p,dx,dy);float k=groundPhotoContrast(second);d+=vec3(s.xy*k,1.0+(s.z-1.0)*k)*next;}
  if(total>0.0){d/=total;groundPhotoRatio=d.z;groundPhotoNormal=d.xy;}
}
`;
// Always evaluate the normal-frame derivatives outside all material/quality/distance branches.
export const GROUND_PHOTO_NORMAL=`
normal=kzPerturbNormal(normal,-vGroundPhotoView,vGroundWorld.xz,groundPhotoNormal,
  .45*groundPhotoAmount*groundPhotoNormalFade);
`;
