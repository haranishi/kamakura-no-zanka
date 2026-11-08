import { ShaderChunk } from '../vendor/three.module.min.js';
import { nearGrassR3DensityAt, GRASS_R3_NEAR_GLSL, GRASS_SHADOW_EMISSIVE_FLOOR } from './kamakura-grass-r3.js';
// W2c-9c: optional ribbon shading and four fading footsteps; valley never calls this.
import { GRASS_BAND_GLSL, packGrassBands, nearGrassDensityAt } from './kamakura-grass-band.js';
import { packGrassLook, grassRecovery, MID_GRASS, MID_BANDS, packGrassR4 } from './kamakura-grass-look.js';
export function createGrassLook(ecology,quality,heroUniform,bands=false,r3=false,r4=false) {
  const trail=new Float32Array(16), ages=new Float64Array(4).fill(10), radii=new Float32Array(4), strengths=new Float32Array(4);
  const uniforms={uHero:heroUniform,uHeroStrength:{value:0},uGrassTrail:{value:trail},uGrassTrailRadii:{value:radii},uGrassLookStep:{value:0},uGrass4Strength:{value:1}};
  let cursor=0, elapsed=0, cameraX=0, cameraZ=0;
  // W2c-9c2: plan each metre; 7m CPU lawn guard covers the unchanged 6m shader fade.
  // W2c-9r2 grass: longer mid reach -> fewer candidates per grassland cell.
  return { replanDistance:1, bulkMid:true, midPlacement:{sink:MID_GRASS.sink,maxSlope:MID_GRASS.maxSlope,cardRate:bands ? .38 : .28,maxCards:1}, segments:6, normalBlend:.78, capacityFactor:3, uniforms,
    pack:(data,kind)=>{const packed=packGrassLook(data,kind,ecology,quality);const result=bands?packGrassBands(packed,kind):packed;return r4?packGrassR4(result,kind,ecology,quality):result;},
    prepare(camera){cameraX=camera.position.x;cameraZ=camera.position.z;},
    accept(data,i,kind){
      if(kind!=='near')return true;
      const marker=data[i+11];
      // W2c-9r1 grass: submit only roots whose smooth shader gate can be nonzero.
      if(bands && data[i+7]-.06>=(r3?nearGrassR3DensityAt:nearGrassDensityAt)(data[i],data[i+2],(Math.hypot(data[i]-cameraX,data[i+2]-cameraZ)-1)/(quality==='light'?.6:1)))return false;
      if(r3 && nearGrassR3DensityAt(data[i],data[i+2],(Math.hypot(data[i]-cameraX,data[i+2]-cameraZ)-1)/(quality==='light'?.6:1))===0)return false;
      if(marker===-1)return uniforms.uGrassLookStep.value<2&&Math.hypot(data[i]-cameraX,data[i+2]-cameraZ)<7;
      if(marker===-2)return uniforms.uGrassLookStep.value<2;
      return true;
    },
    updateHero(pos,speed=0,flying=false,dt=1/60) {
      const hero=heroUniform.value, run=Math.max(0,Math.min(1,speed/5)), radius=.72+.24*run;
      hero.set(pos.x,pos.y??0,pos.z,flying?0:radius); uniforms.uHeroStrength.value=flying?0:.65+.30*run;
      const delta=Math.max(0,Math.min(.1,dt)); elapsed+=delta;
      for(let i=0;i<4;i++){ages[i]+=delta;trail[i*4+3]=flying?0:strengths[i]*grassRecovery(ages[i]);}
      if(flying){ages.fill(10);return;}
      if(elapsed>=.20){elapsed=0;const i=cursor++%4;ages[i]=0;trail[i*4]=pos.x;trail[i*4+1]=pos.y??0;trail[i*4+2]=pos.z;trail[i*4+3]=uniforms.uHeroStrength.value;radii[i]=radius;strengths[i]=uniforms.uHeroStrength.value;}
    },
    setAdapt(step){uniforms.uGrassLookStep.value=step;uniforms.uGrass4Strength.value=step>=3?0:step>=2?.35:1;},
    patch(shader,kind) {
      Object.assign(shader.uniforms,uniforms);
      if(kind==='mid') {
        // W2c-9c3: mixed-height colonies; sparser after 30m, ground handoff by 120m.
        shader.vertexShader=shader.vertexShader
          .replace('transformed = vec3(p.x,t*iShape.x,p.y) * mix(.7,1.0,appear);',`
            // W2c-9c3: distance changes species, never world-keyed root locations.
            float grassTallRate=mix(${MID_BANDS[0].tall.toFixed(2)},${MID_BANDS[1].tall.toFixed(2)},smoothstep(28.0,32.0,dd))*(1.0-smoothstep(68.0,72.0,dd));
            float grassLowRate=${MID_BANDS[0].low.toFixed(2)}*(1.0-smoothstep(28.0,32.0,dd));
            float grassTall=(1.0-smoothstep(grassTallRate-.015,grassTallRate+.015,iTip.x))*step(.01,grassTallRate);
            float grassLow=smoothstep(1.0-grassLowRate-.015,1.0-grassLowRate+.015,iTip.x)*step(.01,grassLowRate);
            float grassHeight=mix(.25+.15*iTip.w,.45+.30*iTip.w,grassTall);
            grassHeight=mix(grassHeight,.08+.12*iTip.w,grassLow);
            if(iTip.x<0.0){float grassMarginFade=1.0-smoothstep(68.0,72.0,dd);grassTall=grassMarginFade;grassHeight=mix(.25+.15*iTip.w,.5+.3*iTip.w,grassMarginFade);}
            float grassWidth=mix(1.0,.48,grassTall);
            // packed width includes its 12–30m species; undo before selecting a band.
            float grassOldWidth=iTip.x<.30?.48:1.0;
            transformed=vec3(p.x*grassWidth/grassOldWidth,t*(grassHeight+${MID_GRASS.sink.toFixed(2)}),p.y*grassWidth/grassOldWidth)*mix(.7,1.0,appear);`)
          .replace('vGrassColor = iColor',`vGrassColor = mix(iColor,vec3(.30,.34,.085),grassTall*.32*smoothstep(.35,1.0,t))`)
          .replace('mix(.9,1.1,t)','mix(.48,1.42,t)')
          .replace('float alive = step(fadeOut,iShape.w);',`float tail=mix(1.0,.12,smoothstep(30.0,95.0,dd))*(1.0-smoothstep(.85*uGrassRadii.y,uGrassRadii.y,dd));
            float alive=step(fract(iShape.w*17.31),tail)*(1.0-step(uGrassRadii.y,dd));`)
          .replace('transformed.xz += grassWind(rootWorld,t,iShape.x);',`transformed.xz += grassWind(rootWorld,t,iShape.x);
            // W2c-9c2: dissolve each edge-on plane, including tilted ridge silhouettes.
            vec2 faceXZ=mat2(along.x,along.y,-along.y,along.x)*normal.xz;
            vec3 cardNormal=vec3(faceXZ.x,normal.y,faceXZ.y);
            cardNormal=cardNormal*cos(iTip.y)+cross(axis,cardNormal)*sin(iTip.y)
              +axis*dot(axis,cardNormal)*(1.0-cos(iTip.y));
            float cardFace=abs(dot(normalize(mat3(modelMatrix)*cardNormal),normalize(cameraPosition-rootWorld)));
            transformed*=smoothstep(.04,.16,cardFace);`);
        shader.fragmentShader=shader.fragmentShader.replace('.60*smoothstep(9.0,25.0,vGrassDistance)',
          `${MID_GRASS.blend.toFixed(2)}*smoothstep(9.0,25.0,vGrassDistance)`)
          .replace('diffuseColor.rgb *= vGrassColor;',`diffuseColor.rgb *= vGrassColor;
            // Small blue-grey drift and an unlit floor preserve dusk separation.
            diffuseColor.rgb=mix(diffuseColor.rgb,vec3(.12,.16,.19),.12*smoothstep(30.0,120.0,vGrassDistance));`)
          .replace('vec3 sight =',`totalEmissiveRadiance+=max(vec3(.012,.016,.009),vGrassColor*.055)*mix(.45,1.3,vGrassUV.y);
            vec3 sight =`);
      }
      if(kind==='near') {
        shader.vertexShader=shader.vertexShader.replace('uniform vec2 uGrassRadii;',`uniform vec2 uGrassRadii;
          uniform vec4 uHero; uniform float uHeroStrength; uniform vec4 uGrassTrail[4]; uniform float uGrassTrailRadii[4]; uniform float uGrassLookStep;
          vec3 grassPress(vec3 root, vec4 foot, float radius) {
            vec2 delta=root.xz-foot.xz;
            if (radius<=0.0 || abs(delta.x)>radius || abs(delta.y)>radius) return vec3(0.0);
            float d=length(delta); float r=max(.001,radius);
            float s=clamp(d/r,0.0,1.0); float push=6.75*s*(1.0-s)*(1.0-s)*step(.001,d)*step(abs(root.y-foot.y),1.2);
            return vec3(delta/max(d,.001)*push,push);
          }`)
          .replace('vec3(0,1,0),.65',`normalize(iTip.yzw),${this.normalBlend.toFixed(2)}`)
          .replace('float width = mix(max(.02,1.0-t),iTip.x,t*t);',`float width = pow(max(.005,1.0-t),.65);
            if(iTip.x < -1.5 && iTip.x > -2.5) width=mix(.09,1.0,smoothstep(.70,.84,t))*(1.0-smoothstep(.92,1.0,t));
            if(iTip.x < -2.5) width=mix(.12,.75,smoothstep(.65,.78,t))*(1.0-smoothstep(.86,1.0,t));
            if(iTip.x < -.5 && iTip.x > -1.5) alive*=(1.0-smoothstep(4.5,6.0,dd))*step(uGrassLookStep,1.0);
            if(iTip.x < -1.5 && iTip.x > -2.5) alive*=(1.0-smoothstep(10.0,12.0,dd))*step(uGrassLookStep,1.0);`)
          .replace('transformed.xz += grassWind(rootWorld,t,iShape.x);',`transformed.xz += grassWind(rootWorld,t,iShape.x);
            transformed.xz += vec2(-along.y,along.x)*iShape.x*.20*sin(t*3.14159265)*t;
            transformed.xz += along*abs(position.x)*.002*sin(t*3.14159265);
            vec3 push=grassPress(rootWorld,uHero,uHero.w)*uHeroStrength;
            for(int i=0;i<4;i++) { vec3 old=grassPress(rootWorld,uGrassTrail[i],uGrassTrailRadii[i])*uGrassTrail[i].w; if(old.z>push.z)push=old; }
            transformed.xz += push.xy*iShape.x*.85*t*t;
            transformed.y *= 1.0-.65*min(1.0,push.z)*t;`)
          .replace('mix(.6,1.1,t)','mix(.40,1.15,t)');
        shader.fragmentShader=shader.fragmentShader.replace('diffuseColor.rgb *= vGrassColor;',`diffuseColor.rgb *= vGrassColor;
          float ridge=1.0-.12*abs(vGrassUV.x*2.0-1.0); diffuseColor.rgb*=ridge;
          diffuseColor.rgb=mix(uGroundTint*.42,diffuseColor.rgb,smoothstep(0.0,.22,vGrassUV.y));`)
          .replace('mix(.8,1.0,edge)*.39','mix(.8,1.0,edge)*.48')
          .replace('vec3 sight =',`vec3 lookHalf=normalize((viewMatrix*vec4(normalize(uSunDir)+normalize(cameraPosition-vGrassWorld),0.0)).xyz);
            float glint=pow(max(0.0,dot(normal,lookHalf)),28.0);
            totalEmissiveRadiance+=vec3(.012)*glint*vGrassUV.y;
            vec3 sight =`);
        // Tip markers are not RGB: keep flower stems green and colour their heads.
        shader.vertexShader=shader.vertexShader.replace('vGrassColor = mix(iColor,iTip.yzw,smoothstep(.55,1.0,t)*step(.01,iTip.x))',
          'vGrassColor = (iTip.x < -1.5 ? mix(vec3(.085,.16,.035),iTip.x < -2.5 ? vec3(.25,.17,.075) : iColor,smoothstep(.70,.85,t)) : iColor)');
      }
      if(r3){
        // W2c-9r3 grass fix: double-darkened sky -> ground's unshadowed sky, softer emissive shade.
        // No additional texture fetch; visibility=1 also covers disabled shadow maps.
        const lighting=ShaderChunk.lights_fragment_begin.replace(
          /directLight.color \*= (\( directLight.visible && receiveShadow \) \? getShadow\( directionalShadowMap[^;]+);/,
          'grassSunVisibility = $1; directLight.color *= grassSunVisibility;');
        shader.fragmentShader=shader.fragmentShader
          .replace('#include <lights_fragment_begin>','float grassSunVisibility = 1.0;\n'+lighting)
          .replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
            totalEmissiveRadiance *= mix(${GRASS_SHADOW_EMISSIVE_FLOOR.toFixed(2)},1.0,grassSunVisibility);`);
      }
      // W2c-9r1 grass: replace the 9c3 tail/appear gates only in the opt-in band look.
      if(bands){
        shader.vertexShader=shader.vertexShader.replace('uniform vec2 uGrassRadii;',`uniform vec2 uGrassRadii;
${GRASS_BAND_GLSL}`);
        if(kind==='mid'){
          shader.uniforms.uGrassLookStep=uniforms.uGrassLookStep;
          shader.vertexShader=shader.vertexShader.replace('uniform vec2 uGrassRadii;','uniform float uGrassLookStep; uniform vec2 uGrassRadii;')
            .replace(/float tail=mix[\s\S]*?float appear = [^;]*; alive \*= [^;]*;/,`float bandDistance=dd/${quality==='light'?'0.6':'1.0'}+midGrassBandOffset(rootWorld.xz)*smoothstep(30.0,70.0,dd/${quality==='light'?'0.6':'1.0'});
              float bandDensity=midGrassDensity(bandDistance)*mix(1.0,.55,step(1.5,uGrassLookStep));
              float alive=smoothstep(fract(iShape.w*17.31)-.08,fract(iShape.w*17.31)+.08,bandDensity)*smoothstep(0.0,.08,bandDensity);
              float appear=smoothstep(6.0,18.0,bandDistance);`)
            .replace('t*(grassHeight+0.12)','t*(grassHeight*(.82+.36*iTip.w)+0.12)');
        }else{
          shader.vertexShader=shader.vertexShader.replace('float alive = step(fadeOut,iShape.w);',`float bandDistance=dd/${quality==='light'?'0.6':'1.0'}+grassBandOffset(rootWorld.xz);
            float alive=smoothstep(iShape.w-.06,iShape.w+.06,nearGrassDensity(bandDistance))*smoothstep(0.0,.06,nearGrassDensity(bandDistance));`);
        }
      }
      if(r3){
        // W2c-9r3 grass: broaden both density and species handoffs, without transparent tiers.
        shader.vertexShader=shader.vertexShader
          .replace(/float grassBandOffset\(vec2 p\)\{[^}]+\}/, '')
          .replace(/float nearGrassDensity\(float d\)\{[^}]+\}/, GRASS_R3_NEAR_GLSL)
          .replaceAll('smoothstep(6.0,18.0,','smoothstep(6.0,26.0,')
          .replaceAll('smoothstep(28.0,32.0,dd)','smoothstep(18.0,38.0,dd)');
      }
      if(r4)patchGrassR4(shader,kind,quality);
    }
  };
}

// W2c-10 grass: colour and contact are arithmetic only; no new texture/shadow lookup.
function patchGrassR4(shader,kind,quality) {
  const full=quality!=='light';
  const declarations=`
    uniform float uGrass4Strength;
    varying vec4 vGrass4;
    vec3 grass4KeepLuma(vec3 c,float y){return c*(y/max(dot(c,vec3(.2126,.7152,.0722)),.000001));}
  `;
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>
    uniform vec3 uGroundTint;
    ${declarations}
    float grass4Hash(vec2 p,float n){return fract(sin(p.x*127.1+p.y*311.7+n*74.7)*43758.5453);}`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>
    ${declarations}`);
  // W2c-10 grass FIX2 GX3: cap mid growth on CPU and GPU; near retains full variation.
  // Mid atlas flip uses only the sign of iShape.z. Its magnitude carries the
  // prepared growth ratio, avoiding CPU/GPU floating-point hash disagreement.
  if(kind==='mid' && full)shader.vertexShader=shader.vertexShader.replace('transformed *= alive;',`
    transformed.y*=mix(1.0,clamp(abs(iShape.z),.80,1.25),uGrass4Strength);
    transformed *= alive;`);
  shader.vertexShader=shader.vertexShader.replace(/(vGrassColor = [\s\S]*?;)/,'$1'+`
    // Match soil hue at constant blade luminance; preserve the existing distance handoff.
    ${kind==='near'?`if(iTip.x> -1.5){
      float grass4Y=dot(vGrassColor,vec3(.2126,.7152,.0722));
      vec3 grass4Ground=grass4KeepLuma(uGroundTint,grass4Y);
      vGrassColor=mix(vGrassColor,grass4KeepLuma(mix(vGrassColor,grass4Ground,.36),grass4Y),uGrass4Strength);
    }`:''}
    float grass4Dry=clamp((iColor.r/max(iColor.g,.001)-.42)/.75,0.0,1.0);
    vGrass4=vec4(grass4Dry,grass4Hash(iRoot.xz,1249.0),rootWorld.y+${kind==='mid'?'.12':'0.0'},.75+.10*grass4Hash(iRoot.xz,1217.0));
    `);
  // Remove R3's broad, normalized root gradient; use physical centimetres instead.
  if(kind==='near' && full)shader.fragmentShader=shader.fragmentShader.replace('diffuseColor.rgb=mix(uGroundTint*.42,diffuseColor.rgb,smoothstep(0.0,.22,vGrassUV.y));','');
  // Old additive backlight/glint ran before sun visibility was known. Replace them below.
  shader.fragmentShader=shader.fragmentShader
    .replace('totalEmissiveRadiance+=vec3(.012)*glint*vGrassUV.y;','')
    // Exactly opposed eye/sun directions have no half-vector. Keep the zero finite.
    .replace('vec3 lookHalf=normalize((viewMatrix*vec4(normalize(uSunDir)+normalize(cameraPosition-vGrassWorld),0.0)).xyz);',`
      vec3 lookHalf=(viewMatrix*vec4(normalize(uSunDir)+normalize(cameraPosition-vGrassWorld),0.0)).xyz;
      lookHalf*=inversesqrt(max(dot(lookHalf,lookHalf),.000001));`)
    .replace(/totalEmissiveRadiance \+= min\(vec3\(\.35\)[^;]+;/,'');
  if(full && kind==='near')shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`
    // W2c-10 grass GR1/GR4: dry tips and sparse basal litter retain albedo luminance.
    float grass4Tip=smoothstep(vGrass4.w,1.0,vGrassUV.y)*mix(.25,.80,vGrass4.x);
    float grass4Root=1.0-smoothstep(.02,.04,max(0.0,vGrassWorld.y-vGrass4.z));
    float grass4Litter=step(.86,vGrass4.y)*grass4Root;
    vec3 grass4DryColor=grass4KeepLuma(mix(vec3(.30,.34,.10),vec3(.34,.24,.115),vGrass4.x),dot(diffuseColor.rgb,vec3(.2126,.7152,.0722)));
    diffuseColor.rgb=mix(diffuseColor.rgb,grass4DryColor,grass4Tip*uGrass4Strength);
    vec3 grass4Contact=mix(uGroundTint*.42,grass4DryColor*.65,grass4Litter);
    diffuseColor.rgb=mix(diffuseColor.rgb,grass4Contact,.65*grass4Root*uGrass4Strength);
    float grass4Floor=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
    diffuseColor.rgb+=vec3(max(0.0,.012-grass4Floor));
    #include <alphatest_fragment>`);
  // W2c-10 grass FIX2 GX3: FIX1 grey, tip, litter and soil-hue effects are near-only.
  // Keep preparation hue-only so this does not desaturate twice.
  shader.fragmentShader=shader.fragmentShader.replace('#include <alphatest_fragment>',`
    // W2c-10 grass FIX1 GX1: evaluate width before alpha discard and visibility gates.
    // UV spans the tapered ribbon; reciprocal derivative estimates its pixel width.
    float grass4PixelWidth=1.0/max(fwidth(vGrassUV.x),.000001);
    float grass4Coverage=smoothstep(1.0,2.0,grass4PixelWidth);
    float grass4Near=1.0-smoothstep(6.0,8.0,vGrassDistance);
    ${kind==='near'?`float grass4FinalY=dot(diffuseColor.rgb,vec3(.2126,.7152,.0722));
    diffuseColor.rgb=mix(diffuseColor.rgb,vec3(grass4FinalY),.25*uGrass4Strength);`:''}
    // W2c-10 grass FIX2 parent: measured -5% (noon) / -11% (evening) luminance on grass rows after tips, litter and root dark were added; albedo gain restores it.
    diffuseColor.rgb*=1.0+.17*uGrass4Strength;
    #include <alphatest_fragment>`);
  shader.fragmentShader=shader.fragmentShader.replace('#include <lights_fragment_end>',`#include <lights_fragment_end>
    // sunBacklight(surface->camera,sun,1): max(0,-dot(normalized dirs))^4.
    vec3 grass4ToEye=normalize(cameraPosition-vGrassWorld);
    float grass4Facing=max(0.0,-dot(grass4ToEye,normalize(uSunDir)));
    float grass4Back=grass4Facing*grass4Facing;grass4Back*=grass4Back;
    float grass4Transmission=grass4Back*grassSunVisibility*uGrass4Strength*${kind==='mid'?'0.0':full?'1.0':'.50'};
    float grass4Evening=1.0-smoothstep(.25,.65,normalize(uSunDir).y);
    vec3 grass4Warm=mix(vec3(1.12,1.06,.70),vec3(1.65,1.0,.40),grass4Evening);
    // Tint only existing direct radiance; sky and full-shadow blades remain unchanged.
    vec3 grass4Direct=reflectedLight.directDiffuse;
    vec3 grass4Tint=grass4KeepLuma(grass4Direct*grass4Warm,dot(grass4Direct,vec3(.2126,.7152,.0722)));
    // W2c-10 grass FIX2 GX4: albedo-equivalent gain on direct light only; no sky/shadow lift.
    reflectedLight.directDiffuse=mix(grass4Direct,grass4Tint,grass4Transmission*(.35+.65*vGrassUV.y))*${kind==='near'?'(1.0+.12*uGrass4Strength*grassSunVisibility)':'1.0'};
    // W2c-10 grass FIX2 GX5: transmitted sunlight also reaches back-facing ribbons.
    // Resolved near leaves only: preserve FIX1's subpixel and mid-card speck guards.
    float grass4Through=.28*grass4Transmission*(.35+.65*vGrassUV.y)*mix(.65,1.0,grass4Evening)*grass4Coverage*${kind==='near'?'1.0':'0.0'};
    vec3 grass4ThroughColor=vec3(0.0);
    #if NUM_DIR_LIGHTS > 0
      grass4ThroughColor=diffuseColor.rgb*directionalLights[0].color*grass4Warm*grass4Through;
    #endif
    // W2c-10 grass FIX1 GX1: subpixel glints -> resolved nearby ribbons only.
    float grass4Edge=pow(abs(vGrassUV.x*2.0-1.0),12.0);
    float grass4TipEdge=smoothstep(.90,1.0,vGrassUV.y);
    float grass4SunSide=.25+.75*max(0.0,dot(normal,normalize((viewMatrix*vec4(uSunDir,0.0)).xyz)));
    float grass4Add=min(.12,.008*grass4Transmission*grass4SunSide*max(grass4Edge,grass4TipEdge)*${kind==='near'?'(.6+1.4*glint)':'1.0'}*vGrassUV.y*grass4Coverage*grass4Near);
    // Share the absolute per-channel budget with the existing fine edge light.
    totalEmissiveRadiance+=min(vec3(.12),grass4ThroughColor+vec3(1.0,.625,.1875)*grass4Add);
  `);
}
