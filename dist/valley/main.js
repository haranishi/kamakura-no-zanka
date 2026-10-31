import { assignTreeSpecies, scatterUnderstory } from './tree-species.js';
// main.js — 縦切りの起動（app層）。読み込み → タイトル → 遊び。描画器・操作・音・UI・設定・一時停止・各ボタンを組み立てる。
import * as THREE from 'three';
import { WORLD } from './world-data.js';
import { createGrassField, coverMap } from './grass-field.js';
import { createTerrain } from './terrain-height.js';
import { buildTerrain, loadGroundTextures } from './terrain.js';
import { installFog, createAtmosphere } from './atmosphere.js';
import { Post } from './post.js';
import { SHOTS, applyShot } from './shots.js';
import { scatterTrees, scatterRocks, scatterRice, scatterCrops } from './scatter.js';
import { buildRidges } from './ridges.js';
import { buildVegetation } from './vegetation.js';
import { loadModels, buildBuildings, buildRocks } from './buildings.js';
import { loadPropModels, buildProps } from './props.js';
import { buildWater } from './water.js';
import { loadRoster } from './characters.js';
import { HUD } from './hud.js';
import { Input } from './input.js';
import { ValleyAudio } from './audio-valley.js';
import { normalizeWaymarks } from './guide-view.js';
import { Game } from './game.js';
import { loadValley } from './save.js';
import { applyLookOverrides, LOOK } from './config.js';
import { ATMOS } from './atmosphere.js';
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
// 見た目の調整を、書き換えずに試せる（?lk=fog:0.0008,mist:0.002,sun:3.6,hemi:0.7,env:1,exp:1.05,bloom:0.4,vig:0.3,sat:1.1,con:1.06,warm:1.5）
// 太陽の向き sx,sy,sz／霧の暖色の広がり hexp／色は末尾 c のキーに16進6桁（sunc zenc midc horc belc fogc hzcoolc hzwarmc hemisc hemigc）
if (LOOK.fog != null) ATMOS.fogDensity = LOOK.fog;
if (LOOK.mist != null) ATMOS.mist = { ...ATMOS.mist, density: LOOK.mist };
if (LOOK.sun != null) ATMOS.sunIntensity = LOOK.sun;
if (LOOK.hemi != null) ATMOS.hemiIntensity = LOOK.hemi;
if (LOOK.env != null) ATMOS.envIntensity = LOOK.env;
if (LOOK.sx != null || LOOK.sy != null || LOOK.sz != null) ATMOS.sunDir.set(LOOK.sx ?? ATMOS.sunDir.x, LOOK.sy ?? ATMOS.sunDir.y, LOOK.sz ?? ATMOS.sunDir.z).normalize();
if (LOOK.hexp != null) ATMOS.hazeExp = LOOK.hexp;
if (LOOK.fill != null) ATMOS.fillIntensity = LOOK.fill;
for (const [k, key] of [['sunc', 'sunColor'], ['zenc', 'zenith'], ['midc', 'mid'], ['horc', 'horizon'], ['belc', 'below'], ['fogc', 'fogColor'], ['hzcoolc', 'hazeCool'], ['hzwarmc', 'hazeWarm'], ['hemisc', 'hemiSky'], ['hemigc', 'hemiGround']]) if (LOOK[k] != null) ATMOS[key] = LOOK[k];
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
for (const [k, key] of [['exp', 'exposure'], ['bloom', 'bloomStrength'], ['vig', 'vignette'], ['sat', 'saturation'], ['con', 'contrast'], ['warm', 'warmth'], ['grain', 'grain']]) if (LOOK[k] != null) post.params[key] = LOOK[k];
const input = new Input(renderer.domElement);
const audio = new ValleyAudio(msg => hud.toast(msg, 3000));
let game = null, frozen = false, titleT = 0;

// 描画の解像度は、重いと感じたら自動で下げ、余裕があれば戻す（コマ時間の移動平均で判断）。?w= の固定撮影・QA では動かさない。
const SCALES = [1, 0.85, 0.7, 0.58];
let scaleIdx = 0, scaleCool = 0, ftAcc = 0, ftN = 0, probeWait = 10, lastRaiseAt = -99, clockT = 0;
const autoScale = !q.get('w') && q.get('autoscale') !== '0';
function resize() {
  const w = Number(q.get('w') || innerWidth), h = Number(q.get('h') || innerHeight), pr = (q.get('w') ? 1 : Math.min(devicePixelRatio, quality === 'light' ? 1 : 1.5)) * SCALES[scaleIdx];
  renderer.setPixelRatio(pr); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); post.setSize(w, h, pr);
}
function adaptScale(dt) {
  if (!autoScale || !game || game.flow === 'idle' || document.hidden) return;
  ftAcc += dt; ftN++; scaleCool -= dt; clockT += dt;
  if (ftN < 90) return;
  const ms = ftAcc / ftN * 1000; ftAcc = 0; ftN = 0;
  if (scaleCool > 0) return;
  if (ms > 24 && scaleIdx < SCALES.length - 1) {                                                  // 40fps を割ったら下げる
    if (clockT - lastRaiseAt < 6) probeWait = Math.min(90, probeWait * 2);                       // 戻した直後にまた重くなったら、次に戻すまでを長く
    scaleIdx++; scaleCool = probeWait; resize();
  } else if (ms < 18.5 && scaleIdx > 0) { scaleIdx--; scaleCool = 6; lastRaiseAt = clockT; resize(); }   // 60fps を保てるなら戻して試す
}

