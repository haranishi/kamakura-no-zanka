// Synthetic top views of the shipped sea3 mirror. No private data, browser or dependencies.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodePNG} from './lib/png.mjs';
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
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const index=process.argv.indexOf('--out');if(index<0||!process.argv[index+1])throw new Error('Usage: node tools/preview-sea.mjs --out <directory>');
  console.log(JSON.stringify(await renderSeaPreview(process.argv[index+1])));
}
