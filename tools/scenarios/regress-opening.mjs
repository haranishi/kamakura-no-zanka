// 回帰：オープニング（語りと絵のような場面）を実ブラウザで通す。
//  ・区間の時刻、語りの表示と消去（字幕OFFでも出る・字の色・帯との比4.5:1以上）、HUDを隠す、舞台の描画呼出と三角形
//  ・終わったら舞台と溶け合いの絵を解放し、谷の描画呼出・三角形が「オープニング無し」と同じに戻る。形・画像の数は、上映を繰り返しても増えないことで確かめる
//  ・2回目の「はじめから」は短い版。飛ばす（開始0.6秒は効かない・E/Space/クリック・0.6秒で暗転→目覚め）。休止からの復帰。動きを減らす
//  ・続きからでは出さない。旧保存（見たかの記録が無い）では通常版。やり直しでは出さない。結果からの「もう一度」で再上映
//  ・場面ごとの描画呼出・三角形（予算内）、絵の朱の面積（2割以下）、明滅（1秒に3回以下）
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-opening.mjs --intro 1 --seed 1333 --strict
//   KZ_OUT=<file.json> を付けると、測った値をJSONで残す。
import fs from 'node:fs';
import { contrast } from '../../dist/valley/opening.js';
import { flashRate } from '../../dist/valley/opening-scenes.js';
import { OPENING } from '../../dist/valley/opening-data.js';

