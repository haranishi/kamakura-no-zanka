import * as THREE from 'three';

// Original, deterministic scenery. The imported scene and collision data stay intact.
const WATER_MATERIALS = new Set([
  'Shallow channel water | STATIC PBR surface',
  'Flooded rice surface | STATIC',
  'Still shallow muddy puddles | STATIC',
]);
const HORIZON = '#bdcbbb';
const ZENITH = '#789eac';
const TAU = Math.PI * 2;
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

function valleyFloor() {
  const positions = [], colors = [], indices = [];
  const low = new THREE.Color('#262b22'), high = new THREE.Color('#414c38'), color = new THREE.Color();
  const soil = new THREE.Color('#29271d');
  const xs = [...new Set([...Array.from({ length: 65 }, (_, i) => -65 + i * 2), -15, 10])].sort((a, b) => a - b);
  const zs = [...new Set([...Array.from({ length: 65 }, (_, i) => -64 + i * 2), -11, 7])].sort((a, b) => a - b);
  for (let iz = 0; iz < zs.length - 1; iz++) for (let ix = 0; ix < xs.length - 1; ix++) {
    const x = xs[ix], z = zs[iz], nextX = xs[ix + 1], nextZ = zs[iz + 1];
    // The original scene occupies this hole; no new surface covers its paths or water.
    if (x < 10 && nextX > -15 && z < 7 && nextZ > -11) continue;
    const first = positions.length / 3;
    for (const [px, pz] of [[x, z], [nextX, z], [nextX, nextZ], [x, nextZ]]) {
      const y = outsideHeight(px, pz);
      positions.push(px, y - 0.06, pz);
      const mottling = 0.44 + Math.sin(px * 0.49 + pz * 0.13) * 0.12 + Math.sin(pz * 0.72) * 0.08;
      color.copy(low).lerp(high, mottling);
      const distance = Math.hypot(Math.max(-15 - px, px - 10, 0), Math.max(-11 - pz, pz - 7, 0));
      color.lerp(soil, 1 - smooth(distance, 0, 7));
      colors.push(color.r, color.g, color.b);
    }
    indices.push(first, first + 2, first + 1, first, first + 3, first + 2);
  }
  const mesh = new THREE.Mesh(geometryFrom(positions, colors, indices),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 }));
  mesh.name = 'Background meadow beyond the original boundary';
  mesh.receiveShadow = true;
  mesh.userData.valleyGround = true;
  patch(mesh.material, 'soil-grain-v1', shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec2 vValleySoil;').replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvValleySoil = position.xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec2 vValleySoil;').replace('#include <color_fragment>', `
      #include <color_fragment>
      float soilGrain = fract(sin(dot(floor(vValleySoil * 48.0), vec2(127.1, 311.7))) * 43758.5453);
      float soilDetail = 1.0 - smoothstep(0.01, 0.06, length(fwidth(vValleySoil)));
      diffuseColor.rgb *= mix(1.0, 0.88 + soilGrain * 0.24, soilDetail);
    `);
  });
  return mesh;
}

