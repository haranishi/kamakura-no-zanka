// Valley water appearance copied unchanged in style; distance gate and standard fog added for Kamakura.
// Keep water.js independent. MeshStandardMaterial includes the installed atmosphere fog chunks.
import * as THREE from 'three';
import { shore2Enabled, SHORE_GLSL, bankCrossingDistance } from './kamakura-shore.js';
import { WATER_ALPHA } from './kamakura-fx.js';
export function buildKamakuraWater(prepared, { sunDir = new THREE.Vector3(.5, .17, .85), terrain = null, search = '', quality = 'standard' } = {}) {
  const shore2=shore2Enabled(search);
  const group = new THREE.Group(); group.name = 'kamakura-rivers';
  const uniforms = { uShore2:{value:+shore2},uRiverBands:{value:quality==='light'?1:2}, uTime: { value: 0 } };
  const material = new THREE.MeshStandardMaterial({ color: 0x23565c, roughness: 0.09, metalness: 0.0, transparent: true, opacity: 1, depthWrite: false, envMapIntensity: shore2?(quality==='light'?1.2:1.65):0.95 });
  material.fog = true;
  material.onBeforeCompile = shader => {
    shader.uniforms.uWaterAlpha = { value: new THREE.Vector3(WATER_ALPHA.shallow, WATER_ALPHA.deep, WATER_ALPHA.depth) };
    Object.assign(shader.uniforms,uniforms); shader.uniforms.uTime = uniforms.uTime; shader.uniforms.uWaterDistance = { value: prepared.policy.maxDistance }; shader.uniforms.SUN_DIR_W = { value: sunDir.clone().normalize() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 waterBanks; varying vec2 vWBanks; attribute float waterDepth; attribute float waterHalfWidth; varying float vWHalf; varying vec2 vWUv; varying vec3 vWPos; varying float vWDepth;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWBanks=waterBanks; vWHalf=waterHalfWidth; vWDepth = waterDepth; vWUv = uv; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        ${SHORE_GLSL}
        uniform float uRiverBands;varying float vWHalf;varying vec2 vWBanks;
        uniform vec3 uWaterAlpha; uniform float uWaterDistance; uniform float uTime; varying vec2 vWUv; varying vec3 vWPos; varying float vWDepth; uniform vec3 SUN_DIR_W;
        float w_hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float w_noise(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(w_hash(i), w_hash(i + vec2(1., 0.)), f.x), mix(w_hash(i + vec2(0., 1.)), w_hash(i + vec2(1.)), f.x), f.y); }
        float w_fbm(vec2 p) { float s = 0.0, a = 0.5; for (int i = 0; i < 4; i++) { s += a * w_noise(p); p = p * 2.03 + 11.7; a *= 0.5; } return s; }
        float w_height(vec2 p) { return w_fbm(p * vec2(0.9, 0.55) + vec2(0.0, -uTime * 0.55)) + 0.5 * w_fbm(p * 2.1 + vec2(uTime * 0.18, -uTime * 0.9)); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        float waterDistance = length(vWPos.xz - cameraPosition.xz);
        if (waterDistance >= uWaterDistance) discard;
        diffuseColor.a *= 1.0 - smoothstep(uWaterDistance - 128.0, uWaterDistance, waterDistance);
        float edge = abs(vWUv.x);
        // W2c-9d: uniform opacity -> depth/edge transparency, retain the existing distance and bank fades.
        diffuseColor.a *= mix(uWaterAlpha.x, uWaterAlpha.y, (1.0-clamp(edge,0.0,1.0))*clamp(vWDepth/uWaterAlpha.z,0.0,1.0));
        vec3 deep = vec3(0.035, 0.12, 0.15), shallow = vec3(0.14, 0.27, 0.26);
        diffuseColor.rgb = mix(deep, shallow, smoothstep(0.35, 1.0, edge));
        // W2c-9r2 shore: lower diffuse wash / gentler ripples restore PMREM cloud contrast.
        // W2c-9r1 shore: normalized channel edge -> shared bank distance in metres.
        float bankD=max(0.0,min(vWBanks.x+vWUv.x*vWHalf,vWBanks.y-vWUv.x*vWHalf));
        if(uShore2>.5)diffuseColor.rgb=mix(vec3(.11,.14,.12),deep,smoothstep(0.0,5.0,bankD));
        float foam = smoothstep(0.80, 0.98, edge) * smoothstep(0.35, 0.8, w_fbm(vWPos.xz * 1.6 + vec2(0.0, -uTime * 0.6)));
        float streak = smoothstep(0.72, 0.9, w_fbm(vWPos.xz * vec2(2.4, 0.7) + vec2(0.0, -uTime * 0.8))) * 0.35;
        // 白波：流れの筋に沿った細い泡の帯を、中ほどにも散らす（平らな灰青の面に見えた）。瀬の位置は川に沿った低周波のむらで決める
        float rapid = smoothstep(0.55, 0.8, w_fbm(vec2(vWUv.y * 0.035, 3.7))) * smoothstep(0.35, 0.7, w_fbm(vWPos.xz * vec2(3.6, 1.1) + vec2(0.0, -uTime * 1.3))) * (1.0 - smoothstep(0.75, 1.0, edge)) * 0.75;
        if(uShore2>.5){
          foam=0.0;rapid=0.0;streak=0.0;
          if(uRiverBands>.5)foam=riverBankFoam(bankD,vWPos.xz,uTime,length(fwidth(vWPos.xz)));
          if(uRiverBands>1.5)foam+=.22*riverBankFoam(bankD-.7,vWPos.xz+vec2(13.7,8.3),uTime,length(fwidth(vWPos.xz)));
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.9, 0.88), clamp(foam + rapid + streak * (1.0 - edge), 0.0, 0.88));
        diffuseColor.a *= uShore2>.5?smoothstep(0.0,.18,bankD):1.0-smoothstep(0.93,1.0,edge);`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
        {
          vec2 p = vWPos.xz; float e = 0.16;
          float h0 = w_height(p), hx = w_height(p + vec2(e, 0.0)), hz = w_height(p + vec2(0.0, e));
          vec3 nw = normalize(vec3((h0 - hx) * (uShore2>.5?.45:.9), 1.0, (h0 - hz) * (uShore2>.5?.45:.9)));
          normal = normalize(mix(normal, normalize((viewMatrix * vec4(nw, 0.0)).xyz), uShore2>.5?.65:.85));
        }`)
      // 夕日の照り返し：太陽の方向へ細い光の筋が水面に伸びる（波の法線で割れる）。見る角度が浅いほど強い
      .replace('#include <opaque_fragment>', `
        {
          vec3 vdir = normalize(vWPos - cameraPosition);
          vec3 wn = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
          vec3 rf = reflect(vdir, wn);
          float glint = pow(max(dot(rf, SUN_DIR_W), 0.0), 90.0) * 3.0 + pow(max(dot(rf, SUN_DIR_W), 0.0), 14.0) * 0.35;
          outgoingLight += vec3(1.0, 0.78, 0.55) * glint * (1.0 - abs(vdir.y));
        }
        #include <opaque_fragment>`);
  };
  material.customProgramCacheKey = () => 'kamakura-water-9r2';
  let disposed = false,bankCursor=0,bankBudget=quality==='light'?.15:.35;
  const bankJobs=[];
  function dispose() {
    if (disposed) return; disposed = true;
    for (const mesh of group.children) mesh.geometry.dispose();
    group.clear(); group.removeFromParent(); material.dispose();bankJobs.length=0;
  }
  try {
    for (const chunk of prepared.chunks) {
      const geometry = new THREE.BufferGeometry();
      // Attach before filling so that partial construction is also owned by dispose().
      const mesh = new THREE.Mesh(geometry, material); group.add(mesh);
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(chunk.positions, 3));
      const banks=new Float32Array(chunk.positions.length/3*2);
      const widths=new Float32Array(chunk.positions.length/3);
      const depths = new Float32Array(chunk.positions.length / 3);
      // Ribbon vertices are stored in left/right pairs, so sample the channel bed once per pair.
      for (let i = 0; i < depths.length; i += 2) {
        const k = i * 3, x = (chunk.positions[k] + chunk.positions[k + 3]) / 2, z = (chunk.positions[k + 2] + chunk.positions[k + 5]) / 2;
        widths[i]=widths[i+1]=Math.hypot(chunk.positions[k]-chunk.positions[k+3],chunk.positions[k+2]-chunk.positions[k+5])/2;
        banks[i*2]=banks[i*2+1]=banks[(i+1)*2]=banks[(i+1)*2+1]=widths[i];
        depths[i] = depths[i + 1] = terrain ? Math.max(0, chunk.positions[k + 1] - terrain.heightAt(x, z)) : .5;
      }
      geometry.setAttribute('waterBanks',new THREE.Float32BufferAttribute(banks,2));
      geometry.setAttribute('waterHalfWidth',new THREE.Float32BufferAttribute(widths,1));
      geometry.setAttribute('waterDepth', new THREE.Float32BufferAttribute(depths, 1));
      geometry.setAttribute('uv', new THREE.Float32BufferAttribute(chunk.uvs, 2));
      geometry.setIndex(chunk.indices); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
      mesh.updateMatrix(); mesh.matrixAutoUpdate = false;
      if(shore2&&terrain)bankJobs.push({geometry,positions:chunk.positions,banks:geometry.attributes.waterBanks.array,widths,cursor:0});
      mesh.name = 'kamakura-water'; mesh.renderOrder = 2; mesh.frustumCulled = true;
    }
    return { group, material, uniforms, setAdapt(step){bankBudget=step>=3?0:quality==='light'||step>=2?.15:.35;material.envMapIntensity=!shore2||step>=3?.95:quality==='light'||step>=2?1.2:1.65;uniforms.uRiverBands.value=step>=3?0:quality==='light'||step>=2?1:2;}, get preparedBanks(){return bankCursor>=bankJobs.length;}, update(time) {
      if(disposed)return;uniforms.uTime.value=time;if(bankCursor>=bankJobs.length||bankBudget===0)return;
      // W2c-9r2 shore: avoid blocking startup on all cross-sections; neutral nominal
      // widths render immediately, each completed chunk publishes once, no frame allocations.
      const start=performance.now();
      for(let n=0;n<64&&bankCursor<bankJobs.length&&performance.now()-start<bankBudget;n++){
        const job=bankJobs[bankCursor],i=job.cursor,k=i*3,p=job.positions;
        const x=(p[k]+p[k+3])/2,z=(p[k+2]+p[k+5])/2,half=job.widths[i];
        for(let side=0;side<2;side++){
          const nx=(p[k+side*3]-x)/half,nz=(p[k+side*3+2]-z)/half;
          const reach=bankCrossingDistance(terrain,x,z,p[k+1],nx,nz,half);
          job.banks[i*2+side]=job.banks[(i+1)*2+side]=reach;
        }
        job.cursor+=2;
        if(job.cursor===job.widths.length){job.geometry.attributes.waterBanks.needsUpdate=true;bankCursor++;}
      }
    }, dispose };
  } catch (error) { dispose(); throw error; }
}
