import * as THREE from 'three';
import { loadTerrainMaterials, applyTerrainMaterial } from './terrain-materials.js';

// Original, deterministic scenery. The imported scene and collision data stay intact.
const WATER_MATERIALS = new Set([
  'Shallow channel water | STATIC PBR surface',
  'Flooded rice surface | STATIC',
  'Still shallow muddy puddles | STATIC',
]);
const HORIZON = '#bdc9c3';
const ZENITH = '#789eac';
const TAU = Math.PI * 2;
// Rectangles contain only branch islands in the Poly Haven atlas (image V is flipped).
const FIR_BRANCH_UVS = [
  [0.180, 0.686, 0.443, 0.970], [0.644, 0.622, 0.955, 0.970],
  [0.298, 0.225, 0.648, 0.600], [0.645, 0.171, 0.956, 0.558],
  [0.475, 0.604, 0.628, 0.756],
];
const clamp = THREE.MathUtils.clamp;
const smooth = THREE.MathUtils.smoothstep;

function randomSource(seed) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function geometryFrom(positions, colors, indices) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  if (indices) geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function terrainNoise(x, z) {
  const ix = Math.floor(x), iz = Math.floor(z);
  const fx = x - ix, fz = z - iz;
  const tx = fx * fx * (3 - 2 * fx), tz = fz * fz * (3 - 2 * fz);
  const hash = (a, b) => {
    const v = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
    return v - Math.floor(v);
  };
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(hash(ix, iz), hash(ix + 1, iz), tx),
    THREE.MathUtils.lerp(hash(ix, iz + 1), hash(ix + 1, iz + 1), tx), tz);
}

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      horizon: { value: new THREE.Color(HORIZON) },
      zenith: { value: new THREE.Color(ZENITH) },
      sunlight: { value: new THREE.Color('#ffe1ad') },
      sunDirection: { value: new THREE.Vector3(17, 23, 25).normalize() },
    },
    vertexShader: `varying vec3 vSky;
      void main() {
        vSky = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vSky;
      uniform vec3 horizon, zenith, sunlight, sunDirection;
      float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float noise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x),
          mix(hash(i + vec2(0., 1.)), hash(i + vec2(1.)), f.x), f.y);
      }
      void main() {
        vec3 d = normalize(vSky);
        float h = max(d.y, 0.0);
        vec3 color = mix(horizon, zenith, pow(h, 0.62));
        float sun = max(dot(d, sunDirection), 0.0);
        color += sunlight * (pow(sun, 22.0) * 0.19 + pow(sun, 550.0) * 0.15);
        vec2 p = d.xz / (0.32 + h) * 3.1;
        float cloud = noise(p) * 0.55 + noise(p * 2.13 + 8.7) * 0.28
          + noise(p * 4.71 - 3.1) * 0.17;
        float veil = smoothstep(0.51, 0.78, cloud) * smoothstep(0.03, 0.22, h)
          * (1.0 - smoothstep(0.65, 1.0, h)) * 0.32;
        color = mix(color, vec3(0.84, 0.86, 0.75), veil);
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
}

function reflectionSky() {
  const width = 128, height = 64, pixels = new Uint8Array(width * height * 4);
  const horizon = new THREE.Color(HORIZON), zenith = new THREE.Color(ZENITH);
  const earth = new THREE.Color('#364c32'), c = new THREE.Color();
  for (let y = 0; y < height; y++) {
    const elevation = -Math.cos(y / (height - 1) * Math.PI);
    c.copy(horizon).lerp(elevation >= 0 ? zenith : earth, Math.pow(Math.abs(elevation), 0.62));
    c.convertLinearToSRGB();
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      pixels[i] = c.r * 255; pixels[i + 1] = c.g * 255;
      pixels[i + 2] = c.b * 255; pixels[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(pixels, width, height);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function outsideHeight(x, z) {
  const dx = Math.max(-15 - x, x - 10, 0), dz = Math.max(-11 - z, z - 7, 0);
  const distance = Math.hypot(dx, dz);
  const undulation = Math.sin(x * 0.19 + z * 0.08) * 0.35 + Math.sin(z * 0.24 - x * 0.04) * 0.2;
  return 0.035 + undulation * smooth(distance, 0, 5)
    + smooth(distance, 8, 46) * (7 + 3 * Math.sin(x * 0.065 + z * 0.053));
}

function valleyFloor(textures) {
  const positions = [], colors = [], indices = [];
  const low = new THREE.Color('#303a29'), high = new THREE.Color('#49513a'), color = new THREE.Color();
  const xs = [...new Set([...Array.from({ length: 65 }, (_, i) => -65 + i * 2), -15, 10])].sort((a, b) => a - b);
  const zs = [...new Set([...Array.from({ length: 65 }, (_, i) => -64 + i * 2), -11, 7])].sort((a, b) => a - b);
  for (const z of zs) for (const x of xs) {
    positions.push(x, outsideHeight(x, z) - 0.06, z);
    color.copy(low).lerp(high, terrainNoise(x * 0.13, z * 0.13));
    colors.push(color.r, color.g, color.b);
  }
  // Shared vertices smooth only this new apron. The original ground and its hole are intact.
  for (let iz = 0; iz < zs.length - 1; iz++) for (let ix = 0; ix < xs.length - 1; ix++) {
    if (xs[ix] < 10 && xs[ix + 1] > -15 && zs[iz] < 7 && zs[iz + 1] > -11) continue;
    const a = iz * xs.length + ix, b = a + xs.length;
    indices.push(a, b + 1, a + 1, a, b, b + 1);
  }
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  applyTerrainMaterial(material, textures, { baked: false, forest: 0.32 });
  const mesh = new THREE.Mesh(geometryFrom(positions, colors, indices), material);
  mesh.name = 'Continuous forest floor beyond the original boundary';
  mesh.receiveShadow = true; mesh.userData.valleyGround = true;
  return mesh;
}

function ridge(inner, width, height, phase, baseColor) {
  const positions = [], colors = [], indices = [];
  const segments = inner < 70 ? 288 : 224, rows = inner < 70 ? 32 : 24;
  const base = new THREE.Color(baseColor), rock = new THREE.Color('#60685b'), color = new THREE.Color();
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * TAU;
      const angularX = Math.cos(a), angularZ = Math.sin(a);
      const crest = terrainNoise(angularX * 3.6 + phase * 11, angularZ * 3.6 + phase * 7);
      const profile = 0.63 + crest * 0.38;
      const radius = inner + width * t + (crest - 0.5) * 7;
      const x = -3 + angularX * radius, z = -2 + angularZ * radius;
      const valleys = terrainNoise(x * 0.074 + phase * 3, z * 0.074 - phase);
      const folds = terrainNoise(x * 0.19 + phase + valleys * 1.8, z * 0.19) - 0.5;
      const slope = Math.pow(Math.sin(Math.PI * t), 1.35);
      const y = -1.5 + height * (profile + (valleys - 0.5) * 0.34 + folds * 0.15) * slope;
      positions.push(x, y, z);
      const grove = terrainNoise(x * 0.15 + phase, z * 0.15);
      color.copy(base).multiplyScalar(0.77 + grove * 0.36);
      const exposed = smooth(grove, 0.68, 0.94) * smooth(t, 0.25, 0.65) * 0.23;
      color.lerp(rock, exposed);
      colors.push(color.r, color.g, color.b);
      if (row < rows && i < segments) {
        const v = row * (segments + 1) + i;
        indices.push(v, v + 1, v + segments + 2, v, v + segments + 2, v + segments + 1);
      }
    }
  }
  const mesh = new THREE.Mesh(geometryFrom(positions, colors, indices),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  mesh.name = `Wooded ridge ${inner}m`; mesh.userData.valleyGround = true;
  // Detail follows irregular patches of canopy, while geometric normals describe the folds.
  patch(mesh.material, 'irregular-groves-v18', shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vGrovePosition;').replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvGrovePosition = position;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vGrovePosition;
      float groveNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)), dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)),
          dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)), dot(i + vec2(1.0), vec2(127.1, 311.7)))) * 43758.5453);
        return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
      }`).replace('#include <color_fragment>', `#include <color_fragment>
        vec2 groveUV = vGrovePosition.xz;
        float groves = groveNoise(groveUV * 0.23);
        float crowns = groveNoise(groveUV * 0.81 + groves * 3.2);
        float fineCrowns = groveNoise(groveUV * 1.71 + crowns * 2.7);
        diffuseColor.rgb *= 0.62 + groves * 0.36 + crowns * 0.34 + fineCrowns * 0.14;
      `);
  });
  return mesh;
}

