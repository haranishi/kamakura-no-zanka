// 棚田のまとめ描き。新規の当たり・外部素材・時計は持たず、共有風を受け取る。
import * as THREE from 'three';
import { cellRand } from './scatter.js';
import { PADDY, paddyQuality, paddyOptions, PADDY_LOOK, PADDY_DEBUG, paddyBundSection } from './paddy.js';

// 地色も植生の共有風を読む。独自の時計は作らない。
const groundWind = { uTime: { value: 0 }, uWind: { value: 0 } };
const originalRiceColor = () => new THREE.Color(PADDY_LOOK.tintA).lerp(new THREE.Color(PADDY_LOOK.tintB), .5).multiply(new THREE.Color().setRGB(...PADDY_LOOK.tip));
export const paddyRiceColor = () => originalRiceColor().lerp(new THREE.Color(PADDY_LOOK.grass), PADDY_LOOK.riceGreen);
// 遠景の金は既存の稲から作る。穂先だけ元の明るい金を少量戻す。
export function paddyFarRiceColor(plot = { tint: 1, hue: 0 }, tip = false) {
  const base=paddyRiceColor(),hsl=base.getHSL({});
  base.setHSL(hsl.h*PADDY_LOOK.farWarmth+(plot.hue||0),hsl.s*(1-PADDY_LOOK.farDesaturate),hsl.l).multiplyScalar(PADDY_LOOK.farGain);
  if(tip)base.lerp(originalRiceColor(),PADDY_LOOK.farTipMix);
  return base.multiplyScalar(plot.tint);
}
export const paddyRockColor = () => new THREE.Color(PADDY_LOOK.rock).lerp(new THREE.Color(PADDY_LOOK.soil),PADDY_LOOK.rockSoil).multiplyScalar(PADDY_LOOK.rockGain);
export const paddyDebugColor = (level, riser = false) => new THREE.Color().setHSL(((level * PADDY_LOOK.debugHueStep) % 1 + 1) % 1, PADDY_LOOK.debugSaturation, riser ? PADDY_LOOK.debugRiserLightness : PADDY_LOOK.debugTreadLightness);
export const paddySoilColor = () => new THREE.Color(PADDY_LOOK.soil).multiplyScalar(PADDY_LOOK.soilGain);
// 位置の連続雑音。畦の継ぎ目と頂点の間で土草の斑をつなぐ。
const smooth01 = x => { const t=Math.max(0,Math.min(1,x));return t*t*(3-2*t); };
export function paddyPatch(x,z,scale=PADDY_LOOK.bundPatch) {
  const u=x/scale,v=z/scale,i=Math.floor(u),j=Math.floor(v),a=smooth01(u-i),b=smooth01(v-j);
  const h=(x,z)=>cellRand(2310,x,z)();
  return (h(i,j)*(1-a)+h(i+1,j)*a)*(1-b)+(h(i,j+1)*(1-a)+h(i+1,j+1)*a)*b;
}
export function paddyBundColor(x,z,crown=false,scale=PADDY_LOOK.bundPatch,soft=PADDY_LOOK.bundPatchSoft) {
  const threshold=PADDY_LOOK.bundSoil;
  const range=PADDY_LOOK.bundNoiseRange,noise=smooth01((paddyPatch(x,z,scale)-range[0])/(range[1]-range[0]));
  const grass=new THREE.Color(PADDY_LOOK.grass).lerp(paddySoilColor(),PADDY_LOOK.bundGrassWarmth);
  return paddySoilColor().lerp(grass,smooth01((noise-threshold+soft)/(2*soft))).multiplyScalar(crown?PADDY_LOOK.bundCrownGain:1);
}
export function paddySurfaceColor(state, x, z) {
  if (state.riser) return paddyRockColor().multiplyScalar(PADDY_LOOK.wallShade).multiply(new THREE.Color().setRGB(...PADDY_LOOK.wallTint));
  if (state.bund) return paddyBundColor(x,z,false,PADDY_LOOK.bundMapPatch,PADDY_LOOK.bundMapSoft);
  const rice = paddyFarRiceColor(state.plot).multiplyScalar(PADDY_LOOK.groundGain);
  if (!state.cut) return rice;
  const soil = paddySoilColor(), cut = soil.lerp(rice, PADDY_LOOK.cutRiceMix).multiplyScalar(PADDY_LOOK.cutGain);
  { const grey = cut.r * .2126 + cut.g * .7152 + cut.b * .0722; cut.lerp(new THREE.Color(grey, grey, grey), PADDY_LOOK.cutGrey); }
  const patch = cellRand(2309, Math.floor(x / PADDY_LOOK.mapStep), Math.floor(z / PADDY_LOOK.mapStep))() < PADDY_LOOK.cutPatch;
  return cut.multiplyScalar(patch ? PADDY_LOOK.patchGain : 1);
}
// 地色の細い条は解像度に合わせて平均化し、遠くのちらつきを避ける。
export const paddySurfaceMask = state => state.bund ? 253 : state.cut ? 254 : 255;
export function patchPaddyGround(shader, debug) {
  if (debug) return;
  Object.assign(shader.uniforms, { uPaddyTime: groundWind.uTime, uPaddyWind: groundWind.uWind });
  shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
    uniform sampler2D uPaddyPhase; uniform float uPaddyTime; uniform float uPaddyWind;
    float paddySoilHash(vec2 p) { return fract(sin(dot(p,vec2(12.9898,78.233)))*43758.5453); }
    float paddySoilNoiseAt(vec2 p) {
      vec2 cell=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
      return mix(mix(paddySoilHash(cell),paddySoilHash(cell+vec2(1.0,0.0)),f.x),mix(paddySoilHash(cell+vec2(0.0,1.0)),paddySoilHash(cell+vec2(1.0)),f.x),f.y);
    }`)
    .replace('albedo = mix(albedo,paddyGround.rgb,paddyGround.a);', `
    vec2 paddyEncoded = texture2D(uPaddyPhase,paddyUV).rg;
    float paddyAlong = (dot(paddyEncoded,vec2(255.0,1.0))*255.0/65535.0*${PADDY_LOOK.phaseRange.toFixed(1)}-${PADDY_LOOK.phaseOffset.toFixed(1)});
    float paddyStanding = step(254.5,paddyGround.a*255.0);
    float paddyCut = step(253.5,paddyGround.a*255.0)*(1.0-paddyStanding);
    float paddyStripePhase = paddyAlong / mix(${PADDY.stubbleStep},${PADDY_LOOK.rowPeriod},paddyStanding) * 6.2831853;
    float paddyStripe = sin(paddyStripePhase) * (1.0-smoothstep(0.5,3.0,fwidth(paddyStripePhase)));
    paddyGround.rgb *= 1.0+mix(${PADDY_LOOK.cutRowStrength},${PADDY_LOOK.rowStrength},paddyStanding)*paddyStripe*(paddyStanding+paddyCut);
    float paddyWave = sin((vWorldPos.x*${PADDY_LOOK.groundWaveDirection[0].toFixed(8)}+vWorldPos.z*${PADDY_LOOK.groundWaveDirection[1].toFixed(8)})*6.2831853/${PADDY_LOOK.groundWavePeriod.toFixed(1)}-uPaddyTime*${PADDY_LOOK.groundWaveSpeed});
    paddyGround.rgb *= 1.0+${PADDY_LOOK.groundWaveStrength}*paddyWave*uPaddyWind*paddyStanding;
    if(paddyGround.a>0.5) {
    vec2 paddySoilCell = vWorldPos.xz / ${PADDY_LOOK.crackCell};
    vec2 paddySoilBase = floor(paddySoilCell);
    paddyGround.rgb *= 1.0+(1.0-paddyStanding)*(1.0-paddyCut)*${PADDY_LOOK.bundMottle}*(paddySoilNoiseAt(vWorldPos.xz/${PADDY_LOOK.bundMottleScale})*2.0-1.0);
    float paddyNearSoil = 1.0-smoothstep(${PADDY_LOOK.rootStart.toFixed(1)},${PADDY_LOOK.rootEnd.toFixed(1)},distance(vWorldPos,cameraPosition));
    float paddyCrackAA = max(fwidth(paddySoilCell.x),fwidth(paddySoilCell.y));
    float paddyFirst = 8.0, paddySecond = 8.0;
    if(paddyCut*paddyNearSoil>0.0) {
    for (int paddyZ=-1;paddyZ<=1;paddyZ++) for (int paddyX=-1;paddyX<=1;paddyX++) {
      vec2 paddyCell = paddySoilBase + vec2(float(paddyX),float(paddyZ));
      vec2 paddyJitter = fract(sin(vec2(dot(paddyCell,vec2(127.1,311.7)),dot(paddyCell,vec2(269.5,183.3))))*43758.5453);
      vec2 paddyDelta = paddyCell+0.2+0.6*paddyJitter-paddySoilCell;
      float paddyD = dot(paddyDelta,paddyDelta);
      if (paddyD<paddyFirst) { paddySecond=paddyFirst;paddyFirst=paddyD; } else { paddySecond=min(paddySecond,paddyD); }
    }
    }
    float paddyCrack = 1.0-smoothstep(0.0,${PADDY_LOOK.crackWidth}/ ${PADDY_LOOK.crackCell}+paddyCrackAA,paddySecond-paddyFirst);
    float paddySoilNoise = paddySoilNoiseAt(vWorldPos.xz/${PADDY_LOOK.mudScale});
    float paddyStraw = step(1.0-${PADDY_LOOK.mudPatch},paddySoilHash(floor(vWorldPos.xz/${PADDY_LOOK.mudScale})));
    vec3 paddyRootSoil = vec3(${paddySoilColor().toArray().join(',')});
    paddyRootSoil *= ${PADDY_LOOK.mudGain}*(1.0+${PADDY_LOOK.mudRelief}*(paddySoilNoise*2.0-1.0));
    paddyRootSoil = mix(paddyRootSoil,vec3(${paddyRiceColor().toArray().join(',')}),paddyStraw*${PADDY_LOOK.mudStrawMix});
    paddyRootSoil *= ${PADDY_LOOK.mudRowBase}+${PADDY_LOOK.mudRowContrast}*paddyStripe;
    paddyRootSoil *= texture2D(uPaddyPhase,paddyUV).b;
    paddyGround.rgb *= 1.0-paddyCut*paddyNearSoil*paddyCrack*(1.0-${PADDY_LOOK.crackShade});
    float paddyCover = step(0.5,paddyGround.a);
    paddyGround.rgb = mix(paddyGround.rgb,paddyRootSoil,paddyStanding*paddyNearSoil);
    paddyGround.a = paddyCover;
    albedo = mix(albedo,paddyGround.rgb,paddyGround.a);
    }`);
}
// 同じ画素ハッシュを近・遠の両方へ使い、混合帯の被覆の和を1にする。
export function patchPaddyRice(material, wind, { far = false, distance = { value: PADDY.farEnd }, debug = false, nearEnd = null } = {}) {
  Object.assign(groundWind, wind);
  const old = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    old.call(material, shader);
    Object.assign(shader.uniforms, wind, { uPaddyEnd: distance, uPaddyNearEnd: nearEnd || {value:PADDY.nearEnd} });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying float vPaddyDistance; varying vec3 vPaddyRoot;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 paddyRoot = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
      vPaddyDistance = distance(paddyRoot, cameraPosition); vPaddyRoot = paddyRoot;`);
    if (debug) shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n vColor = instanceColor;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uPaddyEnd; uniform float uPaddyNearEnd; uniform float uTime; uniform float uWind; varying float vPaddyDistance; varying vec3 vPaddyRoot;`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      float paddyFar = ${far?'smoothstep(max(0.0,uPaddyNearEnd-'+PADDY.riceFade.toFixed(1)+'),max(0.01,uPaddyNearEnd),vPaddyDistance)':'smoothstep('+PADDY.nearStart.toFixed(1)+','+PADDY.nearEnd.toFixed(1)+',vPaddyDistance)'};
      float paddyGrain = fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
      ${far ? `float paddyOuter = 1.0-smoothstep(uPaddyEnd-${PADDY.adaptDistance.toFixed(1)},uPaddyEnd,vPaddyDistance);
      if (paddyGrain >= paddyFar*paddyOuter) discard;` : 'if (paddyGrain < paddyFar) discard;'}
      `);
    if (!debug) shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>\n diffuseColor.rgb *= vec3(1.0,${far ? 1 : 1 + PADDY_LOOK.riceGreen},1.0)*(1.0+${PADDY_LOOK.waveShade}*sin(vPaddyRoot.x*${PADDY_LOOK.windSpaceX}+vPaddyRoot.z*${PADDY_LOOK.windSpaceZ}-uTime*${PADDY_LOOK.windSlow})*uWind);`);
    if (far && !debug) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `vec3 paddySun = diffuseColor.rgb;
      vec3 paddyShadeTint = vec3(${PADDY_LOOK.farShadowTint.join(',')});
      paddyShadeTint /= dot(paddyShadeTint,vec3(0.2126,0.7152,0.0722));
      float paddyLit = clamp(dot(outgoingLight,vec3(0.2126,0.7152,0.0722))/max(dot(paddySun,vec3(0.2126,0.7152,0.0722)),0.0001),${PADDY_LOOK.farShadeFloor},1.0);
      outgoingLight = paddySun*paddyLit*mix(paddyShadeTint,vec3(1.0),(paddyLit-${PADDY_LOOK.farShadeFloor})/(1.0-${PADDY_LOOK.farShadeFloor}));\n #include <opaque_fragment>`);
    if (debug) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'outgoingLight = vColor;\n #include <opaque_fragment>');
  };
  material.customProgramCacheKey = () => `paddy-rice-${far}-${debug}`;
}
// 近景と同じ位相・振幅・小揺れ。高さは房のローカル座標で渡す。
function farWind(material, wind) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, wind);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      uniform float uTime; uniform float uWind; uniform vec2 uWindDir;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 root = (instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
      float ph = root.x*${PADDY_LOOK.windSpaceX}+root.z*${PADDY_LOOK.windSpaceZ};
      float hf = clamp(transformed.y,0.0,1.0);
      float sway = (sin(uTime*${PADDY_LOOK.windSlow}+ph)+0.5*sin(uTime*${PADDY_LOOK.windFast}+ph*${PADDY_LOOK.windPhase}))*${PADDY_LOOK.windAmplitude}*hf*hf*uWind;
      transformed.x += sway*${PADDY_LOOK.windX}; transformed.z += sway*${PADDY_LOOK.windZ};
      transformed += vec3(sin(uTime*${PADDY_LOOK.flutterX}+position.y*${PADDY_LOOK.flutterHeight}+ph),0.0,cos(uTime*${PADDY_LOOK.flutterZ}+position.x*${PADDY_LOOK.flutterWidth}+ph))*${PADDY_LOOK.flutter}*hf*uWind;`);
  };
}
const tris = g => (g.index?.count ?? g.attributes.position.count) / 3;
function meshFromParts(parts, material, name) {
  const pos = [], col = [], nor = [];
  for (const { geometry, color } of parts) {
    const g = geometry.index ? geometry.toNonIndexed() : geometry;
    pos.push(...g.attributes.position.array); nor.push(...g.attributes.normal.array);
    if(g.attributes.color) col.push(...g.attributes.color.array);
    else for (let i = 0; i < g.attributes.position.count; i++) col.push(color.r, color.g, color.b);
    g.dispose(); if (g !== geometry) geometry.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material); mesh.name = name; mesh.receiveShadow = true; return mesh;
}
// 二つの頂点と六角の胴＝12面。中景は三角の胴＝6面。共有頂点の法線で角の光を抑える。
export function paddyStoneGeometry(stone, near = true) {
  const sides = near ? 6 : 3, pos = [0, stone.height / 2, 0, 0, -stone.height / 2, 0], indices = [];
  for (let i = 0; i < sides; i++) {
    const a = i / sides * Math.PI * 2;
    pos.push(Math.cos(a) * stone.width / 2, Math.sin(a * 2) * stone.height * .10, Math.sin(a) * stone.depth / 2);
    const u = i + 2, v = (i + 1) % sides + 2;
    indices.push(0, v, u, 1, u, v);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(indices); g.computeVertexNormals();
  // 傾けても上下の石が田面を越えないよう、高さの範囲を正規化する。
  g.rotateY(stone.turn).rotateX(stone.tilt * Math.PI / 180);
  const a = g.attributes.position; let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < a.count; i++) { lo = Math.min(lo, a.getY(i)); hi = Math.max(hi, a.getY(i)); }
  for (let i = 0; i < a.count; i++) a.setY(i, (a.getY(i) - lo) / (hi - lo) * stone.height - stone.height / 2);
  g.computeVertexNormals(); g.translate(stone.x, stone.y, stone.z); return g;
}
export function paddyStoneBandGeometry(w, debug = false) {
  const positions=[],colors=[],indices=[],rails=[0,PADDY_LOOK.stoneGrassEdge,1,1+PADDY_LOOK.stoneShadowWidth/PADDY.stoneBandWidth];
  const rock=paddyRockColor().multiplyScalar(PADDY_LOOK.wallShade).multiply(new THREE.Color().setRGB(...PADDY_LOOK.wallTint)),shadow=paddyFarRiceColor().multiplyScalar(PADDY_LOOK.groundGain*PADDY_LOOK.stoneShadow);
  for(let end=0;end<2;end++)for(let i=0;i<rails.length;i++) {
    const t=rails[i],a=end?w.bTop:w.aTop,b=end?w.bBottom:w.aBottom,foot=end?w.bShadow:w.aShadow;
    const p=i===3?foot:{x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t};
    positions.push(p.x,p.y,p.z);
    const c=debug?new THREE.Color(PADDY_DEBUG.stone):i===0?paddyBundColor(p.x,p.z,true):i===3?shadow:rock;
    colors.push(c.r,c.g,c.b);
  }
  for(let i=0;i<rails.length-1;i++)indices.push(i,i+4,i+1,i+1,i+4,i+5);
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();return g;
}
export function paddyBundGeometry(b, segments = PADDY.bundSegments, debug = false) {
  const pos = [], colors = [], indices = [], n = segments;
  for (let end = 0; end < 2; end++) for (let i = 0; i <= n; i++) {
    const across = i / n - .5;
    const ripple = b.jitter * Math.sin(b.x * PADDY.bundSpaceX + b.z * PADDY.bundSpaceZ) * Math.sin(Math.PI * i / n);
    const dx=b.b.x-b.a.x,dz=b.b.z-b.a.z,len=Math.hypot(dx,dz),t=end;
    const x=b.a.x+dx*t-dz/len*(across*b.sz+ripple),z=b.a.z+dz*t+dx/len*(across*b.sz+ripple);
    pos.push(x, (end ? b.y1 : b.y0) + paddyBundSection(i / n, x, z), z);
    const c=debug?new THREE.Color(PADDY_DEBUG.bund):paddyBundColor(x,z,b.crown); colors.push(c.r,c.g,c.b);
  }
  for (let i = 0; i < n; i++) indices.push(i, i + n + 1, i + 1, i + 1, i + n + 1, i + n + 2);
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3)); g.setIndex(indices); g.computeVertexNormals(); return g;
}
// 下草と同じ、根から開いて先が細くなる葉。小さな株は5本の短い茎。
export function paddyTuftGeometry(s, grass = false) {
  const pos = [], colors = [], stems = grass ? 3 : PADDY.stubbleStems, radius = grass ? PADDY.grassRadius : PADDY.stubbleDiameter / 2;
  for (let i = 0; i < stems; i++) {
    const a = i / stems * Math.PI * 2, dx = Math.cos(a), dz = Math.sin(a), w = grass ? PADDY.grassBladeWidth : PADDY.stubbleBladeWidth;
    pos.push(s.x-dz*w,s.y,s.z+dx*w, s.x+dz*w,s.y,s.z-dx*w,
      s.x+dx*radius,s.y+s.height,s.z+dz*radius);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if(grass){for(let i=0;i<pos.length;i+=3){const c=paddyBundColor(pos[i],pos[i+2]).multiplyScalar(i%9===6?PADDY_LOOK.grassTipGain:PADDY_LOOK.grassRootGain);colors.push(c.r,c.g,c.b);}g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));}
  g.computeVertexNormals(); return g;
}
// 葉は中ほどが広く、先が垂れる。穂は外へ弓なりに落ちる粒列の十字板。
export function paddyRiceGeometry(item, quality='standard', debug=false) {
  const pos=[],colors=[],indices=[],leaves=quality==='light'?PADDY.lightRiceLeaves:PADDY.riceLeaves,heads=quality==='light'?PADDY.lightRiceHeads:PADDY.riceHeads;
  const root=new THREE.Color().setRGB(...PADDY_LOOK.leafRoot),tip=new THREE.Color().setRGB(...PADDY_LOOK.leafTip);
  const add=(x,y,z,c)=>{const a=item.turn||0,cs=Math.cos(a),sn=Math.sin(a);pos.push(item.x+cs*x-sn*z,item.y+y*item.height/PADDY.riceHeight,item.z+sn*x+cs*z);colors.push(c.r,c.g,c.b);};
  for(let leaf=0;leaf<leaves;leaf++) {
    const angle=leaf/leaves*Math.PI*2,dx=Math.cos(angle),dz=Math.sin(angle),first=pos.length/3;
    for(let k=0;k<=2;k++) {
      const t=k/2,w=PADDY.riceWidth*(k===1?1:k===0?PADDY.leafRootWidth:0),r=PADDY.riceSpread*t;
      const y=PADDY.riceHeight*Math.sin(t*Math.PI/2)-PADDY.riceDroop*t*t,c=debug?new THREE.Color(PADDY_DEBUG.standing):root.clone().lerp(tip,t);
      for(const side of [-1,1])add(dx*r-dz*w*side,y,dz*r+dx*w*side,c);
    }
    for(let k=0;k<2;k++){const i=first+k*2;indices.push(i,i+1,i+3,i,i+3,i+2);}
  }
  const leafVertices=pos.length/3, attachments=[];
  for(let head=0;head<heads;head++) {
    const angle=(head+PADDY.headPhase)/heads*Math.PI*2,dx=Math.cos(angle),dz=Math.sin(angle),stem={x:dx*PADDY.riceSpread*PADDY.headStemSpread,y:PADDY.riceHeight,z:dz*PADDY.riceSpread*PADDY.headStemSpread};attachments.push(stem);
    const firstStem=pos.length/3;
    for(const y of [0,stem.y])for(const side of [-1,1])add(stem.x-dz*PADDY.stemWidth*side,y,stem.z+dx*PADDY.stemWidth*side,root);
    indices.push(firstStem,firstStem+1,firstStem+3,firstStem,firstStem+3,firstStem+2);
    for(let axis=0;axis<2;axis++) {
      const first=pos.length/3,wx=axis===0?-dz:dx,wz=axis===0?dx:dz;
      for(let k=0;k<=PADDY.headSegments;k++) {
        const t=k/PADDY.headSegments,r=PADDY.headLength*PADDY.headReachRatio*Math.sin(t*Math.PI/2),y=stem.y-PADDY.headLength*PADDY.headDropRatio*t*t;
        const width=PADDY.headWidth*Math.sin(Math.PI*(PADDY.grainEnd+PADDY.grainTaper*t))*(k%2?1:PADDY.grainNotch);
        const c=debug?new THREE.Color(PADDY_DEBUG.standing):new THREE.Color().setRGB(...PADDY_LOOK.headRoot).lerp(new THREE.Color().setRGB(...PADDY_LOOK.headTip),t);
        for(const side of [-1,1])add(stem.x+dx*r+wx*width*side,y,stem.z+dz*r+wz*width*side,c);
      }
      for(let k=0;k<PADDY.headSegments;k++){const i=first+k*2;indices.push(i,i+1,i+3,i,i+3,i+2);}
    }
  }
  const g=new THREE.BufferGeometry();g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3));g.setAttribute('color',new THREE.Float32BufferAttribute(colors,3));g.setIndex(indices);g.computeVertexNormals();g.userData={leafVertices,heads,attachments};return g;
}
// 動くのは近景の稲と草だけ。根の属性を再利用し、共有風の位相・小揺れをそのまま読む。
function patchDetailWind(material,wind) {
  material.onBeforeCompile=shader=>{
    Object.assign(shader.uniforms,wind);
    shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
      attribute vec4 paddyRoot; uniform float uTime; uniform float uWind;`)
      .replace('#include <begin_vertex>',`#include <begin_vertex>
      float ph=paddyRoot.x*${PADDY_LOOK.windSpaceX}+paddyRoot.z*${PADDY_LOOK.windSpaceZ};
      float hf=clamp((position.y-paddyRoot.y)/max(paddyRoot.w,0.001),0.0,1.0)*step(0.001,paddyRoot.w);
      float sway=(sin(uTime*${PADDY_LOOK.windSlow}+ph)+0.5*sin(uTime*${PADDY_LOOK.windFast}+ph*${PADDY_LOOK.windPhase}))*${PADDY_LOOK.windAmplitude}*hf*hf*uWind;
      transformed.x+=sway*${PADDY_LOOK.windX};transformed.z+=sway*${PADDY_LOOK.windZ};
      transformed+=vec3(sin(uTime*${PADDY_LOOK.flutterX}+position.y*${PADDY_LOOK.flutterHeight}+ph),0.0,cos(uTime*${PADDY_LOOK.flutterZ}+position.x*${PADDY_LOOK.flutterWidth}+ph))*${PADDY_LOOK.flutter}*hf*uWind;`);
  };
  material.customProgramCacheKey=()=> 'paddy-details-wind';
}
function cachedPart(geometry, color, item) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  const result = { pos: g.attributes.position.array.slice(), nor: g.attributes.normal.array.slice(), col: g.attributes.color?.array.slice(), color, item, triangles: tris(g) };
  if (g !== geometry) g.dispose(); geometry.dispose(); return result;
}
// 出力用配列は一度だけ確保。移動時もsubarray・配列・行列を作らない。
function dynamicMesh(material, name, budget) {
  const g = new THREE.BufferGeometry();
  for (const key of ['position','normal','color']) g.setAttribute(key, new THREE.BufferAttribute(new Float32Array(budget * 9), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('paddyRoot',new THREE.BufferAttribute(new Float32Array(budget*12),4).setUsage(THREE.DynamicDrawUsage));
  g.setDrawRange(0, 0);
  const mesh = new THREE.Mesh(g, material); mesh.name = name; mesh.frustumCulled = false; mesh.receiveShadow = true;
  let count = 0; const uploadRange = { start: 0, count: 0 }, rootRange={start:0,count:0};
  return { mesh, reset() { count = 0; }, add(p, fade = 1) {
    const a = g.attributes; const root = p.item;
    for (let i = 0; i < p.pos.length; i++) { a.position.array[count+i] = fade === 1 ? p.pos[i] : (i % 3 === 0 ? root.x : i % 3 === 1 ? root.y : root.z) * (1-fade) + p.pos[i] * fade; a.normal.array[count+i] = p.nor[i]; a.color.array[count+i] = p.col ? p.col[i] : i % 3 === 0 ? p.color.r : i % 3 === 1 ? p.color.g : p.color.b; }
    for(let i=0;i<p.pos.length/3;i++){const k=(count/3+i)*4;a.paddyRoot.array[k]=root.x;a.paddyRoot.array[k+1]=root.y;a.paddyRoot.array[k+2]=root.z;a.paddyRoot.array[k+3]=root.wind?root.height:0;}
    count += p.pos.length;
  }, finish() { g.setDrawRange(0, count / 3); mesh.visible = count > 0; uploadRange.count = count;
    for (let i = 0; i < 3; i++) { const a = i === 0 ? g.attributes.position : i === 1 ? g.attributes.normal : g.attributes.color; a.updateRanges[0] = uploadRange; a.needsUpdate = true; }
    rootRange.count=count/3*4;g.attributes.paddyRoot.updateRanges[0]=rootRange;g.attributes.paddyRoot.needsUpdate=true; }, triangles: () => count / 9 };
}
export function buildPaddy({ layout, wind, quality = 'standard', search = globalThis.location?.search || '' }) {
  const options = paddyOptions(search), group = new THREE.Group(); group.name = 'paddy';
  let level = 0, work = 0, profile = paddyQuality(quality);
  const empty = { enabled: false, plots: 0, standing: 0, harvested: 0, partial: 0, terraces: 0, raisedBoundaries: 0, flatBoundaries: 0, maxPlotArea: 0, contourLength: 0, stoneBandVertices: 0, rice:0,panicles:0,shadowLines:0,flatShadowLines:0,grassCapacity:0,riceCapacity:0,farRice: 0, stoneLength: 0, racks: 0, straw: 0, triangles: 0, drawCalls: 0, updateItems: 0 };
  if (!options.enabled || !layout) return { group, update() {}, setLevel() {}, stats: () => ({ ...empty }) };
  const debug = options.debug, details = [], stoneParts = [], nearParts = [], bands = [], color = (normal, key) => debug ? new THREE.Color(PADDY_DEBUG[key]) : normal;
  const box = (list, x, y, z, sx, sy, sz, c) => list.push({ geometry: new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), color: c });
  const rod = (a, b, radius, c) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    details.push({ geometry: new THREE.CylinderGeometry(radius, radius, delta.length(), 5, 1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())).translate(...start.add(end).multiplyScalar(.5).toArray()), color: c });
  };
  const gold = paddyRiceColor().multiplyScalar(PADDY_LOOK.groundGain), grassColor = new THREE.Color(PADDY_LOOK.grass), soil = paddySoilColor();
  for (const b of layout.bunds) details.push({ geometry: paddyBundGeometry(b, quality === 'light' ? PADDY.lightBundSegments : PADDY.bundSegments,debug), color: color(grassColor.clone().multiplyScalar(b.crown?PADDY_LOOK.bundCrownGain:1).lerp(soil, PADDY_LOOK.bundSoil * cellRand(2310, Math.floor(b.x), Math.floor(b.z))()), 'bund') });
  for (const w of layout.walls) bands.push(cachedPart(paddyStoneBandGeometry(w,debug), color(new THREE.Color(PADDY_LOOK.rock), 'stone'), w));
  for (const stone of layout.stones) {
    const c = color(paddyRockColor().multiplyScalar(stone.shade*PADDY_LOOK.wallShade).multiply(new THREE.Color().setRGB(...PADDY_LOOK.wallTint)).lerp(grassColor, stone.layer === stone.layers - 1 ? PADDY_LOOK.rockGrass : 0), 'stone');
    stoneParts.push({ item: stone, near: cachedPart(paddyStoneGeometry(stone), c, stone) });
  }
  for (const item of layout.stubble) nearParts.push(cachedPart(paddyTuftGeometry(item), color(gold.clone().lerp(new THREE.Color(PADDY_LOOK.wood), PADDY_LOOK.strawWhite), layout.plots[item.plot].kind), item));
  for (const item of layout.grass) if(quality!=='light'||item.rank<PADDY.lightGrassDensity) {
    const g=paddyTuftGeometry(item,true);if(debug){const a=g.attributes.color;for(let i=0;i<a.count;i++)a.setXYZ(i,...new THREE.Color(PADDY_DEBUG.bund).toArray());}
    nearParts.push(cachedPart(g,color(grassColor,'bund'),item));
  }
  for(const item of layout.rice) if(quality!=='light'||item.rank<PADDY.lightRiceDensity) nearParts.push(cachedPart(paddyRiceGeometry(item,quality,debug),gold,item));
  let stubbleCount = 0, grassCount = 0, riceCount = 0, detailRadius = 0, stoneNearCount = 0, stoneMidCount = 0, stoneBandCount = 0;
  const rackGold = color(gold, 'rack'), wood = color(new THREE.Color(PADDY_LOOK.wood).multiplyScalar(.5), 'rack');
  for (const r of layout.racks) {
    const firstPart=details.length;
    const h = r.y + r.height, ends = [r.x - r.length / 2, r.x + r.length / 2];
    for (const x of ends) for (const [dx, dz] of [[-.3, -.65], [.3, -.65], [0, .65]]) rod([x + dx, r.y, r.z + dz], [x, h, r.z], PADDY_LOOK.rackRadius, wood);
    rod([ends[0] - .2, h, r.z], [ends[1] + .2, h, r.z], PADDY_LOOK.rackRadius, wood);
    for (let x = ends[0] + .2; x < ends[1]; x += .32) {
      // 細い頂と太い裾を持つ稲束を横木の両側へ垂らす。
      for (const side of [-1, 1]) details.push({ geometry: new THREE.ConeGeometry(PADDY_LOOK.sheafRadius, .8, 4, 1).translate(x, h - .35, r.z + side * .18), color: rackGold });
    }
    for(let i=firstPart;i<details.length;i++)details[i].geometry.translate(-r.x,0,-r.z).rotateY(r.turn).translate(r.x,0,r.z);
  }
  for (const s of layout.straw) {
    details.push({ geometry: new THREE.ConeGeometry(.38, s.height, 5, 1).translate(s.x, s.y + s.height / 2, s.z), color: debug ? new THREE.Color(PADDY_DEBUG.harvested) : gold.clone().lerp(new THREE.Color(PADDY_LOOK.wood), PADDY_LOOK.strawWhite) });
    box(details, s.x, s.y + s.height * .6, s.z, .20, .055, .20, wood);
  }
  const makeMaterial = () => debug ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const detailMesh = meshFromParts(details, makeMaterial(), 'paddy-bunds-harvest');
  const budget = quality === 'light' ? PADDY.lightTriangleBudget : PADDY.triangleBudget;
  const stoneDynamic = dynamicMesh(makeMaterial(), 'paddy-stones', layout.stones.length * 12 + layout.walls.length * 6);
  const nearMaterial=makeMaterial();patchDetailWind(nearMaterial,wind);
  const nearDynamic = dynamicMesh(nearMaterial, 'paddy-stubble-grass', budget);
  detailMesh.frustumCulled = false;
  group.add(detailMesh, stoneDynamic.mesh, nearDynamic.mesh);
  const geo = new THREE.BufferGeometry(), pos = [], colors = [], normals = [];
  for (let axis = 0; axis < 2; axis++) {
    const dx = Math.cos(axis * Math.PI / 2), dz = Math.sin(axis * Math.PI / 2), w = PADDY_LOOK.farWidth / 2, h = PADDY_LOOK.farHeight;
    const points = [[-w, 0], [w, 0], [w * .7, h * .8], [-w, 0], [w * .7, h * .8], [-w * .6, h], [-w * .6, h], [w * .7, h * .8], [w * .15, h * 1.08]];
    for (const [x, y] of points) {
      pos.push(dx * x, y, dz * x); normals.push(0, 1, 0);
      const tip = Math.min(1, y / h), c = paddyFarRiceColor().multiplyScalar(PADDY_LOOK.farRootGain).lerp(paddyFarRiceColor(undefined,true), tip);
      colors.push(c.r, c.g, c.b);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x000000 });
  const distance = { value: profile.distance }, nearEnd={value:PADDY.riceDetailEnd};
  farWind(material, wind); patchPaddyRice(material, wind, { far: true, distance, nearEnd, debug });
  const far = new THREE.InstancedMesh(geo, material, layout.far.length); far.name = 'paddy-far-rice'; far.receiveShadow = true; far.frustumCulled = false;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), root = new THREE.Vector3(), tint = paddyFarRiceColor();
  const inverseTint=new THREE.Color().setRGB(1/tint.r,1/tint.g,1/tint.b);
  for (let i = 0; i < layout.far.length; i++) {
    const s = layout.far[i], p = layout.plots[s.plot]; root.set(s.x, s.y, s.z); scale.set(1, s.height, 1); matrix.compose(root, rotation, scale); far.setMatrixAt(i, matrix); far.setColorAt(i, debug ? paddyDebugColor(p.level) : paddyFarRiceColor(p).multiply(inverseTint));
  }
  far.instanceMatrix.needsUpdate = true; far.instanceColor.needsUpdate = true; group.add(far);
  // 描画用の順序はrank順。品質変更は数だけを減らすので毎コマの配列・行列確保は無い。
  const master = far.instanceMatrix.array.slice(), masterColors = far.instanceColor.array.slice();
  const nearDistances = new Float32Array(nearParts.length), radiusTriangles = new Float64Array(PADDY.detailEnd + 1);
  let lastX = Infinity, lastY = Infinity, lastZ = Infinity, dirty = true, tests = 0;
  const update = camera => {
    const c = camera.position;
    if (!dirty && Math.hypot(c.x - lastX, c.y - lastY, c.z - lastZ) < PADDY.updateStep) { work = 0; return; }
    const q = profile; let farBudgetCount = 0; distance.value = q.distance; let count = 0; tests = 0;
    for (let i = 0; i < layout.far.length && layout.far[i].rank < q.density; i++) {
      const s = layout.far[i]; tests++; farBudgetCount++;
      if (Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) > q.distance + PADDY_LOOK.farWidth) continue;
      for (let k = 0; k < 16; k++) far.instanceMatrix.array[count * 16 + k] = master[i * 16 + k];
      for (let k = 0; k < 3; k++) far.instanceColor.array[count * 3 + k] = masterColors[i * 3 + k];
      count++;
    }
    far.count = count; far.visible = count > 0; far.instanceMatrix.needsUpdate = true; far.instanceColor.needsUpdate = true;
    stoneDynamic.reset(); stoneNearCount = 0; stoneMidCount = 0; stoneBandCount = 0;
    for (const p of stoneParts) {
      tests++;
      const d = Math.hypot(p.item.x-c.x,p.item.y-c.y,p.item.z-c.z);
      if (d > q.distance || d > PADDY.stoneNear) continue;
      stoneDynamic.add(p.near); stoneNearCount++;
    }
    for (const p of bands) {
      tests++; const d = Math.hypot(p.item.x-c.x,(p.item.top+p.item.bottom)/2-c.y,p.item.z-c.z);
      if (d <= q.distance) { stoneDynamic.add(p); stoneBandCount++; }
    }
    stoneDynamic.finish();
    const available = budget - tris(detailMesh.geometry) - stoneDynamic.triangles() - farBudgetCount * tris(geo);
    detailRadius = Math.max(0, (quality === 'light' ? PADDY.lightDetailEnd : PADDY.detailEnd) - level * PADDY.detailAdapt);
    // 寄りで株が増えるときは距離だけを縮め、条の間隔と一株の形を保つ。
    radiusTriangles.fill(0);
    for (let i = 0; i < nearParts.length; i++) {
      const p = nearParts[i]; tests++;
      const d = Math.hypot(p.item.x-c.x,p.item.y-c.y,p.item.z-c.z);
      const end=p.item.rice?PADDY.riceDetailEnd:p.item.grass?PADDY.detailEnd:PADDY.stubbleDetailEnd;
      const density=(p.item.rice&&quality==='light'?PADDY.lightRiceDensity:1)*(1-level*PADDY.adaptDensity);
      nearDistances[i] = d>end||((p.item.rice||p.item.grass)&&p.item.rank>=density)?Infinity:d;
      if (nearDistances[i] <= detailRadius) radiusTriangles[Math.ceil(d)] += p.triangles;
    }
    let wanted = 0;
    for (let r = 0; r <= detailRadius; r++) {
      if (wanted + radiusTriangles[r] > available) { detailRadius = Math.max(0, r - 1); break; }
      wanted += radiusTriangles[r];
    }
    nearEnd.value=Math.min(detailRadius,PADDY.riceDetailEnd);
    nearDynamic.reset(); stubbleCount = 0; grassCount = 0; riceCount=0;
    for (let i = 0; i < nearParts.length; i++) {
      tests++; if (nearDistances[i] > detailRadius) continue;
      const p = nearParts[i], end=Math.min(detailRadius,p.item.rice?PADDY.riceDetailEnd:p.item.grass?PADDY.detailEnd:PADDY.stubbleDetailEnd);
      nearDynamic.add(p, Math.min(1, (end - nearDistances[i]) / PADDY.detailFade));
      if(p.item.rice)riceCount++;else if (p.item.plot === undefined) grassCount++; else stubbleCount++;
    }
    nearDynamic.finish();
    lastX = c.x; lastY = c.y; lastZ = c.z; dirty = false; work = tests;
  };
  far.count = 0;
  return { group, update, setLevel(n) { const v = Math.max(0, Math.min(3, Math.floor(n))); if (v !== level) { level = v; profile = paddyQuality(quality, level); dirty = true; } },
    stats() {
      const counts = { standing: 0, harvested: 0, partial: 0 }; for (const p of layout.plots) counts[p.kind]++;
      return { enabled: true, plots: layout.plots.length, ...counts, farRice: far.count, stoneLength: layout.stoneLength, terraces: layout.terraces, raisedBoundaries: layout.raisedBoundaries, flatBoundaries: layout.flatBoundaries, maxPlotArea: layout.maxPlotArea, contourLength: layout.contourLength, stoneBandVertices: stoneBandCount * 18, stoneBandCapacity: layout.stoneBandVertices, stones: layout.stones.length, racks: layout.racks.length, straw: layout.straw.length, stubble: stubbleCount, stubbleCapacity: layout.stubble.length, grass: grassCount, grassCapacity:layout.grass.length, rice:riceCount, riceCapacity:layout.rice.length, panicles:riceCount*(quality==='light'?PADDY.lightRiceHeads:PADDY.riceHeads), shadowLines:layout.raisedBoundaries, flatShadowLines:layout.flatBoundaries, detailRadius, stoneNear: stoneNearCount, stoneMid: stoneMidCount, stoneBands: stoneBandCount, riceRadius:Math.min(detailRadius,PADDY.riceDetailEnd),
        triangles: tris(detailMesh.geometry) + stoneDynamic.triangles() + nearDynamic.triangles() + far.count * tris(geo), drawCalls: 1 + Number(stoneDynamic.mesh.visible) + Number(nearDynamic.mesh.visible) + Number(far.count > 0), level, distance: distance.value, updateItems: work, capacity: layout.far.length };
    } };
}
