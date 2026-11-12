// ridges.js — 谷の外の山並みと、地形に沿う低い霧（view層）。
// 山は標準4段・軽量2段を1回で描く。旧い3枚の輪は切り戻し用に残す。
import * as THREE from 'three';
import { mulberry32 } from './scatter.js';
import { WORLD } from './world-data.js';
import { createTerrain } from './terrain-height.js';

// 距離・標高はm。角度の重なりを広げ、手前の輪郭に奥が隠れないようにする。
export const RIDGES = Object.freeze({
  segments: 360, bottom: -120, warmGain: 0.18, warmPower: 12, // 全周の刻み・裾・太陽側の暖色。
  // 日を山の端の上（15.5 度）へ上げたので、鞍部は、日の光線より 40m 低くする（日が、重なる稜線の上に出る）。光線より高くしたままだと、
  // 日の側で 4 段の稜線が同じ高さに集まり、重なりが読めなくなった。
  notchWidth: 0.20, notchOffset: -40, // 太陽側の鞍部の幅(rad)・日の光線からの標高の差(m。負＝光線より低い)。
  layers: Object.freeze([
    { radius: 760, base: 205, amp: 62, seed: 71, color: '#3d4a62' },
    { radius: 1100, base: 300, amp: 84, seed: 73, color: '#52607a' },
    { radius: 1460, base: 450, amp: 106, seed: 79, color: '#6b7791' },
    { radius: 1840, base: 595, amp: 128, seed: 83, color: '#949baf' },
  ]),
});
export const MIST = Object.freeze({
  height: 3.5, thickness: 11, width: 110, depth: 44, // 地形からの高さ・縦厚・横幅・奥行き(m)。厚さ 16m では、木立の上に白いこぶが盛り上がって見えた。
  farThickness: 180, farOffset: 24, // 段間の厚み・稜線の投影から帯の中心までの差(m)。裾を厚く隠す。
  // 実際の画面で見ると、濃さ 0.48・縁の幅 25% の帯は、白い半透明の板や、こぶに見えた（縁が硬い）。濃さを下げ、帯の上下と左右の
  // 全体をなだらかに薄め、近く（60m 以内）では描かない。霧は、遠くの谷にたなびく物として見せる。
  opacity: 0.36, opacityMax: 0.4, densityFloor: 0.5, near: 60, far: 200, // 不透明度・上限・斑の最低密度、接近時の消失距離(m)。
  foot: 0.45, crown: 0.5, side: 0.3, // 帯の高さ・幅に対する割合：下の縁・上の縁・左右の端を薄める幅。
  coolLift: 0.70, warmMix: 0.48, warmEndDeg: 90, warmFullDeg: 40, villageFade: 1.45, // 青白の持上げ／桃色の混合率、暖色の方位差(度)、里の保護域の倍率。
  speed: 0.7, scale: 0.018, breakup: 0.35, // 流速(m/s)・斑の尺度(1/m)・端の欠け。
  segments: 64, rows: 4, basinStep: 32, // 帯の分割数、くぼ地を探す格子(m)。
});

function ridge({ radius, base, amp, seed, color, cx, cz }) {
  const rnd = mulberry32(seed), N = 360, K = 24, phase = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
  const profile = i => {
    const a = i / N * Math.PI * 2;
    return base + amp * (0.55 + 0.28 * Math.sin(a * 3 + phase[0]) + 0.18 * Math.sin(a * 7 + phase[1]) + 0.10 * Math.sin(a * 17 + phase[2]) + 0.06 * Math.sin(a * 41 + phase[0] * 2));
  };
  const pos = [], col = [], idx = [], c = new THREE.Color(color);
  for (let i = 0; i <= N; i++) {
    const a = i / N * Math.PI * 2, x = cx + Math.cos(a) * radius, z = cz + Math.sin(a) * radius, h = profile(i % N);
    for (let k = 0; k <= 1; k++) {
      pos.push(x, k === 0 ? -120 : h, z);
      const shade = k === 0 ? 0.55 : 1;                    // 麓は暗く、稜線は明るく
      col.push(c.r * shade, c.g * shade, c.b * shade);
    }
  }
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, fog: true, depthWrite: true }));
  m.frustumCulled = false; m.renderOrder = -5;
  return m;
}

