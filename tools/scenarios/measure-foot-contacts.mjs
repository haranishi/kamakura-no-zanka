// 検証：移動クリップの足の接地位相のデータ（clips.json の contacts。Blender の焼き込み）が、実際のアニメーションの骨の動きと矛盾しないか。
// 足音を「歩いた距離」でなく「足が地面に着く瞬間」に鳴らすため（要件15.1）。見た目との一致は、最後に本人が動画と音で確かめる（design-audio.md）。
//
// 接地の瞬間は、定義によって数十ms動く。そこで、骨の動きから物理的な2つの境界を測り、データがその間に入ることを検査する。
//   E：足が体に対して最も前に出た瞬間（前進から後退へ折り返す）。これより前には、足は着かない。
//   P：足の地面に対する前後の速さが0に近づく瞬間（足が止まる）。これより後には、足はもう着いている。
//   データの接地開始 D について、 E - 40ms ≤ D ≤ P + 40ms なら矛盾なし（歩きは D が E に近く、走りは P に近い）。
// うまくいかなかった測り方（2026-10-27）：足首の高さのしきい値越えは、体の上下動で当てにならない。
//
// 実行：KZ_OUT=reports/audio/foot-contacts-measured.json PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/measure-foot-contacts.mjs
//   測った結果（E・P・データの接地）を JSON で書き出す。外れたクリップは、tools/build-foot-contacts.mjs が境界の内側へ収めて dist/valley/anim-contacts.js を作る。
import fs from 'node:fs';

const CLIPS = ['Samurai_Walk', 'CMU_Walk', 'CMU_Jog', 'CMU_Run', 'Casual_Walk', 'Walk_Fight_Forward', 'Cautious_Crouch_Walk_Forward'];
const MARGIN_MS = 40;

