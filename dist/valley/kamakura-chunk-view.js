import * as THREE from 'three';
import { installGroundDetail } from './kamakura-ground-detail.js';
import { installGroundSoil } from './kamakura-ground-soil.js';
import { FLY } from './kamakura-fly.js';
import { CHUNK_CELLS as SIZE, chooseLOD, choosePatchLOD, chunkGeometry } from './kamakura-chunks.js';
import { createChunkJobs, chunkBudget, withinChunkBudget, shouldPlanChunks } from './kamakura-chunk-jobs.js';
export function buildKamakuraChunks(t, scene, spawn, ground = true, quality = 'standard', detailOptions = {}) {
  const colored = ground && !!t.groundColorAt?.(t.x0, t.z0);
  const material = new THREE.MeshLambertMaterial({ color: colored ? 0xffffff : 0x858563, vertexColors: colored });
  const detail = installGroundDetail(THREE, material, detailOptions.data, { quality, search: detailOptions.search });
  installGroundSoil(THREE, material, detail, { quality, search: detailOptions.search });
  const chunks = [], grid = new Map();
  for (let j = 0; j < t.h - 1; j += SIZE) for (let i = 0; i < t.w - 1; i += SIZE) {
    const ch = { i, j, i1: Math.min(t.w - 1, i + SIZE), j1: Math.min(t.h - 1, j + SIZE), step: 8, mesh: null };
    ch.x = t.x0 + (ch.i + ch.i1) / 2 * t.cell; ch.z = t.z0 + (ch.j + ch.j1) / 2 * t.cell;
    // Keep any chunk touching A eligible for near detail; wholly external chunks stay coarse.
    ch.nearA = false;
    for (let y = j; y <= ch.j1 && !ch.nearA; y++) for (let x = i; x <= ch.i1; x++) if (t.maskAt(t.x0 + x * t.cell, t.z0 + y * t.cell)) { ch.nearA = true; break; }
    chunks.push(ch); grid.set(`${i},${j}`, ch);
  }
  const neighbors = ch => ({ north: grid.get(`${ch.i},${ch.j - SIZE}`), south: grid.get(`${ch.i},${ch.j + SIZE}`), west: grid.get(`${ch.i - SIZE},${ch.j}`), east: grid.get(`${ch.i + SIZE},${ch.j}`) });
  let flying = false, flyHeight = 0;
  const wantLOD = (ch, distance) => {
    const d = flying ? Math.hypot(distance, flyHeight) : distance;
    return t.patches ? choosePatchLOD(d, ch.step) : ch.nearA ? chooseLOD(d, ch.step) : 8;
  };
  for (const ch of chunks) ch.step = wantLOD(ch, Math.hypot(ch.x - spawn.x, ch.z - spawn.z));
  const scheduler = createChunkJobs(chunks, neighbors, wantLOD), prepared = new Map();
  let last = null, frame = 0, disposed = false;
  function discard() { for (const g of prepared.values()) g.dispose(); prepared.clear(); }
  function prepare(job) {
    const ch = job.ch, data = chunkGeometry(t, ch.i, ch.j, ch.i1, ch.j1, job.step, job.edges, ground);
    const g = new THREE.BufferGeometry();
    try {
      if (data.colors) g.setAttribute('color', new THREE.Float32BufferAttribute(data.colors, 3));
      g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3)); g.setIndex(data.indices); g.computeBoundingSphere();
      return g;
    } catch (error) { g.dispose(); throw error; }
  }
  function update(pos) {
    if (disposed) return;
    detail.far?.update(pos);
    if (shouldPlanChunks(last, pos, ++frame)) {
      flyHeight = flying ? Math.max(0, pos.y - t.heightAt(pos.x, pos.z)) : 0;
      const old = scheduler.active; scheduler.plan(pos, flying ? FLY.distance : 3300);
      if (old && old !== scheduler.active) discard();
      last = { x: pos.x, z: pos.z };
      for (const ch of chunks) if (ch.mesh) ch.mesh.visible = ch.visible;
    }
    const start = performance.now(); let count = 0;
    while (flying ? count < FLY.builds : withinChunkBudget(start, performance.now(), count, chunkBudget(quality))) {
      const batch = scheduler.next(); if (!batch) break;
      const job = batch.jobs.find(j => !j.done);
      try { prepared.set(job, prepare(job)); }
      catch (error) { discard(); scheduler.cancel(); throw error; }
      scheduler.prepared(batch.generation, job); count++;
      if (batch.jobs.every(j => j.done)) {
        // No renderer runs inside this synchronous commit: every shared edge changes together.
        for (const j of batch.jobs) {
          const ch = j.ch, geometry = prepared.get(j);
          if (ch.mesh) { ch.mesh.geometry.dispose(); ch.mesh.geometry = geometry; }
          else {
            ch.mesh = new THREE.Mesh(geometry, material); ch.mesh.receiveShadow = true;
            ch.mesh.updateMatrix(); ch.mesh.matrixAutoUpdate = false; scene.add(ch.mesh);
          }
          ch.mesh.visible = ch.visible;
        }
        scheduler.commit(batch.generation); prepared.clear();
      }
    }
  }
  function ready(pos) {
    return chunks.filter(ch => Math.hypot(ch.x - pos.x, ch.z - pos.z) < 420).every(ch => ch.mesh);
  }
  return { chunks, update, ready, scheduler, setAdapt: detail.setAdapt, setFlying(on) { if (flying !== on) { flying = on; last = null; } }, get distance() { return flying ? FLY.distance : 3300; }, dispose() { if (disposed) return; disposed = true; discard(); scheduler.cancel(); for (const ch of chunks) { if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); } } detail.dispose(); material.dispose(); } };
}
