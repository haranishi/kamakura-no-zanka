// Node-only CPU mesh viewer: no browser, GPU, external image or dependency.
// API: previewMesh({positions,normals,indices,uvs,colors|roles|surfaces}, {view,colors,width,height,uv}).
// CLI: node tools/preview-mesh.mjs --demo /absolute/output/directory [debug] [uv]
//      node tools/preview-mesh.mjs input.json output.svg
//      node tools/preview-mesh.mjs --townlife /absolute/output/directory
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { houseFrame,buildHouse,HOUSE_PARTS,HOUSE2,house2SurfaceColor } from '../dist/valley/kamakura-house-build.js';
import { parseGlb,readAccessor } from './lib/glb.mjs';
import { houseFamily } from '../dist/valley/kamakura-house-build.js';
import { HOUSE_PALETTE as P } from '../dist/valley/kamakura-house-texture.js';
export const PREVIEW = Object.freeze({
  zoom:1.65, // ratio: projected house size within each diagnostic panel.
  stripe:.25, // metres: diagnostic board/grain spacing.
  stripePixels:.55, // pixels: diagnostic grain stroke.
  person:1.66, // metres: neighbouring human scale reference.
  width:500, // pixels: each view panel.
  height:450, // pixels: each view panel.
  light:Object.freeze([-.7,.65,.25]), // normalized below: warm westward directional light.
  overlay:0.8, // pixels: source kit wire, red over the solid model.
  overlayColor:'#d32929', // sRGB: source edges only, independent of new material/lighting.
  views:Object.freeze({oblique:[1,.85,1],front:[0,0,1],side:[1,0,0],under:[.55,-.12,1.8],top:[0,1,0]}),
});
const normalize=a=>{const n=Math.hypot(...a);return a.map(v=>v/n);};
const dot=(a,b)=>a.reduce((s,v,k)=>s+v*b[k],0);
const cross=(a,b)=>[a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];
const rgb=c=>`rgb(${c.map(v=>Math.round(Math.max(0,Math.min(1,v))*255)).join(',')})`;
const srgb=v=>v<=.0031308?v*12.92:1.055*v**(1/2.4)-.055;
export function previewMesh(mesh,{view='oblique',colors=null,width=PREVIEW.width,height=PREVIEW.height,debug=false,uv=false,source=null}={}) {
  const pos=mesh.positions,min=[Infinity,Infinity,Infinity],max=[-Infinity,-Infinity,-Infinity];
  for(let i=0;i<pos.length;i+=3)for(let k=0;k<3;k++){min[k]=Math.min(min[k],pos[i+k]);max[k]=Math.max(max[k],pos[i+k]);}
  const center=min.map((v,k)=>(v+max[k])/2),radius=Math.hypot(...max.map((v,k)=>(v-min[k])/2));
  const forward=normalize(PREVIEW.views[view]),right=view==='top'?[1,0,0]:normalize(cross([0,1,0],forward)),up=cross(forward,right),light=normalize(PREVIEW.light);
  const project=p=>{const a=p.map((v,k)=>v-center[k]),depth=radius*3-dot(a,forward),scale=Math.min(width,height)*radius*PREVIEW.zoom/Math.max(radius,depth);
    return [width/2+dot(a,right)*scale/radius,height/2-dot(a,up)*scale/radius,depth];};
  const triangles=[];
  for(let i=0;i<(mesh.indices?.length??pos.length/3);i+=3){
    const ids=[0,1,2].map(j=>mesh.indices?.[i+j]??i+j),p=ids.map(id=>Array.from(pos.slice(id*3,id*3+3))),normal=mesh.normals?Array.from(mesh.normals.slice(ids[0]*3,ids[0]*3+3)):normalize(cross(p[1].map((v,k)=>v-p[0][k]),p[2].map((v,k)=>v-p[0][k])));
    const toEye=center.map((v,k)=>v+forward[k]*radius*3-p.reduce((sum,q)=>sum+q[k]/3,0));
    if(dot(normal,toEye)<=0)continue;
    const role=mesh.roles?.[ids[0]]??0,surface=mesh.surfaces?.[ids[0]]??role;
    let color=colors?.[surface]??[P.wood,P.thatch,P.post,P.post,P.stone,P.lime,P.earth][surface]??P.wood;
    if(mesh.colors)color=Array.from(mesh.colors.slice(ids[0]*3,ids[0]*3+3));
    if(debug){const hex=HOUSE_PARTS.debug[role];color=[hex>>16&255,hex>>8&255,hex&255].map(v=>v/255);}
    if(!colors&&!mesh.colors&&!debug)color=house2SurfaceColor(surface,.5,{tone:mesh.tones?.[ids[0]]??1,height:Infinity,wallHeight:mesh.frame?.wallHeight??1,up:normal[1]});
    const illumination=debug?1:(.34+.66*Math.max(0,dot(normal,light)));
    const tone=color.map(v=>debug?v:srgb(v*illumination)),q=p.map(project);
    let stripes='';
    if(uv&&mesh.uvs&&!debug&&[0,1,2].includes(surface)){
      const tex=ids.map(id=>Array.from(mesh.uvs.slice(id*2,id*2+2))),lo=Math.min(...tex.map(t=>t[0])),hi=Math.max(...tex.map(t=>t[0]));
      for(let line=Math.ceil(lo/PREVIEW.stripe)*PREVIEW.stripe;line<hi;line+=PREVIEW.stripe){
        const hit=[];
        for(let j=0;j<3;j++){const k=(j+1)%3,a=tex[j][0],b=tex[k][0];if((line>=a&&line<b)||(line>=b&&line<a)){const t=(line-a)/(b-a);hit.push(project(p[j].map((v,k)=>v+(p[(j+1)%3][k]-v)*t)));}}
        if(hit.length===2)stripes+=`<path d="M${hit[0][0]},${hit[0][1]} L${hit[1][0]},${hit[1][1]}" stroke="${rgb(tone.map(v=>v*.75))}" stroke-width="${PREVIEW.stripePixels}"/>`;
      }
    }
    triangles.push({q,depth:q.reduce((s,p)=>s+p[2],0)/3,svg:`<polygon points="${q.map(p=>p.slice(0,2).map(v=>v.toFixed(2)).join(',')).join(' ')}" fill="${rgb(tone)}"/>${stripes}`});
  }
  const humanX=max[0]+HOUSE2.verandaDepth, humanZ=(min[2]+max[2])/2;
  const person=[[humanX,0,humanZ],[humanX,PREVIEW.person,humanZ]];
  const a=project(person[0]),b=project(person[1]),shoulder=project([humanX,PREVIEW.person*.73,humanZ]),arm=project([humanX+.3,PREVIEW.person*.65,humanZ]);
  triangles.push({depth:(a[2]+b[2])/2,svg:`<path d="M${a[0]},${a[1]} L${b[0]},${b[1]} M${shoulder[0]},${shoulder[1]} L${arm[0]},${arm[1]}" stroke="#b34338" stroke-width="3"/><circle cx="${b[0]}" cy="${b[1]}" r="4" fill="#b34338"/>`});
  const ordered=paintOrder(triangles);
  let overlay='';
  for(const surface of source??[]){const p=surface.positions,idx=surface.indices;
    for(let i=0;i<(idx?.length??p.length/3);i+=3){const q=[0,1,2].map(j=>{const k=(idx?.[i+j]??i+j)*3;return project(Array.from(p.slice(k,k+3)));});
      overlay+=`<polygon points="${q.map(p=>p.slice(0,2).map(v=>v.toFixed(2)).join(',')).join(' ')}" fill="none" stroke="${PREVIEW.overlayColor}" stroke-width="${PREVIEW.overlay}"/>`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#ddd8ce"/>${ordered.map(t=>t.svg).join('')}${overlay}<text x="14" y="25" font-family="sans-serif" font-size="16">${view} | human ${PREVIEW.person} m</text></svg>`;
}
// Order overlapping projected faces by depth at their overlap, not their centroids.
// This keeps a small proud board in front of the much taller wall behind it.
function paintOrder(items) {
  const cross2=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  const bounds=items.map(t=>t.q?[Math.min(...t.q.map(p=>p[0])),Math.min(...t.q.map(p=>p[1])),Math.max(...t.q.map(p=>p[0])),Math.max(...t.q.map(p=>p[1]))]:null);
  const after=items.map(()=>[]),incoming=new Uint32Array(items.length);
  function overlap(a,b){
    let out=a.map(p=>p.slice(0,2));const sign=Math.sign(cross2(...b));
    for(let edge=0;edge<3&&out.length;edge++){
      const c=b[edge],d=b[(edge+1)%3],input=out;out=[];
      for(let i=0;i<input.length;i++){
        const p=input[i],q=input[(i+1)%input.length],sp=sign*cross2(c,d,p),sq=sign*cross2(c,d,q);
        if(sp>=0)out.push(p);
        if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);out.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t]);}
      }
    }
    if(out.length<3)return null;
    const p=[0,0];for(const v of out){p[0]+=v[0]/out.length;p[1]+=v[1]/out.length;}return p;
  }
  function depth(q,p){const area=cross2(...q),a=cross2(q[1],q[2],p)/area,b=cross2(q[2],q[0],p)/area;return 1/(a/q[0][2]+b/q[1][2]+(1-a-b)/q[2][2]);}
  for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
    const a=bounds[i],b=bounds[j];if(!a||!b||a[2]<=b[0]||b[2]<=a[0]||a[3]<=b[1]||b[3]<=a[1])continue;
    const p=overlap(items[i].q,items[j].q);if(!p)continue;
    const delta=depth(items[i].q,p)-depth(items[j].q,p);if(Math.abs(delta)<1e-7)continue;
    const first=delta>0?i:j,last=delta>0?j:i;after[first].push(last);incoming[last]++;
  }
  const result=[],done=new Uint8Array(items.length);
  while(result.length<items.length){
    let next=-1;
    for(let i=0;i<items.length;i++)if(!done[i]&&!incoming[i]&&(next<0||items[i].depth>items[next].depth))next=i;
    // Intersecting small solids can make a cycle; keep a deterministic far-first fallback.
    if(next<0)for(let i=0;i<items.length;i++)if(!done[i]&&(next<0||items[i].depth>items[next].depth))next=i;
    done[next]=1;result.push(items[next]);for(const i of after[next])if(incoming[i])incoming[i]--;
  }
  return result;
}
// Public synthetic kit only. No private catalogue dimensions/coordinates are saved by this tool.
export function syntheticHouse(family) {
  const size={townhouse:[8,6,3.2,5.1],cottage:[5,4,2.5,4.4],storehouse:[6,5,3.8,5.5],mansion:[12,9,4.2,7.1],boathouse:[7,5,2.8,4.3]}[family];
  const [w,d,e,t]=size,positions=[];
  for(const y of [-.8,.3,e])for(const [x,z] of [[-w/2,-d/2],[w/2,-d/2],[w/2,d/2],[-w/2,d/2]])positions.push(x,y,z);
  for(const [x,z] of [[-w/2-.6,-d/2-.6],[w/2+.6,-d/2-.6],[w/2+.6,d/2+.6],[-w/2-.6,d/2+.6]])positions.push(x,e,z);
  positions.push(family==='mansion'?-w/4:-w/2-.6,t,0,family==='mansion'?w/4:w/2+.6,t,0);
  return houseFrame(family,positions);
}
export async function writeHousePreviews(directory,{debug=false,uv=false}={}) {
  await fs.mkdir(directory,{recursive:true});
  for(const family of ['townhouse','cottage','storehouse','mansion','boathouse']){
    const frame=syntheticHouse(family),panels=[];
    for(const variant of [0,1]){
      const mesh=buildHouse(frame,variant);
      for(const [j,view] of ['oblique','front','side','under'].entries()){
        const svg=previewMesh(mesh,{view,debug,uv});panels.push(`<g transform="translate(${j*PREVIEW.width},${variant*PREVIEW.height})">${svg}</g>`);
      }
    }
    await fs.writeFile(path.join(directory,family+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW.width*4}" height="${PREVIEW.height*2}" viewBox="0 0 ${PREVIEW.width*4} ${PREVIEW.height*2}">${panels.join('')}</svg>`);
  }
}
// Private input stays outside the repository. Only PNG/SVG review sheets are written to the supplied output directory.
export async function writePrivatePreviews(directory,worldDirectory) {
  const doc=parseGlb(await fs.readFile(path.join(worldDirectory,'houses_kit.glb')));
  const catalog=JSON.parse(await fs.readFile(path.join(worldDirectory,'houses.json'),'utf8'));
  await fs.mkdir(directory,{recursive:true});const serial={};
  for(const n of doc.json.nodes)if(n.mesh!==undefined&&houseFamily(n.name)){
    const source=doc.json.meshes[n.mesh].primitives.map(p=>({positions:readAccessor(doc,p.attributes.POSITION).array,indices:p.indices===undefined?null:readAccessor(doc,p.indices).array}));
    const kind=catalog.kinds.find(k=>k.node===n.name)??n.name,frame=houseFrame(kind,source.flatMap(s=>Array.from(s.positions)),1,source),mesh=buildHouse(frame,0);
    const panels=['top','front','side','oblique'].map((view,j)=>`<g transform="translate(${j*PREVIEW.width},0)">${previewMesh(mesh,{view,uv:true,source})}</g>`);
    const name=frame.family+'-'+(serial[frame.family]=(serial[frame.family]??0)+1);
    await fs.writeFile(path.join(directory,name+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW.width*4}" height="${PREVIEW.height}">${panels.join('')}</svg>`);
  }
}
// Townlife review sheets use synthetic plots/footprints only; the same placement and mesh functions as the game.
export async function writeTownlifePreviews(directory) {
  const {prepareTownDress,TOWN_DRESS}=await import('../dist/valley/kamakura-town-dress.js');
  const {townDressGeometry,dressPalette}=await import('../dist/valley/kamakura-town-dress-kit.js');
  const {prepareBurntHall,ruinHallGeometry}=await import('../dist/valley/kamakura-ruin-hall.js');
  await fs.mkdir(directory,{recursive:true});
  const terrain={heightAt:()=>0,waterAt:()=>0,walkable:()=>true};
  const townPlots=Array.from({length:160},(_,i)=>({x:i*16,z:14,yaw:0,width:16,depth:22,state:'house',lane:'lane'}));
  const kinds=new Map([[0,{bbox_min:[-3,-4,0],bbox_max:[3,4,4]}]]);
  const houses={kinds,instances:townPlots.map(p=>({kind:0,matrix:[-1,0,0,0,0,1,0,0,0,0,-1,0,p.x,0,p.z,1]}))};
  const data={townPlots,houses,lanes:{lane:{width_m:3.2,xyz_m:[[-30,0,0],[2600,0,0]]}}};
  const layout=prepareTownDress({data,terrain}),all=layout.items.filter(p=>TOWN_DRESS.fenceHeights[p.kind]);
  const sheet=async(name,mesh)=>{
    const panels=['top','oblique'].map((view,i)=>`<g transform="translate(${i*PREVIEW.width},0)">${previewMesh(mesh,{view})}</g>`);
    await fs.writeFile(path.join(directory,name+'.svg'),`<svg xmlns="http://www.w3.org/2000/svg" width="${PREVIEW.width*2}" height="${PREVIEW.height}">${panels.join('')}</svg>`);
  };
  function plotMesh(ids){
    const positions=[],colors=[],origin=townPlots[ids[0]].x;
    for(const p of all.filter(p=>ids.includes(p.plot))){
      const g=townDressGeometry(p.kind),v=g.attributes.position.array,col=g.attributes.color.array,c=Math.cos(p.yaw),s=Math.sin(p.yaw);
      for(let i=0;i<v.length;i+=3){positions.push(p.x-origin+c*v[i]*p.w+s*v[i+2]*p.d,v[i+1],p.z-s*v[i]*p.w+c*v[i+2]*p.d);colors.push(col[i],col[i+1],col[i+2]);}g.dispose();
    }
    // The neutral house box and the low door marker make clearance and facade direction legible.
    for(const id of ids){
      const plot=townPlots[id],items=[{shape:'block',kind:'base',u:plot.x-origin,v:plot.z,y:0,w:6,h:3,d:8},
        {shape:'block',kind:'base',u:plot.x-origin,v:plot.z-4.1,y:0,w:.9,h:1.8,d:.12}];
      const g=ruinHallGeometry({items});for(let i=0;i<g.positions.length;i++)positions.push(g.positions[i]);
      for(let i=0;i<g.positions.length/3;i++)colors.push(...(i<36?P.oldLime:P.oldWood));
    }
    return {positions:new Float32Array(positions),colors:new Float32Array(colors)};
  }
  for(const kind of ['bamboo','board','log']){
    // Isolated plots allow all four edges to be inspected; shared edges get their own sheet below.
    const isolated=prepareTownDress({data:{...data,townPlots:townPlots.map(p=>({...p,x:p.x*2})),houses:{kinds,instances:houses.instances.map(p=>({...p,matrix:p.matrix.map((v,i)=>i===12?v*2:v)}))},lanes:{lane:{width_m:3.2,xyz_m:[[-30,0,0],[5200,0,0]]}}},terrain});
    const sample=isolated.items.find(p=>p.kind===kind&&p.mode==='enclosed'),id=sample.plot;
    const saved=all.splice(0,all.length,...isolated.items.filter(p=>TOWN_DRESS.fenceHeights[p.kind]));
    const old=townPlots[id].x;townPlots[id].x*=2;await sheet('fence-'+kind,plotMesh([id]));townPlots[id].x=old;all.splice(0,all.length,...saved);
  }
  let pair=null;for(let i=0;i<townPlots.length-1;i++)if(all.some(p=>p.plot===i&&p.mode==='enclosed')&&all.some(p=>p.plot===i+1&&p.mode==='enclosed')){pair=[i,i+1];break;}
  await sheet('shared-boundary',plotMesh(pair));
  const palette=dressPalette();
  for(const [name,w,d,height] of [['burnt-large',40,32,18],['burnt-small',14,10,8]]){
    const slope={...terrain,heightAt:(x,z)=>x*.02+z*.01};
    const plan=prepareBurntHall({x:0,z:0,w,d,height,rotY:0},slope),g=ruinHallGeometry(plan),colors=[];
    for(let i=0;i<g.kinds.length;i++){const pigment=({post:palette.char,beam:palette.char,ash:palette.ash,grass:palette.crop,base:palette.stone})[g.kinds[i]];colors.push(...pigment.map(v=>v*g.shades[i]));}
    await sheet(name,{positions:g.positions,colors:new Float32Array(colors)});
  }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  if(process.argv[2]==='--townlife')await writeTownlifePreviews(process.argv[3]);
  else if(process.argv[2]==='--private')await writePrivatePreviews(process.argv[3],process.env.KZ_WORLD_DIR);
  else if(process.argv[2]==='--demo')await writeHousePreviews(process.argv[3],{debug:process.argv.includes('debug'),uv:process.argv.includes('uv')});
  else {const mesh=JSON.parse(await fs.readFile(process.argv[2],'utf8'));await fs.writeFile(process.argv[3],previewMesh(mesh));}
}
