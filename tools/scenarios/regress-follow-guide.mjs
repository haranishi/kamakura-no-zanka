// 回帰：矢（guideView.direction）にだけ従って歩くと、b2 → b3（道の選択）→ b4 の里の中心まで着ける。三つの道（front・north・south）それぞれで。
// 案内の向きがずれる・基準路が途切れる・迷いの強調が誤って出る、と、ここで落ちる。見える矢の向きが正しいかは、目で確かめる（tools/README-valley-qa.md）。
// 数値の合格線: 3つの道すべてで中心に着く。道外れ・迷いの強調が一度も出ない。止まって進まない（20秒）ことがない。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-follow-guide.mjs --strict
export default async function ({ page, v, freeze, start, step, call, log, st }) {
  const yawOf = d => Math.atan2(-d.x, -d.z);
  const gv = () => call('guideView');
  const clear = async () => {
    for (let i = 0; i < 12; i++) { const s = await st(); if (!s.talking && !s.pending) break; await call('advanceDialogue'); await step(6); }
  };
  const choose = id => v(`(() => { const e = document.getElementById('${id}'); const ok = e && !e.closest('.hidden'); if (ok) e.click(); return !!ok; })()`);
  const failures = [];
  for (const [i, plan] of ['front', 'north', 'south'].entries()) {
    // 同じページで start('new') を繰り返すと任務の状態が戻らないので、道ごとに読み込み直す。
    if (i > 0) { await page.reload(); await page.waitForFunction('window.__valleyReady===true', null, { timeout: 180000 }); }
    await start('new'); await freeze(true); await step(30); await call('god', true);
    await call('dispatch', { type: 'enter_zone', zone: 'temple_yard' });
    for (let i = 0; i < 6; i++) { await step(20); await call('advanceDialogue'); }
    await call('dispatch', { type: 'dialogue_end', id: 'boy_arrives' }).catch(() => {});
    await call('teleport', -80.5, -68.5, -2.2); await step(30); await clear();
    await call('key', 'KeyW', true); await call('key', 'ShiftLeft', true);
    let t = 0, walked = 0, last = (await st()).hero, emphasized = false, off = false, outcome = 'timeout', bestRem = Infinity, bestAt = 0, chosen = false, beat = null;
    while (t < 140) {
      await clear();
      if (!chosen && await v(`!document.getElementById('choice').classList.contains('hidden')`)) {
        await choose(plan === 'front' ? 'choice-front' : 'choice-flank'); chosen = true; await step(10);
        if (plan === 'south') await call('setGuidePlan', 'south');   // 脇道は既定で北。南の畦道は QA で指定する（実際の切替は regress-guide-switch）
      }
      const g = await gv(), s = await st();
      if (s.beat !== beat) { beat = s.beat; bestRem = Infinity; bestAt = t; }   // 段が変わると基準路も替わる。進み具合の基準を取り直す
      emphasized ||= g.emphasized; off ||= g.offRoad;
      if (s.beat === 'b4_village' && g.reached) { outcome = 'reached-center'; break; }
      if ((g.mode === 'free' || g.mode === 'combat') && (g.direction.x || g.direction.z)) await call('look', yawOf(g.direction), 0.25);
      await step(6); t += 0.1;
      const h = (await st()).hero; walked += Math.hypot(h.x - last.x, h.z - last.z); last = h;
      const rem = g.remaining ?? 0;
      if (rem < bestRem - 0.5) { bestRem = rem; bestAt = t; }
      if (t - bestAt > 20 && g.mode !== 'dialogue') { outcome = `stuck(remaining ${rem.toFixed(1)}, beat ${s.beat})`; break; }
    }
    await call('key', 'KeyW', false); await call('key', 'ShiftLeft', false);
    log(`${plan}: ${outcome}  ${t.toFixed(1)}s  歩いた${walked.toFixed(0)}m  強調${emphasized}  道外れ${off}`);
    if (outcome !== 'reached-center') failures.push(`${plan}: 里の中心に着けなかった（${outcome}）`);
    if (emphasized) failures.push(`${plan}: 矢に従っているのに、迷いの強調が出た`);
    if (off) failures.push(`${plan}: 矢に従っているのに、道外れと判定された`);
  }
  if (failures.length) throw new Error(failures.join(' / '));
}
