import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { POINTER_LOCK_GUARD } from './pointerlock-guard.mjs';
export function chromeArgs(port,profile) {
  return ['--headless=new','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist','--no-first-run',`--user-data-dir=${profile}`,`--remote-debugging-port=${port}`,'--remote-debugging-address=127.0.0.1','about:blank'];
}
export function initScript(inject=false) {
  return POINTER_LOCK_GUARD.pretend + `
  if (navigator.pointer) navigator.pointer.lock = () => {};
  ` + (inject ? `(() => {
    let injected = false;
    for (const Context of [globalThis.WebGLRenderingContext, globalThis.WebGL2RenderingContext]) {
      if (!Context) continue;
      const original = Context.prototype.shaderSource;
      Context.prototype.shaderSource = function(shader, source) {
        if (!injected && this.getShaderParameter(shader, this.SHADER_TYPE) === this.FRAGMENT_SHADER && /void\\s+main\\s*\\(/.test(source)) {
          source = source.replace(/void\\s+main\\s*\\([^)]*\\)\\s*\\{/, '$&\\nfloat kzBad=position.y--0.013;\\n');
          injected = true; globalThis.__ciBadGlslInjected = true;
        }
        return original.call(this, shader, source);
      };
    }
  })();` : '');
}
export function validateAllowlist(entries) {
  if(!Array.isArray(entries) || entries.some(e=>e.level!=='warning'||typeof e.message!=='string'||!e.message||typeof e.reason!=='string'||!e.reason.trim()))throw Error('Allowlist entries need warning level, exact message and reason');
  return entries;
}
export function collectEvent(method,p) {
  if(method==='Runtime.exceptionThrown')return {level:'error',source:method,text:p.exceptionDetails?.exception?.description||p.exceptionDetails?.text||'Page exception'};
  if(method==='Runtime.consoleAPICalled' && ['error','warning','warn'].includes(p.type))return {level:p.type==='error'?'error':'warning',source:method,text:(p.args||[]).map(a=>a.value!==undefined?String(a.value):a.description||a.type).join(' ')};
  if(method==='Log.entryAdded' && ['error','warning'].includes(p.entry?.level))return {level:p.entry.level,source:method,text:p.entry.text};
  if(method==='Network.responseReceived' && p.response.status>=400)return {level:'error',source:method,text:`HTTP ${p.response.status} ${p.response.url}`};
  if(method==='Network.loadingFailed' && !p.canceled)return {level:'error',source:method,text:p.errorText};
  return null;
}
export const isShaderError=e=> /(?:shader|glsl|validate_status|linkProgram|compile)/i.test(e.text)&&e.level==='error';
export function unexpectedEvents(events,allowlist) {
  validateAllowlist(allowlist);
  // Driver messages carry a per-run context address (0x...): compare with addresses normalised.
  const norm=t=>String(t).replace(/0x[0-9a-f]+/gi,'0x0');
  return events.filter(e=>isShaderError(e)||!allowlist.some(a=>a.level===e.level&&norm(a.message)===norm(e.text)));
}
// Acquire/release is shared with the runner; injectable launcher makes failure paths testable without Chrome.
export async function withChrome({binary,port,parent,launch=spawn},work) {
  const profile=await fs.mkdtemp(parent+'/chrome-');let child;
  try {
    child=launch(binary,chromeArgs(port,profile),{stdio:['ignore','ignore','pipe']});
    // Register immediately: spawn failures must not become unhandled error events.
    let launchError;child.on('error',e=>{launchError=e;});
    return await work(child,()=>launchError);
  } finally {
    try {
      if(child && child.exitCode===null && child.signalCode===null){
        const closed=once(child,'close').catch(()=>{});child.kill('SIGTERM');
        let timer;await Promise.race([closed,new Promise(resolve=>{timer=setTimeout(()=>{child.kill('SIGKILL');resolve();},1500);})]);clearTimeout(timer);
      }
    } finally {await fs.rm(profile,{recursive:true,force:true});}
  }
}
