// W2c-9d3: blue slivers -> thick olive/silver bodies, 60 triangles, opaque depth haze.
import * as THREE from 'three';
import { fishPigment, FISH_WATER, FISH_BED } from './kamakura-fish.js';
export function buildFishView(state) {
  const geometry = new THREE.BufferGeometry(), vertices = [], colors = [], indices = [];
  for (const [z, width, height] of [[-.5,.012,.30],[-.36,.035,.05],[-.24,.10,.11],[-.05,.19,.17],[.18,.20,.17],[.38,.12,.11],[.5,.025,.045]]) {
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2, top = Math.cos(a) * .5 + .5;
      vertices.push(Math.sin(a) * width, Math.cos(a) * height, z);
      for (let c = 0; c < 3; c++) colors.push(fishPigment(c, top));
    }
  }
  for (let k = 0; k < 6; k++) for (let i = 0; i < 4; i++) { const a = k * 4 + i, b = k * 4 + (i + 1) % 4; indices.push(a,b,a+4,b,b+4,a+4); }
  indices.push(0,2,1,0,3,2,24,25,26,24,26,27);
  for (let i = 0; i < indices.length; i += 3) { const b = indices[i+1]; indices[i+1] = indices[i+2]; indices[i+2] = b; }
  // Dorsal and paired pectoral fins; both faces explicit, still a single opaque draw.
  for (const fin of [[[0,.16,-.15],[0,.30,-.10],[0,.16,.19]], [[-.12,0,.14],[-.29,-.04,-.02],[-.16,0,-.1]], [[.12,0,.14],[.29,-.04,-.02],[.16,0,-.1]], [[0,0,-.5],[0,.22,-.44],[0,-.22,-.44]]]) {
    const n = vertices.length / 3; for (const v of fin) { vertices.push(...v); for (let c=0;c<3;c++) colors.push(fishPigment(c,.85)); }
    indices.push(n,n+1,n+2,n+2,n+1,n);
  }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices,3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors,3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(state.fish.length),1);
  const depth = new THREE.InstancedBufferAttribute(new Float32Array(state.fish.length),1);
  const alpha = new THREE.InstancedBufferAttribute(new Float32Array(state.fish.length),1);
  alpha.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('fishAlpha',alpha);
  phase.setUsage(THREE.DynamicDrawUsage); depth.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('fishPhase',phase); geometry.setAttribute('fishDepth',depth);
  // Unlit pigment keeps the back dark under direct sun as well as through the river.
  const material = new THREE.MeshBasicMaterial({vertexColors:true}); material.fog = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float fishAlpha; varying float vFishAlpha; attribute float fishPhase; attribute float fishDepth; varying float vFishDepth; varying float vFishTop;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFishAlpha=fishAlpha; vFishDepth=fishDepth; vFishTop=step(-0.001,position.y); transformed.x += sin(fishPhase + position.z * 8.0) * pow(max(0.0,0.4-position.z),2.0)*0.13;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFishAlpha; varying float vFishDepth; varying float vFishTop;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec3 fishWater = vec3(${FISH_WATER.join(',')});
        // W2c-9d4: opaque dither fade keeps one draw and correct water ordering.
        if(fract(sin(dot(gl_FragCoord.xy,vec2(12.9898,78.233)))*43758.5453)>vFishAlpha) discard;
        vec3 fishBed = vec3(${FISH_BED.join(',')});
        diffuseColor.rgb = mix(diffuseColor.rgb, mix(fishWater,fishBed,0.45), clamp(0.25+0.6*vFishDepth,0.25,0.55));
        float fishLum = dot(diffuseColor.rgb,vec3(0.2126,0.7152,0.0722));
        float backLimit = dot(fishWater,vec3(0.2126,0.7152,0.0722))-0.04;
        diffuseColor.rgb *= mix(1.0,min(1.0,backLimit/max(fishLum,0.0001)),smoothstep(0.75,1.0,vFishTop));`);
  };
  material.customProgramCacheKey = () => 'kamakura-fish-9d4';
  const mesh = new THREE.InstancedMesh(geometry,material,state.fish.length); mesh.name='kamakura-fish'; mesh.count=0; mesh.renderOrder=1;
  mesh.frustumCulled=false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const obj=new THREE.Object3D(),tint=new THREE.Color(); let disposed=false;
  mesh.setColorAt(0,tint);
  return {mesh,update() {
    if(disposed)return; mesh.count=state.count;
    for(let i=0;i<state.count;i++) {
      const f=state.fish[i];obj.position.set(f.x,f.y,f.z);obj.rotation.set(f.pitch,f.yaw,f.roll);obj.scale.setScalar(f.size);obj.updateMatrix();mesh.setMatrixAt(i,obj.matrix);
      alpha.array[i]=f.alpha;phase.array[i]=f.phase;depth.array[i]=f.depth;
      tint.setRGB(f.variation,f.variation*(f.big?.94:1),f.variation*(f.big?.85:1));mesh.setColorAt(i,tint);
    }
    mesh.instanceMatrix.needsUpdate=true;alpha.needsUpdate=true;phase.needsUpdate=true;depth.needsUpdate=true;mesh.instanceColor.needsUpdate=true;
  },dispose(){if(disposed)return;disposed=true;mesh.removeFromParent();mesh.dispose();geometry.dispose();material.dispose();}};
}
