// main.js — 縦切りの起動（app層）。読み込み → タイトル → 遊び。描画器・操作・音・UI・設定・一時停止・各ボタンを組み立てる。
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
import { loadPropModels, buildProps } from './props.js';
import { loadRoster } from './characters.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { ValleyAudio } from './audio-valley.js';
import { Game } from './game.js';
import { loadValley } from './save.js';
import { applyLookOverrides } from './config.js';
import { installQA } from './qa.js';

const q = new URLSearchParams(location.search);
const QA = q.get('qa') === '1';
const SETTINGS_KEY = 'kamakura-valley-settings';
const store = { get(k) { try { return localStorage.getItem(k); } catch { return null; } }, set(k, v) { try { localStorage.setItem(k, v); } catch { /* 保存できない環境でも遊べる */ } } };
const $ = id => document.getElementById(id);
const wait = ms => new Promise(r => setTimeout(r, ms));
const saved = (() => { try { return JSON.parse(store.get(SETTINGS_KEY) || '{}'); } catch { return {}; } })();
let quality = q.get('q') || saved.quality || 'standard';
applyLookOverrides();
installFog();

const hud = new HUD();
const view = $('view');
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance', preserveDrawingBuffer: QA });
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.info.autoReset = false;       // 後処理の最後の1枚で統計が0に戻らないよう、1コマごとに自分でリセットする
view.append(renderer.domElement);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(58, 1, 0.15, 2200);
const post = new Post(renderer, { quality });
const input = new Input(renderer.domElement);
const audio = new ValleyAudio(msg => hud.toast(msg, 3000));
let game = null, frozen = false, titleT = 0;

function resize() {
  const w = Number(q.get('w') || innerWidth), h = Number(q.get('h') || innerHeight), pr = q.get('w') ? 1 : Math.min(devicePixelRatio, quality === 'light' ? 1 : 1.5);
  renderer.setPixelRatio(pr); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); post.setSize(w, h, pr);
}

async function boot() {
  hud.setState('loading');
  const step = async (p, note) => { hud.loading(p, note); await wait(16); };
  await step(0.02, '地形の質感を読み込んでいます');
  const terrain = createTerrain(WORLD);
  const textures = await loadGroundTextures(new URL('../assets/valley/terrain/', import.meta.url).href, renderer.capabilities.getMaxAnisotropy());
  await step(0.12, '谷の地形を組み立てています');
  const built = buildTerrain({ terrain, textures, quality }); scene.add(built.group);
  await step(0.2, '木と岩を植えています');
  const scatter = { trees: scatterTrees(WORLD, terrain), rocks: scatterRocks(WORLD, terrain), grass: scatterGrass(WORLD, terrain), rice: scatterRice(WORLD, terrain) };
  await step(0.28, '建物を読み込んでいます');
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const [models, propModels] = await Promise.all([loadModels({ anisotropy: aniso }), loadPropModels({ anisotropy: aniso })]);
  const veg = buildVegetation({ scatter, quality }); scene.add(veg.group);
  scene.add(buildBuildings({ world: WORLD, terrain, models }).group);
  scene.add(buildRocks({ data: scatter.rocks, model: models.boulder }));
  const props = buildProps({ world: WORLD, terrain, models: { ...models, ...propModels } }); scene.add(props.group);
  await step(0.42, '人物を読み込んでいます');
  const roster = await loadRoster({ anisotropy: renderer.capabilities.getMaxAnisotropy(), onProgress: p => hud.loading(0.42 + p * 0.45, '人物を読み込んでいます') });
  await step(0.9, '空と光を整えています');
  const atmosphere = createAtmosphere({ scene, renderer, quality });
  resize();
  await step(0.95, '道と見通しを調べています');
  game = new Game({ scene, camera, renderer, post, atmosphere, veg, props, terrain, scatter, roster, hud, audio, input, storage: (() => { try { return localStorage; } catch { return null; } })(), seed: Number(q.get('seed') || 1333) });
  game.skipIntro = q.get('intro') === '0';
  applySettings(saved);
  await step(1, '準備ができました');
  wire();
  if (QA) installQA(game, { setFrozen: v => { frozen = v; }, start, quality: setQuality });
  hud.setState('title'); hud.showTitle(loadValley(game.storage).hasSave);
  document.getElementById('loading').classList.add('hidden');
  window.__valleyReady = true;
  if (q.get('autostart')) start(q.get('autostart') === 'continue' ? 'continue' : 'new');
}

