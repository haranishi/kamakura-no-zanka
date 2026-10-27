import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { judgeAll } from '../dist/valley/perf-stats.js';
const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2), i = args.indexOf('--out');
const out = path.resolve(i >= 0 ? args[i + 1] : '.captures/perf-before');
await fs.mkdir(out, { recursive: true });
await fs.rm(path.join(out, 'judgement.json'), { force: true });
const runs = [];
// design-validation.mdの仕様値：標準/軽量×移動/戦闘×別初期状態2回。各回は別Chromeプロセス。
for (const quality of ['standard', 'light']) for (const scene of ['move', 'combat']) for (const run of [1, 2]) {
  const folder = path.join(out, `${quality}-${scene}-${run}`), file = path.join(folder, 'samples.json');
  await fs.mkdir(folder, { recursive: true });
  await fs.rm(file, { force: true }); // 失敗時に以前の成功標本を拾わない
  const code = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ['tools/valley-play.mjs', 'tools/scenarios/measure-perf.mjs', '--q', quality, '--w', '1280', '--h', '720', '--seed', '1333', '--intro', '0', '--strict', '--out', folder],
      { cwd: root, env: { ...process.env, PERF_SCENE: scene, PERF_RUN: String(run) }, stdio: 'inherit' });
    child.once('error', reject); child.once('exit', code => resolve(code));
  });
  if (code !== 0) throw Error(`${quality}/${scene}/${run} failed (${code}); all-eight judgement not produced`);
  const result = JSON.parse(await fs.readFile(file, 'utf8'));
  if (result.quality !== quality || result.scene !== scene || result.run !== run || result.samples.frames !== 1800 || result.samples.ms.length !== 1800) throw Error('run identity or frame count mismatch');
  runs.push({ quality, scene, run, ...result.samples });
}
const judgement = judgeAll(runs);
await fs.writeFile(path.join(out, 'judgement.json'), JSON.stringify({ scope: '記録した環境のみ。他端末へ当てはめない。', ...judgement }, null, 2) + '\n');
console.log(JSON.stringify(judgement, null, 2));
if (!judgement.pass) process.exitCode = 1;
