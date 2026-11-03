// 試聴用：戦いの効果音を、音の出る装置に頼らず 48kHz の OfflineAudioContext で書き出す（WAV・数値・スペクトログラム）。
// 実際の ValleyAudio.play() を使い、master だけを「音量0.8の素通し」に差し替える（圧縮器とリミッターを通さない＝合成そのものの形を比べる）。
// 変更の前後を同じ道具で書き出して並べるために作った（2026-11-03・戦いの金属音）。前の版に無い種類は無音になり「absent」と記録する。
//   PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/capture-combat-sounds.mjs --out <フォルダ>   （約20秒）
// 出力: <名前>.wav（1発）・<名前>_x4.wav（同じ音を4回続けて。毎回の揺らぎを聴く）・sounds.json（ピーク・RMS・重心・余韻）・spectrogram.png
// 余韻の長さ＝5ms窓のRMSが、最大の窓から−40dBを最後に下回るまでの時間（ピークの窓から数える）。重心は2048点Hann・hop1024のパワー加重平均。
import fs from 'node:fs';
import path from 'node:path';

const SPECS = [
  ['parry', 'parry', {}], ['block', 'block', {}], ['clash', 'clash', {}],
  ['hit_armor', 'hit_armor', { armor: 'heavy' }], ['hit_armor_light', 'hit_armor', { armor: 'light' }], ['hit_armor_heavy', 'hit_armor_heavy', { armor: 'heavy' }],
  ['hit', 'hit', {}], ['hit_heavy', 'hit_heavy', {}], ['arrow_hit', 'arrow_hit', {}], ['sword_drop', 'sword_drop', {}], ['spark', 'spark', {}],
];

function wav(samples, sr) {
  const n = samples.length, b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0); b.writeUInt32LE(36 + n * 2, 4); b.write('WAVE', 8); b.write('fmt ', 12); b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(sr, 24); b.writeUInt32LE(sr * 2, 28); b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34); b.write('data', 36); b.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) b.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), 44 + i * 2);
  return b;
}

