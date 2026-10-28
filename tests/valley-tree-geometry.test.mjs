// なぜ失敗したか: 円盤の絵と広葉カードがコインを作り、葉の芯が格子になった。松の殻と広葉L2一殻が皿・六角形を作った。
// 第3回独立評価: 円筒UVの極の筋、棒付きの玉、浮いた灌木、同色の塊を面積・寸法・色比で防ぐ。
// 第3次: 低木の2帯がひし形、中遠景の3帯が六角形、太い開底の杉芯が黒い三角形になった。
// 第2回独立評価: 複製樹形・低木の多面体・遠景の皿を、全変種の実バッファで防ぐ。
// 原因の型: budget/attributes/normal/exposure/shape/bark/core/determinism。GPUと見た目は検査しない。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { TREES } from '../dist/valley/config.js';
import { load, source, THREE } from './helpers/tree-modules.mjs';
const { treeGeometry } = await load('tree-geometry.js');
const names = ['cedar', 'zelkova', 'pine', 'maple', 'sapling', 'shrub'];
const digest = g => { const h=createHash('sha256');for(const a of Object.values(g.attributes))h.update(Buffer.from(a.array.buffer));h.update(Buffer.from(g.index.array.buffer));return h.digest('hex'); };
const gridVertex = (part, i) => part.vertices ? part.vertices[i] : part.first + i;
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
      const neutral = g.leaf.getAttribute('color');
      const values = Array.from({length:neutral.count},(_,i)=>neutral.getY(i));
      assert(Math.min(...values) >= .279 && Math.max(...values) >= (species===0 && level===1 ? .84 : .89) && Math.max(...values) <= 1.151, '[exposure] bright foliage without black minima');
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
  const url = 'data:text/javascript;base64,' + Buffer.from(source('tree-geometry.js').replace("from 'three'", `from '${new URL('../dist/vendor/three.module.min.js', import.meta.url).href}'`).replace("from './config.js'", `from '${new URL('../dist/valley/config.js', import.meta.url).href}'`) + '\n// independent module').toString('base64');
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
        const index=gridVertex(part,j*(sides+1)+k), x=(p.getX(index)-part.center[0])/part.radii[0], y=(p.getY(index)-part.center[1])/part.radii[1], z=(p.getZ(index)-part.center[2])/part.radii[2];
        const radial=Math.hypot(part.center[0],part.center[2]), outward=(x*part.center[0]+z*part.center[2])/(radial||1);
        if(radial>1 && outward<-.6 && Math.abs(y)<.6)assert(g.leaf.getAttribute('color').getX(index)<.65,'[exposure] inner face lost shelter');
      }
      checkProjection(g.leaf,part,species>=4?.6:1);

    }
    if(species<4) {
      const box=bounds(g.leaf), width=Math.max(box.max.x-box.min.x,box.max.z-box.min.z), thickness=box.max.y-box.min.y;
      assert(thickness/width>=.55 && thickness>=g.height*.45,'[volume] flat umbrella');
      const tips=g.wood.userData.tips, mean=tips.reduce((n,t)=>n+t[1],0)/tips.length;
      assert(tips.length>=3 && Math.sqrt(tips.reduce((n,t)=>n+(t[1]-mean)**2,0)/tips.length)>=.4,'[branch-height] coplanar straight forks');
      assert.equal(parts.filter(p=>p.core).length,0,'[core-mesh] textured core returned');

    }
  }
});
test('LOD dimensions and rounded far broadleaf, fringed cedar mid [lod-shape]',()=>{
  for(let species=0;species<6;species++) {
    const base=bounds(treeGeometry(species,0).leaf), dimensions=b=>[b.max.x-b.min.x,b.max.y-b.min.y,b.max.z-b.min.z];
    for(let level=1;level<(species<4?3:2);level++) {
      const g=treeGeometry(species,level), d=dimensions(bounds(g.leaf));
      d.forEach((v,i)=>assert(Math.abs(v/dimensions(base)[i]-1)<=(level===2?.2:.15),`[lod-shape] ${species}/${level} axis ${i}`));
      if(level===2 && [1,3].includes(species)) {
        assert(g.leaf.userData.parts.length===2,'[far-clumps] expected two separate ellipsoids');
        const heights=new Set(Array.from({length:g.leaf.getAttribute('position').count},(_,i)=>g.leaf.getAttribute('position').getY(i).toFixed(2)));
        assert(heights.size>=8,'[far-roundness] too few staggered bands; hexagonal outline');
        assert(g.tris.wood+g.tris.leaf<=160,'[budget] far broadleaf');
        // Each triangle now has separate UV vertices; weld by position for topology.
        const index=g.leaf.index.array,parent=new Map(),pos=g.leaf.getAttribute('position');
        const key=i=>[pos.getX(i),pos.getY(i),pos.getZ(i)].map(v=>v.toFixed(5)).join(',');
        const root=i=>{if(parent.get(i)!==i)parent.set(i,root(parent.get(i)));return parent.get(i);};
        for(const i of index)parent.set(key(i),key(i));
        for(let i=0;i<index.length;i+=3)for(let k=1;k<3;k++)parent.set(root(key(index[i+k])),root(key(index[i])));
        assert.equal(new Set([...parent.keys()].map(root)).size,2,'[far-clumps] buffer components merged');
      }
    }
  }
  const midWood=treeGeometry(0,1).wood.getAttribute('color');
  for(let i=0;i<midWood.count;i++)if(midWood.getY(i)>midWood.getX(i)*1.6)assert(midWood.getY(i)>=.04,'[core] black mid needle core');
  const g=treeGeometry(0,1), uv=g.leaf.getAttribute('uv'), p=g.leaf.getAttribute('position');
  assert.equal(g.tris.leaf,216,'[cedar-skirt] nine twelve-sided frusta required');
  assert(Math.max(...uv.array)>1 && Math.min(...g.leaf.getAttribute('color').array)>=.4,'[cedar-skirt] repeated fringe and deep green');
  assert(new Set(Array.from({length:p.count},(_,i)=>p.getY(i).toFixed(2))).size>=18,'[cedar-skirt] smooth cone regression');
});

