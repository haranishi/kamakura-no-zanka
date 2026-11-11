// Terrain-derived valley field and CPU/GLSL mist mirror. No private data is persisted.
export const MIST = Object.freeze({
  floorFadeM: 10, // m: restore the original valley weight above the map's optional floor cutoff.
  gainMin: 0, gainMax: 2, floorMinM: -50, floorMaxM: 500, // allowed map settings, fractional gain / metres.
  cell: 32, // m: desired field sampling interval.
  maxSide: 512, // cells: maximum texture width/height.
  meanRadius: 350, // m: surrounding terrain average (circular neighbourhood).
  floorRadius: 250, // m: neighbourhood minimum for the valley floor.
  coastRadius: 150, // m: sea exclusion radius.
  seaHeight: .5, // m: sea threshold.
  low: 3, // m: depression below the surroundings where valleys begin.
  high: 12, // m: depression giving full valley weight.
  falloff: 22, // m: vertical exponential scale above the valley floor.
  scale: 380, // m: north/south noise scale.
  stretch: 2.2, // east/west noise scale relative to north/south.
  speed: 1.5, // m/s: shared wind translation.
  noiseBase: .16, // minimum noise modulation.
  noiseGain: .84, // variable noise modulation.
  wispFrom: .3, // noise value where a wisp begins (below: almost clear air between the bands).
  wispTo: .78, // noise value where a wisp is full.
  downThin: .3, // remaining share when looking straight down: a thin layer is nearly transparent from above.
  downFrom: .25, // |ray.y| where the thinning starts.
  downTo: .85, // |ray.y| where the thinning is complete.
  warmBase: .28, // warm share of the mist colour away from the sun (lit mist is never the cold far-haze blue).
  near: 120, // m: clear space around the camera.
  full: 500, // m: full distance strength.
  farStart: 7500, // m: start fading into the existing distance haze.
  far: 9000, // m: no additional valley mist beyond this distance.
  cap: .42, // maximum contribution at one sample.
  totalCap: .5, // maximum after the two intervening samples.
  pathWeight: .5, // each intervening sample's contribution.
  brightness: .95, // horizon luminance multiplier (hues come from existing haze).
  cellsPerFrame: 8192, // maximum work cells per render (also bounds injected clocks).
  batchCells: 64, // cells between time-budget checks.
  budgetMs: 2, // ms: field preparation budget per rendered frame.
});
export const MIST_TIMES = Object.freeze({ morning: .8, noon: .25, golden: .5, evening: .6 });
const clamp = x => Math.max(0,Math.min(1,x));
const smooth = (a,b,x) => { const t=clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export function mistStrength(time) { return MIST_TIMES[time] ?? MIST_TIMES.golden; }
// Four bounded phases: sample height, derive circular mean/min/coast, smooth floor,
// publish. One unit is a cell (at most a bounded disk of neighbours in phase 1).
export function validateMist(value){
  if(value===undefined)return value;
  if(!value||typeof value!=='object'||Array.isArray(value))throw new RangeError('meta.mist must be an object');
  for(const key of Object.keys(value)){
    const v=value[key],lo=key==='gain'?MIST.gainMin:key==='floor_m'?MIST.floorMinM:Infinity,hi=key==='gain'?MIST.gainMax:MIST.floorMaxM;
    if(!Number.isFinite(v)||v<lo||v>hi)throw new RangeError('Invalid meta.mist.'+key);
  }
  return value;
}
export function createMistField(terrain) {
  const settings=validateMist(terrain.meta?.mist),floorCutoff=settings?.floor_m;
  const b=terrain.bounds, spanX=b.maxX-b.minX, spanZ=b.maxZ-b.minZ;
  const cell=Math.max(MIST.cell,spanX/(MIST.maxSide-1),spanZ/(MIST.maxSide-1));
  const width=Math.min(MIST.maxSide,Math.ceil(spanX/cell)+1),height=Math.min(MIST.maxSide,Math.ceil(spanZ/cell)+1),cells=width*height;
  const heights=new Float32Array(cells),floor=new Float32Array(cells),data=new Float32Array(cells*2);
  const offsets=[];
  const radius=Math.ceil(MIST.meanRadius/cell);
  for(let dz=-radius;dz<=radius;dz++)for(let dx=-radius;dx<=radius;dx++){
    const d2=(dx*dx+dz*dz)*cell*cell;
    if(d2<=MIST.meanRadius*MIST.meanRadius)offsets.push(dx,dz,d2);
  }
  let phase=0,cursor=0,work=0;
  const field={ gain:settings?.gain??1,width,height,cells,cell,minX:b.minX,minZ:b.minZ,data,ready:false,
    get phase(){return phase;},get work(){return work;},
    step(budget=MIST.cellsPerFrame){
      if(field.ready)return true;
      for(let n=0;n<budget && phase<3;n++,work++){
        const i=cursor,x=i%width,z=Math.floor(i/width);
        if(phase===0)heights[i]=terrain.heightAt(b.minX+x*cell,b.minZ+z*cell);
        else if(phase===1){
          let sum=0,count=0,lowest=heights[i],coast=heights[i]<=MIST.seaHeight;
          for(let j=0;j<offsets.length;j+=3){
            const sx=x+offsets[j],sz=z+offsets[j+1],d2=offsets[j+2];
            if(sx<0||sx>=width||sz<0||sz>=height)continue;
            const h=heights[sz*width+sx];sum+=h;count++;
            if(d2<=MIST.floorRadius*MIST.floorRadius)lowest=Math.min(lowest,h);
            if(d2<=MIST.coastRadius*MIST.coastRadius && h<=MIST.seaHeight)coast=true;
          }
          data[i*2]=coast?0:smooth(MIST.low,MIST.high,sum/count-heights[i]);floor[i]=lowest;
        }else{
          let sum=0,count=0;
          for(let dz=-1;dz<=1;dz++)for(let dx=-1;dx<=1;dx++){
            const sx=x+dx,sz=z+dz;if(sx<0||sx>=width||sz<0||sz>=height)continue;
            sum+=floor[sz*width+sx];count++;
          }
          data[i*2+1]=sum/count;
          if(floorCutoff!==undefined)data[i*2]*=smooth(floorCutoff,floorCutoff+MIST.floorFadeM,data[i*2+1]);
        }
        if(++cursor===cells){cursor=0;phase++;}
      }
      field.ready=phase===3;return field.ready;
    },
  };
  return field;
}
// out=[valley weight, floor height]; bilinear mirror of a clamp-to-edge RG texture.
export function sampleMistField(field,x,z,out) {
  const gx=(x-field.minX)/field.cell,gz=(z-field.minZ)/field.cell;
  if(!field.ready||gx<0||gz<0||gx>field.width-1||gz>field.height-1){out[0]=out[1]=0;return out;}
  const ix=Math.floor(gx),iz=Math.floor(gz),fx=gx-ix,fz=gz-iz;
  const nx=Math.min(ix+1,field.width-1),nz=Math.min(iz+1,field.height-1),d=field.data;
  for(let c=0;c<2;c++)out[c]=(d[(iz*field.width+ix)*2+c]*(1-fx)+d[(iz*field.width+nx)*2+c]*fx)*(1-fz)+(d[(nz*field.width+ix)*2+c]*(1-fx)+d[(nz*field.width+nx)*2+c]*fx)*fz;
  return out;
}
const fract=x=>x-Math.floor(x);
const hash=(x,z)=>fract(Math.sin(x*127.1+z*311.7)*43758.5453);
export function mistNoise(x,z) {
  const ix=Math.floor(x),iz=Math.floor(z),u=smooth(0,1,x-ix),v=smooth(0,1,z-iz);
  return (hash(ix,iz)*(1-u)+hash(ix+1,iz)*u)*(1-v)+(hash(ix,iz+1)*(1-u)+hash(ix+1,iz+1)*u)*v;
}
export const mistWisp = n => smooth(MIST.wispFrom,MIST.wispTo,n);
export const mistDownward = rayY => 1-(1-MIST.downThin)*smooth(MIST.downFrom,MIST.downTo,Math.abs(rayY));
export function mistAmount(valley,floor,y,distance,noise,strength,gain=1) {
  return Math.min(MIST.cap*gain,valley*Math.exp(-Math.max(0,y-floor)/MIST.falloff)*(MIST.noiseBase+MIST.noiseGain*noise)*strength*
    smooth(MIST.near,MIST.full,distance)*(1-smooth(MIST.farStart,MIST.far,distance)));
}
// scratch=[valley,floor] is caller-owned; all three samples evaluate their actual altitude.
export function mistAlongRay(field,eye,point,time,dirX,dirZ,strength,scratch) {
  const dx=point.x-eye.x,dy=point.y-eye.y,dz=point.z-eye.z,distance=Math.hypot(dx,dy,dz);
  let amount=0;
  for(let i=1;i<=3;i++){
    const t=i/3,x=eye.x+dx*t,y=eye.y+dy*t,z=eye.z+dz*t;
    sampleMistField(field,x,z,scratch);
    const n=mistWisp(mistNoise((x-dirX*MIST.speed*time)/(MIST.scale*MIST.stretch),(z-dirZ*MIST.speed*time)/MIST.scale));
    amount+=mistAmount(scratch[0],scratch[1],y,distance*t,n,strength,field.gain??1)*(i===3?1:MIST.pathWeight);
  }
  return Math.min(MIST.totalCap*(field.gain??1),amount)*(1-smooth(MIST.farStart,MIST.far,distance))*mistDownward(distance>0?dy/distance:0);
}
const f=x=>Number(x).toFixed(6);
export const MIST_GLSL = `
uniform sampler2D mistField;
uniform vec4 mistBounds;
uniform vec2 mistPixels, mistWind;
uniform float mistReady, mistStrength, mistTime, mistHazeExp;
uniform vec3 mistCool, mistWarm, mistSun;
vec2 kzValley(vec2 xz){
  if(mistReady<.5)return vec2(0.);
  vec2 uv=(xz-mistBounds.xy)/mistBounds.zw;
  if(any(lessThan(uv,vec2(0.)))||any(greaterThan(uv,vec2(1.))))return vec2(0.);
  return texture2D(mistField,mix(mistPixels*.5,vec2(1.)-mistPixels*.5,uv)).rg*mistReady;
}
float kzMistHash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float kzMistNoise(vec2 p){
  vec2 cell=floor(p),f=fract(p),u=f*f*(3.-2.*f);
  return mix(mix(kzMistHash(cell),kzMistHash(cell+vec2(1.,0.)),u.x),mix(kzMistHash(cell+vec2(0.,1.)),kzMistHash(cell+vec2(1.,1.)),u.x),u.y);
}
float kzMistAt(vec3 p,float distanceValue){
  vec2 valley=kzValley(p.xz);
  vec2 n=(p.xz-mistWind*mistTime*${f(MIST.speed)})/vec2(${f(MIST.scale*MIST.stretch)},${f(MIST.scale)});
  float amount=valley.r*exp(-max(0.,p.y-valley.g)/${f(MIST.falloff)})*(${f(MIST.noiseBase)}+${f(MIST.noiseGain)}*smoothstep(${f(MIST.wispFrom)},${f(MIST.wispTo)},kzMistNoise(n)))*mistStrength;
  return min(${f(MIST.cap)},amount*smoothstep(${f(MIST.near)},${f(MIST.full)},distanceValue)*(1.-smoothstep(${f(MIST.farStart)},${f(MIST.far)},distanceValue)));
}
float kzMistAmount(vec3 p){
  vec3 eye=cameraWorld[3].xyz;
  float d=length(p-eye);
  float amount=kzMistAt(p,d)+${f(MIST.pathWeight)}*(kzMistAt(mix(eye,p,1./3.),d/3.)+kzMistAt(mix(eye,p,2./3.),d*2./3.));
  float rise=(p.y-eye.y)/max(d,.001);
  float down=1.-${f(1-MIST.downThin)}*smoothstep(${f(MIST.downFrom)},${f(MIST.downTo)},max(rise,-rise));
  return min(${f(MIST.totalCap)},amount)*(1.-smoothstep(${f(MIST.farStart)},${f(MIST.far)},d))*down;
}
vec3 kzMistColor(vec3 p){
  vec3 ray=normalize(p-cameraWorld[3].xyz);
  float warm=pow(max(0.,dot(ray,mistSun)),mistHazeExp);
  return mix(mistCool,mistWarm,clamp(warm+${f(MIST.warmBase)},0.,1.));
}
`;

// Absent map settings return the exact original shader, including whitespace.
// Floor masking is baked into the existing R channel; only the two cap literals change.
export function mistShader(settings){
  validateMist(settings);
  const gain=settings?.gain??1;
  if(gain===1)return MIST_GLSL;
  return MIST_GLSL.replace('min('+f(MIST.cap)+',amount','min('+f(MIST.cap*gain)+',amount')
    .replace('min('+f(MIST.totalCap)+',amount','min('+f(MIST.totalCap*gain)+',amount');
}