export default async function ({ v, freeze, start, step, log, out }) {
  await start('new'); await freeze(true); await step(5);
  const res = await v(`(async () => {
    const { ValleyAudio } = await import('/valley/audio-valley.js');
    const SR = 48000, SPECS = ${JSON.stringify(SPECS)};
    function fft(re, im) {
      const n = re.length;
      for (let i = 1, j = 0; i < n; i++) { let bit = n >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
      for (let len = 2; len <= n; len <<= 1) { const ang = -2 * Math.PI / len, wr = Math.cos(ang), wi = Math.sin(ang), half = len >> 1;
        for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < half; k++) { const a = i + k, b = a + half, vr = re[b] * cr - im[b] * ci, vi = re[b] * ci + im[b] * cr; re[b] = re[a] - vr; im[b] = im[a] - vi; re[a] += vr; im[a] += vi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
    }
    async function render(kind, opts, times, total) {
      const off = new OfflineAudioContext(1, Math.ceil(SR * total), SR); Object.defineProperty(off, 'state', { get: () => 'running' });
      const au = new ValleyAudio(); au.context = off; au.paused = false;
      au.master = off.createGain(); au.master.gain.value = au.volume; au.master.connect(off.destination);
      for (const t of times) off.suspend(t).then(() => { au.play(kind, opts); off.resume(); });
      return (await off.startRendering()).getChannelData(0);
    }
    const db = x => 20 * Math.log10(Math.max(x, 1e-9));
    function analyze(x) {
      let peak = 0; for (const s of x) peak = Math.max(peak, Math.abs(s));
      const W = 2048, H = 1024, hann = Float64Array.from({ length: W }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / W)), re = new Float64Array(W), im = new Float64Array(W);
      let msSum = 0, wins = 0, pSum = 0, fpSum = 0;
      for (let s = 0; s + W <= x.length; s += H) {
        let ms = 0; for (let i = 0; i < W; i++) { ms += x[s + i] * x[s + i]; re[i] = x[s + i] * hann[i]; im[i] = 0; }
        ms /= W; if (ms < 1e-12) continue; msSum += ms; wins++; fft(re, im);
        for (let k = 1; k < W / 2; k++) { const p = re[k] * re[k] + im[k] * im[k]; pSum += p; fpSum += p * k * SR / W; }
      }
      const E = 240, env = []; for (let s = 0; s + E <= x.length; s += E) { let m = 0; for (let i = 0; i < E; i++) m += x[s + i] * x[s + i]; env.push(db(Math.sqrt(m / E))); }
      const top = Math.max(...env), at = env.indexOf(top); let last = at; for (let i = at; i < env.length; i++) if (env[i] >= top - 40) last = i;
      return { peak: db(peak), rms: db(Math.sqrt(msSum / Math.max(1, wins))), centroid: pSum > 0 ? fpSum / pSum : 0, tail40ms: (last - at + 1) * E / SR * 1000, finite: x.every(Number.isFinite) };
    }
    const b64 = x => { const u = new Uint8Array(x.buffer.slice(0)); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); };
    const rows = [], singles = [];
    for (const [name, kind, opts] of SPECS) {
      const one = await render(kind, opts, [0.05], 2.2), m = analyze(one);
      if (m.peak < -120) { rows.push({ name, kind, absent: true }); continue; }
      const seq = await render(kind, opts, [0.05, 0.75, 1.45, 2.15], 4.2);
      rows.push({ name, kind, opts, ...m }); singles.push([name, one]);
      rows.at(-1).wav = b64(one); rows.at(-1).wav4 = b64(seq);
    }
    // スペクトログラム（0〜1.6秒 × 0〜12kHz、線形。全パネル共通の基準で −90〜0 dB）
    const PW = 600, PH = 230, cols = 2, rowsN = Math.ceil(singles.length / cols), cv = document.createElement('canvas');
    cv.width = cols * PW + 30; cv.height = rowsN * (PH + 28) + 10; const c = cv.getContext('2d'); c.fillStyle = '#111'; c.fillRect(0, 0, cv.width, cv.height);
    const N = 1024, HOP = 128, FMAX = 12000, bins = Math.floor(FMAX / (SR / N)), hann = Float64Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / N));
    const specs = singles.map(([name, x]) => { const frames = []; const re = new Float64Array(N), im = new Float64Array(N);
      for (let s = 0; s + N <= Math.min(x.length, SR * 1.6 + N); s += HOP) { for (let i = 0; i < N; i++) { re[i] = x[s + i] * hann[i]; im[i] = 0; } fft(re, im); const f = new Float32Array(bins); for (let k = 0; k < bins; k++) f[k] = db(Math.hypot(re[k], im[k])); frames.push(f); }
      return [name, frames]; });
    let gmax = -999; for (const [, fr] of specs) for (const f of fr) for (const y of f) gmax = Math.max(gmax, y);
    const col = t => { t = Math.max(0, Math.min(1, t)); return [Math.round(255 * Math.min(1, t * 1.6)), Math.round(255 * Math.max(0, Math.min(1, (t - 0.35) * 1.6))), Math.round(255 * Math.max(0, (t - 0.75) * 4))]; };
    specs.forEach(([name, fr], idx) => {
      const ox = 20 + (idx % cols) * PW, oy = 24 + Math.floor(idx / cols) * (PH + 28), img = c.createImageData(PW - 20, PH);
      for (let px = 0; px < PW - 20; px++) { const f = fr[Math.min(fr.length - 1, Math.floor(px / (PW - 20) * fr.length))];
        for (let py = 0; py < PH; py++) { const k = Math.floor((1 - py / PH) * (bins - 1)), [r, g, b] = col((f[k] - gmax + 90) / 90), o = (py * (PW - 20) + px) * 4; img.data[o] = r; img.data[o + 1] = g; img.data[o + 2] = b; img.data[o + 3] = 255; } }
      c.putImageData(img, ox, oy); c.fillStyle = '#eee'; c.font = '14px sans-serif'; c.fillText(name + '   (0–1.6 s, 0–12 kHz)', ox, oy - 6);
      c.fillStyle = '#888'; c.font = '10px sans-serif'; for (const hz of [2000, 4000, 6000, 8000, 10000]) c.fillText(hz / 1000 + 'k', ox - 18, oy + PH * (1 - hz / FMAX) + 3);
    });
    return { rows, png: cv.toDataURL('image/png').split(',')[1] };
  })()`);
  fs.mkdirSync(out, { recursive: true });
  for (const r of res.rows) {
    if (r.absent) { log(`${r.name.padEnd(16)} absent`); continue; }
    const f32 = b => new Float32Array(new Uint8Array(Buffer.from(b, 'base64')).buffer);
    fs.writeFileSync(path.join(out, r.name + '.wav'), wav(f32(r.wav), 48000)); fs.writeFileSync(path.join(out, r.name + '_x4.wav'), wav(f32(r.wav4), 48000));
    delete r.wav; delete r.wav4;
    log(`${r.name.padEnd(16)} peak ${r.peak.toFixed(1)}  rms ${r.rms.toFixed(1)}  centroid ${r.centroid.toFixed(0)}Hz  tail(-40dB) ${r.tail40ms.toFixed(0)}ms  finite ${r.finite}`);
  }
  fs.writeFileSync(path.join(out, 'sounds.json'), JSON.stringify(res.rows, null, 1));
  fs.writeFileSync(path.join(out, 'spectrogram.png'), Buffer.from(res.png, 'base64'));
}