test('broad fork retains trunk thickness [bark]',()=>{
  for(const species of [1,3]) {
    const g=treeGeometry(species,0), p=g.wood.getAttribute('position');
    const ringRadius=(first,c)=>Array.from({length:8},(_,k)=>Math.hypot(p.getX(first+k)-c[0],p.getZ(first+k)-c[2])).reduce((a,b)=>a+b)/8;
    assert(ringRadius(36,[.12,0,.1])/ringRadius(0,[0,0,0])>.3,'[bark] carrot taper at fork');
  }
});
test('all broadleaf triangles belong to shells; wood holds one dark core [shell/core]',()=>{
  for(const species of [1,3,4,5])for(const level of [0,1]) {
    const g=treeGeometry(species,level), parts=g.leaf.userData.parts;
    assert.equal(parts.reduce((n,p)=>n+2*p.sides*(p.bands-1),0),g.tris.leaf,'[shell-card] extra card triangles');
    assert(parts.every(p=>!p.core && !p.cards),'[shell-card] textured core/card');
    if(level===0 && species<4)assert(parts.every(p=>p.sides>=10 && p.bands>=4),'[shell-resolution] near crown coarse');
    const p=g.leaf.getAttribute('position');
    for(const part of parts) {
      let min=Infinity,max=-Infinity;
      for(let j=1;j<part.bands;j++)for(let k=0;k<part.sides;k++) {
        const i=gridVertex(part,j*(part.sides+1)+k);
        const dx=p.getX(i)-part.center[0], dz=p.getZ(i)-part.center[2];
        const x=dx*Math.cos(part.rotation)+dz*Math.sin(part.rotation), z=-dx*Math.sin(part.rotation)+dz*Math.cos(part.rotation);
        const factor=Math.hypot(x/part.radii[0],z/part.radii[2])/Math.sin(j/part.bands*Math.PI);
        min=Math.min(min,factor);max=Math.max(max,factor);
      }
      assert(max-min>.015 && min>=(species>=4?.8599:.90) && max<=(species>=4?1.1401:1.10),'[shell-wobble] smooth crown or extreme perturbation');
    }
    const cores=g.wood.userData.parts.filter(p=>p.core);
    assert.equal(cores.length,1,'[core-mesh] missing wood core');
    const core=cores[0],col=g.wood.getAttribute('color'),sway=g.wood.getAttribute('aSway');
    for(let i=core.first;i<core.first+(core.sides+1)*(core.bands+1);i++){
      assert(Math.abs(col.getX(i)-.06)<1e-6 && Math.abs(col.getY(i)-.05)<1e-6 && Math.abs(col.getZ(i)-.03)<1e-6,'[core-color] seasonal/light core');
      assert.equal(sway.getX(i),0,'[core] wood flutter');
    }

  }
});
test('pine tufts radiate from bottom-centred cards [pine-fan]',()=>{
  for(const level of [0,1]) {
    const g=treeGeometry(2,level),p=g.leaf.getAttribute('position'),n=g.leaf.getAttribute('normal'),uv=g.leaf.getAttribute('uv');
    const parts=g.leaf.userData.parts;
    assert.equal(parts.length,level===0?40:20,'[pine-card] fan count; disk regression');
    assert.equal(g.tris.leaf,parts.length*2,'[pine-card] non-card foliage');
    const centres=new Map();
    for(const part of parts) {
      const i=part.first,c=part.center,key=c.join(',');centres.set(key,(centres.get(key)||0)+1);
      for(let q=0;q<3;q++)assert(Math.abs((p.array[i*3+q]+p.array[(i+1)*3+q])/2-c[q])<1e-6,'[pine-root] card bottom centre');
      const middle=[0,1,2].map(q=>(p.array[(i+2)*3+q]+p.array[(i+3)*3+q])/2-c[q]);
      assert(n.getX(i)*Math.cos(part.angle)+n.getZ(i)*Math.sin(part.angle)>.2,'[pine-normal] inward card');
      assert(Math.hypot(...middle)>2.3 && Math.hypot(...middle)<2.5,'[pine-card] fan length');
      assert.equal(uv.getY(i),0,'[pine-root] flipped needle UV');
      const indices=g.leaf.index.array.slice(parts.indexOf(part)*6,parts.indexOf(part)*6+3);
      const a=new THREE.Vector3().fromBufferAttribute(p,indices[0]),b=new THREE.Vector3().fromBufferAttribute(p,indices[1]),c0=new THREE.Vector3().fromBufferAttribute(p,indices[2]);
      const face=b.sub(a).cross(c0.sub(a)).normalize(),normal=new THREE.Vector3().fromBufferAttribute(n,i);
      assert(face.dot(normal)>.999,'[pine-normal] normal disagrees with card winding');
      assert(middle[0]*Math.cos(part.angle)+middle[2]*Math.sin(part.angle)>1.5,'[pine-direction] fan must grow outward');
    }
    assert.equal(centres.size,level===0?5:4,'[pine-tuft] wrong tuft count');
  }
});