function leafTexture(cedar) {
  const size = 128, pixels = new Uint8Array(size * size * 4);
  function lineDistance(x, y, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const t = clamp(((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    return Math.hypot(x - ax - dx * t, y - ay - dy * t);
  }
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const u = x / (size - 1), v = y / (size - 1), i = (y * size + x) * 4;
    let inside;
    if (cedar) {
      inside = Math.abs(u - 0.5) < 0.011 && v > 0.04 && v < 0.98;
      for (let needle = 0; needle < 11; needle++) {
        const base = 0.10 + needle * 0.073, reach = (1 - base * 0.68) * 0.43;
        for (const side of [-1, 1]) {
          if (lineDistance(u, v, 0.5, base, 0.5 + side * reach, base + 0.15) < 0.015) inside = true;
        }
      }
    } else {
      const edge = Math.pow(Math.max(0, Math.sin(v * Math.PI)), 0.78) * 0.46
        * (0.97 + Math.sin(v * 75) * 0.03);
      inside = Math.abs(u - 0.5 - Math.sin(v * 3) * 0.025) < edge;
    }
    const grain = Math.sin(x * 13.37 + y * 27.11) * Math.sin(x * 3.9 - y * 7.1);
    const vein = Math.abs(u - 0.5) < 0.012 || (!cedar && Math.sin(v * 65 + Math.abs(u - 0.5) * 30) > 0.95);
    pixels[i] = 53 + v * 13 + grain * 7 + (vein ? 13 : 0);
    pixels[i + 1] = 76 + v * 13 + grain * 9 + (vein ? 12 : 0);
    pixels[i + 2] = 59 + v * 10 + grain * 6 + (vein ? 4 : 0);
    pixels[i + 3] = inside ? 255 : 0;
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace; texture.generateMipmaps = true;
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function treeGeometry(cedar, variant = 0, far = false) {
  const random = randomSource((cedar ? 217 : 512) + variant * 197 + (far ? 23 : 0));
  const leaves = [], leafColors = [], uvs = [], branches = [], branchIndices = [], branchColors = [];
  const q = new THREE.Quaternion(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const euler = new THREE.Euler(), v = new THREE.Vector3();
  function spray(center, width, length, heading) {
    euler.set((random() - 0.5) * 2.3, heading, (random() - 0.5) * 2.4);
    q.setFromEuler(euler);
    right.set(width, 0, 0).applyQuaternion(q); up.set(0, length, 0).applyQuaternion(q);
    const brightness = 0.74 + random() * 0.34;
    const uv = far ? FIR_BRANCH_UVS[Math.floor(random() * FIR_BRANCH_UVS.length)] : [0, 0, 1, 1];
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      v.copy(center).addScaledVector(right, x - 0.5).addScaledVector(up, y - 0.5);
      leaves.push(v.x, v.y, v.z); uvs.push(uv[0] + x * (uv[2] - uv[0]), uv[1] + y * (uv[3] - uv[1]));
      leafColors.push(brightness * 0.98, brightness, brightness * 0.95);
    }
  }
  function tube(path, radius) {
    const first = branches.length / 3, sides = far ? 4 : 5, tangent = new THREE.Vector3();
    const side = new THREE.Vector3(), vertical = new THREE.Vector3(), point = new THREE.Vector3();
    for (let row = 0; row < path.length; row++) {
      tangent.copy(path[Math.min(row + 1, path.length - 1)]).sub(path[Math.max(0, row - 1)]).normalize();
      side.crossVectors(tangent, new THREE.Vector3(0, 0, 1)).normalize();
      vertical.crossVectors(tangent, side).normalize();
      const r = radius * Math.pow(1 - row / path.length, 1.15);
      for (let i = 0; i <= sides; i++) {
        const angle = i / sides * TAU;
        point.copy(path[row]).addScaledVector(side, Math.cos(angle) * r).addScaledVector(vertical, Math.sin(angle) * r);
        branches.push(point.x, point.y, point.z);
        const grain = 0.055 + random() * 0.028;
        branchColors.push(grain, grain * 0.86, grain * 0.63);
        if (row < path.length - 1 && i < sides) {
          const n = first + row * (sides + 1) + i;
          branchIndices.push(n, n + 1, n + sides + 2, n, n + sides + 2, n + sides + 1);
        }
      }
    }
  }
  const trunk = Array.from({ length: far ? 5 : 8 }, (_, i) => {
    const t = i / (far ? 4 : 7);
    return new THREE.Vector3(Math.sin(t * 3.7 + variant) * 0.018, t * (cedar ? 1.02 : 0.78), Math.sin(t * 2.5) * 0.014);
  });
  tube(trunk, cedar ? 0.022 : 0.027);
  if (cedar) {
    const tiers = far ? 7 : 10;
    for (let tier = 0; tier < tiers; tier++) {
      const height = 0.22 + tier / tiers * 0.76, count = far ? 4 : 5;
      for (let b = 0; b < count; b++) {
        const angle = b / count * TAU + tier * 2.1 + random() * 0.45;
        const reach = Math.pow(1.08 - height, 0.72) * (0.31 + random() * 0.045);
        const path = [new THREE.Vector3(0, height, 0),
          new THREE.Vector3(Math.cos(angle) * reach * 0.6, height - 0.018, Math.sin(angle) * reach * 0.6),
          new THREE.Vector3(Math.cos(angle) * reach, height - 0.03, Math.sin(angle) * reach)];
        if (!far && tier % 2 === 0) tube(path, 0.0035 * (1.1 - height));
        for (let clump = 0; clump < (far ? 3 : 15); clump++) {
          const t = 0.36 + random() * 0.65;
          spray(new THREE.Vector3(Math.cos(angle) * reach * t, height + (random() - 0.5) * 0.075,
            Math.sin(angle) * reach * t), far ? 0.11 + random() * 0.055 : 0.045 + random() * 0.025,
            far ? 0.16 + random() * 0.06 : 0.07 + random() * 0.035, angle);
        }
      }
    }
  } else {
    const limbs = far ? 8 : 12;
    for (let limb = 0; limb < limbs; limb++) {
      const angle = limb * 2.399 + random() * 0.55;
      const reach = 0.17 + random() * 0.21, start = 0.29 + random() * 0.23;
      const tip = 0.61 + random() * 0.31;
      const end = new THREE.Vector3(Math.cos(angle) * reach, tip, Math.sin(angle) * reach);
      if (!far) tube([new THREE.Vector3(0, start, 0), new THREE.Vector3(end.x * 0.6, tip * 0.86, end.z * 0.6), end], 0.008);
      for (let twig = 0; twig < (far ? 2 : 4); twig++) {
        const center = end.clone().add(new THREE.Vector3((random() - 0.5) * 0.16,
          (random() - 0.5) * 0.15, (random() - 0.5) * 0.16));
        for (let clump = 0; clump < (far ? 5 : 14); clump++) {
          const point = center.clone().add(new THREE.Vector3((random() - 0.5) * 0.13,
            (random() - 0.5) * 0.12, (random() - 0.5) * 0.13));
          spray(point, far ? 0.11 + random() * 0.06 : 0.018 + random() * 0.020,
            far ? 0.15 + random() * 0.08 : 0.032 + random() * 0.022, angle + random() * 2);
        }
      }
    }
  }
  const foliage = geometryFrom(leaves, leafColors);
  foliage.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  return { foliage, wood: geometryFrom(branches, branchColors, branchIndices) };
}

function edgeGrass() {
  const random = randomSource(391), positions = [], colors = [];
  for (let clump = 0; clump < 1600; clump++) {
    let x, z;
    const edge = Math.floor(random() * 4), distance = 0.12 + Math.pow(random(), 1.9) * 6;
    if (edge < 2) { x = edge === 0 ? -15 - distance : 10 + distance; z = -12 + random() * 21; }
    else { x = -17 + random() * 30; z = edge === 2 ? -11 - distance : 7 + distance; }
    if (x > -15 && x < 10 && z > -11 && z < 7) continue;
    const ground = outsideHeight(x, z) - 0.045;
    for (let blade = 0; blade < 4; blade++) {
      const angle = random() * TAU, height = 0.08 + random() * 0.20;
      const width = 0.006 + random() * 0.009, bend = height * (0.2 + random() * 0.55);
      const dx = Math.cos(angle), dz = Math.sin(angle);
      const vertices = [[x - dz * width, ground, z + dx * width], [x + dz * width, ground, z - dx * width],
        [x + dx * bend * 0.35, ground + height * 0.6, z + dz * bend * 0.35],
        [x + dz * width, ground, z - dx * width], [x + dx * bend, ground + height, z + dz * bend],
        [x + dx * bend * 0.35, ground + height * 0.6, z + dz * bend * 0.35]];
      const light = 0.035 + random() * 0.026;
      vertices.forEach((p, i) => {
        positions.push(...p); const top = i === 2 || i === 4 || i === 5 ? 1.25 : 0.7;
        colors.push(light * 0.85 * top, light * top, light * 0.65 * top);
      });
    }
  }
  const mesh = new THREE.Mesh(geometryFrom(positions, colors),
    new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 1 }));
  mesh.name = 'Uneven meadow grass outside the original scene';
  return mesh;
}

function leafLitter(root) {
  const random = randomSource(1837), count = 720;
  const texture = leafTexture(false);
  const leaves = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ map: texture, color: '#c8a06a', roughness: 1,
      alphaTest: 0.33, alphaToCoverage: true, side: THREE.DoubleSide }), count);
  const stones = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0),
    new THREE.MeshStandardMaterial({ color: '#5f6254', roughness: 1 }), 160);
  leaves.name = 'Fallen leaves beyond the garden edge'; stones.name = 'Small boundary pebbles';
  const transform = new THREE.Object3D(), color = new THREE.Color();
  function edgePoint() {
    const edge = Math.floor(random() * 4), distance = 0.05 + Math.pow(random(), 2) * 3.1;
    return edge < 2 ? { x: edge ? 10 + distance : -15 - distance, z: -11 + random() * 18 }
      : { x: -15 + random() * 25, z: edge === 2 ? -11 - distance : 7 + distance };
  }
  for (let i = 0; i < count; i++) {
    const p = edgePoint();
    transform.position.set(p.x, outsideHeight(p.x, p.z) - 0.05, p.z);
    transform.rotation.set((random() - 0.5) * 0.18, random() * TAU, (random() - 0.5) * 0.18);
    const size = 0.04 + random() * 0.04;
    transform.scale.set(size, 1, size * (1.4 + random() * 0.6)); transform.updateMatrix();
    leaves.setMatrixAt(i, transform.matrix);
    color.setRGB(0.65 + random() * 0.34, 0.67 + random() * 0.23, 0.58 + random() * 0.24);
    leaves.setColorAt(i, color);
    if (i < stones.count) {
      const h = 0.010 + random() * 0.018;
      transform.position.y = outsideHeight(p.x, p.z) - 0.06 + h * 0.7;
      transform.scale.set(h * (1.4 + random()), h, h * (1.1 + random())); transform.updateMatrix();
      stones.setMatrixAt(i, transform.matrix);
    }
  }
  leaves.computeBoundingSphere(); stones.computeBoundingSphere(); root.add(leaves, stones);
}

