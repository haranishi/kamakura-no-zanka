// Node専用。前測定の開始位置を引き継ぎ、guideの固定路・補正量を再現する（ブラウザの到達検査ではない）。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { measurementWorld } from './lib/measurement-world.mjs';
import { nearestFree } from '../dist/valley/collision.js';
import { buildBaseline } from '../dist/valley/guide.js';
export function guideWorld() {
  const data = measurementWorld();
  const cache = new Map();
  const nav = { bounds: data.world.bounds, walkable(x, z) {
    const key = `${x},${z}`;
    // 0.3mはguide契約の主人公半径。木・岩・建物・置物・柵・地形すべてを含む。
    if (!cache.has(key)) cache.set(key, nearestFree(data.col, data.terrain, x, z, 0.3, 0) !== null);
    return cache.get(key);
  } };
  return { ...data, nav };
}
export function measureGuideBaselines(data = guideWorld()) {
  const before = JSON.parse(fs.readFileSync(new URL('../reports/baseline/polish2-guide-starts-before.json', import.meta.url)));
  return { note: 'Node通行検査。開始点は前測定を継承。roadMは旧nav最短路、新lengthは必須点を順守。connectionは道路データの空白・庭・里内の接続。ブラウザ未検証。',
    rows: before.rows.filter(r => r.beat !== 'b7_result').map(r => {
      const baseline = buildBaseline(data.world, data.nav, { objectiveId: r.beat, plan: r.variant === 'default' ? 'front' : r.variant, from: r.start });
      if (!baseline) throw Error(`No guide baseline: ${r.beat}/${r.variant}`);
      return { beat: r.beat, variant: r.variant, start: r.start, roadM: r.roadM, length: baseline.length,
        differenceM: baseline.length - r.roadM, baseline };
    }) };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(JSON.stringify(measureGuideBaselines(), null, 2));
}
