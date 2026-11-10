import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { THREE,load } from './helpers/tree-modules.mjs';
import { FAR_SHADOW_GLSL } from '../dist/valley/kamakura-far-shadow.js';
import { lightFinalShader } from '../dist/valley/kamakura-sky-fx.js';
import { postOptions } from '../dist/valley/kamakura-post.js';
const {POST_SHADERS,createKamakuraPost}=await load('kamakura-post-view.js');
const expand=s=>s.replace(/#include <(\w+)>/g,(_,key)=>{assert.equal(typeof THREE.ShaderChunk[key],'string',key+' exists');return expand(THREE.ShaderChunk[key]);});
function safety(shader){
  const code=shader.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,''),stack=[];
  for(const c of code){if('([{'.includes(c))stack.push(c);else if(')]}'.includes(c))assert.equal(stack.pop(),'([{'[')]}'.indexOf(c)]);}assert.equal(stack.length,0);
  assert(!/--\s*\d|\b\d+(?:\.\d*)?(?:float|vec[234]|int)\b/.test(code));
  assert(!/\b(?:float|int|vec[234]|sampler2D)\s+(?:input|output|filter|sample|common|active|partition|resource)\b/.test(code));
  for(const args of FAR_SHADOW_GLSL.matchAll(/(?:smoothstep|step|max|min|mix)\(([^()]+)\)/g))for(const value of args[1].split(','))assert(!/^\s*\d+\s*$/.test(value));
}
test('all final variants validate delimiters, reserved names, numeric interpolation, anchors, uniform supply; farshadow=0 retains original shader string',()=>{
  for(const cloud of [false,true])for(const mist of [false,true])for(const shafts of [false,true])for(const mode of ['', 'farshadow','farshadowmap']){
    const options={...postOptions(''),cloud,mist,shafts,farshadow:true,postdebug:mode},code=lightFinalShader(POST_SHADERS.final,options);safety(expand(code));
    assert(code.includes('kzFarShadow(farPoint,farNormal)'));
    assert(code.indexOf('c=kzFarApply')<code.indexOf('float cloudAmount')||!cloud);
    assert(code.indexOf('c=kzFarApply')<code.indexOf('float mistAmount')||!mist);
    const old=lightFinalShader(POST_SHADERS.final,{...options,farshadow:false,postdebug:''});
    assert.equal(old,lightFinalShader(POST_SHADERS.final,{...options,farshadow:undefined,postdebug:''}));
  }
  const source=POST_SHADERS.final;assert(source.includes('void main(){'));assert(source.includes('if(bloomStrength>0.)'));
  const draws=[],renderer={getDrawingBufferSize:v=>v.set(640,360),getRenderTarget:()=>null,setRenderTarget(){},render:s=>draws.push(s.children[0]?.material),autoClear:true};
  const p=createKamakuraPost({renderer,sunDir:new THREE.Vector3(-1,1,1),terrain:{bounds:{minX:-10,maxX:10,minZ:-10,maxZ:10},heightAt:()=>0},farSources:{data:{}},search:'?mist=0&cloud=0&shafts=0'});
  p.render(new THREE.Scene(),new THREE.PerspectiveCamera());const final=draws.at(-1);
  for(const m of final.fragmentShader.matchAll(/uniform\s+\w+\s+([^;]+);/g))for(const n of m[1].split(','))assert(Object.hasOwn(final.uniforms,n.trim()),n+' supplied');p.dispose();
  assert.throws(()=>safety('void main(){float sample=0.0;}'));assert.throws(()=>safety('void main(){float n=1.--0.2;}'));
});
test('installed GLSL compiler checks final fragment programs including derivatives, sampler arguments, float/int and all debug variants',async t=>{
  const available=spawnSync('glslc',['--version'],{encoding:'utf8'});if(available.error?.code==='ENOENT'){t.skip('glslc unavailable; static validation still runs');return;}assert.equal(available.status,0);
  const dir=await mkdtemp(join(tmpdir(),'farshadow-glsl-'));
  try{
    let compiled=0;
    for(const cloud of [false,true])for(const mist of [false,true])for(const shafts of [false,true])for(const postdebug of ['', 'farshadow','farshadowmap']){
      const program=lightFinalShader(POST_SHADERS.final,{...postOptions(''),cloud,mist,shafts,farshadow:true,postdebug});
      const code=`#version 310 es
      precision highp float;precision highp int;
      #define varying in
      #define texture2D texture
      out vec4 pc_fragColor;
      #define gl_FragColor pc_fragColor
      vec4 linearToOutputTexel(vec4 v){return v;}
      `+expand(program);
      const file=join(dir,'shadow.frag');await writeFile(file,code);
      const r=spawnSync('glslc',['--target-env=opengl','-fauto-bind-uniforms','-fauto-map-locations',file,'-o',join(dir,'shadow.spv')],{encoding:'utf8'});
      assert.equal(r.status,0,r.stderr);compiled++;
    }
    t.diagnostic(JSON.stringify({compiledFinalFragments:compiled}));
  }finally{await rm(dir,{recursive:true,force:true});}
});