function woodland(root, textures) {
  const random = randomSource(15589), groups = [], points = [];
  const transform = new THREE.Object3D(), color = new THREE.Color();
  root.updateMatrixWorld(true);
  const terrain = root.children.filter(o => o.userData.valleyGround);
  terrain.forEach(mesh => mesh.geometry.computeBoundingBox());
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function backgroundHeight(x, z) {
    ray.ray.origin.set(x, 150, z);
    return ray.intersectObjects(terrain, false)[0]?.point.y ?? outsideHeight(x, z) - 0.06;
  }
  // Cluster centres and separate random draws keep groups irregular without a planting grid.
  for (let cluster = 0; cluster < 48; cluster++) {
    const near = cluster < 18, angle = cluster * 2.399 + (random() - 0.5) * 0.6;
    const distance = near ? 25 + random() * 24 : 57 + random() * 46;
    const cx = -3 + Math.cos(angle) * distance, cz = -2 + Math.sin(angle) * distance;
    const count = near ? 8 + Math.floor(random() * 5) : 8 + Math.floor(random() * 6);
    const cedar = random() < 0.48;
    for (let tree = 0; tree < count; tree++) {
      const a = random() * TAU, offset = Math.sqrt(random()) * (near ? 5.4 : 7.7);
      const x = cx + Math.cos(a) * offset, z = cz + Math.sin(a) * offset;
      if (x > -19 && x < 14 && z > -15 && z < 11) continue;
      points.push({ x, z, y: backgroundHeight(x, z) - 0.09,
        height: (near ? 4.8 : 5.5) + random() * (near ? 4.4 : 4.0),
        yaw: random() * TAU, cedar: tree % 6 === 0 ? !cedar : cedar,
        variant: Math.floor(random() * 2), far: !near, shrub: false });
    }
  }
  // Low planting softens the original terrain boundary, without entering the walkable garden.
  for (let i = 0; i < 64; i++) {
    const edge = Math.floor(random() * 4), offset = 0.4 + Math.pow(random(), 1.5) * 5.2;
    const x = edge < 2 ? (edge ? 10 + offset : -15 - offset) : -16 + random() * 28;
    const z = edge < 2 ? -13 + random() * 23 : edge === 2 ? -11 - offset : 7 + offset;
    if (x > -15 && x < 10 && z > -11 && z < 7) continue;
    points.push({ x, z, y: backgroundHeight(x, z) - 0.08, height: 0.6 + random() * 1.25,
      yaw: random() * TAU, cedar: false, variant: i % 2, far: false, shrub: true });
  }
  const leafImages = { cedar: leafTexture(true), leaf: leafTexture(false) };
  for (const cedar of [true, false]) for (const far of [false, true]) for (const variant of [0, 1]) {
    const trees = points.filter(p => p.cedar === cedar && p.far === far && p.variant === variant);
    if (!trees.length) continue;
    trees.sort((a, b) => Math.hypot(a.x + 3, a.z + 2) - Math.hypot(b.x + 3, b.z + 2));
    const geometry = treeGeometry(cedar, variant, far);
    const foliageMaterial = new THREE.MeshStandardMaterial({ map: far ? textures.firColor : (cedar ? leafImages.cedar : leafImages.leaf),
      alphaMap: far ? textures.firAlpha : null,
      vertexColors: true, roughness: 0.91, alphaTest: 0.28, alphaToCoverage: true, side: THREE.DoubleSide });
    const barkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const crown = new THREE.InstancedMesh(geometry.foliage, foliageMaterial, trees.length);
    const trunks = new THREE.InstancedMesh(geometry.wood, barkMaterial, trees.length);
    crown.name = `${far ? 'Middle and distant' : 'Near'} ${cedar ? 'cedar' : 'broadleaf'} groves ${variant}`;
    trunks.name = crown.name + ' rooted trunks';
    crown.receiveShadow = trunks.receiveShadow = true;
    trees.forEach((p, i) => {
      transform.position.set(p.x, p.y, p.z);
      transform.rotation.set((random() - 0.5) * 0.035, p.yaw, (random() - 0.5) * 0.04);
      const width = p.height * (p.shrub ? 1.45 : 0.9 + random() * 0.19);
      transform.scale.set(width, p.height, width); transform.updateMatrix();
      crown.setMatrixAt(i, transform.matrix); trunks.setMatrixAt(i, transform.matrix);
      color.setRGB(0.84 + random() * 0.17, 0.86 + random() * 0.13, 0.80 + random() * 0.17);
      crown.setColorAt(i, color);
    });
    crown.computeBoundingSphere(); trunks.computeBoundingSphere();
    root.add(crown, trunks); groups.push({ crown, trunks, total: trees.length });
  }
  root.add(edgeGrass()); leafLitter(root);
  return groups;
}

