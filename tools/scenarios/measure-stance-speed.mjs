// 測定：移動の動作（その場で再生）で、着いている足が体に対して後ろへ動く速さ（m/秒・動作の等倍）。
// 足が地面に止まって見えるには、体の速さ＝この速さ×再生の倍率 であればよい。clips.json の avgSpeed（1周の平均）は、
// 走り・小走りで この速さより約1割大きく、avgSpeed で再生の倍率を決めると、着いている足が1歩ごとに5〜7cm前へ流れた（2026-11-03）。
// 足が着いている区間（clips.json の contacts）の中ほど6割で、足首の骨の前後の速さを平均する。結果は anim-data.js の STANCE_SPEED へ写す。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-stance-speed.mjs
const CLIPS = ['CMU_Run', 'CMU_Jog', 'Samurai_Walk', 'Walk_Fight_Forward', 'Casual_Walk', 'Cautious_Crouch_Walk_Forward'];
export default async function ({ v, log }) {
  const r = await v(`(async () => {
    const { Character } = await import('/valley/characters.js');
    const roster = __valley.game.roster, meta = roster.meta.clips, out = {};
    for (const who of ['hero', 'soldier', 'villager_m']) {
      const ch = new Character(roster, who), V = new ch.model.position.constructor();
      for (const name of ${JSON.stringify(CLIPS)}) {
        if (!roster.templates.get(who).clips.get(name)) continue;
        const a = ch.action(name); for (const b of ch.actions.values()) b.stop(); a.enabled = true; a.setEffectiveWeight(1); a.play();
        const D = meta[name].seconds, N = 480, z = { left: [], right: [] };
        for (let i = 0; i < N; i++) { a.time = D * i / N; ch.mixer.update(0); ch.model.updateMatrixWorld(true);
          ch.bone('LeftFoot').getWorldPosition(V); z.left.push(V.z); ch.bone('RightFoot').getWorldPosition(V); z.right.push(V.z); }
        const speeds = [];
        for (const side of ['left', 'right']) for (const [s, e] of meta[name].contacts[side] || []) {
          const len = ((e - s) % 1 + 1) % 1, i0 = Math.round((s + len * 0.2) * N), i1 = Math.round((s + len * 0.8) * N);
          const at = i => z[side][((i % N) + N) % N];
          speeds.push(Math.abs(at(i1) - at(i0)) / ((i1 - i0) / N * D));
        }
        (out[name] ||= {})[who] = { stance: speeds.reduce((p, q) => p + q, 0) / speeds.length, avg: meta[name].avgSpeed };
      }
    }
    return out;
  })()`);
  for (const [name, by] of Object.entries(r)) log(name.padEnd(30), Object.entries(by).map(([who, x]) => `${who} ${x.stance.toFixed(3)}`).join('  '), ' avgSpeed', Object.values(by)[0].avg);
}
