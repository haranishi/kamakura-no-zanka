// water.js — 川（清瀬川）の水面（view層）。川の中心線に沿った帯に、空を映して流れる水の面を張る。
// 岸との境目は、水面が地面より下になるところで自然に切れる（深度で隠れる）。帯の縁だけ透かし、浅いところは淡く・縁は白く泡立てる。
import * as THREE from 'three';
import { RIVER_ART, riverFlags, riverBudget, riverLayout, riverSamples, riverPoint, foamPhase } from './river-rocks.js';

// 色は既存の旗の木・布、水の泡、および同梱の地表画像の平均から取る。
export const RIVER_LOOK = Object.freeze({
  wood: '#4a3a2a', cloth: '#e8dfc6', grass: '#6b6a35', gravel: '#796c5b', dirt: '#b68c64', // sRGB：既存の色。
  foam: [0.86, 0.90, 0.88], wetRock: 0.55, dryRock: 0.9, // 線形RGB・倍率：既存水面の泡と岩の明るさ。
  gray: '#808080', white: '#ffffff', yellow: '#ffff00', brown: '#8b4513', red: '#ff0000', pink: '#ff66bb', // 確認色。
  foamPixels: 64, foamRidges: 4, foamRidgeWidth: 0.28, foamWobble: 0.18, // 画素・本・比率：流す泡の手続き画像。
  clothSegments: 2, clothCrosswind: 0.12, clothFlutter: 0.035, // 分割・m・m：既存の旗と同じ裾の動き。
  clothSwayRate: 1.3, clothSwayPhase: 1.5, clothWavePhase: 3.6, clothWave: 0.2, clothFlutterRate: 5.3, clothFlutterPhase: 7, clothLift: 0.25, // rad/s・rad・m・比：旗の周期と位相。
  rockWobble: 0.08, rockNoise: [17, 11, 13], // 比率・rad/m：丸い岩の凹凸。
  groundShade: 0.1, groundNoise: [0.43, 0.38], // 比率・rad/m：地表色の小さなむら。
  towerFloor: 0.67, towerEave: 0.82, towerRoof: 0.18, towerRoofRadius: 0.85, // 高さ比・幅比：櫓の輪郭。
  floorThickness: 0.22, railHeight: 1, railRadius: 0.12, braceRadius: 0.1, // m：櫓の床・手すり・筋交い。
  hutWall: 0.65, hutRoof: 0.35, hutRoofRadius: 0.8, hutDepth: 0.8, // 高さ比・幅比：小屋の形。
  foamColumns: 4, wakeTaper: 0.5, // 分割・比率：泡の横断面と先の細まり。
  farGrid: 8, nearBounds: [-152, 192, -152, 136], // m：既存の地面メッシュの格子。浮き・埋まり防止用。
  rockRoughness: 0.92, woodRoughness: 0.88, groundRoughness: 1, // 材質の粗さ。
});

