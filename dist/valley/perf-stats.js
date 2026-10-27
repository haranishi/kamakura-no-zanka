// 性能の純粋集計。閾値と最近順位法は design-validation.md「性能（R14.8）」の仕様の値。
const LIMITS = { standard: 20, light: 33.3 };
const valid = samples => Array.isArray(samples) && samples.length > 0 && Array.from(samples).every(Number.isFinite);

export function percentile(samples, q) {
  if (!valid(samples) || !Number.isFinite(q) || q < 0 || q > 1) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)];
}

export function summarize(samples) {
  const n = samples.length;
  if (!valid(samples)) return { n, mean: null, min: null, p50: null, p95: null, p99: null, max: null };
  // 各項を先に割り、有限標本の和のオーバーフローを避ける。
  return { n, mean: samples.reduce((sum, v) => sum + v / n, 0), min: percentile(samples, 0),
    p50: percentile(samples, 0.5), p95: percentile(samples, 0.95), p99: percentile(samples, 0.99), max: percentile(samples, 1) };
}

export function judgeRun({ ms, calls, tris }, quality) {
  const p95 = percentile(ms, 0.95), maxCalls = percentile(calls, 1), maxTris = percentile(tris, 1);
  const reasons = [];
  if (!Object.hasOwn(LIMITS, quality)) reasons.push('品質が標準・軽量のいずれでもありません');
  if (p95 === null || maxCalls === null || maxTris === null || ms.length !== calls.length || ms.length !== tris.length)
    reasons.push('毎コマの有限な標本が揃っていません');
  if (p95 !== null && p95 > LIMITS[quality]) reasons.push(`p95が${LIMITS[quality]}msを超えています`);
  if (maxCalls !== null && maxCalls > 900) reasons.push('毎コマの描画呼出が900を超えています');
  if (maxTris !== null && maxTris > 5_000_000) reasons.push('毎コマの三角形が500万を超えています');
  return { pass: reasons.length === 0, p95, maxCalls, maxTris, reasons };
}

// runs は {quality, ms, calls, tris} の配列。場面の準備・順序は呼出側の測定シナリオが担う。
export function judgeAll(runs) {
  const results = runs.map(run => judgeRun(run, run.quality));
  const reasons = results.flatMap((r, i) => r.reasons.map(reason => `${i + 1}回目：${reason}`));
  if (runs.length !== 8) reasons.push('測定が全8回ではありません'); // R14.8 の仕様の値
  return { pass: reasons.length === 0, runs: results, reasons };
}
