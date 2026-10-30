// 刀の軌跡（切先の位置）を、全動作クリップと抜刀・納刀について毎コマ記録し、変更前と変更後で比べる（8.6a：握りの層が刀を動かさないこと）。
// 記録（変更前と変更後を、それぞれの作業ツリーで）:
//   KZ_OUT=<json> PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/record-sword-tips.mjs --seed 1333
// 比べる:  node tools/scenarios/record-sword-tips.mjs <変更前.json> <変更後.json>   （最大の差が1mm以下なら終了コード0）
import fs from 'node:fs';

async function pageMain() {
  const { Character } = await import('/valley/characters.js');
  const { GRIP } = await import('/valley/config.js');
  const { createSwordLayer } = await import('/valley/sword-layer.js');
  const THREE = await import('three');
  const roster = __valley.game.roster, DT = 1 / 60, tip = new THREE.Vector3(), out = {};
  const sample = ch => { ch.root.updateMatrixWorld(true); tip.set(0, 0.88, 0).applyMatrix4(ch.weapons.tachiDrawn.holder.matrixWorld); return [tip.x, tip.y, tip.z].map(v => Math.round(v * 1e6) / 1e6); };
  for (const who of ['hero', 'soldier', 'officer']) {
    const names = [...roster.templates.get(who).clips.keys()].sort();
    for (const name of names) {
      const ch = new Character(roster, who); ch.setTachi(GRIP, true);
      ch.play(name, { fade: 0, restart: true });
      const frames = Math.ceil(ch.meta(name).seconds * 60), rec = [];
      for (let i = 0; i < frames; i++) { ch.update(DT); rec.push(sample(ch)); }
      out[`${who}:${name}`] = rec; ch.dispose();
    }
  }
  // 抜刀・納刀（主人公。層の出力を同じ時間刻みで与える）
  for (const [name, start, req] of [['calmDraw', 'sheathed', l => l.requestDraw({ fast: false })], ['fastDraw', 'sheathed', l => l.requestDraw({ fast: true })], ['calmSheathe', 'drawn', l => l.requestSheathe()]]) {
    const ch = new Character(roster, 'hero'); ch.setTachi(GRIP, start === 'drawn');
    const layer = createSwordLayer({ u: 0 }); if (start === 'drawn') layer.reset('drawn');
    const rec = [];
    for (let i = 0; i < 72; i++) {
      if (i === 3) req(layer);
      const o = layer.tick(DT); ch.sword.setFrame(o); ch.locomote(0, o.mode === 'sheathed' ? 'relaxed' : 'guard'); ch.update(DT); rec.push(sample(ch));
    }
    out[name] = rec; ch.dispose();
  }
  return out;
}

export default async function ({ v, log }) {
  const out = await v(`(${pageMain.toString()})()`);
  const n = Object.values(out).reduce((s, r) => s + r.length, 0);
  log(`recorded ${Object.keys(out).length} sequences, ${n} frames`);
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(out) + '\n');
}

// 比べる（ノードで直接実行したとき）
if (process.argv[1] && process.argv[1].endsWith('record-sword-tips.mjs') && process.argv.length === 4) {
  const [a, b] = process.argv.slice(2).map(f => JSON.parse(fs.readFileSync(f, 'utf8')));
  let worst = 0, at = null, frames = 0;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length || keys.some(k => !b[k] || b[k].length !== a[k].length)) { console.error('記録の並びが違う'); process.exit(1); }
  for (const k of keys) a[k].forEach((p, i) => { frames++; const q = b[k][i], d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); if (d > worst) { worst = d; at = `${k}#${i}`; } });
  console.log(`${keys.length} sequences, ${frames} frames, max tip difference ${(worst * 1000).toFixed(4)} mm${at ? ' at ' + at : ''}`);
  process.exit(worst <= 0.001 ? 0 : 1);
}