// Project each shell's actual vertices onto a side view and measure its convex outline.
function outlineCount(points) {
  const sorted=[...new Map(points.map(p=>[p.map(v=>v.toFixed(5)).join(','),p])).values()].sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const half=ps=>{const h=[];for(const p of ps){while(h.length>1&&cross(h.at(-2),h.at(-1),p)<=1e-7)h.pop();h.push(p);}return h;};
  return half(sorted).length+half([...sorted].reverse()).length-2;
}
test('rounded understory and middle/far crowns use real shell rings [shell-resolution]',()=>{
  for(const species of [1,3,4,5])for(const level of (species<4?[1,2]:[0,1])) {
    const g=treeGeometry(species,level),p=g.leaf.getAttribute('position'),parts=g.leaf.userData.parts;
    assert.equal(parts.length,species<4?(level===1?5:2):level===1?2:4,'[clump-count] rounded crown grouping');
    for(const part of parts) {
      const {first,sides,bands}=part;
      assert(sides>=(species>=4 && level===0?12:8) && bands>=(species<4?(level===2?5:4):(level===0?5:4)),'[shell-resolution] diamond/hexagon shell returned');
      const rows=[];
      for(let j=0;j<=bands;j++) {
        const ring=[];
        for(let k=0;k<sides;k++)ring.push(new THREE.Vector3().fromBufferAttribute(p,gridVertex(part,j*(sides+1)+k)));
        rows.push(ring);
      }
      assert(rows.slice(1,-1).every(r=>new Set(r.map(v=>v.toArray().map(x=>x.toFixed(5)).join(','))).size>=8),'[shell-resolution] collapsed azimuth vertices');
      if(species<4 && level===2) {
        let lo=Infinity,hi=-Infinity,upper=0,lower=0,nu=0,nl=0;
        for(let j=1;j<bands;j++)for(let k=0;k<sides;k++) {
          const v=rows[j][k].clone().sub(new THREE.Vector3(...part.center));
          const x=v.x*Math.cos(part.rotation)+v.z*Math.sin(part.rotation),z=-v.x*Math.sin(part.rotation)+v.z*Math.cos(part.rotation);
          const localX=x*Math.cos(part.tilt)+v.y*Math.sin(part.tilt);
          const factor=Math.hypot(localX/part.radii[0],z/part.radii[2])/Math.sin(j/bands*Math.PI);
          lo=Math.min(lo,factor);hi=Math.max(hi,factor);
        }
        assert(lo>=.8799 && hi<=1.1201 && hi-lo>.1,'[shell-wobble] far crown lost its bounded irregularity');
        const color=g.leaf.getAttribute('color');
        for(const i of part.vertices || Array.from({length:(sides+1)*(bands+1)},(_,k)=>first+k)) {
          if(p.getY(i)>part.center[1]){upper+=color.getX(i);nu++;}else{lower+=color.getX(i);nl++;}
        }
        assert(upper/nu>lower/nl,'[exposure] far crown must be lighter above');
      }
      const points=rows.flat();
      if(species<4)for(const axis of ['x','z'])assert(outlineCount(points.map(v=>[v[axis],v.y]))>=8,'[outline] side silhouette has fewer than eight vertices');
      if(species>=4)for(const other of parts)if(other!==part) {
        const separation=Math.hypot(...part.center.map((v,q)=>(v-other.center[q])/Math.min(part.radii[q],other.radii[q])));
        assert(separation<1,'[clump-overlap] understory balls must overlap deeply');
      }
    }
    if(species<4) {
      assert(new Set(parts.map(p=>p.rotation)).size===parts.length,'[clump-axis] aligned crown axes');
      assert(new Set(parts.map(p=>p.radii.join(','))).size===parts.length,'[clump-size] identical crown sizes');
      if(level===2)assert(parts.every(p=>Math.abs(p.tilt)>.05),'[clump-tilt] far crowns lack lean');
    }
  }
});
test('near cedar core is slim deep green with a watertight downward cap [core]',()=>{
  const g=treeGeometry(0,0),p=g.wood.getAttribute('position'),c=g.wood.getAttribute('color'),n=g.wood.getAttribute('normal');
  const green=new Set();
  for(let i=0;i<c.count;i++)if(c.getY(i)>c.getX(i)*1.6) {
    green.add(i);
    for(const [actual,expected] of [[c.getX(i),.04],[c.getY(i),.075],[c.getZ(i),.035]])assert(Math.abs(actual-expected)<1e-6,'[core-color] near core must be deep green');
  }
  assert(green.size>=11,'[core] missing cone or cap');
  const points=[...green].map(i=>new THREE.Vector3().fromBufferAttribute(p,i));
  assert(Math.abs(Math.min(...points.map(v=>v.y))-3)<1e-6 && Math.abs(Math.max(...points.map(v=>v.y))-19.7)<1e-5,'[core-height] cone height changed');
  const cx=Math.sin(.3)*.22,cz=Math.cos(.3)*.18;
  const radius=Math.max(...points.map(v=>Math.hypot(v.x-cx,v.z-cz)));
  assert(radius>=1.3 && radius<=1.46,'[core-radius] thick cone blocks the fronds');
  const edges=new Map(),key=i=>new THREE.Vector3().fromBufferAttribute(p,i).toArray().map(v=>v.toFixed(5)).join(',');
  let caps=0;
  for(let t=0;t<g.wood.index.count;t+=3) {
    const ids=Array.from(g.wood.index.array.slice(t,t+3));if(!ids.every(i=>green.has(i)))continue;
    for(let k=0;k<3;k++) {const e=[key(ids[k]),key(ids[(k+1)%3])].sort().join('/');edges.set(e,(edges.get(e)||0)+1);}
    if(ids.every(i=>Math.abs(p.getY(i)-3)<1e-6)) {
      caps++;
      const [a,b,d]=ids.map(i=>new THREE.Vector3().fromBufferAttribute(p,i));
      assert(b.sub(a).cross(d.sub(a)).y<0,'[core-cap] bottom winding faces inward');
      assert(ids.some(i=>n.getY(i)<-.99),'[core-cap] missing downward cap normal');
    }
  }
  assert.equal(caps,8,'[core-cap] bottom is open');
  assert([...edges.values()].every(v=>v===2),'[core-closed] cone has boundary or nonmanifold edges');
  assert(g.tris.wood+g.tris.leaf<=1476,'[budget] near cedar exceeds old 1476 triangles');
});

