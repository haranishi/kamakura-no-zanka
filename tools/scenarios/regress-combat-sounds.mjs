// 回帰：戦いの金属音の形（2026-11-03）。48kHz の OfflineAudioContext で実際の ValleyAudio.play() を描画し（master は音量0.8の素通し）、
// キーン（弾き）・カーン（受け・打ち合い）・ガン（鎧）・カラン（刀が落ちる）・ジッ（火花）と肉の音が、聴き分けの狙いの幅に入ることを数値で縛る。
// 幅は試聴前のたたき台（design-audio.md「戦いの金属音」）。本人の試聴で動かすときは、この表と combat-synth.js を一緒に直す。
// 余韻＝5ms窓のRMSが最大の窓から−40dBを最後に下回るまで。重心＝2048点Hann・hop1024のパワー加重平均。種 0〜7 の全部が幅に入ること。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-combat-sounds.mjs --strict   （約30秒）
const BANDS = {           // [重心Hzの下限, 上限, 余韻msの下限, 上限]
  parry: [1800, 3200, 700, 1600], clash: [1200, 2200, 250, 650], block: [650, 1400, 180, 500],
  hit_armor: [450, 1200, 150, 500], hit_armor_light: [450, 1300, 80, 300], hit_armor_heavy: [380, 1000, 200, 650],
  sword_drop: [1300, 2800, 200, 650], spark: [6000, 14000, 10, 120], hit: [60, 320, 30, 200], hit_heavy: [50, 320, 50, 250],
};
const OPTS = { hit_armor_light: ['hit_armor', { armor: 'light' }] };
const SEEDS = 8;
export default async function ({ v, freeze, start, step, log }) {
  await start('new'); await freeze(true); await step(5);
  const m = await v(`(async () => {
    const { ValleyAudio } = await import('/valley/audio-valley.js');
    const { mulberry32 } = await import('/valley/scatter.js');
    const SR = 48000, BANDS = ${JSON.stringify(BANDS)}, OPTS = ${JSON.stringify(OPTS)};
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
        for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < half; k++) { const a = i + k, b = a + half, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
    }
    const fresh = (off, seed) => { const au = new ValleyAudio(); au.context = off; au.paused = false; au.master = off.createGain(); au.master.gain.value = au.volume; au.master.connect(off.destination); if (seed !== null) au.fxRng = mulberry32(seed); return au; };
    async function render(name, seed, times = [0.05], total = 2.2) {
      const [kind, opts] = OPTS[name] || [name, {}];
      const off = new OfflineAudioContext(1, Math.ceil(SR * total), SR); Object.defineProperty(off, 'state', { get: () => 'running' });
      const au = fresh(off, seed); let ok = true;
      for (const t of times) off.suspend(t).then(() => { ok = au.play(kind, opts) && ok; off.resume(); });
      return { x: (await off.startRendering()).getChannelData(0), ok };
    }
    const db = x => 20 * Math.log10(Math.max(x, 1e-9));
    function analyze(x) {
      let peak = 0, finite = true; for (const s of x) { if (!Number.isFinite(s)) finite = false; peak = Math.max(peak, Math.abs(s)); }
      const W = 2048, H = 1024, hann = Float64Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W)), re = new Float64Array(W), im = new Float64Array(W);
      let pSum = 0, fpSum = 0;
      for (let s = 0; s + W <= x.length; s += H) { let ms = 0; for (let i = 0; i < W; i++) { ms += x[s + i] * x[s + i]; re[i] = x[s + i] * hann[i]; im[i] = 0; } if (ms / W < 1e-12) continue; fft(re, im);
        for (let k = 1; k < W / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; pSum += p; fpSum += p * k * SR / W; } }
      const E = 240, env = []; for (let s = 0; s + E <= x.length; s += E) { let q = 0; for (let i = 0; i < E; i++) q += x[s + i] * x[s + i]; env.push(db(Math.sqrt(q / E))); }
      const top = Math.max(...env), at = env.indexOf(top); let last = at; for (let i = at; i < env.length; i++) if (env[i] >= top - 40) last = i;
      return { peak: db(peak), finite, centroid: pSum > 0 ? fpSum / pSum : 0, tail: (last - at + 1) * E / SR * 1000 };
    }
    const rows = {};
    for (const name of Object.keys(BANDS)) { rows[name] = []; for (let s = 0; s < ${SEEDS}; s++) { const r = await render(name, s); rows[name].push({ ...analyze(r.x), ok: r.ok }); } }
    // 決定性：同じ種の再描画は全標本が一致。揺らぎ：同じ音を4回続けたとき、鳴り（部分音）が4回とも違う
    const a = await render('parry', 3), b = await render('parry', 3); let same = 0; for (let i = 0; i < a.x.length; i++) same = Math.max(same, Math.abs(a.x[i] - b.x[i]));
    const seq = (await render('block', 1, [0.05, 0.65, 1.25, 1.85], 2.6)).x, seg = i => seq.subarray(Math.round((0.12 + 0.6 * i) * SR), Math.round((0.12 + 0.6 * i) * SR) + 4800);   // 打撃の70ms後から：ノイズ（クリック・火花）が消えた後の鳴りだけを比べる
    let minDiff = Infinity; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) { let d = 0; const p = seg(i), q = seg(j); for (let k = 0; k < p.length; k++) d += (p[k] - q[k]) ** 2; minDiff = Math.min(minDiff, Math.sqrt(d / p.length)); }
    // 同時数：同じ時刻に40回鳴らしても束は28まで（29回目からは false）。余韻が終われば（最長約2秒）登録は0に戻る
    const off = new OfflineAudioContext(1, SR, SR); Object.defineProperty(off, 'state', { get: () => 'running' });
    const au = fresh(off, 1); let okN = 0; for (let i = 0; i < 40; i++) okN += au.play(['parry', 'block', 'hit_armor_heavy', 'sword_drop', 'spark'][i % 5]) ? 1 : 0;
    const peakSources = au.sources.size; await new Promise(r => setTimeout(r, 2600));
    return { rows, same, minDiff, okN, peakSources, after: au.sources.size };
  })()`);
  const bad = [], f = x => x.toFixed(0), mean = a => a.reduce((s, x) => s + x, 0) / a.length;
  log('種類              ピーク(dBFS)        重心Hz(min..max)      余韻ms(min..max)');
  for (const [name, [c0, c1, t0, t1]] of Object.entries(BANDS)) {
    const r = m.rows[name], P = r.map(x => x.peak), C = r.map(x => x.centroid), T = r.map(x => x.tail);
    log(`${name.padEnd(16)} ${Math.min(...P).toFixed(1)}..${Math.max(...P).toFixed(1)}   ${f(mean(C))} (${f(Math.min(...C))}..${f(Math.max(...C))})   ${f(mean(T))} (${f(Math.min(...T))}..${f(Math.max(...T))})`);
    if (!r.every(x => x.ok && x.finite)) bad.push(`${name}: 鳴らせない／NaN`);
    if (Math.min(...P) < -32 || Math.max(...P) > -3) bad.push(`${name}: ピーク ${Math.min(...P).toFixed(1)}..${Math.max(...P).toFixed(1)} が −32..−3 の外`);
    if (Math.min(...C) < c0 || Math.max(...C) > c1) bad.push(`${name}: 重心 ${f(Math.min(...C))}..${f(Math.max(...C))}Hz が ${c0}..${c1} の外`);
    if (Math.min(...T) < t0 || Math.max(...T) > t1) bad.push(`${name}: 余韻 ${f(Math.min(...T))}..${f(Math.max(...T))}ms が ${t0}..${t1} の外`);
  }
  // 種類どうしの差（平均）：聴き分けの下限
  const C = n => mean(m.rows[n].map(x => x.centroid)), T = n => mean(m.rows[n].map(x => x.tail));
  const gaps = [['キーン > カーン(受け) 重心', C('parry') - C('block'), 800], ['キーン > カーン(受け) 余韻', T('parry') - 2 * T('block'), 0], ['カーン(打ち合い) > カーン(受け) 重心', C('clash') - C('block'), 300],
    ['カーン(受け) > ガン 重心', C('block') - C('hit_armor'), 150], ['ガン > 肉 重心', C('hit_armor') - C('hit'), 300], ['ガン(軽) 余韻 < ガン 余韻', T('hit_armor') - T('hit_armor_light'), 60]];
  for (const [label, gap, min] of gaps) { log(`差 ${label}: ${f(gap)}（下限 ${min}）`); if (!(gap >= min)) bad.push(`差 ${label} が ${f(gap)}（下限 ${min}）`); }
  log(`決定性 最大差 ${m.same.toExponential(2)} / 4回続けた受けの最小のRMS差 ${m.minDiff.toExponential(2)} / 40回同時 成功 ${m.okN}・束 ${m.peakSources}・2.6秒後 ${m.after}`);
  if (!(m.same <= 1e-6)) bad.push(`同じ種の再描画が一致しない（${m.same}）`);
  if (!(m.minDiff > 1e-3)) bad.push(`同じ音が続けて同じ形（機関銃のよう。最小差 ${m.minDiff}）`);
  if (m.okN !== 28 || m.peakSources > 28) bad.push(`同時数の上限が守られない（成功 ${m.okN}・束 ${m.peakSources}）`);
  if (m.after !== 0) bad.push(`余韻のあとも束が残る（${m.after}）`);
  if (bad.length) throw new Error('combat sounds out of range:\n  ' + bad.join('\n  '));
}
