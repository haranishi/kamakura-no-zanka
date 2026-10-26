// grade.js — 材質の色をそろえる小さな補正（view層）。モデルごとの色の癖（青い石・真っ白な石・蛍光の苔）を、
// 夕景の中で他の地面や木と並ぶ色へ寄せる。モデルの絵は書き換えず、描画のときに色だけを調整する。
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
