// W2c-15: R8 shading and pigment remain; replace only the distance/stream gates.
import { GRASS9_GLSL, GRASS9_THIN_CAP } from './kamakura-grass-stream.js';
export function patchGrassStream(shader,kind,stream) {
  Object.assign(shader.uniforms,{uGrass9Center:stream.center,uGrass9Radius:stream.radiusUniform});
  shader.vertexShader=shader.vertexShader
    .replace('uniform vec2 uGrassRadii;',`uniform vec2 uGrassRadii; uniform vec2 uGrass9Center; uniform float uGrass9Radius;`)
    .replace('void main() {',GRASS9_GLSL+'\nvoid main() {')
    .replace('distance(rootWorld.xz,cameraPosition.xz)','distance(rootWorld.xz,uGrass9Center)');
  if(kind==='near'){
    shader.vertexShader=shader.vertexShader
      .replace(/float fadeOut = [^;]+;/,'float fadeOut = grass9Blend(rootWorld.xz,dd);')
      .replace(/float alive=smoothstep\(iShape.w[^;]+;/,'float alive=1.0-grass9Blend(rootWorld.xz,dd);')
      .replace(/if\(iTip.x < -\.[^\n]+/g,'')
      .replace(/if\(iTip.x < -1\.5 && iTip.x > -2\.5\) alive[^;]+;/,'');
    // Subpixel blades stay (mid cards no longer carry 15-30 m, so dropping them leaves the lawn thin: blind critique round 2), but a
    // lit single-pixel blade is an aliasing sparkle (backlit evening: ~800 warm-white pixels). A blade thinner than ~2 px may not be
    // brighter than a lit lawn pixel: cap its display luminance, relaxing to no cap at 3 px. Resolved blades are untouched.
    shader.fragmentShader=shader.fragmentShader
      .replace('if(uGrass6Strength>.5&&grass4PixelWidth<.9)discard;','')
      .replace('#include <dithering_fragment>',`#include <dithering_fragment>
    {
      float grass9Thin=1.0-smoothstep(1.0,3.0,grass4PixelWidth);
      float grass9Cap=mix(4.0,${GRASS9_THIN_CAP},grass9Thin*grass9Thin);
      gl_FragColor.rgb*=min(1.0,grass9Cap/max(dot(gl_FragColor.rgb,vec3(.2126,.7152,.0722)),.0001));
    }`);
  }else shader.vertexShader=shader.vertexShader.replace('transformed *= alive;',
    'alive*=grass9Blend(rootWorld.xz,dd);\n transformed *= alive;');
}
