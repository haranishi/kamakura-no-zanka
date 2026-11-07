import { buildKamakuraSea } from './kamakura-sea-view.js';
import { prepareKamakuraFx } from './kamakura-fx-view.js';
import { bindFxContact } from './kamakura-fx.js';
import { buildKamakuraGrass } from './kamakura-grass-view.js';
import { createKamakuraAudio } from './kamakura-audio-view.js';
import { buildKamakuraFacilities } from './kamakura-facility-view.js';
import { facilitiesEnabled, causewayShown } from './kamakura-facilities.js';
// Separate Kamakura composition with a development flight camera. No chapter state, quests, or save access.
import * as THREE from 'three';
import { createKamakuraTerrain, maxWalkSlope, groundEnabled } from './kamakura-terrain.js';
import { buildKamakuraChunks } from './kamakura-chunk-view.js';
import { createKamakuraHUD } from './hud-kamakura.js';
import { Input } from './input.js';
import { TouchInput } from './touch-input.js';
import { CameraRig } from './camera-rig.js';
import { buildColliders, rayClip } from './collision.js';
import { HeroActor, configureLoco, yawOf } from './actors.js';
import { loadRoster } from './characters.js';
import { kamakuraSpawn } from './kamakura-spawn.js';
import { buildKamakuraHouses } from './kamakura-house-view.js';
import { prepareVeg, treesEnabled } from './kamakura-veg.js';
import { buildKamakuraVeg } from './kamakura-veg-view.js';
import { prepareStands, standsEnabled, standPolicy } from './kamakura-stands.js';
import { buildKamakuraStands } from './kamakura-stand-view.js';
import { windUniforms } from './vegetation.js';
import { createWind, stepWind, toUniforms } from './wind.js';
import { createKamakuraPost } from './kamakura-post-view.js';
import { createKamakuraAtmosphere } from './kamakura-atmosphere-view.js';
import { waterEnabled, prepareRivers } from './kamakura-rivers.js';
import { buildKamakuraWater } from './kamakura-water-view.js';
import { adaptOptions, createAdapt, stepAdapt, adaptPolicy, adaptPixelRatio } from './kamakura-adapt.js';
import { createKamakuraFlight, bindKamakuraFlight } from './kamakura-fly-view.js';
import { verticalScale } from './world-entry.js';
export async function bootKamakura(data, search) {
  const t = createKamakuraTerrain(data, verticalScale(search), maxWalkSlope(search)), meta = data.meta;
  const spawn = kamakuraSpawn(t, search);
  if (!t.walkable(spawn.x, spawn.z)) throw new Error('出発点を歩けません');
  // Load the existing hero only. Do not load the chapter's enemies or scenery.
  let roster;
  let post, renderer, chunks, hud, houses, trees, stands, standPrepared, treeOptions, atmosphere, sea, water, hero, input, hintTimer, flight, facilities, hiddenFacilities, audioView, grass, fx;
  const events = new AbortController(); let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; events.abort(); clearTimeout(hintTimer);
    input?.setEnabled(false); input?.base.releaseLock();
    renderer?.setAnimationLoop(null); audioView?.dispose(); fx?.dispose(); grass?.dispose(); flight?.dispose(); hero?.remove(); chunks?.dispose(); houses?.dispose(); trees?.dispose(); stands?.dispose();
    facilities?.dispose(); hiddenFacilities?.dispose(); water?.dispose(); sea?.dispose(); post?.dispose(); atmosphere?.dispose();
    const resources = new Set();
    for (const tpl of roster?.templates.values() || []) tpl.scene.traverse(o => {
      if (o.geometry) resources.add(o.geometry);
      for (const m of [].concat(o.material || [])) { resources.add(m); for (const value of Object.values(m)) if (value?.isTexture) resources.add(value); }
    });
    for (const resource of resources) resource.dispose();
    renderer?.domElement.remove(); renderer?.dispose(); hud?.root.remove();
    style.remove(); document.body.classList.remove('kamakura');
  }
  const wind = windUniforms(); let windState = createWind();
  let vegNotice = data.vegNotice || '';
  let riverNotice = data.riverNotice || '';
  let facilityNotice = data.facilityNotice || '';
  let houseNotice = data.houseNotice || '';
  let audioNotice = '';
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./kamakura.css', import.meta.url).href;
  try {
    document.head.append(style); document.body.classList.add('kamakura');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.info.autoReset = false; // W2c-9r1 light: count scene + every post pass.
    
    const scene = new THREE.Scene();
    const options = adaptOptions(search, matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0);
    const quality = options.quality; let adapt = createAdapt(options.step);
    atmosphere = createKamakuraAtmosphere({ scene, renderer, search, quality });
    // W2c-9f: isolate HDR/grade from the shared valley renderer.
    post = createKamakuraPost({ renderer, quality, search, params: atmosphere.atmosphere?.params, sunDir: atmosphere.sunDir });
    roster = await loadRoster({ names: ['hero'] });
    const camera = new THREE.PerspectiveCamera(58, 1, 0.15, standsEnabled(search) ? 10000 : 7000);
    // W2c-9e: register shared shoreline uniforms before installing ground detail.
    sea = buildKamakuraSea(t, data, { search, quality, sunDir: atmosphere.sunDir }); scene.add(sea.group);
    chunks = buildKamakuraChunks(t, scene, spawn, groundEnabled(search), quality, { data, search });
    if (data.rivers && waterEnabled(search)) {
      try { water = buildKamakuraWater(prepareRivers(data.rivers, t.vscale, quality), { sunDir: atmosphere.sunDir, terrain: t, search, quality }); scene.add(water.group); }
      catch { riverNotice = '川を準備できませんでした。川なしで散策を続けます'; }
    }
    const params = new URLSearchParams(search);
    hud = createKamakuraHUD(meta, params.get('debug') === '1', params.get('debug') === '1' || params.has('fly'));
    hud.status('鎌倉の地形と家を準備しています');
    if (data.houses && new URLSearchParams(search).get('houses') !== '0') {
      try { houses = await buildKamakuraHouses(data.houses, t, scene, { search, quality }); }
      catch { houseNotice = '家を読み込めませんでした。家なしで散策を続けます'; }
    }
    if (data.facilities) {
      try {
        const field = await buildKamakuraFacilities(data.facilities, t, facilitiesEnabled(search) ? scene : new THREE.Scene(), quality, { showHeldBack: causewayShown(search), search });
        if (facilitiesEnabled(search)) facilities = field; else hiddenFacilities = field;
      } catch { facilityNotice = '施設を準備できませんでした。施設なしで散策を続けます'; }
    }
    const facilityExclusions = facilities?.exclusionBoxes || hiddenFacilities?.exclusionBoxes || [];
    let houseExclusions = houses?.boxes || [];
    if (!houses && data.houses) {
      try {
        const hidden = await buildKamakuraHouses(data.houses, t, new THREE.Scene(), { search: '?htex=0' });
        houseExclusions = hidden.boxes; hidden.dispose();
      } catch { houseNotice = '家の除外範囲を準備できませんでした'; }
    }
    if (data.veg && treesEnabled(search)) {
      try {
        // House exclusions also apply when the houses are hidden for comparison.
        const prepared = prepareVeg(data.veg, t, { boxes: [...houseExclusions, ...facilityExclusions], paths: data.patches?.paths || {}, spawn });
        trees = buildKamakuraVeg(prepared, { wind, sunDir: atmosphere.sunDir, quality, renderer });
        scene.add(trees.group);
        if (standsEnabled(search)) {
          standPrepared = prepareStands(data.veg, t, { boxes: [...houseExclusions, ...facilityExclusions], paths: data.patches?.paths || {}, spawn }, standPolicy(quality));
          treeOptions = { wind, sunDir: atmosphere.sunDir, quality, renderer };
        }
      } catch { vegNotice = '木を準備できませんでした。木なしで散策を続けます'; }
    }
    hiddenFacilities?.dispose(); hiddenFacilities = null;
    const status = text => hud.status(text || [houseNotice, facilitiesEnabled(search) && facilityNotice, waterEnabled(search) && riverNotice, treesEnabled(search) && vegNotice, groundEnabled(search) && data.groundNotice, atmosphere.notice, audioNotice].filter(Boolean).join('。'));
    const g = { scene, roster, terrain: t, col: buildColliders({ bounds: t.bounds, extraBoxes: [...(houses?.boxes || []), ...(facilities?.boxes || [])], extraCircles: trees?.circles || [] }), enemies: [], ally: null };
    if (standPrepared) {
      try { stands = buildKamakuraStands(standPrepared, { ...treeOptions, colliders: g.col }); scene.add(stands.group); }
      catch { vegNotice = '林分を準備できませんでした。一本ずつの木で散策を続けます'; }
    }
    // Share the live trunk index with collision; index hidden comparison boxes separately.
    const grassExtra = buildColliders({ bounds: t.bounds, extraBoxes: [...(!houses ? houseExclusions : []), ...(!facilities ? facilityExclusions : [])] });
    grass = buildKamakuraGrass({ data, terrain: t, colliders: g.col, extraColliders: grassExtra, facilityBoxes: (facilities || hiddenFacilities)?.records.filter(r => ['hall','buddha','stairs','sando','platform','kairo'].includes(r.node.part)).map(r => r.bounds) || [], search, wind, sunDir: atmosphere.sunDir, quality });
    scene.add(grass.group);
    audioView = createKamakuraAudio({ search, terrain: t, button: hud.sound,
      flying: () => !!flight?.active,
      onUnavailable: text => { audioNotice = text; status(''); } });
    audioView.attach(g);
    g.hero = hero = new HeroActor(g, spawn);
    // W2c-9d: preserve the base footstep before adding local river and dust effects.
    fx = await prepareKamakuraFx({ terrain: t, data, search, quality }, undefined, { defer: true }); scene.add(fx.group);
    g.fx = fx.api; bindFxContact(hero, fx);
    g.hud = { hint: (_id, text, ms) => {
      clearTimeout(hintTimer); status(text);
      hintTimer = setTimeout(() => { if (!paused) status(''); }, ms);
    } };
    const rig = new CameraRig(camera); rig.yaw = spawn.yaw;
    // Prepare the immediate neighborhood in bounded frames before accepting movement.
    while (!chunks.ready(spawn) || (houses && !houses.ready(spawn))) { chunks.update(spawn); houses?.update(spawn); await new Promise(requestAnimationFrame); }
    if (stands) {
      const startCamera = { position: { ...spawn, y: t.heightAt(spawn.x, spawn.z) } };
      while (stands.update(startCamera).pending) await new Promise(requestAnimationFrame);
    }
    const view = document.getElementById('view'); view.append(renderer.domElement); view.setAttribute('aria-label', '鎌倉を歩く3Dシーン');
    const base = new Input(renderer.domElement, { signal: events.signal });
    input = new TouchInput(base, renderer.domElement, hud.run, { signal: events.signal, upButton: hud.up, downButton: hud.down });
    let paused = false, skipAdaptFrame = true;
    function setPaused(on) {
      paused = on; audioView.setPaused(on); skipAdaptFrame = true; input.setEnabled(!on);
      // Clear the locomotive momentum on pause; release alone retains the existing smooth stop.
      g.hero.speed = g.hero.locoV = g.hero.locoA = 0;
      if (on) base.releaseLock();
      hud.pause.textContent = on ? '再開' : '休止'; status(on ? '休止中。「再開」で散策に戻ります' : '');
    }
    flight = createKamakuraFlight({ search, terrain: t, spawn, camera, rig, hero, chunks, houses, trees, stands, water, atmosphere, hud,
      hint: text => g.hud.hint('flight', text, 2200) });
    bindKamakuraFlight({ flight, input, hud, element: renderer.domElement, paused: () => paused, signal: events.signal });
    hud.pause.addEventListener('click', () => setPaused(!paused), { signal: events.signal });
    base.onLockChange = locked => { if (!locked) setPaused(true); };
    addEventListener('keydown', e => { if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) setPaused(!paused); }, { signal: events.signal });
    addEventListener('blur', () => setPaused(true), { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); }, { signal: events.signal });
    let postDpr = devicePixelRatio;
    const resize = () => { postDpr = devicePixelRatio; renderer.setPixelRatio(adaptPixelRatio(devicePixelRatio, quality, adapt.step)); renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); flight.resize(); post.resize(); };
    const applyAdapt = () => { const policy = adaptPolicy(adapt.step); post.setAdapt(adapt.step); atmosphere.setAdapt(policy); trees?.setAdapt(policy); stands?.setAdapt(policy); facilities?.setAdapt(policy); grass?.setAdapt(adapt.step); fx?.setAdapt(adapt.step); houses?.setAdapt(adapt.step); chunks?.setAdapt(adapt.step); sea?.setAdapt(adapt.step); water?.setAdapt(adapt.step); };
    applyAdapt();
    addEventListener('resize', resize, { signal: events.signal }); resize(); setPaused(false);
    configureLoco(search);
    // W2c-9p: warm only the close grass; outer cells and fish index follow the first draw.
    if (!flight.active) rig.update(0, hero.pos, { groundAt: t.heightAt, rayClip: (a, b) => rayClip(g.col, t, a, b, 0.3, { ignoreThin: 0.2 }) });
    grass.warm(camera, flight.pos);
    let last = performance.now();
    renderer.setAnimationLoop(now => {
      const rawDt = Math.max(0, (now - last) / 1000), dt = Math.min(rawDt, .05); last = now;
      const oldStep = adapt.step;
      adapt = stepAdapt(adapt, rawDt, { paused: paused || skipAdaptFrame, hidden: document.hidden, enabled: options.enabled });
      skipAdaptFrame = false;
      if (paused || document.hidden) return; // W2c-9f: no redraw while paused.
      if (postDpr !== devicePixelRatio) resize();
      if (adapt.step !== oldStep) { applyAdapt(); resize(); }
      if (!paused && flight.active) {
        const look = input.flightLook(dt);
        flight.step({ ...input.flightAxis(), ...look }, dt); input.endFrame();
      } else if (!paused) {
        const look = input.look(dt), ax = input.axis(), yaw = rig.yaw;
        const vx = -Math.sin(yaw) * ax.forward + Math.cos(yaw) * ax.right, vz = -Math.cos(yaw) * ax.forward - Math.sin(yaw) * ax.right;
        const hero = g.hero, ch = hero.character;
        ch.splitPose = true; ch.legIk = true; ch.legTerrain = t;
        hero.updateLocomotion(dt, { input, axis: ax, moveYaw: yawOf(vx, vz) }, false);
        hero.slideTurn += (hero.slideWant - hero.slideTurn) * (1 - Math.exp(-12 * dt)); hero.slideWant = 0;
        hero.tickCharacter(dt); hero.sync(); ch.finishPose();
        rig.update(dt, hero.pos, { lookDx: look.dx, lookDy: look.dy, zoom: input.wheel, groundAt: t.heightAt,
          rayClip: (a, b) => rayClip(g.col, t, a, b, 0.3, { ignoreThin: 0.2 }) });
        input.endFrame();
      }
      audioView.update(rawDt, flight.pos);
      sea.update(paused ? 0 : dt, camera.position, audioView.audio.context?.currentTime);
      windState = stepWind(windState, dt, { paused });
      const uniforms = toUniforms(windState);
      wind.uTime.value = uniforms.uTime; wind.uWind.value = uniforms.uWind;
      wind.uWindDir.value.set(...uniforms.uWindDir); wind.uGuideMix.value = uniforms.uGuideMix;
      grass.updateHero(hero.pos, hero.speed, flight.active, paused ? 0 : dt);
      renderer.info.reset(); // W2c-9r1 light: one reset before all frame draws.
      flight.updateViews(uniforms.uTime, paused ? 0 : dt); facilities?.update(flight.pos); grass.update(camera, flight.pos, paused); fx.update(paused ? 0 : dt, camera, hero); post.render(scene, camera);
      hud.update(flight.pos, flight.yaw, t, { ...renderer.info.render, averageMs: adapt.averageMs, step: adapt.step }, flight.state, audioView.debugText());
    });
    return { dispose };
  } catch (error) {
    dispose(); throw error;
  }
}
