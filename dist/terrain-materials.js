import * as THREE from 'three';

const ASSETS = [
  ['dirtColor', 'terrain/polyhaven-dirt_floor/dirt_floor_diff_1k.jpg', true],
  ['dirtNormal', 'terrain/polyhaven-dirt_floor/dirt_floor_nor_gl_1k.jpg'],
  ['dirtRough', 'terrain/polyhaven-dirt_floor/dirt_floor_rough_1k.jpg'],
  ['forestColor', 'terrain/polyhaven-forest_leaves_02/forest_leaves_02_diffuse_1k.jpg', true],
  ['forestNormal', 'terrain/polyhaven-forest_leaves_02/forest_leaves_02_nor_gl_1k.jpg'],
  ['forestRough', 'terrain/polyhaven-forest_leaves_02/forest_leaves_02_rough_1k.jpg'],
  ['firColor', 'foliage/polyhaven-fir_tree_01/fir_tree_01_twig_diff_1k.jpg', true],
  ['firAlpha', 'foliage/polyhaven-fir_tree_01/fir_tree_01_twig_alpha_1k.jpg'],
];

// Install only a complete set. A missing local asset reaches the existing load-error UI.
export async function loadTerrainMaterials(renderer) {
  const loader = new THREE.TextureLoader();
  const results = await Promise.allSettled(ASSETS.map(async ([name, file, color]) => {
    const texture = await loader.loadAsync(new URL('./assets/' + file, import.meta.url).href);
    texture.name = name;
    texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    texture.wrapS = texture.wrapT = file.startsWith('foliage/') ? THREE.ClampToEdgeWrapping : THREE.RepeatWrapping;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return [name, texture];
  }));
  if (results.some(result => result.status === 'rejected')) {
    for (const result of results) if (result.status === 'fulfilled') result.value[1].dispose();
    throw new Error('庭の土と枝葉の素材を読み込めません。ファイルを確認して再読み込みしてください。');
  }
  return Object.fromEntries(results.map(result => result.value));
}

const DECLARATIONS = `
  varying vec3 vGardenWorld;
  uniform sampler2D uDirtColor, uDirtNormal, uDirtRough;
  uniform sampler2D uForestColor, uForestNormal, uForestRough;
  uniform float uGardenBaked, uGardenForest;
  float gardenNoise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    vec4 h = fract(sin(vec4(dot(i, vec2(127.1, 311.7)),
      dot(i + vec2(1.0, 0.0), vec2(127.1, 311.7)),
      dot(i + vec2(0.0, 1.0), vec2(127.1, 311.7)),
      dot(i + vec2(1.0), vec2(127.1, 311.7)))) * 43758.5453);
    return mix(mix(h.x, h.y, f.x), mix(h.z, h.w, f.x), f.y);
  }
  mat3 gardenFrame(vec3 p, vec3 n, vec2 uv) {
    vec3 qx = dFdx(p), qy = dFdy(p);
    vec2 ux = dFdx(uv), uy = dFdy(uv);
    vec3 a = cross(qy, n), b = cross(n, qx);
    vec3 t = a * ux.x + b * uy.x, v = a * ux.y + b * uy.y;
    float strength = inversesqrt(max(max(dot(t, t), dot(v, v)), 0.00000001));
    return mat3(t * strength, v * strength, n);
  }
`;

