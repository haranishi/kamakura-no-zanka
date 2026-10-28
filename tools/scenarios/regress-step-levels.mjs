// 回帰：足音の大きさと音色。48kHzのOfflineAudioContextで、実際の playStep を master → 圧縮器 → limiter まで通して描画し、全標本を測る。
// なぜ作ったか（2026-10-27）: 足音の合成は、耳で調整する前に「聞こえる・割れない・面が区別できる」を数値で縛る必要があった。
// 測り方の罠: 圧縮器は、無音のあとの最初の音を約20dB小さく通す（暖まっていない）。1歩だけ描画すると全部が約18dB小さく見え、
//   その値で補正したら、実機の連続した足音は天井(−0.4dBFS)に張り付いた。必ず捨て石の1歩を先頭に置き、連続した足音（0.45秒おき）で測る。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-step-levels.mjs --strict   （約2分）
//   補正量の計算だけ見る：STEP_CALIBRATE=1 を付ける（合否の判定はしない）。
// 設計書（design-validation.md）の窓：2048点Hann・hop1024・seed 0〜15・無音窓は除外。RMSの帯と屈みの下端は実測で設計と合わなかったので参考値として出す。
const TARGET = { walk: -21, run: -16, crouch: -29 };      // 暖まった出力の平均ピーク(dBFS)。設計書の目標は−22/−16/−32。屈みを−32にすると、ばらつきで約半数が帯の下端−32を割る
const TOLERANCE = 2.5;
const CALIBRATE = !!process.env.STEP_CALIBRATE;
export default async function ({ v, freeze, start, step, log }) {
  await start('new'); await freeze(true); await step(5);
  const m = await v(`(async () => {
    const { ValleyAudio } = await import('/valley/audio-valley.js');
    const rules = await import('/valley/audio-rules.js');
    const { mulberry32 } = await import('/valley/scatter.js');
    const { stepLayers } = await import('/valley/step-synth.js');
    const SR = 48000, WIN = 2048, HOP = 1024, SEEDS = 16, GAP = 0.45, T0 = 0.3;
    const hann = Float64Array.from({ length: WIN }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / WIN));
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) {
        const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
        for (let i = 0; i < n; i += len) { let cr = 1, ci = 0;
          for (let k = 0; k < half; k++) { const a = i + k, b = a + half, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } }
      }
    }
    // items: [{ t, steps:[{ step, opts }] }]。時刻 t に一斉に鳴らす。
    async function renderItems(items, total) {
      const off = new OfflineAudioContext(2, Math.ceil(SR * total), SR); Object.defineProperty(off, 'state', { get: () => 'running' });
      const au = new ValleyAudio(); au.context = off; au.paused = false;
      let ok = true;
      for (const it of items) off.suspend(it.t).then(() => { for (const s of it.steps) ok = au.playStep(s.step, s.opts || {}) && ok; off.resume(); });
      return { buf: await off.startRendering(), ok };
    }
    const db = x => 20 * Math.log10(Math.max(x, 1e-9));
    function analyze(buf, t0, t1) {
      const L = buf.getChannelData(0).subarray(Math.round(t0 * SR), Math.round(t1 * SR)), R = buf.getChannelData(1).subarray(Math.round(t0 * SR), Math.round(t1 * SR));
      let peak = 0; for (let i = 0; i < L.length; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
      let msSum = 0, wins = 0, pSum = 0, fpSum = 0;
      const re = new Float64Array(WIN), im = new Float64Array(WIN);
      for (let s = 0; s + WIN <= L.length; s += HOP) {
        let ms = 0; for (let i = 0; i < WIN; i++) { const x = L[s + i]; ms += x * x; re[i] = x * hann[i]; im[i] = 0; }
        ms /= WIN; if (ms < 1e-12) continue;
        msSum += ms; wins++; fft(re, im);
        for (let k = 1; k < WIN / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; pSum += p; fpSum += p * (k * SR / WIN); }
      }
      return { peak: db(peak), rms: db(Math.sqrt(msSum / Math.max(1, wins))), centroid: pSum > 0 ? fpSum / pSum : 0 };
    }
    const mean = a => a.reduce((s, x) => s + x, 0) / a.length;
    const mk = (surface, gait, role, foot, seed) => rules.pickStep({ surface, gait, role, foot }, mulberry32(seed), null);
    // 捨て石の1歩 + 本番の 2×seeds 歩を、0.45秒おきに連続して鳴らし、本番の各1歩の区間を測る。
    async function sample(surface, gait, role, seeds) {
      const steps = [mk(surface, gait, role, 'left', 99999)];
      for (let s = 0; s < seeds; s++) for (const foot of ['left', 'right']) steps.push(mk(surface, gait, role, foot, 1000 + s * 31 + (foot === 'right' ? 7 : 0)));
      const { buf, ok } = await renderItems(steps.map((st, i) => ({ t: T0 + i * GAP, steps: [{ step: st }] })), T0 + steps.length * GAP + 0.5);
      if (!ok) throw new Error('playStep failed ' + [surface, gait, role].join('/'));
      return steps.slice(1).map((st, i) => ({ ...analyze(buf, T0 + (i + 1) * GAP, T0 + (i + 2) * GAP), grains: stepLayers(st).filter(l => l.type === 'grain').length, expectGrains: Math.round(st.recipe.material.grains[0] * st.recipe.density) }));
    }
    const cells = {}, grainBad = [];
    for (const surface of rules.SURFACES) for (const gait of ['walk', 'run', 'crouch']) {
      const rows = await sample(surface, gait, 'hero', SEEDS);
      for (const r of rows) if (r.grains !== r.expectGrains) grainBad.push([surface, gait]);
      cells[surface + '/' + gait] = { peakMean: mean(rows.map(r => r.peak)), peakMin: Math.min(...rows.map(r => r.peak)), peakMax: Math.max(...rows.map(r => r.peak)), below32: rows.filter(r => r.peak < -32).length, rmsMean: mean(rows.map(r => r.rms)), centroid: mean(rows.map(r => r.centroid)), n: rows.length };
    }
    const roles = {};
    for (const role of rules.ROLES) { const rows = await sample('dirt', 'walk', role, 4); roles[role] = mean(rows.map(r => r.peak)); }
    // 決定性: 同じ並びを2回描画して全標本を比べる
    const seq3 = [mk('gravel', 'run', 'hero', 'left', 1), mk('gravel', 'run', 'hero', 'right', 5), mk('dirt', 'walk', 'hero', 'left', 7)].map((st, i) => ({ t: T0 + i * GAP, steps: [{ step: st }] }));
    const a = await renderItems(seq3, 2), b = await renderItems(seq3, 2); let diff = 0;
    for (const ch of [0, 1]) { const x = a.buf.getChannelData(ch), y = b.buf.getChannelData(ch); for (let i = 0; i < x.length; i++) diff = Math.max(diff, Math.abs(x[i] - y[i])); }
    // 距離: 捨て石 → 距離0の敵 → 10m離れた敵（同じ1歩）
    const enemy = mk('dirt', 'walk', 'enemy_light', 'left', 9), d10 = rules.distanceRule(10);
    const dist = await renderItems([{ t: T0, steps: [{ step: mk('dirt', 'walk', 'enemy_light', 'right', 3) }] }, { t: T0 + GAP, steps: [{ step: enemy }] }, { t: T0 + 2 * GAP, steps: [{ step: enemy, opts: { gainScale: d10.gain, lowpassHz: d10.lowpassHz } }] }], 2);
    const peak0 = analyze(dist.buf, T0 + GAP, T0 + 2 * GAP).peak, peak10 = analyze(dist.buf, T0 + 2 * GAP, T0 + 3 * GAP).peak;
    // 重ね合わせ: 暖めたあと、主人公の走り + 敵3人の走り + 村人2人の歩きを同時に
    const mixSteps = [['hero', 'run', 0], ['enemy_light', 'run', 3], ['enemy_light', 'run', 5], ['enemy_heavy', 'run', 6], ['villager', 'walk', 4], ['villager', 'walk', 8]].map(([role, gait, d], i) => ({ step: mk('dirt', gait, role, i % 2 ? 'right' : 'left', 77 + i), opts: d ? { gainScale: rules.distanceRule(d).gain, lowpassHz: rules.distanceRule(d).lowpassHz } : {} }));
    const mix = await renderItems([{ t: T0, steps: [mixSteps[0]] }, { t: T0 + GAP, steps: [mixSteps[1]] }, { t: T0 + 2 * GAP, steps: mixSteps }], 2.2);
    return { cells, roles, grainBad: grainBad.length, diff, peak0, peak10, mixOk: mix.ok, mixPeak: analyze(mix.buf, T0 + 2 * GAP, T0 + 3 * GAP).peak };
  })()`);
  const f = (x, d = 1) => x.toFixed(d), bad = [];
  const surfaces = [...new Set(Object.keys(m.cells).map(k => k.split('/')[0]))];
  log('面/歩容        平均ピーク(min..max)      帯−32を割った数   RMS平均   重心Hz');
  for (const sf of surfaces) for (const g of Object.keys(TARGET)) {
    const c = m.cells[sf + '/' + g];
    log(`${(sf + '/' + g).padEnd(14)} ${f(c.peakMean).padStart(6)} (${f(c.peakMin)}..${f(c.peakMax)})   ${String(c.below32).padStart(2)}/${c.n}   ${f(c.rmsMean).padStart(6)}   ${f(c.centroid, 0).padStart(5)}`);
    if (Math.abs(c.peakMean - TARGET[g]) > TOLERANCE) bad.push(`${sf}/${g} の平均ピーク ${f(c.peakMean)} dBFS（目標 ${TARGET[g]}±${TOLERANCE}）`);
    if (c.peakMax > -3) bad.push(`${sf}/${g} の最大ピーク ${f(c.peakMax)} dBFS（上限 −3）`);
    if (c.peakMin < -40) bad.push(`${sf}/${g} の最小ピーク ${f(c.peakMin)} dBFS（聞こえない外れ値。下限 −40）`);
  }
  if (CALIBRATE) {
    // ピークは暖まった出力で線形に倍率へ比例する（天井の手前まで）。歩容ごとの目標との差の平均を、面ごとに求める。
    const corr = {}; for (const sf of surfaces) corr[sf] = Object.keys(TARGET).reduce((s, g) => s + TARGET[g] - m.cells[sf + '/' + g].peakMean, 0) / 3;
    const G = surfaces.reduce((s, sf) => s + corr[sf], 0) / surfaces.length;
    log('補正(dB)', JSON.stringify(Object.fromEntries(surfaces.map(sf => [sf, +f(corr[sf])]))), '共通分 G', f(G));
    log('level(相対)', JSON.stringify(Object.fromEntries(surfaces.map(sf => [sf, +(10 ** ((corr[sf] - G) / 20)).toFixed(3)]))), ' LEVEL.step の新しい値 = 現在値 ×', (10 ** (G / 20)).toFixed(3));
    return;
  }
  for (const sf of surfaces) {
    const p = g => m.cells[sf + '/' + g].peakMean;
    if (!(p('run') - p('walk') >= 3 && p('walk') - p('crouch') >= 3)) bad.push(`${sf} の順が 走り＞歩き＞屈み（各3dB以上）でない: ${f(p('run'))} / ${f(p('walk'))} / ${f(p('crouch'))}`);
  }
  const cent = sf => Object.keys(TARGET).reduce((s, g) => s + m.cells[sf + '/' + g].centroid, 0) / 3;
  const order = ['gravel', 'leaves', 'dirt', 'grass'];
  log('4面の平均重心(Hz):', order.map(sf => `${sf} ${f(cent(sf), 0)}`).join(' > '));
  for (let i = 0; i < 3; i++) if (!(cent(order[i]) - cent(order[i + 1]) >= 150)) bad.push(`重心の順 ${order[i]} > ${order[i + 1]} が150Hz以上離れていない（${f(cent(order[i]), 0)} / ${f(cent(order[i + 1]), 0)}）`);
  const total = Object.values(m.cells).reduce((s, c) => s + c.n, 0), below = Object.values(m.cells).reduce((s, c) => s + c.below32, 0);
  const rmsAll = Object.values(m.cells).map(c => c.rmsMean);
  log(`参考（設計書の帯と合わない所）: 単発ピークが−32を割った標本 ${below}/${total}（屈みに集中）/ 面×歩容の平均RMS ${f(Math.min(...rmsAll))}..${f(Math.max(...rmsAll))} dBFS（設計書の帯 −45..−6）`);
  log('役割ごとの平均ピーク(土・歩き):', JSON.stringify(Object.fromEntries(Object.entries(m.roles).map(([k, x]) => [k, +f(x)]))));
  if (!(m.roles.enemy_heavy > m.roles.hero)) bad.push(`重い装備の敵が主人公より大きくない（${f(m.roles.enemy_heavy)} / ${f(m.roles.hero)}）`);
  log(`粒数の不一致 ${m.grainBad} / 決定性 最大差 ${m.diff.toExponential(2)} / 敵10m ${f(m.peak0)} → ${f(m.peak10)} dBFS / 6人同時のピーク ${f(m.mixPeak)} dBFS`);
  if (m.grainBad) bad.push(`粒の数が recipe と合わない: ${m.grainBad} 件`);
  if (!(m.diff <= 1e-6)) bad.push(`同じ入力の再描画が一致しない（最大差 ${m.diff}）`);
  if (!(m.peak0 - m.peak10 >= 6)) bad.push(`10m離れた敵が6dB以上小さくならない（${f(m.peak0)} → ${f(m.peak10)}）`);
  if (!m.mixOk || m.mixPeak >= -0.09) bad.push(`6人が同時に走ると割れる／発音できない（${f(m.mixPeak)} dBFS）`);
  if (bad.length) throw new Error('step levels out of range:\n  ' + bad.join('\n  '));
}
