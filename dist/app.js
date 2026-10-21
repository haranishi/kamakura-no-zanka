import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { groundAt, checkPosition, movePlayer } from './collision.js';
import { WalkUI } from './ui.js';
import { initialState, transition, objectiveFor, inventoryFor } from './gameplay.js';
import { selectTarget, segmentBlocked } from './interactions.js';
import { loadProgress, saveProgress, PROGRESS_KEY } from './save.js';
import { GameAudio } from './audio.js';
import { createQuestView } from './quest-view.js';
import { createEnvironment } from './environment.js';

const $ = s => document.querySelector(s), view = $('#view');
const start = { x: -2.3, z: 6.4, yaw: .537, pitch: .025 }, eyeHeight = 1.65;
const keys = new Set(), touchKeys = new Set();
const stats = { instances: 0, drawCalls: 0, triangles: 0, frames: 0 };
const touch = matchMedia('(pointer:coarse)').matches || innerWidth < 600;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let renderer, scene, camera, world, model, sun, environment, questView, ui;
let ready = false, started = false, lightMode = false, needsRender = true;
let player = { x: start.x, z: start.z, y: 0 }, yaw = start.yaw, pitch = start.pitch;
let drag = null, lastTime = 0, lastUI = 0, elapsed = 0, lastStep = 0, interactionUntil = 0;
let progressStore;
try { progressStore = localStorage; } catch {}
const loaded = loadProgress(progressStore);
let game = loaded.state, hasSave = loaded.hasSave;
const audio = new GameAudio(text => ui?.notify(text));
ui = new WalkUI({
  mode(state) {
    needsRender = true; if (state === 'playing') started = true;
    clearInput(); lastTime = performance.now(); audio.setPaused(state !== 'playing');
    if (ready) refreshQuest();
  },
  lock: lockPointer, reset, settings: applySettings, gesture: () => audio.unlock(), restart: restartGame,
}, touch);

