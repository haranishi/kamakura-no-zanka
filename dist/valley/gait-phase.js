// gait-phase.js — 足の位相と歩調（design-locomotion-smooth §4・§11、M2a）。純粋（gait-table の行と渡された値だけで決める）。
// 位相は動作の全長を1とした割合（gait-table と同じ）。row は GAIT_TABLE[動作][体格]（period・stanceSpeed・pass・flat）。
// 使うのは主人公の新しい経路だけ（characters.js の locomote。?smooth=phase で M1 の経路へ戻る）。

// 止まりの歩調の倍率 kc の許容。1より大きいと着いた足が体より速く後ろへ動く（滑る）ので、着いた足がある間は狭く、
// 両足が浮いている（平らな区間の外）間は広くする。設計の歩調の許容は 0.8〜1.25（§4）。
export const STOP_KC = Object.freeze({ lo: 0.8, hi: 1.25, airHi: 2.4 });

const wrap = x => ((x % 1) + 1) % 1;
const inWin = (p, [s, e]) => s <= e ? p >= s && p <= e : p >= s || p <= e;

// 待ちから歩き出すときの、動作の始めの時刻（秒）。すれ違いの位相（両足が体の下で揃う）から始める。which は pass の番号
export function passStartTime(row, which = 0) {
  if (!row?.pass?.length) return null;
  return row.pass[Math.min(which, row.pass.length - 1)] * row.period;
}

// 位相 phase で、どちらかの足の裏が平ら（着いている）か
export function footDown(row, phase) {
  const f = row?.flat; if (!f) return true;
  return ['left', 'right'].some(s => (f[s] || []).some(w => inWin(phase, w)));
}

// 止まりの最後の一歩（§4）：残りの距離 left（m）を進み切る時に、位相がすれ違いの位相 targets のどれかに着くよう、歩調の倍率を返す。
// 距離どおりに回すと（kc＝1）位相は left÷（周期×接地の速さ）だけ進む。着くまでの位相の差を、それで割った比が kc。
// 先にある的のうち、kc が1に近い（対数で）ものを選ぶ。許容の外は端で止める（届かない分は、待ちへの混ぜに任せる）。
export function stopPace(row, phase, left, targets = row?.pass, lim = STOP_KC) {
  if (!row || !targets?.length || !(left > 1e-4)) return 1;
  const natural = left / (row.period * row.stanceSpeed), hi = footDown(row, wrap(phase)) ? lim.hi : lim.airHi;
  let best = 1, score = Infinity;
  for (const t of targets) for (const extra of [0, 1]) {
    const k = (wrap(t - phase) + extra) / natural;
    const c = Math.max(lim.lo, Math.min(hi, k)), s = Math.abs(Math.log(Math.max(1e-6, k)));
    if (s < score) { score = s; best = c; }
  }
  return best;
}
