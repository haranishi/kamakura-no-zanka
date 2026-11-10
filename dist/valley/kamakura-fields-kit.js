// Plant tables and the shared crossed card; raw buffers keep shape tests renderer-free.
export const FIELD_HEIGHTS = Object.freeze([1.7, .65, .95, 1.25, .1]);
// One card stands for a clump (a tussock with its plumes, a few flower stems, a mat on the sand), so it is wider than one stem.
export const FIELD_CARD_WIDTHS = Object.freeze([1.25, .55, .6, .55, .8]);
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export const FIELD_LEAF = Object.freeze([.39,.48,.23].map(linear));
export const FIELD_BLOOMS = Object.freeze([[.86,.83,.74],[.40,.29,.71],[.88,.73,.17],[.91,.87,.72],[.82,.51,.62]].map(c=>Object.freeze(c.map(linear))));
// Keep the original Float32 packing/normalization order so the card vertices remain bit-identical.
export function fieldPlantKit() {
  const positions=[],uvs=[];
  const width=.65,height=FIELD_HEIGHTS[0];
  for(let k=0;k<2;k++) {
    const dx=Math.cos(k*Math.PI/2)*width*.5,dz=Math.sin(k*Math.PI/2)*width*.5;
    const a=[-dx,0,-dz],b=[dx,0,dz],c=[dx,height,dz],d=[-dx,height,-dz];
    positions.push(...a,...b,...c,...a,...c,...d);
    uvs.push(0,0,1,0,1,1,0,0,1,1,0,1);
  }
  const packed=new Float32Array(positions),normals=new Float32Array(positions.length);
  for(let i=0;i<packed.length;i+=3) {
    packed[i]/=width;packed[i+1]/=height;packed[i+2]/=width;
    normals[i+1]=1;
  }
  return {positions:packed,normals,uvs:new Float32Array(uvs),triangles:packed.length/9};
}
