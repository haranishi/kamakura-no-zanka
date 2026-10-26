// terrain.js — 地形メッシュ（近景1m・遠景8m）と、6層の質感を重ねる材質（view層）。
// 高さ・路面の重みは terrain-height.js（純関数）から取る。近景と遠景は縁で縫合して、継ぎ目に割れを出さない。
import * as THREE from 'three';
import { smooth, fbm } from './terrain-height.js';

const LAYERS = ['grass', 'dirt', 'rock', 'gravel', 'mud', 'litter'];
// 1回繰り返しあたりのメートル数
const TILE = { grass: 2.8, dirt: 2.4, rock: 4.2, gravel: 2.0, mud: 2.6, litter: 3.0 };
const NEAR = { x0: -152, x1: 192, z0: -152, z1: 136, step: 1 };
const FAR = { half: 640, step: 8 };
const SIZE = 1024;

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

function terrainMaterial(textures, quality) {
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
  const tiles = LAYERS.map(l => TILE[l]);
  material.onBeforeCompile = shader => {
    shader.uniforms.uTexC = { value: textures.color };
    shader.uniforms.uTexN = { value: textures.normal };
    shader.uniforms.uTile = { value: tiles };
    shader.uniforms.uDetail = material.userData.uDetailU = { value: quality === 'light' ? 0 : 1 };
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
        albedo *= 0.82 + macro * 0.36;
        albedo = mix(albedo, albedo * vec3(0.92, 1.05, 0.85), clamp(w[0] * 1.2, 0.0, 1.0));
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
  material.customProgramCacheKey = () => 'valley-terrain-v2';     // 品質は uniform（uDetail）で切り替えるので、プログラムは1つ
  return material;
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

export function buildTerrain({ terrain, textures, quality = 'standard' }) {
  const t0 = performance.now();
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
    const ff = Math.min(1, terrain.forestDensity(x, z) * 1.5) * (1 - smooth(34, 46, slope) * 0.5) * clear;
    col[k * 3] = ao * (1 - ff * 0.66); col[k * 3 + 1] = ao * (1 - ff * 0.5); col[k * 3 + 2] = ao * (1 - ff * 0.7);
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
    const f = forest * (1 - rock) * (1 - water);
    const ff = Math.min(1, f * 1.5);
    // 遠景の森の地面は樹冠の面として暗く（元の地面色の1〜1.5割）。60m前後のむら（±25%）で尾根と谷筋に段を付ける
    const patch = 0.78 + 0.44 * fbm(x * 0.016, z * 0.016, terrain.seed + 77, 3);
    fcol[k * 3] = 1 - ff * (1 - 0.1 * patch); fcol[k * 3 + 1] = 1 - ff * (1 - 0.14 * patch); fcol[k * 3 + 2] = 1 - ff * (1 - 0.11 * patch);
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

  const material = terrainMaterial(textures, quality);
  const near = new THREE.Mesh(nearGeo, material); near.name = 'terrain-near'; near.receiveShadow = true; near.castShadow = false;
  const far = new THREE.Mesh(farGeo, material); far.name = 'terrain-far'; far.receiveShadow = false;
  near.frustumCulled = true; far.frustumCulled = false;
  const group = new THREE.Group(); group.name = 'terrain'; group.add(far, near);
  // 品質の切り替え（軽量は細かい法線の凹凸を読まない）
  const setQuality = q => { const u = material.userData.uDetailU; if (u) u.value = q === 'light' ? 0 : 1; };
  return { group, near, far, material, setQuality, buildMs: performance.now() - t0, stats: { nearVertices: nx * nz, farVertices: fn * fn } };
}
