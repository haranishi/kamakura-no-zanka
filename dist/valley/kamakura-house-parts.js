// Pure, closed, flat-normal primitives. Roles share one material/draw per variant.
export const HOUSE_PARTS = Object.freeze({
  epsilon: 1e-7, // metres: reject zero-area faces.
  debug: Object.freeze([0x888888,0x0000ff,0xff0000,0x000000,0x00ffff,0xffff00,0x00ff00]), // sRGB by diagnostic role.
});
// role: wall, roof, timber, recess, roof edge/rafter, foundation/veranda, yard.
export function houseParts() { return { positions:[], normals:[], roles:[], surfaces:[], tones:[], solids:[], openings:[] }; }
export function solid(mesh, vertices, faces, role, surface=role, tone=1, label='', exterior=null) {
  const centre=[0,0,0]; for(const p of vertices)for(let k=0;k<3;k++)centre[k]+=p[k]/vertices.length;
  const start=mesh.positions.length/3,topFaces=[];
  for(let fi=0;fi<faces.length;fi++){const face=faces[fi];
    // Contact faces are buried in the adjoining wall/foundation/roof, so omit them from submission.
    if((label==='post'||label==='rail'||label==='veranda support'||label==='waist boards')&&fi<2)continue;
    if(label==='rafter'&&fi===1)continue; // inner end is embedded in the wall; the exposed eave end stays capped.
    if(label==='opening floor'&&fi!==1)continue; // all but the top are inside the original stone skirt.
    if(label==='lintel'&&fi===1)continue; // top is in contact with the deep wall infill.
    for(let j=1;j<face.length-1;j++) {
    let a=vertices[face[0]],b=vertices[face[j]],c=vertices[face[j+1]];
    const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2],vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
    let nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;const len=Math.hypot(nx,ny,nz);
    if(len<=HOUSE_PARTS.epsilon)throw new Error('家の部品に退化した面があります');
    if(nx*((a[0]+b[0]+c[0])/3-centre[0])+ny*((a[1]+b[1]+c[1])/3-centre[1])+nz*((a[2]+b[2]+c[2])/3-centre[2])<0){const t=b;b=c;c=t;nx=-nx;ny=-ny;nz=-nz;}
    if(label==='rafter'&&ny/len>0.5)continue;
    if(exterior&&(nx*exterior[0]+ny*exterior[1]+nz*exterior[2])/len<1-HOUSE_PARTS.epsilon)continue;
    if((label==='roof course'||label==='hip roof')&&fi===1)topFaces.push(mesh.positions.length/3);
    const edge=(label==='roof course'||label==='hip roof')&&ny/len<=HOUSE_PARTS.epsilon;
    for(const p of [a,b,c]){mesh.positions.push(...p);mesh.normals.push(nx/len,ny/len,nz/len);mesh.roles.push(edge?4:role);mesh.surfaces.push(surface);mesh.tones.push(tone);}
  }
  }
  mesh.solids.push({start,count:mesh.positions.length/3-start,centre,label,role,volume:mesh.volume??0,topFaces});
}
const CUBE=Object.freeze([[0,1,2,3],[4,7,6,5],[0,4,5,1],[1,5,6,2],[2,6,7,3],[3,7,4,0]]);
export function box(mesh, a,b,role,surface=role,tone=1,label='',exterior=null) {
  if(b.some((v,k)=>v-a[k]<=HOUSE_PARTS.epsilon))return;
  solid(mesh,[[a[0],a[1],a[2]],[b[0],a[1],a[2]],[b[0],a[1],b[2]],[a[0],a[1],b[2]],
    [a[0],b[1],a[2]],[b[0],b[1],a[2]],[b[0],b[1],b[2]],[a[0],b[1],b[2]]],CUBE,role,surface,tone,label,exterior);
}
export function beam(mesh,a,b,width,depth,role=2,surface=2,tone=1,label='') {
  const dy=b[1]-a[1],dx=b[0]-a[0],dz=b[2]-a[2],len=Math.hypot(dx,dy,dz),horizontal=Math.hypot(dx,dz);
  if(len<=HOUSE_PARTS.epsilon)return;
  const u=horizontal>HOUSE_PARTS.epsilon?[-dz/horizontal,0,dx/horizontal]:[1,0,0];
  const d=[dx/len,dy/len,dz/len],v=[d[1]*u[2]-d[2]*u[1],d[2]*u[0]-d[0]*u[2],d[0]*u[1]-d[1]*u[0]],points=[];
  for(const p of [a,b])for(const [i,j] of [[-1,-1],[1,-1],[1,1],[-1,1]])points.push(p.map((q,k)=>q+u[k]*width*i/2+v[k]*depth*j/2));
  solid(mesh,points,CUBE,role,surface,tone,label);
}
export function stone(mesh,x,y,z,rx,ry,rz,role=5,surface=4,tone=1,label='stone') {
  const p=[[x-rx,y,z],[x+rx,y,z],[x,y-ry,z],[x,y+ry,z],[x,y,z-rz],[x,y,z+rz]];
  solid(mesh,p,[[0,2,4],[0,4,3],[0,3,5],[0,5,2],[1,4,2],[1,3,4],[1,5,3],[1,2,5]],role,surface,tone,label);
}
// A convex roof course, with real side/end grain and downward-facing underside.
export function roofCourse(mesh,corners,thickness,role=1,surface=1,tone=1,label='roof',bevel=0) {
  const centre=[0,0,0];for(const p of corners)for(let k=0;k<3;k++)centre[k]+=p[k]/corners.length;
  const high=Math.max(...corners.map(p=>p[1]));
  // Bevel only the low eave corners. Pulling the underside ridge sideways creates a daylight slit above the gable.
  solid(mesh,[...corners.map(p=>{const b=p[1]<high-HOUSE_PARTS.epsilon?bevel:0;return [p[0]+Math.sign(centre[0]-p[0])*b,p[1]-thickness,p[2]+Math.sign(centre[2]-p[2])*b];}),...corners],CUBE,role,surface,tone,label);
}
// Metre UVs are computed in the unrotated kit frame. U crosses the grain;
// V follows world-up on walls and the downhill tangent on each roof face.
export function housePartUV(x,y,z,nx,ny,nz,surface) {
  if(surface===1&&Math.abs(ny)>HOUSE_PARTS.epsilon&&Math.abs(ny)<1-HOUSE_PARTS.epsilon){
    const d=[nx*ny,ny*ny-1,nz*ny],l=Math.hypot(...d);for(let k=0;k<3;k++)d[k]/=l;
    const a=[d[1]*nz-d[2]*ny,d[2]*nx-d[0]*nz,d[0]*ny-d[1]*nx];
    return [x*a[0]+y*a[1]+z*a[2],x*d[0]+y*d[1]+z*d[2]];
  }
  return Math.abs(ny)>.5?[x,z]:Math.abs(nz)>Math.abs(nx)?[x,y]:[z,y];
}
export function finishHouse(mesh, frame, variant) {
  const uvs=new Float32Array(mesh.positions.length/3*2);
  for(let i=0;i<mesh.positions.length;i+=3)uvs.set(housePartUV(...mesh.positions.slice(i,i+3),...mesh.normals.slice(i,i+3),mesh.surfaces[i/3]),i/3*2);
  return {uvs,positions:Float32Array.from(mesh.positions),normals:Float32Array.from(mesh.normals),
    roles:Float32Array.from(mesh.roles),surfaces:Float32Array.from(mesh.surfaces),tones:Float32Array.from(mesh.tones),
    solids:mesh.solids,openings:mesh.openings,frame,variant,triangles:mesh.positions.length/9};
}
