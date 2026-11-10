// W2c-18n: deterministic solar coordinates, proxy meshes and CPU mirrors. No renderer or clock.
export const FAR_SHADOW = Object.freeze({
  townSpan: 3600, // m: horizontal town footprint, centred on the main avenue.
  townSize: 4096, // pixels: town solar depth map edge.
  wholeSize: 2048, // pixels: whole-terrain solar depth map edge.
  townCell: 8, // m: town terrain proxy grid spacing.
  wholeCell: 24, // m: whole terrain proxy grid spacing.
  heightMargin: 40, // m: caster headroom above the highest terrain sample.
  canopyThreshold: .5, // density fraction: lower coverage casts no canopy shadow.
  canopyHeight: 11, // m: canopy lift at full density.
  blend: 60, // m: inward town/whole transition width.
  fadeFrom: 42, // m: no post shadow within the walking scene-shadow radius.
  fadeTo: 62, // m: full post shadow beyond the walking scene shadow.
  radiusBase: .6, // m: penumbra at contact.
  radiusSlope: .045, // m/m: penumbra growth per blocker separation.
  radiusMax: 6, // m: maximum PCF world radius.
  biasTexels: 1.5, // texels: constant depth bias in world metres.
  biasSlope: .5, // texels: extra bias on grazing receivers.
  backface: .02, // cosine: do not double-darken sun-backfacing surfaces.
  darkFrom: .08, // linear luminance: no extra darkening below this value.
  darkTo: .65, // linear luminance: full darkening above this value.
  tintGain: .32, // linear gain: existing cool sky pigment in a shadow.
  near: 1, // m: solar camera near-plane clearance.
  precisionShare: .25, // texel fraction: maximum acceptable 16-bit depth quantisation.
  batch: 256, // vertices/cells: work per clock check during proxy generation.
  frameWork: 8192, // operations: maximum preparation work in one frame.
  sliceMs: 2, // ms: CPU preparation slice budget (GPU draws measured by parent).
  mapInset: .025, // screen fraction: depth preview lower-left inset.
  mapPreview: .25, // screen fraction: depth preview width/height.
  strengths: Object.freeze({ morning: .55, noon: .5, golden: .6, evening: .62 }) // fraction: per-time shadow strength.
});
const C=FAR_SHADOW;
const clamp=x=>Math.max(0,Math.min(1,x));
const smooth=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t);};
export const farShadowEnabled=search=>new URLSearchParams(search).get('farshadow')!=='0';
export const farShadowStrength=time=>C.strengths[time]??C.strengths.golden;
export const farShadowBias=(texel,ndotl)=>texel*(C.biasTexels+C.biasSlope*(1-clamp(ndotl)));
export const farShadowRadius=gap=>Math.min(C.radiusMax,C.radiusBase+Math.max(0,gap)*C.radiusSlope);
export const farShadowFade=(distance,flying)=>flying?1:smooth(C.fadeFrom,C.fadeTo,distance);
export const farShadowTownWeight=(bounds,x,z)=>smooth(0,C.blend,Math.min(x-bounds.minX,bounds.maxX-x,z-bounds.minZ,bounds.maxZ-z));
export const farShadowAmount=(occlusion,ndotl,distance,flying,luminance,strength)=>ndotl<=C.backface?0:
  clamp(occlusion)*farShadowFade(distance,flying)*smooth(C.darkFrom,C.darkTo,luminance)*strength;
