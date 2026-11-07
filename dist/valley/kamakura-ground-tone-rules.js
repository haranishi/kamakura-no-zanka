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
  return Math.max(-.12,Math.min(.12,.045*(noise*2-1)+.025*dry-.045*steep-.04*Math.max(0,cavity)-.025*shade));
}
// Scalar CPU reference for class-mean and range checks (no array allocation).
export function toneChannel(base,channel,relief,steep,grass,use,strength=1,grain=0,soil=1,rock=0,macro=.5) {
  const tint=[.015,-.005,-.02][channel]*steep+[-.25,.3,-.15][channel]*grass;
  const natural=base*(1+strength*(relief+tint))*(1+soil*strength*(grain*.18+(macro-.5)*.05*rock));
  const yard=(base*[1.13,1.10,1.03][channel]+[.012,.011,.008][channel])*(1+soil*grain*.3);
  return natural+(yard-natural)*use*strength;
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
const linear = n => {const c=n/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;};
export function toneTexel(data,boxes,i,base,weights) {
  const {width:w,height:h,cell_m:cell}=data.meta.grid,x=(i%w-(w-1)/2)*cell,z=(Math.floor(i/w)-(h-1)/2)*cell,k=i*4;
  for(let c=0;c<3;c++)base[k+c]=Math.round(linear(data.ground[i*3+c])*255);
  base[k+3]=255;
  const code=data.surface[i];
  weights[k]=Math.round(grassAmount(code)*255);weights[k+1]=code===5?255:0;
  weights[k+2]=Math.round(groundUseAt(boxes,x,z)*255);weights[k+3]=(code===0||code===1)?0:255;
}
