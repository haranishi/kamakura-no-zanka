import test from 'node:test';
import assert from 'node:assert/strict';
import { load, THREE } from './helpers/tree-modules.mjs';
import { wind } from './helpers/tree-field.mjs';
import { barkMeters, crownGradient, foliageColor, vegVariation, leafTransmission, vegLookEnabled, applyVegLook } from '../dist/valley/kamakura-veg-look.js';
import { photoBlendUniform } from '../dist/valley/kamakura-photo-tex.js';
const { buildKamakuraVeg } = await load('kamakura-veg-view.js');
const { buildKamakuraStands } = await load('kamakura-stand-view.js');
const { treeGeometry } = await load('tree-geometry.js');
const { treeMaterials } = await load('tree-materials.js');
const sunDir = new THREE.Vector3(.3,.4,.5).normalize();
function shader(material) {
  const s = { uniforms: {}, vertexShader: THREE.ShaderLib.lambert.vertexShader, fragmentShader: THREE.ShaderLib.lambert.fragmentShader };
  material.onBeforeCompile(s); return s;
}
function balanced(s) {
  s = s.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'');
  const stack = [], pairs = { ')':'(', '}':'{', ']':'[' };
  for (const c of s) { if ('({['.includes(c)) stack.push(c); else if (')}]'.includes(c)) assert.equal(stack.pop(),pairs[c]); }
  assert.equal(stack.length,0);
  const pp = [];
  for (const line of s.split('\n')) { if (/^\s*#if/.test(line)) pp.push(line); if (/^\s*#endif/.test(line)) assert.ok(pp.pop()); }
  assert.equal(pp.length,0);
  assert.doesNotMatch(s,/\b(?:float|vec[234]|mat[234])\s+(?:patch|sample|input|output|filter|common|active|partition|resource|texture)\b/);
}
function tube(radius) {
  const sides = 32, pos = [], uv = [];
  for (const y of [0,2,4]) for (let k=0;k<=sides;k++) {
    pos.push(radius*Math.cos(k/sides*Math.PI*2),y,radius*Math.sin(k/sides*Math.PI*2));
    uv.push(k/sides*Math.max(1,Math.round(2*Math.PI*radius/1.4)),y/radius);
  }
  const g = new THREE.BufferGeometry(); g.setAttribute('position',new THREE.Float32BufferAttribute(pos,3)); g.setAttribute('uv',new THREE.Float32BufferAttribute(uv,2)); return g;
}
test('bark metres follow circumference and height for different trunk diameters and instance scales', () => {
  for (const r of [.2,.5,1]) {
    const g=tube(r), m=barkMeters(g), circumference=64*r*Math.sin(Math.PI/32);
    assert.ok(Math.abs(m[64]-circumference)<1e-5); assert.ok(Math.abs(m[65]-0)<1e-6);
    assert.ok(Math.abs(m[(66)*2+1]-4)<1e-5);
    assert.ok(Math.abs((m[2]-m[0])/(2*r*Math.sin(Math.PI/32))-1)<1e-5);
    g.dispose();
  }
});
test('crown gradient is monotonic, centre minimum, exterior maximum; no shadow transmission', () => {
  assert.equal(crownGradient(0),.72); assert.equal(crownGradient(1),1); assert.equal(crownGradient(3),1);
  for(let i=1;i<=100;i++) assert.ok(crownGradient(i/100)>=crownGradient((i-1)/100));
  for(const rim of [0,.5,1]) for(const back of [0,.5,1]) assert.equal(leafTransmission(0,rim,1,back),0);
  assert.ok(leafTransmission(1,1,1,1)<=.035); assert.equal(leafTransmission(1,1,0,1),0);
});
test('world hash varies brightness within ±15% and HSV saturation falls 18%', () => {
  const gains=[];
  const saturation = c => (Math.max(...c)-Math.min(...c))/Math.max(...c);
  for(let i=0;i<1024;i++) {
    const v=vegVariation(i*3.17,i%29,1), gain=v[1]; gains.push(gain);
    assert.ok(gain>=.85 && gain<=1.15);
    const c=[.12,.3,.08].map((x,k)=>x*v[k]), out=foliageColor(c);
    assert.ok(Math.abs(saturation(out)/saturation(c)-.82)<1e-12);
    assert.equal(vegVariation(i*3.17,i%29,1)[1],gain);
  }
  const avg=gains.reduce((a,b)=>a+b)/gains.length, sd=Math.sqrt(gains.reduce((a,b)=>a+(b-avg)**2,0)/gains.length);
  assert.ok(sd>.08 && sd<.095); console.log(`veg5 brightness sd=${sd.toFixed(6)}; saturation reduction=18%`);
  assert.ok(vegVariation(1,2,0)[2]>vegVariation(1,2,1)[2]);
});
test('all tree species/LODs compile balanced shader strings; one bark read and perturb outside branches', () => {
  const family = treeMaterials({wind,sunDir});
  try {
    for(const species of [0,1,2,3,4,5]) for(const level of (species >= 4 ? [0,1] : [0,1,2])) for(const leaf of [false,true]) {
      const specimen=treeGeometry(species,level), geometry=specimen.leaf;
      const metric=barkMeters(specimen.wood);
      assert.ok(metric.every(Number.isFinite));
      for(let i=0;i<specimen.wood.attributes.uv.count;i++) if(specimen.wood.attributes.uv.getX(i)<0) assert.equal(metric[i*2],-1);
      const m=family.get(species,level)[leaf?'leaf':'wood'];
      applyVegLook(m,{lightsChunk:THREE.ShaderChunk.lights_fragment_begin,species,leaf,geometry,sunDir,strength:{value:1}});
      const s=shader(m); balanced(s.vertexShader); balanced(s.fragmentShader);
      assert.equal(s.uniforms.uKzPhoto,photoBlendUniform);
      if(!leaf) {
        assert.equal((s.fragmentShader.match(/= kzPhoto\(uKzBark/g)||[]).length,1);
        assert.equal((s.fragmentShader.match(/normal = kzPerturbNormal\(/g)||[]).length,1);
        assert.match(s.vertexShader,/length\(instanceMatrix\[0\].xyz\)/);
        assert.match(s.fragmentShader,/15\.0,60\.0/); assert.match(s.fragmentShader,/40\.0,150\.0/);
        assert.ok(s.uniforms.uKzBark);
      } else {
        assert.match(s.fragmentShader,/1.0-uKzVeg\*uKzPhoto/);
        assert.match(s.fragmentShader,/kzFacing\*kzVisible\*kzLook/);
        assert.doesNotMatch(s.fragmentShader,/getShadowMask/);
        assert.match(s.fragmentShader,/kzSunVisibility = getShadow/);
      }
    }
  } finally { family.dispose(); }
});
test('veg5=0 leaves old tree shader and cloned buffers intact; valley materials stay green', () => {
  assert.equal(vegLookEnabled('?veg5=0'),false);
  const item={x:0,y:0,z:0,species:1,shape:0,height:12,color:[.1,.2,.1],lean:0,yaw:0,tint:0,phase:0};
  for(const search of ['?veg5=0','']) {
    const v=buildKamakuraVeg({active:[item],grid:new Map()},{wind,sunDir,search});
    try {
      const set=v.sets.get('1/0/0'), s=shader(set.leaf.material);
      assert.equal(s.fragmentShader.includes('kzLook'),search==='');
      assert.equal(!!set.wood.geometry.attributes.aKzBarkMeters,search==='');
      assert.equal(set.leaf.geometry.attributes.position.array.length,treeGeometry(1,0).leaf.attributes.position.array.length);
    } finally {v.dispose();v.dispose();}
  }
  const m=treeMaterials({wind,sunDir});
  try { assert.doesNotMatch(shader(m.get(1,0).leaf).fragmentShader,/kzLook/); assert.equal(treeGeometry(1,0).wood.attributes.aKzBarkMeters,undefined); } finally {m.dispose();}
});
test('distant stands share foliage rules per instance and keep fog and stable resources', () => {
  const item={tier:2,species:0,x:0,y:0,z:0,height:20,crown:4,color:[.1,.2,.1]};
  const prepared={policy:{hide:[[0,0],[100,180],[500,800]],ranges:[0,5000,8000]},distant:new Map([['test',[item]]]),grid:new Map()};
  for(const search of ['', '?veg5=0']) {
    const view=buildKamakuraStands(prepared,{wind,sunDir,search});
    try {
      const mesh=view.distant[0].mesh, s=shader(mesh.material); balanced(s.vertexShader); balanced(s.fragmentShader);
      assert.match(s.fragmentShader,/#include <fog_fragment>/);
      assert.equal(s.fragmentShader.includes('kzLook'),search==='');
      if(!search) assert.equal(mesh.geometry.attributes.aKzSpecies.getX(0),0);
    } finally { view.dispose(); view.dispose(); }
  }
});
test('baked far boards tint only leaves and reuse the existing directional shadow lookup', async () => {
  const { impostorMaterial } = await load('tree-bake.js');
  const material = impostorMaterial({wind,sunDir,quality:'standard',frame:[0,0,1,1],atlas:{albedo:null,normal:null}});
  const geometry = new THREE.PlaneGeometry(4,12);
  try {
    applyVegLook(material,{lightsChunk:THREE.ShaderChunk.lights_fragment_begin,species:1,leaf:true,geometry,sunDir,strength:{value:1},impostor:true});
    const s=shader(material); balanced(s.vertexShader); balanced(s.fragmentShader);
    assert.match(s.fragmentShader,/kzLeafMask = step\(.5,impNormal.a\)/);
    assert.equal((s.fragmentShader.match(/getShadow\( directionalShadowMap/g)||[]).length,1);
    assert.doesNotMatch(s.fragmentShader,/texture2D\(.*[Bb]ark/);
  } finally { material.dispose(); geometry.dispose(); }
});
