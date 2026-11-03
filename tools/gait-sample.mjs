// 標本化：周期の移動動作（歩き・小走り・走り）を、7体の人物GLBごとに Node だけで再生し、足運びの表 dist/valley/gait-table.js を作る。
// ブラウザ不要。GLB は tools/lib/glb.mjs で読み、骨の親子と動作は同梱の three（dist/vendor）で組んで実行時と同じ補間で動かす。
// 測るもの（模型の座標。前は +Z、体の水平移動は焼き込みで消えている）:
//   period      動作の全長（秒。Casual_Walk のように複数の歩みを含むものもある）。strides＝その間の左足の着地の数
//   stanceSpeed 接地中の足首が後ろへ動く速さの中央値（m/秒・等倍）。「足裏が平ら」＝足首とつま先の両方が周期内の最低の高さ＋FLATの内、の区間だけ
//   leftLand    左足が平らに着いた最初の位相（0〜1）。clips.json の contacts とは別に骨から測る
//   pass        左右の足首の前後が入れ替わる（すれ違う）位相の一覧
//   hipsY       骨盤（Hips）の高さの最小・最大（m）
//   flat        v2：左右の足ごとの「足裏が平ら」な区間の一覧 {left:[[始,終],…], right:[…]}（位相。始＞終は周期をまたぐ）。
//               計測（smooth-journey）の接地をこの区間で決める。clips.json の contacts は両足支持の縁まで含み、屈み歩きで上がり始めの足を数えたため
// 使い方: node tools/gait-sample.mjs            → dist/valley/gait-table.js を書き直す
//         node tools/gait-sample.mjs --check    → 書かずに作り直し、ファイルと一致するか確かめる（不一致なら終了コード1）
//         node tools/gait-sample.mjs --print    → 表と STANCE_SPEED の照合を表示するだけ
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseGlb, decodedAccessor } from './lib/glb.mjs';
import * as THREE from '../dist/vendor/three.module.min.js';

export const VERSION = 2;
export const CLIPS = ['CMU_Jog', 'CMU_Run', 'Samurai_Walk', 'Walk_Fight_Forward', 'Casual_Walk', 'Cautious_Crouch_Walk_Forward'];
export const CHARACTERS = ['hero', 'archer', 'soldier', 'officer', 'villager_m', 'villager_f', 'child'];
const SAMPLES_PER_SECOND = 480;   // 30コマ/秒の焼き込みを16倍で読む（キーの間の補間も拾う）
const FLAT = 0.02;                // 足裏が平らと見なす高さの余裕（m）。足首・つま先それぞれの周期内の最低から
const root = fileURLToPath(new URL('../', import.meta.url));
const OUT = path.join(root, 'dist/valley/gait-table.js');
const r4 = x => Math.round(x * 1e4) / 1e4;

// GLB の骨の木と動作を three の物で組む（実行時の GLTFLoader と同じく、骨は名前で動作の track に結ぶ）
function loadRig(file) {
  const doc = parseGlb(fs.readFileSync(file)), j = doc.json, nodes = j.nodes.map(n => {
    const o = new THREE.Object3D(); o.name = n.name || '';
    if (n.translation) o.position.fromArray(n.translation);
    if (n.rotation) o.quaternion.fromArray(n.rotation);
    if (n.scale) o.scale.fromArray(n.scale);
    return o;
  });
  j.nodes.forEach((n, i) => (n.children || []).forEach(c => nodes[i].add(nodes[c])));
  const scene = new THREE.Object3D(); for (const i of j.scenes[j.scene ?? 0].nodes) scene.add(nodes[i]);
  const clips = new Map();
  for (const a of j.animations || []) {
    const tracks = [];
    for (const ch of a.channels) {
      const s = a.samplers[ch.sampler], name = nodes[ch.target.node].name;
      const times = Array.from(decodedAccessor(doc, s.input).array), values = Array.from(decodedAccessor(doc, s.output).array);
      const interp = s.interpolation === 'STEP' ? THREE.InterpolateDiscrete : THREE.InterpolateLinear;
      const T = ch.target.path === 'rotation' ? THREE.QuaternionKeyframeTrack : THREE.VectorKeyframeTrack;
      const prop = { translation: 'position', rotation: 'quaternion', scale: 'scale' }[ch.target.path];
      if (prop) tracks.push(new T(`${name}.${prop}`, times, values, interp));
    }
    clips.set(a.name, new THREE.AnimationClip(a.name, -1, tracks));
  }
  return { scene, clips, sha256: createHash('sha256').update(fs.readFileSync(file)).digest('hex') };
}

// 位相 p の区間 [s,e]（s>e は周期をまたぐ）
const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : NaN; };

export function sampleClip(rig, name, seconds) {
  const mixer = new THREE.AnimationMixer(rig.scene), action = mixer.clipAction(rig.clips.get(name));
  action.play();
  const N = Math.round(seconds * SAMPLES_PER_SECOND), V = new THREE.Vector3(), bone = n => rig.scene.getObjectByName(n);
  const B = { lf: bone('LeftFoot'), rf: bone('RightFoot'), lt: bone('LeftToeBase'), rt: bone('RightToeBase'), hips: bone('Hips') };
  const s = { lf: [], rf: [], lt: [], rt: [], hips: [] };
  for (let i = 0; i < N; i++) {
    action.time = seconds * i / N; mixer.update(0); rig.scene.updateMatrixWorld(true);
    for (const k of Object.keys(B)) { B[k].getWorldPosition(V); s[k].push([V.x, V.y, V.z]); }
  }
  mixer.stopAllAction(); mixer.uncacheRoot(rig.scene);
  return { N, s };
}

