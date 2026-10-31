// opening-stage.js — オープニングの舞台（view層）。谷とは別の THREE.Scene に、燃える鎌倉の場面A〜Dを置く。
// 谷から離れた座標に置く案は、地形・遠景の山・影・大気と衝突するので採らない（design-opening.md §5）。
// 配置・炎・火の粉・煙・カメラの道筋は opening-scenes.js（純粋層）が決め、ここはそれを組み立てて描くだけ。
// 建物・人物は起動時に読み込んだモデルの複製（形と材質は谷と共有。解放しない）。色を変える建物だけ材質を複製し、それは解放する。
// 舞台だけの資源（空・地面・石段・旗・炎の板・粒子・光）は own() で控え、dispose() でまとめて解放する。光源は鍵の光と炎の光の2つだけ。
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { flicker } from './opening.js';
import { SCENES, SCENE_IDS, cameraAt, flameSprites, createParticleState, particleStep, horizonColor, heroAt, townHouses, townLights, scatterGround, figureAt, groveTrees, smoothNormals } from './opening-scenes.js';
import { FlameField, skyMaterial, paintSky, groundMaterial, stoneMaterial, silhouetteMaterial, decorate, rimLight } from './opening-fire.js';
import { WaterSurface, instanceModel, townField, lightDots, ridgeGeometry, mistMaterial, stoneField, tuftField, loadGeometry, treeField, wallGeometry } from './opening-set.js';
import { Character } from './characters.js';
import { GRIP } from './config.js';
import { FX } from './fx.js';
import { patchGrade, patchLift } from './grade.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const SMOOTH = new WeakMap();                                         // 人物の形 → ならした法線（JSの配列だけ。上映をくり返しても計算は最初の1回）
const UP = V(0, 1, 0);
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const PREWARM = { A: 9, B: 11, C: 14, D: 28 };       // 最初に見せる前に、煙と火の粉を何秒ぶん流しておくか（柱が育った状態で始める）
export const STAGE_SHOTS = SCENE_IDS;

