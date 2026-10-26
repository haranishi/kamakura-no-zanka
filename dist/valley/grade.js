// grade.js — 材質の色をそろえる小さな補正（view層）。モデルごとの色の癖（青い石・真っ白な石・蛍光の苔）を、
// 夕景の中で他の地面や木と並ぶ色へ寄せる。モデルの絵は書き換えず、描画のときに色だけを調整する。
import * as THREE from 'three';
import { mulberry32 } from './scatter.js';

const patched = new WeakSet();

// 材質を複製したら、もう一度呼ぶ（複製は onBeforeCompile を引き継がない）。
export function patchGrade(material, { whiteMax = 0.34, blueFix = 0.85, mossFix = 0.5, satMax = 1 } = {}) {
  if (!material || patched.has(material)) return material;
  patched.add(material);
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        vec3 gc = diffuseColor.rgb;
        float gl = dot(gc, vec3(0.2126, 0.7152, 0.0722));
        float gmx = max(gc.r, max(gc.g, gc.b)), gmn = min(gc.r, min(gc.g, gc.b));
        float gsat = (gmx - gmn) / max(gmx, 1e-3);
        float blue = clamp((gc.b - max(gc.r, gc.g) * 1.04) * 6.0, 0.0, 1.0);
        gc = mix(gc, vec3(gl) * vec3(1.08, 1.0, 0.9), blue * ${blueFix.toFixed(3)});
        float white = smoothstep(0.22, 0.45, gl) * (1.0 - smoothstep(0.10, 0.28, gsat));
        gc *= mix(1.0, min(1.0, ${whiteMax.toFixed(3)} / max(gl, 1e-3)), white);
        float moss = smoothstep(1.35, 2.2, gc.g / max(max(gc.r, gc.b), 1e-3)) * smoothstep(0.06, 0.22, gl);
        gc = mix(gc, vec3(gl) * vec3(0.92, 1.0, 0.72), moss * ${mossFix.toFixed(3)});
        gc = mix(vec3(gl), gc, min(1.0, ${satMax.toFixed(3)} / max(gsat, 1e-3)));          // 彩度の上限（石の黄色い地衣など）
        diffuseColor.rgb = gc;
      }`);
  };
  material.customProgramCacheKey = () => `grade-${whiteMax}-${blueFix}-${mossFix}-${satMax}`;
  material.needsUpdate = true;
  return material;
}

export function gradeModel(root, opts) {
  root.traverse(o => { if (o.isMesh) for (const m of Array.isArray(o.material) ? o.material : [o.material]) patchGrade(m, opts); });
}

// 人物の暗い布（藍・黒）は、逆光や影の中で形が読めなくなる。暗い部分だけ明るくする（ガンマを持ち上げる。明るい部分はほぼ変わらない）。
const lifted = new WeakSet();
export function patchLift(material, gamma = 0.8) {
  if (!material || lifted.has(material)) return material;
  lifted.add(material);
  material.onBeforeCompile = shader => {
    shader.fragmentShader = shader.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(${gamma.toFixed(3)}));`);
  };
  material.customProgramCacheKey = () => `lift-${gamma}`;
  material.needsUpdate = true;
  return material;
}

// 草葺き屋根の絵：元の絵はピントの外れた茶色の斑で、屋根が豹柄に見えた。わらの束の筋（太め）と細い茎を縦に重ね、段（葺きの層）の線を薄く入れる。
// 1枚が屋根の約1mにあたる（モデルのUVが1m≒1周期）。周期で継ぎ目が出ないよう、端をまたぐ筋は反対側にも描く。
export function makeStrawTexture(size = 1024, seed = 4417) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), rnd = mulberry32(seed);
  g.fillStyle = '#5a4c33'; g.fillRect(0, 0, size, size);
  const strand = (x, y, len, w, col, a) => {
    g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = w; g.lineCap = 'round';
    const dx = (rnd() - 0.5) * len * 0.08;
    for (const ox of [-size, 0, size]) for (const oy of [-size, 0, size]) {
      const x0 = x + ox, y0 = y + oy;
      if (x0 < -50 || x0 > size + 50 || y0 < -len || y0 > size + len) continue;
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x0 + dx, y0 + len); g.stroke();
    }
  };
  const bundle = ['#7a6842', '#5d4e32', '#8a7650', '#504228', '#907d56'], fine = ['#9c8a5c', '#7e6c44', '#a89466', '#5e4e30', '#8c7a52'];
  for (let i = 0; i < 520; i++) strand(rnd() * size, rnd() * size, 180 + rnd() * 420, 9 + rnd() * 16, bundle[(rnd() * bundle.length) | 0], 0.22 + rnd() * 0.3);
  for (let i = 0; i < 7000; i++) strand(rnd() * size, rnd() * size, 70 + rnd() * 200, 1.4 + rnd() * 2.2, fine[(rnd() * fine.length) | 0], 0.28 + rnd() * 0.4);
  for (let i = 0; i < 1400; i++) strand(rnd() * size, rnd() * size, 40 + rnd() * 120, 1.2 + rnd() * 1.6, '#3c3020', 0.25 + rnd() * 0.3);        // 束のあいだの暗い隙間
  g.globalAlpha = 1;
  for (let y = 0; y < size; y += 170) {                                                                                                     // 葺きの段：薄い暗い帯と、その下の明るい縁
    g.fillStyle = 'rgba(40,30,18,0.20)'; g.fillRect(0, y + rnd() * 6, size, 7 + rnd() * 5);
    g.fillStyle = 'rgba(190,165,105,0.10)'; g.fillRect(0, y + 14 + rnd() * 5, size, 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
