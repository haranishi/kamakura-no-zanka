// なぜ失敗したか: 円盤の絵と広葉カードがコインを作り、葉の芯が格子になった。松の殻と広葉L2一殻が皿・六角形を作った。
// 第3次: 低木の2帯がひし形、中遠景の3帯が六角形、太い開底の杉芯が黒い三角形になった。
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
      assert(Math.min(...col) >= .279 && Math.max(...col) >= (species===0 && level===1 ? .84 : .89) && Math.max(...col) <= 1.151, '[exposure] bright foliage without black minima');
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
        if(radial>1 && outward<-.6 && Math.abs(y)<.6)assert(g.leaf.getAttribute('color').getX(index)<.65,'[exposure] inner face lost shelter');
      }
      const row=Math.floor(bands/2), a=first+row*(sides+1), b=a+1;
      const distance=Math.hypot(p.getX(a)-p.getX(b),p.getY(a)-p.getY(b),p.getZ(a)-p.getZ(b));
      const density=Math.abs(uv.getX(b)-uv.getX(a))/distance;
      assert(density >= (species>=4?1.4:.8) && density <= (species>=4?2.8:1.8),`[uv-density] ${species}/${level}: ${density}`);
      const top=first, next=first+sides+1;
      const meridian=Math.abs(p.getY(top)-p.getY(next));
      const vertical=Math.abs(uv.getY(top)-uv.getY(next))/meridian;
      assert(vertical >= (species>=4?1.4:.8) && vertical <= (species>=4?2.8:1.8),`[uv-density] meridian ${species}/${level}: ${vertical}`);
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
        assert(g.tris.wood+g.tris.leaf<=112,'[budget] far broadleaf');
        const index=g.leaf.index.array,parent=new Map();
        const root=i=>{if(parent.get(i)!==i)parent.set(i,root(parent.get(i)));return parent.get(i);};
        for(const i of index)parent.set(i,i);
        for(let i=0;i<index.length;i+=3)for(let k=1;k<3;k++)parent.set(root(index[i+k]),root(index[i]));
        assert(new Set([...parent.keys()].map(root)).size===2,'[far-clumps] buffer components merged');
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
        const i=part.first+j*(part.sides+1)+k;
        const dx=p.getX(i)-part.center[0], dz=p.getZ(i)-part.center[2];
        const x=dx*Math.cos(part.rotation)+dz*Math.sin(part.rotation), z=-dx*Math.sin(part.rotation)+dz*Math.cos(part.rotation);
        const factor=Math.hypot(x/part.radii[0],z/part.radii[2])/Math.sin(j/part.bands*Math.PI);
        min=Math.min(min,factor);max=Math.max(max,factor);
      }
      assert(max-min>.015 && min>=.90 && max<=1.10,'[shell-wobble] smooth crown or extreme perturbation');
    }
    const cores=g.wood.userData.parts.filter(p=>p.core);
    assert.equal(cores.length,1,'[core-mesh] missing wood core');
    const core=cores[0],col=g.wood.getAttribute('color'),sway=g.wood.getAttribute('aSway');
    for(let i=core.first;i<core.first+(core.sides+1)*(core.bands+1);i++){
      assert(Math.abs(col.getX(i)-.06)<1e-6 && Math.abs(col.getY(i)-.05)<1e-6 && Math.abs(col.getZ(i)-.03)<1e-6,'[core-color] seasonal/light core');
      assert.equal(sway.getX(i),0,'[core] wood flutter');
    }
    const pos=g.leaf.getAttribute('position'),uv=g.leaf.getAttribute('uv');
    for(let i=0;i<pos.count;i++)assert(Math.abs(uv.getY(i)-pos.getY(i)/(species>=4?.6:1))<2e-6,'[uv-cylinder] v must follow world height');
  }
});
test('pine tufts radiate from bottom-centred cards [pine-fan]',()=>{
  for(const level of [0,1]) {
    const g=treeGeometry(2,level),p=g.leaf.getAttribute('position'),n=g.leaf.getAttribute('normal'),uv=g.leaf.getAttribute('uv');
    const parts=g.leaf.userData.parts;
    assert.equal(parts.length,level===0?40:15,'[pine-card] fan count; disk regression');
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
    assert.equal(centres.size,level===0?5:3,'[pine-tuft] wrong tuft count');
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
    assert.equal(parts.length,species<4?(level===1?5:2):level===1?2:species===4?4:5,'[clump-count] rounded crown grouping');
    for(const part of parts) {
      const {first,sides,bands}=part;
      assert(sides>=8 && bands>=(species<4?4:3),'[shell-resolution] diamond/hexagon shell returned');
      const rows=[];
      for(let j=0;j<=bands;j++) {
        const ring=[];
        for(let k=0;k<sides;k++)ring.push(new THREE.Vector3().fromBufferAttribute(p,first+j*(sides+1)+k));
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
        for(let i=first;i<first+(sides+1)*(bands+1);i++) {
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