// World projection keeps detail continuous across the original baked triangle/UV borders.
// Only albedo, microsurface normals and roughness change; no vertex or collider is moved.
export function applyTerrainMaterial(material, textures, { baked = true, forest = 0 } = {}) {
  const before = material.onBeforeCompile;
  const baseKey = material.customProgramCacheKey();
  material.onBeforeCompile = function(shader, renderer) {
    before.call(this, shader, renderer);
    Object.assign(shader.uniforms, {
      uDirtColor: { value: textures.dirtColor }, uDirtNormal: { value: textures.dirtNormal },
      uDirtRough: { value: textures.dirtRough }, uForestColor: { value: textures.forestColor },
      uForestNormal: { value: textures.forestNormal }, uForestRough: { value: textures.forestRough },
      uGardenBaked: { value: baked ? 1 : 0 }, uGardenForest: { value: forest },
    });
    shader.vertexShader = shader.vertexShader.replace('#include <common>',
      '#include <common>\nvarying vec3 vGardenWorld;').replace('#include <project_vertex>', `
      #include <project_vertex>
      vec4 gardenPosition = vec4(transformed, 1.0);
      #ifdef USE_INSTANCING
        gardenPosition = instanceMatrix * gardenPosition;
      #endif
      vGardenWorld = (modelMatrix * gardenPosition).xyz;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>',
      '#include <common>\n' + DECLARATIONS).replace('#include <color_fragment>', `
      #include <color_fragment>
      vec2 gardenUV = vGardenWorld.xz * 0.46;
      vec2 litterUV = mat2(0.84, -0.54, 0.54, 0.84) * vGardenWorld.xz * 0.31 + 7.3;
      float gardenBroad = gardenNoise(vGardenWorld.xz * 0.14);
      float gardenEdge = smoothstep(-1.8, 2.8, max(max(-15.0 - vGardenWorld.x, vGardenWorld.x - 10.0),
        max(-11.0 - vGardenWorld.z, vGardenWorld.z - 7.0)));
      float gardenForest = clamp(uGardenForest + gardenEdge * (0.28 + gardenBroad * 0.40), 0.0, 0.88);
      vec3 gardenDirt = texture2D(uDirtColor, gardenUV).rgb;
      vec3 gardenLitter = texture2D(uForestColor, litterUV).rgb;
      vec3 gardenDetail = mix(gardenDirt * vec3(0.67, 0.66, 0.62),
        gardenLitter * vec3(0.58, 0.64, 0.52), gardenForest);
      float gardenMacro = clamp(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)) / 0.038, 0.60, 1.22);
      float groveLuminance = max(dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722)), 0.008);
      vec3 groveTint = clamp(diffuseColor.rgb / groveLuminance, vec3(0.65), vec3(1.35));
      vec3 floorTint = mix(vec3(0.64, 0.86, 0.58), groveTint, 0.45);
      gardenDetail *= mix(floorTint, vec3(1.0), uGardenBaked);
      vec3 gardenBaked = mix(vec3(0.68 + gardenBroad * 0.16), vec3(gardenMacro), uGardenBaked);
      diffuseColor.rgb = mix(gardenDetail * gardenBaked, diffuseColor.rgb, mix(0.24, 0.20, uGardenBaked));
      diffuseColor.rgb *= 0.92 + gardenBroad * 0.14;
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      float gardenRough = mix(texture2D(uDirtRough, gardenUV).g,
        texture2D(uForestRough, litterUV).g, gardenForest);
      roughnessFactor = clamp(0.56 + gardenRough * 0.40, 0.62, 0.97);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      vec3 gardenN = texture2D(uDirtNormal, gardenUV).xyz * 2.0 - 1.0;
      vec3 litterN = texture2D(uForestNormal, litterUV).xyz * 2.0 - 1.0;
      float gardenFade = 1.0 - smoothstep(0.025, 0.18, length(fwidth(gardenUV)));
      gardenN.xy *= 0.46 * gardenFade; litterN.xy *= 0.40 * gardenFade;
      vec3 gardenNormal = normalize(gardenFrame(-vViewPosition, normal, gardenUV) * normalize(gardenN));
      vec3 litterNormal = normalize(gardenFrame(-vViewPosition, normal, litterUV) * normalize(litterN));
      normal = normalize(mix(gardenNormal, litterNormal, gardenForest));
    `);
  };
  material.customProgramCacheKey = () => baseKey + '|garden-pbr-v18-shore-' + Number(baked) + '-' + forest;
  material.needsUpdate = true;
}
