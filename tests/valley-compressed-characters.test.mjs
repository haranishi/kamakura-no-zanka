// なぜ失敗したか: 元GLBがなくても [structure/budget/clip/weights] ごとに出荷物の問題を示す。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseGlb, readAccessor } from '../tools/lib/glb.mjs';
import { validateStructure } from '../tools/lib/character-validation.mjs';
import { CHARACTER_NAMES, referencedClips } from '../tools/lib/character-clips.mjs';

const dir = 'dist/assets/characters/', refs = referencedClips();
const meta = JSON.parse(fs.readFileSync(dir + 'clips.json', 'utf8'));
for (const name of CHARACTER_NAMES) test(name + ' shipped GLB is structurally valid and contains required clips [structure/clip]', () => {
  const doc = parseGlb(fs.readFileSync(dir + name + '.glb'));
  validateStructure(doc);
  const clips = new Set(doc.json.animations.map(a => a.name));
  for (const clip of meta.characters[name].clips.filter(refs.keep)) assert(clips.has(clip), '[clip] ' + name + ' missing ' + clip);
  for (const mesh of doc.json.meshes) for (const p of mesh.primitives) {
    const w = readAccessor(doc, p.attributes.WEIGHTS_0);
    assert(w.componentType === 5121 && w.normalized, '[weights] expected normalized UBYTE');
    for (let i = 0; i < w.array.length; i += 4) assert.equal(w.array[i] + w.array[i + 1] + w.array[i + 2] + w.array[i + 3], 255, '[weights] sum differs from 255');
  }
});
test('seven characters fit within 36MiB [budget]', () => {
  // 実測は35.59MiB。本当の基準は通しの実読み込み84.5MiB以内（実測77.04MiB）で、これは人物だけの後戻り防止の上限。
  const bytes = CHARACTER_NAMES.reduce((n, name) => n + fs.statSync(dir + name + '.glb').size, 0);
  assert(bytes <= 36 * 1048576, '[budget] character GLBs total ' + bytes + ' bytes exceeds 36MiB');
});