async function boot() {
  hud.setState('loading');
  const step = async (p, note) => { hud.loading(p, note); await wait(16); };
  await step(0.02, '地形の質感を読み込んでいます');
  const terrain = createTerrain(WORLD);
  const textures = await loadGroundTextures(new URL('../assets/valley/terrain/', import.meta.url).href, renderer.capabilities.getMaxAnisotropy());
  await step(0.12, '谷の地形を組み立てています');
  const built = buildTerrain({ terrain, textures, quality }); scene.add(built.group); live.built = built;
  await step(0.2, '木と岩を植えています');
  const trees = scatterTrees(WORLD, terrain);
  const species = assignTreeSpecies(WORLD, terrain, trees);
  const understory = scatterUnderstory(WORLD, terrain, trees);
  const scatter = { trees, species, understory, rocks: scatterRocks(WORLD, terrain), rice: scatterRice(WORLD, terrain), crops: scatterCrops(WORLD, terrain) };
  await step(0.28, '建物を読み込んでいます');
  const aniso = renderer.capabilities.getMaxAnisotropy();
  const [models, propModels] = await Promise.all([loadModels({ anisotropy: aniso }), loadPropModels({ anisotropy: aniso })]);
  const field = createGrassField(WORLD, terrain); live.grassField = field;
  built.setMeadowCover(coverMap(field));
  const veg = buildVegetation({ scatter, quality, field, sunDir: ATMOS.sunDir }); scene.add(veg.group); live.scatter = scatter; live.scene = scene;
  scene.add(buildBuildings({ world: WORLD, terrain, models }).group);
  scene.add(buildRocks({ data: scatter.rocks, model: models.boulder_lo || models.boulder }));
  const props = buildProps({ world: WORLD, terrain, models: { ...models, ...propModels } }); scene.add(props.group);
  const water = buildWater({ terrain, world: WORLD, sunDir: ATMOS.sunDir }); scene.add(water.mesh);
  scene.add(buildRidges({ center: [WORLD.valley.cx, WORLD.valley.cz] }));          // 谷の外の山並み（霧で霞む稜線）
  await step(0.42, '人物を読み込んでいます');
  const roster = await loadRoster({ anisotropy: renderer.capabilities.getMaxAnisotropy(), onProgress: p => hud.loading(0.42 + p * 0.45, '人物を読み込んでいます') });
  await step(0.9, '空と光を整えています');
  const atmosphere = createAtmosphere({ scene, renderer, quality });
  resize();
  await step(0.95, '道と見通しを調べています');
  game = new Game({ scene, camera, renderer, post, atmosphere, veg, props, water, terrain, scatter, roster, hud, audio, input, storage: (() => { try { return localStorage; } catch { return null; } })(), seed: Number(q.get('seed') || 1333),
    models: { ...models, ...propModels } });   // オープニングの舞台が、建物・小道具の複製を作るのに使う（形と材質は共有）
  game.skipIntro = q.get('intro') === '0';
  applySettings(saved);
  await step(0.98, '道しるべを用意しています');
  game.warmGuide();
  applyShot(camera, SHOTS.title, terrain);
  game.veg.grass.warm(camera);
  await step(1, '準備ができました');
  wire();
  if (QA) installQA(game, { setFrozen: v => { frozen = v; }, start, quality: setQuality, meadowCover: () => built.meadowCover() });
  hud.setState('title'); hud.showTitle(loadValley(game.storage).hasSave);
  document.getElementById('loading').classList.add('hidden');
  window.__valleyReady = true;
  if (q.get('autostart')) start(q.get('autostart') === 'continue' ? 'continue' : 'new');
}

