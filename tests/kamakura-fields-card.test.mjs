// This test-only JavaScript copy must be updated whenever kzFieldCard's GLSL expressions change.
// Keep the duplicate implementation here; the product evaluates the card only in GLSL.
import test from 'node:test';
import assert from 'node:assert/strict';
import { FIELD_CARD_WIDTHS, FIELD_HEIGHTS } from '../dist/valley/kamakura-fields-kit.js';
import { FIELD_KINDS } from '../dist/valley/kamakura-fields.js';
const fract=v=>v-Math.floor(v),mix=(a,b,t)=>a+(b-a)*t,step=(a,b)=>b<a?0:1;
const rand=n=>fract(Math.sin(n*91.3458)*47453.5453);
const aspects=FIELD_CARD_WIDTHS.map((w,i)=>Number((w/FIELD_HEIGHTS[i]).toFixed(6)));
function card(kind,ux,v,seed,coarse=0,fine=0) {
  const u=ux*2-1;
  if(kind<.5) {
    if(coarse>.5)return v>.62?(Math.hypot(fract(u*1.5+seed)-.5,(v-.80)*1.6)<.30?2:0):(Math.abs(u)<mix(.08,.9,v/.62)?1:0);
    const px=u*.5*aspects[0],rho=Math.hypot(px,v),theta=Math.atan2(px,v)*(1-.32*Math.min(rho,1));
    if(Math.abs(theta)>1.25)return 0;
    const cells=(theta+1.25)*4.4+seed*7,cell=Math.floor(cells),c=fract(cells)-.5;
    const h1=rand(cell+seed*31),h2=rand(cell*1.7+5+seed*13),stalk=h2>.42&&Math.abs(theta)<.6;
    const len=stalk?mix(.74,1,h1):mix(.42,.78,h1);
    if(rho>len)return 0;
    if(stalk) {
      const along=(rho-len+.26)/.26,droop=c-Math.sign(h1-.5)*.30*Math.max(along,0)*Math.max(along,0);
      if(along>0) {
        const reach=.035+.13*Math.sin(3.141593*Math.min(1,along*1.04));
        const barb=fine>.5?step(fract(along*15-Math.abs(droop)*9),.62):1;
        return Math.abs(droop)<.02||(Math.abs(droop)<reach&&barb>.5)?2:0;
      }
      return Math.abs(c)<.05?1:0;
    }
    return Math.abs(c)<.05+.30*(1-rho/len)?1:0;
  }
  if(kind<3.5) {
    if(coarse>.5)return v>.60?(Math.hypot(fract(u*1.5+seed)-.5,(v-.80)*2)<.36?2:0):(Math.abs(fract(u*1.5+seed)-.5)<.12?1:0);
    const count=kind<1.5?4:kind<2.5?3:2,aspect=kind<1.5?aspects[1]:kind<2.5?aspects[2]:aspects[3];
    const cells=(u*.5+.5)*count,cell=Math.floor(cells),c=fract(cells)-.5;
    const h1=rand(cell+seed*17),h2=rand(cell*2.3+1+seed*29);
    const top=mix(.62,.92,h1),x=c+(h2-.5)*.5*v,wide=aspect/count,dx=x*wide,dy=v-top;
    if(kind<1.5) {
      const r=Math.hypot(dx,dy),a=Math.atan2(dy,dx);
      if(r<.085*(.78+.22*Math.cos(a*5+h2*6)))return r<.018?3:2;
    } else if(kind<2.5) {
      if(Math.hypot(dx,dy*2.6)<.125)return 2;
      if(Math.hypot((x-Math.sign(h2-.5)*.24)*wide,(v-top+.15)*2.6)<.075)return 2;
    } else {
      const r=Math.hypot(dx,dy*1.25);
      if(r<.085)return r<.022?3:2;
      const r2=Math.hypot((x+Math.sign(h2-.5)*.34)*wide,(v-top+.17)*1.25);
      if(h1>.35&&r2<.07)return r2<.018?3:2;
    }
    if(v<top&&Math.abs(x)<.05)return 1;
    const rung=fract(v*(kind<2.5?5:9)+h1*3),blade=Math.abs(rung-.5);
    const side=step(.5,fract(v*(kind<2.5?2.5:4.5)+h1*1.5))*2-1;
    if(v<top-.10&&blade<.16&&x*side>0&&Math.abs(x)<.34*(1-blade/.16))return 1;
    return 0;
  }
  if(Math.hypot(ux-.5,v-.5)>.5)return 0;
  const gx=ux*4+seed*9,gy=v*4+seed*9,ix=Math.floor(gx),iy=Math.floor(gy);
  const h1=rand(ix*7.3+iy*13.7+seed*3),h2=rand(ix*3.1+iy*5.9+2+seed);
  const qx=fract(gx)-.5+(h1-.5)*.3,qy=fract(gy)-.5+(h2-.5)*.3,r=Math.hypot(qx,qy);
  if(h2>.68)return r<.10?3:r<.34?2:0;
  return r<.40&&h1>.2?1:0;
}

test('card grid contains leaves, flowers/plumes and holes, with heads above leaves and a round beach mat',t=>{
  const diagnostics=[];
  for(let kind=0;kind<FIELD_KINDS.length;kind++)for(const mode of ['normal','coarse','fine']) {
    let leaf=0,bloom=0,empty=0,upper=0,leafY=0,bloomY=0,outside=0;
    for(let seedIndex=0;seedIndex<12;seedIndex++)for(let y=0;y<100;y++)for(let x=0;x<100;x++) {
      const u=(x+.5)/100,v=(y+.5)/100,value=card(kind,u,v,(seedIndex+.37)/12,mode==='coarse'?1:0,mode==='fine'?1:0);
      assert(Number.isInteger(value)&&value>=0&&value<=3);
      if(value===0)empty++;
      else if(value===1){leaf++;leafY+=v;}
      else {bloom++;bloomY+=v;if(v>.5)upper++;}
      if(kind===4&&Math.hypot(u-.5,v-.5)>.5){assert.equal(value,0);outside++;}
    }
    assert(leaf>0&&bloom>0&&empty>0,`${kind}/${mode}: all three parts must exist`);
    if(kind<4) {
      assert(upper/bloom>.90,`${kind}/${mode}: heads should occupy upper half`);
      assert(bloomY/bloom>leafY/leaf,`${kind}/${mode}: heads should stand above leaves`);
    } else {
      // The bindweed card lies flat; upper/lower UV halves are compass directions, not plant height.
      assert(outside>0);assert(upper/bloom>.4&&upper/bloom<.6);
    }
    diagnostics.push({kind:FIELD_KINDS[kind],mode,leaf,bloom,empty,upperFraction:upper/bloom});
  }
  t.diagnostic(JSON.stringify(diagnostics));
});
