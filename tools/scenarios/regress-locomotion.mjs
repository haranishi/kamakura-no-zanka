// 回帰：主人公の走りの足の滑りと、カメラの止まり方（2026-11-03・足運びとカメラの追従の改修）。測り方は measure-locomotion.mjs。
//   1 走り（5m/秒）の走り始め・定速の直進で、着いている足の滑りが8cm以下（design-characters.md の許容）。30・60・144コマ/秒のどれでも。
//     改修前の main は走り始めが15〜17cm（歩き→小走り→走りを0.3秒で先頭から替えていたため）で落ちる。
//   2 停止：キーを離して体が止まったあと、移動の動作が進む量が1周の2%以下（改修前は約3割進み、止まった体で足だけが後ろへ流れた）。
//   3 カメラ：走りの停止で、カメラの位置の加速度が45m/秒²以下（改修前は1次の遅れで約70m/秒²。臨界減衰のばねで理論上の最大は約33）。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-locomotion.mjs --strict（KZ_OUT=<json> で記録）
import fs from 'node:fs';
import { prepare, measureAll } from './measure-locomotion.mjs';

const SLIP_CM = 8, STOP_CYCLE = 0.02, CAM_STOP = 45;

export default async function (ctx) {
  await prepare(ctx);
  const res = await measureAll(ctx.v, { rates: [60, 30, 144] });
  const bad = [], rows = [];
  for (const hz of [60, 30, 144]) {
    const r = res[`run@${hz}`];
    for (const tag of ['run_start', 'run_steady']) {
      const s = r.slip[tag]; rows.push(`run@${hz} ${tag} 滑り最大 ${s.max}cm（${s.n}歩）`);
      if (!s.n) bad.push(`run@${hz} ${tag}: 足が着いた区間が無い（測れていない）`);
      if (s.max > SLIP_CM) bad.push(`run@${hz} ${tag}: 滑り ${s.max}cm > ${SLIP_CM}cm`);
    }
    const adv = r.adv.run_stop || 0; rows.push(`run@${hz} 停止後に進んだ足の周期 ${adv}`);
    if (adv > STOP_CYCLE) bad.push(`run@${hz} run_stop: 止まった体で足の動作が ${adv} 周進んだ > ${STOP_CYCLE}`);
    const cam = r.camAcc.run_stop; rows.push(`run@${hz} 停止のカメラの加速度 ${cam}m/秒²`);
    if (!(cam <= CAM_STOP)) bad.push(`run@${hz} run_stop: カメラの加速度 ${cam} > ${CAM_STOP}`);
  }
  for (const row of rows) ctx.log(row);
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ bad, res: Object.fromEntries(Object.entries(res).map(([k, r]) => [k, { slip: r.slip, adv: r.adv, camAcc: r.camAcc }])) }, null, 1));
  if (bad.length) throw new Error('locomotion regress failed:\n' + bad.join('\n'));
  ctx.log('regress-locomotion: OK');
}
