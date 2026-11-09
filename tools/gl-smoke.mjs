import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { connectCdp } from './lib/smoke-cdp.mjs';
import { chromeArgs, initScript, collectEvent, unexpectedEvents, validateAllowlist, isShaderError, withChrome } from './lib/gl-smoke-core.mjs';
export { chromeArgs, initScript, collectEvent, unexpectedEvents, withChrome };
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
export async function runSmoke({base=process.env.GL_SMOKE_URL||'http://127.0.0.1:8080',out=process.env.GL_SMOKE_OUT||'reports/local/gl-smoke',inject=false,deadlineMs=inject?120000:330000}={}) {
  await fs.mkdir(out,{recursive:true});const events=[], shots=[], started=Date.now();let cdp, failure, shaderFailure=false, stderr='';
  const allowlist=validateAllowlist(JSON.parse(await fs.readFile(new URL('./ci-smoke-allowlist.json',import.meta.url),'utf8')));
  const binary=process.env.CHROME_BIN||(process.platform==='darwin'?'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome':'google-chrome');
  let deadline;
  let interrupt;
  const stop=new Promise((_,reject)=>{interrupt=()=>reject(Error('GL smoke interrupted'));deadline=setTimeout(()=>reject(Error(`GL smoke deadline (${Math.round(deadlineMs/1000)} s); cleanup is reserved after it`)),deadlineMs);});
  // Keep cleanup reachable when the caller's timeout or terminal sends a signal.
  process.on('SIGINT',interrupt);process.on('SIGTERM',interrupt);
  stop.catch(()=>{});
  const capture=async name=>{const shot=await cdp.send('Page.captureScreenshot',{format:'png'},40000);await fs.writeFile(path.join(out,name+'.png'),Buffer.from(shot.data,'base64'));shots.push(name+'.png');};
  try {
    const port=await freePort();
    await withChrome({binary,port,parent:out},async(child,launchError)=>{
      child.stderr.on('data',b=>{stderr=(stderr+b).slice(-16000);});
      const work=async()=>{
        let target;
        for(let i=0;i<100;i++){
          if(launchError())throw launchError();if(child.exitCode!==null)throw Error('Chrome exited before CDP was ready');
          try{const r=await fetch(`http://127.0.0.1:${port}/json/list`,{signal:AbortSignal.timeout(1000)});target=(await r.json()).find(t=>t.type==='page');if(target)break;}catch{}
          await pause(100);
        }
        if(!target)throw Error('Chrome CDP did not become ready');
        cdp=await connectCdp(target.webSocketDebuggerUrl,(method,p)=>{const e=collectEvent(method,p);if(e)events.push(e);});
        for(const domain of ['Page','Runtime','Log','Network'])await cdp.send(domain+'.enable');
        await cdp.send('Emulation.setDeviceMetricsOverride',{width:960,height:640,deviceScaleFactor:1,mobile:false});
        await cdp.send('Page.addScriptToEvaluateOnNewDocument',{source:initScript(inject)});
        // Software GL on a shared runner can need many seconds per frame: waits that depend on frames get a longer budget (the run deadline still bounds everything).
        const evaluate=async (expression,timeoutMs)=>{
          const r=await cdp.send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true},timeoutMs);
          if(r.exceptionDetails)throw Error(r.exceptionDetails.text);return r.result.value;
        };
        // Existing query parameters select reproducible positions and headings; no game hook added.
        for(const [name,pos,yaw] of [['north','0,0',0],['hall','38,30',0],['shore','0,-245',180]]){
          const url=new URL('/valley/index.html',base);url.search=new URLSearchParams({world:'kamakura',debug:'1',autoscale:'0',pos,yaw:String(yaw)}).toString();
          await cdp.send('Page.navigate',{url:url.href});let ready=false;
          for(let i=0;i<450;i++){
            // The page's main thread is busy while the world boots (software GL): a slow answer is not a failure.
            let booted=false;try{booted=await evaluate(`Boolean(document.querySelector('.kz-debug')?.textContent.includes('東 ') && performance.getEntriesByName('kz-tone-ready').length)`);}catch(e){if(!/CDP timeout/.test(e.message))throw e;}
            if(booted){ready=true;break;}
            if(events.some(isShaderError)){await capture(name+'-shader-failure');throw Error('GLSL compilation failed');}
            await pause(100);
          }
          if(!ready)throw Error('HUD / kz-tone-ready did not become ready');
          // Allow the bounded chunk queues and two animation frames to reach the GPU.
          await pause(700);
          await evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))',90000);
          const status=await evaluate(`document.querySelector('.kz-state')?.textContent || ''`,60000);
          if(status)events.push({level:'error',source:'HUD',text:status});
          await capture(name);
        }
        if(inject && !await evaluate('Boolean(globalThis.__ciBadGlslInjected)',60000))throw Error('GLSL injection was not exercised');
      };
      try{await Promise.race([work(),stop]);}
      catch(e){failure=e;try{if(cdp)await capture('failure');}catch{}}
      finally{cdp?.close();}
    });
  } catch(e){failure=e;}
  finally{
    clearTimeout(deadline);process.off('SIGINT',interrupt);process.off('SIGTERM',interrupt);shaderFailure=events.some(isShaderError);
    const unexpected=unexpectedEvents(events,allowlist);
    const passed=!failure&&!unexpected.length&&!inject;
    const report={passed,inject,shaderFailure,screenshots:shots,events:unexpected,error:failure?.message||null,elapsedMs:Date.now()-started,programCoverage:'unavailable: no existing renderer hook'};
    await fs.writeFile(path.join(out,'result.json'),JSON.stringify(report,null,2)+'\n');
    await fs.writeFile(path.join(out,'chrome.log'),stderr);
    console.log(`${passed?'PASS':'FAIL'} GL smoke: ${shots.length} PNG, ${unexpected.length} errors/warnings${failure?' · '+failure.message:''}`);
    if(!passed)process.exitCode=1;
    return report;
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await runSmoke({inject:process.argv.includes('--inject-bad-glsl')});