function patch(material, key, compile) {
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey.bind(material);
  material.onBeforeCompile = function(shader, renderer) {
    previousCompile.call(this, shader, renderer); compile(shader);
  };
  const baseKey = previousKey();
  material.customProgramCacheKey = () => baseKey + '|kamakura-' + key;
  material.needsUpdate = true;
}

// r180 begin_vertex runs before instanceMatrix in both project_vertex and shadow depth.
// A shared displacement therefore preserves instance placement and its shadow silhouette.
const WIND_DECLARATIONS = `
  uniform float uValleyTime, uValleyMotion;
  attribute float valleyBend;
  vec3 valleyWind(vec3 p) {
    vec4 w = vec4(p, 1.0);
    #ifdef USE_INSTANCING
      w = instanceMatrix * w;
    #endif
    w = modelMatrix * w;
    float gust = sin(w.x * 0.71 + w.z * 0.43 + uValleyTime * 1.35) * 0.62
      + sin(w.x * 1.63 - w.z * 0.36 + uValleyTime * 2.1) * 0.24
      + sin(w.x * 0.18 + w.z * 0.32 + uValleyTime * 0.68) * 0.14;
    vec3 wind = vec3(0.070, 0.0, 0.032) * gust * valleyBend * uValleyMotion;
    mat3 basis = mat3(modelMatrix);
    #ifdef USE_INSTANCING
      basis = basis * mat3(instanceMatrix);
    #endif
    // Rotation and nonuniform scale are inverted without moving the root.
    return p + vec3(dot(wind, basis[0]) / max(dot(basis[0], basis[0]), 0.0001),
      dot(wind, basis[1]) / max(dot(basis[1], basis[1]), 0.0001),
      dot(wind, basis[2]) / max(dot(basis[2], basis[2]), 0.0001));
  }`;

