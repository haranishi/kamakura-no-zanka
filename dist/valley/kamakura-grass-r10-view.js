// W2c-15 variety: optional browser adapter; pure placement lives in r10.js.
import { grassR10Enabled, packGrassR10 } from './kamakura-grass-r10.js';
export function attachGrassR10(look,ecology,quality,search=globalThis.location?.search) {
  // Headless rule consumers without a URL keep their previous optional API.
  if(search===undefined||!grassR10Enabled(search))return look;
  const pack=look.pack,patch=look.patch,adapt=look.setAdapt,accept=look.accept,prepare=look.prepare;
  let cameraX=0,cameraZ=0;
  look.uniforms.uGrass10Strength={value:quality==='light'?0:1};
  look.pack=(data,kind)=>packGrassR10(pack(data,kind),kind,ecology,quality);
  look.prepare=function(camera){prepare.call(this,camera);cameraX=camera.position.x;cameraZ=camera.position.z;};
  look.accept=function(data,i,kind){
    if(kind==='near'&&quality!=='light'){
      const tag=(-data[i+11])%1,step=look.uniforms.uGrassLookStep.value;
      if(tag===.25&&(step>=2||Math.hypot(data[i]-cameraX,data[i+2]-cameraZ)>=7))return false;
      if(tag===.5&&step>=2)return false;
    }
    return accept.call(this,data,i,kind);
  };
  look.patch=function(shader,kind){patch.call(this,shader,kind);patchGrassR10(shader,kind,quality);};
  look.setAdapt=function(step){adapt.call(this,step);look.uniforms.uGrass10Strength.value=quality==='light'?0:step>=3?0:step>=2?.35:1;};
  return look;
}
export function patchGrassR10(shader,kind,quality) {
  if(kind==='mid') {
    // The old hook selects height again on GPU. Use the prepared height without
    // multiplying R4's growth a second time; retain its atlas, widths and fades.
    shader.vertexShader=shader.vertexShader.replace(/t\*\(grassHeight\+0\.12\)/g,'t*iShape.x')
      .replace('transformed.y*=mix(1.0,clamp(abs(iShape.z),.80,1.25),uGrass4Strength);','');
    return;
  }
  if(quality==='light')return;
  const declarations='uniform float uGrass10Strength; varying float vGrass10;';
  shader.vertexShader=shader.vertexShader.replace('#include <common>',`#include <common>\n${declarations}`)
    .replace('transformed = vec3(along.x*position.x*iShape.y*width*widen',`
      float grass10Type=floor(-iTip.x+.001);
      float grass10Slot=fract(-iTip.x);
      if(grass10Slot>.20&&grass10Slot<.30) alive*=(1.0-smoothstep(4.5,6.0,dd))*step(uGrassLookStep,1.0);
      // Flower stems widen with distance: the subpixel discard removes anything under 0.9 px, and a 0.09 stem is thinner than that
      // past 3 m, so the head floated. 0.18..0.45 stays visible out to the 12 m flower limit. Heads are a fifth smaller.
      if(grass10Type>1.5&&grass10Type<2.5) width=mix(.18+.27*smoothstep(1.5,12.0,dd),.80,smoothstep(.70,.84,t))*(1.0-smoothstep(.92,1.0,t));
      if(grass10Type>9.5) {
        float grass10Leaf=1.0-smoothstep(.0,1.0,t);
        float grass10Width=pow(max(.005,grass10Leaf),.65);
        if(grass10Type<10.5) grass10Width=pow(grass10Leaf,.45)*(.40+.60*abs(sin(t*25.132741)));
        else if(grass10Type<11.5) grass10Width=pow(grass10Leaf,.6)*(.65+.35*abs(sin(t*18.849556)));
        else if(grass10Type<13.5) grass10Width=mix(.07,.90,smoothstep(.55,.80,t))*(1.0-smoothstep(.85,1.0,t));
        else grass10Width=mix(.09,.90,smoothstep(.50,.72,t))*(1.0-smoothstep(.83,1.0,t));
        width=mix(pow(max(.005,1.0-t),.65),grass10Width,uGrass10Strength);
      }
      vGrass10=grass10Type;
      transformed = vec3(along.x*position.x*iShape.y*width*widen`)
    .replace(/vGrassColor = \(iTip.x < -1\.5 [^;]+;/,`
      vGrassColor=iColor*mix(.40,1.15,t)*mix(.85,1.15,iShape.w);
      if(iTip.x < -1.5) {
        vec3 grass10Head=iColor;
        if(iTip.x < -13.5) grass10Head=mix(vec3(.23,.19,.13),vec3(.42,.39,.30),fract(iRoot.w*.73));
        if(iTip.x < -11.5 && iTip.x > -13.5) grass10Head=vec3(.40,.40,.33);
        // Flower and plume colours belong to their heads; stems keep leaf pigment.
        if(iTip.x > -3.0 || iTip.x < -11.5) vGrassColor=mix(vec3(.11,.20,.045),grass10Head,smoothstep(.58,.80,t))*mix(.50,1.15,t)*mix(.85,1.15,iShape.w);
      }
    `);
  shader.fragmentShader=shader.fragmentShader.replace('#include <common>',`#include <common>\n${declarations}`)
    .replace('float grass4Tip=smoothstep(vGrass4.w,1.0,vGrassUV.y)',`
      float grass10TipShift=vGrass10>13.5?-.18:vGrass10>11.5?.08:vGrass10>9.5?.02:0.0;
      float grass10TipStart=clamp(vGrass4.w+grass10TipShift+.20*(vGrass4.y-.5),.45,.95);
      float grass4Tip=smoothstep(mix(vGrass4.w,grass10TipStart,uGrass10Strength),1.0,vGrassUV.y)`)
    .replace('diffuseColor.rgb *= vGrassColor;',`diffuseColor.rgb *= vGrassColor;
      // Equal-area root/tip variation is species-specific, not a second sky floor.
      float grass10Slope=vGrass10>13.5?.30:vGrass10>11.5?.12:vGrass10>9.5?-.12:0.0;
      diffuseColor.rgb*=1.0+grass10Slope*(vGrassUV.y-.5)*uGrass10Strength;`);
}
