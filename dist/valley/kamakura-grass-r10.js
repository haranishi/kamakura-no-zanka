// W2c-15 variety: equal-sized ribbons -> world-keyed colonies, in the same slots.
// Pure preparation rules: no scene, DOM, clock, random source or private map data.
import { grassHash, grassR4Pigment, grassLuminance } from './kamakura-grass-look.js';
const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v);return v*v*(3-2*v);};
export const grassR10Enabled=search=>new URLSearchParams(search).get('grass10')!=='0';
export const GRASS_R10_SPECIES=Object.freeze({
  short:{rate:.25,min:.10,max:.25,marker:0,width:.030},
  ordinary:{rate:.46,min:.25,max:.55,marker:0,width:.042},
  long:{rate:.205,min:.60,max:1.0,marker:0,width:.038},
  susuki:{rate:.02,min:1.2,max:1.8,marker:-14,width:.055},
  fern:{rate:.046,min:.28,max:.55,marker:-10,width:.11},
  seed:{rate:.006,min:.65,max:.95,marker:-15,width:.065},
  dandelion:{rate:.008,min:.12,max:.22,marker:-12,width:.10},
  clover:{rate:.005,min:.10,max:.20,marker:-13,width:.12}
});
const names=Object.keys(GRASS_R10_SPECIES);
// Jittered Voronoi cells have no square boundaries; two nearest sites also give
// a smooth, 30cm growth shoulder. Species identity never uses the window/array.
export function grassR10Colony(x,z,scale=3,seed=2101) {
  const ix=Math.floor(x/scale),iz=Math.floor(z/scale);let best=Infinity,next=Infinity,sx=0,sz=0;
  for(let j=iz-1;j<=iz+1;j++)for(let i=ix-1;i<=ix+1;i++){
    const px=(i+.2+.6*grassHash(i,j,seed))*scale,pz=(j+.2+.6*grassHash(i,j,seed+1))*scale;
    const d=Math.hypot(x-px,z-pz);
    if(d<best){next=best;best=d;sx=i;sz=j;}else if(d<next)next=d;
  }
  return {x:sx,z:sz,edge:smooth((next-best)/.3),rank:((sx*.754877666+sz*.569840296+grassHash(sx,sz,seed+7)*.12)%1+1)%1,rare:grassHash(sx,sz,seed+11)};
}
// Complete world-metre cells are the existing nearTile/streaming contract.
// Choose 2–5 distinct existing roots per active cell, independent of input order.
export function grassR10FlowerGroup(x,z,blades=200) {
  const ix=Math.floor(x),iz=Math.floor(z),count=clamp(Math.round(blades*.025),2,5);
  if(grassHash(ix,iz,2201)>Math.min(1,blades*.022/count))return null;
  const color=Math.min(3,Math.floor(grassR10Colony(ix+.5,iz+.5,7,2301).rank*4));
  return {count,color,x:ix,z:iz,cx:ix+.3+.4*grassHash(ix,iz,2207),cz:iz+.3+.4*grassHash(ix,iz,2213)};
}
export function grassR10Flowers(data) {
  const cells=new Map(),selected=new Map();
  for(let i=0;i<data.length;i+=15){const x=data[i],z=data[i+2],key=`${Math.floor(x)},${Math.floor(z)}`;
    let cell=cells.get(key);if(!cell){cell={count:0,candidates:[]};cells.set(key,cell);}cell.count++;
    // Low companion blades and old decorative copies share roots: use one stalk.
    if(data[i+11]!==-1&&data[i+11]!==-2)cell.candidates.push(i);
  }
  for(const cell of cells.values()){
    if(cell.candidates.length<2)continue;
    const first=cell.candidates[0],group=grassR10FlowerGroup(data[first],data[first+2],cell.count);
    if(!group)continue;
    const score=i=>(data[i]-group.cx)**2+(data[i+2]-group.cz)**2;
    cell.candidates.sort((a,b)=>score(a)-score(b)||data[a]-data[b]||data[a+2]-data[b+2]);
    const count=Math.min(group.count,cell.candidates.length);
    for(let n=0;n<count;n++)selected.set(cell.candidates[n],{...group,count,index:n});
  }
  return selected;
}
const RARE=['susuki','fern','seed','dandelion','clover'],MAIN=names.filter(n=>!RARE.includes(n));
const rareTotal=RARE.reduce((n,k)=>n+GRASS_R10_SPECIES[k].rate,0),mainTotal=1-rareTotal;
export function grassR10At(x,z,e={},slot=0) {
  const colony=grassR10Colony(x,z),u=grassHash(x,z,2401+slot);
  // R9 parent tuning: the three height classes keep the low-discrepancy rank (every 30x12m window has the same mix);
  // the rare species use an independent hash, so they land at random instead of on regular diagonal bands.
  let kind;
  if(colony.rare<rareTotal){
    let sum=0;kind=RARE.at(-1);
    for(const name of RARE){sum+=GRASS_R10_SPECIES[name].rate;if(colony.rare<sum){kind=name;break;}}
  }else{
    // Intermix identities across a soft 30cm edge, rather than cutting a hedge.
    const pick=((colony.rank+(1-colony.edge)*.08*(u-.5)+1)%1)*mainTotal;
    let sum=0;kind=MAIN.at(-1);
    for(const name of MAIN){sum+=GRASS_R10_SPECIES[name].rate;if(pick<sum){kind=name;break;}}
  }
  // The fern allotment follows moist/shaded ground; dry clearings use mugwort.
  if(kind==='fern'&&Math.max(e.wet??0,e.shade??0)<.25)kind='mugwort';
  // A large colony contains separate 1–3m tussocks, not a wall of tall reeds.
  if(kind==='susuki'){
    const stand=grassR10Colony(x,z,1.7,2501);
    colony.edge*=.65+.35*stand.edge;
    // R9 parent tuning: tussocks, not a wall of reeds. Only the heart of a stand is tall; its shoulders are long grass.
    if(stand.edge<.55)kind='long';
  }
  const spec=GRASS_R10_SPECIES[kind]??{min:.30,max:.55,marker:-11,width:.055};
  const growth=clamp(.10*colony.edge+.90*u);
  return {kind,height:spec.min+(spec.max-spec.min)*growth,
    marker:spec.marker,width:spec.width,
    hue:(grassHash(x,z,2411+slot)-.5)*.16,
    widthScale:.45+1.10*grassHash(x,z,2417+slot),
    lean:(grassHash(x,z,2423+slot)-.5)*.90,
    flower:null};
}
const linear=v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4;
export const GRASS_R10_FLOWERS=Object.freeze([[.76,.75,.67],[.78,.64,.25],[.55,.39,.66],[.77,.55,.62]].map(c=>Object.freeze(c.map(linear))));
const tint={fern:[.73,1.02,.87],mugwort:[1.05,.97,1.2],susuki:[1.06,1,.92],seed:[1.14,.94,.76],dandelion:[1.10,1.02,.86],clover:[.83,1.06,.95]};
export function packGrassR10(data,kind,ecology,quality='standard',enabled=true) {
  if(!enabled)return data;
  // Mid cards retain the existing atlas and colour; only prepared height varies.
  const flowers=kind==='near'&&quality!=='light'?grassR10Flowers(data):null;
  for(let i=0;i<data.length;i+=15){
    const x=data[i],z=data[i+2],oldMarker=data[i+11],slot=oldMarker===-1?1:oldMarker===-2?2:0;
    const e=ecology(Math.floor(x)+.5,Math.floor(z)+.5),v=grassR10At(x,z,e,slot);
    const flower=flowers?.get(i);
    if(flower){v.kind='flower';v.marker=-2;v.width=.085;v.height=.25+.35*grassHash(x,z,2401);v.flower=flower;}
    data[i+4]=v.height+(kind==='mid'?.12:0);
    if(quality==='light'||kind!=='near')continue;
    // Fractions preserve old low/flower slot visibility without another buffer.
    data[i+11]=v.marker-(oldMarker===-1?.25:oldMarker===-2?.5:0);data[i+5]=v.width*v.widthScale;
    data[i+6]=clamp(data[i+6]+v.lean,-.45,1.15);
    // Preserve existing blade/stock luminance and all its fine pigment variation.
    const original=Array.from(data.subarray(i+8,i+11));
    const base=oldMarker< -1.5?[.08,.15,.035]:original;
    let color=grassR4Pigment(base,x,z,{brightness:1,blade:1,hue:v.hue},1);
    const scale=tint[v.kind];
    if(scale){const y=grassLuminance(color);color=color.map((c,j)=>c*scale[j]);const gain=y/Math.max(1e-6,grassLuminance(color));color=color.map(c=>c*gain);}
    if(v.flower)color=GRASS_R10_FLOWERS[v.flower.color];
    data.set(color,i+8);
  }
  return data;
}
