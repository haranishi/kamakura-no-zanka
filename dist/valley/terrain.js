// terrain.js — 地形メッシュ（近景1m・遠景8m）と、6層の質感を重ねる材質（view層）。
// 高さ・路面の重みは terrain-height.js（純関数）から取る。近景と遠景は縁で縫合して、継ぎ目に割れを出さない。
import * as THREE from 'three';
import { smooth, fbm } from './terrain-height.js';
import { WORLD } from './world-data.js';
import { TREES } from './config.js';
import { ATMOS } from './atmosphere.js';
import { forestGroveAt } from './tree-species.js';
import { fortGrassAt } from './scatter.js';
import { paddySurfaceColor, paddySurfaceMask, patchPaddyGround, paddyDebugColor } from './paddy-view.js';
import { paddyAt, paddyOptions, createPaddyPlots, PADDY_LOOK } from './paddy.js';
// 森の下の地面を暗くする強さ：近く（gain・急な斜面で戻す量 steepRelief）と、遠く（farGain）。木の密度に掛けて 1 で頭打ち。
// 遠くは 1.5 → 2.6：まばらに木が立つ急な斜面でも、地面が森の床の色になり、木が「茶色の壁に刺さって」見えない。
export const FOREST_FLOOR = Object.freeze({ gain: 1.5, steepRelief: 0.15, farGain: 2.6 });

const LAYERS = ['grass', 'dirt', 'rock', 'gravel', 'mud', 'litter'];
// 1回繰り返しあたりのメートル数
const TILE = { grass: 2.8, dirt: 2.4, rock: 4.2, gravel: 2.0, mud: 2.6, litter: 3.0 };
const NEAR = { x0: -152, x1: 192, z0: -152, z1: 136, step: 1 };
const FAR = { half: 640, step: 8 };
const SIZE = 1024;

// 樹冠は世界位置の地図を両メッシュで共有する。歩行域の色と質感はそのまま残す。
export const CANOPY = Object.freeze({
  cell: 7, jitter: .44, warp: 1.6, // m・比率・m：5〜9mの樹冠の斑、中心の散らし、領域の歪み。
  contrast: .55, brightness: .15, warmth: .18, blue: .12, normalTilt: .85, gapShade: .30, // 比率：丸みの明暗・個体差・日なた・日陰・擬似法線。
  blend: 40, edgeWarp: 6, protectedFade: 4, seam: 8, edgeWave: 29, // m：近景の移行帯・縁の雑音・保護域の外での立上り。
  gapInner: .18, gapOuter: .85, warpWaves: [19, 23], warpOffset: 17, // セル内の半径比・m・位相：斑の中心と暗い隙間、歪みの波長。
  grassWave: 9, grassVariation: .10, margin: 12, // m・比率・m：草のむらと模様を入れない余白。
  mapStep: 4, forestRange: [.32, .68], slopeRange: [47, 61], // m・密度・度：共通地図と森／岩の境。
  needleShade: '#213a25', needleSun: '#5c7f4c', needleMix: .60, // 杉の房の手続き色（t/rの両端）と平均の推定位置。
  shade: .48, sun: 1.12, emissive: .24, // 倍率：木と共通の陰〜日なたの範囲と葉の散乱光。
  grass: '#6b6a35', grassSun: .30, grassGold: '#c2a040', // 既存の里の草・欅の黄から作る丘の日なた。
  debug: ['#22b34a', '#ca352d', '#808080'], // 樹冠・紅葉・それ以外。
});
const canopyEdgeNoise = (x, z) => {
  const h = (x, z) => { const n = Math.sin(x * 127.1 + z * 311.7) * 43758.5453; return n - Math.floor(n); };
  const ix = Math.floor(x), iz = Math.floor(z), fx = x - ix, fz = z - iz;
  const a = fx * fx * (3 - 2 * fx), b = fz * fz * (3 - 2 * fz);
  const lo = h(ix, iz) * (1 - a) + h(ix + 1, iz) * a, hi = h(ix, iz + 1) * (1 - a) + h(ix + 1, iz + 1) * a;
  return (lo * (1 - b) + hi * b) * 2 - 1;
};
const canopyPalettes = () => {
  const c = TREES.forest2, p = TREES.palette;
  const autumn = c.tones.map((t, i) => {
    const colors = i < 3 ? p.maple : p.zelkova, k = Math.floor(t);
    const color = new THREE.Color(colors[k]).lerp(new THREE.Color(colors[Math.min(k + 1, colors.length - 1)]), t - k);
    if (i === 0) color.lerp(new THREE.Color(p.zelkova[3]), c.toneMix[0]).multiplyScalar(1 - c.toneMix[0]);
    if (i === 4) color.lerp(new THREE.Color(p.zelkova[c.tones[3]]), c.toneMix[4]);
    return color.multiplyScalar(TREES.leafGain);
  });
  const cedar = new THREE.Color(TREES.palette.cedar[0]).multiply(new THREE.Color(CANOPY.needleShade).lerp(new THREE.Color(CANOPY.needleSun), CANOPY.needleMix));
  return { cedar, autumn };
};
export function canopyBlendAt(world, x, z) {
  const b = world.bounds, m = CANOPY.margin;
  const outside = Math.max(b.minX - m - x, x - b.maxX - m, b.minZ - m - z, z - b.maxZ - m, 0);
  if (!outside) return 0;
  const edge = Math.min(x - NEAR.x0, NEAR.x1 - x, z - NEAR.z0, NEAR.z1 - z);
  const warp = CANOPY.edgeWarp * canopyEdgeNoise(x / CANOPY.edgeWave, z / CANOPY.edgeWave);
  return (1 - smooth(CANOPY.seam, CANOPY.seam + CANOPY.blend, edge + warp)) * smooth(0, CANOPY.protectedFade, outside);
}
export function canopyFieldAt(world, terrain, x, z, fort = true) {
  const forest = terrain.forestDensity(x, z), road = terrain.roadInfo(x, z);
  const slope = terrain.slopeAt?.(x, z) ?? 0;
  const eligible = (terrain.waterAt(x, z) > .05 ? 0 : 1) * (1 - (road?.w ?? 0));
  const hill = fort ? fortGrassAt(world, x, z) * eligible : 0;
  const weight = smooth(...CANOPY.forestRange, forest) * (1 - smooth(...CANOPY.slopeRange, slope)) * eligible * (1 - hill);
  if (weight <= 0) return [0, 0, 0, hill];
  const grove = forestGroveAt(world, x, z), c = TREES.forest2;
  const autumn = (1 - smooth(1 - c.edge, 1 + c.edge, grove.distance)) * (1 - smooth(...c.slope, slope));
  return [weight, autumn, grove.tone / 4, hill];
}
// 照明前の比較用。両メッシュはこの同じ場を一枚の地図で参照する。
export function canopyColorAt(world, terrain, x, z, { enabled = true, fort = true } = {}) {
  const field = canopyFieldAt(world, terrain, x, z, fort), palette = canopyPalettes();
  const color = palette.cedar.clone().lerp(palette.autumn[Math.round(field[2] * 4)], field[1]);
  return { color, weight: enabled ? field[0] * canopyBlendAt(world, x, z) : 0, grove: field[1], hill: field[3] };
}
function canopyMap(world, terrain, fort) {
  const step = CANOPY.mapStep, n = Math.ceil(FAR.half * 2 / step) + 1, data = new Uint8Array(n * n * 4);
  let area = 0, hillArea = 0, work = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -FAR.half + i * step, z = -FAR.half + j * step, field = canopyFieldAt(world, terrain, x, z, fort);
    for (let k = 0; k < 4; k++) data[(j * n + i) * 4 + k] = Math.round(field[k] * 255);
    area += field[0] * canopyBlendAt(world, x, z); hillArea += field[3]; work++;
  }
  const texture = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
  texture.minFilter = texture.magFilter = THREE.LinearFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
  return { texture, area: area / (n * n), hillArea: hillArea * step * step, work, bytes: data.byteLength };
}

