// W2c-9d: one opaque instanced draw before the transparent river, procedural 28-triangle fish.
import * as THREE from 'three';
export function buildFishView(state) {
  const geometry = new THREE.BufferGeometry(), vertices = [], colors = [], indices = [];
  // Four diamond cross sections; tail narrows then opens into a vertical fin.
  for (const [z, width, height] of [[-.5, .015, .22], [-.27, .055, .065], [.08, .16, .13], [.5, .025, .035]]) {
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2; vertices.push(Math.sin(a) * width, Math.cos(a) * height, z);
      // W2c-9d2: muted green -> dark teal back, pale silver belly and bright flanks.
      const top = Math.cos(a) * .5 + .5;
      colors.push(.94 - top * .88, .98 - top * .77, 1 - top * .76);
    }
  }
  for (let k = 0; k < 3; k++) for (let i = 0; i < 4; i++) { const a = k * 4 + i, b = k * 4 + (i + 1) % 4; indices.push(a, b, a + 4, b, b + 4, a + 4); }
  indices.push(0, 2, 1, 0, 3, 2, 12, 13, 14, 12, 14, 15); // 28 triangles
  for (let i = 0; i < indices.length; i += 3) { const b = indices[i + 1]; indices[i + 1] = indices[i + 2]; indices[i + 2] = b; }
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
  const phase = new THREE.InstancedBufferAttribute(new Float32Array(state.fish.length), 1); phase.setUsage(THREE.DynamicDrawUsage); geometry.setAttribute('fishPhase', phase);
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .48, metalness: .1 }); material.fog = true;
  material.onBeforeCompile = shader => {
    // Preserve a vertex-colored light floor under the translucent surface / in shadow.
    shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * 0.18;');
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float fishPhase;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.x += sin(fishPhase + position.z * 8.0) * pow(max(0.0, 0.4-position.z), 2.0) * 0.13;');
  };
  const mesh = new THREE.InstancedMesh(geometry, material, state.fish.length); mesh.name = 'kamakura-fish'; mesh.count = 0; mesh.renderOrder = 1;
  mesh.frustumCulled = false; mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const obj = new THREE.Object3D(), tint = new THREE.Color(); let disposed = false;
  function update() {
    if (disposed) return;
    mesh.count = state.count;
    for (let i = 0; i < state.count; i++) {
      const f = state.fish[i]; obj.position.set(f.x, f.y, f.z); obj.rotation.set(0, f.yaw, 0); obj.scale.setScalar(f.size); obj.updateMatrix(); mesh.setMatrixAt(i, obj.matrix);
      phase.array[i] = f.phase; tint.setRGB(f.big ? .85 : 1, f.big ? .53 : 1, f.big ? .24 : 1); mesh.setColorAt(i, tint);
    }
    mesh.instanceMatrix.needsUpdate = true; phase.needsUpdate = true; if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }
  // Allocate the optional instance colors at construction, never in the frame loop.
  mesh.setColorAt(0, tint);
  return { mesh, update, dispose() { if (disposed) return; disposed = true; mesh.removeFromParent(); mesh.dispose(); geometry.dispose(); material.dispose(); } };
}
