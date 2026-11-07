// No private sample values are printed or written into the repository.
import { readPrivateData, verifySamples, verifySeams } from './lib/kamakura-validation.mjs';
import { createKamakuraTerrain } from '../dist/valley/kamakura-terrain.js';
if (!process.env.KZ_WORLD_DIR) {
  console.log('SKIP: KZ_WORLD_DIR が未設定のため、鎌倉の実データ検算を省略します。');
} else {
  try {
    const { data, checks } = await readPrivateData(process.env.KZ_WORLD_DIR);
    verifySamples(data, checks);
    const t = createKamakuraTerrain(data);
    verifySeams(t, Math.floor((t.w / 2) / 64) * 64, Math.floor((t.h / 2) / 64) * 64);
    if (!t.walkable(data.meta.spawn.x, -data.meta.spawn.y)) throw new Error('spawn');
    console.log('PASS: 標本の高さ・北向き・案A・出発点・全LOD組の縁（高さ／法線）。データ値は出力しません。');
  } catch {
    console.error('FAIL: 鎌倉データの読み取りまたは検算に失敗しました。パス・形式・標本・縫合を確認してください（データ値は非表示）。');
    process.exitCode = 1;
  }
}