export default async function ({ v, log }) {
  const raw = await v(`(async () => {
    const { Character } = await import('/valley/characters.js');
    const roster = __valley.game.roster;
    const out = {};
    for (const [who] of roster.templates) {
      const ch = new Character(roster, who);
      out[who] = {};
      for (const name of ${JSON.stringify(CLIPS)}) {
        const clip = roster.templates.get(who).clips.get(name);
        if (!clip) continue;
        const a = ch.action(name); a.enabled = true; a.paused = false; a.setEffectiveWeight(1); a.timeScale = 1; a.play();
        const D = clip.duration, N = Math.round(D * 240);
        const vec = new ch.model.position.constructor();
        const s = { LeftFootZ: [], RightFootZ: [], HipsZ: [] };
        for (let i = 0; i < N; i++) {
          a.time = D * i / N; ch.mixer.update(0); ch.model.updateMatrixWorld(true);
          ch.bone('LeftFoot').getWorldPosition(vec); s.LeftFootZ.push(vec.z);
          ch.bone('RightFoot').getWorldPosition(vec); s.RightFootZ.push(vec.z);
          ch.bone('Hips').getWorldPosition(vec); s.HipsZ.push(vec.z);
        }
        out[who][name] = { duration: D, N, ...s };
      }
    }
    return out;
  })()`);
  const meta = await v(`__valley.game.roster.meta.clips`);

  // 体に対する足の前後の位置 rel（前が正）から、E（最も前に出た瞬間）と P（足が止まる瞬間）を、円環で探す。
  const smooth3 = a => a.map((x, i) => (a[(i - 1 + a.length) % a.length] + x + a[(i + 1) % a.length]) / 3);
  const forwardExtremes = (rel, D) => {
    const n = rel.length, hi = Math.max(...rel), lo = Math.min(...rel), out = [];
    for (let i = 0; i < n; i++) {
      let isMax = rel[i] >= hi - 0.3 * (hi - lo);
      for (let k = 1; k <= 3 && isMax; k++) if (rel[(i + k) % n] > rel[i] || rel[(i - k + n) % n] > rel[i]) isMax = false;
      if (isMax && (!out.length || D * i / n - out.at(-1) > D / 40)) out.push(D * i / n);
    }
    return out;
  };
  const plantedStarts = (rel, D) => {
    const n = rel.length, dt = D / n;
    const vel = smooth3(rel.map((_, i) => (rel[(i + 1) % n] - rel[(i - 1 + n) % n]) / (2 * dt)));
    // 足が止まっている間の後退速度を、データ自身から推定する（後退の下位15%点）。
    const speed = -[...vel].sort((a, b) => a - b)[Math.floor(0.15 * n)], thr = 0.25 * speed, out = [];
    for (let i = 0; i < n; i++) if (vel[(i - 1 + n) % n] + speed > thr && vel[i] + speed <= thr) out.push(D * i / n);
    return out;
  };
  // 円環での符号つきの差 a - b（-D/2〜D/2）
  const sdiff = (a, b, D) => { let d = (a - b) % D; if (d > D / 2) d -= D; if (d < -D / 2) d += D; return d; };
  const nearest = (list, x, D) => list.reduce((best, t) => (best === null || Math.abs(sdiff(t, x, D)) < Math.abs(sdiff(best, x, D)) ? t : best), null);

  const measured = {}, byClip = {};
  for (const [who, clips] of Object.entries(raw)) {
    for (const [name, d] of Object.entries(clips)) {
      const m = meta[name]?.contacts;
      if (!m) continue;
      for (const foot of ['left', 'right']) {
        const rel = smooth3(d[foot === 'left' ? 'LeftFootZ' : 'RightFootZ'].map((z, i) => z - d.HipsZ[i]));
        const E = forwardExtremes(rel, d.duration), P = plantedStarts(rel, d.duration);
        const starts = (m[foot] || []).map(([s]) => s * d.duration);
        const rows = starts.map(D => {
          const e = nearest(E, D, d.duration), p = nearest(P, D, d.duration);
          return { D, dE: e === null ? null : sdiff(D, e, d.duration) * 1000, dP: p === null ? null : sdiff(p, D, d.duration) * 1000 };
        });
        measured[`${who}/${name}/${foot}`] = { duration: +d.duration.toFixed(4), data: starts.map(t => +t.toFixed(4)), E: E.map(t => +t.toFixed(4)), P: P.map(t => +t.toFixed(4)) };
        (byClip[name] ||= []).push(...rows.map(r => ({ who, foot, ...r })));
      }
    }
  }
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify({ marginMs: MARGIN_MS, measured }, null, 1));

  const bad = [];
  log('クリップ                        D-E（データがEより後 ms）   P-D（PがDより後 ms）   判定');
  for (const name of CLIPS) {
    const rows = byClip[name];
    if (!rows) continue;
    const dE = rows.map(r => r.dE).filter(x => x !== null), dP = rows.map(r => r.dP).filter(x => x !== null);
    const stat = a => a.length ? `${Math.min(...a).toFixed(0).padStart(5)}〜${Math.max(...a).toFixed(0).padStart(4)} 平均${(a.reduce((s, x) => s + x, 0) / a.length).toFixed(0).padStart(4)}` : '  なし';
    const failE = dE.length && Math.min(...dE) < -MARGIN_MS, failP = dP.length && Math.min(...dP) < -MARGIN_MS;
    log(`${name.padEnd(30)} ${stat(dE).padEnd(26)} ${stat(dP).padEnd(22)} ${failE || failP ? '✗' : '○'}`);
    if (failE) bad.push(`${name}: データが E より ${(-Math.min(...dE)).toFixed(0)}ms 早い（足が前に出きる前に着いたことになる）`);
    if (failP) bad.push(`${name}: データが P より ${(-Math.min(...dP)).toFixed(0)}ms 遅い（足が止まったあとに着いたことになる）`);
  }
  if (bad.length) log(`境界（E・P）から ${MARGIN_MS}ms を超えて外れたクリップ: ${bad.join(' / ')}\n→ tools/build-foot-contacts.mjs が、その接地を境界の内側へ収める`);
  else log(`すべての移動クリップで、データの接地開始が E と P の間（${MARGIN_MS}ms の余裕つき）に入っている`);
}
