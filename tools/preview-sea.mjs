// Synthetic top views of the shipped sea3 mirror. No private data, browser or dependencies.
import {mkdir,writeFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {encodePNG} from './lib/png.mjs';
import {BACKDROP,backdropPoint} from '../dist/valley/kamakura-backdrop.js';
import {createSignedShoreJob} from '../dist/valley/kamakura-shore.js';
import {seaColor4} from '../dist/valley/kamakura-shore-r4.js';
import * as THREE from '../dist/vendor/three.module.min.js';
import {facilityPlacement} from '../dist/valley/kamakura-facilities.js';
import {withStairRamps} from '../dist/valley/kamakura-stairs.js';
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

// Detail review: synthetic stair mesh/terrain cross-sections and directional ring surf.
export const PREVIEW_DETAIL=Object.freeze({
  lowM:13.5,riseM:7.5,lengthM:20,widthM:10,riserM:.18,earM:.22,skirtM:.3,humanM:1.66,
  sectionWidth:1600,sectionHeight:420,fromDeg:180
});
export function detailStairFixture(){
  const c=PREVIEW_DETAIL,steps=Math.ceil(c.riseM/c.riserM),positions=[],indices=[];
  function box(x,y,z,w,h,d,shear=0){
    const g=new THREE.BoxGeometry(w,h,d),a=g.attributes.position.array;
    for(let i=0;i<a.length;i+=3)a[i+1]+=shear*a[i+2];
    const offset=positions.length/3;for(let i=0;i<a.length;i+=3)positions.push(a[i]+x,a[i+1]+y,a[i+2]+z);
    for(const id of g.index.array)indices.push(offset+id);g.dispose();
  }
  for(let i=0;i<steps;i++){
    const top=(i+1)/steps*c.riseM,run=c.lengthM/steps;
    box(0,(top-c.skirtM)/2,(i+.5)*run,c.widthM,top+c.skirtM,run);
  }
  for(const side of [-1,1])box(side*(c.widthM+c.earM)/2,c.riseM/2+c.earM/2,c.lengthM/2,c.earM,c.earM,c.lengthM,c.riseM/c.lengthM);
  const node={node:'synthetic-stair',part:'stairs',soft:true,anchor_xz:[0,0],rel_anchor:0,steps:{from_xz:[0,0],to_xz:[0,c.lengthM],rise_m:c.riseM,width_m:c.widthM}};
  const terrain={heightAt:(_x,z)=>c.lowM+c.riseM*Math.max(0,Math.min(1,z/c.lengthM)),slopeAt:()=>Math.atan(c.riseM/c.lengthM)*180/Math.PI,walkable:()=>true};
  return {node,terrain,positions:new Float32Array(positions),indices,steps};
}
export async function renderDetailPreview(outDir,{time=2,zoom=false}={}){
  await mkdir(outDir,{recursive:true});const c=PREVIEW_DETAIL,f=detailStairFixture(),ramp=withStairRamps(f.terrain,[f.node]);
  let clipMin=0,clipMax=c.sectionWidth;
  const sw=c.sectionWidth,sh=c.sectionHeight,pixels=new Uint8Array(sw*sh*4);pixels.fill(255);
  const dot=(x,y,color,size=1)=>{for(let a=-size;a<=size;a++)for(let b=-size;b<=size;b++){const px=Math.round(x+a),py=Math.round(y+b);if(px>=clipMin&&px<clipMax&&py>=0&&py<sh){const k=(py*sw+px)*4;pixels.set([...color,255],k);}}};
  const line=(x,y,xx,yy,color,size=1)=>{const n=Math.max(1,Math.ceil(Math.hypot(xx-x,yy-y)));for(let i=0;i<=n;i++)dot(x+(xx-x)*i/n,y+(yy-y)*i/n,color,size);};
  const colors={terrain:[158,112,57],model:[48,58,75],walk:[20,173,75],ear:[150,150,165],human:[170,45,170]};
  for(const [panel,on] of [false,true].entries()){
    clipMin=panel*sw/2;clipMax=(panel+1)*sw/2;
    const placed=facilityPlacement(f.node,f.positions,f.terrain,{search:on?'':'?steps=0'}),walk=on?ramp:f.terrain;
    const x0=panel*sw/2+35,y0=sh-45,scale=zoom?96:28,from=zoom==='lower'?-1:zoom?c.lengthM-5:-2,base=zoom==='lower'?c.lowM-1:zoom?c.lowM+c.riseM-2:c.lowM-1;
    const project=(z,y)=>[x0+(z-from)*scale,y0-(y-base)*scale];
    // Terrain and the centre cut through actual, placed box triangles.
    for(let k=0;k<f.indices.length;k+=3){
      const ids=f.indices.slice(k,k+3),hits=[];
      for(let e=0;e<3;e++){
        const a=ids[e]*3,b=ids[(e+1)%3]*3,ax=placed.positions[a],bx=placed.positions[b];
        if((ax<=0&&bx>0)||(ax>0&&bx<=0)){const t=-ax/(bx-ax);hits.push([placed.positions[a+2]+t*(placed.positions[b+2]-placed.positions[a+2]),placed.position.y+placed.positions[a+1]+t*(placed.positions[b+1]-placed.positions[a+1])]);}
      }
      if(hits.length===2){const a=project(...hits[0]),b=project(...hits[1]);line(...a,...b,colors.model,0);}
    }
    // Ear stones in side projection, dashed to keep the centre cut readable.
    for(let z=0;z<c.lengthM;z+=.03)if(Math.floor(z/.25)%2===0){const p=project(z,c.lowM+c.riseM*z/c.lengthM+c.earM);dot(...p,colors.ear,0);}
    for(let x=0;x<sw/2-70;x++){
      const z=from+x/scale,ground=f.terrain.heightAt(0,z),h=walk.heightAt(0,z);
      dot(...project(z,ground),colors.terrain,0);dot(...project(z,h),colors.walk,0);
    }
    for(const z of zoom==='lower'?[0,3]:zoom?[c.lengthM-3,c.lengthM]:[0,10,c.lengthM]){
      const h=walk.heightAt(0,z),foot=project(z,h),head=project(z,h+c.humanM);line(...foot,...head,colors.human,1);
      line(head[0]-4,head[1],head[0]+4,head[1],colors.human,1);
    }
    // Fixed colour key: terrain, model, walking height, ear stone, 1.66m human.
    Object.values(colors).forEach((color,i)=>line(panel*sw/2+30+i*130,24,panel*sw/2+100+i*130,24,color,2));
  }
  await writeFile(path.join(outDir,'stairs-section.png'),encodePNG({width:sw,height:sh,data:pixels}));
  const terrain=previewEdgesTerrain(),plain=createSignedShoreJob(terrain),directional=createSignedShoreJob(terrain,{sea:{swell_from_deg:c.fromDeg}});
  while(!plain.step(4096));while(!directional.step(4096));
  const e=PREVIEW_EDGES,w=(e.maxX-e.minX)/e.pixelM,h=(e.maxZ-e.minZ)/e.pixelM,panels=new Uint8Array(w*3*h*4),sample={},rgb=[0,0,0];
  for(let row=0;row<h;row++)for(let col=0;col<w;col++){
    const x=e.minX+(col+.5)*e.pixelM,z=e.minZ+(row+.5)*e.pixelM,land=terrain.heightAt(x,z)>0,d=directional.field.signedDistanceAt(x,z);
    sea3Color(d,rgb);
    for(let p=0;p<3;p++){
      const gain=(p?directional:plain).field.opennessAt(x,z),k=(row*w*3+p*w+col)*4;
      sea3Sample(d,x,z,time,e.pixelM,300,'standard',0,sample,gain);
      for(let i=0;i<3;i++)panels[k+i]=srgb(land?sand[i]:p===2?rgb[i]+([1,.5,0][i]-rgb[i])*(plain.field.opennessAt(x,z)-gain):rgb[i]+(film[i]-rgb[i])*sample.foam);
      panels[k+3]=255;
    }
  }
  await writeFile(path.join(outDir,'swell-compare.png'),encodePNG({width:w*3,height:h,data:panels}));
  const info={time,zoom,section:{columns:['steps=0','steps=1'],key:colors,stairTriangles:f.indices.length/3,steps:f.steps,humanM:c.humanM},swell:{columns:['swell=0, shelter=1','south swell, shelter=1','orange = directional reduction'],fromDeg:c.fromDeg,reducedFraction:directional.swellReducedFraction,work:directional.work,addedWork:directional.work-plain.work,triangles:2,draws:1}};
  await writeFile(path.join(outDir,'detail-preview.json'),JSON.stringify(info,null,2)+'\n');ramp.disposeStairs();return info;
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const index=process.argv.indexOf('--out');if(index<0||!process.argv[index+1])throw new Error('Usage: node tools/preview-sea.mjs --out <directory>');
  console.log(JSON.stringify(process.argv.includes('--detail')?await renderDetailPreview(process.argv[index+1],{time:process.argv.includes('--time')?Number(process.argv[process.argv.indexOf('--time')+1]):2,zoom:process.argv.includes('--lower')?'lower':process.argv.includes('--zoom')}):process.argv.includes('--edges')?await renderEdgesPreview(process.argv[index+1],{time:process.argv.includes('--time')?Number(process.argv[process.argv.indexOf('--time')+1]):PREVIEW_EDGES.timeS}):await renderSeaPreview(process.argv[index+1])));
}