function patchWind(material, uniforms, depth = false) {
  patch(material, depth ? 'wind-depth-v1' : 'wind-v1', shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\n' + WIND_DECLARATIONS).replace('#include <begin_vertex>',
      '#include <begin_vertex>\ntransformed = valleyWind(transformed);');
  });
}

function bankBend(geometries, position) {
  // Each disconnected 3D blade is rooted independently, including blades beyond
  // the walkable height grid. Welding split normal vertices keeps their roots fixed.
  const parent = Int32Array.from({ length: position.count }, (_, i) => i), weld = new Map();
  function find(i) { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; }
  const union = (a, b) => { parent[find(a)] = find(b); };
  for (let i = 0; i < position.count; i++) {
    const key = `${Math.round(position.getX(i) * 1e5)},${Math.round(position.getY(i) * 1e5)},${Math.round(position.getZ(i) * 1e5)}`;
    if (weld.has(key)) union(i, weld.get(key)); else weld.set(key, i);
  }
  for (const geometry of geometries) {
    const index = geometry.getIndex();
    for (let i = 0, count = index ? index.count : position.count; i < count; i += 3) {
      const a = index ? index.getX(i) : i, b = index ? index.getX(i + 1) : i + 1;
      const c = index ? index.getX(i + 2) : i + 2;
      union(a, b); union(a, c);
    }
  }
  const low = new Float32Array(position.count).fill(Infinity), high = new Float32Array(position.count).fill(-Infinity);
  for (let i = 0; i < position.count; i++) {
    const r = find(i), y = position.getY(i); low[r] = Math.min(low[r], y); high[r] = Math.max(high[r], y);
  }
  const values = new Float32Array(position.count);
  for (let i = 0; i < position.count; i++) {
    const r = find(i), height = high[r] - low[r];
    values[i] = height > 0.015 ? Math.pow(clamp((position.getY(i) - low[r]) / height, 0, 1), 2) * 0.40 : 0;
  }
  return new THREE.BufferAttribute(values, 1);
}