export function paddyGroundMap(world, terrain, debug = false) {
  const T = world.terraces, plots = createPaddyPlots(world, terrain), step = PADDY_LOOK.mapStep;
  const nx = Math.ceil((T.x1 - T.x0) / step), nz = Math.ceil((T.z1 - T.z0) / step), data = new Uint8Array(nx * nz * 4), phaseData = new Uint8Array(nx * nz * 4);
  let covered = 0, eligible = 0;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = T.x0 + (i + .5) * step, z = T.z0 + (j + .5) * step, s = paddyAt(plots, x, z), road = terrain.roadInfo(x, z);
    const k = (j * nx + i) * 4;
    const phase = Math.round(Math.max(0, Math.min(1, (plots.field.value(x,z) * world.terraces.drop / PADDY_LOOK.rowGradient + PADDY_LOOK.phaseOffset) / PADDY_LOOK.phaseRange)) * 65535);
    phaseData[k] = phase >>> 8; phaseData[k+1] = phase & 255; phaseData[k+3] = 255;
    if (!s || (road && road.dist <= step / Math.SQRT2)) continue;
    eligible++;
    const color = debug ? paddyDebugColor(s.plot.level, s.riser) : paddySurfaceColor(s, x, z);
    data[k] = Math.round(color.r * 255); data[k + 1] = Math.round(color.g * 255); data[k + 2] = Math.round(color.b * 255); data[k + 3] = debug ? 255 : paddySurfaceMask(s);
    if (!s.bund) covered++;
  }
  return { data, phaseData, nx, nz, x0: T.x0, z0: T.z0, width: nx * step, depth: nz * step, coverage: covered / eligible };
}


async function decode(url) {
  const blob = await (await fetch(url)).blob();
  const bitmap = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = SIZE;
  const g = canvas.getContext('2d', { willReadFrequently: true });
  g.drawImage(bitmap, 0, 0, SIZE, SIZE);
  return g.getImageData(0, 0, SIZE, SIZE).data;
}

// 色(+粗さをalpha)の配列テクスチャと、法線の配列テクスチャを作る。
export async function loadGroundTextures(base, anisotropy = 8) {
  const colorData = new Uint8Array(SIZE * SIZE * 4 * LAYERS.length), normalData = new Uint8Array(SIZE * SIZE * 4 * LAYERS.length);
  await Promise.all(LAYERS.map(async (layer, k) => {
    const [c, n, r] = await Promise.all(['c', 'n', 'r'].map(s => decode(`${base}${layer}_${s}.jpg`)));
    const off = k * SIZE * SIZE * 4;
    for (let i = 0; i < SIZE * SIZE; i++) {
      colorData[off + i * 4] = c[i * 4]; colorData[off + i * 4 + 1] = c[i * 4 + 1]; colorData[off + i * 4 + 2] = c[i * 4 + 2]; colorData[off + i * 4 + 3] = r[i * 4];
      normalData[off + i * 4] = n[i * 4]; normalData[off + i * 4 + 1] = n[i * 4 + 1]; normalData[off + i * 4 + 2] = n[i * 4 + 2]; normalData[off + i * 4 + 3] = 255;
    }
  }));
  const make = (data, srgb) => {
    const t = new THREE.DataArrayTexture(data, SIZE, SIZE, LAYERS.length);
    t.format = THREE.RGBAFormat; t.type = THREE.UnsignedByteType;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = anisotropy;
    t.needsUpdate = true;
    return t;
  };
  return { color: make(colorData, true), normal: make(normalData, false) };
}

