// Checks local HTTP delivery, not rendered WebGL or browser interaction.
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try{
 for(const [url,type] of [['/','text/html'],['/app.js','text/javascript'],['/ui.js','text/javascript'],['/collision.js','text/javascript'],...['gameplay','interactions','save','audio','quest-view','environment','life-view','places','terrain-materials'].map(name=>['/'+name+'.js','text/javascript']),...['polyhaven-dirt_floor/dirt_floor_diff_1k.jpg','polyhaven-dirt_floor/dirt_floor_nor_gl_1k.jpg','polyhaven-dirt_floor/dirt_floor_rough_1k.jpg','polyhaven-forest_leaves_02/forest_leaves_02_diffuse_1k.jpg','polyhaven-forest_leaves_02/forest_leaves_02_nor_gl_1k.jpg','polyhaven-forest_leaves_02/forest_leaves_02_rough_1k.jpg'].map(file=>['/assets/terrain/'+file,'image/jpeg']),...['fir_tree_01_twig_diff_1k.jpg','fir_tree_01_twig_alpha_1k.jpg'].map(file=>['/assets/foliage/polyhaven-fir_tree_01/'+file,'image/jpeg']),['/style.css','text/css'],['/assets/collision.json','application/json'],['/assets/scene.glb','model/gltf-binary'],['/vendor/three.module.min.js','text/javascript'],['/vendor/three.core.min.js','text/javascript'],['/vendor/loaders/GLTFLoader.js','text/javascript'],['/vendor/utils/BufferGeometryUtils.js','text/javascript']]){
  const r=await fetch(base+url);assert.equal(r.status,200,url);assert(r.headers.get('content-type').startsWith(type),url);assert((await r.arrayBuffer()).byteLength>0,url);
 }
 // 縦切り（/valley/）：入口・モジュール・素材が MIME つきで配られる
 {const fs=await import('node:fs');const {root}=await import('./serve.mjs');const types={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.glb':'model/gltf-binary','.jpg':'image/jpeg','.webp':'image/webp'};
  const files=['valley',...['assets/valley/terrain','assets/valley/models','assets/characters']].flatMap(d=>fs.readdirSync(root+'/'+d,{withFileTypes:true}).filter(e=>e.isFile()).map(e=>d+'/'+e.name)).filter(f=>types[f.slice(f.lastIndexOf('.'))]);
  for(const f of files){const r=await fetch(base+'/'+f);assert.equal(r.status,200,f);assert(r.headers.get('content-type').startsWith(types[f.slice(f.lastIndexOf('.'))]),f);assert((await r.arrayBuffer()).byteLength>0,f);}
  console.log('Valley routes: '+files.length+' files served with MIME types.');}
 assert.equal((await fetch(base+'/missing-file')).status,404);
 assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
 assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,403);
 assert.equal((await fetch(base+'/assets/scene.glb',{method:'HEAD'})).status,200);
 console.log('HTTP smoke passed: 28 routes, MIME types, GET/HEAD, missing path, method and traversal handling. Browser/WebGL not tested by this command.');
}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
