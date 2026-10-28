// なぜ失敗したか: assertionによる退行の検出を構文・import失敗と区別し、元のバイト列を復元する。
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const rules = 'dist/valley/tree-species.js', config = 'dist/valley/config.js';
const cases = [
  ['grove replaced by independent random', rules, 'grove: 0.8 * field(world, x, z, f.grove, s.grove) + 0.2 * field(world, x, z, f.detail, s.detail)', 'grove: positionRand(world, x, z)()'],
  ['zero conversion', config, 'probability: 0.97', 'probability: 0'],
  ['unconditional conversion probability', config, 'probability: 0.97', 'probability: 1'],
  ['habitat weight removed', config, 'habitatWeight: 0.30', 'habitatWeight: 0'],
  ['shared stage field removed', rules, 'stage: field(world, x, z, f.stage, s.stage)', 'stage: 0.5'],
  ['independent stage field', rules, 'stage: field(world, x, z, f.stage, s.stage)', 'stage: positionRand(world, x, z)()'],
  ['water exclusion removed', rules, 'if (terrain.waterAt(x, z) > 0.02)', 'if (false)'],
  ['road exclusion removed', rules, 'if (roadDistance < 2.2)', 'if (false)'],
  ['building exclusion removed', rules, 'if (world.buildings.some(b => insideFootprint(b, x, z, 2)))', 'if (false)'],
  ['rock exclusion removed', rules, 'if (rockCircles.some(r => Math.hypot(x - r.x, z - r.z) < r.r + 0.5))', 'if (false)'],
  ['trunk exclusion removed', rules, 'if (nearTrunk(x, z))', 'if (false)'],
  ['slope exclusion removed', rules, 'if (terrain.slopeAt(x, z, 1.5) > 40)', 'if (false)'],
  ['river exclusion removed', rules, 'if (river.d < 6)', 'if (false)'],
  ['position key replaced by ordinal', rules, 'const x = trees.x[i], z = trees.z[i], f =', 'const x = i, z = 0, f ='],
  ['understory caps removed', rules, 'if (count >= cfg.maxCount)', 'if (false)'],
  ['sapling cap raised', config, 'maxCount: 1200', 'maxCount: 12000'],
  ['shrub cap raised', config, 'maxCount: 4000', 'maxCount: 40000'],
  ['random stream overlaps grass', config, 'grove: 51001', 'grove: 19391'],
  ['plot exclusion removed', rules, 'if ((world.plots || []).some(p => insidePlot(p, x, z, 1.5)))', 'if (false)'],
  ['remove adult seasonal jitter', rules, '(positionRand(world, x, z)() - 0.5) * 40 / 255', '0'],
  ['remove understory seasonal jitter', rules, '(rng() - 0.5) * 40 / 255', '0'],
];
const run = () => spawnSync(process.execPath, ['--test', 'tests/valley-tree-species.test.mjs'], {encoding:'utf8',timeout:30000});
const originals = new Map([rules,config].map(file=>[file,fs.readFileSync(file)]));
const requirePass = label => {const r=run();if(r.status!==0)throw Error(label+'\n'+r.stdout+r.stderr);};
requirePass('Mutation baseline failed');
const results=[];
try {
  for(const [name,file,from,to] of cases){
    const source=originals.get(file).toString();
    if(source.split(from).length!==2)throw Error('Mutation anchor must be unique: '+name);
    let result;
    try{fs.writeFileSync(file,source.replace(from,to));result=run();}
    finally{fs.writeFileSync(file,originals.get(file));}
    const log=result.stdout+result.stderr, failures=Number(log.match(/(?:#|ℹ) fail (\d+)/)?.[1]||0);
    const killed=result.status!==0&&failures>0&&/AssertionError/.test(log)&&!/SyntaxError|ERR_MODULE_NOT_FOUND|does not provide an export/.test(log)&&!result.error;
    results.push({name,killed:!!killed,failures});console.log(`${killed?'killed':'SURVIVED'}: ${name} (${failures})`);
  }
} finally {
  for(const [file,bytes] of originals){fs.writeFileSync(file,bytes);if(!fs.readFileSync(file).equals(bytes))throw Error('Restoration failed: '+file);}
}
requirePass('Restored baseline failed');
console.log(JSON.stringify({total:cases.length,killed:results.filter(r=>r.killed).length,restored:true,results},null,2));
if(results.some(r=>!r.killed))process.exitCode=1;