function legacyRidges({ center = [22, -8] } = {}) {
  const group = new THREE.Group(); group.name = 'ridges';
  const [cx, cz] = center;
  group.add(ridge({ radius: 1050, base: 120, amp: 520, seed: 71, color: '#3d4a62', cx, cz }));
  group.add(ridge({ radius: 1500, base: 200, amp: 760, seed: 73, color: '#52607a', cx, cz }));
  group.add(ridge({ radius: 1950, base: 300, amp: 980, seed: 79, color: '#6b7791', cx, cz }));
  return group;
}

const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export const mistNearFade = distance => smooth(MIST.near, MIST.far, distance);
export function ridgeHeight(layer, angle, sun = null) {
  const phase = layer.seed * 0.173;
  let h = layer.base + layer.amp * (0.55 + 0.28 * Math.sin(angle * 3 + phase) + 0.18 * Math.sin(angle * 7 - phase) + 0.1 * Math.sin(angle * 17 + phase * 2));
  if (sun) {
    const dot = Math.cos(angle) * sun.x + Math.sin(angle) * sun.z;
    const separation = Math.acos(Math.max(-1, Math.min(1, dot / Math.hypot(sun.x, sun.z))));
    const weight = Math.exp(-Math.pow(separation / RIDGES.notchWidth, 2));
    const saddle = layer.radius * sun.y / Math.hypot(sun.x, sun.z) + RIDGES.notchOffset;
    h += (saddle - h) * weight;
  }
  return h;
}
// 帯の中心は川の中心線、または低い地形の格子から決める。座標や当たり判定は変更しない。
export function mistSites(world = WORLD, terrain = createTerrain(world)) {
  const sites = [];
  for (let i = 1; i < world.river.points.length - 1; i += 2) {
    const [x, z] = world.river.points[i];
    sites.push({ x, z, y: terrain.heightAt(x, z) + MIST.height, width: MIST.width, thickness: MIST.thickness, kind: 'river' });
  }
  for (const side of [-1, 1]) for (const depth of [-1, 1]) {
    let best = null;
    const v = world.valley;
    for (let ix = 1; ix <= 4; ix++) for (let iz = 1; iz <= 4; iz++) {
      const x = v.cx + side * ix * MIST.basinStep, z = v.cz + depth * iz * MIST.basinStep;
      const y = terrain.heightAt(x, z);
      if (!best || y < best.y) best = { x, y, z };
    }
    sites.push({ ...best, y: best.y + MIST.height, width: MIST.width, thickness: MIST.thickness, kind: 'basin' });
  }
  return sites;
}
function geometry(pos, colors, ids, indices) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (colors) g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (ids) g.setAttribute('layerId', new THREE.Float32BufferAttribute(ids, 1));
  g.setIndex(indices); return g;
}
function mountainMesh(center) {
  const pos = [], col = [], ids = [], indices = [];
  for (let l = 0; l < RIDGES.layers.length; l++) {
    const layer = RIDGES.layers[l], c = new THREE.Color(layer.color);
    for (let i = 0; i <= RIDGES.segments; i++) {
      const angle = i / RIDGES.segments * Math.PI * 2;
      for (let k = 0; k <= 1; k++) {
        pos.push(center[0] + Math.cos(angle) * layer.radius, k ? ridgeHeight(layer, angle) : RIDGES.bottom, center[1] + Math.sin(angle) * layer.radius);
        const shade = k ? 1 : 0.55;
        col.push(c.r * shade, c.g * shade, c.b * shade); ids.push(l);
      }
    }
    const offset = l * (RIDGES.segments + 1) * 2;
    for (let i = 0; i < RIDGES.segments; i++) { const a = offset + i * 2; indices.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  }
  const m = new THREE.Mesh(geometry(pos, col, ids, indices), new THREE.ShaderMaterial({
    side: THREE.DoubleSide, vertexColors: true, fog: false,
    uniforms: { warm: { value: new THREE.Color('#e8c08c') }, sun: { value: new THREE.Vector3() }, debug: { value: 0 } },
    vertexShader: `attribute float layerId; varying vec3 vColour; varying vec3 vWorld; varying float vLayer;
      void main(){ vColour=color;vWorld=position;vLayer=layerId;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
    fragmentShader: `uniform vec3 warm,sun;uniform float debug;varying vec3 vColour,vWorld;varying float vLayer;
      void main(){float s=pow(max(0.0,dot(normalize(vWorld.xz),normalize(sun.xz))),${RIDGES.warmPower.toFixed(2)});
        vec3 c=mix(vColour,warm,s*${RIDGES.warmGain.toFixed(3)});
        if(debug>.5)c=vLayer<.5?vec3(.0,.4,.1):vLayer<1.5?vec3(.0,.6,1.):vLayer<2.5?vec3(1.,.4,0.):vec3(1.,0.,1.);
        gl_FragColor=vec4(c,1.0); }`,
  }));
  m.name = 'ridge-layers'; m.frustumCulled = false; m.renderOrder = -5; return m;
}
const village = WORLD.flats.find(flat => flat.id === 'village');
export function mistVillageFade(x, z) {
  const dx = x - village.x, dz = z - village.z, c = Math.cos(village.rot), s = Math.sin(village.rot);
  return smooth(1, MIST.villageFade, Math.max(Math.abs(c * dx + s * dz) / village.hx, Math.abs(-s * dx + c * dz) / village.hz));
}
// 帯の中の位置から決まる形：v は下から上（0〜1）、top は雑音で揺れる上の端、u は左右（0〜1）。シェーダーと同じ式。
export function mistShape(v, top) { return smooth(0, MIST.foot, v) * (1 - smooth(top - MIST.crown, top, v)); }
export function mistSide(u) { return smooth(0, MIST.side, u) * (1 - smooth(1 - MIST.side, 1, u)); }
export function mistOpacity(shape, edge, noise, distance, x, z) {
  const density = MIST.densityFloor + (1 - MIST.densityFloor) * smooth(MIST.breakup, 0.78, noise);
  return Math.max(0, Math.min(MIST.opacityMax, shape * edge * density * mistNearFade(distance) * MIST.opacity * mistVillageFade(x, z)));
}
export const MIST_VERTEX = `attribute vec2 bandUv;varying vec2 vUv;varying vec3 vWorld;
  void main(){vUv=bandUv;vWorld=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`;
export const MIST_FRAGMENT = `uniform vec3 cool,warm,sun;uniform float clock,debug;
  varying vec2 vUv;varying vec3 vWorld;
  float hash(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
  float noise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1.,0.)),f.x),mix(hash(i+vec2(0.,1.)),hash(i+vec2(1.)),f.x),f.y);}
  void main(){
    float distanceToEye=length(vWorld-cameraPosition);
    float fade=smoothstep(${MIST.near.toFixed(2)},${MIST.far.toFixed(2)},distanceToEye);
    vec2 p=vWorld.xz*${MIST.scale.toFixed(5)}+vec2(clock*${(MIST.speed * MIST.scale).toFixed(5)},0.0);
    float n=noise(p)*.65+noise(p*2.07+3.1)*.35;
    float top=.65+noise(p*.7+7.0)*.35;
    float shape=smoothstep(0.0,${MIST.foot.toFixed(3)},vUv.y)*(1.0-smoothstep(top-${MIST.crown.toFixed(3)},top,vUv.y));
    float edge=smoothstep(0.0,${MIST.side.toFixed(3)},vUv.x)*(1.0-smoothstep(${(1 - MIST.side).toFixed(3)},1.0,vUv.x));
    float density=${MIST.densityFloor.toFixed(3)}+(1.0-${MIST.densityFloor.toFixed(3)})*smoothstep(${MIST.breakup.toFixed(3)},.78,n);
    vec2 localP=vWorld.xz-vec2(${village.x.toFixed(3)},${village.z.toFixed(3)});
    localP=mat2(${Math.cos(village.rot).toFixed(5)},${(-Math.sin(village.rot)).toFixed(5)},${Math.sin(village.rot).toFixed(5)},${Math.cos(village.rot).toFixed(5)})*localP;
    float villageMask=smoothstep(1.0,${MIST.villageFade.toFixed(3)},max(abs(localP.x)/${village.hx.toFixed(3)},abs(localP.y)/${village.hz.toFixed(3)}));
    float alpha=clamp(shape*edge*density*fade*${MIST.opacity.toFixed(3)}*villageMask,0.0,${MIST.opacityMax.toFixed(3)});
    vec3 direction=normalize(vWorld-cameraPosition);
    float facing=smoothstep(${Math.cos(MIST.warmEndDeg * Math.PI / 180).toFixed(5)},${Math.cos(MIST.warmFullDeg * Math.PI / 180).toFixed(5)},dot(normalize(direction.xz),normalize(sun.xz)));
    vec3 c=mix(cool,warm,facing);
    if(debug>.5)c=vec3(0.0,1.0,1.0);
    gl_FragColor=vec4(c,alpha);
  }`;
function mistMesh(sites, center) {
  const pos = [], uv = [], idx = [], ridgeVertices = [];
  const bands = [];
  for (let l = 0; l < RIDGES.layers.length - 1; l++) {
    const layer = RIDGES.layers[l];
    bands.push({ kind: 'ridge', layer, radius: (layer.radius + RIDGES.layers[l + 1].radius) / 2,
      thickness: MIST.farThickness });
  }
  bands.reverse(); // 透明な段間の霧は奥から重ねる。
  bands.push(...sites);
  for (const band of bands) {
    const offset = pos.length / 3;
    for (let i = 0; i <= MIST.segments; i++) {
      const u = i / MIST.segments, angle = -Math.PI + u * Math.PI;
      const x = band.kind === 'ridge' ? center[0] + Math.cos(angle) * band.radius : band.x + (u - .5) * band.width;
      const z = band.kind === 'ridge' ? center[1] + Math.sin(angle) * band.radius : band.z + Math.sin(u * Math.PI * 2) * MIST.thickness;
      for (let k = 0; k <= MIST.rows; k++) { const v = k / MIST.rows;
        const base = band.kind === 'ridge' ? ridgeHeight(band.layer, angle) * band.radius / band.layer.radius + MIST.farOffset : band.y;
        // 近い帯は奥行きのある低い弧にする。垂直な幕は上から見ると消えた。
        const swell = .85 + .15 * Math.sin(u * Math.PI * 6);
        const y = base + (band.kind === 'ridge' ? (v - .4) : Math.sin(v * Math.PI)) * band.thickness * swell;
        if (band.kind === 'ridge') ridgeVertices.push({ index: pos.length / 3, band, angle, offset: y - base });
        pos.push(x, y, band.kind === 'ridge' ? z : z + (v - .5) * MIST.depth); uv.push(u, v);
      }
    }
    for (let i = 0; i < MIST.segments; i++) for (let k = 0; k < MIST.rows; k++) {
      const a = offset + i * (MIST.rows + 1) + k, b = a + MIST.rows + 1;
      idx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }
  const g = geometry(pos, null, null, idx); g.setAttribute('bandUv', new THREE.Float32BufferAttribute(uv, 2));
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({ side: THREE.DoubleSide, transparent: true, depthWrite: false, fog: false,
    uniforms: { cool: { value: new THREE.Color() }, warm: { value: new THREE.Color() }, sun: { value: new THREE.Vector3() }, clock: { value: 0 }, debug: { value: 0 } },
    vertexShader: MIST_VERTEX, fragmentShader: MIST_FRAGMENT,
  }));
  m.name = 'valley-mist'; m.frustumCulled = false; return { mesh: m, bands, ridgeVertices, indices: g.index.array.slice() };
}
export function buildRidges({ center = [WORLD.valley.cx, WORLD.valley.cz], search = typeof location === 'undefined' ? '' : location.search } = {}) {
  const q = new URLSearchParams(search), old = q.get('ridges2') === '0', mistEnabled = q.get('mist2') !== '0';
  const group = old ? legacyRidges({ center }) : new THREE.Group(); group.name = 'ridges';
  const mountains = old ? null : mountainMesh(center);
  if (mountains) group.add(mountains);
  let heightSamples = 0;
  const terrain = mistEnabled ? createTerrain(WORLD) : null;
  const sites = mistEnabled ? mistSites(WORLD, { heightAt(x, z) { heightSamples++; return terrain.heightAt(x, z); } }) : [];
  const mist = mistEnabled ? mistMesh(sites, center) : null;
  if (mist) group.add(mist.mesh);
  let activeLayers = old ? 3 : 4, activeBands = mist?.bands.length ?? 0, work = 0;
  group.userData.configure = ({ quality = 'standard', tier = 0, a }) => {
    activeLayers = old ? 3 : quality === 'light' || tier >= 2 ? 2 : tier ? 3 : 4;
    if (mountains) {
      const g = mountains.geometry, p = g.attributes.position;
      for (let l = 0; l < RIDGES.layers.length; l++) for (let i = 0; i <= RIDGES.segments; i++) {
        p.setY((l * (RIDGES.segments + 1) + i) * 2 + 1, ridgeHeight(RIDGES.layers[l], i / RIDGES.segments * Math.PI * 2, a.sunDir)); work++;
      }
      p.needsUpdate = true; g.setDrawRange(0, activeLayers * RIDGES.segments * 6);
      mountains.material.uniforms.warm.value.set(a.hazeWarm); mountains.material.uniforms.sun.value.copy(a.sunDir);
      mountains.material.uniforms.debug.value = +(q.get('ridges2debug') === '1');
    }
    if (mist) {
      const p = mist.mesh.geometry.attributes.position;
      for (const vertex of mist.ridgeVertices) {
        const { band, angle, offset } = vertex;
        p.setY(vertex.index, ridgeHeight(band.layer, angle, a.sunDir) * band.radius / band.layer.radius + MIST.farOffset + offset); work++;
      }
      p.needsUpdate = true;
      // 軽量では帯を交互に残す。山間・川・くぼ地のすべてが残る。
      activeBands = tier >= 3 ? Math.ceil(mist.bands.length / 3) : quality === 'light' || tier >= 2 ? Math.ceil(mist.bands.length / 2) : tier ? mist.bands.length - 2 : mist.bands.length;
      const eligible = mist.bands.map((band, i) => ({ band, i })).filter(({band}) => band.kind !== 'ridge' || RIDGES.layers.indexOf(band.layer) < activeLayers - 1);
      activeBands = Math.min(activeBands, eligible.length);
      const selected = Array.from({ length: activeBands }, (_, i) => eligible[Math.floor(i * eligible.length / activeBands)].i);
      selected.sort((x, y) => x - y);
      const index = mist.mesh.geometry.index, perBand = MIST.segments * MIST.rows * 6;
      for (let i = 0; i < selected.length; i++) index.array.set(mist.indices.subarray(selected[i] * perBand, (selected[i] + 1) * perBand), i * perBand);
      index.needsUpdate = true; mist.mesh.geometry.setDrawRange(0, activeBands * perBand);
      const u = mist.mesh.material.uniforms;
      u.cool.value.set(a.fogColor).multiplyScalar(1 + MIST.coolLift); u.warm.value.set(a.hazeWarm).lerp(new THREE.Color(a.mid), MIST.warmMix); u.sun.value.copy(a.sunDir); u.debug.value = +(q.get('mist2debug') === '1');
    }
  };
  group.userData.update = dt => { if (mist) mist.mesh.material.uniforms.clock.value += dt; };
  group.userData.stats = () => ({ ridgeLayers: activeLayers, mistBands: activeBands,
    drawCalls: old ? 3 + (mist ? 1 : 0) : 1 + (mist ? 1 : 0),
    triangles: activeLayers * RIDGES.segments * 2 + activeBands * MIST.segments * MIST.rows * 2,
    work, siteHeightSamples: heightSamples, vertices: (mountains ? mountains.geometry.attributes.position.count : 0) + (mist ? mist.mesh.geometry.attributes.position.count : 0), updateWork: mist ? 1 : 0, textureBytes: 0 });
  return group;
}