function ridge(inner, width, height, phase, baseColor) {
  const positions = [], colors = [], indices = [];
  const segments = inner < 70 ? 384 : 256, rows = inner < 70 ? 36 : 24;
  const base = new THREE.Color(baseColor), haze = new THREE.Color(HORIZON), color = new THREE.Color();
  for (let row = 0; row <= rows; row++) {
    const t = row / rows;
    for (let i = 0; i <= segments; i++) {
      const a = i / segments * TAU;
      const profile = 0.70 + Math.sin(a * 3 + phase) * 0.16
        + Math.sin(a * 7 - phase * 0.7) * 0.10 + Math.cos(a * 11 + phase) * 0.045;
      const radius = inner + width * t + Math.sin(a * 5 + phase) * 3.4;
      const slope = Math.pow(Math.sin(Math.PI * t), 1.4);
      const ribs = Math.sin(a * 31 + t * 4 + phase) * Math.sin(a * 13 - t * 8) * 0.035;
      const x = -3 + Math.cos(a) * radius, z = -2 + Math.sin(a) * radius;
      const relief = (terrainNoise(x * 0.11 + phase, z * 0.11) - 0.5) * 0.16
        + (terrainNoise(x * 0.32, z * 0.32 + phase) - 0.5) * 0.055
        + (terrainNoise(x * 0.81, z * 0.81) - 0.5) * 0.015;
      const y = -1.5 + height * (profile + ribs + relief) * slope;
      positions.push(x, y, z);
      const moss = terrainNoise(x * 0.25 + phase, z * 0.25);
      color.copy(base).multiplyScalar(0.77 + moss * 0.43).lerp(haze, Math.max(0, t - 0.55) * 0.15);
      colors.push(color.r, color.g, color.b);
      if (row < rows && i < segments) {
        const v = row * (segments + 1) + i;
        indices.push(v, v + 1, v + segments + 2, v, v + segments + 2, v + segments + 1);
      }
    }
  }
  const mesh = new THREE.Mesh(geometryFrom(positions, colors, indices),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
  mesh.name = `Forested ridge ${inner}m`;
  mesh.userData.valleyGround = true;
  patch(mesh.material, 'weathered-forest-slope-v1', shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vValleyTerrain;').replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvValleyTerrain = (modelMatrix * vec4(position, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      varying vec3 vValleyTerrain;
      float valleyHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float valleyNoise(vec2 p) {
        vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
        return mix(mix(valleyHash(i), valleyHash(i + vec2(1., 0.)), f.x),
          mix(valleyHash(i + vec2(0., 1.)), valleyHash(i + vec2(1.)), f.x), f.y);
      }`).replace('#include <color_fragment>', `#include <color_fragment>
      vec2 terrainUV = vValleyTerrain.xz;
      float groves = valleyNoise(terrainUV * 0.31);
      float smallCanopy = valleyNoise(terrainUV * 1.45 + groves * 4.0);
      float lichen = valleyNoise(terrainUV * 4.8);
      float rock = smoothstep(0.69, 0.88, valleyNoise(terrainUV * 0.18 + 17.0));
      diffuseColor.rgb *= 0.72 + groves * 0.43 + smallCanopy * 0.18;
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.105, 0.119, 0.091)
        * (0.84 + lichen * 0.24), rock * 0.24);
    `).replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
      vec2 terrainN = vValleyTerrain.xz;
      float fineNormal = 1.0 - smoothstep(0.18, 0.65, length(fwidth(terrainN)));
      vec3 forestNormal = vec3(cos(terrainN.x * 3.7 + terrainN.y * 0.8), 0.0,
        sin(terrainN.y * 4.9 - terrainN.x * 0.3)) * 0.075 * fineNormal;
      normal = normalize(normal + mat3(viewMatrix) * forestNormal);
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

function treeGeometry(cedar) {
  const random = randomSource(cedar ? 217 : 512);
  const leaves = [], leafColors = [], uvs = [], branches = [], branchIndices = [], branchColors = [];
  const q = new THREE.Quaternion(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const euler = new THREE.Euler(), v = new THREE.Vector3();
  function leaf(center, width, length, heading = null) {
    euler.set((random() - 0.5) * 2.9, heading ?? random() * TAU, random() * TAU);
    q.setFromEuler(euler);
    right.set(width, 0, 0).applyQuaternion(q); up.set(0, length, 0).applyQuaternion(q);
    const brightness = 0.80 + random() * 0.27;
    for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 0], [1, 1], [0, 1]]) {
      v.copy(center).addScaledVector(right, x - 0.5).addScaledVector(up, y - 0.5);
      leaves.push(v.x, v.y, v.z); uvs.push(x, y);
      leafColors.push(brightness * 0.98, brightness, brightness * 0.96);
    }
  }
  function tube(path, radius) {
    const first = branches.length / 3, sides = 6, tangent = new THREE.Vector3();
    const side = new THREE.Vector3(), vertical = new THREE.Vector3(), point = new THREE.Vector3();
    for (let row = 0; row < path.length; row++) {
      tangent.copy(path[Math.min(row + 1, path.length - 1)]).sub(path[Math.max(0, row - 1)]).normalize();
      side.crossVectors(tangent, new THREE.Vector3(0, 0, 1)).normalize();
      vertical.crossVectors(tangent, side).normalize();
      const r = radius * Math.pow(1 - row / path.length, 1.3);
      for (let i = 0; i <= sides; i++) {
        const angle = i / sides * TAU;
        point.copy(path[row]).addScaledVector(side, Math.cos(angle) * r).addScaledVector(vertical, Math.sin(angle) * r);
        branches.push(point.x, point.y, point.z);
        const light = 0.10 + 0.035 * Math.sin(i * 3 + row);
        branchColors.push(light, light * 0.88, light * 0.67);
        if (row < path.length - 1 && i < sides) {
          const n = first + row * (sides + 1) + i;
          branchIndices.push(n, n + 1, n + sides + 2, n, n + sides + 2, n + sides + 1);
        }
      }
    }
  }
  const trunk = Array.from({ length: 9 }, (_, i) => {
    const t = i / 8;
    return new THREE.Vector3(Math.sin(t * 3.7) * 0.015, t * (cedar ? 1.02 : 0.72), Math.sin(t * 2.5) * 0.009);
  });
  tube(trunk, cedar ? 0.018 : 0.023);
  if (cedar) {
    for (let tier = 0; tier < 15; tier++) {
      const height = 0.23 + tier / 15 * 0.77;
      const count = 4 + Math.floor(random() * 3);
      for (let b = 0; b < count; b++) {
        const angle = b / count * TAU + tier * 1.77 + random() * 0.4;
        const reach = Math.pow(1.06 - height, 0.65) * (0.20 + random() * 0.04);
        const path = Array.from({ length: 5 }, (_, step) => {
          const t = step / 4;
          return new THREE.Vector3(Math.cos(angle) * reach * t, height - Math.sin(t * 1.8) * 0.025,
            Math.sin(angle) * reach * t);
        });
        tube(path, 0.0035 * (1.1 - height));
        for (let spray = 0; spray < 25; spray++) {
          const t = 0.15 + random() * 0.9;
          const center = new THREE.Vector3(Math.cos(angle) * reach * t, height - t * 0.025,
            Math.sin(angle) * reach * t);
          center.x += (random() - 0.5) * 0.045; center.z += (random() - 0.5) * 0.045;
          center.y += (random() - 0.5) * 0.025;
          leaf(center, 0.028 + random() * 0.015, 0.040 + random() * 0.025, angle);
        }
      }
    }
  } else {
    for (let limb = 0; limb < 10; limb++) {
      const angle = limb * 2.399 + random() * 0.5, reach = 0.13 + random() * 0.14;
      const start = 0.26 + random() * 0.23, tip = 0.59 + random() * 0.30;
      const path = Array.from({ length: 6 }, (_, step) => {
        const t = step / 5;
        return new THREE.Vector3(Math.cos(angle) * reach * t,
          start + (tip - start) * Math.pow(t, 0.70), Math.sin(angle) * reach * t);
      });
      tube(path, 0.007 + random() * 0.003);
      for (let twig = 0; twig < 5; twig++) {
        const center = path[path.length - 1].clone();
        center.x += (random() - 0.5) * 0.14; center.z += (random() - 0.5) * 0.14;
        center.y += (random() - 0.5) * 0.09;
        tube([path[3], path[4], center], 0.0023);
        for (let l = 0; l < 52; l++) {
          const p = center.clone();
          const a = random() * TAU, r = Math.cbrt(random()) * 0.065;
          p.x += Math.cos(a) * r; p.z += Math.sin(a) * r;
          p.y += (random() - 0.5) * 0.10;
          leaf(p, 0.010 + random() * 0.012, 0.020 + random() * 0.020);
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

function woodland(root) {
  const random = randomSource(15589), groups = [], points = [];
  const transform = new THREE.Object3D(), color = new THREE.Color();
  // Sample the actual rendered triangles, including overlapping ridge surfaces.
  // The previous apron-only sampler could leave a trunk hanging over another layer.
  root.updateMatrixWorld(true);
  const terrain = root.children.filter(o => o.userData.valleyGround);
  terrain.forEach(mesh => mesh.geometry.computeBoundingBox());
  const ray = new THREE.Raycaster(new THREE.Vector3(), new THREE.Vector3(0, -1, 0));
  function backgroundHeight(x, z) {
    ray.ray.origin.set(x, 150, z);
    return ray.intersectObjects(terrain, false)[0]?.point.y ?? outsideHeight(x, z) - 0.06;
  }
  for (let i = 0; i < 152; i++) {
    const near = i < 96;
    const a = random() * TAU, distance = near ? 25 + Math.pow(random(), 1.5) * 35 : 60 + random() * 43;
    const x = -3 + Math.cos(a) * distance, z = -2 + Math.sin(a) * distance;
    if (x > -20 && x < 15 && z > -16 && z < 12) continue;
    points.push({ x, z, y: backgroundHeight(x, z) - 0.065,
      height: near ? 3.6 + random() * 3.4 : 4.8 + random() * 4.1,
      yaw: random() * TAU, cedar: random() < 0.57 });
  }
  points.sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
  for (const cedar of [true, false]) {
    const trees = points.filter(p => p.cedar === cedar), geometry = treeGeometry(cedar);
    const foliageMaterial = new THREE.MeshStandardMaterial({ map: leafTexture(cedar), vertexColors: true,
      roughness: 0.92, alphaTest: 0.33, alphaToCoverage: true, side: THREE.DoubleSide });
    const barkMaterial = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
    const crown = new THREE.InstancedMesh(geometry.foliage, foliageMaterial, trees.length);
    const trunks = new THREE.InstancedMesh(geometry.wood, barkMaterial, trees.length);
    crown.name = cedar ? 'Distant fine-needled cedar woodland' : 'Distant small-leaf woodland';
    trunks.name = crown.name + ' branching trunks';
    trees.forEach((p, i) => {
      transform.position.set(p.x, p.y, p.z);
      transform.rotation.set((random() - 0.5) * 0.06, p.yaw, (random() - 0.5) * 0.08);
      const width = p.height * (0.85 + random() * 0.22);
      transform.scale.set(width, p.height, width); transform.updateMatrix();
      crown.setMatrixAt(i, transform.matrix); trunks.setMatrixAt(i, transform.matrix);
      color.setRGB(0.85 + random() * 0.14, 0.88 + random() * 0.13, 0.85 + random() * 0.15);
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
  material.transparent = true; material.opacity = 0.91; material.depthWrite = false;
  material.roughness = 0.20; material.metalness = 0.12;
  material.color.set('#526d53'); material.envMapIntensity = 1.4;
  patch(material, 'flow-v1', shader => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec2 vValleyWater;').replace('#include <begin_vertex>',
      '#include <begin_vertex>\nvValleyWater = (modelMatrix * vec4(position, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\nvarying vec2 vValleyWater;\nuniform float uValleyTime, uValleyMotion;')
      .replace('#include <normal_fragment_begin>', `#include <normal_fragment_begin>
        vec2 p = vValleyWater;
        float flowTime = uValleyTime * uValleyMotion;
        vec2 ripple = vec2(cos(p.x * 28.0 + p.y * 17.0 - flowTime * 2.3),
          sin(p.y * 35.0 - p.x * 9.0 - flowTime * 3.1)) * 0.045;
        ripple += vec2(sin(p.x * 11.0 + flowTime), cos(p.y * 14.0 - flowTime)) * 0.025;
        normal = normalize(normal + mat3(viewMatrix) * vec3(ripple.x, 0.0, ripple.y));`);
  });
}

export function createEnvironment({ scene, renderer, model, sun, groundAt }) {
  const root = new THREE.Group(); root.name = 'Hidden valley atmosphere';
  const motionPreference = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  let quality = 'standard';
  const uniforms = { uValleyTime: { value: 0 }, uValleyMotion: { value: 1 } };
  const waterMaterials = new Set();
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
  sun.color.set('#ffe9cb'); sun.intensity = 3.2;
  sun.position.set(12, 23, 23); sun.target.position.set(-5, 0, -2);
  sun.shadow.normalBias = 0.025; sun.shadow.bias = -0.00015;
  Object.assign(sun.shadow.camera, { left: -18, right: 18, top: 18, bottom: -18, near: 0.5, far: 75 });
  sun.shadow.camera.updateProjectionMatrix();
  const sky = new THREE.Mesh(new THREE.SphereGeometry(250, 32, 20), skyMaterial());
  sky.name = 'Painted morning sky'; sky.renderOrder = -10; sky.frustumCulled = false;
  root.add(sky, valleyFloor(), ridge(106, 89, 80, 0.8, '#6d8a81'),
    ridge(66, 68, 48, 2.7, '#536f60'), ridge(35, 55, 31, 4.3, '#3e5945'));
  const trees = woodland(root);
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
