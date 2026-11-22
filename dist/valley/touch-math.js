// touch-math.js — タッチ操作・品質初期値の純粋計算（data/rule層）。Three.js・DOM・乱数・時計に触れない。
const freeze = obj => {
  if (obj && typeof obj === 'object') {
    for (const v of Object.values(obj)) freeze(v);
    Object.freeze(obj);
  }
  return obj;
};

export const TOUCH_CFG = freeze({
  stick: {
    radius: 52,
    minRadius: 38,
    refHeight: 420,
    deadZone: 0.18,
    runEnter: 1.38,
    runExit: 1.12,
    knobMax: 1.5,
    edgeMargin: 12,
  },
  look: {
    tapSlop: 6,
    gain: 1.35,
  },
});

/** URLの ?touch=1|0 を最優先し、未指定時はポインタの粗さから 'on' | 'off' | 'auto' を返す。 */
export function detectTouchMode(search = '', coarseMatches = false) {
  const param = new URLSearchParams(search || '').get('touch');
  if (param === '1') return 'on';
  if (param === '0') return 'off';
  return coarseMatches ? 'on' : 'auto';
}

/** 初期の描画品質。明示指定（?q=・保存値）があれば従い、無ければタッチ端末は 'light'、PCは 'standard'。 */
export function selectInitialQuality({ queryQuality = '', savedQuality = '', touchMode = 'auto' } = {}) {
  if (queryQuality === 'light' || queryQuality === 'standard') return queryQuality;
  if (savedQuality === 'light' || savedQuality === 'standard') return savedQuality;
  return touchMode === 'on' ? 'light' : 'standard';
}

/** 画面の高さに応じたスティック半径 R（CSS px）。低い横向き画面では比例縮小し minRadius で下限を保つ。 */
export function stickRadius(viewHeight, cfg = TOUCH_CFG.stick) {
  const h = Number.isFinite(viewHeight) && viewHeight > 0 ? viewHeight : cfg.refHeight;
  const r = h < cfg.refHeight ? (cfg.radius * h) / cfg.refHeight : cfg.radius;
  return Math.max(cfg.minRadius, r);
}

/** 触れた原点を画面の縁から (R + edgeMargin) 以上内側へ収める。 */
export function clampOrigin(x, y, R, width, height, cfg = TOUCH_CFG.stick) {
  const m = R + cfg.edgeMargin;
  const cx = width > 2 * m ? Math.min(width - m, Math.max(m, x)) : width / 2;
  const cy = height > 2 * m ? Math.min(height - m, Math.max(m, y)) : height / 2;
  return { x: cx, y: cy };
}

/** 原点からのドラッグ差（dx: 右が正、dy: 下が正）から移動量と走りフラグ（ヒステリシス付き）を計算する。 */
export function stickFromDrag(dx, dy, R, wasRunning, cfg = TOUCH_CFG.stick) {
  const d = Math.hypot(dx, dy);
  const kmax = cfg.knobMax * R;
  const k = d > kmax && d > 0 ? kmax / d : 1;
  const knobX = dx * k;
  const knobY = dy * k;
  const dead = cfg.deadZone * R;
  if (d <= dead || d < 1e-9) {
    return { right: 0, forward: 0, mag: 0, run: false, knobX, knobY };
  }
  const mag = Math.min(1, (d - dead) / Math.max(1e-9, R - dead));
  const run = wasRunning ? d >= cfg.runExit * R : d >= cfg.runEnter * R;
  return { right: (dx / d) * mag, forward: (-dy / d) * mag, mag, run, knobX, knobY };
}

/** 視点ドラッグ：tapSlop 未満の微動は無視し、越えてから前位置との差分を返す。 */
export class LookDrag {
  constructor(slop = TOUCH_CFG.look.tapSlop) {
    this.slop = slop;
    this.sx = 0;
    this.sy = 0;
    this.lx = 0;
    this.ly = 0;
    this.live = false;
  }

  start(x, y) {
    this.sx = this.lx = x;
    this.sy = this.ly = y;
    this.live = false;
  }

  move(x, y) {
    if (!this.live) {
      if (Math.hypot(x - this.sx, y - this.sy) < this.slop) return { dx: 0, dy: 0 };
      this.live = true;
    }
    const out = { dx: x - this.lx, dy: y - this.ly };
    this.lx = x;
    this.ly = y;
    return out;
  }
}

/** 画面のプロンプト文から、タッチ用「調べる／とどめ／闇討ち」ボタンと反撃強調の表示仕様を返す。 */
export function touchPromptSpec(promptText = '') {
  const text = String(promptText || '').trim();
  if (text === 'とどめを刺す') return { label: 'とどめ', ready: true, counter: false, urgent: true };
  if (text === '背後から闇討ち') return { label: '闇討ち', ready: true, counter: false, urgent: true };
  if (text === '縛めを解く') return { label: '解く', ready: true, counter: false, urgent: true };
  if (text === '弾いた。いま反撃') return { label: '調べる', ready: false, counter: true, urgent: false };
  if (text) return { label: '調べる', ready: true, counter: false, urgent: false };
  return { label: '調べる', ready: false, counter: false, urgent: false };
}
