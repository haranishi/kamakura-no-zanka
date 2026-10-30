// 遠景（L2）の絵の板（impostor）：起動時と品質の切り替え時に、実際の近景の木（L0）を8方向から絵の帳へ焼き（view層）、
// 150m（軽量は100m）以遠を、カメラへ向く板1枚で描く。円錐の三角形を約1/10にし、浮いた分を近景へ回す（R17.11）。
// 方向の選び方と帳の割り付けは tree-impostor.js（純粋）。読み込むファイルは増やさない（焼く元は手続きの木と画像）。
import * as THREE from 'three';
import { TREES } from './config.js';
import { treeGeometry } from './tree-geometry.js';
import { CEDAR_FAMILIES } from './tree-branches.js';
import { IMPOSTOR, impostorFamilies, impostorLayout, frameFit, frameUV, bakePlacement } from './tree-impostor.js';
const heights = [20, 12, 13, 8];
const f3 = v => v.toFixed(3);
// The boards are baked from the near trees (L0): the middle cedar's 36 large tufts left thin, see-through far crowns
// and bare hillsides between them (measured side by side from the overlook, 2026-10-31).
export const IMPOSTOR_SOURCE = 0;

// The source tree's extent from the trunk axis: the board pivots on the trunk, so its half-width is the widest radius.
export function familyExtent(species, shape, level = IMPOSTOR_SOURCE) {
  const g = treeGeometry(species, level, shape); let half = 0, bottom = Infinity, top = -Infinity;
  for (const mesh of [g.leaf, g.wood]) {
    const p = mesh.getAttribute('position');
    for (let i = 0; i < p.count; i++) { half = Math.max(half, Math.hypot(p.getX(i), p.getZ(i))); bottom = Math.min(bottom, p.getY(i)); top = Math.max(top, p.getY(i)); }
  }
  return { half: half * 1.04, bottom: Math.min(bottom, -.1), top: top + .15 };
}
// One board per family: x across the trunk (metres), y up; uv covers the family's frame.
export function impostorGeometry(fit) {
  const g = new THREE.BufferGeometry(), h = fit.half, b = fit.bottom, t = fit.top;
  g.setAttribute('position', new THREE.Float32BufferAttribute([-h, b, 0, h, b, 0, h, t, 0, -h, t, 0], 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 1, 1, 0, 1], 2));
  g.setIndex([0, 1, 2, 0, 2, 3]); g.computeBoundingSphere(); return g;
}

