// W2c-11 veg6: card-scale colour/volume, near rim gaps and visible sunlit transmission.
import { CROWN_TILT_RADIANS } from './kamakura-crown.js';
import { photoBlendUniform } from './kamakura-photo-tex.js';
const HASH_GLSL = `float kzCardHash(vec3 p, float salt) {
  return fract(sin(dot(p,vec3(12.9898,37.719,78.233))+salt)*43758.5453);
}`;
const NOISE_GLSL = `float kzCrownNoise(vec3 p) {
  p /= 1.1;
  vec3 b = floor(p), f = fract(p); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(kzCardHash(b,0.0),kzCardHash(b+vec3(1,0,0),0.0),f.x),
    mix(kzCardHash(b+vec3(0,1,0),0.0),kzCardHash(b+vec3(1,1,0),0.0),f.x),f.y),
    mix(mix(kzCardHash(b+vec3(0,0,1),0.0),kzCardHash(b+vec3(1,0,1),0.0),f.x),
    mix(kzCardHash(b+vec3(0,1,1),0.0),kzCardHash(b+vec3(1,1,1),0.0),f.x),f.y),f.z);
}`;
export function applyCrownLook(material, { geometry, light = false, distant = false, impostor = false }) {
  const compile = material.onBeforeCompile, key = material.customProgramCacheKey();
  geometry.computeBoundingBox(); const b = geometry.boundingBox;
  const cy = (b.min.y + b.max.y) / 2, ry = Math.max(.01, (b.max.y - b.min.y) / 2);
  const p = geometry.attributes.position;
  // Area-weighted neutral height gain: multiplying the veg5 gradient must not
  // introduce a global exposure change. No runtime readback or frame allocation.
  let sum = 0, area = 0;
  const ix = geometry.index?.array;
  for (let t = 0; ix && t < ix.length; t += 3) {
    const a = ix[t], c = ix[t+1], d = ix[t+2];
    const e = [p.getX(c)-p.getX(a),p.getY(c)-p.getY(a),p.getZ(c)-p.getZ(a)];
    const f = [p.getX(d)-p.getX(a),p.getY(d)-p.getY(a),p.getZ(d)-p.getZ(a)];
    const w = Math.hypot(e[1]*f[2]-e[2]*f[1],e[2]*f[0]-e[0]*f[2],e[0]*f[1]-e[1]*f[0]);
    sum += w * (1 + .06 * ((p.getY(a)+p.getY(c)+p.getY(d))/3-cy)/ry); area += w;
  }
  const mean = area ? sum/area : 1;
  material.onBeforeCompile = shader => {
    compile(shader);
    shader.uniforms.uKzCrownPhoto = photoBlendUniform;
    const decl = 'uniform float uKzCrownPhoto; varying vec2 vKzCardTint; varying float vKzHeightGain; varying vec3 vKzCrownWorld;';
    shader.vertexShader = decl + '\n' + HASH_GLSL + '\n' + (distant || impostor ? '' : 'attribute vec3 aKzCard; attribute vec3 aKzCrownNormal;') + '\n' + shader.vertexShader;
    shader.fragmentShader = decl + '\n' + (light || distant || impostor ? '' : HASH_GLSL + '\n' + NOISE_GLSL) + '\n' + shader.fragmentShader;
    const world = `vec4 kzCardWorld = vec4(${distant || impostor ? 'position' : 'aKzCard'},1.0);
      #ifdef USE_INSTANCING
        kzCardWorld = instanceMatrix*kzCardWorld;
      #endif
      kzCardWorld = modelMatrix*kzCardWorld;
      vKzCardTint = vec2(1.0+.24*(kzCardHash(kzCardWorld.xyz,0.0)-.5),.06*(kzCardHash(kzCardWorld.xyz,19.7)-.5));`;
    // Normals must be defined before Three applies instance/model normal matrices.
    shader.vertexShader = shader.vertexShader.replace('#include <beginnormal_vertex>', `#include <beginnormal_vertex>
      ${world}
      ${light || distant || impostor ? '' : `vec3 kzTargetNormal = normalize(aKzCrownNormal);
      vec3 kzTiltAxis = normalize(cross(kzTargetNormal,abs(kzTargetNormal.y)<.9?vec3(0,1,0):vec3(1,0,0)));
      float kzTurn = 6.283185*kzCardHash(kzCardWorld.xyz,41.3);
      kzTiltAxis = kzTiltAxis*cos(kzTurn)+cross(kzTargetNormal,kzTiltAxis)*sin(kzTurn);
      float kzTilt = ${CROWN_TILT_RADIANS.toFixed(9)}*kzCardHash(kzCardWorld.xyz,73.1);
      vec3 kzTiltedNormal = kzTargetNormal*cos(kzTilt)+cross(kzTiltAxis,kzTargetNormal)*sin(kzTilt);
      objectNormal = normalize(mix(objectNormal,kzTiltedNormal,uKzVeg*uKzCrownPhoto));`}`);
    // Stands and baked boards also contain beginnormal_vertex in the Lambert base.
    // Negative constants stay parenthesised below: 'y--0.01' is a GLSL compile error that only a real GPU reports (found in real Chrome).
    shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', `#include <begin_vertex>
      vKzHeightGain = (1.0+.06*(position.y-(${cy.toFixed(8)}))/(${ry.toFixed(8)}))/(${mean.toFixed(8)});
      vec4 kzSurfaceWorld = vec4(position,1.0);
      #ifdef USE_INSTANCING
        kzSurfaceWorld = instanceMatrix*kzSurfaceWorld;
      #endif
      vKzCrownWorld = (modelMatrix*kzSurfaceWorld).xyz;`);
    shader.fragmentShader = shader.fragmentShader.replace('#include <normal_fragment_begin>', `
      float kzCrownWeight = uKzVeg*uKzCrownPhoto*kzLeafMask;
      diffuseColor.rgb *= mix(vec3(1.0),vKzCardTint.x*vec3(1.0+vKzCardTint.y,1.0,1.0-vKzCardTint.y),kzCrownWeight);
      ${light ? '' : 'diffuseColor.rgb *= mix(1.0,vKzHeightGain,kzCrownWeight);'}
      #include <normal_fragment_begin>`);
    if (!light && !distant && !impostor) shader.fragmentShader = shader.fragmentShader.replace('#include <alphatest_fragment>', `
      // Derivatives are unconditional, before any discard/alpha-test or varying branch.
      float kzGapNoise = kzCrownNoise(vKzCrownWorld);
      float kzGapWidth = max(.005,fwidth(kzGapNoise));
      float kzGap = smoothstep(.65,.8,length(vKzCrown))*(1.0-smoothstep(60.0,150.0,distance(vKzCrownWorld,cameraPosition)));
      diffuseColor.a *= 1.0-kzGap*smoothstep(.68-kzGapWidth,.68+kzGapWidth,kzGapNoise)*uKzVeg*uKzCrownPhoto;
      #include <alphatest_fragment>`);
    // Preserve veg5 verbatim at the A/B boundary. Light only changes card colour.
    if (!light && !distant) shader.fragmentShader = shader.fragmentShader.replace(' * kzFacing*kzVisible*kzLook;', ` * kzFacing*kzVisible*kzLook * (1.0-uKzCrownPhoto);
      vec3 kzThroughColor = mix(vec3(1.0,1.0,.48),vec3(1.0,.55,.20),1.0-smoothstep(.15,.55,uKzSun.y));
      reflectedLight.directDiffuse += min(vec3(.08),diffuseColor.rgb*kzThroughColor*kzRim*kzBack*2.5)*kzFacing*kzVisible*kzLook*uKzCrownPhoto;`);
  };
  material.customProgramCacheKey = () => `${key}-veg6-${light}-${distant}-${impostor}`;
}