function animatePlants(scene, uniforms) {
  const meshes = [], materials = new Set(), byPosition = new Map();
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (!mats.some(m => /^(Rice leaf|Rice basal leaf sheath|Bank blade)/.test(m.name))) return;
    const position = mesh.geometry.getAttribute('position');
    const bank = mats.some(m => /^Bank blade/.test(m.name));
    if (!byPosition.has(position)) byPosition.set(position, { bank, geometries: new Set() });
    byPosition.get(position).geometries.add(mesh.geometry);
    mats.forEach(m => materials.add(m)); meshes.push(mesh);
  });
  for (const [position, { bank, geometries }] of byPosition) {
    const bend = bank ? bankBend(geometries, position) : new THREE.BufferAttribute(
      Float32Array.from({ length: position.count }, (_, i) =>
        Math.pow(clamp((position.getY(i) - 0.025) / 0.50, 0, 1), 2)), 1);
    for (const geometry of geometries) geometry.setAttribute('valleyBend', bend);
  }
  materials.forEach(m => patchWind(m, uniforms));
  const depth = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide });
  patchWind(depth, uniforms, true);
  for (const mesh of meshes) {
    mesh.customDepthMaterial = depth;
    // Two leaf layers give small rice shadows without re-rendering every blade layer.
    const name = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material).name;
    mesh.userData.valleyShadow = /^Bank blade/.test(name) || /^Rice leaf [03] /.test(name);
  }
  return meshes;
}

