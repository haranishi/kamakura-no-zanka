# Research: 容量と樹種の再測定（2026-10-27）

リポジトリのルートで次を実行した。ファイルは書かない。Nodeで既存の純粋層だけを読む。
到達の母数は `tests/valley-world.test.mjs` の「one-way trap」と同じ5m格子・4方向。
木は幹位置が通行地形で、その位置を含む格子が開始点から到達可能なら数える。
移動半径0.3m・到達誤差0.5mも既存試験を継承。端の余剰帯は格子の外として除く。

```sh
node --input-type=module <<'JS'
import fs from 'node:fs';
import path from 'node:path';
import { WORLD } from './dist/valley/world-data.js';
import { createTerrain } from './dist/valley/terrain-height.js';
import { scatterTrees, scatterRocks } from './dist/valley/scatter.js';
import { buildColliders, moveActor } from './dist/valley/collision.js';
import { propColliders, rockColliders } from './dist/valley/world-colliders.js';
const terrain = createTerrain(WORLD), trees = scatterTrees(WORLD, terrain);
const extra = propColliders(WORLD), rocks = scatterRocks(WORLD, terrain);
const col = buildColliders({ buildings: WORLD.buildings, props: WORLD.props,
  trees, bounds: WORLD.bounds, extraBoxes: extra.boxes,
  extraCircles: [...extra.circles, ...rockColliders(rocks)] });
const G = 5, b = WORLD.bounds;
const W = Math.floor((b.maxX-b.minX)/G), H = Math.floor((b.maxZ-b.minZ)/G);
const px = i => b.minX + (i%W+0.5)*G;
const pz = i => b.minZ + (Math.floor(i/W)+0.5)*G;
const adj = Array.from({length:W*H}, () => []);
for (let i=0; i<W*H; i++) {
  if (!terrain.walkable(px(i),pz(i))) continue;
  for (const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
    const x=i%W+dx, z=Math.floor(i/W)+dz;
    if (x<0 || x>=W || z<0 || z>=H) continue;
    const j=z*W+x;
    if (!terrain.walkable(px(j),pz(j))) continue;
    const r=moveActor(col,terrain,
      {x:px(i),y:terrain.heightAt(px(i),pz(i)),z:pz(i)},dx*G,dz*G,0.3);
    if (Math.hypot(r.x-px(j),r.z-pz(j))<0.5) adj[i].push(j);
  }
}
const start = Math.floor((WORLD.start.z-b.minZ)/G)*W
  + Math.floor((WORLD.start.x-b.minX)/G);
const seen = new Set([start]), q = [start];
for (let k=0; k<q.length; k++) {
  for (const j of adj[q[k]]) {
    if (!seen.has(j)) { seen.add(j); q.push(j); }
  }
}
const reachable = i => {
  const x=Math.floor((trees.x[i]-b.minX)/G);
  const z=Math.floor((trees.z[i]-b.minZ)/G);
  return x>=0 && x<W && z>=0 && z<H && seen.has(z*W+x);
};
const walkable = i => terrain.walkable(trees.x[i],trees.z[i]);
for (const [name,pred] of [['all',()=>true], ['walkable',walkable],
  ['reachable-cell',i=>walkable(i)&&reachable(i)]]) {
  const n=[0,0,0];
  trees.kind.forEach((v,i)=>{ if(pred(i)) n[v]++; });
  console.log(name,n,n.reduce((a,b)=>a+b,0));
}
function sum(d) {
  return fs.readdirSync(d,{withFileTypes:true}).reduce((n,e)=> {
    const f=path.join(d,e.name);
    return n+(e.isDirectory()?sum(f):fs.statSync(f).size);
  },0);
}
let total=fs.statSync('dist/audio.js').size;
for (const d of ['dist/assets/characters','dist/assets/valley',
  'dist/valley','dist/vendor']) {
  const n=sum(d); total+=n; console.log(d,n);
}
console.log('inventory',total,'bytes',total/1048576,'MiB');
JS
```

出力（樹種順は杉・広葉・松）：

```text
all [ 13778, 258, 1794 ] 15830
walkable [ 501, 87, 83 ] 671
reachable-cell [ 484, 85, 76 ] 645
dist/assets/characters 61985701
dist/assets/valley 42092292
dist/valley 437744
dist/vendor 882453
inventory 105405246 bytes 100.52227592468262 MiB
```

容量は起動時ローダー（main・characters・buildings・props・terrain）の対象を含む上界。
地形の18枚のJPEG・clips.json・共有Three.jsと音の基底も含む。HTTPヘッダーは含めない。
同梱ディレクトリ全量を使うので未使用物も含む。実ブラウザの通信量とは区別する。
将来の追加ファイルはこの対象へ含め、対象外から新規に読む場合は一覧も更新する。
