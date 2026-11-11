// W2c-17a: a bounded pool of scenery people. Character/GLBs are loaded only after drawn frames.
import * as THREE from '../vendor/three.module.min.js';
import { PEOPLE, PEOPLE_ROLES, PEOPLE_CLIPS, peopleAmount, peopleLimit, peopleStride,
  peoplePlacementBatches, createPersonState, resetPerson, stepPerson, avoidPerson, FLIGHT, sampleFlight, selectFlightPeople } from './kamakura-people.js';

import { CROWD, crowdShape } from './kamakura-crowd.js';

const WHO = ['villager_m', 'villager_f', 'child'];
const COLOURS = [0x18d9ff, 0xff38a0, 0xffe02b, 0x65ff25, 0xac54ff, 0xff701c, 0xeeeeee];
const DEPS = () => import('./characters.js');
function releaseRoster(roster) {
  if (!roster) return;
  const geometries = new Set(), materials = new Set(), textures = new Set(), skeletons = new Set();
  for (const tpl of roster.templates.values()) tpl.scene.traverse(o => {
    if (o.geometry) geometries.add(o.geometry);
    if (o.skeleton) skeletons.add(o.skeleton);
    for (const m of Array.isArray(o.material) ? o.material : o.material ? [o.material] : []) {
      materials.add(m); for (const v of Object.values(m)) if (v?.isTexture) textures.add(v);
    }
  });
  for (const v of skeletons) v.dispose();
  for (const v of geometries) v.dispose();
  for (const v of textures) v.dispose();
  for (const v of materials) v.dispose();
  roster.templates.clear();
}
export function createKamakuraPeople(context, dependencies = {}) {
  const amount = peopleAmount(context.search); if (!amount) return null;
  const range = context.quality === 'light' ? PEOPLE.lightRange : PEOPLE.range;
  const debug = new URLSearchParams(context.search).get('debug') === '1';
  const pillars = new URLSearchParams(context.search).get('peopledebug') === '1';
  const loadModule = dependencies.loadModule || DEPS;
  const job = peoplePlacementBatches(context, amount), slots = [], chosen = new Int32Array(PEOPLE.max), distances = new Float64Array(PEOPLE.max);
  const flightChosen = new Int32Array(FLIGHT.priority), movingSpots = [];
  const roster = { templates: new Map(), meta: null }, viewProjection = new THREE.Matrix4(), projected = new THREE.Vector3();
  const playOptions = { fade: .25, restart: true, from: 0, timeScale: 1 };
  let Character, site, spots = [], ready = false, started = false, loaded = false, failed = false, disposed = false, paused = false, step = 0;
  let frames = 0, time = 0, routeTime = 0, centerX = Infinity, centerZ = Infinity, count = 0, nearby = 0, overlaps = 0, bows = 0, boneUpdates = 0;
  let lastX = context.hero?.pos.x || 0, lastZ = context.hero?.pos.z || 0, refresh = true, births = 0, removals = 0;
  let pillarGeometry = null, pillarMaterials = null, grace = 0, arrived = false, flying = false;
  const camera = context.camera, viewer = {x:0,z:0};
  const ownsDebug = () => {
    const byRole = Object.fromEntries(PEOPLE_ROLES.map(role => [role, 0])); let nearest = null;byRole.traveller=0;
    for (const slot of slots) if (slot.live) {
      const s = slot.state, p = s.spot, dx = s.x - lastX, dz = s.z - lastZ, distance = Math.hypot(dx, dz);
      byRole[p.role]++;
      if (!nearest || distance < nearest.distance) nearest = { role: p.role, who: p.who, distance, bearing: (Math.atan2(dx, -dz) * 180 / Math.PI + 360) % 360 };
    }
    let triangles=0,draws=0;
    for(const slot of slots) if(slot.live) for(const mesh of slot.meshes) { triangles+=(mesh.geometry?.index?.count || mesh.geometry?.attributes?.position?.count || 0)/3;draws++; }
    for(const slot of slots)if(slot.live&&slot.equipment?.visible){triangles+=slot.equipment.geometry.attributes.position.count/3;draws++;}
    return { triangles,draws,time:routeTime,loaded, active: count, spots: nearby, nearest, byRole, overlaps, boneUpdates, pool: slots.length, births, removals, failed,
      // Debug-only copies make it possible to find each role without publishing world coordinates.
      actors: debug ? slots.filter(s => s.live).map(s => ({ id: s.state.spot.id, spotX: s.state.spot.x, spotZ: s.state.spot.z, x: s.state.x, z: s.state.z, role: s.state.spot.role, clip: s.state.clip, yaw: s.state.yaw, head: s.state.head, bones: s.state.bones, shadow: s.meshes.some(m => m.castShadow), enteredDistance: s.enteredDistance, enteredOffscreen: s.enteredOffscreen })) : undefined,
      locations: debug ? spots.map(p => ({ role: p.role, who: p.who, x: p.x, z: p.z })) : undefined };
  };
  if (debug) globalThis.__kzPeople = ownsDebug;
  function hide(slot) {
    if (!slot.live) return;
    slot.state.spot.lastBow = slot.state.lastBow;
    slot.live = false; slot.ch.root.visible = false; count--; removals++;
  }
  function closeSlot(slot) {
    hide(slot); if(slot.equipment){slot.equipment.geometry.dispose();slot.equipment.material.dispose();slot.equipment.removeFromParent();slot.equipment=null;} slot.ch.dispose(); slot.pillar?.removeFromParent();
  }
  function close() {
    for (const slot of slots) closeSlot(slot); slots.length = 0;
    pillarGeometry?.dispose(); if (pillarMaterials) for (const m of pillarMaterials) m.dispose();
    pillarGeometry = pillarMaterials = null; releaseRoster(roster); loaded = false;
  }
  function reportLoadFailure(error) {
    // Expected optional-asset failure: close just this layer, retain a diagnostic for the parent.
    failed = true; close();
    if (!disposed) console.warn('Kamakura people closed after a character load failure:', error);
  }
  async function beginLoad() {
    try {
      const api = await loadModule(); if (disposed) return; Character = api.Character;
      // One GLB per await. Successfully loaded templates are owned even if a later request fails.
      for (const who of WHO) {
        const part = await api.loadRoster({ names: [who] });
        if (disposed || failed) { releaseRoster(part); return; }
        roster.meta = part.meta;
        for (const [name, tpl] of part.templates) roster.templates.set(name, tpl);
        part.templates.clear();
      }
      for (const who of WHO) {
        const tpl = roster.templates.get(who);
        for (const name of PEOPLE_CLIPS) if (!tpl.clips.has(name)) throw new Error(`People clip missing: ${who}/${name}`);
      }
      loaded = true; refresh = true;
    } catch (error) { reportLoadFailure(error); }
  }
  function offscreen(x, z) {
    if (!camera) return true;
    projected.set(x, context.terrain.heightAt(x, z) + 1, z).applyMatrix4(viewProjection);
    return projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > 1.15 || Math.abs(projected.y) > 1.2;
  }
  // Parent (real Chrome): with only "far or off screen", the town in front of the player stayed empty after loading or after a
  // jump to another place, until the player turned round. For a short while after arriving, people may appear anywhere.
  function safeChange(x, z) { return grace > 0 || Math.hypot(x - lastX, z - lastZ) > 55 || offscreen(x, z); }
  function makeSlot(who) {
    const ch = new Character(roster, who, { style: 'villager' }), meshes = [];
    ch.model.traverse(o => { if (o.isMesh) { meshes.push(o); o.castShadow = false; } });
    // Prepare actions once. Character.update also builds footstep records every tick; scenery needs only its shared mixer.
    for (const clip of PEOPLE_CLIPS) ch.action(clip);
    let pillar = null;
    if (pillars) {
      if (!pillarGeometry) {
        pillarGeometry = new THREE.BoxGeometry(.22, 2.4, .22);
        pillarMaterials = COLOURS.map(color => new THREE.MeshBasicMaterial({ color, toneMapped: false, depthTest: false }));
      }
      pillar = new THREE.Mesh(pillarGeometry, pillarMaterials[0]); pillar.position.y = ch.height + 1.5; pillar.renderOrder = 20; ch.root.add(pillar);
    }
    const slot = { ch, who, meshes, pillar, equipment:null, state: createPersonState(), live: false, index: -1,
      head: ch.bone('Head'), headQ: new THREE.Quaternion(), headApplied: false, age: 0, bornFar: false, enteredDistance: 0, enteredOffscreen: false };
    ch.root.visible = false; context.scene.add(ch.root); return slot;
  }
  function selection() {
    chosen.fill(-1); distances.fill(Infinity); nearby = 0;
    const reserved = selectFlightPeople(spots, viewer, context.quality, step, flightChosen, flying);
    for(let k=0;k<reserved;k++) {chosen[k]=flightChosen[k];distances[k]=Math.hypot(spots[chosen[k]].x-lastX,spots[chosen[k]].z-lastZ);}
    const limit = peopleLimit(context.quality, step);
    for (let i = 0; i < spots.length; i++) {
      const p = spots[i];if(p.flight)continue;const d = Math.hypot(p.x - lastX, p.z - lastZ);
      if (d > range) continue; nearby++;
      for (let k = reserved; k < limit; k++) if (d < distances[k]) {
        for (let j = limit - 1; j > k; j--) { distances[j] = distances[j - 1]; chosen[j] = chosen[j - 1]; }
        chosen[k] = i; distances[k] = d; break;
      }
    }
    // Keep a close visible person until it can leave without popping. Newcomers wait for a free slot.
    for (const slot of slots) if (slot.live) {
      let wanted = false; for (let k = 0; k < limit; k++) if (chosen[k] === slot.index) wanted = true;
      if (!wanted && (slot.state.spot.flight || reserved > 0 || safeChange(slot.state.x, slot.state.z))) hide(slot);
    }
    centerX = lastX; centerZ = lastZ; refresh = false;
  }
  function equip(slot, p) {
    if(!p.flight) {if(slot.equipment)slot.equipment.visible=false;return;}
    if(!slot.equipment) {
      const shape=crowdShape('traveller',1,true),positions=[],normals=[];
      for(let i=0;i<shape.parts.length;i++) if(shape.parts[i]>=2) {
        positions.push(shape.positions[i*3],shape.positions[i*3+1],shape.positions[i*3+2]);
        normals.push(shape.normals[i*3],shape.normals[i*3+1],shape.normals[i*3+2]);
      }
      const geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.Float32BufferAttribute(positions,3));geometry.setAttribute('normal',new THREE.Float32BufferAttribute(normals,3));
      const material=new THREE.MeshLambertMaterial({color:CROWD.clothes[4]}),mesh=new THREE.Mesh(geometry,material);
      mesh.scale.setScalar(slot.ch.height);mesh.rotation.y=Math.PI;slot.ch.root.add(mesh);slot.equipment=mesh;
    }
    slot.equipment.visible=true;
    // All pieces share one mesh; collapse the staff's vertices for the two people without one.
    const positions=slot.equipment.geometry.attributes.position,shape=crowdShape('traveller',1,true);let k=0;
    for(let i=0;i<shape.parts.length;i++)if(shape.parts[i]>=2){
      const gain=shape.parts[i]===4&&!p.staff?0:1;
      positions.setXYZ(k++,shape.positions[i*3]*gain,shape.positions[i*3+1]*gain,shape.positions[i*3+2]*gain);
    }
    positions.needsUpdate=true;
  }
  function populate() {
    const limit = peopleLimit(context.quality, step); if (count >= limit) return;
    // Exactly one clone (or replacement) in a frame, never a burst of ten clones.
    for (let k = 0; k < limit; k++) {
      const index = chosen[k]; if (index < 0) continue; const p = spots[index];
      let exists = false; for (const s of slots) if (s.live && s.index === index) exists = true;
      if (exists || !safeChange(p.x, p.z)) continue;
      let slot = null;
      for (const s of slots) if (!s.live && s.who === p.who) { slot = s; break; }
      if (!slot) {
        if (slots.length < PEOPLE.max) { slot = makeSlot(p.who); slots.push(slot); }
        else for (let i = 0; i < slots.length; i++) if (!slots[i].live) {
          closeSlot(slots[i]); slot = slots[i] = makeSlot(p.who); break;
        }
      }
      if (!slot) return;
      slot.ch.legs?.undo(); if(slot.ch.legs)slot.ch.legs.reset=true;
      resetPerson(slot.state, p); equip(slot,p); slot.index = index; slot.live = true; slot.age = 0;
      slot.enteredDistance = Math.hypot(p.x - lastX, p.z - lastZ); slot.enteredOffscreen = offscreen(p.x, p.z);
      slot.bornFar = slot.enteredDistance > 55; slot.ch.root.visible = true;
      // Stop former actions on reuse; no old gesture is blended into a different role.
      slot.ch.mixer.stopAllAction(); slot.ch.current = null; slot.ch.currentName = null;
      if (slot.pillar) slot.pillar.material = pillarMaterials[p.flight?5:PEOPLE_ROLES.indexOf(p.role)];
      count++; births++; return;
    }
  }
  function update(frame) {
    if (disposed || failed || paused) return;
    const dt = Math.max(0, Math.min(.1, frame.dt));
    routeTime = Number.isFinite(frame.time) ? frame.time : routeTime + Math.max(0,frame.dt);
    if(flying!==!!frame.flying){flying=!!frame.flying;refresh=true;}
    frames++; if (!started && frames >= 2) { started = true; void beginLoad(); }
    if (arrived && Math.hypot(frame.pos.x - lastX, frame.pos.z - lastZ) > PEOPLE.jump) { grace = PEOPLE.grace; refresh = true; }
    lastX = frame.pos.x; lastZ = frame.pos.z;viewer.x=lastX;viewer.z=lastZ;
    if (!ready) {
      // Placement is deterministic; yielding changes only preparation time, never the result.
      // Parent (real Chrome): at 32 steps a frame the 60,000 steps of the whole map took half a minute, and the town stayed empty
      // for that long. The steps are cheap (a quarter of a second in all), so the time budget alone bounds a frame.
      const start = performance.now();
      for (let i = 0; i < 8192; i++) {
        const next = job.next(); site = next.value.site; spots = next.value.spots;
        if (next.done) { for(const p of spots)if(p.flight)movingSpots.push(p);ready = true; refresh = true; break; }
        if ((i & 31) === 31 && performance.now() - start > 2.5) break;
      }
    }
    if (!loaded || !site) return;
    time += dt;
    for(const p of movingSpots)sampleFlight(p,routeTime,context.terrain,p);
    if (!arrived && ready) { arrived = true; grace = PEOPLE.grace; } else grace = Math.max(0, grace - dt);
    if (camera) { camera.updateMatrixWorld(); viewProjection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse); }
    const limit = peopleLimit(context.quality, step);
    if (!limit) { for (const slot of slots) hide(slot); return; }
    if (refresh || movingSpots.length || Math.hypot(lastX - centerX, lastZ - centerZ) >= PEOPLE.refresh) selection();
    // Revisit protected removals even when the viewer only turns the camera.
    for (const slot of slots) if (slot.live) {
      let wanted = false; for (let k = 0; k < limit; k++) if (chosen[k] === slot.index) wanted = true;
      if (!wanted && safeChange(slot.state.x, slot.state.z)) hide(slot);
    }
    populate(); bows = 0;
    for (const slot of slots) if (slot.live) {
      const s = slot.state;
      stepPerson(s, frame.hero?.pos || context.hero.pos, !!context.hero.drawn, s.spot.flight ? routeTime : time, dt, site);
    }
    // Several bounded passes for chains of neighbours; a final hero projection protects the main character.
    for (let pass = 0; pass < 3; pass++) for (let i = 0; i < slots.length; i++) {
      const a = slots[i]; if (!a.live) continue;
      for (let j = 0; j < i; j++) if (slots[j].live) avoidPerson(a.state, slots[j].state.x, slots[j].state.z, PEOPLE.gap, site);
      if (!frame.flying) avoidPerson(a.state, context.hero.pos.x, context.hero.pos.z, PEOPLE.heroGap, site);
    }
    let overlapThisFrame = false;
    for (const slot of slots) if (slot.live) {
      const s = slot.state, p = s.spot, ch = slot.ch, d = Math.hypot(s.x - lastX, s.z - lastZ); slot.age += dt;
      if (!frame.flying && Math.hypot(s.x - context.hero.pos.x, s.z - context.hero.pos.z) < PEOPLE.heroGap - 1e-5) overlapThisFrame = true;
      if (s.reacting > 0 && s.clip === 'Formal_Bow') bows++;
      ch.legs?.undo();
      const changed = ch.currentName !== s.clip, ended = ch.current && !ch.meta(s.clip)?.loop && ch.current.time >= (ch.meta(s.clip)?.seconds || 3) - .01;
      if (changed || (ended && s.clip !== 'Formal_Bow' && s.clip !== 'Wave_One_Hand')) {
        playOptions.from = changed && slot.age <= dt ? p.phase % (ch.meta(s.clip)?.seconds || 3) : 0;
        // The shipped bow is 7.67s, including a long lead-in; finish it inside the 2.7s greeting.
        playOptions.timeScale = s.clip === 'Formal_Bow' ? 3 : s.clip === 'Wave_One_Hand' ? 1.5
          : s.clip === 'Casual_Walk' ? (s.scared ? -1 : 1) * (p.flight?p.speed:1.2) / (ch.meta(s.clip)?.avgSpeed || 1.2)
          : s.clip === 'CMU_Run' ? 2.8 / (ch.meta(s.clip)?.avgSpeed || 2.8) : 1;
        ch.play(s.clip, playOptions); if (s.reacting > 0) ch.current.time = 0;
      }
      s.poseDt += dt;
      if (frames % peopleStride(d) === 0 || changed) {
        if (slot.headApplied) { slot.head.quaternion.copy(slot.headQ); slot.headApplied = false; }
        ch.mixer.update(s.poseDt); s.poseDt = 0; s.bones++; boneUpdates++;
        if (slot.head && s.head) { slot.headQ.copy(slot.head.quaternion); slot.head.rotation.y += s.head; slot.headApplied = true; }
      }
      ch.root.position.set(s.x, context.terrain.heightAt(s.x, s.z), s.z); ch.root.rotation.y = s.yaw + Math.PI;
      // Beyond 55m, fade size across the far ten metres and over the first half second.
      const fade = Math.max(0, Math.min(1, (range - d) / PEOPLE.fade));
      ch.root.scale.setScalar(p.scale * fade * (p.flight?p.alpha:1) * (slot.bornFar ? Math.min(1, slot.age * 2) : 1));
      if(p.flight && ch.legs) {
        ch.locoName=s.clip;ch.gait='walk';ch.root.updateMatrixWorld(true);
        ch.legs.apply(dt,context.terrain,true);
      }
      for (const mesh of slot.meshes) mesh.castShadow = d <= 25;
    }
    if (overlapThisFrame) overlaps++;
  }
  return {
    update,
    setAdapt(value) {
      step = value; refresh = true;
      if (step >= 3) for (const slot of slots) hide(slot);
      // Emergency reduction must obey the hard cap, including if all people are currently on screen.
      else for (let i = slots.length - 1; i >= 0 && count > peopleLimit(context.quality, step); i--) hide(slots[i]);
    },
    setPaused(on) { paused = !!on; },
    debugText() { return disposed || failed ? '' : `人 ${count}/${nearby} 礼${bows}`; },
    dispose() {
      if (disposed) return; disposed = true; job.return(); close();
      if (globalThis.__kzPeople === ownsDebug) delete globalThis.__kzPeople;
    },
  };
}
