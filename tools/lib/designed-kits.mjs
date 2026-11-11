import fs from 'node:fs/promises';
import path from 'node:path';
import { box, makeGlb } from './synthetic-glb.mjs';
import { parseGlb, readAccessor, buildGlb, align4 } from './glb.mjs';
import { houseNodeName } from '../../dist/valley/kamakura-houses.js';
import { designedStairs } from './designed-stairs.mjs';
import { PLAN } from '../worlds/kamakura-return.mjs';
// These dimensions belong ONLY to the invented CI substitutes. Kits always supply their own dimensions.
// house: narrow and deep, so that a substitute fits the plots of the authored town as a real town house does (a box 8 m wide
// did not, and the town of the tests stood almost empty).
const SUBSTITUTE = Object.freeze({ house:[5,6,11], mansion:[14,8,12], fence:[12,2,.6], gate:[5,4,2],
  hall:[20,12,14], buddhaHall:[38,18,32], buddha:[7,11,6], stairs:[12,7.5,20], torii:[14,8,3], portal:[14,8,6], skirt:1, roof:3 });
function fallback() {
  const hnodes=[], kinds=[];
  for (const [index,[name,type]] of PLAN.kinds.entries()) {
    const shape=/yashiki/.test(type)?SUBSTITUTE.mansion:type==='fence'?SUBSTITUTE.fence:/gate|nagayamon/.test(type)?SUBSTITUTE.gate:SUBSTITUTE.house;
    const [w,h,d]=shape, parts=[{geometry:box(0,-SUBSTITUTE.skirt,0,w,h,d)}];
    if(type!=='fence')parts.push({geometry:box(0,h-SUBSTITUTE.skirt,0,w+2,SUBSTITUTE.roof,d+2,true)});
    const node=/^(5_|6_|k14_)/.test(name)?'designed_'+name:name;
    hnodes.push({name:node,parts});kinds.push({index,node,house_type:type,bbox_min:[-(w+2)/2,-(d+2)/2,-SUBSTITUTE.skirt],bbox_max:[(w+2)/2,(d+2)/2,h+SUBSTITUTE.roof-SUBSTITUTE.skirt],triangles:parts.reduce((n,p)=>n+p.geometry.positions.length/9,0)});
  }
  const fnodes=[], catalog=[];
  for(const [facility,part,label] of PLAN.facilities) {
    const shape=part==='stairs'?SUBSTITUTE.stairs:part==='torii'?SUBSTITUTE.torii:part==='buddha'?SUBSTITUTE.buddha:part==='gate'||part==='romon'?SUBSTITUTE.portal:facility==='daibutsuden'?SUBSTITUTE.buddhaHall:SUBSTITUTE.hall;
    const [w,h,d]=shape, name=`${facility}:${part}:${label}`, parts=[{geometry:box(0,0,0,w,h,d)}];
    if(part==='hall')parts.push({geometry:box(0,h,0,w+2,SUBSTITUTE.roof,d+2,true)});
    fnodes.push({name,parts});catalog.push({node:name,facility,part,soft:part==='stairs',status:null,source:'original mathematical substitute',triangles:parts.reduce((n,p)=>n+p.geometry.positions.length/9,0),rel_anchor:0,bbox_min:[-(w+2)/2,-(d+2)/2,0],bbox_max:[(w+2)/2,(d+2)/2,h+(part==='hall'?SUBSTITUTE.roof:0)]});
  }
  return {houseGlb:makeGlb(hnodes), kinds, facilityDoc:parseGlb(makeGlb(fnodes)), sections:catalog};
}
// Repack only selected meshes; no source anchors, object placements or unused meshes survive.
function repack(doc, selections, normalize=false) {
  const chunks=[], views=[], accessors=[], meshes=[], nodes=[], bounds=[];let bytes=0;
  let attributeDoc=doc;
  function attribute(index, transform) {
    const src=attributeDoc.json.accessors[index], read=readAccessor(attributeDoc,index), values=read.array;
    if(transform)for(let i=0;i<values.length;i+=3) {values[i]-=transform[0];values[i+1]-=transform[1];values[i+2]-=transform[2];}
    const buf=Buffer.from(values.buffer,values.byteOffset,values.byteLength), aligned=Buffer.alloc(align4(buf.length));buf.copy(aligned);chunks.push(aligned);
    const a={bufferView:views.length,componentType:src.componentType,count:src.count,type:src.type};if(src.normalized)a.normalized=true;
    views.push({buffer:0,byteOffset:bytes,byteLength:buf.length});bytes+=aligned.length;
    if(src.type==='VEC3'&&transform) {a.min=[Infinity,Infinity,Infinity];a.max=[-Infinity,-Infinity,-Infinity];for(let i=0;i<values.length;i++) {const k=i%3;a.min[k]=Math.min(a.min[k],values[i]);a.max[k]=Math.max(a.max[k],values[i]);}}
    else {if(src.min)a.min=src.min;if(src.max)a.max=src.max;}
    accessors.push(a);return accessors.length-1;
  }
  const materials=[...(doc.json.materials||[])];
  for(const s of selections) {
    const source=s.doc||doc;attributeDoc=source;const materialOffset=s.doc?materials.length:0;if(s.doc)materials.push(...source.json.materials);
    const src=source.json.nodes.find(n=>n.name===s.original||houseNodeName(n.name||'')===s.original);
    if(!src||src.mesh===undefined||src.matrix||src.translation||src.rotation||src.scale)throw Error('Kit mesh must have baked transforms: '+s.name);
    const mesh=source.json.meshes[src.mesh],lo=[Infinity,Infinity,Infinity],hi=[-Infinity,-Infinity,-Infinity];
    for(const p of mesh.primitives) {const a=readAccessor(source,p.attributes.POSITION).array;for(let i=0;i<a.length;i++){lo[i%3]=Math.min(lo[i%3],a[i]);hi[i%3]=Math.max(hi[i%3],a[i]);}}
    const center=normalize&&!s.doc?[(lo[0]+hi[0])/2,lo[1],(lo[2]+hi[2])/2]:null;
    const primitives=mesh.primitives.map(p=>{const attrs={};for(const [key,index] of Object.entries(p.attributes))attrs[key]=attribute(index,key==='POSITION'?center:null);return {...p,material:(p.material||0)+materialOffset,attributes:attrs,...(p.indices!==undefined?{indices:attribute(p.indices)}:{})};});
    nodes.push({name:s.name,mesh:meshes.length});meshes.push({primitives});bounds.push({min:lo.map((v,i)=>v-(center?.[i]||0)),max:hi.map((v,i)=>v-(center?.[i]||0))});
  }
  if(doc.json.textures?.length||doc.json.images?.length)throw Error('Designed kit must use embedded colour materials, not texture references');
  return {bytes:buildGlb({json:{asset:{version:'2.0',generator:'authored world kit subset'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes,meshes,materials,buffers:[{byteLength:bytes}],bufferViews:views,accessors},bin:Buffer.concat(chunks)}),bounds};
}
export async function loadDesignedKits(dir,{emit=PLAN.emit}={}) {
  let input;
  if(dir) {
    // Explicit allowlist: do not open meta, terrain, placements, routes, rivers or vegetation.
    const [h,hg,f,fg]=await Promise.all(['houses.json','houses_kit.glb','facilities.json','facilities.glb'].map(n=>fs.readFile(path.join(dir,n))));
    const kinds=JSON.parse(h).kinds.map(k=>({...k}));
    const houseDoc=parseGlb(hg),selection=kinds.map(k=>({original:k.node,name:/^(5_|6_|k14_)/.test(k.node)?'designed_'+k.node:k.node}));
    const house=repack(houseDoc,selection);kinds.forEach((k,i)=>{k.node=selection[i].name;});
    // Only section identity/type/status is consumed. Source placement anchors are deliberately never read.
    input={houseGlb:house.bytes,kinds,facilityDoc:parseGlb(fg),sections:JSON.parse(f).nodes};
  } else input=fallback();
  const stair=designedStairs(null,{emit}),stairDoc=parseGlb(stair.bytes);
  const sections=PLAN.facilities.map(([facility,part,label])=>{
    if(part==='stairs')return {node:'designed:stairs',part,facility,triangles:stair.triangles,doc:stairDoc};
    const burnt=facility==='toshoji'&&part==='hall';
    const s=input.sections.find(n=>n.facility===(burnt?'kenchoji':facility)&&n.part===part&&n.node.includes(burnt?'仏殿':label));
    if(!s)throw Error('Missing kit section: '+facility+'/'+label);return {...s,...(burnt?{facility:'toshoji',node:'designed:toshoji:burnt',original:s.node,ruin:'burnt'}:{})};
  });
  const selection=sections.map(s=>({name:s.node,original:s.original||s.node,...(s.doc?{doc:s.doc}:{})})),f=repack(input.facilityDoc,selection,true);
  const nodes=sections.map((s,i)=>({node:s.node,part:s.part,facility:s.facility,soft:s.part==='stairs',status:s.status??null,...(s.ruin?{ruin:s.ruin}:{}),source:'provided model; original authored placement',triangles:s.triangles,rel_anchor:0,bbox_min:f.bounds[i].min,bbox_max:f.bounds[i].max}));
  return {houseGlb:input.houseGlb,kinds:input.kinds,facilityGlb:f.bytes,nodes,stairRise:PLAN.stairs.totalRise,stair};
}
