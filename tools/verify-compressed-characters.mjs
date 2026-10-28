import fs from 'node:fs';
import path from 'node:path';
import { parseGlb } from './lib/glb.mjs';
import { compareCharacters } from './lib/character-validation.mjs';
import { CHARACTER_NAMES } from './lib/character-clips.mjs';

export function verifyDirectory(original, compressed) {
  const characters = CHARACTER_NAMES.map(name => {
    const file = name + '.glb';
    return { file, ...compareCharacters(parseGlb(fs.readFileSync(path.join(original, file))), parseGlb(fs.readFileSync(path.join(compressed, file)))) };
  });
  return { schemaVersion: 1, units: { positions: 'mm', rotations: 'degrees' }, characters, maxRotationDegrees: Math.max(...characters.map(c => c.maxRotationDegrees)), maxPositionMm: Math.max(...characters.map(c => c.maxPositionMm)), meanPositionMm: characters.reduce((s, c) => s + c.meanPositionMm * c.vertexSamples, 0) / characters.reduce((s, c) => s + c.vertexSamples, 0) };
}
if (process.argv[1]?.endsWith('/verify-compressed-characters.mjs')) {
  try {
    const args = process.argv.slice(2), options = {};
    for (let i = 0; i < args.length; i++) {
      if (!['--original', '--compressed'].includes(args[i]) || !args[i + 1] || args[i + 1].startsWith('--')) throw new TypeError('CLI arguments: unknown option or missing value');
      options[args[i].slice(2)] = args[++i];
    }
    if (!options.original || !options.compressed) throw new TypeError('CLI arguments: --original and --compressed required');
    const result = verifyDirectory(options.original, options.compressed); console.log(JSON.stringify(result, null, 2));
    if (result.maxRotationDegrees >= 0.01 || result.maxPositionMm >= 3) process.exitCode = 1;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
