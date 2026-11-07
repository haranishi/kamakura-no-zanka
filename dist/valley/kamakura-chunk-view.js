import * as THREE from 'three';
import { CHUNK_CELLS as SIZE, chooseLOD, choosePatchLOD, chunkGeometry } from './kamakura-chunks.js';
export function buildKamakuraChunks(t, scene, spawn) {
  const material = new THREE.MeshLambertMaterial({ color: 0x858563 });
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
  function rebuild(ch) {
    const edges = Object.fromEntries(Object.entries(neighbors(ch)).map(([side, n]) => [side, n?.step ?? ch.step]));
    const data = chunkGeometry(t, ch.i, ch.j, ch.i1, ch.j1, ch.step, edges), g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(data.normals, 3)); g.setIndex(data.indices); g.computeBoundingSphere();
    if (ch.mesh) { ch.mesh.geometry.dispose(); ch.mesh.geometry = g; }
    else { ch.mesh = new THREE.Mesh(g, material); scene.add(ch.mesh); }
  }
  const wantLOD = (ch, d) => t.patches ? choosePatchLOD(d, ch.step) : ch.nearA ? chooseLOD(d, ch.step) : 8;
  // Plan all initial LODs before construction, so progressively arriving neighbors already match.
  for (const ch of chunks) ch.step = wantLOD(ch, Math.hypot(ch.x - spawn.x, ch.z - spawn.z));
  function update(pos) {
    const sorted = chunks.map(ch => ({ ch, d: Math.hypot(ch.x - pos.x, ch.z - pos.z) })).sort((a, b) => a.d - b.d);
    // A LOD change and its four loaded neighbors are rebuilt atomically (at most five meshes).
    for (const { ch, d } of sorted) {
      const want = wantLOD(ch, d);
      if (ch.mesh && want !== ch.step) {
        ch.step = want; rebuild(ch);
        for (const n of Object.values(neighbors(ch))) if (n?.mesh) rebuild(n);
        return;
      }
    }
    let budget = 2;
    for (const { ch, d } of sorted) {
      if (ch.mesh) ch.mesh.visible = d < 3300;
      else if (d < 3300 && budget > 0) { rebuild(ch); budget--; }
    }
  }
  function ready(pos) {
    return chunks.filter(ch => Math.hypot(ch.x - pos.x, ch.z - pos.z) < 420).every(ch => ch.mesh);
  }
  return { chunks, update, ready, dispose() { for (const ch of chunks) { if (ch.mesh) { scene.remove(ch.mesh); ch.mesh.geometry.dispose(); } } material.dispose(); } };
}
