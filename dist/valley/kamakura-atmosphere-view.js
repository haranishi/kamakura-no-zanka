// Own the existing atmosphere without changing the valley implementation.
import * as THREE from 'three';
import { ATMOS, installFog, createAtmosphere } from './atmosphere.js';
import { atmosphereOptions, atmospherePolicy, kamakuraAtmosphere, eveningEnabled } from './kamakura-atmosphere.js';
import { FLIGHT_SHADOW, createFlightShadowState, flightShadowBox, flightShadowEnabled } from './kamakura-flight-shadow.js';
import { contactShadowChunk, softShadowEnabled } from './kamakura-shadow.js';
const FOG_CHUNKS = ['fog_pars_vertex', 'fog_vertex', 'fog_pars_fragment', 'fog_fragment'];

// The bundled PMREM generator exposes no owner through createAtmosphere. Capture
// its rendered geometry/materials and render targets during this synchronous call.
// No caller-owned objects/targets are passed through this renderer facade.
function captureRenderer(renderer, resources) {
  const previousTarget = renderer.getRenderTarget();
  const own = resource => {
    if (!resource || resources.has(resource)) return;
    resources.add(resource);
    resource.addEventListener('dispose', () => resources.delete(resource));
  };
  const render = (object, camera) => {
    object.traverse(o => { own(o.geometry); for (const m of [].concat(o.material || [])) own(m); });
    return renderer.render(object, camera);
  };
  const setRenderTarget = (target, ...args) => {
    if (target !== previousTarget) own(target);
    return renderer.setRenderTarget(target, ...args);
  };
  return new Proxy(renderer, { get(target, key) {
    if (key === 'render') return render;
    if (key === 'setRenderTarget') return setRenderTarget;
    const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value;
  } });
}
// W2c-9r1 light: inherited valley fog bands -> continuous distance/height haze.
// No fog planes are created; preserve the shared valley chunks and the legacy A/B.
export function installKamakuraFog(a, enhanced = true, evening = false) {
  installFog(a);
  if (!enhanced) return;
  const shader = THREE.ShaderChunk.fog_fragment;
  const start = shader.indexOf('    // 谷の壁にかかる霧の帯');
  const end = shader.indexOf('  #else', start);
  if (start < 0 || end < 0) throw new Error('Kamakura fog band boundary missing');
  THREE.ShaderChunk.fog_fragment = shader.slice(0, start) + shader.slice(end);
  if (evening) THREE.ShaderChunk.fog_pars_fragment = THREE.ShaderChunk.fog_pars_fragment
    .replace('smoothstep(0.93, 0.998, s) * 0.55', 'smoothstep(0.65, 0.995, s) * 0.55');
}
// sunPlace: where the map moves the sun to ({ turn, lift } in degrees); mapAir: how much it thickens the air ({ haze, mist }). Both from kamakura-atmosphere.js.
export function createKamakuraAtmosphere({ scene, renderer, search = '', quality = 'standard', sunPlace = undefined, mapAir = undefined }) {
  const options = atmosphereOptions(search), resources = new Set(), before = new Set(scene.children);
  const previous = { background: scene.background, fog: scene.fog, environment: scene.environment, environmentIntensity: scene.environmentIntensity,
    shadowEnabled: renderer.shadowMap.enabled, shadowType: renderer.shadowMap.type };
  const shadowChunk = THREE.ShaderChunk.shadowmap_pars_fragment;
  let shadowPatched = false;
  const fogChunks = Object.fromEntries(FOG_CHUNKS.map(k => [k, THREE.ShaderChunk[k]]));
  const state = { target: renderer.getRenderTarget(), face: renderer.getActiveCubeFace(), level: renderer.getActiveMipmapLevel(),
    xr: renderer.xr.enabled, toneMapping: renderer.toneMapping, autoClear: renderer.autoClear };
  let atmosphere = null, disposed = false, installed = false, notice = '';
  let policy = atmospherePolicy(quality, options.enabled);
  const target = new THREE.Vector3(), forward = new THREE.Vector3();
  const flightBox = createFlightShadowState(), sunArray = [0,0,0];
  const flightEnabled = flightShadowEnabled(search), debug = new URLSearchParams(search).get('debug') === '1';
  let usingFlightBox = false, adaptPolicy = {};
  const softAvailable = softShadowEnabled(search,quality);
  const air = { flying: false, shadow: flightBox, mist: { ready:false,enabled:false,strength:0,cells:0 }, cloud: { scale:1,strength:0,height:0 } };
  const debugAir = () => air;
  if (debug) globalThis.__kzAir = debugAir;
  function release() {
    atmosphere?.sun.shadow.dispose();
    for (const object of [...scene.children]) if (!before.has(object)) {
      object.traverse(o => { if (o.geometry) resources.add(o.geometry); for (const m of [].concat(o.material || [])) resources.add(m); });
      object.removeFromParent();
    }
    for (const resource of [...resources]) resource.dispose(); resources.clear();
    Object.assign(scene, { background: previous.background, fog: previous.fog, environment: previous.environment, environmentIntensity: previous.environmentIntensity });
    renderer.shadowMap.enabled = previous.shadowEnabled; renderer.shadowMap.type = previous.shadowType;
    if (installed) for (const key of FOG_CHUNKS) THREE.ShaderChunk[key] = fogChunks[key];
    installed = false;
    if (shadowPatched) THREE.ShaderChunk.shadowmap_pars_fragment = shadowChunk;
    shadowPatched = false;
  }
  try {
    if (options.enabled) {
      const a = kamakuraAtmosphere(options.time, { ...ATMOS, sunDir: ATMOS.sunDir.toArray() }, eveningEnabled(search), quality === 'light' ? .55 : 1, sunPlace, mapAir);
      a.sunDir = new THREE.Vector3(...a.sunDir);
      installed = true; installKamakuraFog(a, eveningEnabled(search), options.time === 'evening'); // Before terrain, sea, houses and vegetation materials.
      scene.background = null;
      renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      atmosphere = createAtmosphere({ scene, renderer: captureRenderer(renderer, resources), quality, a });
      if (softShadowEnabled(search, quality)) {
        THREE.ShaderChunk.shadowmap_pars_fragment = contactShadowChunk(shadowChunk);
        shadowPatched = true; atmosphere.sun.shadow.radius = 2;
      }
      // PMREM scratch targets, environment sky and blur draws are initialization-only.
      for (const resource of [...resources]) if (resource.texture !== scene.environment) resource.dispose();
    }
  } catch {
    release(); atmosphere = null; policy = atmospherePolicy(quality, false);
    notice = '空と光を準備できませんでした。従来の空と光で散策を続けます';
  } finally {
    renderer.setRenderTarget(state.target, state.face, state.level);
    renderer.xr.enabled = state.xr; renderer.toneMapping = state.toneMapping; renderer.autoClear = state.autoClear;
  }
  let sunDir = atmosphere?.params.sunDir;
  if (!atmosphere) {
    scene.background = new THREE.Color(0xacc3cb); scene.fog = null;
    renderer.shadowMap.enabled = false;
    const hemi = new THREE.HemisphereLight(0xe4f0ff, 0x615a3d, 2);
    const sun = new THREE.DirectionalLight(0xfff3dd, 2.5); sun.position.set(-100, 160, 50);
    scene.add(hemi, sun); sunDir = sun.position.clone().normalize();
  }
  // Only objects created here belong to this controller (later scene additions do not).
  const owned = scene.children.filter(o => !before.has(o));
  const shadow = atmosphere?.sun.shadow, shadowCamera = shadow?.camera;
  const walking = shadow ? { left:shadowCamera.left,right:shadowCamera.right,top:shadowCamera.top,bottom:shadowCamera.bottom,
    near:shadowCamera.near,far:shadowCamera.far,bias:shadow.bias,normalBias:shadow.normalBias } : null;
  function restoreWalking() {
    if (!usingFlightBox) return;
    shadowCamera.left=walking.left; shadowCamera.right=walking.right; shadowCamera.top=walking.top; shadowCamera.bottom=walking.bottom;
    shadowCamera.near=walking.near; shadowCamera.far=walking.far; shadow.bias=walking.bias; shadow.normalBias=walking.normalBias;
    shadowCamera.updateProjectionMatrix(); usingFlightBox=false; flightBox.size=0;
  }
  return { atmosphere, policy, notice, sunDir,
    setAdapt(next) {
      if (disposed || !atmosphere) return;
      adaptPolicy = next;
      atmosphere.sun.castShadow = next.shadows;
      atmosphere.sun.shadow.radius = shadowPatched && (!usingFlightBox || flightBox.soft) && softShadowEnabled(search, quality, next) ? 2 : 1;
    },
    update(camera, dt, hero, yaw, flying = false, terrain = null) {
      if (disposed) return;
      air.flying = flying;
      if (!atmosphere) return;
      atmosphere.update(camera, dt);
      if (flying && flightEnabled && terrain && quality !== 'light' && atmosphere.sun.castShadow) {
        camera.getWorldDirection(forward);
        sunArray[0]=sunDir.x; sunArray[1]=sunDir.y; sunArray[2]=sunDir.z;
        flightShadowBox(camera.position,forward,terrain,sunArray,shadow.mapSize.x,flightBox);
        shadowCamera.left=shadowCamera.bottom=-flightBox.size/2;
        shadowCamera.right=shadowCamera.top=flightBox.size/2;
        shadowCamera.near=flightBox.near; shadowCamera.far=flightBox.far;
        shadow.bias=flightBox.bias; shadow.normalBias=flightBox.normalBias;
        shadowCamera.updateProjectionMatrix();
        atmosphere.sun.target.position.fromArray(flightBox.snapped);
        atmosphere.sun.position.copy(atmosphere.sun.target.position).addScaledVector(sunDir,flightBox.sunDistance);
        atmosphere.sun.target.updateMatrixWorld(); usingFlightBox=true;
      } else {
        restoreWalking();
        target.set(hero.x - Math.sin(yaw) * 8, hero.y, hero.z - Math.cos(yaw) * 8);
        atmosphere.follow(target);
        flightBox.size=shadowCamera.right-shadowCamera.left;
        flightBox.texel=flightBox.size/shadow.mapSize.x;
        flightBox.centerDistance=camera.position.distanceTo(atmosphere.sun.target.position);
        flightBox.bias=shadow.bias;
      }
      shadow.radius=shadowPatched && (!usingFlightBox || flightBox.soft) && softAvailable && (adaptPolicy.scale ?? 1) > .7 && adaptPolicy.shadows !== false ? 2 : 1;
      flightBox.soft=shadow.radius>1.5;
      renderer.shadowMap.type=usingFlightBox && flightBox.size>FLIGHT_SHADOW.softLimit ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
    },
    dispose() {
      if (disposed) return; disposed = true;
      // Protect unrelated objects which were added after initialization.
      for (const object of scene.children) if (!owned.includes(object)) before.add(object);
      release(); atmosphere = null;
      if (debug && globalThis.__kzAir === debugAir) delete globalThis.__kzAir;
    },
  };
}
