// 二関節の幾何だけを扱う。配列の入力は変更せず、座標系は呼出側がそろえる。
const sub = (a, b) => a.map((v, i) => v - b[i]);
const dot = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const scale = (v, s) => v.map(x => x * s);
const length = v => Math.hypot(...v);
const unit = v => scale(v, 1 / length(v));
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const add = (a, b) => a.map((v, i) => v + b[i]);

// 最も平行でない軸を選ぶ。同じ入力には常に同じ代替方向を返す。
function perpendicular(axis) {
  const i = axis.map(Math.abs).indexOf(Math.min(...axis.map(Math.abs)));
  const basis = [0, 0, 0]; basis[i] = 1;
  return unit(sub(basis, scale(axis, dot(basis, axis))));
}

export function solveTwoBone({ root, mid, end, target, hint }) {
  const upper = sub(mid, root), lower = sub(end, mid), delta = sub(target, root);
  const a = length(upper), b = length(lower), distance = length(delta);
  const near = Math.abs(a - b), far = a + b;
  const reached = distance >= near && distance <= far;
  const reach = Math.max(near, Math.min(far, distance));
  const current = sub(end, root);
  const direction = distance > 0 ? unit(delta)
    : length(current) > 0 ? unit(current) : a > 0 ? unit(upper) : [1, 0, 0];
  const resultEnd = reached ? [...target] : add(root, scale(direction, reach));
  const towardHint = sub(hint, root);
  let bend = sub(towardHint, scale(direction, dot(towardHint, direction)));
  if (length(bend) <= 1e-12) bend = sub(upper, scale(direction, dot(upper, direction)));
  bend = length(bend) > 1e-12 ? unit(bend) : perpendicular(direction);
  // 等長の腕を根元まで畳む場合には余弦定理の分母が0になる。
  if (reach === 0) {
    const folded = length(towardHint) > 1e-12 ? unit(towardHint) : a > 0 ? unit(upper) : bend;
    return { mid: add(root, scale(folded, a)), end: resultEnd, reached, error: length(sub(target, resultEnd)) };
  }
  const along = (a * a - b * b + reach * reach) / (2 * reach);
  const height = Math.sqrt(Math.max(0, a * a - along * along));
  const resultMid = add(add(root, scale(direction, along)), scale(bend, height));
  return { mid: resultMid, end: resultEnd, reached, error: length(sub(target, resultEnd)) };
}

// 単位ベクトルの最短回転。零ベクトルには方向がないため恒等を返す。
export function shortestArc(from, to) {
  if (length(from) === 0 || length(to) === 0) return [0, 0, 0, 1];
  const a = unit(from), b = unit(to), axis = cross(a, b);
  const cosine = Math.max(-1, Math.min(1, dot(a, b)));
  if (cosine < 0 && length(axis) < 1e-12) return [...perpendicular(a), 0];
  const angle = Math.atan2(length(axis), cosine);
  if (length(axis) === 0) return [0, 0, 0, 1];
  const q = [...scale(unit(axis), Math.sin(angle / 2)), Math.cos(angle / 2)];
  return scale(q, 1 / length(q));
}
