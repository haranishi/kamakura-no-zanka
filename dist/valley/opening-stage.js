// opening-stage.js — オープニングの舞台（view層）。谷とは別の THREE.Scene に、燃える鎌倉の場面A〜Dを置く。
// 谷から離れた座標に置く案は、地形・遠景の山・影・大気と衝突するので採らない（design-opening.md §5）。
// 建物・人物は起動時に読み込んだモデルの複製（形と材質は谷と共有。解放しない）。舞台だけの資源（空・地面・粒子・光・板）は
// own() で控え、dispose() でまとめて解放する。本物の主人公は動かさない。光源は2つ（鍵の光と炎の光）だけを場面ごとに置き直す。
import * as THREE from 'three';
import { flicker } from './opening.js';

const smooth = k => k * k * (3 - 2 * k);
const V = (x, y, z) => new THREE.Vector3(x, y, z);

// 場面ごとの置き場（互いに離し、同時には1つだけ見せる）・カメラの道筋・空と霧と光の色。数値は未測定の設計目標
const SHOTS = {
  A: { origin: [0, 0, 0], fov: 40, from: [0, 1.15, 10], to: [0, 1.22, 6], look0: [0, 2.2, -20], look1: [0, 2.3, -20],
    sky: ['#120b0a', '#3a1610', '#a3401c'], fog: ['#24120d', 14, 120], ground: '#2a211c', key: ['#ff9a5c', 1.6, [-8, 14, -18]], glow: ['#ff7a32', 60, [3, 3, -10]] },
  B: { origin: [200, 0, 0], fov: 46, from: [0, 1.05, 16], to: [0, 1.05, 16], look0: [0, 7, 0], look1: [0, 7, 0],
    sky: ['#0d0909', '#2e120e', '#8a3418'], fog: ['#1e0f0c', 18, 130], ground: '#251d19', key: ['#ffa066', 1.5, [6, 10, -12]], glow: ['#ff6a28', 90, [0, 4, -2]] },
  C: { origin: [400, 0, 0], fov: 38, from: [0, 2.3, 20], to: [0, 2.3, 20], look0: [-3, 2.4, 0], look1: [3, 2.4, 0],
    sky: ['#0b0a0c', '#24120f', '#c0501f'], fog: ['#1b100d', 16, 150], ground: '#1f1a17', key: ['#ff8a4a', 1.8, [0, 8, -30]], glow: ['#ff7030', 40, [0, 3, -14]] },
  D: { origin: [600, 0, 0], fov: 42, from: [1.9, 2.05, 5.6], to: [1.25, 1.9, 3.3], look0: [0, 2.2, -40], look1: [0, 2.0, -40],
    sky: ['#0a0b10', '#1d1416', '#b2421c'], fog: ['#16100f', 30, 260], ground: '#1d1b18', key: ['#d8a070', 0.9, [-10, 12, -30]], glow: ['#ff6a2a', 20, [0, 6, -60]] },
};
export const STAGE_SHOTS = Object.keys(SHOTS);

function skyMaterial() {
  return new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { top: { value: new THREE.Color() }, mid: { value: new THREE.Color() }, glow: { value: new THREE.Color() } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `varying vec3 vDir; uniform vec3 top, mid, glow;
      void main(){ float h = normalize(vDir).y;
        vec3 c = mix(glow, mid, smoothstep(-0.02, 0.16, h)); c = mix(c, top, smoothstep(0.12, 0.7, h));
        gl_FragColor = vec4(c, 1.0); }`,
  });
}