// 設定（感度・反転・揺れ・音量・字幕・品質）。保存は端末の中だけ。
function applySettings(s) {
  const set = { quality, sens: 1, invert: false, shake: 1, volume: 0.8, subs: true, ...s };
  set.waymarks = normalizeWaymarks(set.waymarks);
  game.settings.waymarks = set.waymarks; $('set-waymarks').value = set.waymarks;
  game.setWaymarks = level => { saved.waymarks = normalizeWaymarks(level); game.settings.waymarks = saved.waymarks; $('set-waymarks').value = saved.waymarks; persist(); game.updateGuide(0); };
  game.rig.sensitivity = set.sens; game.rig.invert = set.invert; game.rig.shakeScale = set.shake; game.settings.shake = set.shake;
  audio.setVolume(set.volume); hud.subsOn = set.subs;
  $('set-quality').value = set.quality; $('set-sens').value = set.sens; $('set-invert').checked = set.invert; $('set-shake').value = set.shake; $('set-volume').value = set.volume; $('set-subs').checked = set.subs;
  Object.assign(saved, set);
}
function persist() { store.set(SETTINGS_KEY, JSON.stringify(saved)); }
// 品質の切り替え：後処理・影・解像度のほか、草や木の描く範囲と地面の細かさも変える（以前は後処理と影だけで、三角形が減らなかった）
const live = {};
function setQuality(v) {
  quality = v; saved.quality = v; persist(); post.setQuality(v); game.atmosphere.setQuality(v);
  live.built?.setQuality(v);
  if (live.scatter && game.veg) {
    const old = game.veg; live.scene.remove(old.group);
    const veg = buildVegetation({ scatter: live.scatter, quality: v, field: live.grassField, sunDir: ATMOS.sunDir }); live.scene.add(veg.group); game.veg = veg;
    old.grass.dispose();
    old.trees.dispose();
    veg.grass.warm(camera);
    old.group.traverse(o => {                                                  // 作り直す前の GPU 資源を解放する（切り替えのたびに増えない）
      if (!o.isMesh) return;
      if (o.isInstancedMesh) o.dispose();
      o.geometry?.dispose();
      for (const m of [].concat(o.material)) { m.map?.dispose(); m.dispose(); }
    });
  }
  resize();
}

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
  // タイトルから開いたときは、遊びの途中の項目（区切りへ戻る・タイトルへ）を出さない。オープニングの間は、戻る区切りがまだ無い
  const inGame = game?.flow !== 'idle';
  $('pause-checkpoint').classList.toggle('hidden', !inGame || game?.flow === 'intro'); $('pause-title').classList.toggle('hidden', !inGame);
  $('pause-resume').textContent = inGame ? 'つづける' : '閉じる';
  dlg.showModal();
}

// 遊びの間とオープニングの間は、Esc（ポインターの解放）・P・画面の切り替えで休止する
const pausable = () => game?.flow === 'play' || game?.flow === 'intro';
function wire() {
  $('btn-start').onclick = () => start('new');
  $('btn-continue').onclick = () => start('continue');
  $('btn-howto').onclick = openPause;
  $('menu-btn').onclick = openPause;
  const dlg = $('pause');
  dlg.addEventListener('close', () => { if (!game) return; game.paused = false; if (game.flow !== 'idle') audio.setPaused(false); if (pausable() && !QA) input.requestLock(); });
  $('pause-resume').onclick = () => dlg.close();
  $('pause-checkpoint').onclick = () => { dlg.close(); if (game.flow !== 'idle') game.toCheckpoint(); };
  $('pause-title').onclick = () => { location.href = location.pathname; };
  $('result-again').onclick = () => { game.hud.hideResult(); game.flow = 'idle'; start('new'); };
  $('result-title').onclick = () => { location.href = location.pathname; };
  $('death-retry').onclick = () => game.retry();
  input.onLockChange = locked => { if (!locked && pausable() && !dlg.open && !QA) openPause(); };
  addEventListener('keydown', e => { if (e.code === 'KeyP' && pausable() && !dlg.open) openPause(); });
  $('set-waymarks').onchange = e => game.setWaymarks(e.target.value);
  $('set-quality').onchange = e => { setQuality(e.target.value); };
  $('set-sens').oninput = e => { saved.sens = Number(e.target.value); game.rig.sensitivity = saved.sens; persist(); };
  $('set-invert').onchange = e => { saved.invert = e.target.checked; game.rig.invert = saved.invert; persist(); };
  $('set-shake').oninput = e => { saved.shake = Number(e.target.value); game.rig.shakeScale = saved.shake; game.settings.shake = saved.shake; persist(); };
  $('set-volume').oninput = e => { saved.volume = Number(e.target.value); audio.setVolume(saved.volume); persist(); };
  $('set-subs').onchange = e => { saved.subs = e.target.checked; hud.subsOn = saved.subs; persist(); };
  addEventListener('resize', resize);
  document.addEventListener('visibilitychange', () => { if (document.hidden && pausable() && !dlg.open) openPause(); });
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
// 1コマの処理。例外で繰り返しが止まると、画面が固まって戻れない（矢で倒れたときに実際に起きた）。止めずに記録して続ける。
let frameErrors = 0;
function frame() {
  try { tick(); } catch (e) {
    if (frameErrors++ < 3) console.error('frame error', e);
    if (frameErrors === 1) hud.toast('不具合が起きた。直らなければ Esc →「区切りからやり直す」', 7000);
  }
}
function tick() {
  const dt = Math.min(clock.getDelta(), 0.1);
  if (!game || frozen) return;
  if (game.flow === 'idle') { titleCamera(dt); }
  game.update(dt);
  game.render(dt);
  adaptScale(dt);
  fpsAcc += dt; fpsN++;
  if (fpsAcc >= 1) { window.__fps = Math.round(fpsN / fpsAcc); fpsAcc = 0; fpsN = 0; }
}
boot().then(() => renderer.setAnimationLoop(frame)).catch(e => { document.body.append(String(e.stack || e)); console.error(e); $('load-note').textContent = '読み込みに失敗しました：' + (e.message || e); });