function terrainMaterial(textures, quality, coverUniforms, canopyUniforms) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  const tiles = LAYERS.map(l => TILE[l]);
  const detail = material.userData.uDetailU = { value: quality === 'light' ? 0 : 1 };
  material.onBeforeCompile = shader => {
    shader.uniforms.uTexC = { value: textures.color };
    shader.uniforms.uTexN = { value: textures.normal };
    shader.uniforms.uTile = { value: tiles };
    shader.uniforms.uDetail = detail;
    Object.assign(shader.uniforms, coverUniforms, canopyUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aS0; attribute vec3 aS1;
        varying vec3 vS0; varying vec3 vS1; varying vec3 vWorldPos; varying vec3 vWorldNormal;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        vS0 = aS0; vS1 = aS1; vWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWorldNormal = normalize(mat3(modelMatrix) * objectNormal);`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        precision highp sampler2DArray;
        uniform sampler2DArray uTexC; uniform sampler2DArray uTexN; uniform float uTile[6]; uniform float uDetail;
        uniform sampler2D uCover; uniform vec2 uCoverOrigin; uniform vec2 uCoverSize;
        uniform float uMeadow; uniform vec3 uMeadowTint;
        varying vec3 vS0; varying vec3 vS1; varying vec3 vWorldPos; varying vec3 vWorldNormal;
        float th_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float th_noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(th_hash(i), th_hash(i + vec2(1., 0.)), f.x), mix(th_hash(i + vec2(0., 1.)), th_hash(i + vec2(1.)), f.x), f.y); }
        vec4 th_c(float l, vec2 uv) { return texture(uTexC, vec3(uv, l)); }
        vec3 th_n(float l, vec2 uv) { return texture(uTexN, vec3(uv, l)).xyz * 2.0 - 1.0; }
        vec3 gN; float gRough;`)
      .replace('#include <map_fragment>', `
        vec3 nW = normalize(vWorldNormal);
        vec2 wxz = vWorldPos.xz;
        float w[6]; w[0] = vS0.x; w[1] = vS0.y; w[2] = vS0.z; w[3] = vS1.x; w[4] = vS1.y; w[5] = vS1.z;
        vec2 coverUV = (wxz - uCoverOrigin) / uCoverSize;
        float cover = texture(uCover, coverUV).r;
        if (any(lessThan(coverUV, vec2(0.0))) || any(greaterThanEqual(coverUV, vec2(1.0)))) cover = 0.0;
        float k = cover * uMeadow;
        w[0] = mix(w[0], 1.0, k);
        w[1] *= (1.0 - k); w[3] *= (1.0 - k); w[4] *= (1.0 - k); w[5] *= (1.0 - k);
        float edgeNoise = th_noise(wxz * 0.7) - 0.5;
        for (int i = 0; i < 6; i++) w[i] = max(0.0, w[i] + edgeNoise * 0.22 * (w[i] > 0.02 ? 1.0 : 0.0));
        // 重みのほぼ無い層は読まない（影響はゼロ）。分岐の中でも段差が出ないよう、微分は分岐の外で作って textureGrad に渡す。
        vec2 dWx = dFdx(wxz), dWy = dFdy(wxz);
        float farMix = smoothstep(70.0, 260.0, length(vViewPosition));
        float fade = (1.0 - smoothstep(35.0, 140.0, length(vViewPosition))) * uDetail;
        vec4 c[6]; vec3 nn[6];
        for (int i = 0; i < 6; i++) {
          c[i] = vec4(0.0); nn[i] = vec3(0.0);
          if (i == 2 || w[i] < 0.004) continue;
          float lf = float(i); vec2 uv = wxz / uTile[i]; vec2 gx = dWx / uTile[i], gy = dWy / uTile[i];
          c[i] = textureGrad(uTexC, vec3(uv, lf), gx, gy);
          if (fade > 0.001) nn[i] = textureGrad(uTexN, vec3(uv, lf), gx, gy).xyz * 2.0 - 1.0;
          // 遠くでは質感の繰り返しが格子に見えるので、各層の平均色（低いミップ）へ寄せる
          if (farMix > 0.001) c[i].rgb = mix(c[i].rgb, textureLod(uTexC, vec3(uv, lf), 7.0).rgb, farMix);
        }
        // 岩は三平面投影（急な面でも伸びない）
        vec3 bw = pow(abs(nW), vec3(4.0)); bw /= (bw.x + bw.y + bw.z);
        float rt = uTile[2];
        vec3 nX = vec3(0.0), nY = vec3(0.0), nZ = vec3(0.0);
        if (w[2] >= 0.004) {
          vec2 uX = vWorldPos.zy / rt, uY = wxz / rt, uZ = vWorldPos.xy / rt;
          vec2 dPzy = vec2(dFdx(vWorldPos.z), dFdx(vWorldPos.y)), dPzyY = vec2(dFdy(vWorldPos.z), dFdy(vWorldPos.y));
          vec2 dPxy = vec2(dFdx(vWorldPos.x), dFdx(vWorldPos.y)), dPxyY = vec2(dFdy(vWorldPos.x), dFdy(vWorldPos.y));
          vec4 rX = textureGrad(uTexC, vec3(uX, 2.0), dPzy / rt, dPzyY / rt), rY = textureGrad(uTexC, vec3(uY, 2.0), dWx / rt, dWy / rt), rZ = textureGrad(uTexC, vec3(uZ, 2.0), dPxy / rt, dPxyY / rt);
          c[2] = rX * bw.x + rY * bw.y + rZ * bw.z;
          c[2].rgb = mix(c[2].rgb, textureLod(uTexC, vec3(uY, 2.0), 7.0).rgb, farMix);
          if (fade > 0.001) {
            nX = textureGrad(uTexN, vec3(uX, 2.0), dPzy / rt, dPzyY / rt).xyz * 2.0 - 1.0;
            nY = textureGrad(uTexN, vec3(uY, 2.0), dWx / rt, dWy / rt).xyz * 2.0 - 1.0;
            nZ = textureGrad(uTexN, vec3(uZ, 2.0), dPxy / rt, dPxyY / rt).xyz * 2.0 - 1.0;
          }
        }
        // 高さ合成：質感の明るさを凹凸の代わりにして、境目をぎざつかせる
        float total = 0.0; float score[6];
        for (int i = 0; i < 6; i++) { float lum = dot(c[i].rgb, vec3(0.3, 0.55, 0.15)); score[i] = w[i] * pow(0.30 + lum, 2.0); total += score[i]; }
        vec3 albedo = vec3(0.0); float rough = 0.0; vec2 txy = vec2(0.0);
        for (int i = 0; i < 6; i++) {
          float k = score[i] / max(total, 1e-5);
          albedo += c[i].rgb * k; rough += c[i].a * k;
          if (i != 2) txy += nn[i].xy * k;
        }
        float rk = score[2] / max(total, 1e-5);
        float macro = th_noise(wxz * 0.045) * 0.5 + th_noise(wxz * 0.19 + 7.1) * 0.35 + th_noise(wxz * 0.9) * 0.15;
        albedo *= 0.72 + macro * 0.32;                     // 日なたの土は明るすぎた（第3周：中央値146、参照111〜130）。1割強暗く
        albedo = mix(albedo, albedo * vec3(0.92, 1.05, 0.85), clamp(w[0] * 1.2, 0.0, 1.0));
        // 彩度を少し落とす（日なたの地面が橙一色に飽和し、土や草の粒の明暗が潰れた。第2周の評価）
        { float al = dot(albedo, vec3(0.3, 0.55, 0.15)); albedo = mix(vec3(al), albedo, 0.88); }
        albedo = mix(albedo, uMeadowTint, cover * 0.25 * smoothstep(20.0, 70.0, length(vViewPosition)));
        diffuseColor.rgb *= albedo;
        gRough = clamp(rough, 0.35, 1.0);
        // UDN 合成（世界座標）。上向きの面は xz 平面、岩は三面。
        vec3 nw = nW;
        nw.xz += txy * (1.0 - rk) * 0.85 * fade;
        nw.xz += (nY.xy * bw.y) * rk * fade; nw.yz += (nX.xy * bw.x) * rk * fade; nw.xy += (nZ.xy * bw.z) * rk * fade;
        gN = normalize(nw);`)
      .replace('#include <roughnessmap_fragment>', `float roughnessFactor = gRough;`)
      .replace('#include <normal_fragment_maps>', `normal = normalize((viewMatrix * vec4(gN, 0.0)).xyz);`);
  };
  patchCanopyMaterial(material);
  material.customProgramCacheKey = () => 'valley-terrain-v4-meadow';     // 品質は uniform（uDetail）で切り替えるので、プログラムは1つ
  return material;
}

