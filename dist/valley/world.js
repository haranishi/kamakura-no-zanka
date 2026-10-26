// world.js — 地形・大気・後処理を単独で確認する開発用ページ。固定画角を撮る / 飛んで見る。
//   world.html?shot=veranda&w=1400&h=800&q=standard   ?fly=1 で WASD＋ドラッグで移動
import * as THREE from 'three';
import { WORLD } from './world-data.js';
import { createTerrain } from './terrain-height.js';
import { buildTerrain, loadGroundTextures } from './terrain.js';
import { installFog, createAtmosphere } from './atmosphere.js';
import { Post } from './post.js';
import { SHOTS, applyShot } from './shots.js';
import { scatterTrees, scatterRocks, scatterGrass, scatterRice } from './scatter.js';
import { buildVegetation } from './vegetation.js';
import { loadModels, buildBuildings, buildRocks } from './buildings.js';

const q = new URLSearchParams(location.search);
const quality = q.get('q') || 'standard';
if (q.get('shot')) document.body.classList.add('shot');
installFog();
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.2, 2200);
const post = new Post(renderer, { quality });
let atmosphere, built, terrain;

function resize() {
  const w = Number(q.get('w') || innerWidth), h = Number(q.get('h') || innerHeight), pr = q.get('w') ? 1 : Math.min(devicePixelRatio, quality === 'light' ? 1 : 1.5);
  renderer.setPixelRatio(pr); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); post.setSize(w, h, pr);
}

async function main() {
  const t0 = performance.now();
  terrain = createTerrain(WORLD);
  const textures = await loadGroundTextures(new URL('../assets/valley/terrain/', import.meta.url).href, renderer.capabilities.getMaxAnisotropy());
  const t1 = performance.now();
  built = buildTerrain({ terrain, textures, quality });
  scene.add(built.group);
  const t2 = performance.now();
  const scatter = { trees: scatterTrees(WORLD, terrain), rocks: scatterRocks(WORLD, terrain), grass: scatterGrass(WORLD, terrain), rice: scatterRice(WORLD, terrain) };
  const t3 = performance.now();
  const models = await loadModels({});
  const veg = buildVegetation({ scatter, quality }); scene.add(veg.group);
  const bld = buildBuildings({ world: WORLD, terrain, models }); scene.add(bld.group);
  scene.add(buildRocks({ data: scatter.rocks, model: models.boulder }));
  const t4 = performance.now();
  atmosphere = createAtmosphere({ scene, renderer, quality });
  resize(); window.addEventListener('resize', resize);
  const shotName = q.get('shot') || 'veranda';
  const shot = SHOTS[shotName] || SHOTS.veranda;
  applyShot(camera, shot, terrain);
  if (q.get('cam')) { const c = q.get('cam').split(',').map(Number); camera.position.set(c[0], c[1], c[2]); camera.lookAt(c[3], c[4], c[5]); if (c[6]) { camera.fov = c[6]; camera.updateProjectionMatrix(); } }
  let yaw = 0, pitch = 0;
  const fly = !!q.get('fly');
  const keys = new Set();
  if (fly) {
    const e = new THREE.Euler().setFromQuaternion(camera.quaternion, 'YXZ'); yaw = e.y; pitch = e.x;
    addEventListener('keydown', ev => keys.add(ev.code)); addEventListener('keyup', ev => keys.delete(ev.code));
    let drag = false; renderer.domElement.onpointerdown = ev => { drag = true; }; addEventListener('pointerup', () => { drag = false; });
    addEventListener('pointermove', ev => { if (!drag) return; yaw -= ev.movementX * 0.003; pitch = Math.max(-1.5, Math.min(1.5, pitch - ev.movementY * 0.003)); });
  }
  if (q.get('sun')) { const [sx, sy, sz] = q.get('sun').split(',').map(Number); atmosphere.params.sunDir.set(sx, sy, sz).normalize(); atmosphere.sky.material.uniforms.sunDir.value.copy(atmosphere.params.sunDir); }
  if (q.get('bloom') != null) post.params.bloomStrength = Number(q.get('bloom'));
  const clock = new THREE.Clock();
  let frames = 0; const need = Number(q.get('frames') || 6);
  document.getElementById('info').textContent = `textures ${(t1 - t0).toFixed(0)}ms terrain ${built.buildMs.toFixed(0)}ms scatter ${(t3 - t2).toFixed(0)}ms models+veg ${(t4 - t3).toFixed(0)}ms | trees ${scatter.trees.x.length} grass ${scatter.grass.x.length} rice ${scatter.rice.x.length}`;
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.1);
    if (fly) {
      camera.rotation.set(pitch, yaw, 0, 'YXZ');
      const sp = (keys.has('ShiftLeft') ? 60 : 12) * dt, f = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw)), r = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
      if (keys.has('KeyW')) camera.position.addScaledVector(f, sp); if (keys.has('KeyS')) camera.position.addScaledVector(f, -sp);
      if (keys.has('KeyD')) camera.position.addScaledVector(r, sp); if (keys.has('KeyA')) camera.position.addScaledVector(r, -sp);
      if (keys.has('KeyE')) camera.position.y += sp; if (keys.has('KeyQ')) camera.position.y -= sp;
    }
    atmosphere.update(camera, dt);
    veg.wind.uTime.value += dt; veg.trees.update(camera);
    atmosphere.follow(new THREE.Vector3(camera.position.x + (-Math.sin(yaw) * 20), camera.position.y - 10, camera.position.z + (-Math.cos(yaw) * 20)));
    post.render(scene, camera, dt);
    frames++;
    if (frames === need) { document.title = 'ready'; window.__ready = true; }
  });
  window.__world = { scene, camera, renderer, terrain, built, atmosphere, post, veg, SHOTS, applyShot: n => applyShot(camera, SHOTS[n], terrain) };
}
main().catch(e => { document.body.append(String(e.stack || e)); console.error(e); });
