import fs from 'node:fs';
import path from 'node:path';

export const CHARACTER_NAMES = ['hero', 'archer', 'soldier', 'officer', 'villager_m', 'villager_f', 'child'];

// Conservative source substring matching also retains names mentioned in comments and tables.
// Reviewed call sites: anim-data tables, actors idleClip/def.idleClip, world-data and game.
// lab selects among shipped clips. No runtime concatenation constructs animation names.
export function referencedClips(root = '.') {
  const dir = path.join(root, 'dist/valley');
  const source = fs.readdirSync(dir).filter(f => f.endsWith('.js')).sort().map(f => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');
  const meta = JSON.parse(fs.readFileSync(path.join(root, 'dist/assets/characters/clips.json'), 'utf8'));
  const names = Object.keys(meta.clips).filter(n => source.includes(n));
  return { source, names, keep: name => source.includes(name) || names.includes(name) };
}