function animateWater(material, uniforms) {
  const puddle = /puddle/i.test(material.name), paddy = /Flooded rice/.test(material.name);
  material.transparent = true; material.opacity = puddle ? 0.94 : paddy ? 0.78 : 0.86;
  material.depthWrite = false; material.side = THREE.FrontSide;
  material.roughness = puddle ? 0.44 : paddy ? 0.34 : 0.27;
  material.metalness = 0;
  material.color.set(puddle ? '#3a4031' : paddy ? '#52634a' : '#3d554b');
  material.envMapIntensity = puddle ? 0.46 : paddy ? 0.72 : 0.86;
  const flow = puddle ? 0 : paddy ? 0.008 : 0.035;
  const amplitude = puddle ? 0.012 : paddy ? 0.027 : 0.060;
  patch(material, 'irregular-flow-v18', shader => {
    Object.assign(shader.uniforms, uniforms, { uWaterFlow: { value: flow }, uWaterAmplitude: { value: amplitude } });
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec2 vValleyWater;').replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvValleyWater = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec2 vValleyWater;
      uniform float uValleyTime, uValleyMotion, uWaterFlow, uWaterAmplitude;
      float waterNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        float a = fract(sin(dot(i, vec2(127.1, 311.7))) * 43758.5453);
        float b = fract(sin(dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7))) * 43758.5453);
        float c = fract(sin(dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7))) * 43758.5453);
        float d = fract(sin(dot(i + vec2(1.0), vec2(127.1, 311.7))) * 43758.5453);
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
      }
      float waterHeight(vec2 p) {
        return waterNoise(p * 2.1) * 0.68 + waterNoise(p * 5.3 + 13.7) * 0.32;
      }`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        float waterTime = uValleyTime * uValleyMotion * uWaterFlow;
        vec2 p = vValleyWater + vec2(waterTime * 0.31, -waterTime);
        vec2 ripple = vec2(waterHeight(p + vec2(0.07, 0.0)) - waterHeight(p - vec2(0.07, 0.0)),
          waterHeight(p + vec2(0.0, 0.07)) - waterHeight(p - vec2(0.0, 0.07)));
        float waterDetail = 1.0 - smoothstep(0.035, 0.26, length(fwidth(p)));
        normal = normalize(normal + mat3(viewMatrix) * vec3(ripple.x, 0.0, ripple.y)
          * uWaterAmplitude * waterDetail);
      `);
  });
}