// なぜ失敗したか: 一つの標本だけの検査では、複製と別変種の予算・LOD退行を見逃した。
test('all shape families have finite unit normals, budgets and matching LOD bounds [variant]',()=>{
  assert.deepEqual(TREES.variants,{cedar:3,zelkova:3,pine:2,maple:3},'[variant-count] shape family configuration');
  for(let sp=0;sp<4;sp++) {
    const families=[[],[],[]];
    for(let shape=0;shape<TREES.variants[names[sp]];shape++) {
      const size=g=>bounds(g.leaf).getSize(new THREE.Vector3()).toArray();
      const base=treeGeometry(sp,0,shape), dims=size(base);let previous=Infinity;
      for(let level=0;level<3;level++) {
        const g=treeGeometry(sp,level,shape), total=g.tris.wood+g.tris.leaf;
        families[level].push(size(g).join(','));
        assert(total<=TREES.budget[names[sp]][level] && total<previous,`[variant-budget] ${sp}/${shape}/${level} ${total}`);previous=total;
        assert.equal(g,treeGeometry(sp,level,shape),'[variant-cache] unstable template');
        assert.equal(treeGeometry(sp,level),treeGeometry(sp,level,0),'[variant-default] shape zero changed');
        for(const kind of ['wood','leaf']) {
          for(const a of Object.values(g[kind].attributes))assert(Array.from(a.array).every(Number.isFinite),'[variant-attributes] nonfinite buffer');
          const n=g[kind].getAttribute('normal');
          for(let i=0;i<n.count;i++)assert(Math.abs(Math.hypot(n.getX(i),n.getY(i),n.getZ(i))-1)<1e-6,'[variant-normal] non-unit normal');
          assert(Array.from(g[kind].index.array).every(i=>i<g[kind].getAttribute('position').count),'[variant-index] out of bounds');
        }
        if(level)size(g).forEach((v,q)=>assert(Math.abs(v/dims[q]-1)<=(level===1?.15:.2),`[variant-lod] ${sp}/${shape}/${level} axis ${q}`));
        if(sp===0)assert(level===0?g.tris.leaf/48>=24 && g.tris.leaf/48<=28:level===1?g.tris.leaf/24>=8 && g.tris.leaf/24<=10:g.tris.leaf/6>=3 && g.tris.leaf/6<=5,'[variant-cedar] row count outside grammar');
        if([1,3].includes(sp) && level===2) {
          const [main,side]=g.leaf.userData.parts;
          assert.equal(g.leaf.userData.parts.length,2,'[dome-count] main dome plus shoulder');
          assert(main.bands>=5 && side.bands>=5 && main.sides>=8 && side.sides>=8,'[dome-bands] coarse far dome');
          assert(main.radii[0]/main.radii[1]>=1.1 && main.radii[0]/main.radii[1]<=1.7,'[dome-aspect] flattened plate');
          assert(side.radii.every((r,q)=>r<main.radii[q]*.7),'[dome-shoulder] two equal stacked crowns');
        }
      }
    }
    for(const level of families)assert.equal(new Set(level).size,TREES.variants[names[sp]],'[variant-shape] identical shape bounds');
  }
  for(const args of [[0,0,-1],[0,0,3],[2,1,2],[4,0,1],[5,1,1],[1,0,.5]])assert.throws(()=>treeGeometry(...args),RangeError,'[variant-validation] invalid shape accepted');
});
test('cedar shape zero retains original L0 and L2 bytes [cedar-hash]',()=>{
  const hashes={
    '0/wood':'85cc2ab6dfea794701e23ad7de31097b1de89f75f7c05af8585a3a9ad1fa9b06',
    '0/leaf':'aeea6173e75705407b8f47999216951479a3cf9dbcc5879f7e1bc16930322dfd',
    '2/wood':'7517dc2bc0b385c56f87d06234837207be5f9693e3dfd2f2389462c77712c4b7',
    '2/leaf':'732b9606020a6e155db29ffa08b9910a7f3d6f71a5409a5806b2d28157023ea7',
  };
  for(const [key,expected] of Object.entries(hashes)){const [l,k]=key.split('/');assert.equal(digest(treeGeometry(0,+l,0)[k]),expected,'[cedar-hash] protected buffer changed');}
});
test('sapling trunk tip lies in lower half of overlapping rounded foliage [trunk-gap]',()=>{
  for(const level of [0,1]) {
    const g=treeGeometry(4,level),p=g.wood.getAttribute('position'),first=level===0?10:5;
    const tip=[0,0,0];for(let k=0;k<4;k++)for(let q=0;q<3;q++)tip[q]+=p.array[(first+k)*3+q]/4;
    assert(g.leaf.userData.parts.some(part=>tip[1]<part.center[1] && Math.hypot(...tip.map((v,q)=>(v-part.center[q])/part.radii[q]))<.8),'[trunk-gap] trunk ends below crown or outside rounded shell');
  }
});

