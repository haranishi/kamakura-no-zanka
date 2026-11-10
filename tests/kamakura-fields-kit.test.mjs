import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fieldPlantKit, FIELD_HEIGHTS } from '../dist/valley/kamakura-fields-kit.js';
import { FIELD_VERTEX_PARS, fieldVertexBody, FIELD_FRAGMENT_PARS, FIELD_FRAGMENT_LIGHT, FIELD_FAR_SILHOUETTE } from '../dist/valley/kamakura-fields-view.js';

function balanced(code) {
  const s=code.replace(/\/\/[^\n]*/g,'');
  const stack=[];for(const c of s){if('({['.includes(c))stack.push(c);if(')}]'.includes(c))assert.equal(stack.pop(),'({['[')}]'.indexOf(c)]);}
  assert.equal(stack.length,0);assert.equal((s.match(/#if/g)||[]).length,(s.match(/#endif/g)||[]).length);
  assert(!/--\s*\d|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[A-DF-Za-df-z_]\w*\s*\(/.test(s));
  assert(!/\b(?:float|int|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(s));
}
test('all procedural species have finite vertices/normals, 20–60 triangles, and consistent near/far pigment and height',t=>{
  const counts=[];
  for(let i=0;i<5;i++) {
    const near=fieldPlantKit(i),far=fieldPlantKit(i,true);counts.push(near.triangles);
    for(const kit of [near,far]) {
      assert(kit.positions.every(Number.isFinite));assert(kit.normals.every(Number.isFinite));assert(kit.colors.every(Number.isFinite));
      let top=0;for(let j=1;j<kit.positions.length;j+=3)top=Math.max(top,kit.positions[j]);
      assert(Math.abs(top-FIELD_HEIGHTS[i])<.01,`${i}: top ${top}`);
      for(let j=0;j<kit.normals.length;j+=3)assert(Math.abs(Math.hypot(...kit.normals.subarray(j,j+3))-1)<1e-5);
    }
    assert(near.triangles>=20&&near.triangles<=60);assert.equal(far.triangles,4);
    for(let j=0;j<3;j++)assert(Math.abs(near.meanColor[j]-far.meanColor[j])<1e-6);
    const weighted=[0,0,0];let area=0;
    for(let j=0;j<near.positions.length;j+=9) {
      const p=near.positions,ax=p[j+3]-p[j],ay=p[j+4]-p[j+1],az=p[j+5]-p[j+2],bx=p[j+6]-p[j],by=p[j+7]-p[j+1],bz=p[j+8]-p[j+2];
      const a=Math.hypot(ay*bz-az*by,az*bx-ax*bz,ax*by-ay*bx);area+=a;
      for(let k=0;k<3;k++)weighted[k]+=near.colors[j+k]*a;
    }
    for(let j=0;j<3;j++)assert(Math.abs(weighted[j]/area-far.meanColor[j])<1e-6);
    if(i!==0)assert(near.petals.some(v=>v===1));
  }
  t.diagnostic(JSON.stringify({nearTriangles:counts,farTriangles:4}));
});

test('GLSL hooks use exactly one shared gust declaration, fixed decimals, bounded light, and inherited Lambert chunks',()=>{
  for(const far of [false,true]) {
    const vertex=FIELD_VERTEX_PARS+fieldVertexBody(far);balanced(vertex);
    assert.equal((vertex.match(/float\s+kzGustBand\s*\(/g)||[]).length,1);
    assert.match(vertex,/kzGustBand\(fieldRoot.xz/);assert.match(vertex,/0\.61086524/);assert.match(vertex,/0\.26179939/);
    assert.match(vertex,/uFieldHero/);assert.match(vertex,/uFieldMotion/);
  }
  balanced(FIELD_FRAGMENT_PARS+FIELD_FRAGMENT_LIGHT+FIELD_FAR_SILHOUETTE);
  assert.match(FIELD_FRAGMENT_LIGHT,/vec3\(0\.85\)/);
  const source=fs.readFileSync(new URL('../dist/valley/kamakura-fields-view.js',import.meta.url),'utf8');
  assert.match(source,/\.toFixed\(8\)/);assert.match(source,/new THREE.MeshLambertMaterial/);assert(!source.includes('new THREE.ShaderMaterial'));
  assert.match(source,/receiveShadow=true/);assert.match(source,/castShadow=false/);
  assert(!source.includes('transparent:true'));assert.match(source,/USE_UV/);
});
