// なぜ失敗したか: 同じ高さの玉と1回のUVが平たい傘と巨大葉を作り、杉L1の輪郭と広葉L2の丸みが消えた。
// 原因の型: budget/attributes/normal/exposure/shape/bark/core/determinism。GPUと見た目は検査しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TREES } from '../dist/valley/config.js';
import { load, source, THREE } from './helpers/tree-modules.mjs';
const { treeGeometry } = await load('tree-geometry.js');
const names = ['cedar', 'zelkova', 'pine', 'maple', 'sapling', 'shrub'];
const digest = g => { const h=createHash('sha256');for(const a of Object.values(g.attributes))h.update(Buffer.from(a.array.buffer));h.update(Buffer.from(g.index.array.buffer));return h.digest('hex'); };
function bounds(g) { g.computeBoundingBox(); return g.boundingBox; }
for (let species = 0; species < 6; species++) {
  test(`${names[species]} attributes, budget and LOD [geometry]`, () => {
    let last = Infinity;
    for (let level = 0; level < TREES.budget[names[species]].length; level++) {
      const g = treeGeometry(species, level), total = g.tris.wood + g.tris.leaf;
      assert(total <= TREES.budget[names[species]][level], `[budget] ${species}/${level}: ${total}`);
      assert(total < last, '[budget] detail must decrease'); last = total;
      assert.equal(treeGeometry(species, level), g, '[determinism] cache identity');
      const clone = g.leaf.clone(); assert.equal(digest(g.leaf), digest(clone), '[determinism] cloned shape'); clone.dispose();
      for (const kind of ['wood', 'leaf']) {
        const mesh = g[kind], count = mesh.getAttribute('position').count;
        assert.equal(mesh.index.count / 3, g.tris[kind], '[budget] reported triangles');
        for (const attr of ['position', 'normal', 'color', 'uv', 'aSway']) {
          const a = mesh.getAttribute(attr); assert.equal(a.count, count, `[attributes] ${attr} count`);
          assert(Array.from(a.array).every(Number.isFinite), `[attributes] ${attr} finite`);
          if (attr === 'aSway') assert(Array.from(a.array).every(v => v >= 0 && v <= 1), `[attributes] ${attr} range`);
        }
        const n = mesh.getAttribute('normal');
        for (let i = 0; i < n.count; i++) assert(Math.abs(Math.hypot(n.getX(i), n.getY(i), n.getZ(i)) - 1) < 1e-6, '[normal] not normalized');
        if (kind === 'wood') assert(Array.from(mesh.getAttribute('aSway').array).every(v => v === 0), '[attributes] wood flutter');
      }
      const lb = bounds(g.leaf), wb = bounds(g.wood), expected = [20, 12, 13, 8, 3, 1.2][species];
      assert(lb.max.y >= expected * .8 && lb.max.y <= expected * 1.2, '[shape] height range');
      assert.equal(g.height, expected, '[shape] declared height');
      assert(wb.min.y <= -.09, '[bark] buried root');
      if ([1, 3, 4, 5].includes(species)) assert(wb.max.y < lb.max.y - .2, '[bark] protruding trunk head');
      const col = g.leaf.getAttribute('color').array;
      assert(Math.min(...col) >= .279 && Math.max(...col) >= .89 && Math.max(...col) <= 1.151, '[exposure] bright foliage without black minima');
      const pos = g.leaf.getAttribute('position'), color = g.leaf.getAttribute('color');
      let inner = 0, outer = 0, ni = 0, no = 0;
      const radii = Array.from({ length: pos.count }, (_, i) => Math.hypot(pos.getX(i), pos.getZ(i))).sort((a, b) => a - b);
      for (let i = 0; i < pos.count; i++) {
        const r = Math.hypot(pos.getX(i), pos.getZ(i));
        if (r <= radii[Math.floor(radii.length * .25)]) { inner += color.getX(i); ni++; }
        if (r >= radii[Math.floor(radii.length * .75)]) { outer += color.getX(i); no++; }
      }
      // Radial inner/outer comparison is meaningful for clustered near/mid broadleaf.
      if ([1, 3].includes(species) && level < 2) assert(inner / ni < outer / no, '[exposure] inner foliage must be darker than outer');
    }
  });
}
test('species silhouettes and structural grammar [shape]', () => {
  const box = species => bounds(treeGeometry(species, 0).leaf);
  assert((box(0).max.x - box(0).min.x) / 20 < .5, '[shape] cedar slender');
  assert(box(3).max.x - box(3).min.x > 7, '[shape] maple width exceeds height');
  const g = treeGeometry(1, 0), p = g.leaf.getAttribute('position');
  let upper = 0, lower = 0;
  for (let i = 0; i < p.count; i++) { const r = Math.hypot(p.getX(i), p.getZ(i)); if (p.getY(i) > 8) upper = Math.max(upper, r); else lower = Math.max(lower, r); }
  assert(upper > lower * 1.03, '[shape] zelkova vase widens above');
  assert(g.tris.leaf >= 600, '[shape] zelkova needs many small clumps');
  const w = g.wood.getAttribute('position');
  const tips = new Set(); for (let i = 0; i < w.count; i++) if (w.getY(i) > 8) tips.add(Math.round(Math.atan2(w.getZ(i), w.getX(i)) * 10));
  assert(g.wood.userData.tips.length >= 4, '[shape] fork branches missing');
  assert(treeGeometry(0,0).tris.wood+treeGeometry(0,0).tris.leaf<=1476,'[budget] cedar near exceeds old specimen');
  assert(treeGeometry(0, 0).tris.leaf > 1000, '[shape] near cedar needs segmented folded fronds');
  const near = treeGeometry(0, 0).wood.getAttribute('color');
  let core = 0; for (let i = 0; i < near.count; i++) if (near.getY(i) > near.getX(i) * 1.6) { assert(near.getY(i) >= .04, '[core] black needle core'); core++; }
  assert(core >= 8, '[core] missing green core');
  const far = treeGeometry(0, 2).leaf.getAttribute('position');
  assert(new Set(Array.from({ length: far.count }, (_, i) => far.getY(i).toFixed(2))).size >= 7, '[shape] far cedar must have four offset cones');
  const bark = treeGeometry(1, 0).wood.getAttribute('color').array;
  assert(Math.max(...bark) / Math.min(...bark) > 3, '[bark] contact shade and bark ridges');
  assert(new Set(names.map((_, i) => digest(treeGeometry(i, 0).leaf))).size === 6, '[shape] species differ');
});
test('seeded regeneration, no DOM/random/time, invalid levels [determinism]', async () => {
  const url = 'data:text/javascript;base64,' + Buffer.from(source('tree-geometry.js').replace("from 'three'", `from '${new URL('../dist/vendor/three.module.min.js', import.meta.url).href}'`) + '\n// independent module').toString('base64');
  const fresh = await import(url);
  for (let s = 0; s < 6; s++) for (let l = 0; l < (s >= 4 ? 2 : 3); l++) for(const part of ['wood','leaf']) assert.equal(digest(treeGeometry(s, l)[part]), digest(fresh.treeGeometry(s, l)[part]), '[determinism] seed drift');
  assert(!/Math\.random|document\.|Date\.|performance\./.test(source('tree-geometry.js')), '[determinism] external state');
  assert.throws(() => treeGeometry(4, 2), RangeError, '[shape] invalid LOD');
  assert(treeGeometry(0, 0).leaf instanceof THREE.BufferGeometry, '[attributes] real Three');
});

