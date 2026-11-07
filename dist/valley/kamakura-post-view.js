// W2c-9f: direct render -> HDR scene + five fullscreen passes, Kamakura only.
import * as THREE from 'three';
import { POST_DEFAULTS, postOptions, postRoute, bloomSizes, projectSun } from './kamakura-post.js';
const VERT = 'varying vec2 vUv; void main(){ vUv=position.xy*.5+.5; gl_Position=vec4(position.xy,0.,1.); }';
export const POST_SHADERS = {
  down: `varying vec2 vUv; uniform sampler2D tex; uniform vec2 delta; uniform float threshold;
    vec3 tap(float offset){ vec3 c=max(texture2D(tex,vUv+delta*offset).rgb,vec3(0.));
      float l=dot(c,vec3(.2126,.7152,.0722));
      return min(c,vec3(32.))*max(0.,l-threshold)/max(l,.00001); }
    void main(){ gl_FragColor=vec4(tap(0.)*.375+(tap(1.)+tap(-1.))*.25+(tap(2.)+tap(-2.))*.0625,1.); }`,
  combine: `varying vec2 vUv; uniform sampler2D tex0,tex1,tex2; uniform vec3 dy;
    vec3 vertical(sampler2D imageTex,float stepY){
      return texture2D(imageTex,vUv).rgb*.375+
        (texture2D(imageTex,vUv+vec2(0.,stepY)).rgb+texture2D(imageTex,vUv-vec2(0.,stepY)).rgb)*.25+
        (texture2D(imageTex,vUv+vec2(0.,2.*stepY)).rgb+texture2D(imageTex,vUv-vec2(0.,2.*stepY)).rgb)*.0625; }
    void main(){ gl_FragColor=vec4(vertical(tex0,dy.x)*.45+vertical(tex1,dy.y)*.35+vertical(tex2,dy.z)*.20,1.); }`,
  final: `varying vec2 vUv; uniform sampler2D sceneTex,bloomTex;
    uniform float bloomStrength,glareStrength,aspect,warmth,saturation,contrast,vignette;
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
      gl_FragColor=vec4(max(c,vec3(0.)),1.);
      #include <colorspace_fragment>
    }`,
};
const TONES = { none: THREE.NoToneMapping, aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping };
export function createKamakuraPost({ renderer, quality = 'standard', search = '', params = {}, sunDir }) {
  const options = postOptions(search), savedTone = renderer.toneMapping, savedExposure = renderer.toneMappingExposure;
  const exposure = params.postExposure ?? 1;
  let active = false, latched = false, disposed = false, targets = null, width = 0, height = 0;
  let scene, camera, mesh, geometry, down, combine, final;
  const size = new THREE.Vector2(), direction = new THREE.Vector3(), projected = { x: .5, y: .5, strength: 0 };
  function material(fragmentShader, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });
  }
  function prepare() {
    if (scene) return;
    geometry = new THREE.BufferGeometry(); geometry.setAttribute('position',new THREE.Float32BufferAttribute([-1,-1,0,3,-1,0,-1,3,0],3));
    down = material(POST_SHADERS.down,{ tex:{value:null},delta:{value:new THREE.Vector2()},threshold:{value:0} });
    combine = material(POST_SHADERS.combine,{ tex0:{value:null},tex1:{value:null},tex2:{value:null},dy:{value:new THREE.Vector3()} });
    final = material(POST_SHADERS.final,{
      sceneTex:{value:null},bloomTex:{value:null},toneMappingExposure:{value:exposure},toneMode:{value:['none','aces','neutral','agx'].indexOf(options.tone)},
      bloomStrength:{value:options.bloom ? (params.postBloom ?? .12) : 0},glareStrength:{value:0},sunUV:{value:new THREE.Vector2()},
      sunColor:{value:new THREE.Color(params.sunColor ?? '#fff1d6')},aspect:{value:1},warmth:{value:params.postWarmth ?? .008},
      saturation:{value:POST_DEFAULTS.saturation},contrast:{value:POST_DEFAULTS.contrast},vignette:{value:POST_DEFAULTS.vignette},
    });
    scene = new THREE.Scene(); camera = new THREE.Camera(); mesh = new THREE.Mesh(geometry,down); mesh.frustumCulled=false; scene.add(mesh);
  }
  function releaseTargets() { if (targets) { for (const target of targets) target.dispose(); targets=null; } width=height=0; }
  function resize() {
    if (!active || disposed) return;
    renderer.getDrawingBufferSize(size);
    const w=Math.max(1,size.x),h=Math.max(1,size.y);
    if (w===width && h===height) return;
    releaseTargets(); prepare(); width=w; height=h;
    const make=(x,y,main=false)=>new THREE.WebGLRenderTarget(x,y,{type:THREE.HalfFloatType,depthBuffer:main,samples:main?4:0});
    const levels=bloomSizes(w,h);
    targets=[make(w,h,true),...levels.map(([x,y])=>make(x,y)),make(...levels[0])];
    final.uniforms.sceneTex.value=targets[0].texture; final.uniforms.bloomTex.value=targets[4].texture;
    final.uniforms.aspect.value=w/h;
    for(let i=0;i<3;i++) combine.uniforms['tex'+i].value=targets[i+1].texture;
    combine.uniforms.dy.value.set(1/levels[0][1],1/levels[1][1],1/levels[2][1]);
  }
  function setAdapt(step) {
    if(disposed) return;
    if(step>=2) latched=true;
    active=postRoute(quality,step,options.post,latched);
    if(!active) releaseTargets();
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
      const previous=renderer.getRenderTarget(),autoClear=renderer.autoClear;
      try {
        renderer.autoClear=true; renderer.setRenderTarget(targets[0]); renderer.render(world,view);
        if(options.bloom){
          for(let i=0;i<3;i++){
            const input=targets[i]; down.uniforms.tex.value=input.texture;
            down.uniforms.delta.value.set(1/input.width,0); down.uniforms.threshold.value=i===0?POST_DEFAULTS.threshold:0;
            draw(down,targets[i+1]);
          }
          draw(combine,targets[4]);
        }
        view.updateMatrixWorld();
        if(sunDir) direction.copy(sunDir).transformDirection(view.matrixWorldInverse); else direction.set(0,0,1);
        projectSun(direction.x,direction.y,direction.z,sunDir?.y??-1,view.projectionMatrix.elements[0],view.projectionMatrix.elements[5],projected);
        final.uniforms.sunUV.value.set(projected.x,projected.y);
        final.uniforms.glareStrength.value=options.glare?projected.strength*(params.postGlare??.7):0;
        draw(final,previous);
      } finally {renderer.setRenderTarget(previous);renderer.autoClear=autoClear;}
    },
    dispose(){if(disposed)return;disposed=true;releaseTargets();geometry?.dispose();down?.dispose();combine?.dispose();final?.dispose();renderer.toneMapping=savedTone;renderer.toneMappingExposure=savedExposure;},
  };
}
