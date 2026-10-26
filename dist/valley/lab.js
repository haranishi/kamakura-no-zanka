// lab.js — 人物1人の動作を1コマずつ近くで見る実験ページ（開発用。遊びの入口ではない）。
// 使い方：lab.html?who=hero&clip=Katana_Kesa_Cut&t=0.8&view=q34&weapon=drawn&shot=1&w=900&h=1100
//   who 人物 / clip 動作 / t 秒 / view front|back|side|q34 / weapon drawn|sheathed|none / axes=1 手の軸を表示 / shot=1 操作盤を隠す
import * as THREE from 'three';
import { loadRoster, Character, ROSTER } from './characters.js';
import { GRIP } from './config.js';
import { makeNaginata, makeYumi, makeArrow, makeQuiver } from './weapons.js';

const q = new URLSearchParams(location.search);
const get = (k, d) => q.get(k) ?? d;
if (q.get('shot')) document.body.classList.add('shot');
const view = document.getElementById('view');
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
view.append(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color('#5b6a68');
// 金属の反射用に、簡単な空グラデーションを環境にする
{
  const sky = new THREE.Scene();
  const mat = new THREE.ShaderMaterial({ side: THREE.BackSide, uniforms: {}, vertexShader: 'varying vec3 p;void main(){p=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',
    fragmentShader: 'varying vec3 p;void main(){float h=normalize(p).y;vec3 top=vec3(.35,.5,.7),hor=vec3(1.,.82,.6),low=vec3(.25,.22,.2);vec3 c=h>0.?mix(hor,top,pow(h,.5)):mix(hor,low,pow(-h,.4));gl_FragColor=vec4(c*1.4,1.);}' });
  sky.add(new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), mat));
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(sky, 0.02).texture;
}
scene.add(new THREE.HemisphereLight('#cfe0ff', '#4a4030', 0.6));
const sun = new THREE.DirectionalLight('#ffe3b0', 3.0); sun.position.set(-3, 4, 3); sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048); Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 14 }); sun.shadow.bias = -0.0003;
scene.add(sun);
const ground = new THREE.Mesh(new THREE.CircleGeometry(6, 48), new THREE.MeshStandardMaterial({ color: '#6b5f4a', roughness: 1 }));
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true; scene.add(ground);

const camera = new THREE.PerspectiveCamera(32, 1, 0.1, 80);
let roster, ch, playing = !q.get('t') && !q.get('freeze');
let viewName = get('view', 'q34'), orbit = { yaw: 0, pitch: 0.12, dist: 0 };
const clock = new THREE.Clock();

function resize() {
  const w = Number(get('w', innerWidth)), h = Number(get('h', innerHeight));
  renderer.setPixelRatio(q.get('w') ? 1 : Math.min(devicePixelRatio, 2));
  renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
}
function setView(name) {
  viewName = name;
  orbit.yaw = { front: 0, q34: 0.7, side: 1.5708, back: 3.1416 }[name] ?? 0.7;
}
function frame() {
  const target = new THREE.Vector3(0, ch.height * 0.5, 0);
  const d = orbit.dist || ch.height * 3.0;
  camera.position.set(Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * d, target.y + Math.sin(orbit.pitch) * d, Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * d);
  camera.lookAt(target);
}
function axesAt(bone, len = 0.12) {
  const g = new THREE.Group();
  for (const [dir, color] of [[[1, 0, 0], 0xff3030], [[0, 1, 0], 0x30ff30], [[0, 0, 1], 0x3080ff]]) {
    g.add(new THREE.ArrowHelper(new THREE.Vector3(...dir), new THREE.Vector3(), len, color, 0.03, 0.02));
  }
  bone.add(g);
}

function spawn(who) {
  if (ch) ch.dispose();
  ch = new Character(roster, who, {});
  scene.add(ch.root);
  const w = get('weapon', 'none');
  if (w === 'drawn' || w === 'sheathed') ch.setTachi(GRIP, w === 'drawn');
  if (w === 'naginata') ch.attach('naginata', makeNaginata(), GRIP.naginata);
  if (w === 'yumi') ch.attachBow(GRIP, makeArrow());
  if (q.get('axes')) for (const b of ['RightHand', 'LeftHand', 'Hips']) axesAt(ch.bone(b));
}
function setClip(name, t) {
  const a = ch.play(name, { fade: 0, restart: true });
  if (!a) return;
  if (t != null) { a.paused = true; a.time = Math.min(t, ch.meta(name).seconds - 0.001); ch.update(0); playing = false; }
  const slider = document.getElementById('time');
  slider.max = ch.meta(name).seconds;
}

async function main() {
  roster = await loadRoster({});
  const whoSel = document.getElementById('who'), clipSel = document.getElementById('clip');
  for (const n of ROSTER) whoSel.add(new Option(n, n));
  whoSel.value = get('who', 'hero');
  spawn(whoSel.value);
  const fill = () => { clipSel.replaceChildren(...[...ch.tpl.clips.keys()].sort().map(n => new Option(n, n))); };
  fill();
  clipSel.value = get('clip', ch.tpl.clips.has('Katana_Guard_Idle') ? 'Katana_Guard_Idle' : [...ch.tpl.clips.keys()][0]);
  setClip(clipSel.value, q.get('t') != null ? Number(q.get('t')) : null);
  setView(viewName); resize();
  whoSel.onchange = () => { spawn(whoSel.value); fill(); setClip(clipSel.value in Object.fromEntries(ch.tpl.clips) ? clipSel.value : [...ch.tpl.clips.keys()][0]); };
  clipSel.onchange = () => { setClip(clipSel.value); playing = true; };
  document.getElementById('time').oninput = e => { playing = false; const a = ch.current; a.paused = true; a.time = Number(e.target.value); ch.update(0); };
  document.getElementById('play').onclick = () => { playing = !playing; if (ch.current) ch.current.paused = !playing; };
  for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => setView(b.dataset.view);
  let drag = null;
  renderer.domElement.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY }; renderer.domElement.setPointerCapture(e.pointerId); };
  renderer.domElement.onpointermove = e => { if (!drag) return; orbit.yaw -= (e.clientX - drag.x) * 0.008; orbit.pitch = Math.max(-0.3, Math.min(1.2, orbit.pitch + (e.clientY - drag.y) * 0.005)); drag = { x: e.clientX, y: e.clientY }; };
  renderer.domElement.onpointerup = () => { drag = null; };
  renderer.domElement.onwheel = e => { orbit.dist = Math.max(0.8, (orbit.dist || ch.height * 3) * (1 + e.deltaY * 0.001)); };
  window.addEventListener('resize', resize);
  window.__lab = { ch, setClip, setView, spawn, renderer, scene, camera, get character() { return ch; } };
  document.title = 'ready';
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    if (playing) ch.update(dt);
    frame();
    renderer.render(scene, camera);
    const a = ch.current;
    document.getElementById('info').textContent = a ? `${ch.currentName}\n${a.time.toFixed(2)} / ${ch.meta(ch.currentName).seconds.toFixed(2)} s\n${renderer.info.render.triangles} tris` : '';
    if (a && playing) document.getElementById('time').value = a.time;
  });
}
main().catch(e => { document.body.append(String(e)); console.error(e); });
