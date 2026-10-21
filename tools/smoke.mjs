// Checks local HTTP delivery, not rendered WebGL or browser interaction.
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
const server=createServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}`;
try{
 for(const [url,type] of [['/','text/html'],['/app.js','text/javascript'],['/ui.js','text/javascript'],['/collision.js','text/javascript'],...['gameplay','interactions','save','audio','quest-view','environment'].map(name=>['/'+name+'.js','text/javascript']),['/style.css','text/css'],['/assets/collision.json','application/json'],['/assets/scene.glb','model/gltf-binary'],['/vendor/three.module.min.js','text/javascript'],['/vendor/three.core.min.js','text/javascript'],['/vendor/loaders/GLTFLoader.js','text/javascript'],['/vendor/utils/BufferGeometryUtils.js','text/javascript']]){
  const r=await fetch(base+url);assert.equal(r.status,200,url);assert(r.headers.get('content-type').startsWith(type),url);assert((await r.arrayBuffer()).byteLength>0,url);
 }
 assert.equal((await fetch(base+'/missing-file')).status,404);
 assert.equal((await fetch(base+'/',{method:'POST'})).status,405);
 assert.equal((await fetch(base+'/%2e%2e%2fpackage.json')).status,403);
 assert.equal((await fetch(base+'/assets/scene.glb',{method:'HEAD'})).status,200);
 console.log('HTTP smoke passed: 17 routes, MIME types, GET/HEAD, missing path, method and traversal handling. Browser/WebGL not tested by this command.');
}finally{server.closeAllConnections?.();await new Promise(resolve=>server.close(resolve));}
