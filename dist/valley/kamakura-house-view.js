// View only. Reuses the bundled GLTFLoader, instancing and bounded chunk lifecycle.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { houseNodeName, houseBounds, houseBodyBounds, houseMatrix, houseBox, houseChunks, houseChunkDistance, houseLOD } from './kamakura-houses.js';

// The mid view stands on a coarser terrain mesh (LOD2+), so its box sinks deeper than the detailed skirt to stay hidden.
const MID_EXTRA_SINK = 2.5;
function simplified(kind, material) {
  const { min: a, max: b } = houseBounds(kind), h = b[1] - a[1], eave = b[1] - h * .28, bottom = a[1] - MID_EXTRA_SINK;
  const geometry = new THREE.BoxGeometry(b[0] - a[0], eave - bottom, b[2] - a[2]);
  geometry.translate((a[0] + b[0]) / 2, (bottom + eave) / 2, (a[2] + b[2]) / 2);
  // Two sloping roof faces: four triangles instead of all source roof detail.
  const roof = new THREE.BufferGeometry(), x = (a[0] + b[0]) / 2;
  roof.setAttribute('position', new THREE.Float32BufferAttribute([
    a[0],eave,a[2], a[0],eave,b[2], x,b[1],b[2], x,b[1],a[2],
    x,b[1],a[2], x,b[1],b[2], b[0],eave,b[2], b[0],eave,a[2]
  ], 3));
  roof.setIndex([0,1,2,0,2,3,4,5,6,4,6,7]); roof.computeVertexNormals();
  return [{ geometry, material }, { geometry: roof, material }];
}
export async function buildKamakuraHouses(houses, terrain, scene) {
  // Reject external resource links before handing the private, self-contained GLB to the loader.
  const dv = new DataView(houses.kit);
  const json = JSON.parse(new TextDecoder().decode(new Uint8Array(houses.kit, 20, dv.getUint32(12, true))));
  if (json.buffers?.some(b => b.uri) || json.images?.some(b => b.uri) || json.extensionsUsed?.length) throw new Error('家のGLBは自己完結形式が必要です');
  const gltf = await new GLTFLoader().parseAsync(houses.kit, '');
  const templates = new Map(), owned = new Set(), sourceGeometries = new Set(), materials = new Set();
  const chunks = houseChunks(houses), boxes = [];
  function releaseGroup(group) {
    if (!group) return;
    group.traverse(o => { if (o.isInstancedMesh) o.dispose(); }); group.removeFromParent();
  }
  function dispose() {
    for (const ch of chunks) { releaseGroup(ch.group); releaseGroup(ch.pending?.group); }
    for (const g of owned) g.dispose(); for (const g of sourceGeometries) g.dispose(); for (const m of materials) m.dispose();
  }
  gltf.scene.traverse(o => { if (o.isMesh) { sourceGeometries.add(o.geometry); for (const m of [].concat(o.material)) materials.add(m); } });
  try {
    gltf.scene.updateMatrixWorld(true);
    for (const kind of houses.kinds.values()) {
      if (!houses.catalog.count_by_kind[kind.node]) continue;
      let node = null;
      gltf.scene.traverse(o => {
        const index = gltf.parser.associations.get(o)?.nodes;
        if (index !== undefined && houseNodeName(json.nodes[index].name) === kind.node) node = o;
      });
      if (!node) throw new Error('家の型に対応する節がありません');
      const near = [], positions = [];
      node.traverse(o => {
        if (!o.isMesh) return;
        const g = o.geometry.clone().applyMatrix4(o.matrixWorld); owned.add(g);
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i++) positions.push(p.getX(i), p.getY(i), p.getZ(i));
        if (Array.isArray(o.material)) {
          for (const group of g.groups) {
            const part = g.clone(); part.clearGroups(); part.setDrawRange(group.start, group.count); owned.add(part);
            near.push({ geometry: part, material: o.material[group.materialIndex] });
          }
        } else near.push({ geometry: g, material: o.material });
      });
      if (!near.length) throw new Error('家の部品がありません');
      // Current kit uses one flat main color per kind. Weight by primitive triangle count for future kits.
      const main = [...near].sort((a, b) => (b.geometry.index?.count ?? b.geometry.attributes.position.count) - (a.geometry.index?.count ?? a.geometry.attributes.position.count))[0].material;
      const mid = simplified(kind, main); for (const p of mid) owned.add(p.geometry);
      templates.set(kind.index, { near, mid, body: houseBodyBounds(positions) });
    }
    for (const ch of chunks) {
      ch.level = null; ch.group = null; ch.pending = null;
      for (const item of ch.items) {
        const body = templates.get(item.kind).body;
        item.grounded = houseMatrix(item, terrain, body);
        boxes.push({ ...houseBox(houses.kinds.get(item.kind), item.grounded, body), id: `house-${item.id}` });
      }
    }
  } catch (e) { dispose(); throw e; }
  function prepare(ch, level) {
    const group = new THREE.Group(); group.name = `houses-${ch.key}-${level}`; group.visible = false; scene.add(group);
    const kinds = new Map(), jobs = [];
    for (const item of ch.items) { if (!kinds.has(item.kind)) kinds.set(item.kind, []); kinds.get(item.kind).push(item); }
    for (const [kind, items] of kinds) for (const part of templates.get(kind)[level === 0 ? 'near' : 'mid']) jobs.push({ part, items });
    ch.pending = { group, jobs, level };
  }
  function update(pos) {
    let budget = 2;
    const sorted = chunks.map(ch => ({ ch, distance: houseChunkDistance(ch, pos) })).sort((a,b) => a.distance - b.distance);
    for (const { ch, distance } of sorted) {
      const want = houseLOD(distance, ch.level);
      if (ch.pending && want !== ch.pending.level) { releaseGroup(ch.pending.group); ch.pending = null; }
      if (want === 2) { releaseGroup(ch.group); ch.group = null; ch.level = 2; continue; }
      if (want === ch.level) continue;
      if (!ch.pending && budget) prepare(ch, want);
      const pending = ch.pending;
      while (pending?.jobs.length && budget) {
        const { part, items } = pending.jobs.shift(), mesh = new THREE.InstancedMesh(part.geometry, part.material, items.length);
        mesh.name = 'house-instances';
        items.forEach((item, i) => mesh.setMatrixAt(i, new THREE.Matrix4().fromArray(item.grounded)));
        mesh.instanceMatrix.needsUpdate = true; mesh.computeBoundingSphere(); pending.group.add(mesh); budget--;
      }
      if (pending && !pending.jobs.length) {
        releaseGroup(ch.group); ch.group = pending.group; ch.group.visible = true; ch.level = pending.level; ch.pending = null;
      }
    }
  }
  return { update, boxes, dispose, ready: pos => chunks.filter(ch => houseChunkDistance(ch, pos) < 350).every(ch => ch.level === 0) };
}
