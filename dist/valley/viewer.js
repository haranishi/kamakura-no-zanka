// viewer.js — GLB 1つを夕日の光で近くから見る確認ページ（開発用。遊びの入口ではない）。
//   viewer.html?model=../assets/valley/models/fence.glb&view=q34&scale=1&shot=1&w=700&h=600&dist=4
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const q = new URLSearchParams(location.search);
if (q.get('shot')) document.body.classList.add('shot');
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.append(renderer.domElement);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#6b7a76');
{
  const sky = new THREE.Scene();
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.ShaderMaterial({ side: THREE.BackSide, vertexShader: 'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 p;void main(){float h=normalize(p).y;vec3 top=vec3(.35,.5,.7),hor=vec3(1.,.82,.6),low=vec3(.25,.22,.2);vec3 c=h>0.?mix(hor,top,pow(h,.5)):mix(hor,low,pow(-h,.4));gl_FragColor=vec4(c*1.3,1.);}' })));
  scene.environment = new THREE.PMREMGenerator(renderer).fromScene(sky, 0.02).texture;
}
scene.add(new THREE.HemisphereLight('#cfe0ff', '#4a4030', 0.5));
const sun = new THREE.DirectionalLight('#ffe0a8', 3.0); sun.position.set(-4, 5, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 20 }); sun.shadow.bias = -0.0003;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(12, 48), new THREE.MeshStandardMaterial({ color: '#6b5f4a', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);
const camera = new THREE.PerspectiveCamera(34, 1, 0.05, 100);
const w = Number(q.get('w') || innerWidth), h = Number(q.get('h') || innerHeight);
renderer.setPixelRatio(q.get('w') ? 1 : Math.min(devicePixelRatio, 2)); renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();

const gltf = await new GLTFLoader().loadAsync(q.get('model'));
const obj = gltf.scene; obj.scale.setScalar(Number(q.get('scale') || 1));
obj.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
scene.add(obj);
const box = new THREE.Box3().setFromObject(obj), size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
obj.position.y -= box.min.y;
let tris = 0; obj.traverse(o => { if (o.isMesh) tris += (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3; });
const yaw = { front: 0, q34: 0.7, side: 1.5708, back: 3.1416 }[q.get('view') || 'q34'] ?? 0.7;
const d = Number(q.get('dist') || Math.max(size.x, size.y, size.z) * 2.6);
camera.position.set(Math.sin(yaw) * d, size.y * 0.55 + d * 0.25, Math.cos(yaw) * d);
camera.lookAt(0, size.y * 0.45, 0);
document.getElementById('info').textContent = `${q.get('model').split('/').pop()}\nsize ${size.x.toFixed(2)} x ${size.y.toFixed(2)} x ${size.z.toFixed(2)} m\n${Math.round(tris)} tris`;
renderer.render(scene, camera);
document.title = 'ready';