function fail(error) {
  console.error('Walkthrough failed:', error); ui.error(error); window.__walkthroughError = String(error);
}
function clearInput() { keys.clear(); touchKeys.clear(); drag = null; }
function syncCamera() {
  if (!camera) return;
  camera.position.set(player.x, player.y + eyeHeight, player.z);
  camera.rotation.set(pitch, yaw, 0, 'YXZ');
  camera.updateMatrixWorld();
}
function reset() {
  if (!world) return;
  needsRender = true; clearInput();
  player = { x: start.x, z: start.z, y: groundAt(world.ground, start.x, start.z) ?? .18 };
  yaw = start.yaw; pitch = start.pitch; syncCamera(); refreshQuest();
}
function restartGame() {
  game = initialState(); interactionUntil = 0; questView?.sync(game); reset(); const saved = persist(); refreshQuest();
  ui.notify(saved.ok ? '桶を元の場所へ戻しました。水運びをはじめましょう' : '桶を戻しました。' + saved.notice, saved.ok ? 2400 : 4500); needsRender = true;
}
function persist() {
  const result = saveProgress(progressStore, game);
  if (result.ok) hasSave = true;
  return result;
}
function look(dx, dy) {
  yaw -= dx * .0025 * ui.settings.sensitivity;
  pitch = THREE.MathUtils.clamp(pitch - dy * .0025 * ui.settings.sensitivity * (ui.settings.invert ? -1 : 1), -1.25, 1.25);
  syncCamera();
}
async function lockPointer() {
  if (!ready || !ui.playing) return;
  if (!renderer.domElement.requestPointerLock) { ui.notify('画面をドラッグして見回せます'); return; }
  try { await renderer.domElement.requestPointerLock(); }
  catch { ui.notify('画面をドラッグして見回せます'); }
  ui.pointerChanged();
}
function applySettings(settings) {
  audio.setMuted(settings.muted);
  if (!renderer) return;
  needsRender = true; const previousLight = lightMode; lightMode = settings.quality === 'light';
  renderer.shadowMap.enabled = !lightMode;
  renderer.setPixelRatio(Math.min(devicePixelRatio, lightMode ? 1.25 : 1.75));
  if (camera) { camera.fov = settings.fov; camera.updateProjectionMatrix(); }
  if (model && previousLight !== lightMode) scene.traverse(object => {
    if (object.isMesh) for (const material of Array.isArray(object.material) ? object.material : [object.material]) material.needsUpdate = true;
  });
  environment?.setQuality(settings.quality); resize();
}
function optimizeInstances(root) {
  root.updateMatrixWorld(true); const groups = new Map();
  root.traverse(object => {
    if (!object.isMesh || object.isInstancedMesh || object.isSkinnedMesh || object.userData.dynamic) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    const key = object.geometry.uuid + ':' + materials.map(m => m.uuid).join(',');
    if (!groups.has(key)) groups.set(key, []); groups.get(key).push(object);
  });
  for (const list of groups.values()) if (list.length >= 3) {
    const source = list[0], instance = new THREE.InstancedMesh(source.geometry, source.material, list.length);
    instance.name = 'Shared ' + source.name;
    list.forEach((object, i) => instance.setMatrixAt(i, object.matrixWorld)); instance.computeBoundingSphere();
    instance.castShadow = source.castShadow; instance.receiveShadow = source.receiveShadow; scene.add(instance);
    list.forEach(object => object.removeFromParent()); stats.instances += list.length;
  }
}
function tuneMeshes(root) {
  const waterNames = new Set(['Flooded rice surface | STATIC', 'Still shallow muddy puddles | STATIC', 'Shallow channel water | STATIC PBR surface']);
  root.traverse(object => {
    if (object.isLight) object.visible = false;
    if (!object.isMesh) return;
    object.castShadow = true; object.receiveShadow = true;
    if (object.isInstancedMesh) stats.instances += object.count;
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (material.map) material.map.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
      if (waterNames.has(material.name)) { material.transparent = true; material.opacity = Math.min(material.opacity, .86); material.depthWrite = false; material.roughness = .2; material.metalness = .15; }
      if (material.transparent && material.alphaTest > 0) material.depthWrite = true;
    }
  });
}
function resize() {
  if (!renderer || !camera) return;
  needsRender = true; renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
}
function targets() {
  return [
    { id: 'bucket', anchor: { x: -4.55, y: .42, z: 3.10005 }, available: game.stage === 'bucket', action: 'pickup', label: '桶を拾う', name: '庭の桶' },
    { id: 'well', anchor: { x: -5.35, y: .75, z: 2.2 }, available: game.stage === 'empty', action: 'fill', label: '井戸で水をくむ', name: '井戸の東側', approach: p => p.x >= -5.10 },
    { id: 'delivery', anchor: { x: -8.5, y: .38, z: -.4 }, available: game.stage === 'full', action: 'deliver', label: '庭へ水を届ける', name: '縁側の前の目印' },
  ];
}
function interactionTarget() {
  if (!ready || !ui.playing) return null;
  return selectTarget(player, yaw, targets(), (p, target) => segmentBlocked(p, target, world.boxes, target.id === 'well' ? 'well' : undefined));
}
function refreshQuest() {
  const destination = targets().find(target => target.available);
  const dx = destination ? destination.anchor.x - player.x : 0, dz = destination ? destination.anchor.z - player.z : 0;
  ui.showQuest({ objective: objectiveFor(game), inventory: inventoryFor(game), stage: game.stage, hasSave: hasSave || game.stage !== 'bucket', distance: Math.hypot(dx, dz), direction: Math.atan2(dx, -dz) + yaw, label: destination?.name });
  ui.setPrompt(interactionTarget());
}
function interact() {
  if (!ready || !ui.playing || performance.now() < interactionUntil) return false;
  const target = interactionTarget();
  if (!target) { if (game.stage !== 'delivered') ui.notify('目的の場所へ近づいて、そちらを向いてみましょう', 1700); return false; }
  const result = transition(game, target.action);
  if (!result.changed) return false;
  game = result.state; interactionUntil = performance.now() + 450;
  questView.sync(game); needsRender = true; const saved = persist(); refreshQuest();
  audio.play(target.action); ui.notify(saved.ok ? result.notice : result.notice + '。' + saved.notice, saved.ok ? 2400 : 4500); return true;
}
function frame(now) {
  requestAnimationFrame(frame); if (!ready) return;
  const dt = Math.max(0, Math.min((now - lastTime) / 1000, .15)) || 0; lastTime = now;
  let moving = false;
  if (ui.playing) {
    elapsed += dt;
    let forward = (keys.has('KeyW') || keys.has('ArrowUp') || touchKeys.has('forward') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') || touchKeys.has('back') ? 1 : 0);
    let right = (keys.has('KeyD') || keys.has('ArrowRight') || touchKeys.has('right') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') || touchKeys.has('left') ? 1 : 0);
    const length = Math.hypot(forward, right);
    if (length) {
      forward /= length; right /= length;
      const speed = keys.has('ShiftLeft') || keys.has('ShiftRight') ? 3.5 : 2.1;
      const dx = (-Math.sin(yaw) * forward + Math.cos(yaw) * right) * speed * dt;
      const dz = (-Math.cos(yaw) * forward - Math.sin(yaw) * right) * speed * dt;
      const before = player; const result = movePlayer(world, player, dx, dz); player = result.position;
      moving = Math.hypot(player.x - before.x, player.z - before.z) > .001;
      if (moving && elapsed - lastStep > .5) { lastStep = elapsed; audio.play('step'); }
      if (result.blocked) {
        const id = result.blocked;
        ui.notify(id === 'water' ? '田と水路には入れません' : id === 'boundary' ? 'この先は、今回の散策範囲の外です' : id === 'step' ? 'この段差は登れません' : /house|porch|farmhouse/i.test(id) ? '建物と縁側は、外からご覧ください' : '井戸の脇を回ってみましょう', 700);
      }
    }
    environment.update(dt, elapsed); questView.update(elapsed, moving, reducedMotion.matches);
  }
  syncCamera();
  if (ui.playing || needsRender) { renderer.render(scene, camera); stats.frames++; needsRender = false; }
  ui.tick(now);
  if (now - lastUI > 100) {
    lastUI = now; stats.drawCalls = renderer.info.render.calls; stats.triangles = renderer.info.render.triangles; refreshQuest();
    $('#location-label').textContent = player.x > -3.4 ? '水路沿いの道' : player.z > 1 && player.x > -8.6 && player.x < -4 ? '井戸のある庭' : '農家の庭';
  }
}
async function init() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  view.append(renderer.domElement); scene = new THREE.Scene(); scene.background = new THREE.Color('#bdc8bf'); scene.fog = new THREE.Fog('#bdc8bf', 25, 150);
  camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, .06, 400); scene.add(camera);
  scene.add(new THREE.HemisphereLight('#dce4df', '#4d4633', 1.8));
  sun = new THREE.DirectionalLight('#ffe1aa', 3.2); sun.position.set(-18, 16, 12); sun.target.position.set(-5, 0, -2); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -21, right: 21, top: 21, bottom: -21, near: .1, far: 70 }); sun.shadow.normalBias = .025; sun.shadow.bias = -.0002; scene.add(sun, sun.target); applySettings(ui.settings);
  const [gltf, data] = await Promise.all([
    new GLTFLoader().loadAsync('./assets/scene.glb', event => ui.progress(event)),
    fetch('./assets/collision.json').then(response => { if (!response.ok) throw Error('Ground data unavailable'); return response.json(); }),
  ]);
  world = data; model = gltf.scene; scene.add(model);
  questView = createQuestView({ model, scene, camera, groundAt: (x, z) => groundAt(world.ground, x, z) });
  tuneMeshes(model); tuneMeshes(questView.bucket); optimizeInstances(model);
  environment = createEnvironment({ scene, renderer, model, sun, groundAt: (x, z) => groundAt(world.ground, x, z) });
  environment.setQuality(ui.settings.quality); questView.sync(game); ready = true; reset(); ui.preparing();
  await renderer.compileAsync(scene, camera); renderer.render(scene, camera); ui.ready(); refreshQuest();
  if (loaded.notice) ui.notify(loaded.notice, 4500);
  requestAnimationFrame(frame);
  if (new URLSearchParams(location.search).has('qa')) setupQA();
}
function setupQA() {
  window.__walktest = {
    get state() { return { ready, started, paused: !ui.playing, uiState: ui.state, settings: { ...ui.settings }, player: { ...player }, yaw, pitch, locked: !!document.pointerLockElement, stats: { ...stats }, bounds: world.bounds, boxes: world.boxes, game: { ...game }, hasSave, progressKey: PROGRESS_KEY, target: interactionTarget()?.id || null, quest: questView.state, audio: audio.state, elapsed }; },
    teleport(x, z, angle = 0, elevation = 0) { const result = checkPosition(world, x, z); if (!result.ok) throw Error('Invalid test position ' + JSON.stringify(result)); player = { x, z, y: result.y }; yaw = angle; pitch = elevation; syncCamera(); needsRender = true; refreshQuest(); return this.state; },
    aimAt(x, z, elevation = 0) { yaw = Math.atan2(-(x - player.x), -(z - player.z)); pitch = elevation; syncCamera(); needsRender = true; refreshQuest(); },
    move(dx, dz) { const result = movePlayer(world, player, dx, dz); player = result.position; syncCamera(); needsRender = true; refreshQuest(); return result; },
    interact, reset,
  };
}
function uiInput(target) { return !!target?.closest?.('button,input,select,textarea,dialog,[contenteditable="true"]'); }
window.addEventListener('keydown', event => {
  if (event.code === 'Escape') { if (ui.playing && !document.pointerLockElement) { event.preventDefault(); ui.open(); } return; }
  if (!ui.playing || uiInput(event.target)) return;
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ShiftLeft', 'ShiftRight'].includes(event.code)) { event.preventDefault(); keys.add(event.code); }
  if (event.code === 'KeyE' && !event.repeat) { event.preventDefault(); interact(); }
  if (event.code === 'KeyR' && !event.repeat) { reset(); ui.notify('出発点に戻りました。水運びの進行は保持しています'); }
  if (event.code === 'KeyH' && !event.repeat) { event.preventDefault(); ui.toggleHUD(); }
});
window.addEventListener('keyup', event => keys.delete(event.code));
window.addEventListener('blur', () => { clearInput(); ui.pause(); });
document.addEventListener('visibilitychange', () => { clearInput(); lastTime = performance.now(); if (document.hidden) ui.pause(); });
document.addEventListener('pointerlockchange', () => { clearInput(); if (!document.pointerLockElement && ui.playing) ui.pause(); ui.pointerChanged(); });
document.addEventListener('mousemove', event => { if (ui.playing && document.pointerLockElement === renderer?.domElement) look(event.movementX, event.movementY); });
view.addEventListener('pointerdown', event => { if (!ui.playing || document.pointerLockElement) return; drag = { id: event.pointerId, x: event.clientX, y: event.clientY }; renderer.domElement.setPointerCapture(event.pointerId); });
view.addEventListener('pointermove', event => { if (!drag || event.pointerId !== drag.id || !ui.playing) return; look(event.clientX - drag.x, event.clientY - drag.y); drag.x = event.clientX; drag.y = event.clientY; });
view.addEventListener('pointerup', () => drag = null); view.addEventListener('pointercancel', () => drag = null);
for (const button of document.querySelectorAll('[data-move]')) {
  button.addEventListener('pointerdown', event => { if (!ui.playing) return; event.preventDefault(); touchKeys.add(button.dataset.move); button.setPointerCapture(event.pointerId); });
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) button.addEventListener(type, () => touchKeys.delete(button.dataset.move));
}
$('#interaction').addEventListener('click', () => { audio.unlock(); interact(); view.focus({ preventScroll: true }); });
window.addEventListener('resize', resize);
reducedMotion.addEventListener('change', () => { needsRender = true; environment?.setQuality(ui.settings.quality); });
window.addEventListener('error', event => { if (!ready) fail(event.error || event.message); });
window.addEventListener('unhandledrejection', event => { if (!ready) fail(event.reason); });
init().catch(fail);
