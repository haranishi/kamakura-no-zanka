// batch.js — 同じ形をまとめて1回で描く（まとめ描き・view層）。置く数だけ模型を複製して部品ごとに描くと、描画の呼び出しが
// 「置く数×部品の数」に増え、影でさらに倍になる。部品ごとに BatchedMesh を1つ作り、置き場所は行列で渡す。
// InstancedMesh でなく BatchedMesh にしたのは、1つずつの視錐台の判定を画面と影で別々に残すため（2026-11-01 の計測。
// InstancedMesh では、1つでも見えると全部の三角形を描き、1コマの三角形が最大で約23万増えた）。WEBGL_multi_draw が無い環境では、
// three.js が1つずつの描画に戻す（絵は同じ。呼び出しが減らないだけ）。
// 模型（loadModels・loadPropModels の戻り値）は書き換えない。オープニングが同じ模型を複製して使う（形と材質は共有）。BatchedMesh は形を写して持つ。
import * as THREE from 'three';

// 置き場所の行列。複製の根へ position・rotation.y・scale を入れて updateMatrix した値と同じ（scale は数か [x,y,z]）。
const anchor = new THREE.Object3D();
export function placementMatrix(x, y, z, rotY = 0, scale = 1) {
  anchor.position.set(x, y, z); anchor.rotation.set(0, rotY, 0);
  if (Array.isArray(scale)) anchor.scale.set(scale[0], scale[1], scale[2]); else anchor.scale.setScalar(scale);
  anchor.updateMatrix();
  return anchor.matrix.clone();
}

const localMatrix = n => (n.matrixAutoUpdate ? new THREE.Matrix4().compose(n.position, n.quaternion, n.scale) : n.matrix.clone());

// 模型 model を、置き場所の行列 placements の数だけ置く。部品（Mesh）ごとに BatchedMesh を1つ作り、名前 name の Group に入れて返す。
// 部品の行列には、模型の根より下の連なりだけを掛ける（根の位置・向き・大きさは置き場所で置き換える。複製を置いていた頃と同じ）。
// colors：置き場所ごとの色（材質の色に掛かる）。material：部品の材質を差し替える関数（色違いの材質を用意するときに使う）。
export function batchParts(model, placements, { name = 'batch', colors = null, material = m => m } = {}) {
  const group = new THREE.Group(); group.name = name;
  if (!model || !placements.length) return group;
  const m = new THREE.Matrix4();
  model.traverse(o => {
    if (!o.isMesh) return;
    if (Array.isArray(o.material)) throw Error(`batchParts: ${o.name} has several materials (split it into one mesh per material first)`);
    const chain = new THREE.Matrix4();
    for (let n = o; n && n !== model; n = n.parent) chain.premultiply(localMatrix(n));
    const g = o.geometry, mesh = new THREE.BatchedMesh(placements.length, g.attributes.position.count, g.index ? g.index.count : 0, material(o.material));
    const id = mesh.addGeometry(g);
    placements.forEach((p, i) => { const k = mesh.addInstance(id); mesh.setMatrixAt(k, m.multiplyMatrices(p, chain)); if (colors) mesh.setColorAt(k, colors[i]); });
    Object.assign(mesh, { name: o.name, castShadow: o.castShadow, receiveShadow: o.receiveShadow, visible: o.visible, renderOrder: o.renderOrder, frustumCulled: o.frustumCulled });
    mesh.computeBoundingSphere();
    group.add(mesh);
  });
  return group;
}

// 索引つきの形（位置・法線・UV）をつなげて1つにする。部品の配置は呼ぶ側が形へ焼き込んでおく。
export function mergeIndexed(list) {
  const out = new THREE.BufferGeometry(), index = [];
  for (const [attr, size] of [['position', 3], ['normal', 3], ['uv', 2]]) {
    const arr = new Float32Array(list.reduce((a, g) => a + g.attributes[attr].count * size, 0));
    let o = 0;
    for (const g of list) { arr.set(g.attributes[attr].array, o); o += g.attributes[attr].count * size; }
    out.setAttribute(attr, new THREE.BufferAttribute(arr, size));
  }
  let base = 0;
  for (const g of list) { for (const i of g.index.array) index.push(i + base); base += g.attributes.position.count; }
  out.setIndex(index);
  return out;
}
