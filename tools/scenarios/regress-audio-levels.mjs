// 回帰：効果音の音量。最後の圧縮器（limiter）の出力に AnalyserNode をつなぎ、各音のピーク（dBFS）を測る。
// 以前は音ごとの大きさが揃っておらず、足音が聞こえない（−45dB以下）一方で、戦闘の音を重ねると 0dBFS を超えて割れた。
// 実行：PLAYWRIGHT_MODULE=… node tools/valley-play.mjs tools/scenarios/regress-audio-levels.mjs --strict
// 音の出ない環境（AudioContext が running にならない）では、測れないので何も確かめずに終わる。
const SINGLE = { min: -32, max: -3 };          // 1つずつ鳴らしたピーク：小さすぎて聞こえない／大きすぎる、を弾く
const KINDS = ['swing', 'swing_heavy', 'hit', 'hit_heavy', 'clash', 'block', 'parry', 'hurt', 'die', 'bow_draw', 'bow_release', 'arrow_hit', 'taiko', 'bell', 'alert',
  'step_grass', 'step_dirt', 'step_gravel', 'step_wood', 'roll', 'draw', 'sheathe', 'ui', 'dialogue'];
const MIXED = ['hit_heavy', 'clash', 'parry', 'hurt', 'taiko', 'bow_release'];       // 戦闘のつもりで一度に鳴らす

export default async function ({ v, freeze, start, step, log, wait }) {
  await start('new'); await freeze(true); await step(10);
  await v(`(async () => { const a = __valley.game.audio; if (a.context && a.context.state !== 'running') { try { await a.context.resume(); } catch {} } return a.context && a.context.state; })()`);
  const state = await v("__valley.game.audio.context ? __valley.game.audio.context.state : 'no-context'");
  if (state !== 'running') { log('audio context is not running here; levels were not measured'); return; }
  await v(`(() => {
    const a = __valley.game.audio; a.ensureMaster();
    const an = a.context.createAnalyser(); an.fftSize = 2048; a.limiter.connect(an);
    const buf = new Float32Array(an.fftSize);
    window.__peak = () => { an.getFloatTimeDomainData(buf); let m = 0; for (const x of buf) m = Math.max(m, Math.abs(x)); return m; };
    window.__measure = (kinds, ms) => new Promise(done => {
      let max = 0; const timer = setInterval(() => { max = Math.max(max, window.__peak()); }, 8);
      for (const k of kinds) a.play(k);
      setTimeout(() => { clearInterval(timer); done(max); }, ms);
    });
  })()`);
  const db = p => 20 * Math.log10(Math.max(p, 1e-6));
  const bad = [], rows = [];
  for (const k of KINDS) {
    const d = db(await v(`window.__measure(['${k}'], 700)`)); rows.push(`${k}:${d.toFixed(1)}`);
    if (d < SINGLE.min || d > SINGLE.max) bad.push(`${k} ${d.toFixed(1)}dBFS (want ${SINGLE.min}..${SINGLE.max})`);
    await wait(150);
  }
  log(rows.join('  '));
  // 重ねても割れない：戦闘の6音、さらに全種類を2回ずつ（乱戦の最悪を超える重ね方。limiter が無いと 0dBFS を超える）
  const mixed = await v(`window.__measure(${JSON.stringify(MIXED)}, 700)`);
  const worst = await v(`window.__measure(${JSON.stringify([...KINDS, ...KINDS])}, 900)`);
  log('six at once peak dBFS', db(mixed).toFixed(1), ' every kind twice', db(worst).toFixed(1));
  if (mixed >= 0.99) bad.push(`six sounds at once clip (${db(mixed).toFixed(1)}dBFS)`);
  if (worst >= 0.99) bad.push(`every sound twice at once clips (${db(worst).toFixed(1)}dBFS)`);
  if (bad.length) throw new Error('audio levels out of range: ' + bad.join('; '));
}