export class OpeningStage {
  constructor({ renderer, models = {}, roster = null, quality = 'standard' } = {}) {
    this.renderer = renderer; this.models = models; this.roster = roster; this.quality = quality;
    this.owned = []; this.characters = []; this.time = 0; this.shot = null; this.disposed = false;
    const scene = this.scene = new THREE.Scene(); scene.name = 'opening-stage';
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 900);
    scene.fog = new THREE.Fog('#1a0e0b', 12, 140);
    this.sky = this.mesh(new THREE.SphereGeometry(800, 32, 16), skyMaterial());
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; scene.add(this.sky);
    // 環境光は、空の色から作った反射の絵（光源の数に数えない）。終わったら解放する
    const env = new THREE.Scene(), envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMaterial());
    this.paintSky(envSky.material, SHOTS.A); env.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(env, 0, 1, 300); pmrem.dispose(); envSky.geometry.dispose(); envSky.material.dispose();
    scene.environment = this.envRT.texture; scene.environmentIntensity = 0.55;
    // 光源は2つまで（R23・design-opening.md §5）
    this.key = new THREE.DirectionalLight('#ff9a5c', 1.6); this.key.castShadow = true;
    const sh = this.key.shadow, size = quality === 'light' ? 1024 : 2048;
    sh.mapSize.set(size, size); Object.assign(sh.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 120 }); sh.bias = -0.0004; sh.normalBias = 0.04;
    this.glow = new THREE.PointLight('#ff7a32', 60, 40, 1.8);
    scene.add(this.key, this.key.target, this.glow);
    // 場面ごとの組。仮の舞台は地面だけ（場面の作り込みは opening-stage の build* で足す）
    this.groups = {};
    const groundGeo = this.own(new THREE.PlaneGeometry(220, 220).rotateX(-Math.PI / 2));
    for (const [id, s] of Object.entries(SHOTS)) {
      const g = new THREE.Group(); g.name = 'shot-' + id; g.position.fromArray(s.origin);
      const ground = this.mesh(groundGeo, new THREE.MeshStandardMaterial({ color: s.ground, roughness: 0.95 }), false);
      ground.receiveShadow = true; g.add(ground);
      scene.add(g); this.groups[id] = g;
    }
    // 暗転の最初の数コマで、各場面を1コマずつ描いておく（材質の組み立てと影の準備を暗転の下で済ませ、場面の切り替えで止まらないように）
    this.warmQueue = ['B', 'C', 'D', 'A'];
  }

  own(x) { this.owned.push(x); return x; }
  mesh(geometry, material, ownGeometry = true) { if (ownGeometry) this.own(geometry); this.own(material); return new THREE.Mesh(geometry, material); }
  paintSky(material, s) { const u = material.uniforms; u.top.value.set(s.sky[0]); u.mid.value.set(s.sky[1]); u.glow.value.set(s.sky[2]); }

  setShot(id) {
    const s = SHOTS[id]; if (!s) return;
    this.shot = id;
    for (const [k, g] of Object.entries(this.groups)) g.visible = k === id;
    this.paintSky(this.sky.material, s);
    this.scene.fog.color.set(s.fog[0]); this.scene.fog.near = s.fog[1]; this.scene.fog.far = s.fog[2];
    const o = V(...s.origin);
    this.key.color.set(s.key[0]); this.key.intensity = s.key[1];
    this.key.position.copy(o).add(V(...s.key[2])); this.key.target.position.copy(o); this.key.target.updateMatrixWorld();
    this.glow.color.set(s.glow[0]); this.glowBase = s.glow[1]; this.glow.position.copy(o).add(V(...s.glow[2]));
  }

  // out は opening.js の出力。カメラの鍵（場面・進み）だけを見る。暗転と題名の間は、最後の場面のまま
  update(out, dt, aspect) {
    if (this.disposed) return;
    this.time += dt;
    if (aspect && Math.abs(this.camera.aspect - aspect) > 1e-4) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    const want = out?.camera?.shot || (this.warmQueue.length ? this.warmQueue.shift() : this.shot || 'A');
    if (want !== this.shot) this.setShot(want);
    const s = SHOTS[this.shot], o = V(...s.origin), k = smooth(out?.camera ? out.camera.k : 0);
    this.camera.position.copy(o).add(V(...s.from).lerp(V(...s.to), k));
    this.camera.lookAt(o.clone().add(V(...s.look0).lerp(V(...s.look1), k)));
    if (this.camera.fov !== s.fov) { this.camera.fov = s.fov; this.camera.updateProjectionMatrix(); }
    this.sky.position.copy(this.camera.position);
    this.glow.intensity = this.glowBase * flicker(this.time, s.origin[0] * 0.01);
  }

  // 舞台だけの資源を解放する。複製したモデルの形と材質（谷と共有）には触れない
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.characters) c.dispose();
    this.fx?.dispose();
    this.key.dispose(); this.glow.dispose();
    for (const x of this.owned) x.dispose();
    this.envRT.dispose();
    this.scene.environment = null; this.scene.clear();
  }
}
