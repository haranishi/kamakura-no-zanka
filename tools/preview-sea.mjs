// Synthetic top views of the shipped sea3 mirror. No private data, browser or dependencies.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodePNG} from './lib/png.mjs';
import {BACKDROP,backdropPoint} from '../dist/valley/kamakura-backdrop.js';
import {createSignedShoreJob} from '../dist/valley/kamakura-shore.js';
import {seaColor4} from '../dist/valley/kamakura-shore-r4.js';
import {sea3Sample,sea3Color} from '../dist/valley/kamakura-sea-far.js';
export const PREVIEW_SEA=Object.freeze({widthM:600,heightM:300,pixelM:.5,minX:-300,minZ:-90,terrainCellM:2,islandRadiusM:15,ringRadiusM:70,ringWidthM:9,openingRad:.28,centreZ:60,slope:.2,rangeM:300,times:Object.freeze([0,2,4])});
export function previewTerrain(scene) {
  if(!['beach','island','ring'].includes(scene))throw new RangeError('Unknown sea scene');
  const c=PREVIEW_SEA;
  const distance=(x,z)=>{
    if(scene==='beach')return z;
    const dz=z-c.centreZ,r=Math.hypot(x,dz);
    if(scene==='island')return r-c.islandRadiusM;
    const angle=Math.atan2(x,dz);
    // Distance to the ends of the open circular wall inside the missing arc.
    if(Math.abs(angle)<c.openingRad)return Math.hypot(x-Math.sign(x||1)*Math.sin(c.openingRad)*c.ringRadiusM,dz-Math.cos(c.openingRad)*c.ringRadiusM)-c.ringWidthM/2;
    return Math.abs(r-c.ringRadiusM)-c.ringWidthM/2;
  };
  return {cell:c.terrainCellM,bounds:{minX:c.minX,maxX:c.minX+c.widthM,minZ:c.minZ,maxZ:c.minZ+c.heightM},heightAt:(x,z)=>-distance(x,z)*c.slope,isSea:(x,z)=>distance(x,z)>0};
}
const sand=seaColor4(0,[0,0,0],[0,0,0]),film=[.56,.63,.60]; // Existing shore4 sand and shore3 surface film, without scene lighting.
const srgb=v=>Math.round(255*Math.max(0,Math.min(1,v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055)));
export async function renderSeaPreview(outDir) {
  await mkdir(outDir,{recursive:true});const c=PREVIEW_SEA,w=c.widthM/c.pixelM,h=c.heightM/c.pixelM,stats=[];
  for(const scene of ['beach','island','ring']){
    const terrain=previewTerrain(scene),job=createSignedShoreJob(terrain);while(!job.step(4096));
    for(const time of c.times){
      const grey=new Uint8Array(w*h*4),color=new Uint8Array(w*h*4),sample={},rgb=[0,0,0];let coverage=0;
      for(let row=0;row<h;row++)for(let col=0;col<w;col++){
        const x=c.minX+(col+.5)*c.pixelM,z=c.minZ+(row+.5)*c.pixelM,d=job.field.signedDistanceAt(x,z),k=(row*w+col)*4;
        sea3Sample(d,x,z,time,c.pixelM,c.rangeM,'standard',0,sample);sea3Color(d,rgb);
        const land=terrain.heightAt(x,z)>0,foam=land?0:sample.foam;coverage+=foam;
        for(let i=0;i<3;i++){grey[k+i]=Math.round(foam*255);color[k+i]=srgb(land?sand[i]:rgb[i]+(film[i]-rgb[i])*foam);}
        grey[k+3]=color[k+3]=255;
      }
      for(const [mode,data] of [['foam',grey],['color',color]])await writeFile(path.join(outDir,`${scene}-${time}s-${mode}.png`),encodePNG({width:w,height:h,data}));
      stats.push({scene,time,cellM:job.field.cell,foamCoverage:+(coverage/(w*h)).toFixed(4)});
    }
  }
  return stats;
}


