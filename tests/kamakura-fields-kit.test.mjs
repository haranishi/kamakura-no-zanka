import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { fieldPlantKit, FIELD_HEIGHTS, FIELD_CARD_WIDTHS, FIELD_LEAF, FIELD_BLOOMS } from '../dist/valley/kamakura-fields-kit.js';
import { FIELD_DENSITIES } from '../dist/valley/kamakura-fields.js';
import { FIELD_VERTEX_PARS, fieldVertexBody, FIELD_FRAGMENT_PARS, FIELD_FRAGMENT_LIGHT, FIELD_FAR_SILHOUETTE, FIELD_CARD_GLSL } from '../dist/valley/kamakura-fields-view.js';

function balanced(code) {
  const s=code.replace(/\/\/[^\n]*/g,'');
  const stack=[];for(const c of s){if('({['.includes(c))stack.push(c);if(')}]'.includes(c))assert.equal(stack.pop(),'({['[')}]'.indexOf(c)]);}
  assert.equal(stack.length,0);assert.equal((s.match(/#if/g)||[]).length,(s.match(/#endif/g)||[]).length);
  assert(!/--\s*\d|\b\d+(?:\.\d+)?(?:[eE][+-]?\d+)?[A-DF-Za-df-z_]\w*/.test(s));
  assert(!/\b(?:float|int|bool|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/.test(s));
}
test('shared card has four triangles, matching UVs, finite vertices and upward normals on both planes',()=>{
  const kit=fieldPlantKit();
  assert.equal(kit.triangles,4);assert.equal(kit.positions.length,36);assert.equal(kit.uvs.length,24);assert.equal(kit.normals.length,36);
  assert(kit.positions.every(Number.isFinite));assert(kit.normals.every(Number.isFinite));assert(kit.uvs.every(v=>v===0||v===1));
  const expectedUv=[0,0,1,0,1,1,0,0,1,1,0,1];
  for(let i=0;i<12;i++) {
    assert.equal(kit.positions[i*3+1],kit.uvs[i*2+1]);
    assert.equal(kit.normals[i*3],0);assert.equal(kit.normals[i*3+1],1);assert.equal(kit.normals[i*3+2],0);
  }
  for(let i=0;i<24;i++)assert.equal(kit.uvs[i],expectedUv[i%12]);
  for(let plane=0;plane<2;plane++)for(let i=plane*18;i<plane*18+18;i+=3) {
    assert(Math.abs(kit.positions[i+(plane===0?2:0)])<1e-15);
    assert(Math.abs(Math.abs(kit.positions[i+(plane===0?0:2)])-.5)<1e-7);
  }
  for(let i=0;i<5;i++)assert(FIELD_HEIGHTS[i]>0&&FIELD_CARD_WIDTHS[i]>0);
});

test('GLSL is balanced, uses one shared gust and all five card branches, table-derived colours and upward lighting',()=>{
  const vertex=FIELD_VERTEX_PARS+fieldVertexBody();balanced(vertex);
  assert.equal((vertex.match(/float\s+kzGustBand\s*\(/g)||[]).length,1);
  assert.match(vertex,/kzGustBand\(fieldRoot.xz/);assert.match(vertex,/0\.61086524/);assert.match(vertex,/0\.26179939/);
  assert.match(vertex,/uFieldHero/);assert.match(vertex,/uFieldMotion/);
  balanced(FIELD_FRAGMENT_PARS+FIELD_CARD_GLSL+FIELD_FAR_SILHOUETTE+FIELD_FRAGMENT_LIGHT);
  for(const boundary of ['0.5','1.5','2.5','3.5'])assert(FIELD_CARD_GLSL.includes(`kind < ${boundary}`));
  assert.match(FIELD_CARD_GLSL,/length\(uv - 0\.5\) > 0\.5/);
  for(const c of [FIELD_LEAF,...FIELD_BLOOMS])assert(FIELD_CARD_GLSL.includes(`vec3(${c.map(v=>v.toFixed(6)).join(', ')})`));
  assert.match(FIELD_FAR_SILHOUETTE,/step\(vFieldCardPx, 26\.0\)/);assert.match(FIELD_FRAGMENT_LIGHT,/vec3\(0\.90\)/);
  const source=fs.readFileSync(new URL('../dist/valley/kamakura-fields-view.js',import.meta.url),'utf8');
  assert.match(source,/\.toFixed\(8\)/);assert.match(source,/new THREE.MeshLambertMaterial/);assert(!source.includes('new THREE.ShaderMaterial'));
  assert.match(source,/normal = normalize\(vNormal\);/);assert.match(source,/receiveShadow=true/);assert.match(source,/castShadow=false/);
  assert(!source.includes('transparent:true'));assert.match(source,/USE_UV/);
  for(const removed of ['aFieldShape.w','aFieldCluster','aFieldPetal','vFieldPetal','fieldLimit','maintenance','FIELD_NEAR_RADIUS'])assert(!source.includes(removed),removed);
});

// Snapshot of the parent-reviewed card expressions/tables, not of the obsolete near-plant implementation.
// Numbers are hashed at nine decimals: the colour tables come from a power (sRGB to linear), and its last digit differs between
// machines (the full-precision hash matched on macOS and failed on the Linux CI runner).
const digest=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v,(k,x)=>typeof x==='number'?Number(x.toFixed(9)):x)).digest('hex');
test('parent-reviewed card, silhouette, lighting and tables retain their original values',()=>{
  const entries={card:FIELD_CARD_GLSL,silhouette:FIELD_FAR_SILHOUETTE,light:FIELD_FRAGMENT_LIGHT,tables:[FIELD_HEIGHTS,FIELD_CARD_WIDTHS,FIELD_LEAF,FIELD_BLOOMS,FIELD_DENSITIES]};
  const expected={"card":"fc91555a8e738428b34e4f9d01341c16301f4cd5e3159c084957defe7fb02c48","silhouette":"b85307d5436ea22b7e820d2a8c95e34fffd5787f019405b374ffbf93622859a7","light":"f4cc4e4a470f20878f813ab1df282f645266771947e6f51524c6338ec2f6c6fa","tables":"d90e582889fb73a99284e3a063f106129b60c740cd17d0d92c94a75399b356f0"};
  for(const [name,value] of Object.entries(entries))assert.equal(digest(value),expected[name],name);
});

test('active wind, push, flat-card and lighting calculations and packed vertices match the parent baseline',()=>{
  const body=fieldVertexBody();
  assert.equal(digest(body.slice(body.indexOf('vec3 transformed'))),'470f2da2bf7f134d515183436e61c88cca8f1d692014669925d0bd831c38a538');
  assert.equal(createHash('sha256').update(Buffer.from(fieldPlantKit().positions.buffer)).digest('hex'),'bec9525c9ba3daaaefff2a97b9662a0146d21d476b1822b9dcd276e34d4f976f');
});
