// Separate walk-only composition. No chapter state, quests, or save access.
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
import { createKamakuraAtmosphere } from './kamakura-atmosphere-view.js';
import { verticalScale } from './world-entry.js';
export async function bootKamakura(data, search) {
  const t = createKamakuraTerrain(data, verticalScale(search), maxWalkSlope(search)), meta = data.meta;
  const spawn = kamakuraSpawn(t, search);
  if (!t.walkable(spawn.x, spawn.z)) throw new Error('出発点を歩けません');
  // Load the existing hero only. Do not load the chapter's enemies or scenery.
  let roster;
  let renderer, chunks, hud, houses, trees, stands, standPrepared, treeOptions, atmosphere, sea, hero, input, hintTimer;
  const events = new AbortController(); let disposed = false;
  function dispose() {
    if (disposed) return; disposed = true; events.abort(); clearTimeout(hintTimer);
    input?.setEnabled(false); input?.base.releaseLock();
    renderer?.setAnimationLoop(null); hero?.remove(); chunks?.dispose(); houses?.dispose(); trees?.dispose(); stands?.dispose();
    sea?.geometry.dispose(); sea?.material.dispose(); atmosphere?.dispose();
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
  let houseNotice = data.houseNotice || '';
  const style = document.createElement('link'); style.rel = 'stylesheet'; style.href = new URL('./kamakura.css', import.meta.url).href;
  try {
    document.head.append(style); document.body.classList.add('kamakura');
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
    const scene = new THREE.Scene();
    const quality = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0 || new URLSearchParams(search).get('q') === 'light' ? 'light' : 'standard';
    atmosphere = createKamakuraAtmosphere({ scene, renderer, search, quality });
    roster = await loadRoster({ names: ['hero'] });
    const camera = new THREE.PerspectiveCamera(58, 1, 0.15, standsEnabled(search) ? 10000 : 7000);
    chunks = buildKamakuraChunks(t, scene, spawn, groundEnabled(search));
    const seaG = new THREE.PlaneGeometry((t.bounds.maxX - t.bounds.minX) * 1.2, (t.bounds.maxZ - t.bounds.minZ) * 1.2);
    seaG.rotateX(-Math.PI / 2);
    sea = new THREE.Mesh(seaG, new THREE.MeshLambertMaterial({ color: 0x426f83 })); scene.add(sea);
    hud = createKamakuraHUD(meta, new URLSearchParams(search).get('debug') === '1');
    hud.status('鎌倉の地形と家を準備しています');
    if (data.houses && new URLSearchParams(search).get('houses') !== '0') {
      try { houses = await buildKamakuraHouses(data.houses, t, scene); }
      catch { houseNotice = '家を読み込めませんでした。家なしで散策を続けます'; }
    }
    if (data.veg && treesEnabled(search)) {
      try {
        // House exclusions also apply when the houses are hidden for comparison.
        const hiddenHouses = !houses && data.houses ? await buildKamakuraHouses(data.houses, t, new THREE.Scene()) : null;
        try {
          const prepared = prepareVeg(data.veg, t, { boxes: houses?.boxes || hiddenHouses?.boxes || [], paths: data.patches?.paths || {}, spawn });
          trees = buildKamakuraVeg(prepared, { wind, sunDir: atmosphere.sunDir, quality, renderer });
          scene.add(trees.group);
          if (standsEnabled(search)) {
            standPrepared = prepareStands(data.veg, t, { boxes: houses?.boxes || hiddenHouses?.boxes || [], paths: data.patches?.paths || {}, spawn }, standPolicy(quality));
            treeOptions = { wind, sunDir: atmosphere.sunDir, quality, renderer };
          }
        } finally { hiddenHouses?.dispose(); }
      } catch { vegNotice = '木を準備できませんでした。木なしで散策を続けます'; }
    }
    const status = text => hud.status(text || [houseNotice, treesEnabled(search) && vegNotice, groundEnabled(search) && data.groundNotice, atmosphere.notice].filter(Boolean).join('。'));
    const g = { scene, roster, terrain: t, col: buildColliders({ bounds: t.bounds, extraBoxes: houses?.boxes || [], extraCircles: trees?.circles || [] }), enemies: [], ally: null };
    if (standPrepared) {
      try { stands = buildKamakuraStands(standPrepared, { ...treeOptions, colliders: g.col }); scene.add(stands.group); }
      catch { vegNotice = '林分を準備できませんでした。一本ずつの木で散策を続けます'; }
    }
    g.hero = hero = new HeroActor(g, spawn);
    // W2c-1 has no audio. Contacts and IK continue to run through the existing character.
    g.hero.onFootContact = () => {};
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
    input = new TouchInput(base, renderer.domElement, hud.run, { signal: events.signal });
    let paused = false;
    function setPaused(on) {
      paused = on; input.setEnabled(!on);
      // Clear the locomotive momentum on pause; release alone retains the existing smooth stop.
      g.hero.speed = g.hero.locoV = g.hero.locoA = 0;
      if (on) base.releaseLock();
      hud.pause.textContent = on ? '再開' : '休止'; status(on ? '休止中。「再開」で散策に戻ります' : '');
    }
    hud.pause.onclick = () => setPaused(!paused);
    base.onLockChange = locked => { if (!locked) setPaused(true); };
    addEventListener('keydown', e => { if ((e.code === 'KeyP' || e.code === 'Escape') && !e.repeat) setPaused(!paused); }, { signal: events.signal });
    addEventListener('blur', () => setPaused(true), { signal: events.signal });
    document.addEventListener('visibilitychange', () => { if (document.hidden) setPaused(true); }, { signal: events.signal });
    const resize = () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); };
    addEventListener('resize', resize, { signal: events.signal }); resize(); setPaused(false);
    configureLoco(search);
    let last = performance.now();
    renderer.setAnimationLoop(now => {
      const dt = Math.max(0, Math.min((now - last) / 1000, 0.05)); last = now;
      if (!paused) {
        const look = input.look(dt), ax = input.axis(), yaw = rig.yaw;
        const vx = -Math.sin(yaw) * ax.forward + Math.cos(yaw) * ax.right, vz = -Math.cos(yaw) * ax.forward - Math.sin(yaw) * ax.right;
        const hero = g.hero, ch = hero.character;
        ch.splitPose = true; ch.legIk = true; ch.legTerrain = t;
        hero.updateLocomotion(dt, { input, axis: ax, moveYaw: yawOf(vx, vz) }, false);
        hero.slideTurn += (hero.slideWant - hero.slideTurn) * (1 - Math.exp(-12 * dt)); hero.slideWant = 0;
        hero.tickCharacter(dt); hero.sync(); ch.finishPose();
        rig.update(dt, hero.pos, { lookDx: look.dx, lookDy: look.dy, zoom: input.wheel, groundAt: t.heightAt,
          rayClip: (a, b) => rayClip(g.col, t, a, b, 0.3, { ignoreThin: 0.2 }) });
        hud.update(hero.pos, rig.yaw, t); input.endFrame();
      }
      windState = stepWind(windState, dt, { paused });
      const uniforms = toUniforms(windState);
      wind.uTime.value = uniforms.uTime; wind.uWind.value = uniforms.uWind;
      wind.uWindDir.value.set(...uniforms.uWindDir); wind.uGuideMix.value = uniforms.uGuideMix;
      chunks.update(g.hero.pos); houses?.update(g.hero.pos); trees?.update(camera); stands?.update(camera);
      atmosphere.update(camera, paused ? 0 : dt, g.hero.pos, rig.yaw); renderer.render(scene, camera);
    });
    return { dispose };
  } catch (error) {
    dispose(); throw error;
  }
}
