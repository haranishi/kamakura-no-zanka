// W2c-13 grass: flat dark ribbons -> shadow gradient and bounded rounded normals.
export function patchGrassR7(shader,kind,quality) {
  if(kind!=='near'||quality==='light')return;
  shader.vertexShader=shader.vertexShader
    .replace('#include <common>',`#include <common>
      uniform float uGrass7Strength;
      varying vec3 vGrass7FlatNormal;`)
    .replace('objectNormal = normalize(mix(leafNormal,normalize(iTip.yzw),0.78));',`
      objectNormal = normalize(mix(leafNormal,normalize(iTip.yzw),0.78));
      vGrass7FlatNormal=normalize(normalMatrix*objectNormal);
      vec3 grass7Across=vec3(cos(iRoot.w),0.0,sin(iRoot.w));
      grass7Across=normalize(grass7Across-objectNormal*dot(grass7Across,objectNormal));
      float grass7Angle=(uv.x*2.0-1.0)*.436332313*uGrass7Strength;
      objectNormal=normalize(objectNormal*cos(grass7Angle)+grass7Across*sin(grass7Angle));`);
  shader.fragmentShader=shader.fragmentShader
    .replace('#include <common>',`#include <common>
      uniform float uGrass7Strength;
      varying vec3 vGrass7FlatNormal;`)
    .replace('#include <normal_fragment_begin>',`#include <normal_fragment_begin>
      vec3 grass7Rounded=normal;
      normal=normalize(vGrass7FlatNormal);
      #ifdef DOUBLE_SIDED
        normal*=faceDirection;
      #endif
      // Evaluate the original flat lighting; apply only a bounded rounded response.
      vec3 grass7Sun=normalize((viewMatrix*vec4(uSunDir,0.0)).xyz);
      float grass7FlatCos=max(0.0,dot(normal,grass7Sun));
      float grass7RoundCos=max(0.0,dot(grass7Rounded,grass7Sun));
      float grass7RoundGain=1.0+clamp(.1*(grass7RoundCos-grass7FlatCos)/.422618262,-.1,.1);`)
    .replace('vec3 grass6Sky=vec3(.65,.80,1.0);',`
      reflectedLight.directDiffuse*=grass7RoundGain;
      vec3 grass6Sky=vec3(.65,.80,1.0);`)
    .replace('float grass6Target=max(mix(.020,.010,grass6Dusk),grass6Y);',`
      // W2c-13 GR2: keep old fine pigment/tips, add a second spatial scale only in shade.
      float grass7Dark=1.0-smoothstep(.020,.025,dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722)));
      float grass7Gate=grass7Dark*uGrass7Strength;
      float grass7Gradient=mix(1.0,.55+.85*sqrt(clamp(vGrassUV.y,0.0,1.0)),grass7Gate);
      reflectedLight.indirectDiffuse*=grass7Gradient;
      totalEmissiveRadiance*=grass7Gradient;
      vec3 grass7TipSky=grass4KeepLuma(grass6Sky*vec3(1.06,1.02,.86),dot(grass6Sky,vec3(.2126,.7152,.0722)));
      vec3 grass7Tip=max(vGrassColor,vec3(.001))*grass7TipSky*mix(.28,.16,grass6Dusk)*smoothstep(.18,1.0,vGrassUV.y)*grass7Gate;
      float grass6Target=max(mix(.020,.010,grass6Dusk),grass6Y)*grass7Gradient+dot(grass7Tip,vec3(.2126,.7152,.0722));`)
    .replace('grass6Base/max(grass6Y,.000001)*max(0.0,grass6Target-grass6Current)',
      '(grass6Base*grass7Gradient+grass7Tip)/max(dot(grass6Base*grass7Gradient+grass7Tip,vec3(.2126,.7152,.0722)),.000001)*max(0.0,grass6Target-grass6Current)');
}
