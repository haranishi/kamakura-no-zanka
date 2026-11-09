// Synthetic, public 30×12m fields; no terrain coordinates or browser timing.
import {createGrassLook} from '../dist/valley/kamakura-grass-look-view.js';
import {packGrassR10,grassR10At,GRASS_R10_SPECIES} from '../dist/valley/kamakura-grass-r10.js';
export const statistics=a=>{const mean=a.reduce((s,v)=>s+v,0)/a.length;return {mean,sd:Math.sqrt(a.reduce((s,v)=>s+(v-mean)**2,0)/a.length)};};
export function localGrassR10Metrics(ox=0,oz=0,height=.65) {
  const env=()=>({height,dry:.4,shade:.4,wet:.2,flowers:0,margin:0}),raw=[];
  for(let iz=0;iz<60;iz++)for(let ix=0;ix<150;ix++)raw.push(ox+ix*.2,0,oz+iz*.2,0,.22,.03,.3,.5,.08,.15,.03,0,0,1,0);
  const look=createGrassLook(env,'standard',{value:{}},true,true,true,true,true),before=look.pack(new Float32Array(raw),'near');
  const after=packGrassR10(before.slice(),'near',env),old=[],next=[],oldLeaf=[],nextLeaf=[],counts={};
  for(let i=0;i<before.length;i+=15){old.push(before[i+4]);next.push(after[i+4]);if(before[i+11]!==-1){oldLeaf.push(before[i+4]);nextLeaf.push(after[i+4]);}
    const v=grassR10At(before[i],before[i+2],env()),kind=Math.floor(-after[i+11])===2?'flower':v.kind;counts[kind]=(counts[kind]??0)+1;}
  return {origin:[ox,oz],ecologyHeight:height,records:old.length,before:statistics(old),after:statistics(next),sdGain:statistics(next).sd/statistics(old).sd,primaryGain:statistics(nextLeaf).sd/statistics(oldLeaf).sd,counts};
}
export function globalGrassR10Metrics() {
  const counts={},ranges={},colors=new Set();let total=0;
  const raw=[];
  for(let iz=0;iz<400;iz++)for(let ix=0;ix<400;ix++)raw.push(-80+ix*.4,0,-80+iz*.4,0,.22,.03,.3,.5,.08,.15,.03,0,0,1,0);
  const a=packGrassR10(new Float32Array(raw),'near',()=>({shade:.4,wet:.4}));
  for(let i=0;i<a.length;i+=15){
    const v=grassR10At(a[i],a[i+2],{shade:.4,wet:.4}),kind=Math.floor(-a[i+11])===2?'flower':v.kind;
    counts[kind]=(counts[kind]??0)+1;total++;
    const r=ranges[kind]??[Infinity,-Infinity];r[0]=Math.min(r[0],a[i+4]);r[1]=Math.max(r[1],a[i+4]);ranges[kind]=r;
    if(kind==='flower')colors.add([...a.slice(i+8,i+11)].join(','));
  }
  return {total,rates:Object.fromEntries(Object.entries(counts).map(([k,n])=>[k,n/total])),ranges,colors:colors.size,targets:Object.fromEntries(Object.entries(GRASS_R10_SPECIES).map(([k,v])=>[k,v.rate]))};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])console.log(JSON.stringify({local:[[0,0],[30,0],[-30,-12],[9,23]].map(p=>localGrassR10Metrics(...p)),dense:localGrassR10Metrics(0,0,1),global:globalGrassR10Metrics()},null,2));