// Measure buffer edges rather than accepting reported tile counts as evidence.
test('crown volume, repeated shell UV, opaque core and irregular branch tips [volume/uv/core]', () => {
  for(const species of [1,3,4,5])for(const level of [0,1]) {
    const g=treeGeometry(species,level), parts=g.leaf.userData.parts, uv=g.leaf.getAttribute('uv'), p=g.leaf.getAttribute('position');
    const shells=parts.filter(p=>!p.core);
    if(level===0)assert(shells.length >= (species===1?13:species===3?11:species===4?3:4) && shells.length <= (species===1?17:species===3?14:species===4?5:6),'[volume] too few foliage shells');
    for(const part of shells) {
      const {first,sides,bands}=part;
      if(species<4)for(let j=1;j<bands;j++)for(let k=0;k<sides;k++) {
        const index=first+j*(sides+1)+k, x=(p.getX(index)-part.center[0])/part.radii[0], y=(p.getY(index)-part.center[1])/part.radii[1], z=(p.getZ(index)-part.center[2])/part.radii[2];
        const radial=Math.hypot(part.center[0],part.center[2]), outward=(x*part.center[0]+z*part.center[2])/(radial||1);
        if(radial>1 && outward<-.6 && Math.abs(y)<.6)assert(g.leaf.getAttribute('color').getX(index)<.75,'[exposure] inner face lost shelter');
      }
      const row=Math.floor(bands/2), a=first+row*(sides+1), b=a+1;
      const distance=Math.hypot(p.getX(a)-p.getX(b),p.getY(a)-p.getY(b),p.getZ(a)-p.getZ(b));
      const density=Math.abs(uv.getX(b)-uv.getX(a))/distance;
      assert(density >= (species>=4?1.4:.8) && density <= (species>=4?2.8:1.8),`[uv-density] ${species}/${level}: ${density}`);
      const top=first, next=first+sides+1;
      const meridian=Math.hypot(p.getX(top)-p.getX(next),p.getY(top)-p.getY(next),p.getZ(top)-p.getZ(next));
      const vertical=Math.abs(uv.getY(top)-uv.getY(next))/meridian;
      assert(vertical >= (species>=4?1.4:.8) && vertical <= (species>=4?2.8:1.8),`[uv-density] meridian ${species}/${level}: ${vertical}`);
    }
    if(species<4) {
      const box=bounds(g.leaf), width=Math.max(box.max.x-box.min.x,box.max.z-box.min.z), thickness=box.max.y-box.min.y;
      assert(thickness/width>=.55 && thickness>=g.height*.45,'[volume] flat umbrella');
      const tips=g.wood.userData.tips, mean=tips.reduce((n,t)=>n+t[1],0)/tips.length;
      assert(tips.length>=3 && Math.sqrt(tips.reduce((n,t)=>n+(t[1]-mean)**2,0)/tips.length)>=.4,'[branch-height] coplanar straight forks');
      const cores=parts.filter(p=>p.core); assert.equal(cores.length,1,'[core-uv] missing inner shell');
      const core=cores[0];
      for(let i=core.first;i<core.first+(core.sides+1)*(core.bands+1);i++)assert(uv.getX(i)>0 && uv.getX(i)<.06 && uv.getY(i)>0 && uv.getY(i)<.06,'[core-uv] opaque texel region missed');
    }
  }
});
test('LOD dimensions and rounded far broadleaf, fringed cedar mid [lod-shape]',()=>{
  for(let species=0;species<6;species++) {
    const base=bounds(treeGeometry(species,0).leaf), dimensions=b=>[b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z];
    for(let level=1;level<(species<4?3:2);level++) {
      const g=treeGeometry(species,level), d=dimensions(bounds(g.leaf));
      d.forEach((v,i)=>assert(Math.abs(v/dimensions(base)[i]-1)<=(level===2?.2:.15),`[lod-shape] ${species}/${level} axis ${i}`));
      if(level===2 && [1,3].includes(species))assert(g.leaf.userData.parts[0].sides>=10 && g.leaf.userData.parts[0].bands>=3,'[far-roundness] six-sided crown');
    }
  }
  const midWood=treeGeometry(0,1).wood.getAttribute('color');
  for(let i=0;i<midWood.count;i++)if(midWood.getY(i)>midWood.getX(i)*1.6)assert(midWood.getY(i)>=.04,'[core] black mid needle core');
  const g=treeGeometry(0,1), uv=g.leaf.getAttribute('uv'), p=g.leaf.getAttribute('position');
  assert.equal(g.tris.leaf,216,'[cedar-skirt] nine twelve-sided frusta required');
  assert(Math.max(...uv.array)>1 && Math.min(...g.leaf.getAttribute('color').array)>=.28,'[cedar-skirt] repeated fringe and deep green');
  assert(new Set(Array.from({length:p.count},(_,i)=>p.getY(i).toFixed(2))).size>=18,'[cedar-skirt] smooth cone regression');
});

test('broad fork retains trunk thickness and cards face the sphere [bark/card]',()=>{
  for(const species of [1,3]) {
    const g=treeGeometry(species,0), p=g.wood.getAttribute('position');
    const ringRadius=(first,c)=>Array.from({length:8},(_,k)=>Math.hypot(p.getX(first+k)-c[0],p.getZ(first+k)-c[2])).reduce((a,b)=>a+b)/8;
    assert(ringRadius(36,[.12,0,.1])/ringRadius(0,[0,0,0])>.3,'[bark] carrot taper at fork');
    const n=g.leaf.getAttribute('normal'), uv=g.leaf.getAttribute('uv'); let down=0,up=0;
    for(const part of g.leaf.userData.parts)for(let c=0;c<part.cards;c++) {
      const first=part.first+(part.sides+1)*(part.bands+1)+c*4;
      if(n.getY(first)<-.2)down++; if(n.getY(first)>.2)up++;
      for(let i=first;i<first+4;i++)assert(uv.getX(i)>=0 && uv.getX(i)<=1 && uv.getY(i)>=0 && uv.getY(i)<=1,'[card] UV must remain one cluster');
    }
    assert(down>0 && up>0,'[card] only horizontal foliage plates');
  }
});
