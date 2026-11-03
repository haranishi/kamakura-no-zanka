// fx.js — 粒子表現（火花・衝撃の光・土煙・焚き火の火の粉・煙・落ち葉）と、刃の軌跡（view層）。
// 粒子はCPUで更新する小さな点群2つ（加算／通常）。血の表現は使わず、火花と光と土煙で重さを出す（requirements 6.5）。
// 刃の軌跡は、帯のサンプル・寿命・頂点の並べ方を slash-trail.js（純粋）が決め、ここは1つのメッシュ（描画呼出1つ）へ流すだけ。
import * as THREE from 'three';
import { TRAIL_VERTS, TRAIL_INDICES, createTrailPool, addSample, closeUntouched, pruneTrails, buildRibbon, clearTrails, trailStats, trailVelocity, trailEdges } from './slash-trail.js';
import { STREAK_VERTS, STREAK_INDICES, createStreaks, streakIndex, emitStreak, stepStreaks, buildStreaks, clearStreaks } from './spark-streaks.js';

class PointCloud {
  constructor(max, additive) {
    this.max = max; this.count = 0;
    this.pos = new Float32Array(max * 3); this.col = new Float32Array(max * 4); this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3); this.life = new Float32Array(max); this.age = new Float32Array(max);
    this.grav = new Float32Array(max); this.drag = new Float32Array(max); this.s0 = new Float32Array(max); this.s1 = new Float32Array(max); this.a0 = new Float32Array(max);
    this.base = new Float32Array(max * 3);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 600 } };
    const m = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false, blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: 'attribute vec4 aColor; attribute float aSize; varying vec4 vC; uniform float uScale; void main(){ vC = aColor; vec4 mv = modelViewMatrix * vec4(position, 1.0); gl_PointSize = aSize * uScale / max(0.1, -mv.z); gl_Position = projectionMatrix * mv; }',
      fragmentShader: 'varying vec4 vC; void main(){ vec2 d = gl_PointCoord - 0.5; float r = length(d) * 2.0; float a = 1.0 - smoothstep(0.0, 1.0, r); a *= a; gl_FragColor = vec4(vC.rgb, vC.a * a); }',
    });
    this.points = new THREE.Points(g, m); this.points.frustumCulled = false; this.points.renderOrder = additive ? 5 : 4;
    this.geometry = g;
  }

  emit(p) {
    if (this.count >= this.max) return;
    const i = this.count++;
    this.pos.set(p.pos, i * 3); this.vel.set(p.vel || [0, 0, 0], i * 3);
    this.life[i] = p.life; this.age[i] = 0; this.grav[i] = p.gravity ?? 0; this.drag[i] = p.drag ?? 0;
    this.s0[i] = p.size; this.s1[i] = p.sizeEnd ?? p.size; this.a0[i] = p.alpha ?? 1;
    this.base.set(p.color, i * 3);
    this.col.set([p.color[0], p.color[1], p.color[2], this.a0[i]], i * 4); this.size[i] = this.s0[i];
  }

  update(dt) {
    let i = 0;
    while (i < this.count) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.count;
        if (i !== j) this.move(j, i);
        continue;
      }
      const t = this.age[i] / this.life[i], k = i * 3, drag = Math.exp(-this.drag[i] * dt);
      this.vel[k] *= drag; this.vel[k + 1] = this.vel[k + 1] * drag + this.grav[i] * dt; this.vel[k + 2] *= drag;
      this.pos[k] += this.vel[k] * dt; this.pos[k + 1] += this.vel[k + 1] * dt; this.pos[k + 2] += this.vel[k + 2] * dt;
      this.size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      const fade = t < 0.12 ? t / 0.12 : 1 - (t - 0.12) / 0.88;
      this.col[i * 4] = this.base[k]; this.col[i * 4 + 1] = this.base[k + 1]; this.col[i * 4 + 2] = this.base[k + 2]; this.col[i * 4 + 3] = this.a0[i] * Math.max(0, fade);
      i++;
    }
    this.geometry.setDrawRange(0, this.count);
    for (const a of ['position', 'aColor', 'aSize']) this.geometry.attributes[a].needsUpdate = true;
  }

  move(from, to) {
    for (const [arr, n] of [[this.pos, 3], [this.vel, 3], [this.base, 3], [this.col, 4]]) for (let c = 0; c < n; c++) arr[to * n + c] = arr[from * n + c];
    for (const arr of [this.life, this.age, this.grav, this.drag, this.s0, this.s1, this.a0, this.size]) arr[to] = arr[from];
  }
}

