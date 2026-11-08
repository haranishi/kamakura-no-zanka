import { shore4Enabled } from './kamakura-shore-r4.js';
// W2c-9d3: uniform rings / blue boards -> uneven double fronts / soft white round drops. Three bounded draws.
import * as THREE from 'three';
import { shore2Enabled } from './kamakura-shore.js';
import { fxOptions, createFxState, rippleBand, rippleAlpha, rippleAspect, rippleSecondary } from './kamakura-fx.js';
import { prepareFishRivers, prepareFishRiverSteps, createFishState } from './kamakura-fish.js';
import { buildFishView } from './kamakura-fish-view.js';
function boards(limit, ring) {
  const geometry = new THREE.PlaneGeometry(1, 1), alpha = new THREE.InstancedBufferAttribute(new Float32Array(limit), 1), wake = new THREE.InstancedBufferAttribute(new Float32Array(limit), 1);
  alpha.setUsage(THREE.DynamicDrawUsage); wake.setUsage(THREE.DynamicDrawUsage);
  const shape = new THREE.InstancedBufferAttribute(new Float32Array(limit * 3), 3); shape.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('fxAlpha', alpha); geometry.setAttribute('fxWake', wake); geometry.setAttribute('fxShape',shape);
  const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, depthWrite: false, side: THREE.DoubleSide }); material.fog = true; material.forceSinglePass = true;
  material.onBeforeCompile = shader => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 fxShape; varying vec3 vFxShape; attribute float fxAlpha; attribute float fxWake; varying float vFxAlpha; varying float vFxWake; varying vec2 vFxUv;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFxShape=fxShape; vFxAlpha=fxAlpha; vFxWake=fxWake; vFxUv=uv;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying vec3 vFxShape; varying float vFxAlpha; varying float vFxWake; varying vec2 vFxUv;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        vec2 p = (vFxUv - 0.5) * 2.0;
        float d = length(p);
        ${ring ? `float angle=atan(p.y,p.x);
        float uneven=1.0+0.22*sin(angle*3.0+vFxShape.z*4.0);
        float width=vFxShape.x*uneven;
        float inner=1.0-smoothstep(width*0.35,width,abs(d-0.68));
        float outer=(1.0-smoothstep(width*0.3,width*0.8,abs(d-vFxShape.y)))*0.38*clamp((vFxShape.y-0.82)/0.08,0.0,1.0);
        float mask=max(inner,outer)*(0.8+0.2*sin(angle*5.0+1.0));
        if(vFxWake > .5) mask = smoothstep(.1,.35,p.y) * (1.0-smoothstep(.03,width*2.0+.05,abs(abs(p.x)-p.y*.65))) * (1.0-smoothstep(.8,1.0,p.y));` : `float mask=1.0-smoothstep(.10,1.0,d);
        diffuseColor.rgb=mix(diffuseColor.rgb,vec3(0.98,0.99,1.0),(1.0-smoothstep(0.0,0.35,d))*vFxWake);`}
        diffuseColor.a *= mask * vFxAlpha; if(diffuseColor.a < .003) discard;`);
  };
  material.customProgramCacheKey = () => ring ? 'kamakura-fx-ring-9d3' : 'kamakura-fx-drop-9d3';
  const mesh = new THREE.InstancedMesh(geometry, material, limit); mesh.count = 0; mesh.renderOrder = ring ? 3 : 4; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage); mesh.setColorAt(0, new THREE.Color());
  return { mesh, geometry, material, alpha, wake, shape };
}
// Yield by elapsed time (sliceMs of work, then one frame) while indexing, so the browser can paint the loading status.
// W2c-9 parent fix: yielding a whole frame (~16 ms) after every 128 source segments cost ~2.4 s of load for ~19k segments.
// sliceMs = 0 yields after every step (tests).
export async function prepareKamakuraFx(options, yieldFrame = () => new Promise(requestAnimationFrame), { sliceMs = 8, now = () => performance.now(), defer = false } = {}) {
  if(defer)return deferredFx(options,now);
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
// W2c-9p: walking starts with an empty effect group; the deterministic index is
// advanced after the first draw. No timers or asynchronous resource owner survives disposal.
function deferredFx(options,now) {
  const group=new THREE.Group();group.name='kamakura-fx';
  const flags=fxOptions(options.search,options.quality);
  const job=flags.enabled||flags.fish?prepareFishRiverSteps(options.data?.rivers,options.terrain.vscale,options.terrain):null;
  let view=null,dead=false,first=true,step=0;
  const api={dust(...args){view?.api.dust(...args);}};
  return {group,api,get state(){return view?.state;},get fish(){return view?.fish;},get ready(){return !!view;},
    contact(c,hero){view?.contact(c,hero);},
    update(dt,camera,hero){
      if(dead)return;
      if(first){first=false;return;}
      if(!view){
        const start=now();let result=job?job.next():{done:true,value:null};
        while(!result.done && now()-start<2)result=job.next();
        if(!result.done)return;
        view=buildKamakuraFx({...options,preparedRivers:result.value});view.setAdapt(step);group.add(view.group);
      }
      view.update(dt,camera,hero);
    },
    setAdapt(next){step=next;view?.setAdapt(next);},
    dispose(){if(dead)return;dead=true;job?.return();view?.dispose();view=null;group.removeFromParent();group.clear();}
  };
}
export function buildKamakuraFx({ terrain, data, preparedRivers, search = '', quality = 'standard' }) {
  const options = fxOptions(search, quality), group = new THREE.Group(); group.name = 'kamakura-fx';
  // A/B flags avoid creating the corresponding states, geometries and materials.
  const rivers = options.enabled || options.fish ? preparedRivers || prepareFishRivers(data?.rivers, terrain.vscale, terrain) : null;
  const state = options.enabled ? createFxState({ shore4:shore4Enabled(search),shore2:shore2Enabled(search), terrain, rivers, particles: options.particles, rings: options.rings }) : null;
  const fish = options.fish ? createFishState(rivers, { limit: options.fishLimit, ripple: state?.ripple }) : null;
  const rings = state ? boards(options.rings, true) : null, drops = state ? boards(options.particles, false) : null;
  const fishView = fish ? buildFishView(fish) : null;
  if (rings) group.add(rings.mesh, drops.mesh); if (fishView) group.add(fishView.mesh);
  const obj = new THREE.Object3D(), color = new THREE.Color(), identity = new THREE.Quaternion(), flat = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2);
  let disposed = false;
  function update(dt, camera, hero) {
    if (disposed) return;
    state?.update(dt,hero); fish?.update(dt, camera.position, hero.pos); fishView?.update();
    if (!state) return;
    let n = 0;
    for (let i = 0; i < state.ripples.length; i++) {
      const r = state.ripples[i]; if (r.life <= 0) continue;
      obj.position.set(r.x, r.y, r.z); obj.quaternion.copy(flat);
      obj.rotateZ(r.yaw);
      if (r.wake) { obj.position.x -= Math.sin(r.yaw) * r.radius; obj.position.z -= Math.cos(r.yaw) * r.radius; }
      // W2c-9d4: shader front at UV radius .68 -> primary ring reaches the specified metres.
      obj.scale.set(r.radius * (2 / .68), r.radius * (2 / .68) * (r.local?1.45:rippleAspect(r.strength)), 1); obj.updateMatrix(); rings.mesh.setMatrixAt(n, obj.matrix);
      rings.alpha.array[n] = rippleAlpha(r.age,r.strength); rings.wake.array[n] = +r.wake; rings.mesh.setColorAt(n,color.setRGB(.89,.95,.97));
      rings.shape.array[n*3] = rippleBand(r.radius) / Math.max(.08,r.radius); rings.shape.array[n*3+1] = (r.local?.82:rippleSecondary(r.age)); rings.shape.array[n*3+2] = r.radius; n++;
    }
    rings.mesh.count = n; rings.mesh.instanceMatrix.needsUpdate = true; rings.alpha.needsUpdate = true; rings.wake.needsUpdate = true; rings.shape.needsUpdate=true; rings.mesh.instanceColor.needsUpdate=true;
    n = 0;
    for (let i = 0; i < state.drops.length; i++) {
      const p = state.drops[i]; if (p.life <= 0) continue;
      obj.position.set(p.x, p.y, p.z); obj.quaternion.copy(camera.quaternion || identity);
      const size = p.mist ? Math.min(.9,p.size*(1+.12*p.age/p.duration)) : p.size * (p.dust ? 1 + p.age * 2 : 1); obj.scale.set(size, size, size); obj.updateMatrix(); drops.mesh.setMatrixAt(n, obj.matrix);
      color.setRGB(p.r, p.g, p.b); drops.mesh.setColorAt(n, color); drops.alpha.array[n] = (p.dust ? .23 : p.mist ? .22 : .88) * p.life / p.duration; drops.wake.array[n]=p.dust || p.mist ? 0 : 1; n++;
    }
    drops.mesh.count = n; drops.mesh.instanceMatrix.needsUpdate = true; drops.alpha.needsUpdate = true; drops.wake.needsUpdate=true; drops.mesh.instanceColor.needsUpdate = true;
  }
  return { group, state, fish, api: state?.api || { dust() {} }, contact(c, hero) { state?.contact(c, hero); }, update,
    setAdapt(step) { const scale = step >= 3 ? 0 : step >= 2 ? .5 : 1; state?.setLimits(Math.floor(options.particles * scale), Math.floor(options.rings * scale)); fish?.setLimit(step >= 3 ? 0 : step >= 2 ? 14 : options.fishLimit); },
    dispose() { if (disposed) return; disposed = true; group.removeFromParent(); fishView?.dispose();
      for (const b of [rings, drops]) if (b) { b.mesh.dispose(); b.geometry.dispose(); b.material.dispose(); } group.clear(); } };
}
