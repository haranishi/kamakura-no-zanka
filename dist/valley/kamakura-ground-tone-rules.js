import { grassAmount, smooth, soilNoise, scatterStone, scatterFade } from './kamakura-ground-pattern.js';

// W2c-9r1 ground: independent vertex/class bands -> one continuous world-space source.
export const toneStrength = (quality='standard', step=0) => step>=3?0:quality==='light'||step>=2?.45:1;
// W2c-9r2 ground: weak one-scale tint -> zero-centred 5/20/80m grass and wind streaks.
export function grassTintAt(x, y, dist) {
  if(dist<=20||dist>=1500)return 0;
  const n=(soilNoise(x/5,y/5)-.5)*.10+(soilNoise(x/20,y/20)-.5)*.6+(soilNoise(x/80,y/80)-.5)*1.3;
  const streak=Math.sin(x*.25+y*.7+soilNoise(x/20,y/20)*4)*.025;
  return Math.max(-.28,Math.min(.28,n+streak))*smooth(20,60,dist)*(1-smooth(400,1500,dist));
}
export const toneDistance = (x,z,d) => Math.max(0,d+(soilNoise(x/29,z/29)-.5)*18);
export const toneFine = (x,z,d,px) => (1-smooth(12,65,toneDistance(x,z,d)))*(1-smooth(.025,.12,px));
export const toneNearRelief = (relief,x,z,d) => relief*(.1+.9*smooth(12,65,toneDistance(x,z,d)));
export function toneGrain(x,z,d,px) {
  return scatterStone(x,z,.08)*scatterFade(x,z,d,px,.08)*1.2
    +scatterStone(x+13.7,z-9.3,.16)*scatterFade(x,z,d,px,.16)*.95
    +scatterStone(x-5.1,z+17.9,.32)*scatterFade(x,z,d,px,.32)*.8;
}
export function tonePebble(x,z,d,px) {
  return scatterStone(x+37.1,z-21.3,.24)*scatterFade(x,z,d,px,.24);
}
export function toneRelief(height, normalY, cavity, shade, noise) {
  const dry=smooth(0,180,height), steep=1-smooth(.55,.95,normalY);
  return Math.max(-.85,Math.min(.85,1.15*(noise*2-1)+.12*dry-.18*steep-.14*Math.max(0,cavity)-.10*shade));
}
// Scalar CPU reference for class-mean and range checks (no array allocation).
export function toneChannel(base,channel,relief,steep,grass,use,strength=1,grain=0,soil=1,rock=0,macro=.5,detail=1,pebble=0) {
  const tint=(channel===0?.015:channel===1?-.005:-.02)*steep+(channel===0?.26:channel===1?.34:.12)*grass;
  const natural=base*(1+strength*(relief+tint));
  const yard=base*1.08+.008;
  return Math.max(0,Math.min(1,(natural+(yard-natural)*use*strength)*detail*(1+soil*strength*(Math.max(-.35,Math.min(.35,grain*.8+pebble*.22*use))+(macro-.5)*.05*rock))));
}
// Catalog bounds are local to anchor_xz. Fill a site's gaps, rather than just its building floors.
export function groundUseBoxes(data) {
  const nodes=data.facilities?.nodes||[],bounds=n=>({
    x0:n.anchor_xz[0]+n.bbox_min[0],x1:n.anchor_xz[0]+n.bbox_max[0],
    z0:n.anchor_xz[1]+n.bbox_min[2],z1:n.anchor_xz[1]+n.bbox_max[2]
  });
  const boxes=nodes.filter(n=>['hall','buddha','sando','platform','stairs'].includes(n.part)).map(bounds);
  const sites=new Map();
  for(const n of nodes)if(n.facility&&['hall','gate','romon','torii','sando','stairs','kairo'].includes(n.part)){
    if(!sites.has(n.facility))sites.set(n.facility,[]);sites.get(n.facility).push(n);
  }
  for(const parts of sites.values()){
    const hall=parts.find(n=>n.part==='hall'),portal=parts.find(n=>n.part==='torii')||parts.find(n=>n.part==='gate'||n.part==='romon');
    if(!hall||!portal)continue;
    const bb=parts.map(bounds),b={x0:Math.min(...bb.map(v=>v.x0)),x1:Math.max(...bb.map(v=>v.x1)),z0:Math.min(...bb.map(v=>v.z0)),z1:Math.max(...bb.map(v=>v.z1))};
    // A bounded entrance apron follows the hall->torii axis. This is a visual
    // continuation inferred from placement, not a claim about a historical street.
    if(portal.part==='torii'){
      const h=bounds(hall),p=bounds(portal),dx=(p.x0+p.x1-h.x0-h.x1)/2,dz=(p.z0+p.z1-h.z0-h.z1)/2;
      const reach=Math.min(80,Math.hypot(dx,dz)*.25);
      if(Math.abs(dx)>Math.abs(dz)){if(dx>0)b.x1+=reach;else b.x0-=reach;}
      else if(dz>0)b.z1+=reach;else b.z0-=reach;
    }
    boxes.push(b);
  }
  return boxes;
}
export function groundUseAt(boxes,x,z) {
  let amount=0;
  for(const b of boxes){
    // The falloff ends 5 m outside a box: points beyond that square are exactly 0, so skip the hypot (the bake visits millions).
    if(x<b.x0-5||x>b.x1+5||z<b.z0-5||z>b.z1+5)continue;
    const d=Math.hypot(Math.max(b.x0-x,0,x-b.x1),Math.max(b.z0-z,0,z-b.z1));amount=Math.max(amount,1-smooth(0,5,d));
  }
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