const rnd = (a, b) => a + Math.random() * (b - a);

// 刃の軌跡（8.3a）。刀の枠（握りが原点・刃は +Y の 0.16〜0.88m。weapons.js）から帯の両縁を取り、毎コマ足す。
// 通常の半透明（加算にしない：白飛びと、敵の予兆の金色の光が埋もれるのを避ける）。深さは読むが書かない。毎コマの新規確保なし。
const BLADE = { root: 0.16, tip: 0.88 };
const TRAIL_VERT = 'attribute vec2 aUV; attribute vec4 aColor; varying vec2 vUV; varying vec4 vColor; void main(){ vUV = aUV; vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// 第2周：切先の道（外側の縁 v=1）に細く明るい芯を置き、内側へは素早く消す（芯の幅は帯の約16%）。内側には薄い光をわずかに残すだけ。
// 新しい所ほど濃く、寿命へ向かって薄れる（2.2乗）。第1周は幅の外半分が濃く、停止のコマで乳白の板・柱に見えた。
const TRAIL_FRAG = `varying vec2 vUV; varying vec4 vColor;
  void main(){
    float age = vUV.x, v = vUV.y;
    float along = pow(1.0 - age, 2.2) * smoothstep(0.0, 0.05, age + 0.015);
    float d = (1.0 - v) / 0.16;
    float across = exp(-d * d) + 0.08 * v * v;
    gl_FragColor = vec4(vColor.rgb, min(1.0, vColor.a * along * across));
  }`;
