import * as THREE from 'three';

/** Keep original source nodes together before any static batching. */
export function createQuestView({ model, scene, camera, groundAt }) {
  model.updateMatrixWorld(true);
  const roots = [];
  model.traverse(object => {
    if (!object.name.startsWith('Bucket_')) return;
    let parent = object.parent;
    while (parent && parent !== model) {
      if (parent.name.startsWith('Bucket_')) return;
      parent = parent.parent;
    }
    roots.push(object);
  });
  if (roots.length !== 39) throw new Error(`Expected 39 bucket source nodes, found ${roots.length}`);
  const bucket = new THREE.Group(); bucket.name = 'QuestBucket'; bucket.userData.dynamic = true;
  const box = new THREE.Box3();
  for (const root of roots) box.union(new THREE.Box3().setFromObject(root));
  const base = new THREE.Vector3(-4.55, box.min.y, 3.10005);
  bucket.position.copy(base); scene.add(bucket); bucket.updateMatrixWorld(true);
  for (const root of roots) bucket.attach(root);
  bucket.traverse(object => { object.userData.dynamic = true; });

  const water = new THREE.Mesh(new THREE.CircleGeometry(.157, 40), new THREE.MeshStandardMaterial({
    color: '#72908a', roughness: .18, metalness: .3, transparent: true, opacity: .84,
  }));
  water.name = 'BucketWater'; water.rotation.x = -Math.PI / 2; water.position.y = .273;
  bucket.add(water);
  const delivery = { x: -8.5, z: -.4 };
  const floor = groundAt(delivery.x, delivery.z) ?? .18;
  const marker = new THREE.Group(); marker.name = 'DeliveryMarker'; marker.position.set(delivery.x, floor + .015, delivery.z);
  const straw = new THREE.Mesh(new THREE.TorusGeometry(.29, .018, 5, 48), new THREE.MeshStandardMaterial({ color: '#b2a47a', roughness: 1 }));
  straw.rotation.x = Math.PI / 2; marker.add(straw);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(.018, .024, .48, 7), new THREE.MeshStandardMaterial({ color: '#67543a', roughness: .94 }));
  post.position.set(-.36, .20, -.12); post.castShadow = true; marker.add(post);
  const cloth = new THREE.Mesh(new THREE.PlaneGeometry(.13, .19), new THREE.MeshStandardMaterial({ color: '#c9b995', roughness: .95, side: THREE.DoubleSide }));
  cloth.position.set(-.36, .35, -.12); cloth.rotation.y = .25; marker.add(cloth);
  scene.add(marker);
  let currentStage = 'bucket';
  function sync(state) {
    currentStage = state.stage;
    const held = state.stage === 'empty' || state.stage === 'full';
    const parent = held ? camera : scene;
    if (bucket.parent !== parent) parent.add(bucket);
    bucket.rotation.set(0, 0, 0); bucket.scale.setScalar(held ? .68 : 1);
    if (held) bucket.position.set(.32, -.62, -.73);
    else if (state.stage === 'delivered') bucket.position.set(delivery.x, floor + .015, delivery.z);
    else bucket.position.copy(base);
    water.visible = state.stage === 'full' || state.stage === 'delivered';
    marker.visible = state.stage !== 'delivered';
    straw.material.color.set(state.stage === 'full' ? '#d0bb7e' : '#8f8468');
  }
  function update(elapsed, moving, reducedMotion) {
    const held = currentStage === 'empty' || currentStage === 'full';
    if (held) {
      bucket.position.y = -.62 + (moving && !reducedMotion ? Math.sin(elapsed * 8) * .009 : 0);
      bucket.rotation.z = moving && !reducedMotion ? Math.sin(elapsed * 4) * .008 : 0;
    }
    if (water.visible) water.material.roughness = .18;
  }
  return {
    bucket, roots, water, marker, sync, update,
    get state() { return { sourceNodes: roots.length, meshes: roots.reduce((n, root) => { let c = 0; root.traverse(o => { if (o.isMesh) c++; }); return n + c; }, 0), parent: bucket.parent === camera ? 'camera' : 'scene', waterVisible: water.visible, stage: currentStage }; },
  };
}
