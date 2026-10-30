// なぜ失敗したか: 相補ディザで透けた段の背後に穴が開いた。重なり・単調性・再割り当ての余白・材質境界の食い違いを分ける。
import test from 'node:test';
import assert from 'node:assert/strict';
import { lodWeights, lodMembership, uLodFor, fadeWeight, nearShrink, segmentDistance } from '../dist/valley/tree-lod.js';
import { TREES } from '../dist/valley/config.js';
for (const quality of ['standard', 'light']) {
  const policy = { lod: TREES.lod[quality], blend: TREES.lod.blend[quality] };
  test(`hole-free weights and monotonicity ${quality} [weights]`, () => {
    const [a,b] = policy.lod, w = policy.blend;
    assert(a + 2*w < b - 2*w, '[overlap] weights require disjoint bands');
    let prev = [1,0,0];
    for (let d = 0; d < 250; d += .25) {
      const v = lodWeights(d, policy);
      assert.equal(Math.max(...v), 1, '[weights-gap] no fully present level');
      assert(d<=a ? v[1]>=prev[1] : v[1]<=prev[1], '[monotonic] L1 reversed transition');
      assert(v.every(x=>x>=0 && x<=1), '[weights] negative or excessive');
      assert(v[0] <= prev[0] && v[2] >= prev[2], '[monotonic] reversed transition'); prev = v;
    }
    assert.deepEqual(lodWeights(a,policy),[1,1,0], '[weights] first midpoint');
    assert.deepEqual(lodWeights(b,policy),[0,1,1], '[weights] second midpoint');
  });
  test(`membership covers movement ${quality} [margin]`, () => {
    for (let d=0;d<240;d+=.5) {
      const included=lodMembership(d,policy);
      for(let delta=-6;delta<=6;delta+=.5) lodWeights(Math.max(0,d+delta),policy).forEach((v,k)=>{
        if(v>0) assert(included[k], '[margin] visible level omitted before next assignment');
      });
    }
    const [a,b]=policy.lod,w=policy.blend;
    assert.deepEqual(lodMembership(a+2*w+5,policy),[true,true,false], '[margin] leaving near lacks reserve');
    assert.deepEqual(lodMembership(b-2*w-5,policy),[false,true,true], '[margin] entering far lacks reserve');
  });
  test(`uniforms ${quality} [uniform]`,()=>{
    const [a,b]=policy.lod,w=policy.blend;
    assert.deepEqual(uLodFor(0,policy),[-1,-1,a,a+2*w], '[uniform] L0 exit');
    assert.deepEqual(uLodFor(1,policy),[a-2*w,a,b,b+2*w], '[uniform] L1 enter/exit');
    assert.deepEqual(uLodFor(2,policy),[b-2*w,b,-1,-1], '[uniform] L2 enter');
    assert.equal(fadeWeight(45,45,w),.5,'[fade] midpoint');
    assert.equal(fadeWeight(45-w,45,w),1,'[fade] start');
    assert.equal(fadeWeight(45+w,45,w),0,'[fade] end');
  });
}

// なぜ失敗したか: 広いディザ帯が杉に格子として見えた。境界の意味を保って帯だけを狭める。
test('dither bands stay narrow in both qualities [blend-width]',()=>{
  assert.deepEqual(TREES.lod.blend,{standard:4,light:3},'[blend-width] coarse dither spans too much distance');
});

// CPU policy and the GLSL uniform formula must agree throughout both half-bands.
test('uniforms reproduce hole-free CPU weights [uniform-weight]',()=>{
  for(const quality of ['standard','light']) {
    const policy={lod:TREES.lod[quality],blend:TREES.lod.blend[quality]};
    const smooth=(a,b,d)=>{const t=Math.max(0,Math.min(1,(d-a)/(b-a)));return t*t*(3-2*t);};
    for(let d=0;d<240;d+=.125)for(let l=0;l<3;l++) {
      const [a,b,c,e]=uLodFor(l,policy), weight=(a<0?1:smooth(a,b,d))*(c<0?1:1-smooth(c,e,d));
      assert(Math.abs(weight-lodWeights(d,policy)[l])<1e-12,'[uniform-weight] shader/CPU mismatch');
    }
  }
});

// なぜ失敗したか（8.1a第3周）: 画素ごとに薄めた近くの葉が網点の膜に見えた。房・殻・枝を根元へ縮める係数（tree-materials.js の頂点と同じ式）。
test('near shrink folds the side facing the camera first and stays on the pivot [near-shrink]', () => {
  const range = [.35, 1.7], pivot = [0, 0, 0];
  assert.equal(segmentDistance([1, 1, 0], pivot, [2, 0, 0]), 1, '[near-shrink] distance to the segment');
  assert.equal(segmentDistance([-1, 0, 0], pivot, [2, 0, 0]), 1, '[near-shrink] behind the pivot is measured from the pivot');
  assert.equal(segmentDistance([3, 0, 0], pivot, [2, 0, 0]), 1, '[near-shrink] beyond the tip is measured from the tip');
  assert.equal(nearShrink([5, 0, 0], pivot, [2, 0, 0], range).keep, 1, '[near-shrink] a far tuft shrank');
  assert.equal(nearShrink([1, .1, 0], pivot, [2, 0, 0], range).keep, 0, '[near-shrink] a tuft through the camera kept its size');
  const toward = nearShrink([2, 0, 0], pivot, [1, 0, 0], range).keep, away = nearShrink([2, 0, 0], pivot, [-1, 0, 0], range).keep;
  assert(toward < away && away === 1, '[near-shrink] the side facing the camera does not fold first');
  assert.deepEqual(nearShrink([1, 1, 1], [1, 1, 1], [3, 1, 1], range).position, [1, 1, 1], '[near-shrink] a folded tuft left its pivot');
  const half = nearShrink([0, 1, 0], pivot, [2, 0, 0], range);
  assert(half.keep > 0 && half.keep < 1 && Math.abs(half.position[0] - 2 * half.keep) < 1e-12, '[near-shrink] partial fold off the line to the pivot');
});
