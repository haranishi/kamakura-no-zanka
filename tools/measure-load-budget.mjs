import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../', import.meta.url));
// design-validation.md「読み込み」の仕様の値（非圧縮バイト）。
const MIB = 1048576;
const targets = ['dist/audio.js', 'dist/assets/characters', 'dist/assets/valley', 'dist/valley', 'dist/vendor'];
function bytesAt(file) {
  const stat = fs.statSync(file);
  return stat.isDirectory() ? fs.readdirSync(file).sort().reduce((n, name) => n + bytesAt(path.join(file, name)), 0) : stat.size;
}
export function measureLoadBudget() {
  const entries = targets.map(target => { const bytes = bytesAt(path.join(root, target)); return { path: target, bytes, MiB: bytes / MIB }; });
  const bytes = entries.reduce((n, e) => n + e.bytes, 0);
  return { note: '未使用の同梱物を含む上界。実際に読む合計ではない。非圧縮・HTTPヘッダーを除く。', entries, bytes, MiB: bytes / MIB };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2), i = args.indexOf('--max'), result = measureLoadBudget();
  if (i >= 0) {
    const max = Number(args[i + 1]);
    if (!Number.isFinite(max) || max < 0) throw Error('--max requires a nonnegative MiB value');
    result.maxMiB = max; result.pass = result.bytes <= max * MIB;
    if (!result.pass) process.exitCode = 1;
  }
  if (args.includes('--json')) console.log(JSON.stringify(result, null, 2));
  else { console.log(result.note); console.table(result.entries); console.log(`合計 ${result.MiB.toFixed(6)} MiB (${result.bytes} bytes)`, result.pass === undefined ? '' : `上限 ${result.maxMiB} MiB: ${result.pass ? '合格' : '超過'}`); }
}
