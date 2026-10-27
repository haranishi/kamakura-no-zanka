// なぜ失敗したか: 負座標の所有・並び順・生成上限・境界の保持・予算を壊すと欠落や生成スパイクが起きる。
// assertの原因の型は ownership/count/order/build/evict/duplicate/determinism/budget。
import test from 'node:test';
import assert from 'node:assert/strict';
import { chunkOf, chunkTiles, wantedChunks, planChunks, chunkBudget } from '../dist/valley/grass-schedule.js';
import { tilesAround } from '../dist/valley/grass-field.js';
const full = { x0: -1000, z0: -1000, nx: 2000, nz: 2000 };
test('every signed tile has exactly one chunk and chunks contain 9/36 tiles', () => {
  for (const [kind,n] of [['near',3],['mid',6]]) {
    for (let tx=-12;tx<12;tx++) for (let tz=-12;tz<12;tz++) {
      const c=chunkOf(kind,tx,tz), tiles=chunkTiles(kind,c.cx,c.cz);
      assert.equal(tiles.length,n*n,'[count] chunk size changed');
      assert.equal(tiles.filter(t=>t.tx===tx && t.tz===tz).length,1,'[ownership] missing or multiply owned signed tile');
      for (const t of tiles) assert.deepEqual(chunkOf(kind,t.tx,t.tz),c,'[ownership] crossed chunk boundary');
      assert.equal(new Set(tiles.map(t=>`${t.tx},${t.tz}`)).size,tiles.length,'[duplicate] repeated tile');
    }
  }
});
test('wanted chunks deduplicate, use nearest tile distance and sort stably',()=>{
  const input={near:[{tx:6,tz:0,dist:6},{tx:0,tz:0,dist:2},{tx:1,tz:0,dist:1},{tx:-1,tz:0,dist:0}],mid:[]};
  const w=wantedChunks(input);
  assert.deepEqual(w.near.map(c=>c.dist),[0,1,6],'[order] nearest distance lost');
  assert.equal(new Set(w.near.map(c=>c.key)).size,w.near.length,'[duplicate] repeated chunk');
  assert.deepEqual(wantedChunks(input),w,'[determinism] identical input differs');
});
test('planner builds nearest missing only, bounded and unique without mutating inputs',()=>{
  const wanted=[{key:'near:3,0',dist:5},{key:'near:2,0',dist:2},{key:'near:1,0',dist:1},{key:'near:0,0',dist:0}];
  const resident=[{key:'near:0,0',dist:0}], original=structuredClone({wanted,resident});
  for(const maxBuild of [0,1,2,3]) {
    const p=planChunks({wanted,resident,maxBuild});
    assert(p.build.length<=maxBuild,'[build] exceeded frame limit');
    assert.deepEqual(p.build,['near:1,0','near:2,0','near:3,0'].slice(0,maxBuild),'[build] wrong priority or rebuilt resident');
    assert.equal(new Set(p.build).size,p.build.length,'[duplicate] build repeated');
    assert.deepEqual(planChunks({wanted,resident,maxBuild}),p,'[determinism] plan changed');
  }
  assert.deepEqual({wanted,resident},original,'[determinism] mutated input');
  assert.deepEqual(planChunks({wanted:[wanted[0],wanted[0]],resident:[],maxBuild:2}).build,['near:3,0'],'[duplicate] repeated build');
});
test('eviction requires absent AND strictly beyond hysteresis',()=>{
  const resident=[{key:'active',dist:99},{key:'edge',dist:1.5},{key:'inside',dist:-1},{key:'outside',dist:1.5001}];
  assert.deepEqual(planChunks({wanted:[{key:'active',dist:0}],resident,maxBuild:0}).evict,['outside'],'[evict] removed valid or retained-boundary chunk');
  assert.deepEqual(planChunks({wanted:[],resident:[{key:'a',dist:2},{key:'a',dist:2}],maxBuild:0,hysteresis:3}).evict,[],'[evict] ignored custom hysteresis');
  assert.deepEqual(planChunks({wanted:[],resident:[{key:'a',dist:2},{key:'a',dist:2}],maxBuild:0}).evict,['a'],'[duplicate] repeated eviction');
});
test('active tile submission bounds clumps and both quality budgets',()=>{
  for(const quality of ['standard','light']) {
    const b=chunkBudget(quality);
    assert(b.near.triangles<=(quality==='standard'?200000:80000),'[budget] near cap including all-cell clumps');
    assert(b.mid.triangles<=(quality==='standard'?40000:15000),'[budget] mid triangle cap');
    assert(b.near.triangles>=b.near.count*6+b.near.tiles*13*6,'[budget] clumps omitted');
    assert(b.nearChunks<=40 && b.midChunks<=30,'[budget] chunk draw bound');
    for(let i=0;i<24;i++) for(let j=0;j<24;j++) {
      const w=wantedChunks(tilesAround(full,i/3,j/3,{quality}));
      assert(w.near.length<=b.nearChunks && w.mid.length<=b.midChunks,'[budget] chunk bound underestimates');
    }
    console.log('grass chunk submission budget',quality,JSON.stringify(b));
  }
});