function checkProjection(g,part,tile) {
  const p=g.getAttribute('position'),uv=g.getAttribute('uv'),ratios=[],top=[];
  for(let t=part.indexFirst;t<part.indexFirst+part.indexCount;t+=3) {
    const ids=Array.from(g.index.array.slice(t,t+3));
    const [a,b,c]=ids.map(i=>new THREE.Vector3().fromBufferAttribute(p,i));
    const surface=b.clone().sub(a).cross(c.clone().sub(a)).length()/2;
    const [u,v,w]=ids.map(i=>new THREE.Vector2().fromBufferAttribute(uv,i));
    const area=Math.abs((v.x-u.x)*(w.y-u.y)-(v.y-u.y)*(w.x-u.x))/2, ratio=area/surface;
    assert(Number.isFinite(ratio) && surface>1e-9,'[uv-area] degenerate face');
    ratios.push(ratio);if((a.y+b.y+c.y)/3>part.center[1]+part.radii[1]*.6)top.push(ratio);
  }
  ratios.sort((a,b)=>a-b);const median=ratios[Math.floor(ratios.length/2)],target=1/tile**2;
  assert(Math.abs(median/target-1)<=.35,`[uv-density] ${median} expected ${target}`);
  assert(top.length && Math.min(...top)>=.4*median,'[uv-pole] pinched top projection');
}
test('face box UV preserves smooth attributes and varies across clumps [uv-box]',()=>{
  for(const sp of [1,3,4,5])for(let l=0;l<(sp<4?3:2);l++)for(let shape=0;shape<(TREES.variants[names[sp]]||1);shape++) {
    const g=treeGeometry(sp,l,shape).leaf, parts=g.userData.parts, p=g.getAttribute('position'),seen=new Map();
    assert.equal(new Set(parts.map(p=>p.uvAngle)).size,parts.length,'[uv-rotation] identical clump rotation');
    assert.equal(new Set(parts.map(p=>p.uvShift?.join(','))).size,parts.length,'[uv-shift] identical clump offset');
    for(const part of parts) {
      checkProjection(g,part,sp>=4?.6:1);
      assert.equal(part.vertexCount,part.indexCount,'[uv-box] faces must own their vertices');
      for(let i=part.first;i<part.first+part.vertexCount;i++) {
        const key=[parts.indexOf(part),p.getX(i).toFixed(5),p.getY(i).toFixed(5),p.getZ(i).toFixed(5)].join(',');
        const values=['normal','color','aSway'].flatMap(name=>{const a=g.getAttribute(name);return Array.from(a.array.slice(i*a.itemSize,(i+1)*a.itemSize));});
        if(seen.has(key))values.forEach((v,k)=>assert(Math.abs(v-seen.get(key)[k])<1e-5,'[uv-smooth] copied attribute discontinuity'));else seen.set(key,values);
      }
    }
  }
});
test('clump color bias is balanced and bounded in actual vertex colors [clump-color]',()=>{
  for(const sp of [1,3,4,5])for(let l=0;l<(sp<4?3:2);l++)for(let shape=0;shape<(TREES.variants[names[sp]]||1);shape++) {
    const g=treeGeometry(sp,l,shape).leaf,c=g.getAttribute('color'),biases=[];
    for(const part of g.userData.parts) {
      const values=[];
      for(let i=part.first;i<part.first+part.vertexCount;i++) {
        const delta=1-c.getZ(i)/c.getY(i);values.push(delta);
        assert(Math.abs(delta)<=.100001,'[clump-color-range] excessive bias');
        assert(Math.abs(c.getX(i)/c.getY(i)-(1+.9*delta))<1e-6,'[clump-color-gray] exposure/channel relation changed');
      }
      assert(Math.max(...values)-Math.min(...values)<1e-6,'[clump-color] bias varies within shell');biases.push(values[0]);
    }
    assert(Math.max(...biases)-Math.min(...biases)>.005,'[clump-color] missing clump bias');
    assert(Math.abs(biases.reduce((a,b)=>a+b,0)/biases.length)<=.02,'[clump-color-mean] tree hue shifted');
  }
});
test('far domes, trunk overlap and grounded understory [candy/ground]',()=>{
  for(const sp of [1,3])for(let shape=0;shape<3;shape++)for(const l of [1,2]) {
    const g=treeGeometry(sp,l,shape),p=g.wood.getAttribute('position'),parts=g.leaf.userData.parts;
    const tip=Array.from({length:4},(_,k)=>p.getY(5+k)).reduce((a,b)=>a+b)/4;
    assert(tip>Math.min(...parts.map(p=>p.center[1])),'[trunk-overlap] short stick under crown');
    if(l===2) {
      const main=parts[0], bottom=main.center[1]-main.radii[1];
      assert(bottom/g.height<=.35,'[dome-bottom] lollipop dome too high');
      const foliage=g.leaf.getAttribute('position'), actualBottom=Math.min(...Array.from({length:main.vertexCount},(_,i)=>foliage.getY(main.first+i)));
      assert(actualBottom/g.height<=.35,'[dome-bottom] tilted mesh dome too high');
      const radius=Math.min(...Array.from({length:4},(_,i)=>Math.hypot(p.getX(i),p.getZ(i))));
      assert(radius>=(sp===1?.5:.45),'[trunk-radius] thin far trunk');
      assert(tip>bottom && tip<main.center[1]+main.radii[1],'[trunk-overlap] far trunk misses dome');
    }
  }
  const sap=treeGeometry(4,0),p=sap.wood.getAttribute('position'),parts=sap.leaf.userData.parts;
  assert(Math.min(...Array.from({length:4},(_,i)=>Math.hypot(p.getX(i),p.getZ(i))))>=.075,'[sapling-radius] thin stick');
  assert(parts.every(p=>p.radii[1]>Math.max(p.radii[0],p.radii[2])*1.15),'[sapling-aspect] round candy');
  assert(bounds(sap.leaf).min.y/sap.height<=.38,'[sapling-bottom] high ball');
  assert.equal(sap.tris.wood,16+8+6,'[sapling-branch] exactly one side branch and core');
  for(const l of [0,1])assert(bounds(treeGeometry(5,l).leaf).min.y<=0,'[shrub-ground] floating shrub');
});
