// Optional real-browser performance check; runtime dependencies remain unchanged.
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import {createServer} from './serve.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));
const base=`http://127.0.0.1:${server.address().port}`;
const browser=await chromium.launch({channel:'chrome',headless:true});
const errors=[],measurements=[];
const context=await browser.newContext({viewport:{width:1440,height:900},deviceScaleFactor:1});
const page=await context.newPage();
page.on('pageerror',e=>errors.push(String(e)));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const state=()=>page.evaluate(()=>window.__walktest.state);
async function quality(value){
 if((await state()).uiState==='playing')await page.keyboard.press('Escape');
 await page.locator('[data-panel="settings"]').click();await page.locator('#quality').selectOption(value);
 await page.locator('#dialog-close').click();await page.waitForTimeout(1200);
}
async function sample(quality,kind){
 const begin=await state();
 await page.evaluate(()=>{
  const sample=window.__frameSample={times:[],last:performance.now(),active:true};
  const frame=now=>{if(!sample.active)return;sample.times.push(now-sample.last);sample.last=now;requestAnimationFrame(frame);};requestAnimationFrame(frame);
 });
 const started=performance.now(),positions=[];
 if(kind==='moving'){
  for(const key of ['w','s','w','s']){await page.keyboard.down(key);await page.waitForTimeout(2000);await page.keyboard.up(key);positions.push((await state()).player);}
 }else await page.waitForTimeout(8000);
 const duration=performance.now()-started,end=await state();
 const times=await page.evaluate(()=>{window.__frameSample.active=false;return window.__frameSample.times;});
 const sorted=times.slice(1).sort((a,b)=>a-b);
 assert.ok(sorted.length>100);assert.ok(end.stats.frames>begin.stats.frames);
 const renderedFrames=end.stats.frames-begin.stats.frames;
 assert.ok(Math.abs(times.length-renderedFrames)<6,'exactly one frame sampler runs at a time');
 const movedDistance=positions.reduce((max,p)=>Math.max(max,Math.hypot(p.x-begin.player.x,p.z-begin.player.z)),0);
 if(kind==='moving')assert.ok(movedDistance>.5,'walking segment must actually move the player');
 measurements.push({quality,kind,durationMs:duration,renderedFrames,sampledIntervals:times.length,maxDisplacementMeters:movedDistance,segmentPositions:positions,fps:(end.stats.frames-begin.stats.frames)/(duration/1000),medianMs:sorted[Math.floor(sorted.length*.5)],p95Ms:sorted[Math.floor(sorted.length*.95)],p99Ms:sorted[Math.floor(sorted.length*.99)],drawCalls:end.stats.drawCalls,triangles:end.stats.triangles,environment:end.environment,resources:end.resources,positionBefore:begin.player,positionAfter:end.player});
}
let failure;
try{
 await page.goto(base+'/?qa=1');await page.waitForFunction(()=>window.__walktest?.state.ready,null,{timeout:60000});await page.locator('#start').click();
 if((await state()).locked){await page.evaluate(()=>document.exitPointerLock());await page.waitForFunction(()=>document.body.dataset.state==='paused');await page.locator('#dialog-close').click();}
 await page.waitForTimeout(1800);
 for(const value of ['standard','light']){if(value==='light')await quality(value);await sample(value,'stationary');await sample(value,'moving');}
 // First switches may populate a program cache. Repeating the warmed modes must not add GPU resources.
 for(const value of ['standard','light'])await quality(value);const warm=(await state()).resources;
 for(const value of ['standard','light','standard','light'])await quality(value);const after=(await state()).resources;
 assert.deepEqual(after,warm,'repeated warmed quality switches retain bounded GPU resources');
 const environment=await page.evaluate(()=>{
  const gl=document.querySelector('canvas').getContext('webgl2'),debug=gl.getExtension('WEBGL_debug_renderer_info');
  return{userAgent:navigator.userAgent,renderer:debug?gl.getParameter(debug.UNMASKED_RENDERER_WEBGL):gl.getParameter(gl.RENDERER),viewport:{width:innerWidth,height:innerHeight},devicePixelRatio};
 });
 const report={schemaVersion:1,measuredAt:new Date().toISOString(),environment,measurements,qualitySwitchResources:{warm,after,passed:true},browserErrors:errors,limits:'Headless Chrome on this Mac only. Frame intervals cover the stated 8-second stationary and W/S walking segments. No physical phone or Safari result is inferred.'};
 await fs.writeFile(new URL('../reports/performance-v18.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
 for(const m of measurements)console.log(m.quality,m.kind,m.fps.toFixed(1)+'fps','p95='+m.p95Ms.toFixed(1)+'ms',m.triangles+'tri');
 console.log('Warmed quality resources stable',JSON.stringify(after));assert.deepEqual(errors,[]);
}catch(e){failure=e;console.error(e);}
finally{await context.close();await browser.close();server.closeAllConnections?.();await new Promise(r=>server.close(r));if(failure)process.exitCode=1;}