export function farShadowTownBounds(terrain,data){
  // The same named route as the fly camera, falling back to walk bounds without private coordinates.
  const place=data?.meta?.places?.find(p=>p.id==='wakamiya_oji');
  const paths=data?.patches?.paths||{};
  const avenue=Object.entries(paths).find(([name])=>/wakamiya|avenue/i.test(name))?.[1] ||
    Object.values(data?.roads||{}).find(p=>/若宮|大通り|wakamiya/i.test(p.name||''));
  const points=avenue?.xyz_m||terrain.meta?.walk?.polygon_m;
  let x=0,z=0;
  if(place){x=place.x;z=-place.y;}
  else if(points?.length){for(const p of points){x+=p[0];z-=p[1];}x/=points.length;z/=points.length;}
  else{x=(terrain.bounds.minX+terrain.bounds.maxX)/2;z=(terrain.bounds.minZ+terrain.bounds.maxZ)/2;}
  return {minX:x-C.townSpan/2,maxX:x+C.townSpan/2,minZ:z-C.townSpan/2,maxZ:z+C.townSpan/2};
}
const dot=(p,q)=>p[0]*q[0]+p[1]*q[1]+p[2]*q[2];
// Solar orthographic frame. All eight height/bounds corners fit, regardless of time or camera pose.
export function farShadowBox(bounds,minY,maxY,sun,size){
  const length=Math.hypot(...sun),L=sun.map(v=>v/length),horizontal=Math.hypot(L[0],L[2]);
  const right=horizontal>1e-9?[L[2]/horizontal,0,-L[0]/horizontal]:[1,0,0];
  const up=[L[1]*right[2]-L[2]*right[1],L[2]*right[0]-L[0]*right[2],L[0]*right[1]-L[1]*right[0]];
  let left=Infinity,bottom=Infinity,back=Infinity,r=-Infinity,top=-Infinity,front=-Infinity;
  for(const x of [bounds.minX,bounds.maxX])for(const y of [minY,maxY+C.heightMargin])for(const z of [bounds.minZ,bounds.maxZ]){
    const p=[x,y,z],u=dot(p,right),v=dot(p,up),d=dot(p,L);
    left=Math.min(left,u);r=Math.max(r,u);bottom=Math.min(bottom,v);top=Math.max(top,v);back=Math.min(back,d);front=Math.max(front,d);
  }
  // Leave enough UV border for the largest filter; also include terrain outside the town footprint upstream.
  const pad=C.radiusMax+C.near;
  left-=pad;r+=pad;bottom-=pad;top+=pad;
  const span=Math.max(r-left,top-bottom),cx=(left+r)/2,cy=(bottom+top)/2;
  left=cx-span/2;bottom=cy-span/2;
  const origin=front+C.near,near=C.near,far=origin-back+C.near;
  const texel=span/size,depthStep=(far-near)/65535;
  if(depthStep>texel*C.precisionShare)throw new RangeError('遠景影の16bit深度精度が不足しています');
  return {right,up,L,left,bottom,span,origin,near,far,size,metersPerTexel:texel,depthStep};
}
export function farShadowProject(box,p,out){
  out[0]=(dot(p,box.right)-box.left)/box.span;out[1]=(dot(p,box.up)-box.bottom)/box.span;
  out[2]=(box.origin-dot(p,box.L)-box.near)/(box.far-box.near);return out;
}
// Bilinear read of the existing all-tier ground density field, including its river/road exclusions.
export function farShadowDensity(field,x,z){
  if(!field||Math.abs(x)>field.spanX/2||Math.abs(z)>field.spanZ/2)return 0;
  const u=Math.max(0,Math.min(field.size-1,(x/field.spanX+.5)*field.size-.5));
  const v=Math.max(0,Math.min(field.size-1,(z/field.spanZ+.5)*field.size-.5));
  const i=Math.floor(u),j=Math.floor(v),a=u-i,b=v-j,n=field.size;
  const k=(j*n+i)*4,r=(j*n+Math.min(n-1,i+1))*4,t=(Math.min(n-1,j+1)*n+i)*4,tr=(Math.min(n-1,j+1)*n+Math.min(n-1,i+1))*4;
  return ((field.bytes[k]*(1-a)+field.bytes[r]*a)*(1-b)+(field.bytes[t]*(1-a)+field.bytes[tr]*a)*b)/255;
}
// Bounded CPU mesh job; canopy quads exist only where all corners pass the density threshold.
export function createFarShadowGrid(terrain,bounds,cell,field,omit=null){
  const nx=Math.ceil((bounds.maxX-bounds.minX)/cell),nz=Math.ceil((bounds.maxZ-bounds.minZ)/cell),count=(nx+1)*(nz+1);
  const positions=new Float32Array(count*3),canopy=new Float32Array(count*3),indices=new Uint32Array(nx*nz*6),canopyIndices=new Uint32Array(indices.length),dense=new Uint8Array(count);
  let cursor=0,phase=0,offset=0,canopyCount=0,minY=Infinity,maxY=-Infinity,work=0;
  function step(limit=C.batch){
    let n=0;
    while(n++<limit&&phase<2){work++;
      if(phase===0){
        const i=cursor%(nx+1),j=Math.floor(cursor/(nx+1)),x=bounds.minX+i/nx*(bounds.maxX-bounds.minX),z=bounds.minZ+j/nz*(bounds.maxZ-bounds.minZ),y=terrain.heightAt(x,z),density=farShadowDensity(field,x,z),k=cursor*3;
        positions[k]=canopy[k]=x;positions[k+1]=y;canopy[k+1]=y+density*C.canopyHeight;positions[k+2]=canopy[k+2]=z;
        dense[cursor]=density>=C.canopyThreshold?1:0;minY=Math.min(minY,y);maxY=Math.max(maxY,y);
        if(++cursor===count){cursor=0;phase=1;}
      }else{
        const i=cursor%nx,j=Math.floor(cursor/nx),a=j*(nx+1)+i,b=a+1,c=a+nx+1,d=c+1;
        const inside=omit&&positions[a*3]>=omit.minX&&positions[d*3]<=omit.maxX&&positions[a*3+2]>=omit.minZ&&positions[d*3+2]<=omit.maxZ;
        if(!inside){indices[offset]=a;indices[offset+1]=c;indices[offset+2]=b;indices[offset+3]=b;indices[offset+4]=c;indices[offset+5]=d;offset+=6;}
        if(!inside&&dense[a]&&dense[b]&&dense[c]&&dense[d]){canopyIndices[canopyCount++]=a;canopyIndices[canopyCount++]=c;canopyIndices[canopyCount++]=b;canopyIndices[canopyCount++]=b;canopyIndices[canopyCount++]=c;canopyIndices[canopyCount++]=d;}
        if(++cursor===nx*nz)phase=2;
      }
    }
    return phase===2;
  }
  return {positions,canopy,indices,canopyIndices,step,get ready(){return phase===2;},get terrainCount(){return offset;},get canopyCount(){return canopyCount;},get minY(){return minY;},get maxY(){return maxY;},get work(){return work;}};
}
const gl=n=>Number.isInteger(n)?n.toFixed(1):String(n);
export const FAR_SHADOW_GLSL=`
uniform sampler2D farTown,farWhole;
uniform mat4 farTownMatrix,farWholeMatrix;
uniform vec4 farTownBounds;
uniform vec3 farSun,farTint;
uniform vec2 farTexels,farRanges;
uniform float farReady,farFlying,farStrength,farTaps;
float kzFarPCF(sampler2D depthMap,vec3 q,float texel,float rangeValue,float ndotl,float taps){
  if(any(lessThan(q,vec3(0.0)))||any(greaterThan(q,vec3(1.0))))return 0.0;
  float centre=texture2D(depthMap,q.xy).r;
  float gap=max(0.0,(q.z-centre)*rangeValue);
  float radius=min(${gl(C.radiusMax)},${gl(C.radiusBase)}+gap*${gl(C.radiusSlope)});
  float bias=(texel*(${gl(C.biasTexels)}+${gl(C.biasSlope)}*(1.0-clamp(ndotl,0.0,1.0))))/rangeValue;
  float amount=step(centre+bias,q.z);
  for(int i=1;i<9;i++){
    if(float(i)>=taps)break;
    float angle=float(i-1)*6.28318530718/(taps-1.0);
    vec2 delta=vec2(cos(angle),sin(angle))*radius;
    // q has square solar coordinates, map texture size supplies the world-to-UV scale.
    vec2 uv=q.xy+delta/(texel*vec2(textureSize(depthMap,0)));
    amount+=step(texture2D(depthMap,uv).r+bias,q.z);
  }
  return amount/taps;
}
float kzFarShadow(vec3 p,vec3 n){
  float ndotl=dot(n,farSun);
  if(farReady<.5||ndotl<=${gl(C.backface)})return 0.0;
  float fade=farFlying>.5?1.0:smoothstep(${gl(C.fadeFrom)},${gl(C.fadeTo)},distance(p,cameraWorld[3].xyz));
  if(fade<=0.0)return 0.0;
  float edge=min(min(p.x-farTownBounds.x,farTownBounds.z-p.x),min(p.z-farTownBounds.y,farTownBounds.w-p.z));
  float town=smoothstep(0.0,${gl(C.blend)},edge);
  vec3 qTown=(farTownMatrix*vec4(p,1.0)).xyz,qWhole=(farWholeMatrix*vec4(p,1.0)).xyz;
  float amount;
  if(town>=1.0)amount=kzFarPCF(farTown,qTown,farTexels.x,farRanges.x,ndotl,farTaps);
  else if(town<=0.0)amount=kzFarPCF(farWhole,qWhole,farTexels.y,farRanges.y,ndotl,farTaps);
  else amount=mix(kzFarPCF(farWhole,qWhole,farTexels.y,farRanges.y,ndotl,4.0),kzFarPCF(farTown,qTown,farTexels.x,farRanges.x,ndotl,4.0),town);
  return amount*fade;
}
vec3 kzFarApply(vec3 colorValue,float amount){
  float lum=dot(colorValue,vec3(.2126,.7152,.0722));
  return colorValue*mix(vec3(1.0),farTint,amount*farStrength*smoothstep(${gl(C.darkFrom)},${gl(C.darkTo)},lum));
}
`;
