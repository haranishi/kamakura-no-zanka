// One opaque crossed-card mesh for all five species, receiving the ground light and shadows.
import * as THREE from '../vendor/three.module.min.js';
import { GUST_GLSL } from './kamakura-gust.js';
import { FIELDS, FIELD_KINDS, FIELD_NAMES, fieldOptions, fieldMapDensity, createFieldMap, createFieldCell, stepFieldCell } from './kamakura-fields.js';
import { fieldPlantKit, FIELD_HEIGHTS, FIELD_CARD_WIDTHS, FIELD_LEAF, FIELD_BLOOMS } from './kamakura-fields-kit.js';

export const FIELD_CAPACITY = 16000;
// Parent (real Chrome): the modelled plants could only be given to a few hundred of the thousands near the viewer, and the
// rest were cards in one mean colour: a field read as a wall of yellow slabs. The cards now draw the clump themselves
// (stems, leaves and flower heads; for susuki a fan of blades with plumed stalks) and are used at every distance.
const glsl3=c=>`vec3(${c.map(v=>v.toFixed(6)).join(', ')})`;
const aspects=FIELD_CARD_WIDTHS.map((w,i)=>(w/FIELD_HEIGHTS[i]).toFixed(6));
export const FIELD_CARD_GLSL = `
const vec3 kzFieldLeafColor = ${glsl3(FIELD_LEAF)};
const vec3 kzFieldStraw = vec3(0.470000, 0.390000, 0.120000);
vec3 kzFieldBloomColor(float kind) {
  return kind < 0.5 ? ${glsl3(FIELD_BLOOMS[0])} : kind < 1.5 ? ${glsl3(FIELD_BLOOMS[1])} : kind < 2.5 ? ${glsl3(FIELD_BLOOMS[2])} : kind < 3.5 ? ${glsl3(FIELD_BLOOMS[3])} : ${glsl3(FIELD_BLOOMS[4])};
}
float kzFieldRand(float n) { return fract(sin(n * 91.3458) * 47453.5453); }
// What a point of the card shows: 0 nothing, 1 leaf or stem, 2 flower or plume, 3 the heart of a flower.
// uv runs 0..1 across and up the card; coarse cards (a few pixels tall) keep only a simple outline.
float kzFieldCard(float kind, vec2 uv, float seed, float coarse, float fine) {
  float u = uv.x * 2.0 - 1.0, v = uv.y;
  if (kind < 0.5) {
    // Small on screen: a fan of leaves with a few pale tufts above it.
    if (coarse > 0.5) return v > 0.62 ? (length(vec2(fract(u * 1.5 + seed) - 0.5, (v - 0.80) * 1.6)) < 0.30 ? 2.0 : 0.0) : (abs(u) < mix(0.08, 0.9, v / 0.62) ? 1.0 : 0.0);
    // A tussock: blades fan out from one root and arc outward; some rays are stalks that end in a plume.
    vec2 p = vec2(u * 0.5 * ${aspects[0]}, v);
    float rho = length(p), theta = atan(p.x, p.y) * (1.0 - 0.32 * min(rho, 1.0));
    if (abs(theta) > 1.25) return 0.0;
    float cells = (theta + 1.25) * 4.4 + seed * 7.0, cell = floor(cells), c = fract(cells) - 0.5;
    float h1 = kzFieldRand(cell + seed * 31.0), h2 = kzFieldRand(cell * 1.7 + 5.0 + seed * 13.0);
    bool stalk = h2 > 0.42 && abs(theta) < 0.6;
    float len = stalk ? mix(0.74, 1.0, h1) : mix(0.42, 0.78, h1);
    if (rho > len) return 0.0;
    if (stalk) {
      // The plume is a slim feather that droops to one side toward its tip.
      float along = (rho - len + 0.26) / 0.26;
      float droop = c - sign(h1 - 0.5) * 0.30 * max(along, 0.0) * max(along, 0.0);
      if (along > 0.0) {
        float reach = 0.035 + 0.13 * sin(3.141593 * min(1.0, along * 1.04));
        // Close up, the feather is cut into barbs that point up and out; from afar it stays a slim solid shape.
        float barb = fine > 0.5 ? step(fract(along * 15.0 - abs(droop) * 9.0), 0.62) : 1.0;
        return abs(droop) < 0.02 || (abs(droop) < reach && barb > 0.5) ? 2.0 : 0.0;
      }
      return abs(c) < 0.05 ? 1.0 : 0.0;
    }
    return abs(c) < 0.05 + 0.30 * (1.0 - rho / len) ? 1.0 : 0.0;
  }
  if (kind < 3.5) {
    // Small on screen: thin stems under a few round heads (a solid top read as a slab).
    if (coarse > 0.5) return v > 0.60 ? (length(vec2(fract(u * 1.5 + seed) - 0.5, (v - 0.80) * 2.0)) < 0.36 ? 2.0 : 0.0) : (abs(fract(u * 1.5 + seed) - 0.5) < 0.12 ? 1.0 : 0.0);
    // A few stems side by side, each with leaves and a head: a star (kikyo), flat umbels (ominaeshi) or trumpets (yamayuri).
    float count = kind < 1.5 ? 4.0 : kind < 2.5 ? 3.0 : 2.0;
    float aspect = kind < 1.5 ? ${aspects[1]} : kind < 2.5 ? ${aspects[2]} : ${aspects[3]};
    float cells = (u * 0.5 + 0.5) * count, cell = floor(cells), c = fract(cells) - 0.5;
    float h1 = kzFieldRand(cell + seed * 17.0), h2 = kzFieldRand(cell * 2.3 + 1.0 + seed * 29.0);
    float top = mix(0.62, 0.92, h1), x = c + (h2 - 0.5) * 0.5 * v, wide = aspect / count;
    vec2 d = vec2(x * wide, v - top);
    if (kind < 1.5) {
      float r = length(d), a = atan(d.y, d.x);
      if (r < 0.085 * (0.78 + 0.22 * cos(a * 5.0 + h2 * 6.0))) return r < 0.018 ? 3.0 : 2.0;
    } else if (kind < 2.5) {
      if (length(d * vec2(1.0, 2.6)) < 0.125) return 2.0;
      vec2 e = vec2((x - sign(h2 - 0.5) * 0.24) * wide, v - top + 0.15);
      if (length(e * vec2(1.0, 2.6)) < 0.075) return 2.0;
    } else {
      float r = length(d * vec2(1.0, 1.25));
      if (r < 0.085) return r < 0.022 ? 3.0 : 2.0;
      vec2 e = vec2((x + sign(h2 - 0.5) * 0.34) * wide, v - top + 0.17);
      float r2 = length(e * vec2(1.0, 1.25));
      if (h1 > 0.35 && r2 < 0.07) return r2 < 0.018 ? 3.0 : 2.0;
    }
    if (v < top && abs(x) < 0.05) return 1.0;
    float rung = fract(v * (kind < 2.5 ? 5.0 : 9.0) + h1 * 3.0), blade = abs(rung - 0.5);
    float side = step(0.5, fract(v * (kind < 2.5 ? 2.5 : 4.5) + h1 * 1.5)) * 2.0 - 1.0;
    if (v < top - 0.10 && blade < 0.16 && x * side > 0.0 && abs(x) < 0.34 * (1.0 - blade / 0.16)) return 1.0;
    return 0.0;
  }
  // Beach bindweed, seen from above: a round mat of leaves with pink funnels.
  if (length(uv - 0.5) > 0.5) return 0.0;
  vec2 g = uv * 4.0 + seed * 9.0, id = floor(g), q = fract(g) - 0.5;
  float h1 = kzFieldRand(id.x * 7.3 + id.y * 13.7 + seed * 3.0), h2 = kzFieldRand(id.x * 3.1 + id.y * 5.9 + 2.0 + seed);
  q += (vec2(h1, h2) - 0.5) * 0.3;
  float r = length(q);
  if (h2 > 0.68) return r < 0.10 ? 3.0 : r < 0.34 ? 2.0 : 0.0;
  return r < 0.40 && h1 > 0.2 ? 1.0 : 0.0;
}
`;
export const FIELD_VERTEX_PARS = `
uniform float uFieldTime, uFieldWind, uFieldMotion, uFieldRadius, uFieldViewport;
uniform vec2 uFieldDir;
uniform vec3 uFieldViewer, uFieldHero, uFieldSun;
attribute vec3 aFieldShape;
attribute vec3 aFieldTint;
attribute float aFieldHeight;
varying vec3 vFieldTint;
varying float vFieldLight, vFieldBand, vFieldKind, vFieldPixels, vFieldSeed, vFieldCardPx;
${GUST_GLSL}
`;
export function fieldVertexBody() {return `
vec3 fieldRoot = instanceMatrix[3].xyz;
float fieldDistance = distance(fieldRoot.xz, uFieldViewer.xz);
float fieldOuter = 1.0 - smoothstep(uFieldRadius - 10.0, uFieldRadius, fieldDistance);
float fieldScale = fieldOuter * aFieldShape.z;
bool fieldFlat = aFieldShape.x > 3.5;
if (fieldFlat && abs(position.z) > 0.001) fieldScale = 0.0;
vec3 transformed = position * fieldScale;
// The bindweed mat lies on the sand: the upright card is laid flat, a few centimetres above the ground.
if (fieldFlat) transformed = vec3(position.x, 0.35, position.y - 0.5) * fieldScale;
float fieldBand = kzGustBand(fieldRoot.xz, uFieldTime, uFieldDir);
float fieldMax = aFieldShape.x < 0.5 ? ${(35*Math.PI/180).toFixed(8)} : ${(15*Math.PI/180).toFixed(8)};
// Calm motion uses the same world phase; no per-plant phase breaks up the wave front.
float fieldAngle = fieldMax * uFieldMotion * clamp(uFieldWind, 0.0, 1.5) / 1.5 * (0.12 + 0.08 * sin(dot(fieldRoot.xz, uFieldDir) * 0.045 - uFieldTime * 0.9) + 0.80 * fieldBand);
vec2 fieldLocalWind = vec2(dot(uFieldDir, normalize(instanceMatrix[0].xz)), dot(uFieldDir, normalize(instanceMatrix[2].xz)));
float fieldBend = fieldFlat ? 0.0 : clamp(position.y / aFieldHeight, 0.0, 1.0);
transformed.xz += fieldLocalWind * sin(fieldAngle * fieldBend) * transformed.y;
transformed.y *= cos(fieldAngle * fieldBend);
vec2 fieldAway = fieldRoot.xz - uFieldHero.xz;
float fieldHeroDistance = length(fieldAway);
vec2 fieldPush = fieldAway / max(fieldHeroDistance, 0.0001);
vec2 fieldLocalPush = vec2(dot(fieldPush, normalize(instanceMatrix[0].xz)), dot(fieldPush, normalize(instanceMatrix[2].xz)));
float fieldPart = (1.0 - smoothstep(0.0, 0.90, fieldHeroDistance)) * uFieldMotion;
transformed.xz += fieldLocalPush * transformed.y * fieldBend * fieldPart * 0.75;
transformed.y *= 1.0 - fieldPart * fieldBend * 0.35;
vFieldTint = aFieldTint;
vFieldBand = fieldBand * uFieldMotion;
vFieldKind = aFieldShape.x;
vec3 fieldViewRoot = (viewMatrix * vec4(fieldRoot, 1.0)).xyz;
float fieldFeature = aFieldShape.x < 0.5 ? 0.24 : aFieldShape.x > 3.5 ? 1.0 : 0.12;
vFieldPixels = aFieldHeight * length(instanceMatrix[1].xyz) * fieldFeature * uFieldViewport * 0.5 * projectionMatrix[1][1] / max(0.1, -fieldViewRoot.z);
vFieldLight = pow(max(0.0, dot(normalize(fieldRoot - cameraPosition + vec3(0.0, 0.00001, 0.0)), uFieldSun)), 5.0);
vFieldSeed = aFieldShape.y;
vFieldCardPx = aFieldHeight * length(instanceMatrix[1].xyz) * uFieldViewport * 0.5 * projectionMatrix[1][1] / max(0.1, -fieldViewRoot.z);
`;}
export const FIELD_FRAGMENT_PARS = `
uniform float uFieldDebug;
varying vec3 vFieldTint;
varying float vFieldLight, vFieldBand, vFieldKind, vFieldPixels, vFieldSeed, vFieldCardPx;
`;
export const FIELD_FRAGMENT_LIGHT = `
// Subpixel pale features have a luminance ceiling instead of turning into white sparks.
float fieldSmall = 1.0 - smoothstep(1.20, 2.20, vFieldPixels);
float fieldLuma = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
outgoingLight *= mix(1.0, min(1.0, 0.30 / max(0.0001, fieldLuma)), fieldSmall);
// Plumes and petals glow when the sun is behind them; susuki most of all.
outgoingLight = min(outgoingLight * (1.0 + 0.10 * vFieldBand) + diffuseColor.rgb * fieldPetalMask * vFieldLight * (vFieldKind < 0.5 ? 0.60 : 0.24) * (1.0 - fieldSmall), vec3(0.90));
if (uFieldDebug > 0.5) {
  outgoingLight = vFieldKind < 0.5 ? vec3(0.75, 0.68, 0.42) : vFieldKind < 1.5 ? vec3(0.30, 0.12, 0.72) : vFieldKind < 2.5 ? vec3(0.85, 0.62, 0.05) : vFieldKind < 3.5 ? vec3(0.80, 0.80, 0.70) : vec3(0.78, 0.25, 0.45);
}
`;
export const FIELD_FAR_SILHOUETTE = `
float fieldPartId = kzFieldCard(vFieldKind, vFieldUv, vFieldSeed, step(vFieldCardPx, 26.0), step(230.0, vFieldCardPx));
if (fieldPartId < 0.5) discard;
// Each flower head differs a little in brightness, so a field is not one flat colour.
vec3 fieldBloom = kzFieldBloomColor(vFieldKind) * (0.86 + 0.28 * kzFieldRand(floor(vFieldUv.x * 4.0) + vFieldSeed * 53.0));
vec3 fieldLeafTone = vFieldKind < 0.5 ? mix(kzFieldLeafColor * 0.8, kzFieldStraw, smoothstep(0.25, 0.95, vFieldUv.y)) : kzFieldLeafColor * mix(0.72, 1.12, vFieldUv.y);
vec3 fieldHeart = vFieldKind < 1.5 ? fieldBloom * 0.45 : vFieldKind < 3.5 ? kzFieldBloomColor(2.0) : mix(fieldBloom, vec3(0.9), 0.6);
diffuseColor.rgb = (fieldPartId > 2.5 ? fieldHeart : fieldPartId > 1.5 ? fieldBloom : fieldLeafTone) * vFieldTint;
float fieldPetalMask = step(1.5, fieldPartId);
`;
function makePool(uniforms) {
  const kit=fieldPlantKit(),g=new THREE.BufferGeometry(),capacity=FIELD_CAPACITY;
  g.setAttribute('uv',new THREE.BufferAttribute(kit.uvs,2));
  g.setAttribute('position',new THREE.BufferAttribute(kit.positions,3));g.setAttribute('normal',new THREE.BufferAttribute(kit.normals,3));
  g.setAttribute('color',new THREE.BufferAttribute(new Float32Array(kit.positions.length).fill(1),3));
  const shape=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage);
  const tint=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage);
  const heights=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aFieldShape',shape);g.setAttribute('aFieldTint',tint);g.setAttribute('aFieldHeight',heights);
  const m=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide,fog:true});
  m.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+FIELD_VERTEX_PARS+'\nvarying vec2 vFieldUv;').replace('#include <begin_vertex>',fieldVertexBody()+'\nvFieldUv = uv;');
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+FIELD_FRAGMENT_PARS+'\nvarying vec2 vFieldUv;\n'+FIELD_CARD_GLSL)
      .replace('#include <color_fragment>','#include <color_fragment>\n'+FIELD_FAR_SILHOUETTE)
      .replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>\nnormal = normalize(vNormal);')
      .replace('#include <opaque_fragment>',FIELD_FRAGMENT_LIGHT+'\n#include <opaque_fragment>');
  };
  m.defines={USE_UV:''};
  m.customProgramCacheKey=()=>'kz-fields-v2-far';
  const mesh=new THREE.InstancedMesh(g,m,capacity);mesh.name='kamakura-fields-far';
  mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.castShadow=false;
  const free=[];for(let i=capacity-1;i>=0;i--)free.push(i);
  const uploads=[tint,heights,mesh.instanceMatrix].map(attribute=>({attribute,range:{start:0,count:0}}));
  return {mesh,shape,tint,heights,free,uploads,triangles:kit.triangles,used:0,dirty:false,uploadLo:Infinity,uploadHi:-1};
}

