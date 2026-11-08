// W2c-11 grass: replace R4's albedo floor with shadow-independent sky radiance.
import { GRASS_R5_GLSL } from './kamakura-grass-r5.js';
export function patchGrassR5(shader,kind,quality) {
  const scale=quality==='light'?'0.6':'1.0';
  shader.vertexShader=shader.vertexShader.replace('uniform vec2 uGrassRadii;',`uniform vec2 uGrassRadii;\n${GRASS_R5_GLSL}`);
  if(kind==='near')shader.vertexShader=shader.vertexShader
    .replace(/float bandDistance=[^;]+;/,`float bandDistance=grass6Distance(iRoot.xz,dd/${scale});`)
    .replaceAll('nearGrassDensity(bandDistance)','grass6Weights(bandDistance).x');
  else shader.vertexShader=shader.vertexShader
    .replace(/float bandDistance=[^;]+;/,`float bandDistance=grass6Distance(iRoot.xz,dd/${scale});`)
    .replace('midGrassDensity(bandDistance)',`mix(grass6Weights(bandDistance).y,midGrassDensity(dd/${scale}+midGrassBandOffset(rootWorld.xz)*smoothstep(30.0,70.0,dd/${scale})),smoothstep(30.0,40.0,dd/${scale}))`)
    // Extra candidate roots are for 8–40m only; keep the old tail's mean density.
    .replace('float alive=smoothstep(fract',`bandDensity*=mix(1.0,${(quality==='light'?1:.38/.42).toFixed(8)},smoothstep(30.0,40.0,dd/${scale}));
              float alive=smoothstep(fract`)
    .replace(/transformed=vec3\(p.x\*grassWidth\/grassOldWidth,[^;]+;/,'transformed=vec3(p.x*grassWidth/grassOldWidth,t*mix(iShape.x,grassHeight*(.82+.36*iTip.w)*clamp(abs(iShape.z),.80,1.25)+.12,smoothstep(40.0,80.0,dd)),p.y*grassWidth/grassOldWidth);')
    .replace('transformed.y*=mix(1.0,clamp(abs(iShape.z),.80,1.25),uGrass4Strength);','')
    .replace('mix(.48,1.42,t)','mix(.40,1.15,t)')
    .replace('vGrassColor = mix(iColor,vec3(.30,.34,.085),grassTall*.32*smoothstep(.35,1.0,t))','vGrassColor = iColor');
  // W2c-11 grass (parent): a near ribbon narrower than ~0.9px only makes a lit single-pixel sparkle (aliasing; evening speck 4->40 once the
  // near band reached 8-26m). Drop it; the mid cards carry that distance. Lives here, not in the R4 patch, so grass6=0 stays byte-identical.
  if(kind==='near')shader.fragmentShader=shader.fragmentShader
    .replace('float grass4Coverage=smoothstep(1.0,2.0,grass4PixelWidth);','float grass4Coverage=smoothstep(1.0,2.0,grass4PixelWidth);\n    if(uGrass6Strength>.5&&grass4PixelWidth<.9)discard;');
  if(kind==='mid')shader.fragmentShader=shader.fragmentShader
    .replace('totalEmissiveRadiance+=max(vec3(.012,.016,.009),vGrassColor*.055)*mix(.45,1.3,vGrassUV.y);','')
    .replace('0.40*smoothstep(9.0,25.0,vGrassDistance)','mix(.40,1.0,smoothstep(40.0,120.0,vGrassDistance))*smoothstep(9.0,25.0,vGrassDistance)'); // full token incl. the leading 0 (a partial match left '0mix(' = invalid GLSL, found in real Chrome)
  shader.fragmentShader=shader.fragmentShader
    .replace(/float grass4Floor=[^;]+;\s*diffuseColor.rgb\+=vec3\(max\(0.0,.012-grass4Floor\)\);/,'')
    .replace('totalEmissiveRadiance *= mix(0.30,1.0,grassSunVisibility);',`totalEmissiveRadiance *= mix(0.30,1.0,grassSunVisibility);
      // After shadows: existing emissive + indirect are included, never lifted twice.
      vec3 grass6Sky=vec3(.65,.80,1.0);
      #if NUM_HEMI_LIGHTS > 0
        grass6Sky=hemisphereLights[0].skyColor/max(dot(hemisphereLights[0].skyColor,vec3(.2126,.7152,.0722)),.000001);
      #endif
      float grass6Dusk=1.0-smoothstep(.12,.55,normalize(uSunDir).y);
      vec3 grass6Base=max(vGrassColor,vec3(.001))*grass6Sky*mix(.08,.06,grass6Dusk);
      float grass6Y=dot(grass6Base,vec3(.2126,.7152,.0722));
      float grass6Target=max(mix(.020,.010,grass6Dusk),grass6Y);
      float grass6Current=dot(reflectedLight.directDiffuse+reflectedLight.indirectDiffuse+totalEmissiveRadiance,vec3(.2126,.7152,.0722));
      float grass6Dark=1.0-smoothstep(.020,.025,dot(reflectedLight.directDiffuse,vec3(.2126,.7152,.0722)));
      totalEmissiveRadiance+=grass6Base/max(grass6Y,.000001)*max(0.0,grass6Target-grass6Current)*grass6Dark*uGrass6Strength;
    `)
    .replace('uniform float uGrass4Strength;','uniform float uGrass4Strength; uniform float uGrass6Strength;');
}
