// Five near plant pools and one shared far silhouette pool: six opaque, shadow-receiving draws.
import * as THREE from '../vendor/three.module.min.js';
import { GUST_GLSL } from './kamakura-gust.js';
import { FIELDS, FIELD_KINDS, FIELD_NAMES, fieldOptions, createFieldMap, createFieldCell, stepFieldCell } from './kamakura-fields.js';
import { fieldPlantKit, FIELD_HEIGHTS, FIELD_WIDTHS, FIELD_CARD_WIDTHS, FIELD_LEAF, FIELD_BLOOMS } from './kamakura-fields-kit.js';

export const FIELD_CAPACITIES = Object.freeze([600,450,450,180,420,16000]);
// Parent (real Chrome): the modelled plants could only be given to a few hundred of the thousands near the viewer, and the
// rest were cards in one mean colour: a field read as a wall of yellow slabs. The cards now draw the clump themselves
// (stems, leaves and flower heads; for susuki a fan of blades with plumed stalks) and are used at every distance.
export const FIELD_NEAR_RADIUS = 0;
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
attribute vec4 aFieldShape;
attribute vec3 aFieldTint;
attribute float aFieldHeight, aFieldCluster, aFieldPetal;
varying vec3 vFieldTint;
varying float vFieldLight, vFieldBand, vFieldPetal, vFieldKind, vFieldPixels, vFieldSeed, vFieldCardPx;
${GUST_GLSL}
`;
export function fieldVertexBody(far=false) {return `
vec3 fieldRoot = instanceMatrix[3].xyz;
float fieldDistance = distance(fieldRoot.xz, uFieldViewer.xz);
float fieldOuter = 1.0 - smoothstep(uFieldRadius - 10.0, uFieldRadius, fieldDistance);
float fieldLod = ${far?'mix(1.0, smoothstep(28.0, 32.0, fieldDistance), aFieldShape.w)':'1.0 - smoothstep(24.0, 28.0, fieldDistance)'};
float fieldScale = fieldOuter * fieldLod * aFieldShape.z;
${far?'bool fieldFlat = aFieldShape.x > 3.5;\nif (fieldFlat && abs(position.z) > 0.001) fieldScale = 0.0;':'bool fieldFlat = false;'}
float fieldLimit = aFieldShape.x < 0.5 ? 3.0 + floor(aFieldShape.y * 4.0) : (aFieldShape.x < 2.5 ? 1.0 + floor(aFieldShape.y * 3.0) : 1.0 + floor(aFieldShape.y * 4.0));
if (aFieldCluster > fieldLimit) fieldScale = 0.0;
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
vFieldPetal = aFieldPetal;
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
varying float vFieldLight, vFieldBand, vFieldPetal, vFieldKind, vFieldPixels, vFieldSeed, vFieldCardPx;
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
function makePool(index,uniforms) {
  const far=index===5,kit=fieldPlantKit(far?0:index,far),g=new THREE.BufferGeometry(),capacity=FIELD_CAPACITIES[index];
  if(far) {
    for(let i=0;i<kit.positions.length;i+=3){kit.positions[i]/=FIELD_WIDTHS[0];kit.positions[i+1]/=FIELD_HEIGHTS[0];kit.positions[i+2]/=FIELD_WIDTHS[0];}
    kit.colors.fill(1);
    // Cards take the light of the ground they stand on (an upward normal): lit by their own facing, one of the two crossed
    // planes was always the dark one, and a field read as bars.
    for(let i=0;i<kit.normals.length;i+=3){kit.normals[i]=0;kit.normals[i+1]=1;kit.normals[i+2]=0;}
  }
  if(far)g.setAttribute('uv',new THREE.Float32BufferAttribute([0,0,1,0,1,1,0,0,1,1,0,1,0,0,1,0,1,1,0,0,1,1,0,1],2));
  g.setAttribute('position',new THREE.BufferAttribute(kit.positions,3));g.setAttribute('normal',new THREE.BufferAttribute(kit.normals,3));g.setAttribute('color',new THREE.BufferAttribute(kit.colors,3));
  g.setAttribute('aFieldCluster',new THREE.BufferAttribute(kit.clusters,1));g.setAttribute('aFieldPetal',new THREE.BufferAttribute(kit.petals,1));
  const shape=new THREE.InstancedBufferAttribute(new Float32Array(capacity*4),4).setUsage(THREE.DynamicDrawUsage);
  const tint=new THREE.InstancedBufferAttribute(new Float32Array(capacity*3),3).setUsage(THREE.DynamicDrawUsage);
  const heights=new THREE.InstancedBufferAttribute(new Float32Array(capacity),1).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aFieldShape',shape);g.setAttribute('aFieldTint',tint);g.setAttribute('aFieldHeight',heights);
  const m=new THREE.MeshLambertMaterial({color:0xffffff,vertexColors:true,side:THREE.DoubleSide,fog:true});
  m.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,uniforms);
    shader.vertexShader=shader.vertexShader.replace('#include <common>','#include <common>\n'+FIELD_VERTEX_PARS+(far?'\nvarying vec2 vFieldUv;':'')).replace('#include <begin_vertex>',fieldVertexBody(far)+(far?'\nvFieldUv = uv;':''));
    shader.fragmentShader=shader.fragmentShader.replace('#include <common>','#include <common>\n'+FIELD_FRAGMENT_PARS+(far?'\nvarying vec2 vFieldUv;\n'+FIELD_CARD_GLSL:'') )
      .replace('#include <color_fragment>','#include <color_fragment>\n'+(far?FIELD_FAR_SILHOUETTE:'diffuseColor.rgb *= vFieldTint;\nfloat fieldPetalMask = vFieldPetal;'))
      .replace('#include <normal_fragment_begin>','#include <normal_fragment_begin>'+(far?'\nnormal = normalize(vNormal);':''))
      .replace('#include <opaque_fragment>',FIELD_FRAGMENT_LIGHT+'\n#include <opaque_fragment>');
  };
  if(far)m.defines={USE_UV:''};
  m.customProgramCacheKey=()=>`kz-fields-v2-${far?'far':'near'}`;
  const mesh=new THREE.InstancedMesh(g,m,capacity);mesh.name=`kamakura-fields-${far?'far':FIELD_KINDS[index]}`;
  mesh.count=0;mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);mesh.frustumCulled=false;mesh.receiveShadow=true;mesh.castShadow=false;
  const free=[];for(let i=capacity-1;i>=0;i--)free.push(i);
  return {mesh,shape,tint,heights,free,triangles:kit.triangles,used:0,dirty:false,uploadLo:Infinity,uploadHi:-1};
}