export function createKamakuraFields(context,options={}) {
  const config=fieldOptions(context.search);if(!config.enabled)return null;
  config.density*=fieldMapDensity(context.data?.meta,context.search);
  const reduced=options.reducedMotion??globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
  const now=options.now??(()=>performance.now());
  const map=options.map??createFieldMap({...context,seed:config.seed});
  const viewport=new THREE.Vector2();
  const uniforms={uFieldViewport:{value:720},uFieldTime:{value:0},uFieldWind:{value:1},uFieldMotion:{value:reduced?.4:1},uFieldRadius:{value:context.quality==='light'?45:70},
    uFieldDir:{value:new THREE.Vector2(1,0)},uFieldViewer:{value:new THREE.Vector3()},uFieldHero:{value:new THREE.Vector3()},uFieldSun:{value:context.sunDir?.clone()??new THREE.Vector3(0,1,0)},uFieldDebug:{value:config.debug?1:0}};
  const pool=makePool(uniforms);
  context.scene.add(pool.mesh);
  const cells=new Map(),queue=[],matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),scale=new THREE.Vector3(),position=new THREE.Vector3();
  const here={},nearest={kind:null,distance:Infinity,bearing:0},byKind={};
  let disposed=false,paused=false,step=0,planX=Infinity,planZ=Infinity,job=null,probe=0,completed=0,operations=0;
  let radius=context.quality==='light'?45:70,density=config.density*(context.quality==='light'?.6:1);
  function release(slot) {
    if(slot<0)return;pool.free.push(slot);pool.used--;pool.shape.array[slot*3+2]=0;pool.dirty=true;
  }
  function evict(cell) {
    for(const r of cell.records)if(r.slot!==undefined)release(r.slot);
    cells.delete(cell.key);
  }
  function place(r,ready) {
    if(!pool.free.length)return -1;
    const slot=pool.free.pop();pool.used++;
    position.set(r.x,context.terrain.heightAt(r.x,r.z)+.005,r.z);
    rotation.setFromAxisAngle(axis,r.yaw);scale.set(FIELD_CARD_WIDTHS[r.kind]*r.scale,FIELD_HEIGHTS[r.kind]*r.scale,FIELD_CARD_WIDTHS[r.kind]*r.scale);
    matrix.compose(position,rotation,scale);pool.mesh.setMatrixAt(slot,matrix);pool.mesh.count=Math.max(pool.mesh.count,slot+1);
    const a=pool.shape.array,o=slot*3;a[o]=r.kind;a[o+1]=r.variant;a[o+2]=ready;
    const t=slot*3;
    pool.tint.array[t]=r.tint*(1+r.hue);pool.tint.array[t+1]=r.tint;pool.tint.array[t+2]=r.tint*(1-r.hue);
    pool.heights.array[slot]=1;
    pool.uploadLo=Math.min(pool.uploadLo,slot);pool.uploadHi=Math.max(pool.uploadHi,slot);
    pool.dirty=true;return slot;
  }
  function plan(x,z,yaw) {
    planX=x;planZ=z;queue.length=0;
    for(const c of cells.values())if(Math.hypot(c.cx*10+5-x,c.cz*10+5-z)>radius+15)evict(c);
    if(job&&Math.hypot(job.cx*10+5-x,job.cz*10+5-z)>radius+15) {
      for(const r of job.records)if(r.slot!==undefined)release(r.slot);job=null;
    }
    const n=Math.ceil((radius+8)/10),cx=Math.floor(x/10),cz=Math.floor(z/10),fx=-Math.sin(yaw),fz=-Math.cos(yaw);
    for(let j=cz-n;j<=cz+n;j++)for(let i=cx-n;i<=cx+n;i++) {
      const dx=i*10+5-x,dz=j*10+5-z,d=Math.hypot(dx,dz),key=`${i},${j}`;
      if(d>radius+8||cells.has(key)||job?.key===key)continue;
      queue.push({cx:i,cz:j,key,priority:d-(dx*fx+dz*fz)*.25});
    }
    queue.sort((a,b)=>a.priority-b.priority||a.cz-b.cz||a.cx-b.cx);
  }
  function inspect() {
    return {kindHere:here.kind??null,strengthHere:here.strength??0,cells:{built:cells.size,pending:queue.length+(job?1:0)},instances:pool.used,triangles:pool.mesh.count*pool.triangles,draws:pool.mesh.visible&&pool.mesh.count?1:0,nearest:{...nearest},byKind:{...byKind},work:{operations,completed},capacity:FIELD_CAPACITY};
  }
  const debug=new URLSearchParams(context.search).get('debug')==='1';if(debug)globalThis.__kzFields=inspect;
  const sampleNearest=(x,z)=>{
    // Bounded progressive search, debug only; scans synthetic grid offsets without retaining world data.
    const side=41,i=probe++%(side*side),dx=(i%side-20)*20,dz=(Math.floor(i/side)-20)*20;
    const f=map.fieldAt(x+dx,z+dz,here);
    if(f.strength>0&&Math.hypot(dx,dz)<nearest.distance){nearest.kind=f.kind;nearest.distance=Math.hypot(dx,dz);nearest.bearing=Math.atan2(dx,-dz);}
    // Per kind as well, with a compass bearing in degrees and the place, for finding a field of each colour.
    if(f.strength>.6&&!(byKind[f.kind]?.distance<=Math.hypot(dx,dz)))byKind[f.kind]={distance:Math.round(Math.hypot(dx,dz)),bearing:Math.round((Math.atan2(dx,-dz)*180/Math.PI+360)%360),east:Math.round(x+dx),north:Math.round(-(z+dz))};
  };
  return {
    update(frame) {
      if(disposed||paused||step>=3)return;
      const x=frame.pos.x,z=frame.pos.z;
      uniforms.uFieldTime.value=frame.time;uniforms.uFieldWind.value=frame.wind;uniforms.uFieldDir.value.set(frame.windDir[0],frame.windDir[1]);
      uniforms.uFieldViewer.value.set(x,frame.pos.y,z);
      const hp=context.hero?.pos??frame.hero?.pos??frame.pos;uniforms.uFieldHero.value.set(hp.x,hp.y??0,hp.z);
      if(context.sunDir)uniforms.uFieldSun.value.copy(context.sunDir);
      if(context.renderer?.getDrawingBufferSize){context.renderer.getDrawingBufferSize(viewport);uniforms.uFieldViewport.value=viewport.y;}
      const start=now();completed=0;operations=0;
      if(Math.hypot(x-planX,z-planZ)>=5) {plan(x,z,frame.yaw);nearest.kind=null;nearest.distance=Infinity;probe=0;for(const k in byKind)delete byKind[k];}
      // Even a very slow frame performs at most 384 candidate/slot operations and four cell commits.
      while(operations<FIELDS.work-32&&completed<FIELDS.cellsPerFrame&&now()-start<FIELDS.budgetMs) {
        if(!job) {
          const next=queue.shift();if(!next)break;
          job=createFieldCell(map,next.cx,next.cz,{seed:config.seed,density});
        }
        if(!job.done){stepFieldCell(map,job,16);operations+=16;}
        if(!job.done)continue;
        // Publish only complete cells. Admission favors nearby cells; later far cells are thinned first.
        if(job.publish===undefined) {
          job.publish=0;
          const distance=Math.hypot(job.cx*10+5-x,job.cz*10+5-z);
          if(distance<40&&job.records.length>pool.free.length) {
            let farthest=null,best=distance+15;
            for(const c of cells.values()) {
              const d=Math.hypot(c.cx*10+5-x,c.cz*10+5-z);
              if(d>best&&c.records.some(r=>r.slot>=0)){farthest=c;best=d;}
            }
            if(farthest)evict(farthest);
          }
        }
        if(job.publish<job.records.length) {
          const end=Math.min(job.records.length,job.publish+16);
          for(;job.publish<end;job.publish++) {
            const r=job.records[job.publish];r.slot=place(r,0);
            operations++;
          }
          continue;
        }
        for(const r of job.records)if(r.slot>=0) {
          pool.shape.array[r.slot*3+2]=1;pool.dirty=true;
        }
        cells.set(job.key,job);job=null;completed++;
      }
      {
        const p=pool;
        p.mesh.visible=step<3&&p.used>0;
        if(p.dirty) {
          p.shape.needsUpdate=true;
          if(p.uploadHi>=0) {
            // Include outstanding ranges until the renderer acknowledges the upload. One bounded range per attribute.
            for(const upload of p.uploads) {
              const attr=upload.attribute,size=attr.itemSize,prior=attr.updateRanges[0],range=upload.range;
              const lo=Math.min(p.uploadLo*size,prior?.start??Infinity),hi=Math.max((p.uploadHi+1)*size,prior?prior.start+prior.count:0);
              range.start=lo;range.count=hi-lo;
              if(!prior)attr.updateRanges.push(range);
              attr.needsUpdate=true;
            }
            p.uploadLo=Infinity;p.uploadHi=-1;
          }
          p.dirty=false;
        }
      }
      if(debug){for(let i=0;i<8;i++)sampleNearest(x,z);}
      map.fieldAt(x,z,here);if(debug&&here.strength>0){nearest.kind=here.kind;nearest.distance=0;nearest.bearing=0;}
    },
    setAdapt(next) {
      if(disposed)return;step=next;radius=step>=2||context.quality==='light'?45:70;uniforms.uFieldRadius.value=radius;
      density=config.density*(step>=2||context.quality==='light'?.6:1);
      pool.mesh.visible=step<3;
      for(const c of cells.values())evict(c);
      if(job){for(const r of job.records)if(r.slot!==undefined)release(r.slot);job=null;}
      queue.length=0;planX=Infinity;
    },
    setPaused(on){paused=!!on;},
    debugText(){if(disposed)return '';const n=pool.used;return `野 ${FIELD_NAMES[FIELD_KINDS.indexOf(here.kind)]??'なし'} 区画${cells.size} 株${(n/1000).toFixed(1)}k${step>=3?' 停止':''}`;},
    dispose() {
      if(disposed)return;disposed=true;
      context.scene.remove(pool.mesh);pool.mesh.geometry.dispose();pool.mesh.material.dispose();pool.mesh.dispose();
      cells.clear();queue.length=0;job=null;
      if(globalThis.__kzFields===inspect)delete globalThis.__kzFields;
    },
  };
}