export async function createEnvironment({ scene, renderer, model, sun, groundAt }) {
  const terrainTextures = await loadTerrainMaterials(renderer);
  const root = new THREE.Group(); root.name = 'Hidden valley atmosphere';
  const motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let quality = 'standard';
  const uniforms = { uValleyTime: { value: 0 }, uValleyMotion: { value: 1 } };
  const waterMaterials = new Set(), groundMaterials = new Set();
  scene.fog = new THREE.Fog(HORIZON, 24, 170);
  scene.background = new THREE.Color(HORIZON);
  scene.environment = reflectionSky(); scene.environmentIntensity = 0.48;
  renderer.toneMappingExposure = 1.04;
  scene.traverse(o => {
    if (o.isHemisphereLight) {
      o.color.set('#c4d8d9'); o.groundColor.set('#746749'); o.intensity = 1.45;
    }
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const material of mats) {
      if (WATER_MATERIALS.has(material.name)) waterMaterials.add(material);
      if (/^Walkthrough baked terrain_[01]$/.test(material.name)) groundMaterials.add(material);
      if (material.name === 'Water-darkened timber endgrain') {
        material.transparent = false; material.opacity = 1; material.depthWrite = true;
        material.roughness = 0.55; material.metalness = 0;
      }
    }
    if (!o.isInstancedMesh) {
      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const size = o.geometry.boundingBox.getSize(new THREE.Vector3());
      if (Math.max(size.x, size.y, size.z) < 0.12) o.castShadow = false;
    }
  });
  groundMaterials.forEach(material => applyTerrainMaterial(material, terrainTextures));
  sun.color.set('#ffe9cb'); sun.intensity = 3.2;
  sun.position.set(12, 23, 23); sun.target.position.set(-5, 0, -2);
  sun.shadow.normalBias = 0.025; sun.shadow.bias = -0.00015;
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 0.5, far: 75 });
  sun.shadow.camera.updateProjectionMatrix();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 20), skyMaterial());
  sky.name = 'Painted morning sky'; sky.renderOrder = -10; sky.frustumCulled = false;
  root.add(sky, valleyFloor(terrainTextures), ridge(106, 89, 80, 0.8, '#748c82'),
    ridge(66, 68, 48, 2.7, '#4d685d'), ridge(35, 55, 31, 4.3, '#33493e'));
  const trees = woodland(root, terrainTextures);
  // Rooted wind is applied after app's instancing, so scene-direct batches participate.
  const plants = animatePlants(scene, uniforms);
  waterMaterials.forEach(material => animateWater(material, uniforms));
  const random = randomSource(827), dust = new Float32Array(54 * 3);
  for (let i = 0; i < dust.length; i += 3) {
    dust[i] = -12 + random() * 12; dust[i + 2] = -7 + random() * 13;
    const ground = typeof groundAt === 'function' ? groundAt(dust[i], dust[i + 2]) : 0;
    dust[i + 1] = (Number.isFinite(ground) ? ground : 0.1) + 0.6 + random() * 3.7;
  }
  const particles = new THREE.Points(new THREE.BufferGeometry().setAttribute('position',
    new THREE.BufferAttribute(dust, 3)), new THREE.PointsMaterial({ color: '#efd6a0', size: 0.021,
    transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending }));
  particles.name = 'Sparse sunlit pollen'; root.add(particles); scene.add(root);
  function setQuality(value) {
    quality = value === 'light' ? 'light' : 'standard';
    const standard = quality === 'standard', reduce = motionPreference?.matches === true;
    uniforms.uValleyMotion.value = reduce ? 0 : standard ? 1 : 0.22;
    particles.visible = standard && !reduce;
    sun.castShadow = standard;
    for (const plant of plants) plant.castShadow = standard && plant.userData.valleyShadow;
    for (const { crown, trunks, total } of trees) {
      crown.count = trunks.count = standard ? total : Math.ceil(total * 0.58);
    }
  }
  motionPreference?.addEventListener?.('change', () => setQuality(quality));
  setQuality(quality);
  return {
    get metrics() {
      let triangles = 0, draws = 0;
      root.traverse(object => {
        if (!object.isMesh) return;
        draws++;
        triangles += (object.geometry.index?.count ?? object.geometry.getAttribute('position').count)
          / 3 * (object.isInstancedMesh ? object.count : 1);
      });
      return { triangles, draws, trees: trees.reduce((sum, group) => sum + group.crown.count, 0),
        terrainMaterials: groundMaterials.size, terrainTextures: 6, foliageTextures: 2, waterConnections: 0 };
    },
    update(dt, elapsed) {
      if (!(dt >= 0) || !Number.isFinite(elapsed)) return;
      if (!motionPreference?.matches) {
        uniforms.uValleyTime.value = elapsed;
        particles.rotation.y = Math.sin(elapsed * 0.028) * 0.035;
        particles.position.y = Math.sin(elapsed * 0.19) * 0.045;
      }
    },
    setQuality,
  };
}
