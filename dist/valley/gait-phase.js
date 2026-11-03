// gait-phase.js — 足の位相（design-locomotion-smooth §4・§11、M2a）。純粋（gait-table の行と渡された値だけで決める）。
// 止まりの最後の一歩の歩調の調整（stopPace）は試して捨てた（§11）。
// 位相は動作の全長を1とした割合（gait-table と同じ）。row は GAIT_TABLE[動作][体格]（period・stanceSpeed・pass・flat）。
// 使うのは主人公の新しい経路だけ（characters.js の locomote。?smooth=phase で M1 の経路へ戻る）。

// 待ちから歩き出すときの、動作の始めの時刻（秒）。すれ違いの位相（両足が体の下で揃う）から始める。which は pass の番号
export function passStartTime(row, which = 0) {
  if (!row?.pass?.length) return null;
  return row.pass[Math.min(which, row.pass.length - 1)] * row.period;
}
