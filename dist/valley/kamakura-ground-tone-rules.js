import { grassAmount, smooth, soilNoise } from './kamakura-ground-pattern.js';

// W2c-9r1 ground: independent vertex/class bands -> one continuous world-space source.
export const toneStrength = (quality='standard', step=0) => step>=3?0:quality==='light'||step>=2?.45:1;
// Temporary pure grass interface; replace this implementation with the grass branch's export.
export function grassTintAt(x, y, dist) {
  return smooth(35,110,dist)*(.035+.025*soilNoise(x/32,y/32));
}
export const toneDistance = (x,z,d) => Math.max(0,d+(soilNoise(x/29,z/29)-.5)*18);
export const toneFine = (x,z,d,px) => (1-smooth(12,65,toneDistance(x,z,d)))*(1-smooth(.025,.12,px));
export function toneRelief(height, normalY, cavity, shade, noise) {
  const dry=smooth(0,180,height), steep=1-smooth(.55,.95,normalY);
  return Math.max(-.85,Math.min(.85,1.15*(noise*2-1)+.12*dry-.18*steep-.14*Math.max(0,cavity)-.10*shade));
}
// Scalar CPU reference for class-mean and range checks (no array allocation).
export function toneChannel(base,channel,relief,steep,grass,use,strength=1,grain=0,soil=1,rock=0,macro=.5) {
  const tint=(channel===0?.015:channel===1?-.005:-.02)*steep+(channel===0?-.25:channel===1?.3:-.15)*grass;
  const natural=base*(1+strength*(relief+tint))*(1+soil*strength*(grain*.18+(macro-.5)*.05*rock));
  const yard=(base*(channel===0?1.30:channel===1?1.25:1.13)+(channel===0?.035:channel===1?.032:.022))*(1+soil*grain*.65);
  return Math.max(0,Math.min(1,natural+(yard-natural)*use*strength));
}
// Catalog bounds are local to anchor_xz. No historical street is invented beyond these bounds.
export function groundUseBoxes(data) {
  return (data.facilities?.nodes||[]).filter(n=>['hall','buddha','sando','platform','stairs'].includes(n.part)).map(n=>({
    x0:n.anchor_xz[0]+n.bbox_min[0],x1:n.anchor_xz[0]+n.bbox_max[0],
    z0:n.anchor_xz[1]+n.bbox_min[2],z1:n.anchor_xz[1]+n.bbox_max[2]
  }));
}
export function groundUseAt(boxes,x,z) {
  let amount=0;
  for(const b of boxes){const d=Math.hypot(Math.max(b.x0-x,0,x-b.x1),Math.max(b.z0-z,0,z-b.z1));amount=Math.max(amount,1-smooth(0,5,d));}
  return amount;
}
// W2c-9r1 ground round 2: four-metre byte weights; RGB reuses the source bytes.
export function toneWeightGrid(data) {
  const g=data.meta.grid, sx=(g.width-1)*g.cell_m,sz=(g.height-1)*g.cell_m;
  const width=Math.max(2,Math.ceil(sx/4)+1),height=Math.max(2,Math.ceil(sz/4)+1);
  return {width,height,dx:sx/(width-1),dz:sz/(height-1)};
}
export function toneTexel(data,boxes,i,weights,target=null) {
  const {width:w,height:h,cell_m:cell}=data.meta.grid;
  const g=target||{width:w,height:h,dx:cell,dz:cell};
  const x=(i%g.width-(g.width-1)/2)*g.dx,z=(Math.floor(i/g.width)-(g.height-1)/2)*g.dz,k=i*4;
  // Binomial prefilter rejects alternating-cell alias before bilinear GPU sampling.
  const cx=Math.round(x/cell+(w-1)/2),cz=Math.round(z/cell+(h-1)/2);
  let grass=0,rock=0,land=0;
  for(let j=-1;j<=1;j++)for(let a=-1;a<=1;a++){
    const code=data.surface[Math.max(0,Math.min(h-1,cz+j))*w+Math.max(0,Math.min(w-1,cx+a))];
    const weight=(a===0?2:1)*(j===0?2:1)/16;
    grass+=grassAmount(code)*weight;rock+=(code===5?1:0)*weight;land+=(code===0||code===1?0:1)*weight;
  }
  weights[k]=Math.round(grass*255);weights[k+1]=Math.round(rock*255);
  weights[k+2]=Math.round(groundUseAt(boxes,x,z)*255);weights[k+3]=Math.round(land*255);
}
