// 抜刀・納刀の進み具合だけを持つ。実時間は呼出側から dt として受け取る。
import { S_CLEAR, S_OUT, SAYA_BACK_MAX, TWIST_MAX_DEG } from './sword-path.js';

// reachEnd＝握りへ届く（ここまでに上体を28度ひねる）／pullEnd＝刃が鞘を抜け切る。鞘は、刃を引き始めてから後ろへ引き（sayaBackFrom）、
// 刃が軸から十分離れてから帯へ戻す（sayaReturnFrom）。先に鞘を引くと、刀が一度後ろへ戻って見える。
// 速い抜刀（snapSeconds）は、引く区間（u<pullEnd）に snapPullSeconds、振って構えへ移す区間（u≧pullEnd）に snapSettleSeconds。
// 全体を同じ速さで縮めると、刃を鞘の軸から構えへ振る半回転が2〜3コマに詰まり、刀が飛んで見える。
export const LAYER = Object.freeze({ drawSeconds: 0.62, sheatheSeconds: 0.70, snapSeconds: 0.15, snapPullSeconds: 0.07, snapSettleSeconds: 0.07, reachEnd: 0.30, pullEnd: 0.68, sayaBackFrom: 0.40, sayaReturnFrom: 0.74 });
const clamp = u => Number.isNaN(u) ? 0 : Math.max(0, Math.min(1, u));
function smoothstep(a, b, u) {
  const t = clamp((u - a) / (b - a));
  return t * t * (3 - 2 * t);
}

export function poseAt(u) {
  u = clamp(u);
  const { reachEnd, pullEnd, sayaBackFrom, sayaReturnFrom } = LAYER;
  const release = 1 - smoothstep(pullEnd, 1, u);
  const ik = smoothstep(0, reachEnd, u) * release;
  // 上体のひねりは、握りへ届くまでに8割（右肩が腰の柄へ届かないと握れない）。引き切るまでに残りの2割。
  const twist = 0.8 * smoothstep(0, reachEnd, u) + 0.2 * smoothstep(reachEnd, pullEnd, u);
  return {
    s: S_OUT * smoothstep(reachEnd, pullEnd, u),
    sayaBack: SAYA_BACK_MAX * smoothstep(sayaBackFrom, pullEnd, u) * (1 - smoothstep(sayaReturnFrom, 1, u)),
    twistDeg: TWIST_MAX_DEG * twist * release,
    ikRight: ik,
    // 左手は、鞘が帯へ戻るまで添えたまま（先に離すと、鞘が体から浮いて見える）
    ikLeft: smoothstep(0, reachEnd, u) * (1 - smoothstep(sayaReturnFrom, 1, u)),
    handBlend: 1 - release,
    // 表示の二値は端点で切り替える。連続なのは数値の姿勢成分。
    swordShown: u > 0,
    hipHiltShown: u === 0,
  };
}

// 中間の u だけで生成した場合は抜刀の再開とする（初期の速さは通常）。
export function createSwordLayer({ u = 0 } = {}) {
  u = clamp(u);
  let direction = u > 0 && u < 1 ? 1 : 0;
  let speed = 1 / LAYER.drawSeconds, fastMode = false;
  // いまの進む速さ（u/秒）。速い抜刀は、引く区間と振る区間をそれぞれ決まった時間で通る（どちらも落ち着いた速さの2倍以上）
  const rate = () => fastMode ? (u < LAYER.pullEnd ? LAYER.pullEnd / LAYER.snapPullSeconds : (1 - LAYER.pullEnd) / LAYER.snapSettleSeconds) : speed;
  const mode = () => direction > 0 ? 'drawing' : direction < 0 ? 'sheathing' : u === 0 ? 'sheathed' : 'drawn';
  return {
    requestDraw({ fast = false } = {}) {
      if (u === 1 && direction >= 0) return false;   // 納刀を始めた直後（u はまだ1）は、取り消せる
      if (direction > 0 && !fast) return false;
      const reversing = direction < 0;
      if (direction === 0 || reversing) speed = 1 / LAYER.drawSeconds;
      if (fast || reversing) fastMode = true; else if (direction === 0) fastMode = false;
      direction = 1;
      return true;
    },
    requestSheathe() {
      if (u !== 1 || direction !== 0) return false;
      direction = -1; speed = 1 / LAYER.sheatheSeconds; fastMode = false;
      return true;
    },
    tick(dt) {
      dt = dt >= 0 ? dt : 0;
      const previous = u, events = [];
      if (direction !== 0 && dt > 0) {
        const step = rate() * dt, remaining = direction > 0 ? 1 - u : u;
        // 60Hzで0.10秒を6回に分けた丸め誤差も端点へ収める。
        u = step >= remaining - 8 * Number.EPSILON ? (direction > 0 ? 1 : 0) : clamp(u + direction * step);
        const before = poseAt(previous).s, after = poseAt(u).s;
        if (direction > 0 && before <= S_CLEAR && after > S_CLEAR) events.push('clear');
        if (direction < 0 && before > 0.03 && after <= 0.03) events.push('seat');
        if (u === 1) { events.push('drawn'); direction = 0; fastMode = false; }
        else if (u === 0) { events.push('sheathed'); direction = 0; fastMode = false; }
      }
      return { mode: mode(), u, pose: poseAt(u), events };
    },
    snapshot() { return { mode: mode(), u }; },
    reset(nextMode) {
      if (nextMode !== 'sheathed' && nextMode !== 'drawn') throw new RangeError('reset: sheathed または drawn が必要');
      u = nextMode === 'drawn' ? 1 : 0;
      direction = 0; speed = 1 / LAYER.drawSeconds; fastMode = false;
    },
  };
}
