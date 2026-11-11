// Deterministic fire placement and shared smoke arithmetic; coordinates here are east/up/south.
export const FIRE = Object.freeze({
  maxSources: 8, maxBoards: 700, // counts: hard bounds for the entire layer.
  radiusMinM: 4, radiusMaxM: 30, strengthMin: .2, strengthMax: 1, // accepted map data.
  housesMin: 2, housesMax: 6, tonguesMin: 3, tonguesMax: 7, // counts per source / burning house.
  flameMinM: 4, flameMaxM: 9, flameScaleMin: .8, flameScaleMax: 1.6, // m / house height: tongue height.
  flameWidth: .65, roofEmbed: .3, eaveHeight: .62, roofInset: .3, // ratios: width, buried base, eave height, roof spread.
  flameWind: .22, flickerHz: .9, flickerAmount: .06, // drift/height; Hz and fractional local brightness modulation.
  flameLow: Object.freeze([.55,.06,.01]), flameMid: Object.freeze([1,.3,.04]), flameCore: Object.freeze([1,.62,.26]), // linear RGB from opening-fire's three flame bands.
  glowColor: Object.freeze([1,.4,.13]), glowGain: .65, glowRadiusMin: 1.2, glowRadiusMax: 1.8, houseGlowRadius: 1.15, // opening-fire RGB; gain; source radius ratios; house radius/height.
  poolGain: .48, poolMinM: 20, poolMaxM: 35, poolLiftM: .12, poolSegments: 2, // gain; m: terrain glow radius and clearance; grid divisions.
  pointGain: 18, pointRangeM: 65, pointNearM: 80, pointHeightM: 4, // intensity; m: reach, walking activation, height above ground.
  smokeMinM: 90, smokeMaxM: 160, smokeBaseM: 2.4, smokeSpread: .16, smokeWind: .28, // m: height/base radius; spread/height; drift/height.
  smokeDensity: .58, smokeFadeStart: .62, smokeDark: '#141210', smokeSkyMix: .32, smokeLitMix: .42, // opacity, normalized top fade; opening-scene soot mixed with current sky / flame.
  smokeNoiseScale: 2.7, smokeRise: .06, smokeEdge: .38, smokeAspect: 1.5, smokeOverlap: 1.8, // noise scale; normalized rise/s; edge breakup; puff height/width and vertical overlap.
  emberMin: 20, emberMax: 60, emberSizeM: .18, emberHeightM: 24, emberSpeed: .14, emberWind: .3, // count; m: point diameter/rise; cycles/s; wind drift/rise.
  dayGain: .4, fogKeep: .55, fogReachM: 650, // daytime additive gain; minimum glow retained through fog; fallback fog reach.
  debugFlame: '#ff3300', debugGlow: '#ffff00', debugSmoke: '#aa33ff', debugEmber: '#00ffff', debugPool: '#ff0088', // category colours only for inspection.
  houseFactors: Object.freeze([1,1,.5,.2]), tongueCaps: Object.freeze([7,5,3,3]), // quality steps: house fraction and tongue cap.
  smokeCounts: Object.freeze([10,8,6,4]), emberFactors: Object.freeze([1,.65,.35,.12]), // quality steps: puffs and ember fraction.
});
export const FIRE_EVENING = Object.freeze(['evening','dusk']);
export const fireEnabled = search => new URLSearchParams(search).get('fire') !== '0';
export const fireDayGain = time => FIRE_EVENING.includes(time) ? 1 : FIRE.dayGain;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const mix = (a,b,t) => a+(b-a)*t;
const strengthUnit = v => (v-FIRE.strengthMin)/(FIRE.strengthMax-FIRE.strengthMin);
export function validateFires(fires, meta) {
  if (fires === undefined) return;
  const fail = () => { throw new Error('火元のデータが不正です'); };
  if (!Array.isArray(fires) || fires.length > FIRE.maxSources) fail();
  if (!fires.length) return;
  const g=meta?.grid, hx=(g?.width-1)*g?.cell_m/2, hy=(g?.height-1)*g?.cell_m/2;
  if (!Number.isFinite(hx) || !Number.isFinite(hy) || hx<=0 || hy<=0) fail();
  for (const f of fires) if (!f || ![f.x,f.y,f.radius_m,f.strength].every(Number.isFinite) ||
    Math.abs(f.x)>hx || Math.abs(f.y)>hy || f.radius_m<FIRE.radiusMinM || f.radius_m>FIRE.radiusMaxM ||
    f.strength<FIRE.strengthMin || f.strength>FIRE.strengthMax) fail();
}
// Stable nearest-first selection, including added houses. Ties depend on geometry/ID, never array order.
export function selectFireHouses(fire, boxes, work={scans:0}) {
  const selected=[], limit=Math.round(mix(FIRE.housesMin,FIRE.housesMax,strengthUnit(fire.strength)));
  const compare=(a,b)=>a.distance-b.distance || a.box.x-b.box.x || a.box.z-b.box.z ||
    a.box.w-b.box.w || a.box.d-b.box.d || a.box.height-b.box.height || a.box.rotY-b.box.rotY || String(a.box.id).localeCompare(String(b.box.id));
  for (const box of boxes) {
    work.scans++;
    const distance=Math.hypot(box.x-fire.x,box.z+fire.y);
    if (distance>fire.radius_m) continue;
    const item={box,distance}; let i=0;
    while(i<selected.length && compare(selected[i],item)<=0)i++;
    if(i<limit){selected.splice(i,0,item);if(selected.length>limit)selected.pop();}
  }
  return selected.map(item=>item.box);
}
export function prepareFires(context) {
  if (!fireEnabled(context.search)) return null;
  const fires=context.data?.meta?.fires;
  validateFires(fires,context.data?.meta);
  if (!fires?.length) return null;
  const work={scans:0,terrainSamples:0}, sources=[];
  const height=(x,z)=>{work.terrainSamples++;return context.terrain.heightAt(x,z);};
  // Boxes omit foundation y. The already fitted matrix is available by ID in the live data.
  const fitted=new Map((context.data.houses?.instances||[]).filter(i=>i.grounded).map(i=>['house-'+i.id,i.grounded[13]]));
  for(let i=0;i<fires.length;i++) {
    const f=fires[i], chosen=selectFireHouses(f,context.houses?.boxes||[],work), groundY=height(f.x,-f.y);
    const houses=chosen.map(b=>({...b,y:fitted.get(b.id)??height(b.x,b.z),ground:false}));
    if(!houses.length) houses.push({id:'ground-'+i,x:f.x,z:-f.y,y:groundY,w:f.radius_m,d:f.radius_m,height:FIRE.flameMinM,rotY:0,ground:true});
    sources.push({index:i,x:f.x,z:-f.y,y:groundY,radius:f.radius_m,strength:f.strength,houses,
      smokeHeight:mix(FIRE.smokeMinM,FIRE.smokeMaxM,strengthUnit(f.strength))});
  }
  return {sources,work};
}
export function fireCounts(prepared, quality='standard', step=0) {
  const tier=clamp(Math.floor(step)+(quality==='light'?1:0),0,3), sources=[];
  let fixed=0, baseline=0;
  for(const source of prepared.sources) {
    const houses=Math.max(1,Math.ceil(source.houses.length*FIRE.houseFactors[tier]));
    const tongues=Math.min(FIRE.tongueCaps[tier],Math.round(mix(FIRE.tonguesMin,FIRE.tonguesMax,strengthUnit(source.strength))));
    const flames=houses*tongues, glows=houses+1, smoke=FIRE.smokeCounts[tier], pools=FIRE.poolSegments**2;
    const embers=Math.max(1,Math.round(mix(FIRE.emberMin,FIRE.emberMax,strengthUnit(source.strength))*FIRE.emberFactors[tier]));
    sources.push({houses,tongues,flames,glows,smoke,pools,embers});fixed+=flames+glows+smoke+pools;
    baseline+=source.houses.length*(Math.round(mix(FIRE.tonguesMin,FIRE.tonguesMax,strengthUnit(source.strength)))+1)+1+FIRE.smokeCounts[0]+pools;
  }
  const emberCap=Math.floor((FIRE.maxBoards-baseline)/sources.length);
  let boards=fixed;
  for(const s of sources){s.embers=Math.min(s.embers,Math.max(1,Math.round(emberCap*FIRE.emberFactors[tier])));boards+=s.embers;}
  return {tier,sources,boards};
}
export function smokeProfile(t,height,windX=0,windZ=0,out={}) {
  t=clamp(t,0,1);const f=clamp((t-FIRE.smokeFadeStart)/(1-FIRE.smokeFadeStart),0,1);
  out.radius=FIRE.smokeBaseM+height*FIRE.smokeSpread*t;
  out.x=windX*height*FIRE.smokeWind*t*t;out.z=windZ*height*FIRE.smokeWind*t*t;
  out.opacity=(1-f*f*(3-2*f))*FIRE.smokeDensity;
  return out;
}
const gl=n=>Number(n).toFixed(8);
export const FIRE_SMOKE_GLSL=`
vec4 fireSmokeProfile(float t,float height,vec2 wind){
  t=clamp(t,0.0,1.0);
  float f=clamp((t-${gl(FIRE.smokeFadeStart)})/${gl(1-FIRE.smokeFadeStart)},0.0,1.0);
  float radius=${gl(FIRE.smokeBaseM)}+height*${gl(FIRE.smokeSpread)}*t;
  vec2 drift=wind*height*${gl(FIRE.smokeWind)}*t*t;
  return vec4(radius,drift,(1.0-f*f*(3.0-2.0*f))*${gl(FIRE.smokeDensity)});
}`;
