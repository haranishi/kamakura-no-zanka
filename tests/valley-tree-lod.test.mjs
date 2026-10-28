// なぜ失敗したか: 正規化・単調性・再割り当ての余白・材質境界の食い違いを分ける。
import test from 'node:test';
import assert from 'node:assert/strict';
import { lodWeights, lodMembership, uLodFor, fadeWeight } from '../dist/valley/tree-lod.js';
import { TREES } from '../dist/valley/config.js';
for (const quality of ['standard', 'light']) {
  const policy = { lod: TREES.lod[quality], blend: TREES.lod.blend[quality] };
  test(`weights, monotonicity, non-overlap ${quality} [weights]`, () => {
    const [a,b] = policy.lod, w = policy.blend;
    assert(a + w < b - w, '[overlap] weights require disjoint bands');
    let prev = [1,0,0];
    for (let d = 0; d < 250; d += .25) {
      const v = lodWeights(d, policy);
      assert(Math.abs(v.reduce((a,b)=>a+b,0)-1) < 1e-12, '[weights] sum differs from one');
      assert(v.every(x=>x>=0 && x<=1), '[weights] negative or excessive');
      assert(v[0] <= prev[0] && v[2] >= prev[2], '[monotonic] reversed transition'); prev = v;
    }
    assert.deepEqual(lodWeights(a,policy),[.5,.5,0], '[weights] first midpoint');
    assert.deepEqual(lodWeights(b,policy),[0,.5,.5], '[weights] second midpoint');
  });
  test(`membership covers movement ${quality} [margin]`, () => {
    for (let d=0;d<240;d+=.5) {
      const included=lodMembership(d,policy);
      for(let delta=-6;delta<=6;delta+=.5) lodWeights(Math.max(0,d+delta),policy).forEach((v,k)=>{
        if(v>0) assert(included[k], '[margin] visible level omitted before next assignment');
      });
    }
    const [a,b]=policy.lod,w=policy.blend;
    assert.deepEqual(lodMembership(a+w+5,policy),[true,true,false], '[margin] leaving near lacks reserve');
    assert.deepEqual(lodMembership(b-w-5,policy),[false,true,true], '[margin] entering far lacks reserve');
  });
  test(`uniforms ${quality} [uniform]`,()=>{
    const [a,b]=policy.lod,w=policy.blend;
    assert.deepEqual(uLodFor(0,policy),[-1,-1,a-w,a+w], '[uniform] L0 exit');
    assert.deepEqual(uLodFor(1,policy),[a-w,a+w,b-w,b+w], '[uniform] L1 enter/exit');
    assert.deepEqual(uLodFor(2,policy),[b-w,b+w,-1,-1], '[uniform] L2 enter');
    assert.equal(fadeWeight(45,45,w),.5,'[fade] midpoint');
    assert.equal(fadeWeight(45-w,45,w),1,'[fade] start');
    assert.equal(fadeWeight(45+w,45,w),0,'[fade] end');
  });
}

// なぜ失敗したか: 広いディザ帯が杉に格子として見えた。境界の意味を保って帯だけを狭める。
test('dither bands stay narrow in both qualities [blend-width]',()=>{
  assert.deepEqual(TREES.lod.blend,{standard:4,light:3},'[blend-width] coarse dither spans too much distance');
});