export function gaitOf({ N, s }, seconds) {
  const dt = seconds / N, at = (arr, i) => arr[((i % N) + N) % N];
  const minY = k => Math.min(...s[k].map(p => p[1]));
  const flat = side => { const f = side === 'left' ? 'lf' : 'rf', t = side === 'left' ? 'lt' : 'rt', yf = minY(f) + FLAT, yt = minY(t) + FLAT; return s[f].map((p, i) => p[1] <= yf && s[t][i][1] <= yt); };
  const fl = { left: flat('left'), right: flat('right') }, speeds = [];
  for (const side of ['left', 'right']) {
    const f = side === 'left' ? 'lf' : 'rf';
    for (let i = 0; i < N; i++) if (fl[side][i] && fl[side][(i + 1) % N] && fl[side][(i + N - 1) % N]) speeds.push(-(at(s[f], i + 1)[2] - at(s[f], i - 1)[2]) / (2 * dt));
  }
  // 左足の平らな着地の始まり（平らでない→平ら）。最初のものを位相0の候補にする
  const lands = []; for (let i = 0; i < N; i++) if (fl.left[i] && !fl.left[(i + N - 1) % N]) lands.push(i / N);
  const pass = []; for (let i = 0; i < N; i++) { const d0 = at(s.lf, i)[2] - at(s.rf, i)[2], d1 = at(s.lf, i + 1)[2] - at(s.rf, i + 1)[2]; if (d0 * d1 < 0 || (d0 === 0 && d1 !== 0)) pass.push(r4((i + Math.abs(d0) / (Math.abs(d0) + Math.abs(d1))) / N)); }
  const hy = s.hips.map(p => p[1]);
  // 平らな区間を [始,終] の位相に（周期の継ぎ目をまたぐ区間は1つにつなぐ。全周が平らなら [0,1]）
  const windows = arr => {
    if (arr.every(Boolean)) return [[0, 1]];
    const out = []; let s0 = arr.findIndex((v, i) => !v && arr[(i + 1) % N]);
    for (let k = 1; k <= N; k++) { const i = (s0 + k) % N; if (arr[i] && !arr[(i + N - 1) % N]) { let e = i; while (arr[(e + 1) % N]) e = (e + 1) % N; out.push([r4(i / N), r4((e + 1) / N % 1 || 1)]); } }
    return out.sort((a, b) => a[0] - b[0]);
  };
  return { period: r4(seconds), strides: lands.length, stanceSpeed: r4(median(speeds)), leftLand: lands.length ? r4(lands[0]) : null, pass, hipsY: [r4(Math.min(...hy)), r4(Math.max(...hy))], flat: { left: windows(fl.left), right: windows(fl.right) } };
}

export function buildTable() {
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'dist/assets/characters/clips.json'), 'utf8'));
  const table = {}, glb = {};
  for (const who of CHARACTERS) {
    const rig = loadRig(path.join(root, 'dist/assets/characters', who + '.glb')); glb[who] = rig.sha256;
    for (const name of CLIPS) {
      if (!rig.clips.has(name)) continue;                      // 収録されていない体格もある（屈み歩きは侍大将に無い、など）
      (table[name] ||= {})[who] = gaitOf(sampleClip(rig, name, meta.clips[name].seconds), meta.clips[name].seconds);
    }
  }
  const clipsSha = createHash('sha256').update(fs.readFileSync(path.join(root, 'dist/assets/characters/clips.json'))).digest('hex');
  return { source: { tool: 'tools/gait-sample.mjs', version: VERSION, samplesPerSecond: SAMPLES_PER_SECOND, flat: FLAT, clipsJson: clipsSha, glb }, table };
}

export function render({ source, table }) {
  return `// 生成物：${source.tool} v${source.version} が dist/assets/characters/*.glb と clips.json から作った足運びの表。手で書き換えない（作り直すには node ${source.tool}）。
// 純粋なデータ。前は模型の +Z、長さは m、時間は秒、位相は動作の全長を1とした割合。各値の意味は ${source.tool} の冒頭。
// 出所の SHA256 は tools/check-valley.mjs が同梱のファイルと照合する（GLB を差し替えたら作り直す）。
export const GAIT_SOURCE = Object.freeze(${JSON.stringify(source)});
export const GAIT_TABLE = Object.freeze(${JSON.stringify(table)});
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const built = buildTable(), text = render(built);
  if (process.argv.includes('--print') || process.argv.includes('--check')) {
    const { STANCE_SPEED } = await import('../dist/valley/anim-data.js');
    for (const [name, by] of Object.entries(built.table)) {
      const h = by.hero, ref = STANCE_SPEED[name];
      console.log(name.padEnd(30), 'hero', JSON.stringify(h), ref != null ? `STANCE_SPEED ${ref} 差 ${((h.stanceSpeed / ref - 1) * 100).toFixed(1)}%` : '');
      console.log(' '.repeat(31) + Object.entries(by).map(([w, g]) => `${w} ${g.stanceSpeed}`).join('  '));
    }
  }
  if (process.argv.includes('--check')) {
    const same = fs.existsSync(OUT) && fs.readFileSync(OUT, 'utf8') === text;
    console.log(same ? 'gait-table.js is up to date' : 'gait-table.js differs from a fresh sample'); if (!same) process.exitCode = 1;
  } else if (!process.argv.includes('--print')) { fs.writeFileSync(OUT, text); console.log('wrote', path.relative(root, OUT), text.length, 'bytes'); }
}
