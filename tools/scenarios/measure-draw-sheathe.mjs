// 計測：既存の抜刀・納刀の動作（Katana_Draw_v2・Katana_Sheathe）で、握り（太刀の原点）と腰の鞘の枠がどう動くか。
// 鞘に沿って刃が出入りする動作なら、握りは鞘の軸の近くで、軸の向きがそろって動くはず（design-draw-sheathe.md）。
// 実行：KZ_OUT=reports/polish3/baseline/draw-sheathe-before.json PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-draw-sheathe.mjs --out <フォルダ>
// 見るのは、60コマ/秒の全コマの「鞘の枠から見た握りの位置（横ずれ・軸方向）」と「軸の角度」。値は0.1秒ごとに残す。
import fs from 'node:fs';

const CLIPS = ['Katana_Draw_v2', 'Katana_Sheathe'];
const WHO = ['hero', 'soldier'];
const FPS = 60;
const ALIGNED = { lateral: 0.05, angleDeg: 30 };   // これ以内なら「鞘の軸に沿っている」とみなす

const col = (m, i) => [m[i * 4], m[i * 4 + 1], m[i * 4 + 2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const len = a => Math.hypot(...a);
const round = (x, k = 3) => Math.round(x * 10 ** k) / 10 ** k;

export default async function ({ v, log }) {
  const raw = await v(`(async () => {
    const { Character } = await import('/valley/characters.js');
    const { GRIP } = await import('/valley/config.js');
    const roster = __valley.game.roster;
    const out = {};
    for (const who of ${JSON.stringify(WHO)}) {
      if (!roster.templates.has(who)) continue;
      const ch = new Character(roster, who);
      ch.setTachi(GRIP, false);
      const P = new ch.root.position.constructor();
      out[who] = { height: ch.height, clips: {} };
      for (const name of ${JSON.stringify(CLIPS)}) {
        ch.play(name, { fade: 0, restart: true });
        const D = ch.meta(name).seconds, N = Math.floor(D * ${FPS}), frames = [];
        for (let i = 0; i <= N; i++) {
          const t = Math.min(D - 0.001, i / ${FPS});
          ch.current.time = t; ch.update(0); ch.root.updateMatrixWorld(true);
          frames.push({ t, hand: Array.from(ch.weapons.tachiDrawn.holder.matrixWorld.elements), hip: Array.from(ch.weapons.tachiHip.holder.matrixWorld.elements),
            rh: ch.bone('RightHand').getWorldPosition(P).toArray(), lh: ch.bone('LeftHand').getWorldPosition(P).toArray() });
        }
        out[who].clips[name] = { seconds: D, frames };
      }
      ch.play('Long_Breathe_and_Look_Around', { fade: 0, restart: true }); ch.current.time = 0.2; ch.update(0); ch.root.updateMatrixWorld(true);
      const pos = n => ch.bone(n).getWorldPosition(P).toArray();
      out[who].arm = { rightArm: pos('RightArm'), rightForeArm: pos('RightForeArm'), rightHand: pos('RightHand'), hip: Array.from(ch.weapons.tachiHip.holder.matrixWorld.elements) };
      ch.dispose();
    }
    return out;
  })()`);

  const result = { measuredAt: new Date().toISOString().slice(0, 10), fps: FPS, aligned: ALIGNED, who: {} };
  for (const [who, data] of Object.entries(raw)) {
    const entry = result.who[who] = { height: round(data.height, 2), clips: {} };
    for (const [name, d] of Object.entries(data.clips)) {
      const rows = d.frames.map(f => {
        const Xs = col(f.hip, 0), Ys = col(f.hip, 1), Zs = col(f.hip, 2), Ps = col(f.hip, 3), Yh = col(f.hand, 1);
        const rel = sub(col(f.hand, 3), Ps), x = dot(rel, Xs), y = dot(rel, Ys), z = dot(rel, Zs);
        const lateral = Math.hypot(x, z), angleDeg = Math.acos(Math.max(-1, Math.min(1, dot(Yh, Ys)))) * 180 / Math.PI;
        return { t: f.t, x, y, z, lateral, angleDeg, dist: Math.hypot(x, y, z), hands: len(sub(f.rh, f.lh)) };
      });
      const closest = rows.reduce((m, r) => (r.dist < m.dist ? r : m), rows[0]);
      entry.clips[name] = {
        seconds: d.seconds, frames: rows.length,
        alignedFrames: rows.filter(r => r.lateral < ALIGNED.lateral && r.angleDeg < ALIGNED.angleDeg).length,
        closest: { t: round(closest.t, 2), dist: round(closest.dist), lateral: round(closest.lateral), angleDeg: Math.round(closest.angleDeg) },
        lateralRange: [round(Math.min(...rows.map(r => r.lateral))), round(Math.max(...rows.map(r => r.lateral)))],
        angleRangeDeg: [Math.round(Math.min(...rows.map(r => r.angleDeg))), Math.round(Math.max(...rows.map(r => r.angleDeg)))],
        handsApart: [round(Math.min(...rows.map(r => r.hands))), round(Math.max(...rows.map(r => r.hands)))],
        samples: rows.filter((_, i) => i % 6 === 0).map(r => ({ t: round(r.t, 2), x: round(r.x), y: round(r.y), z: round(r.z), lateral: round(r.lateral), angleDeg: Math.round(r.angleDeg), hands: round(r.hands) })),
      };
    }
    const a = data.arm, upper = len(sub(a.rightForeArm, a.rightArm)), fore = len(sub(a.rightHand, a.rightForeArm));
    const Xs = col(a.hip, 0), Ys = col(a.hip, 1), Zs = col(a.hip, 2), Ps = col(a.hip, 3);
    const rel = sub(a.rightArm, Ps), x = dot(rel, Xs), z = dot(rel, Zs);
    const pull = s => len(sub([Ps[0] - Ys[0] * s, Ps[1] - Ys[1] * s, Ps[2] - Ys[2] * s], a.rightArm));
    entry.reach = { upperArm: round(upper), foreArm: round(fore), total: round(upper + fore), shoulderToAxisLine: round(Math.hypot(x, z)),
      shoulderToHilt: round(pull(0)), shoulderToPulled: Object.fromEntries([0.2, 0.38, 0.5, 0.76].map(s => [s, round(pull(s))])) };
  }
  const out = process.env.KZ_OUT;
  if (out) { fs.mkdirSync(out.replace(/\/[^/]*$/, ''), { recursive: true }); fs.writeFileSync(out, JSON.stringify(result, null, 1) + '\n'); }
  for (const [who, e] of Object.entries(result.who)) for (const [name, c] of Object.entries(e.clips)) log(`${who} ${name}: aligned ${c.alignedFrames}/${c.frames}, closest ${c.closest.dist}m @${c.closest.t}s, angle ${c.angleRangeDeg.join('–')}°`);
}
