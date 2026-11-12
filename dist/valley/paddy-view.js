// 棚田のまとめ描き。新規の当たり・外部素材・時計は持たず、共有風を受け取る。
import * as THREE from 'three';
import { cellRand } from './scatter.js';
import { PADDY, paddyQuality, paddyOptions, PADDY_LOOK, PADDY_DEBUG } from './paddy.js';

const riceColor = () => new THREE.Color(PADDY_LOOK.tintA).lerp(new THREE.Color(PADDY_LOOK.tintB), .5).multiply(new THREE.Color().setRGB(...PADDY_LOOK.tip));
// 同じ画素ハッシュを近・遠の両方へ使い、混合帯の被覆の和を1にする。
export function patchPaddyRice(material, wind, { far = false, distance = { value: PADDY.farEnd }, debug = false } = {}) {
  const old = material.onBeforeCompile;
  material.onBeforeCompile = shader => {
    old.call(material, shader);
    Object.assign(shader.uniforms, wind, { uPaddyEnd: distance });
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      varying float vPaddyDistance;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 paddyRoot = (modelMatrix * instanceMatrix * vec4(0.0,0.0,0.0,1.0)).xyz;
      vPaddyDistance = distance(paddyRoot, cameraPosition);`);
    if (debug) shader.vertexShader = shader.vertexShader.replace('#include <color_vertex>', '#include <color_vertex>\n vColor = instanceColor;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform float uPaddyEnd; varying float vPaddyDistance;`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      float paddyFar = smoothstep(${PADDY.nearStart.toFixed(1)},${PADDY.nearEnd.toFixed(1)},vPaddyDistance);
      float paddyGrain = fract(sin(dot(floor(gl_FragCoord.xy),vec2(12.9898,78.233)))*43758.5453);
      ${far ? `float paddyOuter = 1.0-smoothstep(uPaddyEnd-${PADDY.adaptDistance.toFixed(1)},uPaddyEnd,vPaddyDistance);
      if (paddyGrain >= paddyFar*paddyOuter) discard;` : 'if (paddyGrain < paddyFar) discard;'}
      `);
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
    for (let i = 0; i < g.attributes.position.count; i++) col.push(color.r, color.g, color.b);
    g.dispose(); if (g !== geometry) geometry.dispose();
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.computeBoundingSphere();
  const mesh = new THREE.Mesh(g, material); mesh.name = name; mesh.receiveShadow = true; return mesh;
}
export function buildPaddy({ layout, wind, quality = 'standard', search = globalThis.location?.search || '' }) {
  const options = paddyOptions(search), group = new THREE.Group(); group.name = 'paddy';
  let level = 0, work = 0, profile = paddyQuality(quality);
  const empty = { enabled: false, plots: 0, standing: 0, harvested: 0, partial: 0, farRice: 0, stoneLength: 0, racks: 0, straw: 0, triangles: 0, drawCalls: 0, updateItems: 0 };
  if (!options.enabled || !layout) return { group, update() {}, setLevel() {}, stats: () => ({ ...empty }) };
  const debug = options.debug, details = [], stones = [], color = (normal, key) => debug ? new THREE.Color(PADDY_DEBUG[key]) : normal;
  const box = (list, x, y, z, sx, sy, sz, c) => list.push({ geometry: new THREE.BoxGeometry(sx, sy, sz).translate(x, y, z), color: c });
  const rod = (a, b, radius, c) => {
    const start = new THREE.Vector3(...a), end = new THREE.Vector3(...b), delta = end.clone().sub(start);
    details.push({ geometry: new THREE.CylinderGeometry(radius, radius, delta.length(), 5, 1).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize())).translate(...start.add(end).multiplyScalar(.5).toArray()), color: c });
  };
  const gold = riceColor().multiplyScalar(PADDY_LOOK.groundGain), grass = color(new THREE.Color(PADDY_LOOK.grass), 'bund');
  for (const b of layout.bunds) {
    const x0 = b.x - b.sx / 2, x1 = b.x + b.sx / 2, z0 = b.z - b.sz / 2, z1 = b.z + b.sz / 2, y = b.y + PADDY.bundHeight;
    const vertices = [x0,y,z0, x0,y,z1, x1,y,z0, x1,y,z0, x0,y,z1, x1,y,z1,
      x0,b.y,z0, x0,y,z0, x1,y,z0, x0,b.y,z0, x1,y,z0, x1,b.y,z0,
      x0,y,z1, x0,b.y,z1, x1,y,z1, x1,y,z1, x0,b.y,z1, x1,b.y,z1];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3)); g.computeVertexNormals();
    details.push({ geometry: g, color: grass });
  }
  for (const s of layout.stones) {
    const g = new THREE.BoxGeometry(s.width, s.height, s.depth), positions = g.attributes.position;
    // 角を位置ハッシュで内側へ欠き、直方体の反復を崩す。同じ角の重複頂点は同じ位置に保つ。
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = positions.getY(i), z = positions.getZ(i), corner = Number(x > 0) + 2 * Number(y > 0) + 4 * Number(z > 0);
      const factor = .90 + .10 * cellRand(2303 + corner, Math.round(s.x * 100), Math.round(s.z * 100))();
      positions.setXYZ(i, x * factor, y * factor, z * factor);
    }
    g.computeVertexNormals();
    // 地中の底面を送らない。軽量でも石の大きさ・位置・上面を保つ。
    const index = [...g.index.array]; index.splice(18, 6); g.setIndex(index); g.clearGroups();
    g.translate(s.x, s.y, s.z);
    stones.push({ geometry: g, color: color(new THREE.Color(PADDY_LOOK.rock).multiplyScalar(PADDY_LOOK.rockGain * (.9 + .2 * s.width / PADDY.stoneMax)), 'stone') });
  }
  // 切り株を列で残す。標準・軽量とも同じ位置なので田の種類は変わらない。
  let stubbleCount = 0;
  for (let i = 0; i < layout.stubble.length; i++) {
    if (quality === 'light' && i % 2) continue;
    const s = layout.stubble[i]; stubbleCount++;
    const p = layout.plots[s.plot], c = color(gold, p.kind);
    const g = new THREE.ConeGeometry(.065, PADDY.stubbleHeight, 3, 1, true).translate(s.x, s.y + PADDY.stubbleHeight / 2 + PADDY_LOOK.detailsLift, s.z);
    details.push({ geometry: g, color: c });
  }
  const rackGold = color(gold, 'rack'), wood = color(new THREE.Color(PADDY_LOOK.wood).multiplyScalar(.5), 'rack');
  for (const r of layout.racks) {
    const h = r.y + r.height, ends = [r.x - r.length / 2, r.x + r.length / 2];
    for (const x of ends) for (const [dx, dz] of [[-.3, -.65], [.3, -.65], [0, .65]]) rod([x + dx, r.y, r.z + dz], [x, h, r.z], PADDY_LOOK.rackRadius, wood);
    rod([ends[0] - .2, h, r.z], [ends[1] + .2, h, r.z], PADDY_LOOK.rackRadius, wood);
    for (let x = ends[0] + .2; x < ends[1]; x += .32) {
      // 細い頂と太い裾を持つ稲束を横木の両側へ垂らす。
      for (const side of [-1, 1]) details.push({ geometry: new THREE.ConeGeometry(PADDY_LOOK.sheafRadius, .8, 4, 1).translate(x, h - .35, r.z + side * .18), color: rackGold });
    }
  }
  for (const s of layout.straw) {
    details.push({ geometry: new THREE.ConeGeometry(.38, s.height, 5, 1).translate(s.x, s.y + s.height / 2, s.z), color: debug ? new THREE.Color(PADDY_DEBUG.harvested) : gold });
    box(details, s.x, s.y + s.height * .6, s.z, .20, .055, .20, wood);
  }
  const makeMaterial = () => debug ? new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const detailMesh = meshFromParts(details, makeMaterial(), 'paddy-bunds-harvest');
  const stoneMesh = meshFromParts(stones, makeMaterial(), 'paddy-stones');
  detailMesh.frustumCulled = stoneMesh.frustumCulled = false;
  group.add(detailMesh, stoneMesh);
  const geo = new THREE.BufferGeometry(), pos = [], colors = [], normals = [];
  for (let axis = 0; axis < 2; axis++) {
    const dx = Math.cos(axis * Math.PI / 2), dz = Math.sin(axis * Math.PI / 2), w = PADDY_LOOK.farWidth / 2, h = PADDY_LOOK.farHeight;
    const points = [[-w, 0], [w, 0], [w * .7, h * .8], [-w, 0], [w * .7, h * .8], [-w * .6, h], [-w * .6, h], [w * .7, h * .8], [w * .15, h * 1.08]];
    for (const [x, y] of points) {
      pos.push(dx * x, y, dz * x); normals.push(0, 1, .1);
      const tip = Math.min(1, y / h), c = new THREE.Color().setRGB(.5 + .34 * tip, .5 + .14 * tip, .22 + .05 * tip);
      colors.push(c.r, c.g, c.b);
    }
  }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3)); geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeBoundingSphere();
  const material = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, emissive: 0x24351c });
  const distance = { value: profile.distance };
  farWind(material, wind); patchPaddyRice(material, wind, { far: true, distance, debug });
  const far = new THREE.InstancedMesh(geo, material, layout.far.length); far.name = 'paddy-far-rice'; far.receiveShadow = true; far.frustumCulled = false;
  const matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), scale = new THREE.Vector3(), root = new THREE.Vector3(), tint = new THREE.Color(PADDY_LOOK.tintA).lerp(new THREE.Color(PADDY_LOOK.tintB), .5);
  for (let i = 0; i < layout.far.length; i++) {
    const s = layout.far[i], p = layout.plots[s.plot]; root.set(s.x, s.y, s.z); scale.set(1, s.height, 1); matrix.compose(root, rotation, scale); far.setMatrixAt(i, matrix); far.setColorAt(i, debug ? new THREE.Color(PADDY_DEBUG[p.kind]) : tint.clone().multiplyScalar(p.tint));
  }
  far.instanceMatrix.needsUpdate = true; far.instanceColor.needsUpdate = true; group.add(far);
  // 描画用の順序はrank順。品質変更は数だけを減らすので毎コマの配列・行列確保は無い。
  const master = far.instanceMatrix.array.slice(), masterColors = far.instanceColor.array.slice();
  let lastX = Infinity, lastY = Infinity, lastZ = Infinity, dirty = true, tests = 0;
  const update = camera => {
    const c = camera.position;
    if (!dirty && Math.hypot(c.x - lastX, c.y - lastY, c.z - lastZ) < .5) { work = 0; return; }
    const q = profile; distance.value = q.distance; let count = 0; tests = 0;
    for (let i = 0; i < layout.far.length && layout.far[i].rank < q.density; i++) {
      const s = layout.far[i]; tests++;
      if (Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) > q.distance + PADDY_LOOK.farWidth || Math.hypot(s.x - c.x, s.y - c.y, s.z - c.z) < PADDY.nearStart - PADDY_LOOK.farWidth) continue;
      for (let k = 0; k < 16; k++) far.instanceMatrix.array[count * 16 + k] = master[i * 16 + k];
      for (let k = 0; k < 3; k++) far.instanceColor.array[count * 3 + k] = masterColors[i * 3 + k];
      count++;
    }
    far.count = count; far.visible = count > 0; far.instanceMatrix.needsUpdate = true; far.instanceColor.needsUpdate = true;
    lastX = c.x; lastY = c.y; lastZ = c.z; dirty = false; work = tests;
  };
  far.count = 0;
  return { group, update, setLevel(n) { const v = Math.max(0, Math.min(3, Math.floor(n))); if (v !== level) { level = v; profile = paddyQuality(quality, level); dirty = true; } },
    stats() {
      const counts = { standing: 0, harvested: 0, partial: 0 }; for (const p of layout.plots) counts[p.kind]++;
      return { enabled: true, plots: layout.plots.length, ...counts, farRice: far.count, stoneLength: layout.stoneLength, contourLength: layout.stones.filter(s => s.followsContour).length / PADDY.stoneLayers * PADDY.stonePitch, stones: layout.stones.length, racks: layout.racks.length, straw: layout.straw.length, stubble: stubbleCount,
        triangles: tris(detailMesh.geometry) + tris(stoneMesh.geometry) + far.count * tris(geo), drawCalls: 2 + Number(far.count > 0), level, distance: distance.value, updateItems: work, capacity: layout.far.length };
    } };
}
