// 名前による棚卸し。個別の取得元や再配布許諾を推測しない。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
export function measureClipProvenance() {
  const { clips } = JSON.parse(fs.readFileSync(path.join(root, 'dist/assets/characters/clips.json'), 'utf8'));
  const counts = { 'cmu-mocap': 0, 'meshy-motion-library-or-text-to-motion': 0 };
  const rows = Object.keys(clips).sort().map(clip => {
    const category = clip.startsWith('CMU_') ? 'cmu-mocap' : 'meshy-motion-library-or-text-to-motion';
    counts[category]++;
    return { clip, seconds: Number(clips[clip].seconds.toFixed(2)), category, status: 'unconfirmed' };
  });
  return {
    basis: 'NOTICE.md の「モーションキャプチャ（CMU）」は商品同梱可・動き単体の転売不可を示し、「人物の動き（Meshy）」は動き単体の再配布条件を未確認としており、個別の出所台帳と再配布条件の確認が揃わないため全件 unconfirmed とする。',
    clips: rows, counts,
  };
}

function main(args) {
  let json = false, output = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--json' && !json) json = true;
    else if (args[i] === '--write' && output === null && args[i + 1] && !args[i + 1].startsWith('-')) output = args[++i];
    else { console.error('使い方: node tools/measure-clip-provenance.mjs [--json] [--write <path>]'); return 2; }
  }
  try {
    const report = measureClipProvenance(), serialized = JSON.stringify(report, null, 2) + '\n';
    if (output !== null) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, serialized); }
    else if (json) process.stdout.write(serialized);
    else process.stdout.write(['# 動作の出所棚卸し', '', report.basis, '', '| clip | 秒 | category | status |', '| --- | --- | --- | --- |',
      ...report.clips.map(c => `| ${c.clip} | ${c.seconds.toFixed(2)} | ${c.category} | ${c.status} |`), '',
      ...Object.entries(report.counts).map(([category, count]) => `- ${category}: ${count}本`), ''].join('\n'));
    return 0;
  } catch (error) { console.error(error.message); return 1; }
}

if (process.argv[1] && fs.realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