// 材質は一つ。品質と自動調整はuniformでセル探索の仕事だけを減らす。
function patchCanopyMaterial(material) {
  const before = material.onBeforeCompile, c = CANOPY;
  material.onBeforeCompile = shader => {
    before(shader);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uCanopyField;
      uniform float uCanopy, uCanopyDebug, uFortGround, uFortDebug, uCanopyDetail;
      uniform vec3 uCanopySun, uCedar, uAutumn[5], uHillGrass, uHillGold;
      float th_hash(vec2 p); float th_noise(vec2 p);
      float canopyWeight; float hillWeight; vec3 canopyCheck;
      // 独立に散らした中心の最近点。世界XZで計算し、8mの頂点格子には依存しない。
      vec3 canopyCell(vec2 point) {
        vec2 p = point / ${c.cell.toFixed(2)};
        p += (vec2(th_noise(point / ${c.warpWaves[0].toFixed(1)}), th_noise(point / ${c.warpWaves[1].toFixed(1)} + ${c.warpOffset.toFixed(1)})) - .5) * ${ (c.warp/c.cell).toFixed(4)};
        vec2 cell = floor(p), delta = vec2(0.0); float best = 100.0, identity = 0.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
          if (uCanopyDetail < .5 && (i == -1 || j == -1)) continue;
          vec2 id = cell + vec2(float(i), float(j));
          vec2 centre = id + .5 + (vec2(th_hash(id), th_hash(id + 71.0)) * 2.0 - 1.0) * ${c.jitter.toFixed(3)};
          vec2 v = p - centre; float d = dot(v, v);
          if (d < best) { best = d; delta = v; identity = th_hash(id + 173.0); }
        }
        return vec3(delta, identity);
      }`);
    shader.fragmentShader = shader.fragmentShader.replace('gN = normalize(nw);', `gN = normalize(nw);
      canopyWeight = 0.0; hillWeight = 0.0;
      if (uCanopy > .5 || uFortGround > .5) {
      vec4 canopyField = texture(uCanopyField, (wxz + ${FAR.half.toFixed(1)} + ${ (c.mapStep/2).toFixed(1)}) / ${ (FAR.half*2+c.mapStep).toFixed(1)});
      float nearEdge = min(min(wxz.x - ${NEAR.x0.toFixed(1)}, ${NEAR.x1.toFixed(1)} - wxz.x), min(wxz.y - ${NEAR.z0.toFixed(1)}, ${NEAR.z1.toFixed(1)} - wxz.y));
      float protect = max(max(${(WORLD.bounds.minX-c.margin).toFixed(1)} - wxz.x, wxz.x - ${(WORLD.bounds.maxX+c.margin).toFixed(1)}), max(${(WORLD.bounds.minZ-c.margin).toFixed(1)} - wxz.y, wxz.y - ${(WORLD.bounds.maxZ+c.margin).toFixed(1)}));
      float edgeWarp = (th_noise(wxz / ${c.edgeWave.toFixed(1)}) * 2.0 - 1.0) * ${c.edgeWarp.toFixed(1)};
      float groundBlend = (1.0 - smoothstep(${c.seam.toFixed(1)}, ${(c.seam+c.blend).toFixed(1)}, nearEdge + edgeWarp)) * smoothstep(0.0, ${c.protectedFade.toFixed(1)}, protect);
      float surfaceClear = (1.0 - clamp(vS0.y, 0.0, 1.0)) * (1.0 - clamp(vS1.x, 0.0, 1.0));
      canopyWeight = canopyField.r * groundBlend * uCanopy * surfaceClear;
      vec3 canopyNormal = vec3(0.0, 1.0, 0.0);
      float canopyLight = .5, cellValue = .5, crownFill = 1.0;
      if (canopyWeight > .001) {
        vec3 cell = canopyCell(wxz);
        canopyNormal = normalize(vec3(cell.x * ${c.normalTilt.toFixed(3)}, 1.0, cell.y * ${c.normalTilt.toFixed(3)}));
        canopyLight = clamp(.5 + dot(canopyNormal, uCanopySun) * ${c.contrast.toFixed(3)}, 0.0, 1.0);
        cellValue = cell.z;
        crownFill = 1.0 - ${c.gapShade.toFixed(3)} * smoothstep(${c.gapInner.toFixed(3)}, ${c.gapOuter.toFixed(3)}, length(cell.xy));
      }
      float tone = canopyField.b * 4.0; int toneLo = int(floor(tone)), toneHi = min(4, toneLo + 1);
      vec3 crownColor = mix(uCedar, mix(uAutumn[toneLo], uAutumn[toneHi], fract(tone)), canopyField.g);
      crownColor *= crownFill * mix(${c.shade.toFixed(3)}, ${c.sun.toFixed(3)}, canopyLight) * (1.0 + (cellValue * 2.0 - 1.0) * ${c.brightness.toFixed(3)});
      crownColor *= mix(vec3(${(1-c.blue).toFixed(3)}, 1.0, ${(1+c.blue).toFixed(3)}), vec3(${(1+c.warmth).toFixed(3)}, 1.0, ${(1-c.warmth).toFixed(3)}), canopyLight);
      diffuseColor.rgb = mix(diffuseColor.rgb, crownColor, canopyWeight);
      float hill = canopyField.a * uFortGround * surfaceClear; hillWeight = hill;
      vec3 hillColor = mix(uHillGrass, uHillGold, ${c.grassSun.toFixed(3)} * max(0.0, dot(nW, uCanopySun)));
      hillColor *= ${(1-c.grassVariation).toFixed(3)} + ${(2*c.grassVariation).toFixed(3)} * th_noise(wxz / ${c.grassWave.toFixed(1)});
      diffuseColor.rgb = mix(diffuseColor.rgb, hillColor, hill);
      gN = normalize(mix(gN, canopyNormal, canopyWeight));
      canopyCheck = mix(vec3(${new THREE.Color(c.debug[2]).toArray().map(x=>x.toFixed(4)).join(',')}), mix(vec3(${new THREE.Color(c.debug[0]).toArray().map(x=>x.toFixed(4)).join(',')}), vec3(${new THREE.Color(c.debug[1]).toArray().map(x=>x.toFixed(4)).join(',')}), step(.35, canopyField.g)), step(.1, canopyWeight));
      }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
        totalEmissiveRadiance += diffuseColor.rgb * canopyWeight * ${c.emissive.toFixed(3)};`)
      .replace('#include <fog_fragment>', '#include <fog_fragment>\n if (uCanopyDebug > .5 && uCanopy > .5) gl_FragColor.rgb = canopyCheck;\n if (uFortDebug > .5 && hillWeight > .1) gl_FragColor.rgb = vec3(1.0, .1328683, .5028865);');
  };
}

// 高さの格子から法線を出す（隣の頂点との差）
function gridNormals(heights, nx, nz, step) {
  const n = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const hl = heights[j * nx + Math.max(0, i - 1)], hr = heights[j * nx + Math.min(nx - 1, i + 1)];
    const hu = heights[Math.max(0, j - 1) * nx + i], hd = heights[Math.min(nz - 1, j + 1) * nx + i];
    const dx = (hr - hl) / (2 * step), dz = (hd - hu) / (2 * step), l = Math.hypot(dx, 1, dz), k = (j * nx + i) * 3;
    n[k] = -dx / l; n[k + 1] = 1 / l; n[k + 2] = -dz / l;
  }
  return n;
}

export function buildTerrain({ terrain, textures, quality = 'standard', search = globalThis.location?.search || '' }) {
  const t0 = performance.now(), flags = new URLSearchParams(search);
  const canopyEnabled = flags.get('canopy') !== '0', fortEnabled = flags.get('fort2') !== '0';
  terrain.fort2 = fortEnabled;
  const { x0, x1, z0, z1, step } = NEAR;
  const nx = Math.round((x1 - x0) / step) + 1, nz = Math.round((z1 - z0) / step) + 1;

  // 遠景の格子の高さ（近景の縁の縫合にも使う）
  const fs = FAR.step, fn = Math.round(FAR.half * 2 / fs) + 1;
  const fh = new Float32Array(fn * fn);
  for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) fh[j * fn + i] = terrain.heightAt(-FAR.half + i * fs, -FAR.half + j * fs);
  const farAt = (x, z) => {
    const u = (x + FAR.half) / fs, v = (z + FAR.half) / fs, i = Math.floor(u), j = Math.floor(v), a = u - i, b = v - j;
    const h = (ii, jj) => fh[jj * fn + ii];
    return (h(i, j) * (1 - a) + h(i + 1, j) * a) * (1 - b) + (h(i, j + 1) * (1 - a) + h(i + 1, j + 1) * a) * b;
  };

  // 近景：高さ・縫合・路面の重み
  const heights = new Float32Array(nx * nz);
  const band = 8;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * step, z = z0 + j * step, h = terrain.heightAt(x, z);
    const db = Math.min(x - x0, x1 - x, z - z0, z1 - z);
    heights[j * nx + i] = db < band ? h + (farAt(x, z) - h) * (1 - smooth(0, band, db)) : h;
  }
  const normals = gridNormals(heights, nx, nz, step);
  const pos = new Float32Array(nx * nz * 3), s0 = new Float32Array(nx * nz * 3), s1 = new Float32Array(nx * nz * 3), col = new Float32Array(nx * nz * 3);
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) {
    const k = j * nx + i, x = x0 + i * step, z = z0 + j * step;
    pos[k * 3] = x; pos[k * 3 + 1] = heights[k]; pos[k * 3 + 2] = z;
    const slope = Math.acos(Math.min(1, normals[k * 3 + 1])) * 180 / Math.PI;
    const s = terrain.surfaceAt(x, z, slope);
    s0[k * 3] = s.grass; s0[k * 3 + 1] = s.dirt; s0[k * 3 + 2] = s.rock; s1[k * 3] = s.gravel; s1[k * 3 + 1] = s.mud; s1[k * 3 + 2] = s.litter;
    // 窪みを少し暗く（焼き込みのつもりの簡易AO）
    let avg = 0, c = 0;
    for (const [di, dj] of [[-4, 0], [4, 0], [0, -4], [0, 4], [-3, -3], [3, 3], [-3, 3], [3, -3]]) {
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < nx && jj < nz) { avg += heights[jj * nx + ii]; c++; }
    }
    const cavity = c ? Math.max(0, Math.min(1, (avg / c - heights[k]) / 2.2)) : 0;
    const ao = 1 - 0.42 * cavity;
    // 森の下は樹冠の影で暗い緑（遠景と同じ規則。道・水の上は除く）
    const road = terrain.roadInfo(x, z), clear = (road ? 1 - road.w : 1) * (terrain.waterAt(x, z) > 0.05 ? 0 : 1);
    // 急な斜面で暗さを半分に戻すと、高い所から見渡したとき、木のあいだの地面が赤茶の壁に見えた（絵と並べた講評）。戻す量を 0.5 → 0.15 にする
    const ff = Math.min(1, terrain.forestDensity(x, z) * FOREST_FLOOR.gain) * (1 - smooth(34, 46, slope) * FOREST_FLOOR.steepRelief) * clear;
    col[k * 3] = ao * (1 - ff * 0.66); col[k * 3 + 1] = ao * (1 - ff * 0.5); col[k * 3 + 2] = ao * (1 - ff * 0.7);
    const boundary = canopyEnabled ? canopyBlendAt(WORLD, x, z) : 0;
    if (boundary > 0) {
      const trueSlope = terrain.slopeAt?.(x, z) ?? slope, surface = terrain.surfaceAt(x, z, trueSlope);
      const nf = Math.min(1, terrain.forestDensity(x, z) * FOREST_FLOOR.gain) * (1 - smooth(34, 46, trueSlope) * FOREST_FLOOR.steepRelief) * clear;
      const values = [surface.grass, surface.dirt, surface.rock, surface.gravel, surface.mud, surface.litter];
      for (let c = 0; c < 3; c++) {
        col[k * 3 + c] += ((1 - nf * [.66, .5, .7][c]) - col[k * 3 + c]) * boundary;
        s0[k * 3 + c] += (values[c] - s0[k * 3 + c]) * boundary;
        s1[k * 3 + c] += (values[c + 3] - s1[k * 3 + c]) * boundary;
      }
    }
  }
  const idx = new Uint32Array((nx - 1) * (nz - 1) * 6);
  let q = 0;
  for (let j = 0; j < nz - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const a = j * nx + i, b = a + 1, c2 = a + nx, d = c2 + 1;
    idx[q++] = a; idx[q++] = c2; idx[q++] = b; idx[q++] = b; idx[q++] = c2; idx[q++] = d;
  }
  const nearGeo = new THREE.BufferGeometry();
  nearGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  nearGeo.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  nearGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  nearGeo.setAttribute('aS0', new THREE.BufferAttribute(s0, 3));
  nearGeo.setAttribute('aS1', new THREE.BufferAttribute(s1, 3));
  nearGeo.setIndex(new THREE.BufferAttribute(idx, 1));
  nearGeo.computeBoundingSphere(); nearGeo.computeBoundingBox();

  // 遠景：近景の下は穴
  const fpos = new Float32Array(fn * fn * 3), fs0 = new Float32Array(fn * fn * 3), fs1 = new Float32Array(fn * fn * 3), fcol = new Float32Array(fn * fn * 3);
  const fnormals = gridNormals(fh, fn, fn, fs);
  for (let j = 0; j < fn; j++) for (let i = 0; i < fn; i++) {
    const k = j * fn + i, x = -FAR.half + i * fs, z = -FAR.half + j * fs;
    fpos[k * 3] = x; fpos[k * 3 + 1] = fh[k]; fpos[k * 3 + 2] = z;
    const slope = Math.acos(Math.min(1, fnormals[k * 3 + 1])) * 180 / Math.PI;
    const forest = terrain.forestDensity(x, z);
    const rock = smooth(47, 60, slope) * (1 - forest * 0.5), water = terrain.waterAt(x, z) > 0.05 ? 1 : 0;
    fs0[k * 3] = (1 - rock) * (1 - forest) * (1 - water); fs0[k * 3 + 2] = rock; fs1[k * 3] = water * 0.8; fs1[k * 3 + 2] = (1 - rock) * forest * (1 - water);
    // 木が立っていれば、急な斜面（岩の質感）でも暗くする。岩の重みで暗さを消すと、烏峰の急斜面で木のあいだに明るい地面の帯が残った（第3周の評価）
    const f = forest * (1 - water);
    const ff = Math.min(1, f * FOREST_FLOOR.farGain);
    // 遠景の森の地面は樹冠の面として暗く（元の地面色の1〜1.5割）。60m前後のむら（±25%）で尾根と谷筋に段を付ける
    const patch = 0.78 + 0.44 * fbm(x * 0.016, z * 0.016, terrain.seed + 77, 3);
    fcol[k * 3] = 1 - ff * (1 - 0.1 * patch); fcol[k * 3 + 1] = 1 - ff * (1 - 0.14 * patch); fcol[k * 3 + 2] = 1 - ff * (1 - 0.11 * patch);
    if (canopyEnabled) {
      // 継ぎ目の帯だけ路面と陰影をそろえる。外側の岩・川・草の元の重みは維持する。
      const distance = Math.max(x0 - x, x - x1, z0 - z, z - z1, 0);
      const edgeFix = 1 - smooth(CANOPY.seam, CANOPY.seam + CANOPY.blend, distance);
      if (edgeFix > 0) {
        const trueSlope = terrain.slopeAt?.(x, z) ?? slope, surface = terrain.surfaceAt(x, z, trueSlope);
        const values = [surface.grass, surface.dirt, surface.rock, surface.gravel, surface.mud, surface.litter];
        const clear = (1 - (terrain.roadInfo(x, z)?.w ?? 0)) * (1 - water);
        const nf = Math.min(1, forest * FOREST_FLOOR.gain) * (1 - smooth(34, 46, trueSlope) * FOREST_FLOOR.steepRelief) * clear;
        for (let c = 0; c < 3; c++) {
          fcol[k * 3 + c] += ((1 - nf * [.66, .5, .7][c]) - fcol[k * 3 + c]) * edgeFix;
          fs0[k * 3 + c] += (values[c] - fs0[k * 3 + c]) * edgeFix;
          fs1[k * 3 + c] += (values[c + 3] - fs1[k * 3 + c]) * edgeFix;
        }
      }
    }
  }
  const fidx = [];
  for (let j = 0; j < fn - 1; j++) for (let i = 0; i < fn - 1; i++) {
    const cx0 = -FAR.half + i * fs, cz0 = -FAR.half + j * fs;
    if (cx0 >= x0 && cx0 + fs <= x1 && cz0 >= z0 && cz0 + fs <= z1) continue;
    const a = j * fn + i, b = a + 1, c2 = a + fn, d = c2 + 1;
    fidx.push(a, c2, b, b, c2, d);
  }
  const farGeo = new THREE.BufferGeometry();
  farGeo.setAttribute('position', new THREE.BufferAttribute(fpos, 3));
  farGeo.setAttribute('normal', new THREE.BufferAttribute(fnormals, 3));
  farGeo.setAttribute('color', new THREE.BufferAttribute(fcol, 3));
  farGeo.setAttribute('aS0', new THREE.BufferAttribute(fs0, 3));
  farGeo.setAttribute('aS1', new THREE.BufferAttribute(fs1, 3));
  farGeo.setIndex(fidx);
  farGeo.computeBoundingSphere();

  const makeCover = (data, nx, nz) => {
    const texture = new THREE.DataTexture(data, nx, nz, THREE.RedFormat, THREE.UnsignedByteType);
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
    texture.generateMipmaps = false; texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  };
  const coverUniforms = {
    uCover: { value: makeCover(new Uint8Array(1), 1, 1) },
    uCoverOrigin: { value: new THREE.Vector2() }, uCoverSize: { value: new THREE.Vector2(1, 1) },
    uMeadow: { value: 0.85 }, uMeadowTint: { value: new THREE.Color('#6b6a35') },
  };
  let coverStats = { nx: 0, nz: 0, mean: 0, max: 0 };
  const setMeadowCover = ({ data, x0, z0, nx, nz }) => {
    const texture = makeCover(data, nx, nz);
    coverUniforms.uCover.value.dispose();
    coverUniforms.uCover.value = texture;
    // x0/z0 are cell EDGES: a centre maps to (i + .5)/size, not i/size.
    coverUniforms.uCoverOrigin.value.set(x0, z0);
    coverUniforms.uCoverSize.value.set(nx, nz);
    let sum = 0, max = 0;
    for (const value of data) { sum += value; max = Math.max(max, value); }
    coverStats = { nx, nz, mean: sum / data.length / 255, max: max / 255 };
  };
  const field = canopyMap(WORLD, terrain, fortEnabled), palette = canopyPalettes();
  const canopyUniforms = {
    uCanopyField: { value: field.texture }, uCanopy: { value: canopyEnabled ? 1 : 0 },
    uCanopyDebug: { value: flags.get('canopydebug') === '1' ? 1 : 0 }, uFortDebug: { value: flags.get('riverdebug') === '1' ? 1 : 0 }, uFortGround: { value: fortEnabled ? 1 : 0 },
    uCanopyDetail: { value: quality === 'light' ? 0 : 1 }, uCanopySun: { value: ATMOS.sunDir },
    uCedar: { value: palette.cedar }, uAutumn: { value: palette.autumn },
    uHillGrass: { value: new THREE.Color(CANOPY.grass) }, uHillGold: { value: new THREE.Color(CANOPY.grassGold) },
  };
  // 既存のQAのgame.terrainから読める。別の入口ファイルへの配線を増やさない。
  terrain.groundStats = () => ({ canopyAreaFraction: canopyEnabled ? field.area : 0, hillGrassArea: fortEnabled ? field.hillArea : 0,
    mapSamples: field.work, textureBytes: field.bytes, addedDraws: 0, addedTriangles: 0, programCount: 1 });
  const material = terrainMaterial(textures, quality, coverUniforms, canopyUniforms);
  material.addEventListener('dispose', () => field.texture.dispose());
  const paddy = paddyOptions(search);
  let paddyCoverage = 0;
  if (paddy.enabled) {
    const map = paddyGroundMap(WORLD, terrain, paddy.debug); paddyCoverage = map.coverage;
    const texture = new THREE.DataTexture(map.data, map.nx, map.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    texture.magFilter = texture.minFilter = THREE.NearestFilter; texture.generateMipmaps = false; texture.needsUpdate = true;
    const phaseTexture = new THREE.DataTexture(map.phaseData, map.nx, map.nz, THREE.RGBAFormat, THREE.UnsignedByteType);
    phaseTexture.magFilter = phaseTexture.minFilter = THREE.LinearFilter; phaseTexture.generateMipmaps = false; phaseTexture.needsUpdate = true;
    const before = material.onBeforeCompile;
    material.onBeforeCompile = shader => {
      before(shader);
      shader.uniforms.uPaddyGround = { value: texture };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>
 uniform sampler2D uPaddyGround;`)
        .replace('diffuseColor.rgb *= albedo;', `
          vec2 paddyUV = (vWorldPos.xz-vec2(${map.x0.toFixed(1)},${map.z0.toFixed(1)}))/vec2(${map.width.toFixed(1)},${map.depth.toFixed(1)});
          vec4 paddyGround = texture2D(uPaddyGround,paddyUV);
          if (any(lessThan(paddyUV,vec2(0.0))) || any(greaterThanEqual(paddyUV,vec2(1.0)))) paddyGround.a=0.0;
          albedo = mix(albedo,paddyGround.rgb,paddyGround.a);
          diffuseColor.rgb *= albedo;`);
      shader.uniforms.uPaddyPhase = { value: phaseTexture };
      patchPaddyGround(shader, paddy.debug);
      if (paddy.debug) shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'if(paddyGround.a > 0.5) outgoingLight = paddyGround.rgb;\n #include <opaque_fragment>');
    };
    material.customProgramCacheKey = () => 'valley-terrain-paddy';
    material.addEventListener('dispose', () => { texture.dispose(); phaseTexture.dispose(); });
  }
  material.addEventListener('dispose', () => coverUniforms.uCover.value.dispose());
  const near = new THREE.Mesh(nearGeo, material); near.name = 'terrain-near'; near.receiveShadow = true; near.castShadow = false;
  const far = new THREE.Mesh(farGeo, material); far.name = 'terrain-far'; far.receiveShadow = false;
  near.frustumCulled = true; far.frustumCulled = false;
  const detailBeforeRender = renderer => {
    const q = material.userData.uDetailU.value;
    const base = flags.has('w') ? 1 : Math.min(globalThis.devicePixelRatio || 1, q ? 1.5 : 1);
    canopyUniforms.uCanopyDetail.value = q && renderer.getPixelRatio() / base >= .78 ? 1 : 0;
  };
  near.onBeforeRender = far.onBeforeRender = detailBeforeRender;
  const group = new THREE.Group(); group.name = 'terrain'; group.add(far, near);
  // 品質の切り替え（軽量は細かい法線の凹凸を読まない）
  const setQuality = q => { const u = material.userData.uDetailU; if (u) u.value = q === 'light' ? 0 : 1; canopyUniforms.uCanopyDetail.value = q === 'light' ? 0 : 1; };
  return { group, near, far, material, setQuality, setMeadowCover, paddyCoverage: () => paddyCoverage, meadowCover: () => ({ ...coverStats }), buildMs: performance.now() - t0, stats: { nearVertices: nx * nz, farVertices: fn * fn } };
}
