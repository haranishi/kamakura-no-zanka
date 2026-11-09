// Synthetic 30×12m leaf radiance; not a framebuffer, tone-map or performance claim.
import {grassR7Shade,packGrassR7} from '../../dist/valley/kamakura-grass-r7.js';
import {grassR5Floor} from '../../dist/valley/kamakura-grass-r5.js';
import {grassLuminance,grassR4Variation,grassR4Pigment} from '../../dist/valley/kamakura-grass-look.js';
export function localGrassR7Metrics(indirectScale=.35,sunY=1) {
  let weight=0,before=0,after=0,beforeSq=0,afterSq=0;
  const sky=[.65,.8,1];
  for(let z=0;z<12;z+=.4)for(let x=0;x<30;x+=.4){
    const stock=grassR4Variation(x,z),color=grassR4Pigment([.035,.07,.015],x,z,stock,1);
    const raw=new Float32Array([x,0,z,0,.3,.03,.3,.5,...color,0,0,1,0]);
    const pigment=[...packGrassR7(raw,'near','standard').subarray(8,11)];
    // Preserve R4's fine stock drift and .40→1.15 gradient in both models.
    for(let j=0;j<=100;j++){
      const t=j/100,w=(1-t)**.65,c=color.map(v=>v*(.4+.75*t)),next=pigment.map(v=>v*(.4+.75*t));
      const current=c.map(v=>.008+indirectScale*v),nextCurrent=next.map(v=>.008+indirectScale*v);
      const floor=grassR5Floor(c,sky,current,0,sunY);
      const a=grassLuminance(current.map((v,i)=>v+floor[i])),b=grassLuminance(grassR7Shade(next,sky,nextCurrent,0,sunY,t));
      weight+=w;before+=a*w;after+=b*w;beforeSq+=a*a*w;afterSq+=b*b*w;
    }
  }
  before/=weight;after/=weight;
  const beforeSD=Math.sqrt(Math.max(0,beforeSq/weight-before*before)),afterSD=Math.sqrt(Math.max(0,afterSq/weight-after*after));
  return {indirectScale,sunY,beforeMean:before,afterMean:after,meanChange:after/before-1,beforeSD,afterSD,sdGain:afterSD/beforeSD};
}
