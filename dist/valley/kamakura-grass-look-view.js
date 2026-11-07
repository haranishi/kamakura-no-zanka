// W2c-9c: optional ribbon shading and four fading footsteps; valley never calls this.
import { packGrassLook, grassRecovery, MID_GRASS, MID_BANDS } from './kamakura-grass-look.js';
export function createGrassLook(ecology,quality,heroUniform) {
  const trail=new Float32Array(16), ages=new Float64Array(4).fill(10), radii=new Float32Array(4), strengths=new Float32Array(4);
  const uniforms={uHero:heroUniform,uHeroStrength:{value:0},uGrassTrail:{value:trail},uGrassTrailRadii:{value:radii},uGrassLookStep:{value:0}};
  let cursor=0, elapsed=0, cameraX=0, cameraZ=0;
  // W2c-9c2: plan each metre; 7m CPU lawn guard covers the unchanged 6m shader fade.
  return { replanDistance:1, bulkMid:true, midPlacement:{sink:MID_GRASS.sink,maxSlope:MID_GRASS.maxSlope,cardRate:.28,maxCards:1}, segments:6, normalBlend:.78, capacityFactor:3, uniforms,
    pack:(data,kind)=>packGrassLook(data,kind,ecology,quality),
    prepare(camera){cameraX=camera.position.x;cameraZ=camera.position.z;},
    accept(data,i,kind){
      if(kind!=='near')return true;
      const marker=data[i+11];
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
    setAdapt(step){uniforms.uGrassLookStep.value=step;},
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
    }
  };
}
