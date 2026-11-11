// W2c-9f: direct render -> HDR scene + five fullscreen passes, Kamakura only.
import * as THREE from 'three';
import { POST_DEFAULTS, postOptions, postRoute, bloomSizes, projectSun, bloomCap, neutralToneChunk, shadeSettings, SHADE_GLSL } from './kamakura-post.js';
import { atmosphereOptions, isEveningLike, DUSK } from './kamakura-atmosphere.js';
import { lightSettings, shaftVisibility, advanceCloudTime, cloudHigh, lightFinalShader, SHAFT_SHADERS } from './kamakura-sky-fx.js';
import { farShadowEnabled } from './kamakura-far-shadow.js';
import { createFarShadowView } from './kamakura-far-shadow-view.js';
import { MIST, MIST_GLSL, mistShader, createMistField, mistStrength } from './kamakura-mist.js';
const VERT = 'varying vec2 vUv; void main(){ vUv=position.xy*.5+.5; gl_Position=vec4(position.xy,0.,1.); }';
export const POST_SHADERS = {
  down: `varying vec2 vUv; uniform sampler2D tex; uniform vec2 delta; uniform float threshold, liftCap;
    vec3 tap(float offset){ vec3 c=max(texture2D(tex,vUv+delta*offset).rgb,vec3(0.));
      float l=dot(c,vec3(.2126,.7152,.0722));
      // W2c-9r1 light: shoulder on the first extraction only; retain legacy A/B.
      float excess=max(0.,l-threshold);
      if(liftCap>0.) return c/max(max(c.r,c.g),max(c.b,.00001))*(liftCap*excess/(liftCap+excess));
      return min(c,vec3(32.))*excess/max(l,.00001); }
    void main(){ gl_FragColor=vec4(tap(0.)*.375+(tap(1.)+tap(-1.))*.25+(tap(2.)+tap(-2.))*.0625,1.); }`,
  combine: `varying vec2 vUv; uniform sampler2D tex0,tex1,tex2; uniform vec3 dy;
    vec3 vertical(sampler2D imageTex,float stepY){
      return texture2D(imageTex,vUv).rgb*.375+
        (texture2D(imageTex,vUv+vec2(0.,stepY)).rgb+texture2D(imageTex,vUv-vec2(0.,stepY)).rgb)*.25+
        (texture2D(imageTex,vUv+vec2(0.,2.*stepY)).rgb+texture2D(imageTex,vUv-vec2(0.,2.*stepY)).rgb)*.0625; }
    void main(){ gl_FragColor=vec4(vertical(tex0,dy.x)*.45+vertical(tex1,dy.y)*.35+vertical(tex2,dy.z)*.20,1.); }`,
  final: `varying vec2 vUv; uniform sampler2D sceneTex,bloomTex;
    uniform float bloomStrength,glareStrength,aspect,warmth,saturation,contrast,vignette;
    uniform float shadeStrength,shadeFloor,shadeDusk;
    ${SHADE_GLSL}
    uniform vec2 sunUV; uniform vec3 sunColor; uniform int toneMode;
    #include <tonemapping_pars_fragment>
    void main(){
      vec3 c=max(texture2D(sceneTex,vUv).rgb,vec3(0.));
      if(bloomStrength>0.) c+=texture2D(bloomTex,vUv).rgb*bloomStrength;
      vec2 d=(vUv-sunUV)*vec2(aspect,1.); float r2=dot(d,d);
      float halo=exp(-r2/ .0018)*.65+exp(-r2/ .018)*.16+exp(-r2/ .22)*.025;
      float streak=exp(-d.y*d.y/ .000018)*exp(-abs(d.x)*9.)*.025;
      c+=sunColor*(halo+streak)*glareStrength;
      if(toneMode==1) c=ACESFilmicToneMapping(c);
      else if(toneMode==2) c=NeutralToneMapping(c);
      else if(toneMode==3) c=AgXToneMapping(c);
      else c*=toneMappingExposure;
      c+=vec3(warmth,0.,-warmth)*c*max(vec3(1.)-c,vec3(0.));
      float l=dot(c,vec3(.2126,.7152,.0722)); c=mix(vec3(l),c,saturation);
      vec3 shaped=pow(max(c,vec3(0.)),vec3(contrast));
      c=shaped/max(shaped+pow(max(vec3(1.)-c,vec3(0.)),vec3(contrast)),vec3(.00000001));
      vec2 edge=vUv-.5; c*=1.-vignette*smoothstep(.12,.5,dot(edge,edge));
      c=kzShade(c,shadeStrength,shadeFloor,shadeDusk);
      gl_FragColor=vec4(max(c,vec3(0.)),1.);
      #include <colorspace_fragment>
    }`,
};
const TONES = { none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping };
export function createKamakuraPost({ renderer, quality = 'standard', search = '', params = {}, sunDir, disc = null, now = () => performance.now(), cloudDirection = [1, 0], terrain = null, farSources = null }) {
  const options = postOptions(search), savedTone = renderer.toneMapping, savedExposure = renderer.toneMappingExposure;
  options.farshadow = !!(terrain && farSources && sunDir) && farShadowEnabled(search);
  const farMode=new URLSearchParams(search).get('postdebug');
  if(farMode==='farshadow'||farMode==='farshadowmap')options.postdebug=farMode;
  options.mist = options.mist && !!terrain;
  const shade = shadeSettings(search, params), light = lightSettings(isEveningLike(atmosphereOptions(search).time) ? 'evening' : atmosphereOptions(search).time);
  const glareDir = disc ? new THREE.Vector3(...disc.dir) : sunDir;
  const needsDepth = options.shafts || options.cloud || options.mist || options.farshadow;
  let farShadow=null,farAdapt=0;
  let cloudTime = 0, lastTime = null, shaftStrength = 0;
  const debugLight = () => ({ shafts: { active: active && shaftStrength > 0, strength: active ? shaftStrength : 0 },
    cloud: { strength: active && options.cloud ? light.cloud*highCloud.strength : 0, time: cloudTime }, depth: !!targets?.[0].depthTexture,
    sun: { x: projected.x, y: projected.y, strength: projected.strength } });
  const debug = new URLSearchParams(search).get('debug') === '1';
  const inheritedAir = debug ? globalThis.__kzAir : null;
  const air = inheritedAir ? inheritedAir() : { flying:false, shadow:{size:0,texel:0,centerDistance:0,soft:false,bias:0}, mist:{}, cloud:{} };
  const debugAir = () => air;
  if (debug) { globalThis.__kzLight = debugLight; if (!inheritedAir) globalThis.__kzAir = debugAir; }
  Object.assign(air.mist,{ready:false,enabled:false,strength:0,cells:0});
  const highCloud = {scale:1,strength:1,height:0};
  Object.assign(air.cloud,{scale:1,strength:0,height:0});
  let valleyField=null, mistTexture=null, firstMistFrame=true;
  const mistValue=(atmosphereOptions(search).time === 'dusk' ? DUSK.postMist : mistStrength(atmosphereOptions(search).time));
  const exposure = params.postExposure ?? 1, bloomCapValue = bloomCap(search);
  // W2c-10 grade: Neutral's dark offset, scaled (URL > time-of-day preset > default). The chunk is global, so it is patched before any program
  // compiles (this runs before the first render) and put back on dispose; both the final pass and the no-post route include it.
  const toe = options.toe ?? params.postToe ?? POST_DEFAULTS.toe, savedToneChunk = THREE.ShaderChunk.tonemapping_pars_fragment;
  THREE.ShaderChunk.tonemapping_pars_fragment = neutralToneChunk(savedToneChunk, toe);
  let active = false, latched = false, disposed = false, targets = null, width = 0, height = 0;
  let scene, camera, mesh, geometry, down, combine, final, shaftMask, shaftBlur;
  const size = new THREE.Vector2(), direction = new THREE.Vector3(), projected = { x: .5, y: .5, strength: 0 };
  function material(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  }
  function prepare() {
    if (scene) return;
    geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    down = material(POST_SHADERS.down,{ tex:{value:null},delta:{value:new THREE.Vector2()},threshold:{value:0},liftCap:{value:0} });
    combine = material(POST_SHADERS.combine,{ tex0:{value:null},tex1:{value:null},tex2:{value:null},dy:{value:new THREE.Vector3()} });
    final = material(lightFinalShader(POST_SHADERS.final, options).replace(MIST_GLSL,mistShader(terrain?.meta?.mist)),{
      shadeStrength:{value:shade.strength},shadeFloor:{value:shade.floor},shadeDusk:{value:shade.evening?1:0},
      sceneTex:{value:null},bloomTex:{value:null},toneMappingExposure:{value:exposure},toneMode:{value:['none','aces','neutral','agx'].indexOf(options.tone)},
      bloomStrength:{value:options.bloom ? (params.postBloom ?? .12) : 0},glareStrength:{value:0},sunUV:{value:new THREE.Vector2()},
      sunColor:{value:new THREE.Color(params.sunColor ?? '#fff1d6')},aspect:{value:1},warmth:{value:params.postWarmth ?? .008},
      saturation:{value:POST_DEFAULTS.saturation},contrast:{value:POST_DEFAULTS.contrast},vignette:{value:POST_DEFAULTS.vignette},
    });
    if(options.farshadow){
      farShadow=createFarShadowView({THREE,renderer,terrain,sources:farSources,sunDir,params,time:atmosphereOptions(search).time,search,now});
      farShadow.setAdapt(farAdapt);
      Object.assign(final.uniforms,farShadow.uniforms);
    }
    if (needsDepth) Object.assign(final.uniforms, {
      depthTex:{value:null},inverseProjection:{value:new THREE.Matrix4()},cameraWorld:{value:new THREE.Matrix4()},viewFar:{value:10000},
    });
    if (options.cloud) Object.assign(final.uniforms, {
      lightDirection:{value:sunDir ? sunDir.clone().normalize() : new THREE.Vector3(0,1,0)},
      cloudDirection:{value:new THREE.Vector2(...cloudDirection).normalize()},cloudTime:{value:0},cloudStrength:{value:light.cloud},
    });
    if(options.cloud && options.cloudhigh) final.uniforms.cloudScale={value:1};
    if(options.mist) {
      const horizon=new THREE.Color(params.horizon ?? params.fogColor);
      const cool=new THREE.Color(params.hazeCool ?? params.fogColor),warm=new THREE.Color(params.hazeWarm ?? params.fogColor);
      const luminance=c=>.2126*c.r+.7152*c.g+.0722*c.b;
      const brightness=luminance(horizon)*MIST.brightness;
      cool.multiplyScalar(brightness/Math.max(.000001,luminance(cool)));
      warm.multiplyScalar(brightness/Math.max(.000001,luminance(warm)));
      Object.assign(final.uniforms,{
        mistField:{value:null},mistBounds:{value:new THREE.Vector4(0,0,1,1)},mistPixels:{value:new THREE.Vector2(1,1)},
        mistWind:{value:new THREE.Vector2(...cloudDirection).normalize()},mistTime:{value:0},mistReady:{value:0},mistStrength:{value:mistValue},
        mistCool:{value:cool},mistWarm:{value:warm},mistSun:{value:sunDir ? sunDir.clone().normalize() : new THREE.Vector3(0,1,0)},mistHazeExp:{value:params.hazeExp ?? 4},
      });
    }
    if (options.shafts) {
      shaftMask=material(SHAFT_SHADERS.mask,{depthTex:{value:null},sunUV:{value:final.uniforms.sunUV.value},depthPixel:{value:new THREE.Vector2()},aspect:{value:1}});
      shaftBlur=material(SHAFT_SHADERS.radial,{maskTex:{value:null},sunUV:{value:final.uniforms.sunUV.value}});
      Object.assign(final.uniforms,{shaftTex:{value:null},shaftStrength:{value:0}});
    }
    scene = new THREE.Scene(); camera = new THREE.Camera(); mesh = new THREE.Mesh(geometry,down); mesh.frustumCulled=false; scene.add(mesh);
  }
  function releaseMist() {
    mistTexture?.dispose(); mistTexture=null; valleyField=null;
    air.mist.ready=false; air.mist.enabled=false; air.mist.strength=0;
    if(final && options.mist) { final.uniforms.mistField.value=null; final.uniforms.mistReady.value=0; }
  }
  function advanceMist() {
    if(!options.mist)return;
    // One complete scene is rendered before any terrain field work starts.
    if(firstMistFrame){firstMistFrame=false;return;}
    if(!valleyField){valleyField=createMistField(terrain);air.mist.cells=valleyField.cells;}
    const start=now();
    for(let work=0;work<MIST.cellsPerFrame && !valleyField.ready;work+=MIST.batchCells){
      valleyField.step(MIST.batchCells);
      if(now()-start>=MIST.budgetMs)break;
    }
    if(valleyField.ready && !mistTexture){
      mistTexture=new THREE.DataTexture(valleyField.data,valleyField.width,valleyField.height,THREE.RGFormat,THREE.FloatType);
      mistTexture.minFilter=mistTexture.magFilter=THREE.LinearFilter; mistTexture.generateMipmaps=false;
      mistTexture.needsUpdate=true;
      const u=final.uniforms;
      u.mistField.value=mistTexture;u.mistReady.value=1;
      u.mistBounds.value.set(valleyField.minX,valleyField.minZ,(valleyField.width-1)*valleyField.cell,(valleyField.height-1)*valleyField.cell);
      u.mistPixels.value.set(1/valleyField.width,1/valleyField.height);
      air.mist.ready=true;
    }
    air.mist.enabled=air.mist.ready;air.mist.strength=air.mist.ready?mistValue:0;
  }
  function releaseTargets() {
    if (targets) {
      for (const target of targets) {
        // Renderer also disposes attached depth on target disposal: detach to own exactly one event.
        const depth = target.depthTexture; target.depthTexture = null; target.dispose(); depth?.dispose();
      }
      targets=null;
      if(final) { final.uniforms.sceneTex.value=null; final.uniforms.bloomTex.value=null;
        if(needsDepth) final.uniforms.depthTex.value=null;
        if(options.shafts) { final.uniforms.shaftTex.value=null; shaftMask.uniforms.depthTex.value=null; shaftBlur.uniforms.maskTex.value=null; }
      }
    }
    width=height=0;
  }
  function resize() {
    if (!active || disposed) return;
    renderer.getDrawingBufferSize(size);
    const w=Math.max(1,size.x),h=Math.max(1,size.y);
    if (w===width && h===height) return;
    releaseTargets(); prepare(); width=w; height=h;
    const make=(x,y,main=false)=>new THREE.WebGLRenderTarget(x,y,{type:THREE.HalfFloatType,depthBuffer:main,samples:main?4:0});
    const levels=bloomSizes(w,h);
    targets=[make(w,h,true),...levels.map(([x,y])=>make(x,y)),make(...levels[0])];
    if(needsDepth) {
      targets[0].depthTexture=new THREE.DepthTexture(w,h,THREE.FloatType);
      final.uniforms.depthTex.value=targets[0].depthTexture;
    }
    if(options.shafts) {
      const sw=Math.max(1,Math.floor(w/4)),sh=Math.max(1,Math.floor(h/4));
      targets.push(make(sw,sh),make(sw,sh));
      shaftMask.uniforms.depthTex.value=targets[0].depthTexture;
      shaftMask.uniforms.depthPixel.value.set(1/w,1/h); shaftMask.uniforms.aspect.value=w/h;
      shaftBlur.uniforms.maskTex.value=targets[5].texture; final.uniforms.shaftTex.value=targets[6].texture;
    }
    final.uniforms.sceneTex.value=targets[0].texture; final.uniforms.bloomTex.value=targets[4].texture;
    final.uniforms.aspect.value=w/h;
    for(let i=0;i<3;i++) combine.uniforms['tex'+i].value=targets[i+1].texture;
    combine.uniforms.dy.value.set(1/levels[0][1],1/levels[1][1],1/levels[2][1]);
  }
  function setAdapt(step) {
    if(disposed) return;
    if(step>=2) latched=true;
    farAdapt=step;farShadow?.setAdapt(step);
    active=postRoute(quality,step,options.post,latched);
    if(!active) { releaseTargets(); releaseMist(); farShadow?.dispose(); lastTime=null; shaftStrength=0; air.cloud.strength=0; }
    renderer.toneMapping=active?THREE.NoToneMapping:TONES[options.tone]; renderer.toneMappingExposure=exposure;
  }
  function draw(mat,target) { mesh.material=mat; renderer.setRenderTarget(target); renderer.render(scene,camera); }
  setAdapt(0);
  return {
    get active(){return active;}, get targets(){return targets;}, resize,setAdapt,
    render(world,view) {
      if(disposed) return;
      if(!active){renderer.render(world,view);return;}
      resize();
      const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear,shadowEnabled=renderer.shadowMap?.enabled;
      try {
        farShadow?.update(view);
        if(farShadow?.ready && farShadow.uniforms.farFlying.value>.5 && renderer.shadowMap)renderer.shadowMap.enabled=false;
        renderer.autoClear=true; renderer.setRenderTarget(targets[0]); renderer.render(world,view);
        if(renderer.shadowMap)renderer.shadowMap.enabled=shadowEnabled;
        if(options.bloom){
          for(let i=0;i<3;i++){
            const input=targets[i]; down.uniforms.tex.value=input.texture;
            down.uniforms.delta.value.set(1/input.width,0); down.uniforms.threshold.value=i===0?POST_DEFAULTS.threshold:0;
            down.uniforms.liftCap.value=i===0?bloomCapValue:0;
            draw(down,targets[i+1]);
          }
          draw(combine,targets[4]);
        }
        view.updateMatrixWorld();
        if(glareDir) direction.copy(glareDir).transformDirection(view.matrixWorldInverse); else direction.set(0,0,1);
        projectSun(direction.x,direction.y,direction.z,disc?.enabled === false ? -1 : glareDir?.y??-1,view.projectionMatrix.elements[0],view.projectionMatrix.elements[5],projected);
        final.uniforms.sunUV.value.set(projected.x,projected.y);
        if(needsDepth) {
          final.uniforms.inverseProjection.value.copy(view.projectionMatrixInverse);
          final.uniforms.cameraWorld.value.copy(view.matrixWorld); final.uniforms.viewFar.value=view.far ?? 10000;
        }
        if(options.cloud || options.mist) {
          const stamp=now();
          if(lastTime !== null) cloudTime=advanceCloudTime(cloudTime,stamp-lastTime);
          lastTime=stamp;
        }
        if(options.cloud) {
          if(options.cloudhigh)cloudHigh(terrain ? Math.max(0,view.position.y-terrain.heightAt(view.position.x,view.position.z)) : 0,options.cloudhigh,highCloud);
          final.uniforms.cloudTime.value=cloudTime;
          final.uniforms.cloudStrength.value=light.cloud*highCloud.strength;
          if(options.cloudhigh)final.uniforms.cloudScale.value=highCloud.scale;
          air.cloud.scale=highCloud.scale;air.cloud.strength=final.uniforms.cloudStrength.value;air.cloud.height=highCloud.height;
        }
        if(options.mist) { advanceMist(); final.uniforms.mistTime.value=cloudTime; }
        if(options.shafts) {
          shaftStrength=light.shafts*shaftVisibility(projected.x,projected.y,projected.strength);
          final.uniforms.shaftStrength.value=shaftStrength;
          if(shaftStrength>0) { draw(shaftMask,targets[5]); draw(shaftBlur,targets[6]); }
        }
        final.uniforms.glareStrength.value=options.glare?projected.strength*(params.postGlare??.7):0;
        draw(final,previous);
        farShadow?.advance(world);
      } finally {renderer.setRenderTarget(previous);renderer.autoClear=autoClear;if(renderer.shadowMap)renderer.shadowMap.enabled=shadowEnabled;}
    },
    dispose(){if(disposed)return;disposed=true;releaseTargets();releaseMist();farShadow?.dispose();geometry?.dispose();down?.dispose();combine?.dispose();final?.dispose();shaftMask?.dispose();shaftBlur?.dispose();if(debug && globalThis.__kzLight===debugLight)delete globalThis.__kzLight;if(debug && !inheritedAir && globalThis.__kzAir===debugAir)delete globalThis.__kzAir;renderer.toneMapping=savedTone;THREE.ShaderChunk.tonemapping_pars_fragment=savedToneChunk;renderer.toneMappingExposure=savedExposure;},
  };
}