export class OpeningStage {
  constructor({ renderer, models = {}, roster = null, quality = 'standard' } = {}) {
    this.renderer = renderer; this.models = models; this.roster = roster; this.quality = quality;
    this.owned = []; this.characters = []; this.fields = []; this.fxs = []; this.instanced = []; this.time = 0; this.shot = null; this.disposed = false;
    this.smoothGeos = new Map(); this.rims = [];
    this.clock = { value: 0 };                                                    // 屋根の熾火などの材質が読む時刻（全場面で共有）
    this.reduced = false; this.bufferSize = new THREE.Vector2();
    const scene = this.scene = new THREE.Scene(); scene.name = 'opening-stage';
    this.camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 900);
    scene.fog = new THREE.Fog('#1a0e0b', 12, 140);
    this.sky = this.mesh(new THREE.SphereGeometry(800, 32, 16), skyMaterial());
    this.sky.renderOrder = -10; this.sky.frustumCulled = false; scene.add(this.sky);
    // 環境光は、空から作った反射の絵（光源の数に数えない）。終わったら解放する
    const env = new THREE.Scene(), envSky = new THREE.Mesh(new THREE.SphereGeometry(100, 24, 12), skyMaterial());
    paintSky(envSky.material, SCENES.A.sky); env.add(envSky);
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.envRT = pmrem.fromScene(env, 0, 1, 300); pmrem.dispose(); envSky.geometry.dispose(); envSky.material.dispose();
    scene.environment = this.envRT.texture; scene.environmentIntensity = 0.4;
    // 光源は2つまで（R23・design-opening.md §5）：空の明かりの鍵（影を落とす）と、炎の明かり（揺らぐ）
    this.key = new THREE.DirectionalLight('#d9c7a8', 0.6); this.key.castShadow = true;
    const sh = this.key.shadow, size = quality === 'light' ? 1024 : 2048;
    sh.mapSize.set(size, size); Object.assign(sh.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 140 }); sh.bias = -0.0004; sh.normalBias = 0.04;
    this.glow = new THREE.PointLight('#ff7a32', 60, 40, 1.8);
    scene.add(this.key, this.key.target, this.glow);
    this.groundGeo = this.own(new THREE.PlaneGeometry(260, 260).rotateX(-Math.PI / 2));
    this.groups = {}; this.scenes = {};
    for (const id of SCENE_IDS) this.build(id);
    // 暗転の最初の数コマで、各場面を1コマずつ描いておく（材質の組み立てと影の準備を暗転の下で済ませ、場面の切り替えで止まらないように）
    this.warmQueue = ['B', 'C', 'D', 'A'];
  }

  own(x) { this.owned.push(x); return x; }
  mesh(geometry, material, ownGeometry = true) { if (ownGeometry) this.own(geometry); this.own(material); return new THREE.Mesh(geometry, material); }

  // 場面の組：地面・建物の複製・炎の板・粒子。場面ごとの作り込み（旗・基壇）もここで足す
  build(id) {
    const s = SCENES[id], g = new THREE.Group(); g.name = 'shot-' + id; g.position.fromArray(s.origin);
    this.makeGround(g, s);
    for (const m of s.models) this.place(g, m);
    if (s.flag) g.add(this.makeFlag(s.flag));
    if (s.terrace) g.add(this.makeTerrace(s.terrace));
    for (const row of s.rows || []) this.makeRow(g, row);
    const figures = (s.figures || []).map(f => this.makeFigure(g, f, s.rim));
    const hero = s.hero ? this.makeHero(g, s.hero) : null;
    const extras = this.makeExtras(g, s);
    const flames = new FlameField(flameSprites(id)); this.fields.push(flames); g.add(flames.mesh);
    const fx = new FX(g); this.fxs.push(fx);
    this.scene.add(g); this.groups[id] = g;
    this.scenes[id] = { group: g, flames, fx, figures, hero, pstate: createParticleState(id), warmed: false, ...extras };
  }

  // 地面：ふつうは1枚。川（water）は両岸の2枚と水面、山道（cliff）は道の平地・落ちる斜面・谷底の3枚にする
  makeGround(g, s) {
    const mat = this.own(groundMaterial(s.ground)), add = (w, d, x, y, z, tilt = 0) => {
      const m = new THREE.Mesh(this.own(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2 + tilt)), mat); m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m;
    };
    if (s.water) {
      const [x0, x1] = s.water.x, L = 130;
      add(L + x0, 260, (-L + x0) / 2, 0, 0); add(L - x1, 260, (x1 + L) / 2, 0, 0);
      // 川面は手続きの水（波で砕けた炎の照り返し）。場面の光源を受けないので、鍵の光の照り返しが板のように光らない
      this.water = new WaterSurface({ width: x1 - x0 + 2, length: 260, center: [(x0 + x1) / 2, 0, 0], y: s.water.y, color: s.water.color, fires: s.water.reflect || [] });
      g.add(this.water.mesh);
      for (const sx of [-1, 1]) {                                                  // 岸の斜面（地面の縁が水面の上に直線で浮かないように）
        const bank = new THREE.Mesh(this.own(new THREE.PlaneGeometry(1.6, 260).rotateX(-Math.PI / 2).rotateZ(sx * 0.42)), mat);
        bank.position.set(sx > 0 ? x1 - 0.7 : x0 + 0.7, -0.3, 0); bank.receiveShadow = true; g.add(bank);
      }
    } else if (s.cliff) {
      const c = s.cliff, slope = Math.atan2(-c.drop, c.run), len = Math.hypot(c.drop, c.run), floor = this.own(groundMaterial(c.floor || s.ground));
      add(60, 60, 0, 0, c.edge + 30);
      const sl = add(420, len, 0, c.drop / 2, c.edge - c.run / 2, -slope); sl.material = floor;
      const fl = add(900, 600, 0, c.drop, c.edge - c.run - 300); fl.material = floor;
    } else { const ground = new THREE.Mesh(this.groundGeo, mat); ground.receiveShadow = true; g.add(ground); }
  }

  // 人物の形を、法線だけ「ならした」ものに差し替える（位置・UV・骨の重みは谷の形と同じ配列を指す。新しく送るのは法線だけ）。
  // 細かな布の面の向きが縁の明かり・逆光で白い粒に散るのを止める（3周目）。解放するときは、共有の配列を外してから自分の法線だけを返す
  smoothed(src) {
    let g = this.smoothGeos.get(src); if (g) return g;
    let arr = SMOOTH.get(src);
    if (!arr) {
      const p = src.attributes.position, nn = src.attributes.normal, n = p.count, pos = new Float32Array(n * 3), nor = new Float32Array(n * 3);
      for (let i = 0; i < n; i++) { pos[i * 3] = p.getX(i); pos[i * 3 + 1] = p.getY(i); pos[i * 3 + 2] = p.getZ(i); nor[i * 3] = nn.getX(i); nor[i * 3 + 1] = nn.getY(i); nor[i * 3 + 2] = nn.getZ(i); }
      arr = smoothNormals(pos, nor, src.index?.array); SMOOTH.set(src, arr);
    }
    g = new THREE.BufferGeometry(); g.name = (src.name || 'figure') + '-smooth';
    g.setIndex(src.index); for (const [k, a] of Object.entries(src.attributes)) if (k !== 'normal') g.setAttribute(k, a);
    g.setAttribute('normal', new THREE.Float32BufferAttribute(arr, 3));
    for (const gr of src.groups) g.addGroup(gr.start, gr.count, gr.materialIndex);
    g.boundingSphere = src.boundingSphere; g.boundingBox = src.boundingBox;
    this.smoothGeos.set(src, g); return g;
  }
  smoothFigure(c) { c.model.traverse(o => { if (o.isSkinnedMesh) o.geometry = this.smoothed(o.geometry); }); }

  // 影の人物：人物の複製の材質を、自分で作った暗い単色＋縁の光に替える（材質は own して解放。形と骨は共有の複製）
  makeFigure(g, f, rim) {
    const c = new Character(this.roster, f.who); this.characters.push(c);
    this.silhouette ??= this.own(silhouetteMaterial(rim));
    if (!this.rims.includes(this.silhouette.userData.rim)) this.rims.push(this.silhouette.userData.rim);
    this.smoothFigure(c);
    c.model.traverse(o => { if (o.isSkinnedMesh) { o.material = this.silhouette; o.castShadow = true; } });
    if (f.load) this.attachLoad(c, f.load);
    c.root.position.fromArray(figureAt(f, 0)); c.root.rotation.y = Math.PI / 2; g.add(c.root);
    return { c, f };
  }
  // 荷（天秤棒・背負った包み・抱いた子）を胸の骨に付ける。形は人物の根の向きで作ってあるので、いまの骨の向きを打ち消して付ける（歩くと骨と一緒に揺れる）
  attachLoad(c, kind) {
    const bone = c.bone('Spine02') || c.bone('Spine01'); if (!bone) return;
    c.root.updateMatrixWorld(true);
    const inRoot = new THREE.Matrix4().copy(c.root.matrixWorld).invert().multiply(bone.matrixWorld);
    const m = new THREE.Mesh(this.own(loadGeometry(kind)), this.silhouette); m.name = 'load-' + kind; m.castShadow = true;
    m.matrixAutoUpdate = false; m.matrix.copy(inRoot).invert(); bone.add(m);
  }
  // 景継（D）：主人公の複製。腰の太刀も付ける（後ろ姿の形で侍と分かる）。本物の主人公は動かさない
  makeHero(g, h) {
    const c = new Character(this.roster, 'hero'); this.characters.push(c);
    c.setTachi(GRIP, false);
    // 法線をならし、法線の絵の凹凸を弱め（遠い火の明かりが布の細かな面で白い粒に割れた）、炎の側の輪郭に朱の明かりを足す。材質は複製して解放する
    this.smoothFigure(c);
    c.model.traverse(o => {
      if (!o.isSkinnedMesh) return;
      const m = this.own(o.material.clone()); patchLift(m, 0.78);
      if (m.normalMap) m.normalScale.multiplyScalar(h.normalScale ?? 0.35);
      rimLight(m, h.rim); this.rims.push(m.userData.rim); o.material = m;
    });
    c.root.position.fromArray(h.at); c.root.rotation.y = Math.atan2(h.face[0], h.face[1]); g.add(c.root);
    return c;
  }

  // 建物・小道具の複製を置く。色を変える（tint）・焼けて煤けた（burning）ものだけ材質を複製する（複製は解放する。絵は共有のまま）
  place(g, m) {
    const src = this.models[m.key]; if (!src) return null;
    const o = src.clone(true);
    o.position.fromArray(m.at); o.rotation.set(m.tilt?.[0] || 0, m.rotY || 0, m.tilt?.[2] || 0, 'YXZ');
    if (Array.isArray(m.scale)) o.scale.fromArray(m.scale); else o.scale.setScalar(m.scale);         // 橋は長さ・高さ・幅を別々に（欄干を人の腰の高さに保つ）
    if (m.tint || m.burning || m.deco) {
      const tint = m.tint ? new THREE.Color(m.tint) : null;
      o.traverse(x => {
        if (!x.isMesh) return;
        const mats = [].concat(x.material).map(mat => {
          const c = this.own(mat.clone());
          if (tint) c.color.multiply(tint);
          if (m.burning) c.color.multiplyScalar(0.58);                          // 煤けた色。炎の明かりで赤く照らされても、黒ずんで見える
          patchGrade(c, { whiteMax: 0.46 });
          if (!m.deco) return c;
          const ox = g.position.x, d = m.deco, ember = d.ember && { ...d.ember, x: d.ember.x.map(v => v + ox) };   // 熾火の範囲は世界座標へ
          return decorate(c, { roof: d.roof || null, ember, stone: !!d.stone, time: this.clock });
        });
        x.material = mats.length === 1 ? mats[0] : mats;
      });
    }
    g.add(o); return o;
  }

  // 家並み：谷のモデルを、種類ごとのインスタンスで並べる（1種類につき部品の数だけの描画呼出）。list の要素は [x, z, rotY, scale, shade]
  makeRow(g, row) {
    const src = this.models[row.key]; if (!src) return;
    for (const im of instanceModel(src, row.list.map(([x, z, rotY, scale, shade]) => ({ at: [x, 0, z], rotY, scale, shade })))) { this.instanced.push(im); g.add(im); }
  }
  // 場面だけの大道具：遠い町と灯・山並み・霧の層・小石・草むら（D）。自分で作った形と材質は own、インスタンスの箱は instanced で解放する
  makeExtras(g, s) {
    const out = {};
    if (s.town) {
      const t = townField(townHouses(s.town)); this.own(t.geometry); this.own(t.material); this.instanced.push(t.mesh); g.add(t.mesh);
      const l = lightDots(townLights(s.town)); this.own(l.geometry); this.own(l.material); g.add(l.points); out.lights = l;
    }
    if (s.ridges) { const m = this.mesh(ridgeGeometry(s.ridges), new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide })); m.name = 'ridges'; m.renderOrder = -5; g.add(m); }
    if (s.mist) out.mist = s.mist.map(ms => {
      const m = this.mesh(new THREE.PlaneGeometry(ms.x[1] - ms.x[0], ms.z[0] - ms.z[1]).rotateX(-Math.PI / 2), mistMaterial(ms));
      m.position.set((ms.x[0] + ms.x[1]) / 2, ms.y, (ms.z[0] + ms.z[1]) / 2); m.renderOrder = 3; m.name = 'mist'; g.add(m); return m.material;
    });
    if (s.stones) { const f = stoneField(scatterGround(s.stones, 'stone'), s.stones.color, s.stones.seed); this.own(f.geometry); this.own(f.material); this.instanced.push(f.mesh); g.add(f.mesh); }
    if (s.tufts) { const f = tuftField(scatterGround(s.tufts, 'tuft'), s.tufts.color); this.own(f.geometry); this.own(f.material); this.instanced.push(f.mesh); g.add(f.mesh); }
    if (s.debris) { const f = stoneField(scatterGround(s.debris, 'stone'), s.debris.color, s.debris.seed); this.own(f.geometry); this.own(f.material); this.instanced.push(f.mesh); g.add(f.mesh); }
    if (s.trees) { const f = treeField(groveTrees(s.trees)); this.own(f.geometry); this.own(f.material); this.instanced.push(f.mesh); g.add(f.mesh); }
    if (s.walls) {                                                                // 瓦の付いた塀：土壁と、瓦の筋のある小屋根（材質は自分のもの）
      const mat = this.own(decorate(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.95 }), { roof: { y: s.walls.h - 0.1, pitch: 0.2, course: 0.1 }, time: this.clock }));
      const m = new THREE.Mesh(this.own(wallGeometry(s.walls.runs.map(([from, to]) => ({ from, to })), s.walls.h)), mat); m.castShadow = m.receiveShadow = true; m.name = 'walls'; g.add(m);
    }
    return out;
  }

  // 倒れた幟：竿が地面に横たわり、無地の布（旗印なし。実在の家紋は使わない）が竿に沿って地面に皺を作る。布の端だけ熱い風に揺れる
  makeFlag(spec) {
    const grp = new THREE.Group(); grp.name = 'fallen-flag';
    const p0 = V(...spec.pole[0]), p1 = V(...spec.pole[1]), dir = p1.clone().sub(p0), len = dir.length(); dir.normalize();
    const wood = this.own(new THREE.MeshStandardMaterial({ color: '#3a2e24', roughness: 0.82 }));
    const pole = this.mesh(new THREE.CylinderGeometry(0.035, 0.045, len, 8), wood);
    pole.position.copy(p0).add(p1).multiplyScalar(0.5); pole.quaternion.setFromUnitVectors(UP, dir); pole.castShadow = pole.receiveShadow = true;
    const [cw, ch] = spec.cloth, nu = 18, nv = 10, side = V(-dir.z, 0, dir.x).normalize(), start = p1.clone().addScaledVector(dir, -ch - 0.12);
    if (side.z < 0) side.negate();                                                  // 布はカメラの側（+z）へ垂れる
    const pos = [], col = [], idx = [], base = [];
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv, at = start.clone().addScaledVector(dir, u * ch), d = v * cw, hang = Math.max(0, at.y - 0.03);
      const wave = 0.1 * Math.sin(u * 11.0 + v * 3.0 + Math.sin(u * 3.1) * 1.5) + 0.04 * Math.sin(u * 23.0 - v * 7.0);
      // 竿から地面までは垂れ（少し手前へふくらむ）、余りは地面に皺を作って広がる
      const p = d < hang ? at.clone().addScaledVector(UP, -d).addScaledVector(side, 0.22 * Math.sin(Math.PI * d / Math.max(hang, 1e-3)) + wave)
        : V(at.x, 0.03 + Math.abs(wave) * 1.1, at.z).addScaledVector(side, wave * 0.6 + (d - hang) * 0.92);
      pos.push(p.x, p.y, p.z); base.push(u, Math.min(1, d / Math.max(hang, 0.2)));
      const soot = 0.55 + 0.45 * (1 - smooth(0.55, 1, v) * (0.6 + 0.4 * Math.sin(u * 7.0))) - 0.25 * smooth(0.85, 1, u);
      col.push(0.46 * soot, 0.41 * soot, 0.32 * soot);                           // 生成りの古い麻（線形の値）。端ほど煤けて暗い
    }
    for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) { const a = i * (nv + 1) + j, b = a + nv + 1; idx.push(a, b, a + 1, b, b + 1, a + 1); }
    const geo = this.own(new THREE.BufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage)); geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); geo.setIndex(idx); geo.computeVertexNormals();
    // 地面に伏せた麻。自発光は付けない（1周目の暗い橙の自発光は、地面の上で赤いしみに見えた）
    const cloth = new THREE.Mesh(geo, this.own(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.96, side: THREE.DoubleSide })));
    cloth.castShadow = cloth.receiveShadow = true;
    this.flag = { geo, rest: Float32Array.from(pos), uv: base, side };
    grp.add(pole, cloth); return grp;
  }
  flutter(t, amp) {
    const f = this.flag; if (!f) return;
    const a = f.geo.attributes.position, w = SCENES.A.wind;
    for (let k = 0; k < f.uv.length / 2; k++) {
      const u = f.uv[k * 2], v = f.uv[k * 2 + 1], sway = amp * Math.sin(Math.PI * Math.min(1, v)) * (0.5 + 0.5 * Math.sin(t * 1.9 + u * 6.0)) * (0.6 + 0.4 * Math.sin(t * 0.7 + u * 2.0));
      a.array[k * 3] = f.rest[k * 3] + w[0] * sway; a.array[k * 3 + 1] = f.rest[k * 3 + 1]; a.array[k * 3 + 2] = f.rest[k * 3 + 2] + w[1] * sway;   // 垂れた布が熱い風で風下へふくらむ
    }
    a.needsUpdate = true; f.geo.computeVertexNormals();
  }

  // 寺の基壇と石段（手続きの箱。1つの形にまとめて描画呼出を減らす）
  makeTerrace(t) {
    const [w, h, d] = t.size, st = t.steps, parts = [];
    parts.push(new THREE.BoxGeometry(w, h, d).translate(0, h / 2, t.front - d / 2));
    for (let k = 1; k <= st.n; k++) parts.push(new THREE.BoxGeometry(st.width, k * st.rise, st.run).translate(0, k * st.rise / 2, t.front + (st.n - k) * st.run + st.run / 2));
    for (const sx of [-1, 1]) parts.push(new THREE.BoxGeometry(0.5, h + 0.25, st.n * st.run).translate(sx * (st.width / 2 + 0.25), (h + 0.25) / 2, t.front + st.n * st.run / 2));
    const geo = this.own(mergeGeometries(parts.map(p => p.toNonIndexed()))); for (const p of parts) p.dispose();
    const m = this.mesh(geo, stoneMaterial(), false); m.castShadow = m.receiveShadow = true; m.name = 'terrace';
    return m;
  }

  setShot(id) {
    const s = SCENES[id]; if (!s) return;
    this.shot = id;
    for (const [k, g] of Object.entries(this.groups)) g.visible = k === id;
    paintSky(this.sky.material, s.sky, s.wind);
    const mid = cameraAt(id, 0.5);
    // fogGlow：霧に炎の方角のにじみをどれだけ混ぜるか（D は谷底を赤くしないよう0。空の帯だけ赤い）
    this.scene.fog.color.set(horizonColor({ ...s.sky, glowAmt: s.sky.glowAmt * (s.fogGlow ?? 1) }, [mid.look[0] - mid.pos[0], mid.look[2] - mid.pos[2]])); this.scene.fog.near = s.fog[0]; this.scene.fog.far = s.fog[1];
    this.scene.environmentIntensity = s.env;
    const o = V(...s.origin);
    this.key.color.set(s.key.color); this.key.intensity = s.key.intensity;
    this.key.position.copy(o).add(V(...s.key.at)); this.key.target.position.copy(o).add(V(0, 0, -6)); this.key.target.updateMatrixWorld();
    this.glow.color.set(s.glow.color); this.glowBase = s.glow.intensity; this.glow.distance = s.glow.distance; this.glow.position.copy(o).add(V(...s.glow.at));
    const sc = this.scenes[id];
    if (!sc.warmed) {                                                              // 煙の柱と火の粉を、育った状態から見せる
      sc.warmed = true;
      for (let t = 0; t < PREWARM[id]; t += 1 / 20) { this.emit(id, 1 / 20); sc.fx.add.update(1 / 20); sc.fx.norm.update(1 / 20); }
    }
  }
  emit(id, dt) {
    const sc = this.scenes[id], r = particleStep(id, sc.pstate, dt); sc.pstate = r.state;
    for (const p of r.spawns) (p.kind === 'ember' ? sc.fx.add : sc.fx.norm).emit(p);
  }

  // out は opening.js の出力。カメラの鍵（場面・進み）だけを見る。暗転と題名の間は、最後の場面のまま
  update(out, dt, aspect, { reduced = false } = {}) {
    if (this.disposed) return;
    this.time += dt; this.reduced = reduced;
    if (aspect && Math.abs(this.camera.aspect - aspect) > 1e-4) { this.camera.aspect = aspect; this.camera.updateProjectionMatrix(); }
    const want = out?.camera?.shot || (this.warmQueue.length ? this.warmQueue.shift() : this.shot || 'A');
    if (want !== this.shot) this.setShot(want);
    const id = this.shot, s = SCENES[id], sc = this.scenes[id], cam = cameraAt(id, out?.camera ? out.camera.k : 0);
    this.camera.position.fromArray(cam.pos); this.camera.lookAt(cam.look[0], cam.look[1], cam.look[2]);
    if (this.camera.fov !== cam.fov) { this.camera.fov = cam.fov; this.camera.updateProjectionMatrix(); }
    this.sky.position.copy(this.camera.position); this.sky.material.uniforms.time.value = this.time;
    const fl = flicker(this.time, s.origin[0] * 0.01);
    this.glow.intensity = this.glowBase * fl;
    sc.flames.update(this.time, this.camera, 0.9 + 0.1 * fl, s.wind, this.scene.fog);
    this.emit(id, dt);
    const vh = this.renderer.getDrawingBufferSize(this.bufferSize).y || 720;
    sc.fx.update(dt, this.camera, vh);
    this.clock.value = this.time;
    if (id === 'C' && this.water) this.water.update(this.time, this.camera, s.sky, this.scene.fog, s.origin);
    for (const m of sc.mist || []) { m.uniforms.uTime.value = this.time; m.uniforms.uFogCol.value.copy(this.scene.fog.color); m.uniforms.uFog.value.set(this.scene.fog.near, this.scene.fog.far); m.uniforms.uWind.value.set(s.wind[0], s.wind[1]); }
    if (sc.lights) sc.lights.uniforms.uScale.value = vh * 0.5 / Math.tan(this.camera.fov * Math.PI / 360);
    if (id === 'A') this.flutter(this.time, reduced ? 0 : 0.05);
    this.animate(id, sc, out, dt);
  }

  // 人物の動き：C は橋を渡る（場面に入ってからの秒で位置を決める）、D は見返ったあと向き直って歩き出す
  animate(id, sc, out, dt) {
    const segT = out?.camera ? out.segmentT : 0, dur = out?.camera ? out.segmentLength : 10;
    for (const { c, f } of sc.figures) {
      c.root.position.fromArray(figureAt(f, segT));
      c.locomote(f.speed, f.style); c.update(dt);
    }
    if (this.rims.length) {                                                      // 縁の光は鍵の光の向き（場面ごとに炎の方角へ置く。カメラ空間）から
      const L = this.key.position.clone().sub(this.key.target.position).normalize().transformDirection(this.camera.matrixWorldInverse);
      for (const u of this.rims) u.uRimL.value.copy(L);
    }
    if (sc.hero) {
      const D = SCENES.D, h = heroAt(segT, dur, D.hero);
      sc.hero.root.rotation.y = h.yaw; sc.hero.root.position.fromArray(h.pos);
      sc.hero.locomote(h.walk > 0 ? D.hero.speed : h.moving ? 0.35 : 0, 'relaxed'); sc.hero.update(dt);          // 向き直る間は足踏み、そのあと歩く
    }
  }

  // 舞台だけの資源を解放する。複製したモデルの形と材質（谷と共有）には触れない
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    for (const c of this.characters) c.dispose();
    for (const f of this.fields) f.dispose();
    for (const fx of this.fxs) fx.dispose();
    for (const im of this.instanced) { im.removeFromParent(); im.dispose(); }     // インスタンスの行列の箱だけ（形と材質は谷と共有、または own で解放）
    this.water?.dispose();
    for (const g of this.smoothGeos.values()) {                                  // 共有の配列（位置・UV・骨の重み・番号）を外してから解放する＝返すのは自分の法線だけ
      for (const k of Object.keys(g.attributes)) if (k !== 'normal') g.deleteAttribute(k);
      g.setIndex(null); g.dispose();
    }
    this.key.dispose(); this.glow.dispose();
    for (const x of this.owned) x.dispose();
    this.envRT.dispose();
    this.scene.environment = null; this.scene.clear();
  }
}