export class SlashTrails {
  constructor(scene) {
    this.pool = createTrailPool();
    this.out = { position: new Float32Array(TRAIL_VERTS * 3), uv: new Float32Array(TRAIL_VERTS * 2), color: new Float32Array(TRAIL_VERTS * 4), index: new Uint16Array(TRAIL_INDICES), vertices: 0, indices: 0 };
    const g = new THREE.BufferGeometry();
    this.attrs = [['position', this.out.position, 3], ['aUV', this.out.uv, 2], ['aColor', this.out.color, 4]].map(([name, array, size]) => {
      const a = new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a;
    });
    this.index = new THREE.BufferAttribute(this.out.index, 1).setUsage(THREE.DynamicDrawUsage); g.setIndex(this.index);
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({ vertexShader: TRAIL_VERT, fragmentShader: TRAIL_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 4; this.mesh.visible = false; this.mesh.name = 'slash-trails';
    this.geometry = g; this.shown = 0; this.vel = new Float64Array(3); this.edge = new Float64Array(6); this.ys = new Float64Array(2);
    scene.add(this.mesh);
  }
  // 時刻（ゲーム内の秒）を書く配列。毎コマ、サンプルを足す前に clock[0] へ書く（引数で渡すと数の箱が作られる）
  get clock() { return this.pool.clock; }
  // owner（技の1回ぶん）の刀の枠 holder から、帯の両縁（刃の inner と outer の点。幅は上限まで）の世界位置を足す
  sample(owner, style, holder) {
    holder.updateWorldMatrix(true, false);
    const e = holder.matrixWorld.elements, ys = trailEdges(style, BLADE.root, BLADE.tip, this.ys), y0 = ys[0], y1 = ys[1], p = this.edge;
    p[0] = e[4] * y0 + e[12]; p[1] = e[5] * y0 + e[13]; p[2] = e[6] * y0 + e[14]; p[3] = e[4] * y1 + e[12]; p[4] = e[5] * y1 + e[13]; p[5] = e[6] * y1 + e[14];
    addSample(this.pool, owner, style, p);
  }
  // 1コマのサンプルを足し終えたら呼ぶ：足さなかった帯を閉じ、寿命を過ぎた所を捨てて、頂点を作り直す。
  // 帯がある間だけGPUへ送る（全体で約40KB。範囲指定は three.js が毎回小さな物を作るので使わない）。camera は突きの光の線をカメラへ向ける。
  update(camera = null) {
    if (camera) { const c = camera.matrixWorld.elements; this.pool.camera[0] = c[12]; this.pool.camera[1] = c[13]; this.pool.camera[2] = c[14]; }
    closeUntouched(this.pool); pruneTrails(this.pool);
    const indices = buildRibbon(this.pool, this.out);
    if (indices > 0 || this.shown > 0) { for (let k = 0; k < this.attrs.length; k++) this.attrs[k].needsUpdate = true; this.index.needsUpdate = true; }
    this.geometry.setDrawRange(0, indices); this.mesh.visible = indices > 0; this.shown = indices;
  }
  clear() { clearTrails(this.pool); this.out.vertices = this.out.indices = 0; this.geometry.setDrawRange(0, 0); this.mesh.visible = false; this.shown = 0; }
  stats() { return { ...trailStats(this.pool), vertices: this.out.vertices, triangles: this.out.indices / 3 }; }
  // owner の刀の切先側の最新の速度（m/秒）。無ければ null（作業用の配列を返すので、すぐ使う）
  velocityOf(owner) { return owner && trailVelocity(this.pool, owner, this.vel) ? this.vel : null; }
}

// 線状の火花（8.3a 第3周）。筋の位置・寿命・頂点は spark-streaks.js（純粋）が決め、ここは1つのメッシュ（加算・描画呼出1つ）へ流すだけ。
// 筋がある間だけ描く。深さは読むが書かない。毎コマの新規確保なし。
const STREAK_VERT = 'attribute vec2 aUV; attribute vec4 aColor; varying vec2 vUV; varying vec4 vColor; void main(){ vUV = aUV; vColor = aColor; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }';
// 幅の向きは中央が濃く縁へ消える（筋の芯）。尾へは頂点の色で薄れる
const STREAK_FRAG = 'varying vec2 vUV; varying vec4 vColor; void main(){ float d = abs(vUV.y * 2.0 - 1.0); gl_FragColor = vec4(vColor.rgb, vColor.a * (1.0 - d * d)); }';
export class SparkStreaks {
  constructor(scene) {
    this.pool = createStreaks();
    this.out = { position: new Float32Array(STREAK_VERTS * 3), uv: new Float32Array(STREAK_VERTS * 2), color: new Float32Array(STREAK_VERTS * 4), vertices: 0, indices: 0 };
    const g = new THREE.BufferGeometry();
    this.attrs = [['position', this.out.position, 3], ['aUV', this.out.uv, 2], ['aColor', this.out.color, 4]].map(([name, array, size]) => {
      const a = new THREE.BufferAttribute(array, size).setUsage(THREE.DynamicDrawUsage); g.setAttribute(name, a); return a;
    });
    g.setIndex(new THREE.BufferAttribute(streakIndex(new Uint16Array(STREAK_INDICES)), 1));
    g.setDrawRange(0, 0);
    const m = new THREE.ShaderMaterial({ vertexShader: STREAK_VERT, fragmentShader: STREAK_FRAG, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
    this.mesh = new THREE.Mesh(g, m); this.mesh.frustumCulled = false; this.mesh.renderOrder = 5; this.mesh.visible = false; this.mesh.name = 'spark-streaks';
    this.geometry = g; this.shown = 0;
    scene.add(this.mesh);
  }
  emit(p, v, o) { return emitStreak(this.pool, p, v, o); }
  update(dt, camera) {
    const c = camera.matrixWorld.elements; this.pool.camera[0] = c[12]; this.pool.camera[1] = c[13]; this.pool.camera[2] = c[14];
    stepStreaks(this.pool, dt);
    const n = buildStreaks(this.pool, this.out);
    if (n > 0 || this.shown > 0) for (let k = 0; k < this.attrs.length; k++) this.attrs[k].needsUpdate = true;
    this.geometry.setDrawRange(0, n); this.mesh.visible = n > 0; this.shown = n;
  }
  clear() { clearStreaks(this.pool); this.geometry.setDrawRange(0, 0); this.mesh.visible = false; this.shown = 0; }
}

// 火花の色（線形の値）：芯は白に近い黄で1を超えてわずかににじむ。尾は橙。受けた（鈍い当たり）は芯が白、尾が黄
const SPARK = { head: [1.6, 1.35, 0.95], tail: [1.0, 0.42, 0.08], blockHead: [1.5, 1.45, 1.25], blockTail: [1.0, 0.8, 0.45] };

export class FX {
  constructor(scene) {
    this.add = new PointCloud(1800, true); this.norm = new PointCloud(1600, false);
    scene.add(this.add.points, this.norm.points);
    this.trails = new SlashTrails(scene);
    this.streaks = new SparkStreaks(scene);
  }

  // 刃が当たった所の火花と光。pos は刃が体へ入る点、dir は当たった向き（x,z）。travel は刃の進む向き（あれば。長さは問わない）：
  // 火花の8割を刃の進む向きの狭い円錐へ、残りを当たった向きへ散らす（8.3a 第2周）。第3周：丸い粒と大きな柔らかい光（白い煙の玉・蛍に見えた）をやめ、
  // 速度の向きへ伸びる短い筋（明るい芯→橙の尾）にした。光は小さく短い芯だけ。筋の数は前の粒の数より少ない（9〜14本、前は10〜18粒）。
  hit(pos, dir, { strong = false, blocked = false, travel = null } = {}) {
    const n = blocked ? 10 : strong ? 14 : 9, tl = travel ? Math.hypot(travel[0], travel[1], travel[2]) : 0, p = [pos.x, pos.y, pos.z];
    const tx = tl > 1e-6 ? travel[0] / tl : 0, ty = tl > 1e-6 ? travel[1] / tl : 0, tz = tl > 1e-6 ? travel[2] / tl : 0;
    const head = blocked ? SPARK.blockHead : SPARK.head, tail = blocked ? SPARK.blockTail : SPARK.tail;
    for (let i = 0; i < n; i++) {
      let vx, vy, vz;
      if (tl > 1e-6 && i < n * 0.8) {
        const sp = rnd(6, strong ? 13 : 11), rx = tx + rnd(-0.4, 0.4), ry = ty + rnd(-0.25, 0.4), rz = tz + rnd(-0.4, 0.4), rl = Math.hypot(rx, ry, rz) || 1;
        vx = rx / rl * sp; vy = ry / rl * sp + rnd(0.3, 1.2); vz = rz / rl * sp;
      } else {
        const a = Math.random() * Math.PI * 2, sp = rnd(4, blocked ? 9 : 8);
        vx = Math.cos(a) * sp + dir.x * 2; vy = rnd(0.8, 3.5); vz = Math.sin(a) * sp + dir.z * 2;
      }
      this.streaks.emit(p, [vx, vy, vz], { life: rnd(0.12, strong ? 0.28 : 0.22), width: strong ? 0.018 : 0.014, head, tail, gravity: -9, drag: 2.2 });
    }
    this.add.emit({ pos: p, vel: [0, 0, 0], life: 0.05, size: strong ? 0.2 : 0.14, sizeEnd: 0.04, color: blocked ? [1.0, 0.97, 0.88] : [1.0, 0.9, 0.62], alpha: 0.95 });
  }

  // 受け流し（弾き）の鋭い光。火花は、弾かれた刃が逸れる向き（入射の向き）へ偏って散る（8.3a）。
  // swing は相手の切先の速度（m/秒・あれば）、dir は相手から受け手への水平の向き（無ければ速度だけ・どちらも無ければ真上）。筋の数は前の粒と同じ22。
  // 第3周：粒を短い筋に、大きな光（0.75）を小さく短い芯（0.24）にした
  parry(pos, dir = null, swing = null) {
    const p = [pos.x, pos.y, pos.z];
    this.add.emit({ pos: p, vel: [0, 0, 0], life: 0.07, size: 0.24, sizeEnd: 0.06, color: [1, 0.97, 0.85], alpha: 0.95 });
    let dx = dir ? dir.x : 0, dy = 0, dz = dir ? dir.z : 0;
    const sl = swing ? Math.hypot(swing[0], swing[1], swing[2]) : 0;
    if (sl > 0.5) { dx = swing[0] / sl; dy = swing[1] / sl; dz = swing[2] / sl; }
    dy += 0.35; const dl = Math.hypot(dx, dy, dz) || 1; dx /= dl; dy /= dl; dz /= dl;
    for (let i = 0; i < 22; i++) {
      const sp = rnd(6, 12), spread = i < 16 ? 0.55 : 1.2;          // 4分の3は入射の向きの狭い円錐、残りは広く（放射の名残）
      const rx = dx + rnd(-1, 1) * spread, ry = dy + rnd(-1, 1) * spread * 0.7, rz = dz + rnd(-1, 1) * spread, rl = Math.hypot(rx, ry, rz) || 1;
      this.streaks.emit(p, [rx / rl * sp, ry / rl * sp + rnd(0, 1.5), rz / rl * sp], { life: rnd(0.14, 0.3), width: 0.013, head: SPARK.blockHead, tail: SPARK.blockTail, gravity: -6, drag: 2 });
    }
  }

  dust(pos, amount = 3, tint = [0.62, 0.52, 0.4]) {
    for (let i = 0; i < amount; i++) this.norm.emit({ pos: [pos.x + rnd(-0.15, 0.15), pos.y + 0.05, pos.z + rnd(-0.15, 0.15)], vel: [rnd(-0.4, 0.4), rnd(0.3, 0.9), rnd(-0.4, 0.4)], life: rnd(0.5, 0.9), size: 0.25, sizeEnd: 0.8, color: tint, alpha: 0.3, drag: 1.2 });
  }

  ember(pos) {
    this.add.emit({ pos: [pos.x + rnd(-0.25, 0.25), pos.y + 0.2, pos.z + rnd(-0.25, 0.25)], vel: [rnd(-0.25, 0.25), rnd(0.6, 1.6), rnd(-0.25, 0.25)], life: rnd(0.9, 2.2), size: rnd(0.04, 0.08), sizeEnd: 0.005, color: [1.0, rnd(0.4, 0.65), 0.1], alpha: 0.95, drag: 0.3 });
  }
  flame(pos) {
    this.add.emit({ pos: [pos.x + rnd(-0.18, 0.18), pos.y + 0.1, pos.z + rnd(-0.18, 0.18)], vel: [rnd(-0.12, 0.12), rnd(0.9, 1.6), rnd(-0.12, 0.12)], life: rnd(0.35, 0.7), size: rnd(0.32, 0.5), sizeEnd: 0.05, color: [1.0, rnd(0.45, 0.7), 0.12], alpha: 0.55, drag: 0.5 });
  }
  // 光の中を漂う塵。小さく淡く、長く生きる
  mote(pos) {
    this.add.emit({ pos: [pos.x, pos.y, pos.z], vel: [rnd(-0.12, 0.12), rnd(-0.03, 0.1), rnd(-0.12, 0.12)], life: rnd(4, 7), size: rnd(0.012, 0.024), sizeEnd: 0.01, color: [1.0, 0.92, 0.72], alpha: 0.5, drag: 0.4 });
  }
  smoke(pos) {
    this.norm.emit({ pos: [pos.x, pos.y, pos.z], vel: [rnd(0.1, 0.5), rnd(0.7, 1.2), rnd(-0.2, 0.2)], life: rnd(3, 5.5), size: 0.3, sizeEnd: 1.5, color: [0.18, 0.17, 0.18], alpha: 0.09, drag: 0.2 });          // 焚き火の煙は小さく暗く薄く（重なって光る玉に見えた）
  }
  // 煙突の煙：細く立ち上り、風下へなびきながら広がって消える。夕空に映えるよう淡い暖灰色で、少し濃い
  chimney(pos) {
    this.norm.emit({ pos: [pos.x, pos.y, pos.z], vel: [rnd(0.35, 0.7), rnd(0.9, 1.4), rnd(-0.1, 0.25)], life: rnd(7, 11), size: 0.7, sizeEnd: 6.5, color: [0.4, 0.37, 0.36], alpha: 0.36, drag: 0.12 });
  }

  update(dt, camera, viewportHeight) {
    const scale = viewportHeight * 0.5 / Math.tan(camera.fov * Math.PI / 360);
    this.add.uniforms.uScale.value = this.norm.uniforms.uScale.value = scale;
    this.add.update(dt); this.norm.update(dt); this.streaks.update(dt, camera);
  }
}