export function createKamakuraFields(context,options={}) {
  const config=fieldOptions(context.search);if(!config.enabled)return null;
  const reduced=options.reducedMotion??globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches??false;
  const now=options.now??(()=>performance.now());
  const map=options.map??createFieldMap({...context,seed:config.seed});
  const viewport=new THREE.Vector2();
  const uniforms={uFieldViewport:{value:720},uFieldTime:{value:0},uFieldWind:{value:1},uFieldMotion:{value:reduced?.4:1},uFieldRadius:{value:context.quality==='light'?45:70},
    uFieldDir:{value:new THREE.Vector2(1,0)},uFieldViewer:{value:new THREE.Vector3()},uFieldHero:{value:new THREE.Vector3()},uFieldSun:{value:context.sunDir?.clone()??new THREE.Vector3(0,1,0)},uFieldDebug:{value:config.debug?1:0}};
  const pools=Array.from({length:6},(_,i)=>makePool(i,uniforms)),means=FIELD_KINDS.map((_,i)=>fieldPlantKit(i).meanColor);
  for(const p of pools)context.scene.add(p.mesh);
  const cells=new Map(),queue=[],matrix=new THREE.Matrix4(),rotation=new THREE.Quaternion(),axis=new THREE.Vector3(0,1,0),scale=new THREE.Vector3(),position=new THREE.Vector3();
  const white=[1,1,1];
  const here={},nearest={kind:null,distance:Infinity,bearing:0},byKind={};
  let disposed=false,paused=false,step=0,planX=Infinity,planZ=Infinity,job=null,probe=0,completed=0,operations=0;
  let maintenanceCells=null,maintenanceRecords=null,maintenanceIndex=0;
  let radius=context.quality==='light'?45:70,density=config.density*(context.quality==='light'?.6:1);
  function release(pool,slot) {
    if(slot<0)return;pool.free.push(slot);pool.used--;pool.shape.array[slot*4+2]=0;pool.dirty=true;
  }
  function evict(cell) {
    for(const r of cell.records){release(pools[5],r.far);if(r.near>=0)release(pools[r.kind],r.near);}
    cells.delete(cell.key);
  }
  function place(pool,r,far,ready) {
    if(!pool.free.length)return -1;
    const slot=pool.free.pop();pool.used++;
    position.set(r.x,context.terrain.heightAt(r.x,r.z)+.005,r.z);
    rotation.setFromAxisAngle(axis,r.yaw);scale.setScalar(r.scale);
    if(far)scale.set(FIELD_CARD_WIDTHS[r.kind]*r.scale,FIELD_HEIGHTS[r.kind]*r.scale,FIELD_CARD_WIDTHS[r.kind]*r.scale);
    matrix.compose(position,rotation,scale);pool.mesh.setMatrixAt(slot,matrix);pool.mesh.count=Math.max(pool.mesh.count,slot+1);
    const a=pool.shape.array,o=slot*4;a[o]=r.kind;a[o+1]=r.variant;a[o+2]=ready;a[o+3]=0;
    const color=white,t=slot*3;
    pool.tint.array[t]=color[0]*r.tint*(1+r.hue);pool.tint.array[t+1]=color[1]*r.tint;pool.tint.array[t+2]=color[2]*r.tint*(1-r.hue);
    pool.heights.array[slot]=far?1:FIELD_HEIGHTS[r.kind];
    pool.uploadLo=Math.min(pool.uploadLo,slot);pool.uploadHi=Math.max(pool.uploadHi,slot);
    pool.dirty=true;return slot;
  }
  function plan(x,z,yaw) {
    planX=x;planZ=z;queue.length=0;
    for(const c of cells.values())if(Math.hypot(c.cx*10+5-x,c.cz*10+5-z)>radius+15)evict(c);
    if(job&&Math.hypot(job.cx*10+5-x,job.cz*10+5-z)>radius+15) {
      for(const r of job.records){if(r.far!==undefined)release(pools[5],r.far);if(r.near>=0)release(pools[r.kind],r.near);}job=null;
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
    let instances=0,triangles=0,draws=0;for(const p of pools){instances+=p.used;triangles+=p.mesh.count*p.triangles;if(p.mesh.visible&&p.mesh.count)draws++;}
    return {kindHere:here.kind??null,strengthHere:here.strength??0,cells:{built:cells.size,pending:queue.length+(job?1:0)},instances,triangles,draws,nearest:{...nearest},byKind:{...byKind},work:{operations,completed},capacity:FIELD_CAPACITIES.reduce((a,b)=>a+b,0)};
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
      // Refresh LOD ownership a little at a time. Matrices and all buffers are reused.
      let visited=0;
      while(pools[5].used>0&&visited<32&&operations<FIELDS.work&&now()-start<FIELDS.budgetMs) {
        if(!maintenanceRecords||maintenanceIndex>=maintenanceRecords.records.length) {
          maintenanceCells??=cells.values();const next=maintenanceCells.next();
          if(next.done){maintenanceCells=null;maintenanceRecords=null;break;}
          maintenanceRecords=next.value;maintenanceIndex=0;
          if(cells.get(maintenanceRecords.key)!==maintenanceRecords||!maintenanceRecords.records.length)continue;
        }
        const r=maintenanceRecords.records[maintenanceIndex++];operations++;visited++;
        if(cells.get(maintenanceRecords.key)!==maintenanceRecords||r.far<0)continue;
        const d=Math.hypot(r.x-x,r.z-z);
        if(r.near>=0&&d>FIELD_NEAR_RADIUS+4) {release(pools[r.kind],r.near);r.near=-1;pools[5].shape.array[r.far*4+3]=0;pools[5].dirty=true;}
        else if(r.near<0&&d<FIELD_NEAR_RADIUS&&pools[r.kind].free.length) {r.near=place(pools[r.kind],r,false,1);pools[5].shape.array[r.far*4+3]=1;pools[5].dirty=true;}
      }
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
          if(distance<40&&job.records.length>pools[5].free.length) {
            let farthest=null,best=distance+15;
            for(const c of cells.values()) {
              const d=Math.hypot(c.cx*10+5-x,c.cz*10+5-z);
              if(d>best&&c.records.some(r=>r.far>=0)){farthest=c;best=d;}
            }
            if(farthest)evict(farthest);
          }
        }
        if(job.publish<job.records.length) {
          const end=Math.min(job.records.length,job.publish+16);
          for(;job.publish<end;job.publish++) {
            const r=job.records[job.publish];r.far=place(pools[5],r,true,0);r.near=-1;
            if(r.far>=0&&Math.hypot(r.x-x,r.z-z)<FIELD_NEAR_RADIUS)r.near=place(pools[r.kind],r,false,0);
            operations++;
          }
          continue;
        }
        for(const r of job.records)if(r.far>=0) {
          pools[5].shape.array[r.far*4+2]=1;pools[5].shape.array[r.far*4+3]=r.near>=0?1:0;pools[5].dirty=true;
          if(r.near>=0){pools[r.kind].shape.array[r.near*4+2]=1;pools[r.kind].dirty=true;}
        }
        cells.set(job.key,job);job=null;completed++;
      }
      for(const p of pools) {
        p.mesh.visible=step<3&&p.used>0;
        if(p.dirty) {
          p.shape.needsUpdate=true;
          if(p.uploadHi>=0) {
            // Include outstanding ranges until the renderer acknowledges the upload. One bounded range per attribute.
            for(const attr of [p.tint,p.heights,p.mesh.instanceMatrix]) {
              const size=attr.itemSize,prior=attr.updateRanges[0];
              const lo=Math.min(p.uploadLo*size,prior?.start??Infinity),hi=Math.max((p.uploadHi+1)*size,prior?prior.start+prior.count:0);
              attr.clearUpdateRanges();attr.addUpdateRange(lo,hi-lo);attr.needsUpdate=true;
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
      for(const p of pools)p.mesh.visible=step<3;
      for(const c of cells.values())evict(c);
      if(job){for(const r of job.records){if(r.far!==undefined)release(pools[5],r.far);if(r.near>=0)release(pools[r.kind],r.near);}job=null;}
      queue.length=0;planX=Infinity;maintenanceCells=null;maintenanceRecords=null;
    },
    setPaused(on){paused=!!on;},
    debugText(){if(disposed)return '';const n=pools[5].used;return `野 ${FIELD_NAMES[FIELD_KINDS.indexOf(here.kind)]??'なし'} 区画${cells.size} 株${(n/1000).toFixed(1)}k${step>=3?' 停止':''}`;},
    dispose() {
      if(disposed)return;disposed=true;
      for(const p of pools){context.scene.remove(p.mesh);p.mesh.geometry.dispose();p.mesh.material.dispose();p.mesh.dispose();}
      cells.clear();queue.length=0;job=null;
      if(globalThis.__kzFields===inspect)delete globalThis.__kzFields;
    },
  };
}
