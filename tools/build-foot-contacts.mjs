// 足の接地位相のデータ（dist/valley/anim-contacts.js）を作る。
// 入力：
//   dist/assets/characters/clips.json の contacts（Blender の焼き込みの接地区間。位相0〜1。接地の開始＝かかとが着く瞬間の近似）
//   reports/audio/foot-contacts-measured.json（実際の骨の動きから測った E・P。tools/scenarios/measure-foot-contacts.mjs）
// 規則：各接地の開始 D（秒）を、E（足が体に対して最も前に出た瞬間）と P（足が地面に止まる瞬間）の間に収める。
//   D が E より 40ms を超えて早い → E へ。D が P より 40ms を超えて遅い → P へ。それ以外は D のまま。
//   E・P は、全キャラクターの中央値（同じクリップは、キャラクターが違っても、ほぼ同じ動き）。
// 実行：node tools/build-foot-contacts.mjs          （dist/valley/anim-contacts.js を書く）
//       node tools/build-foot-contacts.mjs --check  （書かずに、いまのファイルと一致するかを調べる。不一致なら終了コード1）
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LOCOMOTION } from '../dist/valley/anim-data.js';

export const MARGIN_S = 0.04;
// ゲームが移動で使うクリップだけ（待ちの動作は除く）。測っていないクリップのデータは出荷しない。
export const LOCOMOTION_CLIPS = [...new Set(Object.values(LOCOMOTION).flatMap(t => [t.walk, t.jog, t.run]))].sort();
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// 円環（周期 D）での符号つきの差 a - b（-D/2〜D/2）
const sdiff = (a, b, D) => { let d = (a - b) % D; if (d > D / 2) d -= D; if (d < -D / 2) d += D; return d; };
const median = a => { const s = [...a].sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : null; };
const nearestRel = (list, x, D) => list.length ? list.map(t => sdiff(t, x, D)).reduce((b, d) => (Math.abs(d) < Math.abs(b) ? d : b)) : null;
const round4 = x => Math.round(x * 10000) / 10000;

/** ある接地（clip・foot・時刻 d 秒）に最も近い E・P を、全キャラクターの中央値で返す。{ eRel, pRel }（E - d と P - d。無ければ null） */
export function bracketOffsets(measured, name, foot, d) {
  const eRel = [], pRel = [];
  for (const [key, m] of Object.entries(measured.measured)) {
    const [, clip, f] = key.split('/');
    if (clip !== name || f !== foot) continue;
    const e = nearestRel(m.E, d, m.duration), p = nearestRel(m.P, d, m.duration);
    if (e !== null) eRel.push(e);
    if (p !== null) pRel.push(p);
  }
  return { eRel: median(eRel), pRel: median(pRel) };
}

/** clips.json と測定結果から、{ table, adjustments } を返す。table: { [clip]: { duration, loop, contacts: [{foot, t}] } } */
export function buildFootContacts(clipsJson, measured, clipNames = LOCOMOTION_CLIPS) {
  const table = {}, adjustments = [];
  for (const name of [...clipNames].sort()) {
    const meta = clipsJson.clips[name];
    if (!meta?.contacts || !meta.loop) throw new Error(`移動クリップ ${name} に、接地位相（contacts）が無い`);
    const D = meta.seconds, contacts = [];
    for (const foot of ['left', 'right']) {
      (meta.contacts[foot] || []).forEach(([start], k) => {
        const d = start * D;
        const { eRel: e, pRel: p } = bracketOffsets(measured, name, foot, d);   // e: E - D（正なら E が D より後）、p: P - D
        let shift = 0;
        if (e !== null && e > MARGIN_S) shift = e;          // D が E より 40ms を超えて早い → E へ
        else if (p !== null && p < -MARGIN_S) shift = p;    // D が P より 40ms を超えて遅い → P へ
        const t = ((d + shift) % D + D) % D;
        if (shift) adjustments.push({ clip: name, foot, data: round4(d), final: round4(t), shiftMs: Math.round(shift * 1000) });
        contacts.push({ foot, t: round4(t) });
      });
    }
    contacts.sort((a, b) => a.t - b.t);
    table[name] = { duration: round4(D), loop: true, contacts };
  }
  return { table, adjustments };
}

/** dist/valley/anim-contacts.js の中身 */
export function renderModule(table) {
  const lines = Object.entries(table).map(([name, c]) =>
    `  ${name}: { duration: ${c.duration}, loop: true, contacts: [${c.contacts.map(x => `{ foot: '${x.foot}', t: ${x.t} }`).join(', ')}] },`);
  return `// 足の接地位相（移動クリップ）。tools/build-foot-contacts.mjs が作る。手で書き換えない。
// 元：clips.json の contacts（Blender の焼き込み）を、実際の骨の動きから測った境界（reports/audio/foot-contacts-measured.json）の間に収めたもの。
// t は、クリップの先頭からの秒（0 以上 duration 未満）。foot は、その瞬間に着く足。
export const FOOT_CONTACTS = Object.freeze({
${lines.join('\n')}
});
`;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const clipsJson = JSON.parse(fs.readFileSync(path.join(root, 'dist/assets/characters/clips.json'), 'utf8'));
  const measured = JSON.parse(fs.readFileSync(path.join(root, 'reports/audio/foot-contacts-measured.json'), 'utf8'));
  const { table, adjustments } = buildFootContacts(clipsJson, measured);
  const text = renderModule(table), out = path.join(root, 'dist/valley/anim-contacts.js');
  if (process.argv.includes('--check')) {
    const now = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
    if (now !== text) { console.error('dist/valley/anim-contacts.js が、測定結果と clips.json から作った内容と違う。node tools/build-foot-contacts.mjs で作り直す'); process.exit(1); }
    console.log('anim-contacts.js は、測定結果と一致している'); process.exit(0);
  }
  fs.writeFileSync(out, text);
  console.log(`${Object.keys(table).length} クリップ、接地 ${Object.values(table).reduce((s, c) => s + c.contacts.length, 0)} 件を書いた。境界へ収めた接地: ${adjustments.length} 件`);
  for (const a of adjustments) console.log(`  ${a.clip} ${a.foot}: ${a.data}s → ${a.final}s (${a.shiftMs >= 0 ? '+' : ''}${a.shiftMs}ms)`);
}
