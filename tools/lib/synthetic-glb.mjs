import { buildGlb } from './glb.mjs';
// Original, mathematical geometry only. No source asset or private data is read.
export function box(x, y, z, w, h, d, roof = false) {
  const v = [[-w/2,0,-d/2],[w/2,0,-d/2],[w/2,0,d/2],[-w/2,0,d/2],[-w/2,h,-d/2],[w/2,h,-d/2],[w/2,h,d/2],[-w/2,h,d/2]];

  let faces = [[0,2,1],[0,3,2],[4,5,6],[4,6,7],[0,1,5],[0,5,4],[1,2,6],[1,6,5],[2,3,7],[2,7,6],[3,0,4],[3,4,7]];
  if (roof) {
    v[4]=[0,h,-d/2];v[5]=[0,h,d/2];
    faces=[[0,2,1],[0,3,2],[0,1,4],[3,5,2],[0,4,5],[0,5,3],[1,2,5],[1,5,4]];
  }
  const positions=[], normals=[];
  for (const originalFace of faces) {
    const face=[...originalFace].reverse();
    const [a,b,c]=face.map(i=>v[i]), u=b.map((n,i)=>n-a[i]), q=c.map((n,i)=>n-a[i]);
    const n=[u[1]*q[2]-u[2]*q[1],u[2]*q[0]-u[0]*q[2],u[0]*q[1]-u[1]*q[0]], l=Math.hypot(...n)||1;
    for(const i of face){positions.push(v[i][0]+x,v[i][1]+y,v[i][2]+z);normals.push(...n.map(k=>k/l));}
  }
  return {positions,normals};
}
export function makeGlb(nodes) {
  const chunks=[], views=[], accessors=[], meshes=[]; let offset=0;
  const attribute=(values, bounds=false)=>{
    const buf=Buffer.alloc(values.length*4);values.forEach((v,i)=>buf.writeFloatLE(v,i*4));
    chunks.push(buf); views.push({buffer:0,byteOffset:offset,byteLength:buf.length,target:34962});offset+=buf.length;
    const a={bufferView:views.length-1,componentType:5126,count:values.length/3,type:'VEC3'};
    if(bounds){a.min=[0,1,2].map(k=>Math.min(...values.filter((_,i)=>i%3===k)));a.max=[0,1,2].map(k=>Math.max(...values.filter((_,i)=>i%3===k)));}
    accessors.push(a);return accessors.length-1;
  };
  for(const node of nodes)meshes.push({primitives:node.parts.map(p=>({attributes:{POSITION:attribute(p.geometry.positions,true),NORMAL:attribute(p.geometry.normals)},material:p.interior?1:0}))});
  const doc={asset:{version:'2.0',generator:'CI synthetic geometry'},scene:0,scenes:[{nodes:nodes.map((_,i)=>i)}],nodes:nodes.map((n,i)=>({name:n.name,mesh:i})),meshes,
    materials:[{name:'wall roof timber',pbrMetallicRoughness:{baseColorFactor:[.43,.32,.21,1],metallicFactor:0,roughnessFactor:1}},{name:'interior',doubleSided:true,pbrMetallicRoughness:{baseColorFactor:[.025,.02,.015,1],metallicFactor:0,roughnessFactor:1}}],
    buffers:[{byteLength:offset}],bufferViews:views,accessors};
  return buildGlb({json:doc,bin:Buffer.concat(chunks)});
}
