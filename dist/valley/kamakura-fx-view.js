// W2c-9d: pooled contacts and fish, three bounded draws. No textures or external assets.
import * as THREE from 'three';
import { fxOptions, createFxState } from './kamakura-fx.js';
import { prepareFishRivers, prepareFishRiverSteps, createFishState } from './kamakura-fish.js';
import { buildFishView } from './kamakura-fish-view.js';
function boards(limit, ring) {
  const geometry = new THREE.PlaneGeometry(1, 1), alpha = new THREE.InstancedBufferAttribute(new Float32Array(limit), 1), wake = new THREE.InstancedBufferAttribute(new Float32Array(limit), 1);
  alpha.setUsage(THREE.DynamicDrawUsage); wake.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('fxAlpha', alpha); geometry.setAttribute('fxWake', wake);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }); material.fog = true; material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float fxAlpha; attribute float fxWake; varying float vFxAlpha; varying float vFxWake; varying vec2 vFxUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxAlpha=fxAlpha; vFxWake=fxWake; vFxUv=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vFxAlpha; varying float vFxWake; varying vec2 vFxUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = (vFxUv - 0.5) * 2.0;
        float d = ${ring ? 'abs(length(p) - .82)' : 'length(p)'};
        float mask = ${ring ? '1.0-smoothstep(.025,.11,d)' : '1.0-smoothstep(.15,1.0,d)'};
        ${ring ? 'if(vFxWake > .5) mask = smoothstep(.1,.35,p.y) * (1.0-smoothstep(.08,.2,abs(abs(p.x)-p.y*.65))) * (1.0-smoothstep(.8,1.0,p.y));' : ''}
        diffuseColor.a *= mask * vFxAlpha; if(diffuseColor.a < .003) discard;`);
  };
  material.customProgramCacheKey = () => ring ? 'kamakura-fx-ring-v1' : 'kamakura-fx-drop-v1';
  const mesh = new THREE.InstancedMesh(geometry, material, limit); mesh.count = 0; mesh.renderOrder = ring ? 3 : 4; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, new THREE.Color());
  return { mesh, geometry, material, alpha, wake };
}
// Yield by elapsed time (sliceMs of work, then one frame) while indexing, so the browser can paint the loading status.
// W2c-9 parent fix: yielding a whole frame (~16 ms) after every 128 source segments cost ~2.4 s of load for ~19k segments.
// sliceMs = 0 yields after every step (tests).
export async function prepareKamakuraFx(options, yieldFrame = () => new Promise(requestAnimationFrame), { sliceMs = 8, now = () => performance.now() } = {}) {
  const flags = fxOptions(options.search, options.quality);
  if (!flags.enabled && !flags.fish) return buildKamakuraFx(options);
  const job = prepareFishRiverSteps(options.data?.rivers, options.terrain.vscale, options.terrain);
  let result = job.next(), start = now();
  while (!result.done) {
    if (now() - start >= sliceMs) { await yieldFrame(); start = now(); }
    result = job.next();
  }
  return buildKamakuraFx({ ...options, preparedRivers: result.value });
}
export function buildKamakuraFx({ terrain, data, preparedRivers, search = '', quality = 'standard' }) {
  const options = fxOptions(search, quality), group = new THREE.Group(); group.name = 'kamakura-fx';
  // A/B flags avoid creating the corresponding states, geometries and materials.
  const rivers = options.enabled || options.fish ? preparedRivers || prepareFishRivers(data?.rivers, terrain.vscale, terrain) : null;
  const state = options.enabled ? createFxState({ terrain, rivers, particles: options.particles, rings: options.rings }) : null;
  const fish = options.fish ? createFishState(rivers, { limit: options.fishLimit, ripple: state?.ripple }) : null;
  const rings = state ? boards(options.rings, true) : null, drops = state ? boards(options.particles, false) : null;
  const fishView = fish ? buildFishView(fish) : null;
  if (rings) group.add(rings.mesh, drops.mesh); if (fishView) group.add(fishView.mesh);
  const obj = new THREE.Object3D(), color = new THREE.Color(), identity = new THREE.Quaternion(), flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  let disposed = false;
  function update(dt, camera, hero) {
    if (disposed) return;
    state?.update(dt); fish?.update(dt, camera.position, hero.pos); fishView?.update();
    if (!state) return;
    let n = 0;
    for (let i = 0; i < state.ripples.length; i++) {
      const r = state.ripples[i]; if (r.life <= 0) continue;
      obj.position.set(r.x, r.y, r.z); obj.quaternion.copy(flat);
      if (r.wake) { obj.rotateZ(r.yaw); obj.position.x -= Math.sin(r.yaw) * r.radius; obj.position.z -= Math.cos(r.yaw) * r.radius; }
      obj.scale.set(r.radius * 2.4, r.radius * 2.4, 1); obj.updateMatrix(); rings.mesh.setMatrixAt(n, obj.matrix);
      rings.alpha.array[n] = r.strength * r.life / 1.3 * .52; rings.wake.array[n] = +r.wake; n++;
    }
    rings.mesh.count = n; rings.mesh.instanceMatrix.needsUpdate = true; rings.alpha.needsUpdate = true; rings.wake.needsUpdate = true;
    n = 0;
    for (let i = 0; i < state.drops.length; i++) {
      const p = state.drops[i]; if (p.life <= 0) continue;
      obj.position.set(p.x, p.y, p.z); obj.quaternion.copy(camera.quaternion || identity);
      const size = p.size * (p.dust ? 1 + p.age * 2 : 1); obj.scale.set(size, size, size); obj.updateMatrix(); drops.mesh.setMatrixAt(n, obj.matrix);
      color.setRGB(p.r, p.g, p.b); drops.mesh.setColorAt(n, color); drops.alpha.array[n] = (p.dust ? .23 : .8) * p.life / (p.dust ? .9 : .7); n++;
    }
    drops.mesh.count = n; drops.mesh.instanceMatrix.needsUpdate = true; drops.alpha.needsUpdate = true; drops.mesh.instanceColor.needsUpdate = true;
  }
  return { group, state, fish, api: state?.api || { dust() {} }, contact(c, hero) { state?.contact(c, hero); }, update,
    setAdapt(step) { const scale = step >= 3 ? 0 : step >= 2 ? .5 : 1; state?.setLimits(Math.floor(options.particles * scale), Math.floor(options.rings * scale)); fish?.setLimit(step >= 3 ? 0 : step >= 2 ? 14 : options.fishLimit); },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); fishView?.dispose();
      for (const b of [rings, drops]) if (b) { b.mesh.dispose(); b.geometry.dispose(); b.material.dispose(); } group.clear(); } };
}
