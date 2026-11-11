import { writeDesignedPerspective } from './designed-perspective.mjs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { encodePNG } from './png.mjs';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
import { designedStairs } from './designed-stairs.mjs';
import { createDesignedTerrain, shoreAt } from './designed-terrain.mjs';
import { northOffset } from './designed-terrain.mjs';
import { houseBox } from '../../dist/valley/kamakura-houses.js';
import { bridgeSites } from '../../dist/valley/kamakura-bridges.js';
import { createKamakuraTerrain } from '../../dist/valley/kamakura-terrain.js';
const esc=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
export async function writeDesignedPreview(directory,world) {
  const {meta,heights,surface,field,placed,nodes,veg,filled}=world,{width:w,height:h,cell_m:cell}=meta.grid,c=P.preview;
  await fs.mkdir(directory,{recursive:true});
  const colour=world.files.get('ground_rgb.bin'),a=new Uint8Array(w*h*4),b=new Uint8Array(a.length),px=x=>(x-P.grid.west)/cell,py=y=>(P.grid.north-y)/cell;
  for(let j=0;j<h;j++)for(let i=0;i<w;i++){const k=j*w+i,z=heights[k],dx=(heights[j*w+Math.min(w-1,i+1)]-heights[j*w+Math.max(0,i-1)])/(2*cell),dy=(heights[Math.max(0,j-1)*w+i]-heights[Math.min(h-1,j+1)*w+i])/(2*cell),length=Math.hypot(dx,dy,1),shade=Math.max(.3,.7+(-dx*c.light[0]-dy*c.light[1]+c.light[2])/length*.35),gain=z<=0?1:shade;
    const base=z<=0?[35,100,128]:[120+z*.6,145+z*.5,105+z*.6];for(let q=0;q<3;q++){a[k*4+q]=Math.min(255,base[q]*gain);b[k*4+q]=colour[k*3+q];}a[k*4+3]=b[k*4+3]=255;
  }
  const image=data=>`<image width="${w}" height="${h}" href="data:image/png;base64,${encodePNG({width:w,height:h,data}).toString('base64')}"/>`;
  const line=(points,stroke,width=1)=>`<polyline points="${points.map(p=>`${px(p[0])},${py(p[1])}`).join(' ')}" fill="none" stroke="${stroke}" stroke-width="${width}"/>`;
  let contours='';
  for(let j=1;j<h-2;j+=2)for(let i=1;i<w-2;i+=2){const k=j*w+i,v=[heights[k],heights[k+2],heights[k+2+2*w],heights[k+2*w]],min=Math.max(0,Math.ceil(Math.min(...v)/c.contour)*c.contour),max=Math.max(...v);for(let level=min;level<=max;level+=c.contour){const points=[],xy=[[i,j],[i+2,j],[i+2,j+2],[i,j+2]];for(let q=0;q<4;q++){const r=(q+1)%4;if((v[q]<level)!==(v[r]<level)){const t=(level-v[q])/(v[r]-v[q]);points.push([xy[q][0]+(xy[r][0]-xy[q][0])*t,xy[q][1]+(xy[r][1]-xy[q][1])*t]);}}if(points.length===2)contours+=`M${points[0]}L${points[1]}`;}}
  const svg=(title,body,legend='')=>`<svg xmlns="http://www.w3.org/2000/svg" width="${Math.round(w*c.scale)+60}" height="${Math.round(h*c.scale)+130}" viewBox="0 0 ${w+80} ${h+180}"><rect width="100%" height="100%" fill="#f6f4ec"/><text x="35" y="30" font-size="20" font-family="sans-serif">${title}</text><g transform="translate(40 50)">${body}<rect width="${w}" height="${h}" fill="none" stroke="#222"/><text x="10" y="25" font-size="18">N ↑</text></g><text x="40" y="${h+90}" font-size="14" font-family="sans-serif">${legend}</text><text x="40" y="${h+115}" font-size="13">Authored coordinates, metres. Grid ${cell}m. Sea level 0m.</text></svg>`;
  const render=async(name,source)=>{const r=spawnSync(process.env.KZ_RSVG_CONVERT||'rsvg-convert',[],{input:source,maxBuffer:32*1024*1024});if(r.error)throw r.error;if(r.status!==0)throw Error('Preview rasterization failed: '+r.stderr);await fs.writeFile(path.join(directory,name+'.png'),r.stdout);};
  await render('01-height',svg('標高・陰影・5m等高線',image(a)+`<path d="${contours}" fill="none" stroke="#244630" stroke-width=".45" opacity=".55"/>`,'青: 海 / 緑: 低地 / 淡色: 高所 / 線: 5m間隔'));
  await render('02-surface',svg('地面の種類と境界の混色',image(b),'砂 / 湿砂 / 草 / 林床 / 土 / 岩 / 石・砂利（ゲームと同じ色）'));
  let overlay=image(b);
  for(const v of veg){if(v[7])continue;overlay+=`<circle cx="${px(v[0])}" cy="${py(northOffset-v[1])}" r="1.1" fill="#103e22" opacity="${c.treeOpacity}"/>`;}
  for(const p of field.roads)overlay+=line(p.points,'#ffe9a0',p.width/cell);
  for(const p of Object.values(filled.lanes||{}))overlay+=line(p.xyz_m.map(([x,y])=>[x,y+northOffset]),'#e9ce95',p.width_m/cell);
  overlay+=line(field.river.map(p=>[p.x,p.y]),'#009be7',5);
  for(const b of [...placed.boxes,...filled.houses.instances.slice(placed.houses.length).map(p=>({...houseBox(filled.houses.kinds.get(p.kind),p.matrix),added:true}))])overlay+=`<rect x="${-b.w/cell/2}" y="${-b.d/cell/2}" width="${b.w/cell}" height="${b.d/cell}" transform="translate(${px(b.x)} ${py(northOffset-b.z)}) rotate(${-b.rotY*180/Math.PI})" fill="${b.added?'#d17e33':'#69371c'}" stroke="#fff" stroke-width=".4"/>`;
  for(const n of nodes)overlay+=`<rect x="${px(n.anchor_xz[0]+n.bbox_min[0])}" y="${py(northOffset-n.anchor_xz[1]-n.bbox_min[2])}" width="${(n.bbox_max[0]-n.bbox_min[0])/cell}" height="${(n.bbox_max[2]-n.bbox_min[2])/cell}" fill="none" stroke="#cf173d" stroke-width="1.8"/>`;
  const terrain=createKamakuraTerrain(filled),bridges=bridgeSites(filled,terrain);
  for(const s of bridges)overlay+=`<circle cx="${px(s.x)}" cy="${py(northOffset-s.z)}" r="6" fill="#ff00dd"/>`;
  overlay+=line([...meta.walk.polygon_m,meta.walk.polygon_m[0]].map(([x,y])=>[x,y+northOffset]),'#ffffff',1.5);
  for(const [id,name,x,y] of P.places) {if(id==='daibutsuden')continue;overlay+=`<text x="${px(x)+7}" y="${py(y)-7}" font-size="12" font-family="sans-serif" fill="#171717" stroke="#fff" stroke-width="2.5" paint-order="stroke">${esc(name)}</text>`;}
  await render('03-layout',svg('道・川・橋・家・施設・森・歩行境界',overlay,'黄: 道 / 青: 川 / 桃: 橋 / 茶: 目印の家 / 橙: 追加の家 / 赤枠: 施設 / 白枠: 歩行境界'));
  const sw=c.sectionWidth,sh=c.sectionHeight/2;
  let sections=`<rect width="100%" height="100%" fill="#faf8ef"/><text x="55" y="30" font-size="22">地形断面（縦: 標高m、横: 設計座標m）</text>`;
  const configs=[['大通り x=0',P.grid.south,P.grid.north,t=>field.sample(0,t).h],... [150,300,700].map(y=>[`東西 y=${y}`,P.grid.west,P.grid.east,t=>field.sample(t,y).h])];
  configs.forEach(([label,lo,hi,at],i)=>{const top=60+i*195,left=60,pw=sw-105,ph=140,xx=t=>left+(t-lo)/(hi-lo)*pw,yy=z=>top+ph-(z-P.grid.minHeight)/(P.grid.maxHeight-P.grid.minHeight)*ph;let d='';for(let t=lo;t<=hi;t+=2)d+=(d?'L':'M')+xx(t)+','+yy(at(t));sections+=`<text x="${left}" y="${top-8}" font-size="17">${label}</text>`;for(let z=0;z<=P.grid.maxHeight;z+=20)sections+=`<path d="M${left},${yy(z)}H${left+pw}" stroke="#ccc"/><text x="20" y="${yy(z)+4}" font-size="11">${z}</text>`;for(let t=Math.ceil(lo/200)*200;t<hi;t+=200)sections+=`<text x="${xx(t)}" y="${top+ph+20}" font-size="11">${t}</text>`;sections+=`<path d="${d}" stroke="#426b36" stroke-width="2" fill="none"/>`;});
  await render('04-sections',`<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${sh}" font-family="sans-serif">${sections}</svg>`);
  // Exaggerated relief, shaded by a northwest light; every contour is still a true 5m level.
  const stride=4,reliefWidth=Math.ceil((w+h)*.85)+80,reliefHeight=Math.ceil((w+h)*.32+P.grid.maxHeight*c.verticalScale)+120,project=(i,j,z)=>[(i-j)*.85+h*.85+40,(i+j)*.32+P.grid.maxHeight*c.verticalScale+70-z*c.verticalScale];
  const reliefPoints=(i,j)=>{const k=j*w+i,z=heights[k],dx=(heights[j*w+Math.min(w-1,i+1)]-heights[j*w+Math.max(0,i-1)])/(2*cell),dy=(heights[Math.max(0,j-1)*w+i]-heights[Math.min(h-1,j+1)*w+i])/(2*cell),light=Math.max(0,(-dx*c.light[0]-dy*c.light[1]+c.light[2])/Math.hypot(dx,dy,1)),gain=c.shadeAmbient+c.shadeGain*light;return {p:project(i,j,z),colour:z<=0?'#256887':`rgb(${[175,187,134].map(v=>Math.round(v*gain)).join(',')})`};};
  let relief='';
  for(let sum=0;sum<w+h;sum+=stride)for(let i=Math.max(0,sum-h+stride);i<=Math.min(w-stride-1,sum);i+=stride) {
    const j=sum-i;if(j<0||j>=h-stride)continue;
    const q=reliefPoints(i,j),points=[q.p,reliefPoints(i+stride,j).p,reliefPoints(i+stride,j+stride).p,reliefPoints(i,j+stride).p];
    relief+=`<polygon points="${points.join(' ')}" fill="${q.colour}" stroke="${q.colour}" stroke-width=".4"/>`;
    const v=[heights[j*w+i],heights[j*w+i+stride],heights[(j+stride)*w+i+stride],heights[(j+stride)*w+i]],xy=[[i,j],[i+stride,j],[i+stride,j+stride],[i,j+stride]];
    for(let level=Math.max(0,Math.ceil(Math.min(...v)/c.contour)*c.contour);level<=Math.max(...v);level+=c.contour){const line=[];for(let k=0;k<4;k++){const n=(k+1)%4;if((v[k]<level)!==(v[n]<level)){const t=(level-v[k])/(v[n]-v[k]);line.push(project(xy[k][0]+t*(xy[n][0]-xy[k][0]),xy[k][1]+t*(xy[n][1]-xy[k][1]),level));}}if(line.length===2)relief+=`<path d="M${line[0]}L${line[1]}" stroke="#283b21" stroke-width=".6" opacity=".65"/>`;}
  }
  await render('05-relief',`<svg xmlns="http://www.w3.org/2000/svg" width="${reliefWidth}" height="${reliefHeight}"><rect width="100%" height="100%" fill="#f6f4ec"/><text x="40" y="35" font-size="22" font-family="sans-serif">山すその立体陰影・北西光・5m等高線（高さ${c.verticalScale}倍）</text>${relief}</svg>`);
  let eight=`<rect width="100%" height="100%" fill="#faf8ef"/><text x="55" y="30" font-size="22">8本の断面（標高m、横: 設計座標m。地形の升目から補間）</text>`;
  const at=(x,y)=>terrain.heightAt(x,northOffset-y);
  const profiles=[... [0,-235,-198,200].map(x=>[`南北 x=${x}`,P.grid.south,P.grid.north,t=>at(x,t)]),... [150,430,640,900].map(y=>[`東西 y=${y}`,P.grid.west,P.grid.east,t=>at(t,y)])];
  profiles.forEach(([label,lo,hi,at],i)=>{const top=60+i*205,left=60,pw=sw-105,ph=145,xx=t=>left+(t-lo)/(hi-lo)*pw,yy=z=>top+ph-(z-P.grid.minHeight)/(P.grid.maxHeight-P.grid.minHeight)*ph;let d='';for(let t=lo;t<=hi;t+=cell)d+=(d?'L':'M')+xx(t)+','+yy(at(t));eight+=`<text x="${left}" y="${top-8}" font-size="17">${label}</text>`;for(let z=0;z<=P.grid.maxHeight;z+=20)eight+=`<path d="M${left},${yy(z)}H${left+pw}" stroke="#ccc"/><text x="20" y="${yy(z)+4}" font-size="11">${z}</text>`;for(let t=Math.ceil(lo/200)*200;t<hi;t+=200)eight+=`<text x="${xx(t)}" y="${top+ph+20}" font-size="11">${t}</text>`;eight+=`<path d="${d}" stroke="#426b36" stroke-width="2" fill="none"/>`;});
  await render('06-eight-sections',`<svg xmlns="http://www.w3.org/2000/svg" width="${sw}" height="${c.sectionHeight}" font-family="sans-serif">${eight}</svg>`);
  await writeDesignedPerspective(directory,world);
  const steps=world.stairs.steps,x=y=>80+(y-P.shrine.stairSouth)/(P.shrine.stairNorth-P.shrine.stairSouth)*1040,yy=h=>420-(h-P.shrine.lower[4])*40;
  let stair='<rect width="1200" height="500" fill="#faf8ef"/><text x="40" y="30" font-size="20">石段断面：灰=段・緑=地形・点=前縁（縦横m）</text>',d='',ground='';
  for(let y=P.shrine.stairSouth;y<=P.shrine.stairNorth;y+=.05)ground+=(ground?'L':'M')+x(y)+','+yy(field.sample(0,y).h);
  for(let i=0;i<steps.length;i++){const p=steps[i];if(i)d+='H'+x(p.y);d+=(i?'V':'M'+x(p.y)+',')+yy(p.top);stair+=`<circle cx="${x(p.y)}" cy="${yy(p.top)}" r="2" fill="#333"/>`;}
  stair+=`<path d="${d}" fill="none" stroke="#777" stroke-width="3"/><path d="${ground}" fill="none" stroke="#26843a" stroke-width="2"/>`;
  await render('08-stair-section',`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500">${stair}</svg>`);
  const nativeField=createDesignedTerrain(P.stairs.totalRise,null,{steps:true,sea:true}),native=designedStairs(nativeField,{emit:{steps:true,sea:true}});
  let nd='',ng='';for(let y=P.shrine.stairSouth;y<=P.shrine.stairNorth;y+=.05)ng+=(ng?'L':'M')+x(y)+','+yy(nativeField.sample(0,y).h);
  for(let i=0;i<native.steps.length;i++){const p=native.steps[i];if(i)nd+='H'+x(p.y);nd+=(i?'V':'M'+x(p.y)+',')+yy(p.top);}
  await render('09-stair-enabled',`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500"><rect width="100%" height="100%" fill="#faf8ef"/><text x="40" y="30" font-size="20">emit.steps=true：灰=段・緑=入隅の線より低い地形</text><path d="${nd}" fill="none" stroke="#777" stroke-width="3"/><path d="${ng}" fill="none" stroke="#26843a" stroke-width="2"/></svg>`);
  const bx=d=>80+(d+50)/130*1040,by=h=>350-h*50;let beach='';
  for(let d=-50;d<=P.shore.beach;d+=.25)beach+=(beach?'L':'M')+bx(d)+','+by(at(0,shoreAt(0)+d));
  let bands='';const beachRGB=world.files.get('ground_rgb.bin');for(let d=-50;d<62;d+=2){const i=Math.floor((0-P.grid.west)/cell),j=Math.floor((P.grid.north-shoreAt(0)-d)/cell),k=(j*w+i)*3;bands+=`<rect x="${bx(d)}" y="390" width="17" height="35" fill="rgb(${[0,1,2].map(q=>beachRGB[k+q])})"/>`;}
  await render('10-beach-section',`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="500"><rect width="100%" height="100%" fill="#faf8ef"/><text x="40" y="30" font-size="20">浜断面：沖50m〜浜62m、緑=地形、青=海面、下段=海底と浜の実際の色</text><path d="M80,350H${bx(0)}" stroke="#238eac" stroke-width="2"/><path d="${beach}" fill="none" stroke="#26843a" stroke-width="3"/>${bands}${[-40,-20,0,6,30,62].map(d=>`<text x="${bx(d)}" y="455" font-size="15">${d}m</text>`).join('')}</svg>`);
  return {bridges:bridges.length};
}