// 夕日の照り返しの強さ。日を北東の低い位置へ動かすと、見渡しのカメラが日を正面に見るので、core 3.0・wide 0.35 では川面が白く飛び、
// にじみが橋まで覆った（実際の画面で見て直した）。細い筋（core）と広いにじみ（wide）を弱め、足す光に上限（cap）を付ける。
// それでも白く飛んだ：原因は、材質そのものの、太陽の鏡面反射だった。水面から出る光の全体にも上限（limit）を付ける。
export const WATER_GLINT = Object.freeze({ core: 1.1, corePower: 90, wide: 0.12, widePower: 14, cap: 0.85, limit: 1.05 });
export function buildWater({ terrain, world, sunDir = new THREE.Vector3(0.5, 0.17, 0.85) }) {
  const L = terrain.riverLine, hw = world.river.halfWidth + 2.2;
  const pos = [], uv = [], idx = [];
  let along = 0;
  for (let i = 0; i < L.length; i++) {
    const p = L[i], a = L[Math.max(0, i - 1)], b = L[Math.min(L.length - 1, i + 1)];
    let tx = b.x - a.x, tz = b.z - a.z; const tl = Math.hypot(tx, tz) || 1; tx /= tl; tz /= tl;
    const nx = -tz, nz = tx;
    if (i > 0) along += Math.hypot(p.x - L[i - 1].x, p.z - L[i - 1].z);
    const y = terrain.waterLevelAt(p.x, p.z);
    for (const s of [-1, 1]) { pos.push(p.x + nx * hw * s, y, p.z + nz * hw * s); uv.push(s, along); }
    if (i > 0) { const k = (i - 1) * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(idx);
  geometry.computeVertexNormals();
  // 面が下向きなら巻き順を反転する（どちら向きの川でも上を向く）
  if (geometry.attributes.normal.getY(0) < 0) { const a = geometry.index.array; for (let i = 0; i < a.length; i += 3) { const t = a[i + 1]; a[i + 1] = a[i + 2]; a[i + 2] = t; } geometry.index.needsUpdate = true; geometry.computeVertexNormals(); }

  const uniforms = { uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ color: 0x23565c, roughness: 0.09, metalness: 0.0, transparent: true, opacity: 0.92, depthWrite: false, envMapIntensity: 0.95 });
  material.onBeforeCompile = shader => {
    shader.uniforms.uTime = uniforms.uTime; shader.uniforms.SUN_DIR_W = { value: sunDir.clone().normalize() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vWUv; varying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWUv = uv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform float uTime; varying vec2 vWUv; varying vec3 vWPos; uniform vec3 SUN_DIR_W;
        float w_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float w_noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(w_hash(i), w_hash(i + vec2(1., 0.)), f.x), mix(w_hash(i + vec2(0., 1.)), w_hash(i + vec2(1.)), f.x), f.y); }
        float w_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * w_noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        float w_height(vec2 p) { return w_fbm(p * vec2(0.9, 0.55) + vec2(0.0, -uTime * 0.55)) + 0.5 * w_fbm(p * 2.1 + vec2(uTime * 0.18, -uTime * 0.9)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float edge = abs(vWUv.x);
        vec3 deep = vec3(0.035, 0.12, 0.15), shallow = vec3(0.14, 0.27, 0.26);
        diffuseColor.rgb = mix(deep, shallow, smoothstep(0.35, 1.0, edge));
        float foam = smoothstep(0.80, 0.98, edge) * smoothstep(0.35, 0.8, w_fbm(vWPos.xz * 1.6 + vec2(0.0, -uTime * 0.6)));
        float streak = smoothstep(0.72, 0.9, w_fbm(vWPos.xz * vec2(2.4, 0.7) + vec2(0.0, -uTime * 0.8))) * 0.35;
        // 白波：流れの筋に沿った細い泡の帯を、中ほどにも散らす（平らな灰青の面に見えた）。瀬の位置は川に沿った低周波のむらで決める
        float rapid = smoothstep(0.55, 0.8, w_fbm(vec2(vWUv.y * 0.035, 3.7))) * smoothstep(0.35, 0.7, w_fbm(vWPos.xz * vec2(3.6, 1.1) + vec2(0.0, -uTime * 1.3))) * (1.0 - smoothstep(0.75, 1.0, edge)) * 0.75;
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.88), clamp(foam + rapid + streak * (1.0 - edge), 0.0, 0.88));
        diffuseColor.a *= 1.0 - smoothstep(0.93, 1.0, edge);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz; float e = 0.16;
          float h0 = w_height(p), hx = w_height(p + vec2(e, 0.0)), hz = w_height(p + vec2(0.0, e));
          vec3 nw = normalize(vec3((h0 - hx) * 0.9, 1.0, (h0 - hz) * 0.9));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(nw, 0.0)).xyz), 0.85));
        }`)
      // 夕日の照り返し：太陽の方向へ細い光の筋が水面に伸びる（波の法線で割れる）。見る角度が浅いほど強い
      .replace('#include <opaque_fragment>', `
        {
          vec3 vdir = normalize(vWPos - cameraPosition);
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 rf = reflect(vdir, wn);
          float glint = pow(max(dot(rf, SUN_DIR_W), 0.0), ${WATER_GLINT.corePower.toFixed(1)}) * ${WATER_GLINT.core.toFixed(3)} + pow(max(dot(rf, SUN_DIR_W), 0.0), ${WATER_GLINT.widePower.toFixed(1)}) * ${WATER_GLINT.wide.toFixed(3)};
          outgoingLight += vec3(1.0, 0.78, 0.55) * min(glint, ${WATER_GLINT.cap.toFixed(3)}) * (1.0 - abs(vdir.y));
          outgoingLight = min(outgoingLight, vec3(${WATER_GLINT.limit.toFixed(3)}));
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'valley-water-v3';
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'water'; mesh.renderOrder = 2; mesh.receiveShadow = false; mesh.castShadow = false; mesh.frustumCulled = false;
  return { mesh, update(time) { uniforms.uTime.value = time; } };
}