// Bake shader: the same alpha cut as the near leaves (texture alpha, cedar cards fading edge-on, broadleaf rims eroding by
// leaf), no lighting. One program for every family (uniform switches): five define variants cost ~0.3s of compiling at boot.
// Mode 0 writes albedo (texture x exposure x gain), mode 1 the frame-space normal and a leaf mask (1 leaf, 0 wood).
function bakeMaterial({ map = null, detail = null, gain = 1, cedar = false, wood = false, crownShade = false }) {
  return new THREE.ShaderMaterial({
    vertexColors: true, side: THREE.DoubleSide, blending: THREE.NoBlending, fog: false, toneMapped: false,
    uniforms: { uMode: { value: 0 }, map: { value: map }, uDetail: { value: detail }, uGain: { value: gain }, uCrownShade: { value: TREES.bark.crownShade },
      uFlags: { value: new THREE.Vector4(map ? 1 : 0, detail ? 1 : 0, cedar ? 1 : 0, wood ? (crownShade ? 2 : 1) : 0) } },
    vertexShader: `varying vec2 vUv; varying vec3 vColor; varying vec3 vNormalV; varying vec3 vViewPosition; varying float vHeight;
      void main() {
        vUv = uv; vColor = color; vHeight = position.y;
        vec4 mv = viewMatrix * instanceMatrix * vec4(position, 1.0);
        vNormalV = normalize(mat3(viewMatrix) * mat3(instanceMatrix) * normal); vViewPosition = -mv.xyz;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `uniform float uMode; uniform sampler2D map; uniform sampler2D uDetail; uniform float uGain; uniform float uCrownShade; uniform vec4 uFlags;
      varying vec2 vUv; varying vec3 vColor; varying vec3 vNormalV; varying vec3 vViewPosition; varying float vHeight;
      void main() {
        vec3 n = normalize(vNormalV);
        vec4 albedo = vec4(vColor * uGain, 1.0);
        if (uFlags.w > .5) {
          // Wood: the cedar trunk inside the crown stands in the tufts' shade (as the near wood shader); cores (UV -1) do not.
          if (uFlags.w > 1.5) albedo.rgb *= mix(1.0, uCrownShade, smoothstep(2.6, 5.5, vHeight) * step(-0.5, vUv.x));
        } else {
          // Sharper mip than the tiny bake scale would pick: crisp needles and leaves, no padding colour bleeding in.
          if (uFlags.x > .5) albedo *= texture2D(map, vUv, -1.5);
          if (uFlags.z > .5) {
            vec3 cardFace = cross(dFdx(vViewPosition), dFdy(vViewPosition));
            albedo.a *= smoothstep(.04, .22, abs(dot(cardFace, normalize(vViewPosition))) / max(length(cardFace), 1e-8));
          } else if (!gl_FrontFacing) n = -n;
          if (uFlags.y > .5) {
            vec4 leafDetail = texture2D(uDetail, vUv, -1.5);
            float leafHue = leafDetail.a * 2.0 - 1.0;
            albedo.rgb *= vec3(1.0 + ${f3(TREES.leafDetail.hue)} * leafHue, 1.0 + ${(TREES.leafDetail.hue / 6).toFixed(4)} * leafHue, 1.0 - ${f3(TREES.leafDetail.hue)} * leafHue);
            float leafGroup = texture2D(uDetail, vUv * .31 + .17).a;
            albedo.a *= smoothstep(.12, .46, abs(n.z) + (leafDetail.a - .5) * ${TREES.leafDetail.rim.toFixed(2)} + (leafGroup - .5) * ${TREES.leafDetail.group.toFixed(2)});
            albedo.a *= smoothstep(${TREES.leafDetail.gap.toFixed(2)}, ${(TREES.leafDetail.gap + .08).toFixed(2)}, texture2D(uDetail, vUv * .23 + .61).a);
            if (!gl_FrontFacing) albedo.rgb *= ${TREES.leafDetail.inner.toFixed(2)};
          }
          if (albedo.a < .3) discard;
        }
        gl_FragColor = uMode < .5 ? vec4(albedo.rgb, 1.0) : vec4(n * .5 + .5, uFlags.w > .5 ? 0.0 : 1.0);
      }`,
  });
}

// Far cedars only: a shaded inner cone behind the tufts. Seen from 150-600 m the gaps between tufts average into a thin,
// see-through crown and bare hillsides showed between trees; the near and middle cedars never draw this cone.
function cedarCore(shape) {
  const fam = CEDAR_FAMILIES[shape], g = new THREE.ConeGeometry(1.75 * fam.width, 15.8, 10, 1, true);
  g.translate(fam.lean[0] * .5, 2.7 + 7.9, fam.lean[1] * .5);
  const colors = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < colors.length; i += 3) colors.set([.03, .055, .03], i);
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return g;
}
// Far pines only: a flattened dark mass inside each fan cluster. Baked from the open umbrella fans alone, the far pines
// read as bare grey skeletons (the far domes they replaced had read as green lollipops).
function pineCores(leaf) {
  const centres = [...new Map(leaf.userData.parts.map(p => [p.center.join(','), p.center])).values()], geometries = [];
  for (const c of centres) { const g = new THREE.SphereGeometry(1, 10, 6); g.scale(1.3, .7, 1.3); g.translate(c[0], c[1] + .55, c[2]); geometries.push(g); }
  const positions = [], normals = [], uvs = [], index = []; let offset = 0;
  for (const g of geometries) {
    positions.push(...g.getAttribute('position').array); normals.push(...g.getAttribute('normal').array); uvs.push(...g.getAttribute('uv').array);
    for (const i of g.index.array) index.push(i + offset); offset += g.getAttribute('position').count; g.dispose();
  }
  const merged = new THREE.BufferGeometry();
  merged.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); merged.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  merged.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2)); merged.setIndex(index);
  const colors = new Float32Array(offset * 3); for (let i = 0; i < colors.length; i += 3) colors.set([.035, .06, .035], i);
  merged.setAttribute('color', new THREE.BufferAttribute(colors, 3)); return merged;
}
// Bake every adult family from eight directions into two atlases (albedo sRGB, normal+leaf mask linear) in one render each.
function bakeAtlas(renderer, families, layout, materials, targets, level = IMPOSTOR_SOURCE) {
  const scene = new THREE.Scene(), owned = [], cfg = IMPOSTOR;
  const shared = { wood: [bakeMaterial({ wood: true }), bakeMaterial({ wood: true, crownShade: true })] };
  owned.push(...shared.wood);
  const leafMaterials = new Map();
  const leafFor = species => {
    if (leafMaterials.has(species)) return leafMaterials.get(species);
    const near = materials.get(species, level).leaf, broad = species === 1 || species === 3;
    const m = bakeMaterial({ map: near.map, detail: broad ? near.normalMap : null, gain: near.color.r, cedar: species === 0 });
    leafMaterials.set(species, m); owned.push(m); return m;
  };
  const matrix = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), p = new THREE.Vector3(), s = new THREE.Vector3();
  const coreMaterial = bakeMaterial({}); owned.push(coreMaterial);
  for (const fam of families) {
    const g = treeGeometry(fam.species, level, fam.shape), parts = [[g.leaf, leafFor(fam.species)], [g.wood, shared.wood[fam.species === 0 ? 1 : 0]]];
    if (fam.species === 0) parts.push([cedarCore(fam.shape), coreMaterial]);
    if (fam.species === 2) parts.push([pineCores(g.leaf), coreMaterial]);
    for (const [geometry, material] of parts) {
      const mesh = new THREE.InstancedMesh(geometry.clone(), material, cfg.views); mesh.frustumCulled = false;
      for (let k = 0; k < cfg.views; k++) {
        const at = bakePlacement(fam.row, k, fam.fit);
        matrix.compose(p.set(at.x, at.y, 0), q.setFromAxisAngle(up, at.yaw), s.setScalar(at.scale)); mesh.setMatrixAt(k, matrix);
      }
      owned.push(mesh); scene.add(mesh);
    }
  }
  const camera = new THREE.OrthographicCamera(0, layout.width, layout.height, 0, 1, 1000); camera.position.set(0, 0, 500); camera.updateMatrixWorld();
  const prev = { target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear };
  try {
    renderer.autoClear = true;
    // Transparent texels carry a dark foliage colour (albedo) and a viewer-facing normal, so mip levels do not grow pale or bent rims.
    for (const [target, mode, clear] of [[targets.albedo, 0, new THREE.Color().setRGB(.035, .05, .03, THREE.LinearSRGBColorSpace)], [targets.normal, 1, new THREE.Color().setRGB(.5, .5, 1, THREE.LinearSRGBColorSpace)]]) {
      for (const m of owned) if (m.isMaterial) m.uniforms.uMode.value = mode;
      renderer.setRenderTarget(target); renderer.setClearColor(clear, 0); renderer.render(scene, camera);
    }
  } finally {
    renderer.setRenderTarget(prev.target); renderer.setClearColor(prev.color, prev.alpha); renderer.autoClear = prev.autoClear;
    for (const o of owned) { if (o.isInstancedMesh) { o.geometry.dispose(); o.dispose(); } else o.dispose(); }
    scene.clear();
  }
}

// The far material: Lambert lighting on a camera-facing board. The vertex stage picks two of the eight frames from the
// tree-local view azimuth (tree-impostor.js impostorView), the fragment blends them, rebuilds the normal from the board's
// basis and tints leaves (instance colour) and wood (aImpWood) apart. LOD weights and fade modes follow tree-materials.js.
export function impostorMaterial({ wind, sunDir, quality, frame, atlas, height = heights[0], atlasSize = [512, 1664] }) {
  const { alphaTest, mipBoost: boost } = TREES.impostor;
  const cfg = IMPOSTOR, fadeMode = quality === 'light' ? 'dither' : 'coverage';
  const m = new THREE.MeshLambertMaterial({ alphaTest, alphaToCoverage: quality !== 'light', side: THREE.FrontSide, emissive: 0x000000 });
  const lod = { value: new THREE.Vector4(-1, -1, -1, -1) }; m.userData.uLod = lod;
  const uniforms = { uSunDir: { value: sunDir }, uLod: lod, uImpFrame: { value: new THREE.Vector4(...frame) }, uImpStep: { value: 1 / cfg.views }, uImpAlbedo: { value: atlas.albedo }, uImpNormal: { value: atlas.normal } };
  m.userData.impostor = uniforms;
  m.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, wind, uniforms);
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `#include <common>
      attribute float aImpWood;
      uniform float uTime; uniform float uWind; uniform vec2 uWindDir; uniform float uGuideMix;
      uniform vec4 uLod; uniform vec4 uImpFrame; uniform float uImpStep;
      varying vec3 vTreeWorld; varying float vTreeDistance; varying float vTreeWeight;
      varying vec2 vImpUvA; varying vec2 vImpUvB; varying float vImpT; varying float vImpWood;
      varying vec3 vImpRight; varying vec3 vImpUp; varying vec3 vImpFwd;
      float treeNoise(vec2 p) {
        vec2 a=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
        return mix(mix(sin(dot(a,vec2(12.9898,78.233))),sin(dot(a+vec2(1,0),vec2(12.9898,78.233))),f.x),
          mix(sin(dot(a+vec2(0,1),vec2(12.9898,78.233))),sin(dot(a+vec2(1,1),vec2(12.9898,78.233))),f.x),f.y);
      }`).replace('#include <begin_vertex>', `#include <begin_vertex>
      vec3 treeOrigin = vec3(0.0);
      #ifdef USE_INSTANCING
        treeOrigin = instanceMatrix[3].xyz;
      #endif
      treeOrigin = (modelMatrix*vec4(treeOrigin,1.0)).xyz;
      mat3 treeBasis = mat3(modelMatrix);
      #ifdef USE_INSTANCING
        treeBasis = mat3(modelMatrix)*mat3(instanceMatrix);
      #endif
      // The camera in the tree's own frame (rotation only): its azimuth picks the frames, its direction turns the board.
      vec3 toCam = cameraPosition - treeOrigin;
      vec2 impDir = normalize(vec2(dot(normalize(treeBasis[0]), toCam), dot(normalize(treeBasis[2]), toCam)) + vec2(1e-5, 0.0));
      float impU = mod(atan(impDir.x, impDir.y) / 6.2831853 * ${cfg.views.toFixed(1)}, ${cfg.views.toFixed(1)});
      float impA = floor(impU), impB = mod(impA + 1.0, ${cfg.views.toFixed(1)});
      vImpT = smoothstep(${f3(.5 - cfg.band / 2)}, ${f3(.5 + cfg.band / 2)}, impU - impA);
      vImpUvA = uImpFrame.xy + vec2(impA * uImpStep, 0.0) + uv * uImpFrame.zw;
      vImpUvB = uImpFrame.xy + vec2(impB * uImpStep, 0.0) + uv * uImpFrame.zw;
      vec3 impRight = vec3(impDir.y, 0.0, -impDir.x);
      transformed = impRight * position.x + vec3(0.0, position.y, 0.0);
      vImpRight = normalize(mat3(viewMatrix) * (treeBasis * impRight));
      vImpUp = normalize(mat3(viewMatrix) * treeBasis[1]);
      vImpFwd = normalize(mat3(viewMatrix) * (treeBasis * vec3(impDir.x, 0.0, impDir.y)));
      vImpWood = aImpWood;
      // The far crown keeps the shared slow sway and gusts (no leaf flutter at this distance).
      float ph = treeOrigin.x*.37+treeOrigin.z*.21;
      float heightRatio = clamp(position.y/${height.toFixed(1)},0.0,1.0);
      float slow = sin(uTime*.8+ph)*.12*heightRatio*heightRatio;
      float bandPhase = dot(treeOrigin.xz,uWindDir)*.045-uTime*.9;
      float band = smoothstep(.55,.95,sin(bandPhase+treeNoise(treeOrigin.xz*.025)*.65));
      float gust = band*.18*step(.5,uWind)*(1.0+.6*uGuideMix)*heightRatio*heightRatio;
      vec2 treeMotion = (uWindDir*(slow+gust))*uWind;
      vec3 worldMotion = vec3(treeMotion.x,0.0,treeMotion.y);
      transformed += vec3(dot(treeBasis[0],worldMotion)/max(dot(treeBasis[0],treeBasis[0]),.0001),
        dot(treeBasis[1],worldMotion)/max(dot(treeBasis[1],treeBasis[1]),.0001),
        dot(treeBasis[2],worldMotion)/max(dot(treeBasis[2],treeBasis[2]),.0001));
      vec4 treeWorld = vec4(transformed,1.0);
      #ifdef USE_INSTANCING
        treeWorld = instanceMatrix*treeWorld;
      #endif
      vTreeWorld = (modelMatrix*treeWorld).xyz;
      vTreeDistance = distance(treeOrigin,cameraPosition);
      float enter = uLod.x < 0.0 ? 1.0 : smoothstep(uLod.x,uLod.y,vTreeDistance);
      float leave = uLod.z < 0.0 ? 1.0 : 1.0-smoothstep(uLod.z,uLod.w,vTreeDistance);
      vTreeWeight = enter*leave;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `#include <common>
      uniform sampler2D uImpAlbedo; uniform sampler2D uImpNormal;
      varying vec3 vTreeWorld; varying float vTreeDistance; varying float vTreeWeight;
      varying vec2 vImpUvA; varying vec2 vImpUvB; varying float vImpT; varying float vImpWood;
      varying vec3 vImpRight; varying vec3 vImpUp; varying vec3 vImpFwd;`)
      .replace('#include <map_fragment>', `// Two neighbouring frames, blended only inside the band between them.
      vec4 impAlbedo = mix(texture2D(uImpAlbedo, vImpUvA), texture2D(uImpAlbedo, vImpUvB), vImpT);
      vec2 impTexel = vImpUvA * vec2(${atlasSize[0].toFixed(1)}, ${atlasSize[1].toFixed(1)});
      float impLod = max(0.0, 0.5 * log2(max(dot(dFdx(impTexel), dFdx(impTexel)), dot(dFdy(impTexel), dFdy(impTexel)))));
      impAlbedo.a = min(1.0, impAlbedo.a * (1.0 + impLod * ${f3(boost)}));
      vec4 impNormal = mix(texture2D(uImpNormal, vImpUvA), texture2D(uImpNormal, vImpUvB), vImpT);
      diffuseColor *= impAlbedo;`)
      .replace('#include <color_fragment>', `// Leaves take the instance colour (season, brightness); trunks keep the individual's bark brightness.
      #if defined( USE_COLOR ) || defined( USE_INSTANCING_COLOR )
        diffuseColor.rgb *= mix(vec3(vImpWood), vColor.rgb, step(.5, impNormal.a));
      #endif`)
      .replace('#include <alphatest_fragment>', `#include <alphatest_fragment>
      ${fadeMode === 'coverage' ? 'diffuseColor.a *= vTreeWeight;' : `float n = fract(52.9829189*fract(dot(gl_FragCoord.xy,vec2(.06711056,.00583715))));
      if (n >= vTreeWeight) discard;`}`)
      .replace('#include <normal_fragment_maps>', `// The baked normal is in the frame's space (right, up, toward the viewer); rebuild it on the board's basis.
      vec3 impN = impNormal.rgb * 2.0 - 1.0;
      normal = normalize(impN.x * vImpRight + impN.y * vImpUp + impN.z * vImpFwd);`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
      totalEmissiveRadiance += diffuseColor.rgb*mix(.10, .24, step(.5, impNormal.a));`)
      .replace('#include <fog_fragment>', `#include <fog_fragment>
      // The same evening air as the near foliage (tree-materials.js): saturation fades with distance.
      float leafAir = ${TREES.leafAir.amount.toFixed(2)}*smoothstep(${TREES.leafAir.near.toFixed(1)}, ${TREES.leafAir.far.toFixed(1)}, length(vViewPosition));
      gl_FragColor.rgb = mix(gl_FragColor.rgb, vec3(dot(gl_FragColor.rgb, vec3(.2126,.7152,.0722)))*vec3(.94,.98,1.08), leafAir);`);
  };
  m.customProgramCacheKey = () => `tree-impostor-v1-${quality}-${fadeMode}`;
  return m;
}

// Owns the two atlases, the per-family boards and materials. bake(renderer) fills the atlases; until then they are blank.
export function treeImpostors({ wind, sunDir, quality = 'standard', materials }) {
  const families = impostorFamilies(TREES.variants), layout = impostorLayout(families.length);
  const target = colorSpace => {
    // No multisampling: side by side at board sizes it looked the same, and the 4x buffers would stay allocated (~50 MB).
    const t = new THREE.WebGLRenderTarget(layout.width, layout.height, { samples: 0, depthBuffer: true, stencilBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter });
    t.texture.colorSpace = colorSpace; t.texture.name = 'tree-impostor'; return t;
  };
  const targets = { albedo: target(THREE.SRGBColorSpace), normal: target(THREE.NoColorSpace) };
  const atlas = { albedo: targets.albedo.texture, normal: targets.normal.texture };
  const source = IMPOSTOR_SOURCE;
  for (const fam of families) { fam.fit = frameFit(familyExtent(fam.species, fam.shape, source)); fam.frame = frameUV(fam.row, fam.fit, layout); }
  const byKey = new Map(families.map(f => [`${f.species}/${f.shape}`, f])), owned = new Map();
  let disposed = false, baked = false;
  return {
    families, layout, atlas, targets,
    get baked() { return baked; },
    family(species, shape) { const f = byKey.get(`${species}/${shape}`); if (!f) throw new RangeError('impostor family'); return f; },
    material(species, shape) {
      if (disposed) throw new Error('tree impostors disposed');
      const key = `${species}/${shape}`;
      if (!owned.has(key)) owned.set(key, impostorMaterial({ wind, sunDir, quality, frame: this.family(species, shape).frame, atlas, height: heights[species], atlasSize: [layout.width, layout.height] }));
      return owned.get(key);
    },
    geometry(species, shape) {
      const g = impostorGeometry(this.family(species, shape).fit);
      g.userData.impostor = { species, shape }; return g;
    },
    bake(renderer) {
      if (disposed) throw new Error('tree impostors disposed');
      const start = performance.now(); bakeAtlas(renderer, families, layout, materials, targets, source); baked = true;
      return performance.now() - start;
    },
    dispose() { if (disposed) return; disposed = true; for (const m of owned.values()) m.dispose(); owned.clear(); targets.albedo.dispose(); targets.normal.dispose(); },
  };
}