// 設定（感度・反転・揺れ・音量・字幕・品質）。保存は端末の中だけ。
function applySettings(s) {
  const set = { quality, sens: 1, invert: false, shake: 1, volume: 0.8, subs: true, ...s };
  game.rig.sensitivity = set.sens; game.rig.invert = set.invert; game.rig.shakeScale = set.shake; game.settings.shake = set.shake;
  audio.setVolume(set.volume); hud.subsOn = set.subs;
  $('set-quality').value = set.quality; $('set-sens').value = set.sens; $('set-invert').checked = set.invert; $('set-shake').value = set.shake; $('set-volume').value = set.volume; $('set-subs').checked = set.subs;
  Object.assign(saved, set);
}
function persist() { store.set(SETTINGS_KEY, JSON.stringify(saved)); }
function setQuality(v) { quality = v; saved.quality = v; persist(); post.setQuality(v); game.atmosphere.setQuality(v); resize(); }

function start(mode) {
  if (!game || game.flow !== 'idle') return;
  audio.unlock().then(() => audio.setPaused(false));
  if (mode === 'continue') game.continueGame(); else game.startNew();
  input.setEnabled(true);
  if (!QA) input.requestLock();
}

function openPause() {
  const dlg = $('pause');
  if (dlg.open) return;
  if (game?.flow !== 'idle') { game.paused = true; audio.setPaused(true); }
  input.releaseLock(); input.clear();
  dlg.showModal();
}

function wire() {
  $('btn-start').onclick = () => start('new');
  $('btn-continue').onclick = () => start('continue');
  $('btn-howto').onclick = openPause;
  $('menu-btn').onclick = openPause;
  const dlg = $('pause');
  dlg.addEventListener('close', () => { if (!game) return; game.paused = false; if (game.flow !== 'idle') audio.setPaused(false); if (game.flow === 'play' && !QA) input.requestLock(); });
  $('pause-resume').onclick = () => dlg.close();
  $('pause-checkpoint').onclick = () => { dlg.close(); if (game.flow !== 'idle') game.toCheckpoint(); };
  $('pause-title').onclick = () => { location.href = location.pathname; };
  $('result-again').onclick = () => { game.hud.hideResult(); game.flow = 'idle'; start('new'); };
  $('result-title').onclick = () => { location.href = location.pathname; };
  $('death-retry').onclick = () => game.retry();
  input.onLockChange = locked => { if (!locked && game.flow === 'play' && !dlg.open && !QA) openPause(); };
  addEventListener('keydown', e => { if (e.code === 'KeyP' && game?.flow === 'play' && !dlg.open) openPause(); });
  $('set-quality').onchange = e => { setQuality(e.target.value); };
  $('set-sens').oninput = e => { saved.sens = Number(e.target.value); game.rig.sensitivity = saved.sens; persist(); };
  $('set-invert').onchange = e => { saved.invert = e.target.checked; game.rig.invert = saved.invert; persist(); };
  $('set-shake').oninput = e => { saved.shake = Number(e.target.value); game.rig.shakeScale = saved.shake; game.settings.shake = saved.shake; persist(); };
  $('set-volume').oninput = e => { saved.volume = Number(e.target.value); audio.setVolume(saved.volume); persist(); };
  $('set-subs').onchange = e => { saved.subs = e.target.checked; hud.subsOn = saved.subs; persist(); };
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && game?.flow === 'play' && !dlg.open) openPause(); });
}

// タイトル：焚き火の向こうに廃寺が見える固定画角を、ゆっくり揺らす
function titleCamera(dt) {
  titleT += dt;
  applyShot(camera, SHOTS.title, game.terrain);
  camera.rotateY(Math.sin(titleT * 0.12) * 0.035); camera.rotateX(Math.sin(titleT * 0.09) * 0.01);
  camera.position.x += Math.sin(titleT * 0.1) * 0.5; camera.position.z += Math.cos(titleT * 0.1) * 0.35;
}

const clock = new THREE.Clock();
let fpsAcc = 0, fpsN = 0;
function frame() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!game || frozen) return;
  if (game.flow === 'idle') { titleCamera(dt); }
  game.update(dt);
  game.render(dt);
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 1) { window.__fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
}
boot().then(() => renderer.setAnimationLoop(frame)).catch(e => { document.body.append(String(e.stack || e)); console.error(e); $('load-note').textContent = '読み込みに失敗しました：' + (e.message || e); });