// 追加の川景色は既存の props の寿命に合わせる。水面そのものには手を入れない。
// QA: __valley.game.props.river.stats()。Three.jsの公開された形状・材質だけを使い、GLSLは足さない。
const A = RIVER_ART, C = RIVER_LOOK;
const triCount = mesh => (mesh.geometry.index?.count ?? mesh.geometry.attributes.position.count) / 3;

// 地面の色は、地形関数ではなく実際の格子三角形の高さへ貼る。山頂で細かい面が地面へ潜らない。
export function riverGroundHeight(terrain, x, z) {
  const b = C.nearBounds, near = x >= b[0] && x <= b[1] && z >= b[2] && z <= b[3];
  const step = near ? 1 : C.farGrid, x0 = Math.floor(x / step) * step, z0 = Math.floor(z / step) * step;
  const u = (x - x0) / step, v = (z - z0) / step;
  const a = terrain.heightAt(x0, z0), b1 = terrain.heightAt(x0 + step, z0), c = terrain.heightAt(x0, z0 + step), d = terrain.heightAt(x0 + step, z0 + step);
  return u + v <= 1 ? a + (b1 - a) * u + (c - a) * v : d + (c - d) * (1 - u) + (b1 - d) * (1 - v);
}
function joined(parts) {
  const geometry = new THREE.BufferGeometry();
  for (const [key, size] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 4]]) {
    const values = new Float32Array(parts.reduce((n, g) => n + g.attributes.position.count, 0) * size);
    let offset = 0;
    for (const g of parts) { values.set(g.attributes[key].array, offset); offset += g.attributes[key].array.length; }
    geometry.setAttribute(key, new THREE.BufferAttribute(values, size));
  }
  geometry.computeBoundingSphere();
  for (const g of parts) g.dispose();
  return geometry;
}
function tinted(geometry, color, alpha = 1) {
  const g = geometry.index ? geometry.toNonIndexed() : geometry;
  if (g !== geometry) geometry.dispose();
  const c = color.isColor ? color : new THREE.Color(color), colors = new Float32Array(g.attributes.position.count * 4);
  for (let i = 0; i < g.attributes.position.count; i++) colors.set([c.r, c.g, c.b, alpha], i * 4);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 4));
  return g;
}
function foamTexture() {
  const n = C.foamPixels, bytes = new Uint8Array(n * n * 4);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
    const u = x / n, v = y / n;
    const line = Math.sin((v * C.foamRidges + Math.sin(u * Math.PI * 2) * C.foamWobble) * Math.PI * 2);
    const ridge = Math.max(0, (line - (1 - C.foamRidgeWidth)) / C.foamRidgeWidth);
    const value = Math.round(255 * (A.foamFloor + (1 - A.foamFloor) * ridge));
    bytes.set([value, value, value, 255], (y * n + x) * 4);
  }
  const texture = new THREE.DataTexture(bytes, n, n);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter; texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
