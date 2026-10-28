import fs from 'node:fs';
import path from 'node:path';
import { parseGlb, buildGlb } from './lib/glb.mjs';
import { compressCharacter, byteBreakdown } from './lib/character-compression.mjs';
import { referencedClips, CHARACTER_NAMES } from './lib/character-clips.mjs';

export function compressDirectory({ input, output, report, dryRun = false, root = '.' }) {
  const refs = referencedClips(root), characters = [];
  for (const name of CHARACTER_NAMES) {
    const file = name + '.glb', bytes = fs.readFileSync(path.join(input, file)), before = parseGlb(bytes);
    const result = compressCharacter(before, refs.keep), compressed = buildGlb(result.doc);
    characters.push({ file, beforeBytes: bytes.length, afterBytes: compressed.length, before: byteBreakdown(before), after: byteBreakdown(result.doc), removedClips: result.removedClips, keptClips: result.doc.json.animations.map(a => a.name), skippedUV: result.skippedUV, errors: result.errors });
    if (!dryRun) { fs.mkdirSync(output, { recursive: true }); fs.writeFileSync(path.join(output, file), compressed); }
  }
  const result = { schemaVersion: 1, referencedClips: refs.names, characters, totals: { beforeBytes: characters.reduce((n, c) => n + c.beforeBytes, 0), afterBytes: characters.reduce((n, c) => n + c.afterBytes, 0) } };
  if (report) { fs.mkdirSync(path.dirname(report), { recursive: true }); fs.writeFileSync(report, JSON.stringify(result, null, 2) + '\n'); }
  return result;
}

if (process.argv[1]?.endsWith('/compress-characters.mjs')) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--dry-run') options.dryRun = true;
      else if (['--in', '--out', '--report'].includes(args[i]) && args[i + 1] && !args[i + 1].startsWith('--')) options[{ '--in': 'input', '--out': 'output', '--report': 'report' }[args[i]]] = args[++i];
      else throw new TypeError('CLI arguments: unknown option or missing value');
    }
    if (!options.input || (!options.output && !options.dryRun)) throw new TypeError('CLI arguments: --in and --out required (or --dry-run)');
    const r = compressDirectory(options); console.log(JSON.stringify(r.totals, null, 2));
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