export default async function ({ v, step, st, start, freeze, tap, click, log }) {
  const report = { segments: {}, lines: {}, contrast: {}, stage: { maxCalls: 0, maxTris: 0, byScene: {} }, memory: {}, vermilion: {}, flash: {} };
  const SCENE_CHECK = ['A', 'B'];                                      // 朱の面積と明滅を確かめる場面（作り込みが済んだ場面）
  const VERMILION_AT = [['A', 4.0], ['A', 9.5], ['B', 14.0], ['B', 19.5], ['C', 25.0], ['C', 29.5], ['D', 34.0], ['D', 40.5]];
  const fail = msg => { throw new Error(msg); };
  const hex = rgb => '#' + rgb.match(/\d+/g).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('');
  // n コマ進め、状態と語りの枠（DOM）を読む
  const probe = n => v(`(() => { const s = __valley.step(${n}); const $ = id => document.getElementById(id), l = $('nr-line');
    return { flow: s.flow, op: s.opening, calls: s.render.calls, tris: s.render.tris, hero: s.hero,
      nr: { on: !$('narration').classList.contains('hidden'), text: l.textContent, opacity: +(l.style.opacity || 0), color: getComputedStyle(l).color,
        inBar: (r => { const b = $('nr-bottom').getBoundingClientRect(); return r.top >= b.top && r.bottom <= b.bottom && r.left >= b.left && r.right <= b.right; })(l.getBoundingClientRect()),
        bar: getComputedStyle($('nr-bottom')).backgroundColor, veil: +($('nr-veil').style.opacity || 0), title: +($('nr-title').style.opacity || 0), titleText: $('nr-title-text').textContent },
      hud: !$('hud').classList.contains('hidden'), subs: __valley.game.hud.subsOn }; })()`);
  const fixCam = () => v('__valley.camera([-80, 2.4, -64], [-96, 1.4, -84], 54)');
  const gpu = () => v('(() => { const i = __valley.game.renderer.info; return { calls: i.render.calls, tris: i.render.triangles, geometries: i.memory.geometries, textures: i.memory.textures }; })()');
  const meta = () => v("JSON.parse(localStorage.getItem('kamakura-valley-meta') || 'null')");
  const newRun = (skipIntro = false) => v(`(() => { const g = __valley.game; g.skipIntro = ${skipIntro}; g.hud.hideResult(); g.startNew(); return g.flow; })()`);
  // 区間が替わった時刻（0.1秒刻み）を集めながら、終わる（flow が play になる）まで進める
  async function watch(label, { chunk = 6, max = 80, onSample } = {}) {
    const seen = [], lines = {};
    let last = null, t = 0;
    for (let i = 0; i < max * 60 / chunk; i++) {
      const p = await probe(chunk); t += chunk / 60;
      const seg = p.flow === 'intro' ? p.op?.segment ?? 'wake' : p.flow;
      if (seg !== last) { seen.push([seg, +t.toFixed(2)]); last = seg; }
      if (p.op?.line && p.nr.opacity > 0.99) lines[p.op.line] ??= { text: p.nr.text, color: hex(p.nr.color), bar: hex(p.nr.bar), inBar: p.nr.inBar, at: +t.toFixed(2) };
      if (p.op?.stage) {
        report.stage.maxCalls = Math.max(report.stage.maxCalls, p.calls); report.stage.maxTris = Math.max(report.stage.maxTris, p.tris);
        const b = report.stage.byScene[p.op.shot] ??= { calls: 0, tris: 0 }; b.calls = Math.max(b.calls, p.calls); b.tris = Math.max(b.tris, p.tris);
      }
      t += ((await onSample?.(p, t)) || 0) / 60;                          // 見本の中で余分に進めたコマ数を足す
      if (p.flow === 'play') break;
    }
    log(label, JSON.stringify(seen));
    return { seen, lines };
  }
  const near = (got, want, tol, what) => { if (Math.abs(got - want) > tol) fail(`${what}: ${got} (want ${want}±${tol})`); };
  // 絵（上下の帯を除く）の朱の割合と、相対輝度の平均。描画面を縮めて読む（?qa=1 では描いた絵が残る）
  const pix = (w = 160, h = 90) => v(`(async () => { const m = await import('/valley/opening-scenes.js'); const c = document.createElement('canvas'); c.width = ${w}; c.height = ${h};
    const g = c.getContext('2d'); g.drawImage(__valley.game.renderer.domElement, 0, 0, ${w}, ${h}); const d = g.getImageData(0, 0, ${w}, ${h}).data, bar = Math.round(${h} * 0.125);
    const lin = x => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4); let l = 0, n = 0;
    for (let y = bar; y < ${h} - bar; y++) for (let x = 0; x < ${w}; x++) { const i = (y * ${w} + x) * 4; l += 0.2126 * lin(d[i] / 255) + 0.7152 * lin(d[i + 1] / 255) + 0.0722 * lin(d[i + 2] / 255); n++; }
    return { share: m.vermilionShare(d, ${w}, ${h}, { bar: 0.125 }), luma: l / n }; })()`);
  const sampled = new Set();
  async function sampleScene(p) {
    let extra = 0;
    for (const [shot, at] of VERMILION_AT) {
      const key = shot + at;
      if (sampled.has(key) || p.op?.shot !== shot || p.op.t < at || p.op.dissolve > 0) continue;
      sampled.add(key); (report.vermilion[shot] ??= []).push([+p.op.t.toFixed(2), +(await pix(320, 180)).share.toFixed(4)]);
    }
    // 明滅：場面が明けてから2秒間、毎コマの平均の明るさ
    if (SCENE_CHECK.includes(p.op?.shot) && !report.flash[p.op.shot] && p.op.black === 0 && p.op.dissolve === 0) {
      const lumas = [];
      for (let i = 0; i < 120; i++) { await step(1); lumas.push((await pix(64, 36)).luma); }
      const lo = Math.min(...lumas), hi = Math.max(...lumas);
      report.flash[p.op.shot] = { rate: +flashRate(lumas, 60, 0.1 * hi).toFixed(3), min: +lo.toFixed(4), max: +hi.toFixed(4) };
      extra += 120;
    }
    return extra;
  }

  // 0 オープニング無しの谷（基準）。同じ固定カメラで描画呼出・三角形・形・画像を数える
  await v("localStorage.removeItem('kamakura-valley-meta')");
  await v('(__valley.game.skipIntro = true, 0)');
  await start('new'); await freeze(true); await fixCam(); await step(40);
  const base = await gpu(); report.memory.base = base;
  if ((await st()).flow !== 'play' || (await st()).opening) fail('intro=0 path should start in play without the opening');

  // 1 初回の「はじめから」：通常版。字幕OFFでも語りは出る。谷のカメラは基準と同じ固定のまま（谷の側の作り置きを揃え、舞台の分だけを比べる）
  await v('(__valley.game.hud.subsOn = false, 0)'); await fixCam();
  if (await newRun(false) !== 'intro') fail('the first new game should start the opening');
  let first = await probe(0);
  if (first.op?.version !== 'full') fail('first opening is not the full version: ' + JSON.stringify(first.op));
  if (first.hud || !first.nr.on || first.nr.veil < 0.99) fail('opening start: HUD must be hidden, narration shown, veil black ' + JSON.stringify(first));
  if (first.nr.titleText !== OPENING.title.text) fail('title text');
  let seenAtTitle = null, seenAtWake = null, hudDuringOpening = false, narrationDuringWake = false, resized = null;
  const holdState = () => v('(() => { const h = __valley.game.post.hold; return h && { cur: !!h.cur, frozen: !!h.frozen, w: h.cur?.width, mix: +h.mix.toFixed(3) }; })()');
  const full = await watch('full', { onSample: async p => {
    // 溶け合いの途中で描画の大きさが変わっても、残した前の場面の1枚を捨てない（溶け終わったら返す）
    if (p.op?.segment === 'B' && p.op.dissolve > 0.5 && !resized) {
      await v('__valley.game.post.setSize(1200, 700, 1)'); const during = await holdState();
      await v('__valley.game.post.setSize(1280, 720, 1)'); await step(70); resized = { during, after: await holdState() };
      if (!during.frozen || during.w !== 1200 || resized.after.frozen || !resized.after.cur) fail('the held frame was lost on resize, or kept after the dissolve ' + JSON.stringify(resized));
      return 70;
    }
    const extra = p.op?.stage ? await sampleScene(p) : 0; if (extra) return extra;
    if (p.flow === 'intro' && p.op?.segment !== 'wake' && p.hud) hudDuringOpening = true;
    if (p.op?.segment === 'wake' && p.nr.on) narrationDuringWake = true;
    if (p.op?.segment === 'title' && seenAtTitle === null) seenAtTitle = !!(await meta())?.openingSeen;
    if (p.op?.segment === 'wake' && seenAtWake === null) seenAtWake = !!(await meta())?.openingSeen;
  } });
  report.segments.full = full.seen; report.lines.full = full.lines;
  const fullAt = Object.fromEntries(full.seen.map(([s, t]) => [s, t]));
  for (const [seg, want] of [['A', 2], ['B', 11.5], ['C', 21], ['D', 30.5], ['title', 42], ['wake', 47], ['play', 52.2]]) near(fullAt[seg], want, 0.11, `full: ${seg} starts`);
  if (!resized) fail('the resize-during-dissolve check did not run');
  if (hudDuringOpening) fail('the HUD was visible during the opening');
  if (narrationDuringWake) fail('the narration frame stayed during the wake');
  if (seenAtTitle !== false || seenAtWake !== true) fail(`openingSeen should be written when the wake starts (title ${seenAtTitle}, wake ${seenAtWake})`);
  for (const l of OPENING.versions.full.lines) {
    const got = full.lines[l[0]]; if (!got) fail('line not shown: ' + l[0]);
    if (got.text !== OPENING.lines[l[0]].text) fail(`line text ${l[0]}: ${got.text}`);
    if (!got.inBar) fail(`line ${l[0]} overflows the bottom bar`);
    const kind = OPENING.lines[l[0]].kind;
    if (got.color !== OPENING.colors[kind]) fail(`line color ${l[0]}: ${got.color}`);
    report.contrast[l[0]] = +contrast(got.color, got.bar).toFixed(2);
    if (report.contrast[l[0]] < 4.5) fail(`contrast ${l[0]} ${report.contrast[l[0]]}`);
  }
  if (report.stage.maxCalls > 300 || report.stage.maxTris > 1.5e6) fail('stage over budget ' + JSON.stringify(report.stage));
  for (const id of ['A', 'B', 'C', 'D']) if (!report.stage.byScene[id]) fail('scene not drawn: ' + id);
  for (const id of SCENE_CHECK) {
    for (const [t, share] of report.vermilion[id] || fail('vermilion not sampled: ' + id)) if (share > 0.2) fail(`vermilion ${id} at ${t}s: ${share}`);
    const f = report.flash[id] || fail('flash not sampled: ' + id); if (f.rate > 3) fail(`flash ${id}: ${f.rate}/s`);
  }
  log('stage by scene', JSON.stringify(report.stage.byScene), 'vermilion', JSON.stringify(report.vermilion), 'flash', JSON.stringify(report.flash));
  // 解放後：谷へ戻り、基準と同じ描画になる。溶け合いの絵も残らない
  const after = await v('(() => { const g = __valley.game; return { stage: !!g.stage, opening: !!g.opening, hold: !!g.post.hold, flow: g.flow }; })()');
  if (after.stage || after.opening || after.hold || after.flow !== 'play') fail('the stage was not released ' + JSON.stringify(after));
  await v('(__valley.game.hud.subsOn = true, 0)');
  await step(40); const back = await gpu(); report.memory.afterFull = back;
  if (back.calls !== base.calls || back.tris !== base.tris) fail(`valley draw differs after the opening: ${JSON.stringify(base)} → ${JSON.stringify(back)}`);
  // 形と画像の数は、ここでは比べない：舞台は谷のモデル（家・寺・荷車など）の複製を描くので、谷のこの画角に映らない共有の形と絵が
  // 初めて送られて残り、測る流れによって増えも減りもする（谷の持ち物で、漏れではない）。漏れは「10 上映を繰り返しても増えない」で、
  // 一度上映したあとの基準と比べて確かめる
  report.memory.firstRunDelta = { geometries: back.geometries - base.geometries, textures: back.textures - base.textures };
  await v('__valley.camera(null)');
  log('full: released, valley draw back to', JSON.stringify(back));

  // 2 2回目の「はじめから」：短い版（再上映）。区間の時刻
  await newRun(false); first = await probe(0);
  if (first.op?.version !== 'short') fail('second opening is not the short version');
  const short = await watch('short'); report.segments.short = short.seen;
  const shortAt = Object.fromEntries(short.seen.map(([s, t]) => [s, t]));
  for (const [seg, want] of [['A', 1], ['D', 4.5], ['title', 8], ['wake', 10.5], ['play', 15.7]]) near(shortAt[seg], want, 0.11, `short: ${seg} starts`);
  if (Object.keys(short.lines).join() !== 'op_n1,op_n6') fail('short lines ' + Object.keys(short.lines));

  // 3 飛ばす：開始0.6秒は効かない。E・Space・クリックのどれでも、0.6秒で暗転→目覚め
  for (const [how, press] of [['E', () => tap('KeyE')], ['Space', () => tap('Space')], ['click', () => click(0)]]) {
    await newRun(false); await step(18);                                  // 0.3秒：まだ効かない
    await press(); let p = await probe(0);
    if (p.op.skipped) fail(`${how}: skip worked before 0.6s`);
    await step(120); await press(); p = await probe(0);                   // 約2.3秒で飛ばす
    if (!p.op.skipped) fail(`${how}: skip was not accepted`);
    let frames = 0; while ((await probe(1)).op?.segment !== 'wake' && frames < 120) frames++;
    near((frames + 1) / 60, 0.6, 0.05, `${how}: from skip to the wake`);
    const w = await probe(0); if (w.nr.on || w.op.stage) fail(`${how}: the stage/narration remained after skipping`);
    p = await probe(60); if (p.flow !== 'intro') fail(`${how}: the wake itself should still play (flow ${p.flow})`);
    await press(); p = await probe(1); if (p.flow !== 'play') fail(`${how}: pressing again after 0.6s of the wake should end it`);
    log('skip by', how, 'ok', (frames + 1) / 60 + 's to the wake');
  }

  // 4 休止からの復帰：オープニング中に P で休止 → 時間が止まる → つづける
  await newRun(false); await step(150);
  const t0 = (await probe(0)).op.t;
  await v("dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyP' }))");
  const paused = await v("({ open: document.getElementById('pause').open, paused: __valley.game.paused, checkpoint: !document.getElementById('pause-checkpoint').classList.contains('hidden') })");
  if (!paused.open || !paused.paused) fail('pause did not open during the opening ' + JSON.stringify(paused));
  if (paused.checkpoint) fail('the checkpoint button should be hidden during the opening');
  await step(90); const t1 = (await probe(0)).op.t;
  if (Math.abs(t1 - t0) > 1e-6) fail(`the opening advanced while paused: ${t0} → ${t1}`);
  await v("document.getElementById('pause-resume').click()");
  await v("new Promise(r => setTimeout(r, 60))");                          // 閉じた知らせ（close）は次の仕事で届く
  if (await v('__valley.game.paused')) fail('the game stayed paused after closing the pause dialog');
  await step(30);
  const t2 = (await probe(0)).op.t; near(t2 - t1, 0.5, 0.05, 'the opening resumes after the pause');
  await tap('KeyE'); await step(80);

  // 5 動きを減らす：場面の間、カメラが止まる（通常は動く）
  const camAt = () => v('(() => { const c = __valley.game.stage.camera.position; return [c.x, c.y, c.z].map(n => +n.toFixed(4)); })()');
  for (const reduced of [false, true]) {
    await v(`(__valley.game.settings.reducedMotion = ${reduced}, 0)`);
    await newRun(false); await step(90); const a = await camAt(), da = await probe(0); await step(150); const b = await camAt(), db = await probe(0);
    if (da.op.segment !== 'A' || db.op.segment !== 'A') fail(`expected scene A of the short version while checking the camera (${da.op.segment}, ${db.op.segment})`);
    const moved = a.some((x, i) => Math.abs(x - b[i]) > 1e-3);
    if (moved === reduced) fail(`reducedMotion=${reduced}: camera moved=${moved} ${a} → ${b}`);
    await tap('KeyE'); await step(80);
  }
  await v('(delete __valley.game.settings.reducedMotion, 0)');

  // 6 続きから：オープニングを出さない。旧保存（見たかの記録が無い）でも出さない
  const save = { schema: 'kamakura-valley-progress', version: 1, savedAt: 1, checkpoint: 'cp_leave_temple', beat: 'b2_road', flags: { plan: null, approach: null, archerJoined: false, ambush: null },
    resources: { food: 60, material: 0, funds: 0, morale: 50 }, trust: 40, party: { archer: { joined: false, hp: 100, mode: 'follow' } }, player: { hp: 100, posture: 100 }, world: { enemies: {} } };
  await v(`(localStorage.setItem('kamakura-valley-progress', ${JSON.stringify(JSON.stringify(save))}), localStorage.removeItem('kamakura-valley-meta'), 0)`);
  await v("(() => { const g = __valley.game; g.stopOpening(); g.flow = 'idle'; })()"); await start('continue'); await step(5);
  let q = await st(); if (q.flow !== 'play' || q.opening || q.beat !== 'b2_road') fail('continue showed the opening ' + JSON.stringify({ flow: q.flow, op: q.opening, beat: q.beat }));
  // 旧保存のまま「はじめから」：記録が無いので通常版
  await newRun(false); if ((await probe(0)).op?.version !== 'full') fail('with an old save and no record, the opening should be the full version');
  await step(60); await tap('KeyE'); await step(80); await tap('KeyE'); await step(5);
  if ((await meta())?.openingSeen !== true) fail('skipping should also record the opening as seen');

  // 7 やり直し：倒れて区切りからやり直しても、オープニングは出ない
  await step(30);
  await v("(() => { const g = __valley.game, f = g.hero.fighter; f.hp = 0; f.alive = false; f.state = 'down'; g.onHeroDown(); })()"); await step(150);
  await v("document.getElementById('death-retry').click()"); await step(90);
  q = await st(); if (q.flow !== 'play' || q.opening || !q.hero.alive) fail('retry showed the opening or did not recover ' + JSON.stringify({ flow: q.flow, op: q.opening }));

  // 8 結果からの「もう一度（最初から）」：短い版で再上映
  await v("(() => { const g = __valley.game; g.showResult(); })()"); await step(5);
  await v("document.getElementById('result-again').click()"); await step(2);
  q = await st(); if (q.flow !== 'intro' || q.opening?.version !== 'short') fail('result → again should replay the short opening ' + JSON.stringify(q.opening));
  await watch('again');
  q = await st(); if (q.flow !== 'play') fail('the replayed opening did not end in play');

  // 9 書けない記録でも止まらない（setItem が例外を出す）
  await v("(() => { localStorage.removeItem('kamakura-valley-meta'); const s = Storage.prototype.setItem; window.__setItem = s; Storage.prototype.setItem = function (k, val) { if (k === 'kamakura-valley-meta') throw new Error('quota'); return s.call(this, k, val); }; })()");
  await newRun(false); await step(60); await tap('KeyE'); await step(80); await tap('KeyE'); await step(5);
  q = await st(); if (q.flow !== 'play') fail('the game stopped when the record could not be written ' + JSON.stringify({ flow: q.flow, op: q.opening }));
  if (await meta() !== null) fail('the record should not exist when writing it failed');
  await v('(Storage.prototype.setItem = window.__setItem, 0)');

  // 10 上映を繰り返しても資源が増えない：谷のカメラを固定し、オープニング無しの基準と、3回上映したあとを比べる
  await fixCam(); await newRun(true); await step(40); const again0 = await gpu();
  for (let k = 0; k < 3; k++) { await newRun(false); await watch('replay ' + (k + 1), { chunk: 30 }); }
  await step(40); report.memory.replays = { before: again0, after: await gpu() };
  const { before: r0, after: r1 } = report.memory.replays;
  if (r1.calls !== r0.calls || r1.tris !== r0.tris || r1.geometries > r0.geometries || r1.textures > r0.textures) fail('GPU resources grew over the replays ' + JSON.stringify(report.memory.replays));
  log('report', JSON.stringify(report));
  if (process.env.KZ_OUT) fs.writeFileSync(process.env.KZ_OUT, JSON.stringify(report, null, 2) + '\n');
}