// UIの既存の品質欄を読み、設定変更も反映する。mainや設定保存へ配線を増やさない。
function currentQuality(query) {
  return globalThis.window?.__valley?.game?.post?.quality || globalThis.document?.getElementById?.('set-quality')?.value || query.get('q') || 'standard';
}
export function riverAdaptLevel(renderer, quality, query) {
  const base = query.has('w') ? 1 : Math.min(globalThis.devicePixelRatio || 1, quality === 'light' ? 1 : 1.5);
  const ratio = renderer.getPixelRatio() / base;
  let level = 0;
  while (level < A.adaptScales.length - 1 && ratio < (A.adaptScales[level] + A.adaptScales[level + 1]) / 2) level++;
  return level;
}

export function buildRiverDetails({ world, terrain, models = {}, search = globalThis.location?.search || '', quality = null }) {
  const flags = riverFlags(search), query = new URLSearchParams(search), group = new THREE.Group(); group.name = 'river-details';
  const layout = riverLayout(world, terrain, flags), samples = riverSamples(terrain);
  const records = [], clothEntries = [], drawn = { rocks: 0, largeRocks: 0, smallRocks: 0, foam: 0, rapids: 0, shoals: layout.shoals.length, fenceLength: layout.fences.reduce((n, f) => n + Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z), 0), banners: layout.banners.length, fortObjects: layout.fences.filter(f => f.group === 'fort').length + layout.banners.filter(f => f.group === 'fort').length + layout.towers.length + layout.huts.length + (flags.fort ? 1 : 0), triangles: 0, draws: 0, adapt: 0, quality: 'standard', frameWork: 0 };
  const material = (roughness, transparent = false) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness, transparent, depthWrite: !transparent, side: THREE.FrontSide });
  const meshOf = (name, parts, mat, count = {}) => {
    if (!parts.length) { mat.dispose(); return null; }
    const mesh = new THREE.Mesh(joined(parts), mat); mesh.name = name; mesh.frustumCulled = false; mesh.castShadow = false; mesh.receiveShadow = false;
    group.add(mesh); records.push({ mesh, triangles: triCount(mesh), ...count }); return mesh;
  };
  // 岩は既存の岩の材質・絵を使う。形だけを低密度の丸い多面体にし、濡れた石を暗くする。
  if (layout.rocks.length) {
    const geometry = new THREE.IcosahedronGeometry(0.5, A.rockDetail), pos = geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i), f = 1 + C.rockWobble * Math.sin(x * C.rockNoise[0] + z * C.rockNoise[1]) * Math.cos(y * C.rockNoise[2]);
      pos.setXYZ(i, x * f, y + 0.5, z * f);
    }
    // 最大径は1m以内。指定した径を越えず、岩の頭が水面から出る形を保つ。
    geometry.computeBoundingBox(); const size = geometry.boundingBox.getSize(new THREE.Vector3()); geometry.scale(1 / Math.max(size.x, size.z), 1, 1 / Math.max(size.x, size.z)); geometry.computeVertexNormals();
    let source;
    models.boulder?.traverse(o => { if (!source && o.isMesh) source = o.material; });
    const mat = flags.debug ? new THREE.MeshBasicMaterial({ color: C.gray }) : source?.clone() || new THREE.MeshStandardMaterial({ color: C.gravel, roughness: C.rockRoughness });
    mat.roughness = C.rockRoughness;
    const mesh = new THREE.InstancedMesh(geometry, mat, layout.rocks.length); mesh.name = 'river-rocks'; mesh.frustumCulled = false;
    group.add(mesh); records.push({ mesh, triangles: triCount(mesh), rocks: true });
  }
  // 地面の薄い色：河原と砦の草地・道を同じ材質でまとめる。境界だけ透かして切り紙の縁を避ける。
  const ground = [];
  const patch = (x, z, radiusX, radiusZ, tx, tz, color, groupName) => {
    const segments = A.patchSides, rings = Math.ceil(Math.max(radiusX, radiusZ) / A.groundStep), positions = [], colors = [], uv = [];
    const c = new THREE.Color(flags.debug ? (groupName === 'fort' ? C.pink : C.yellow) : color);
    const point = (ring, k) => {
      const r = ring / rings, angle = k / segments * Math.PI * 2, u = Math.cos(angle) * radiusX * r, v = Math.sin(angle) * radiusZ * r;
      const px = x + tx * u - tz * v, pz = z + tz * u + tx * v;
      positions.push(px, riverGroundHeight(terrain, px, pz) + A.groundLift, pz); uv.push(u, v);
      const shade = flags.debug ? 1 : 1 - C.groundShade + C.groundShade * Math.sin(px * C.groundNoise[0]) * Math.sin(pz * C.groundNoise[1]);
      colors.push(c.r * shade, c.g * shade, c.b * shade, ring === rings && !flags.debug ? 0 : 1);
    };
    for (let r = 0; r < rings; r++) for (let k = 0; k < segments; k++) {
      point(r, k); point(r + 1, k + 1); point(r + 1, k);
      if (r) { point(r, k); point(r, k + 1); point(r + 1, k + 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 4)); g.computeVertexNormals(); ground.push(g);
  };
  for (const s of layout.shoals) patch(s.x, s.z, s.length / 2, s.width / 2, s.tx, s.tz, C.gravel, 'river');
  if (layout.clearing) {
    const c = layout.clearing; patch(c.x, c.z, c.radius, c.radius, 1, 0, C.grass, 'fort');
    // 道は細い三角形の帯。地面を削らず、既存の斜面へ沿わせる。
    const positions = [], uv = [];
    for (let i = 1; i < layout.path.length; i++) {
      const a = layout.path[i - 1], b = layout.path[i], len = Math.hypot(b.x - a.x, b.z - a.z), nx = -(b.z - a.z) / len, nz = (b.x - a.x) / len, n = Math.ceil(len / A.groundStep);
      const point = (k, side) => {
        const x = a.x + (b.x - a.x) * k / n + nx * A.pathWidth / 2 * side, z = a.z + (b.z - a.z) * k / n + nz * A.pathWidth / 2 * side;
        positions.push(x, riverGroundHeight(terrain, x, z) + A.groundLift * 2, z); uv.push(side, k);
      };
      for (let k = 0; k < n; k++) { point(k, -1); point(k + 1, 1); point(k + 1, -1); point(k, -1); point(k, 1); point(k + 1, 1); }
    }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals(); ground.push(tinted(g, flags.debug ? C.pink : C.dirt));
  }
  const groundMesh = meshOf('river-ground', ground, flags.debug ? new THREE.MeshBasicMaterial({ vertexColors: true }) : material(C.groundRoughness, true));
  if (groundMesh) { groundMesh.renderOrder = 1; groundMesh.material.polygonOffset = true; groundMesh.material.polygonOffsetFactor = -1; }
  const wood = [], poleColor = d => flags.debug ? (d.group === 'fort' ? C.pink : C.brown) : C.wood;
  const beam = (from, to, radius, d, pointed = false) => {
    const direction = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z), length = direction.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), direction.normalize());
    const tip = pointed ? A.fenceTip : 0;
    const add = (g, y) => { g.translate(0, y, 0).applyQuaternion(q).translate(from.x, from.y, from.z); wood.push(tinted(g, poleColor(d))); };
    add(new THREE.CylinderGeometry(radius, radius, length - tip, A.postSides), (length - tip) / 2);
    if (tip) add(new THREE.ConeGeometry(radius, tip, A.postSides), length - tip / 2);
  };
  const post = (x, z, height, radius, d, pointed = false) => {
    const y = terrain.heightAt(x, z); beam({ x, y: y - A.groundLift, z }, { x, y: y + height, z }, radius, d, pointed);
  };
  for (const f of layout.fences) {
    const len = Math.hypot(f.to.x - f.from.x, f.to.z - f.from.z), n = Math.max(1, Math.round(len / A.fenceStep));
    for (let i = 0; i < n; i++) { const t = (i + 0.5) / n; post(f.from.x + (f.to.x - f.from.x) * t, f.from.z + (f.to.z - f.from.z) * t, f.height, A.fenceRadius, f, true); }
  }
  for (const d of layout.gates) {
    const half = (d.opening + A.gatePost) / 2, ends = [-1, 1].map(k => ({ x: d.x + d.acrossX * half * k, z: d.z + d.acrossZ * half * k }));
    const y = Math.max(...ends.map(p => terrain.heightAt(p.x, p.z))) + d.height - A.gateBeam / 2;
    for (const p of ends) beam({ ...p, y: terrain.heightAt(p.x, p.z) - A.groundLift }, { ...p, y }, A.gatePost / 2, d);
    const ext = half + A.gatePost; beam({ x: d.x - d.acrossX * ext, y, z: d.z - d.acrossZ * ext }, { x: d.x + d.acrossX * ext, y, z: d.z + d.acrossZ * ext }, A.gateBeam / 2, d);
  }
  const box = (x, y, z, w, h, depth, d) => wood.push(tinted(new THREE.BoxGeometry(w, h, depth).translate(x, y + h / 2, z), poleColor(d)));
  for (const d of layout.towers) {
    const y = terrain.heightAt(d.x, d.z), half = d.width / 2, floor = y + d.height * C.towerFloor, eave = y + d.height * C.towerEave;
    for (const x of [-half, half]) for (const z of [-half, half]) beam({ x: d.x + x, y: y - A.groundLift, z: d.z + z }, { x: d.x + x, y: eave, z: d.z + z }, A.gatePost / 2, d);
    box(d.x, floor, d.z, d.width, C.floorThickness, d.width, d);
    for (const k of [-1, 1]) {
      beam({ x: d.x - half, y: floor + C.railHeight, z: d.z + half * k }, { x: d.x + half, y: floor + C.railHeight, z: d.z + half * k }, C.railRadius, d);
      beam({ x: d.x + half * k, y: floor + C.railHeight, z: d.z - half }, { x: d.x + half * k, y: floor + C.railHeight, z: d.z + half }, C.railRadius, d);
      beam({ x: d.x - half, y, z: d.z + half * k }, { x: d.x + half, y: floor, z: d.z + half * k }, C.braceRadius, d);
    }
    wood.push(tinted(new THREE.ConeGeometry(d.width * C.towerRoofRadius, d.height * C.towerRoof, 4).rotateY(Math.PI / 4).translate(d.x, eave + d.height * C.towerRoof / 2, d.z), poleColor(d)));
  }
  for (const d of layout.huts) {
    const y = terrain.heightAt(d.x, d.z); box(d.x, y - A.groundLift, d.z, d.width, d.height * C.hutWall, d.width * C.hutDepth, d);
    wood.push(tinted(new THREE.ConeGeometry(d.width * C.hutRoofRadius, d.height * C.hutRoof, 4).rotateY(Math.PI / 4).translate(d.x, y + d.height * (C.hutWall + C.hutRoof / 2), d.z), poleColor(d)));
  }
  const cloth = [];
  for (const d of layout.banners) {
    const y = terrain.heightAt(d.x, d.z); post(d.x, d.z, d.height, A.bannerPole, d);
    beam({ x: d.x - d.width / 2, y: y + d.height, z: d.z }, { x: d.x + d.width / 2, y: y + d.height, z: d.z }, A.bannerPole / 2, d);
    const g = tinted(new THREE.PlaneGeometry(d.width, A.bannerLength, C.clothSegments, A.bannerRows).translate(d.x, y + d.height - A.bannerLength / 2, d.z), flags.debug ? (d.group === 'fort' ? C.pink : C.red) : C.cloth);
    clothEntries.push({ start: cloth.reduce((n, g) => n + g.attributes.position.count, 0), count: g.attributes.position.count, top: y + d.height, x: d.x, z: d.z }); cloth.push(g);
  }
  meshOf('river-timber', wood, flags.debug ? new THREE.MeshBasicMaterial({ vertexColors: true }) : material(C.woodRoughness));
  const clothMat = flags.debug ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) : material(C.woodRoughness); clothMat.side = THREE.DoubleSide; clothMat.forceSinglePass = true;
  const clothMesh = meshOf('river-cloth', cloth, clothMat), clothBase = clothMesh?.geometry.attributes.position.array.slice();
  // 岩の後ろと瀬：中心線を追う三角形の帯。模様のUVはメートルなので、曲がっても下流へ同じ速さで流れる。
  const foams = [], foamRanges = [];
  for (const d of layout.foam) {
    const positions = [], uv = [], alpha = [], rows = Math.ceil(d.length / A.groundStep), columns = C.foamColumns;
    const point = (row, col) => {
      const t = row / rows, side = col / columns * 2 - 1, taper = d.kind === 'wake' ? Math.sin(Math.PI * t) * C.wakeTaper + 1 - C.wakeTaper : 1;
      const p = riverPoint(samples, d.along + t * d.length, d.offset + side * d.width / 2 * taper);
      positions.push(p.x, terrain.waterLevelAt(p.x, p.z) + A.groundLift, p.z); uv.push(col / columns, foamPhase(d.along + t * d.length, 0));
      alpha.push(Math.sin(Math.PI * t) * (1 - Math.abs(side)));
    };
    for (let r = 0; r < rows; r++) for (let col = 0; col < columns; col++) { point(r, col); point(r + 1, col + 1); point(r + 1, col); point(r, col); point(r, col + 1); point(r + 1, col + 1); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2)); g.computeVertexNormals();
    const colored = tinted(g, C.white), a = colored.attributes.color;
    for (let i = 0; i < alpha.length; i++) a.setW(i, flags.debug ? 1 : alpha[i]);
    const p = riverPoint(samples, d.along, d.offset); foamRanges.push({ ...p, kind: d.kind, start: foams.reduce((n, g) => n + g.attributes.position.count, 0), count: colored.attributes.position.count }); foams.push(colored);
  }
  const foamMap = foams.length && !flags.debug ? foamTexture() : null;
  const foamMat = new THREE.MeshBasicMaterial({ color: flags.debug ? C.white : new THREE.Color(...C.foam), vertexColors: true, transparent: true, opacity: flags.debug ? 1 : A.foamOpacity, alphaMap: foamMap, depthWrite: false });
  const foamMesh = meshOf('river-foam', foams, foamMat); if (foamMesh) foamMesh.renderOrder = 3;
  // 同じバッファを再利用し、描く小物だけを先頭へ詰める。大岩と瀬は距離に関係なく残す。
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), scale = new THREE.Vector3(), position = new THREE.Vector3(), tint = new THREE.Color();
  const foamOriginal = foamMesh ? Object.fromEntries(Object.entries(foamMesh.geometry.attributes).map(([k, a]) => [k, a.array.slice()])) : null;
  const foamAttributes = foamMesh ? Object.entries(foamMesh.geometry.attributes).map(([k, a]) => ({ attribute: a, base: foamOriginal[k], size: a.itemSize })) : [];
  let lastQuality = '', lastAdapt = -1, lastX = Infinity, lastZ = Infinity, budget = riverBudget();
  function select(camera, q, adapt) {
    if (q === lastQuality && adapt === lastAdapt && Math.hypot(camera.position.x - lastX, camera.position.z - lastZ) < A.selectionMove) return;
    lastQuality = q; lastAdapt = adapt; lastX = camera.position.x; lastZ = camera.position.z; riverBudget(q, adapt, budget);
    drawn.quality = q; drawn.adapt = adapt; drawn.rocks = drawn.largeRocks = drawn.smallRocks = drawn.foam = drawn.rapids = drawn.triangles = drawn.draws = drawn.frameWork = 0;
    const maxSmall = Math.floor(A.smallCount * budget.fraction);
    for (const r of records) {
      const mesh = r.mesh;
      if (r.rocks) {
        for (let i = 0; i < layout.rocks.length; i++) {
          const d = layout.rocks[i]; drawn.frameWork++;
          if (d.kind === 'small' && (drawn.smallRocks >= maxSmall || Math.hypot(d.x - lastX, d.z - lastZ) > budget.smallDistance)) continue;
          position.set(d.x, d.y, d.z); rotation.setFromAxisAngle(up, d.rot); scale.set(d.size, d.height, d.depth); matrix.compose(position, rotation, scale); mesh.setMatrixAt(drawn.rocks, matrix);
          tint.setScalar(flags.debug ? 1 : d.wet ? C.wetRock : C.dryRock); mesh.setColorAt(drawn.rocks, tint);
          drawn.rocks++; if (d.kind === 'large') drawn.largeRocks++; else drawn.smallRocks++;
        }
        mesh.count = drawn.rocks; mesh.instanceMatrix.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
        drawn.triangles += r.triangles * mesh.count; if (mesh.count) drawn.draws++;
      } else if (mesh === foamMesh) {
        let count = 0;
        for (let i = 0; i < foamRanges.length; i++) {
          const f = foamRanges[i]; drawn.frameWork++;
          if (f.kind !== 'rapid' && (i % Math.max(1, Math.round(1 / budget.fraction)) !== 0 || Math.hypot(f.x - lastX, f.z - lastZ) > budget.smallDistance)) continue;
          for (const a of foamAttributes) {
            const dst = count * a.size, src = f.start * a.size;
            for (let k = 0; k < f.count * a.size; k++) a.attribute.array[dst + k] = a.base[src + k];
            a.attribute.needsUpdate = true;
          }
          count += f.count; drawn.foam++; if (f.kind === 'rapid') drawn.rapids++;
        }
        mesh.geometry.setDrawRange(0, count); drawn.triangles += count / 3; if (count) drawn.draws++;
      } else { drawn.triangles += r.triangles; drawn.draws++; }
    }
  }
  // 各メッシュ自身の描画直前に読むため、最初の描画から軽量・自動解像度・固定画角に追従する。
  for (const { mesh } of records) mesh.onBeforeRender = (renderer, scene, camera) => {
    const q = typeof quality === 'function' ? quality() : quality || currentQuality(query);
    select(camera, q, riverAdaptLevel(renderer, q, query));
  };
  let disposed = false;
  const api = {
    group, layout,
    select(camera, q = 'standard', adapt = 0) { select(camera, q, adapt); },
    update(time) {
      if (foamMap) foamMap.offset.y = foamPhase(0, time);
      if (!clothMesh) return;
      const pos = clothMesh.geometry.attributes.position;
      for (const b of clothEntries) for (let i = b.start; i < b.start + b.count; i++) {
        const y = clothBase[i * 3 + 1], down = Math.max(0, (b.top - y) / A.bannerLength), bend = down * down;
        pos.setXYZ(i, clothBase[i * 3] + Math.sin(time * C.clothSwayRate + b.z + down * C.clothSwayPhase) * C.clothCrosswind * bend, y + A.bannerWave * bend * C.clothLift,
          clothBase[i * 3 + 2] + A.bannerWave * bend + Math.sin(time * A.bannerRate + down * C.clothWavePhase + b.x) * C.clothWave * bend + Math.sin(time * C.clothFlutterRate + down * C.clothFlutterPhase) * C.clothFlutter * down);
      }
      pos.needsUpdate = true; clothMesh.geometry.computeVertexNormals();
    },
    stats() { return { ...drawn, placed: { rocks: layout.rocks.length, foam: layout.foam.length, shoals: layout.shoals.length, gates: layout.gates.length, towers: layout.towers.length, huts: layout.huts.length, banners: layout.banners.length }, clearingRadius: layout.clearing?.radius || 0, clothVertices: clothBase ? clothBase.length / 3 : 0, bufferedTriangles: records.reduce((n, r) => n + r.triangles * (r.rocks ? layout.rocks.length : 1), 0) }; },
    dispose() { if (disposed) return; disposed = true; for (const { mesh } of records) { mesh.dispose?.(); mesh.geometry.dispose(); mesh.material.dispose(); mesh.removeFromParent(); } foamMap?.dispose(); group.removeFromParent(); },
  };
  select({ position: { x: 0, z: 0 } }, typeof quality === 'string' ? quality : currentQuality(query), 0);
  return api;
}
