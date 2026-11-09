import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EventEmitter } from 'node:events';
import { chromeArgs, initScript, collectEvent, validateAllowlist, unexpectedEvents, withChrome } from '../tools/lib/gl-smoke-core.mjs';
test('Chrome uses software GL, a free-port parameter and an isolated profile',()=>{
  const args=chromeArgs(43210,'profile-test');
  for(const arg of ['--headless=new','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-first-run','--user-data-dir=profile-test','--remote-debugging-port=43210'])assert.ok(args.includes(arg),arg);
  assert.ok(!args.includes('--no-sandbox'));
});
test('CDP exceptions, console errors/warnings, browser logs, HTTP failures and network failures are collected',()=>{
  for(const [method,p,text] of [
    ['Runtime.exceptionThrown',{exceptionDetails:{exception:{description:'boom'}}},'boom'],
    ['Runtime.consoleAPICalled',{type:'error',args:[{value:'bad'},{description:'Error detail'}]},'bad Error detail'],
    ['Runtime.consoleAPICalled',{type:'warning',args:[{value:'warn'}]},'warn'],
    ['Log.entryAdded',{entry:{level:'warning',text:'GL warning'}},'GL warning'],
    ['Network.responseReceived',{response:{status:404,url:'/missing'}},'HTTP 404 /missing'],
    ['Network.loadingFailed',{errorText:'net failure'},'net failure']])assert.equal(collectEvent(method,p).text,text);
  assert.equal(collectEvent('Runtime.consoleAPICalled',{type:'log'}),null);
  assert.equal(collectEvent('Network.loadingFailed',{canceled:true}),null);
  assert.equal(collectEvent('Network.responseReceived',{response:{status:200}}),null);
});
test('allowlist needs a reason and exact warning match; shader errors cannot be suppressed',()=>{
  const list=[{level:'warning',message:'known harmless',reason:'Documented software driver notice'}];
  const events=[{level:'warning',text:'known harmless'},{level:'warning',text:'known harmless extra'},{level:'error',text:'Shader compile failed'}];
  assert.equal(unexpectedEvents(events,list).length,2);
  assert.equal(unexpectedEvents(events,[]).length,3);
  assert.throws(()=>validateAllowlist([{level:'warning',message:'known harmless'}]));
  assert.throws(()=>validateAllowlist([{level:'error',message:'Shader compile failed',reason:'ignore'}]));
});
test('allowlist matching ignores per-run driver context addresses',()=>{
  const list=[{level:'warning',message:'[.WebGL-0x0]GL Driver Message: GPU stall due to ReadPixels',reason:'Chrome performance hint, not a rendering error'}];
  const events=[{level:'warning',text:'[.WebGL-0x124000d0e00]GL Driver Message: GPU stall due to ReadPixels'},{level:'warning',text:'[.WebGL-0xabc]GL Driver Message: something else'}];
  assert.deepEqual(unexpectedEvents(events,list).map(e=>e.text),['[.WebGL-0xabc]GL Driver Message: something else']);
});
function pageContext(){
  class Element{} class Document{} class GL{shaderSource(s,source){this.source=source;}getShaderParameter(s){return s;}}
  GL.prototype.FRAGMENT_SHADER=35632;GL.prototype.SHADER_TYPE=35663;
  const context={Element,Document,document:new Document(),navigator:{pointer:{lock:()=>{throw Error('native pointer called');}}},WebGLRenderingContext:GL,WebGL2RenderingContext:class extends GL{},setTimeout:fn=>fn(),Event:class{},Promise};
  context.document.dispatchEvent=()=>{};context.window=context;return context;
}
test('preload guard prevents native pointer lock; normal mode never wraps shaderSource',async()=>{
  const c=pageContext(),source=c.WebGLRenderingContext.prototype.shaderSource;vm.runInNewContext(initScript(false),c);
  await new c.Element().requestPointerLock();c.navigator.pointer.lock();assert.equal(c.WebGLRenderingContext.prototype.shaderSource,source);
});
test('bad GLSL is injected into the first fragment main only, for WebGL1 and WebGL2',()=>{
  for(const name of ['WebGLRenderingContext','WebGL2RenderingContext']){
    const c=pageContext();vm.runInNewContext(initScript(true),c);const gl=new c[name]();
    gl.shaderSource(35633,'void main() {}');assert.ok(!gl.source.includes('kzBad'));
    gl.shaderSource(35632,'void main() { }');assert.ok(gl.source.includes('float kzBad=position.y--0.013;'));assert.equal(c.__ciBadGlslInjected,true);
    gl.shaderSource(35632,'void main() {}');assert.ok(!gl.source.includes('kzBad'));
  }
});
test('profile cleanup runs on success, callback failure and launcher failure without starting Chrome',async()=>{
  const parent=await fs.mkdtemp(path.join(process.cwd(),'.ci-chrome-'));
  try{
    for(const mode of ['success','work-failure','launch-failure']){
      let killed=false,profile;
      const promise=withChrome({binary:'stub',port:12345,parent,launch(binary,args){
        profile=args.find(a=>a.startsWith('--user-data-dir=')).split('=')[1];
        if(mode==='launch-failure')throw Error(mode);
        const child=new EventEmitter();child.exitCode=null;child.signalCode=null;
        child.kill=()=>{killed=true;child.signalCode='SIGTERM';queueMicrotask(()=>child.emit('close',0));};return child;
      }},async()=>{if(mode==='work-failure')throw Error(mode);return 'ok';});
      if(mode==='success')assert.equal(await promise,'ok');else await assert.rejects(promise,new RegExp(mode));
      assert.equal(killed,mode!=='launch-failure');await assert.rejects(fs.stat(profile),{code:'ENOENT'});
    }
  }finally{await fs.rm(parent,{recursive:true,force:true});}
});