// Entirely synthetic beach, ring wall (50m radius, 24m clear mouth) and 30m river.
export const PREVIEW_EDGES=Object.freeze({minX:-300,maxX:300,minZ:-180,maxZ:220,pixelM:1,cellM:2,harborX:120,harborZ:70,radiusM:50,wallM:8,mouthM:24,riverX:-140,riverM:30,timeS:2});
export function previewEdgesTerrain(mouth=PREVIEW_EDGES.mouthM){
  const c=PREVIEW_EDGES,angle=Math.asin((mouth+c.wallM)/(2*c.radiusM));
  function heightAt(x,z){
    const dx=x-c.harborX,dz=z-c.harborZ,r=Math.hypot(dx,dz),a=Math.atan2(dx,dz);
    const wallDistance=Math.abs(a)<angle?Math.hypot(Math.abs(dx)-Math.sin(angle)*c.radiusM,dz-Math.cos(angle)*c.radiusM):Math.abs(r-c.radiusM);
    const beach=Math.min(-z,Math.abs(x-c.riverX)-c.riverM/2);
    return Math.max(beach,c.wallM/2-wallDistance)*.2;
  }
  return {cell:c.cellM,bounds:{minX:c.minX,maxX:c.maxX,minZ:c.minZ,maxZ:c.maxZ},heightAt,isSea:(x,z)=>heightAt(x,z)<=0};
}
export async function renderEdgesPreview(outDir,{time=PREVIEW_EDGES.timeS}={}){
  await mkdir(outDir,{recursive:true});const c=PREVIEW_EDGES,w=(c.maxX-c.minX)/c.pixelM,h=(c.maxZ-c.minZ)/c.pixelM,stats=[];
  for(const mouth of [c.mouthM,60]){
    const terrain=previewEdgesTerrain(mouth),job=createSignedShoreJob(terrain);while(!job.step(4096));
    const openness=new Uint8Array(w*h*4),before=new Uint8Array(w*h*4),after=new Uint8Array(w*h*4),sample={},rgb=[0,0,0];
    for(let row=0;row<h;row++)for(let col=0;col<w;col++){
      const x=c.minX+(col+.5)*c.pixelM,z=c.minZ+(row+.5)*c.pixelM,k=(row*w+col)*4,land=terrain.heightAt(x,z)>0,d=job.field.signedDistanceAt(x,z),open=job.field.opennessAt(x,z);
      sea3Color(d,rgb);
      for(const [pixels,gain] of [[before,1],[after,open]]){
        sea3Sample(d,x,z,time,c.pixelM,300,'standard',0,sample,gain);
        for(let i=0;i<3;i++)pixels[k+i]=srgb(land?sand[i]:rgb[i]+(film[i]-rgb[i])*sample.foam);
        pixels[k+3]=255;
      }
      // Purple = sheltered, green = fully open; land uses existing sand colour.
      openness[k]=land?srgb(sand[0]):Math.round(255*(1-open));openness[k+1]=land?srgb(sand[1]):Math.round(200*open);openness[k+2]=land?srgb(sand[2]):Math.round(255*(1-open));openness[k+3]=255;
    }
    for(const [mode,pixels] of [['open',openness],['before',before],['after',after]])await writeFile(path.join(outDir,`edges-mouth${mouth}-${mode}.png`),encodePNG({width:w,height:h,data:pixels}));
    const panel=new Uint8Array(w*3*h*4);
    for(let row=0;row<h;row++)for(let mode=0;mode<3;mode++)panel.set([before,after,openness][mode].subarray(row*w*4,(row+1)*w*4),(row*w*3+mode*w)*4);
    await writeFile(path.join(outDir,`edges-mouth${mouth}-compare.png`),encodePNG({width:w*3,height:h,data:panel}));
    stats.push({mouth,timeS:time,cellM:job.field.cell,centerOpen:job.field.opennessAt(c.harborX,c.harborZ),riverOpen:job.field.opennessAt(c.riverX,-90),work:job.work,shelteredFraction:job.shelteredFraction});
  }
  // Same synthetic edge sampled at the seam and 800m outside: red=old, green=new, blue=edge.
  const width=900,height=320,pixels=new Uint8Array(width*height*4);pixels.fill(255);
  const terrain={bounds:{minX:-200,maxX:200,minZ:-200,maxZ:200},heightAt:(_x,z)=>(z+120)/4};
  const dot=(x,y,color)=>{for(let a=-1;a<=1;a++)for(let b=-1;b<=1;b++){const px=x+a,py=y+b;if(px>=0&&px<width&&py>=0&&py<height){const k=(py*width+px)*4;pixels.set([...color,255],k);}}};
  for(const elevation of [BACKDROP.landThresholdM,BACKDROP.coastRiseM]){
    const x=Math.round((elevation*4-120+140)/360*(width-1));
    for(let y=0;y<height;y++)if(y%8<4)dot(x,y,[205,205,205]);
  }
  for(let x=0;x<width;x++)dot(x,height-16,[210,210,210]);
  for(let x=0;x<width;x++){
    const z=-140+x/(width-1)*360,old=backdropPoint(terrain,1000,z,{},false),next=backdropPoint(terrain,1000,z),edge=terrain.heightAt(200,z);
    if(old.land)dot(x,Math.round(height-16-old.height*1.7),[190,40,40]);
    if(next.land)dot(x,Math.round(height-16-next.height*1.7),[25,140,55]);
    dot(x,Math.round(height-16-edge*1.7),[30,70,200]);
  }
  await writeFile(path.join(outDir,'edges-backdrop-section.png'),encodePNG({width,height,data:pixels}));
  await writeFile(path.join(outDir,'edges-preview.json'),JSON.stringify({columns:['shelter=0','shelter=1','openness: purple=0 green=1'],world:{minX:c.minX,maxX:c.maxX,minZ:c.minZ,maxZ:c.maxZ,pixelM:c.pixelM},section:{horizontal:'edge elevation -5..85m; dashed 0.5m and 30m',vertical:'height m; baseline 0m, 1.7 pixels/m',red:'old exterior at 800m',green:'new exterior at 800m',blue:'terrain edge'},scenes:stats},null,2)+'\n');
  return {scenes:stats,coastRiseM:BACKDROP.coastRiseM};
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const index=process.argv.indexOf('--out');if(index<0||!process.argv[index+1])throw new Error('Usage: node tools/preview-sea.mjs --out <directory>');
  console.log(JSON.stringify(process.argv.includes('--edges')?await renderEdgesPreview(process.argv[index+1],{time:process.argv.includes('--time')?Number(process.argv[process.argv.indexOf('--time')+1]):PREVIEW_EDGES.timeS}):await renderSeaPreview(process.argv[index+1])));
}
