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
  poolFalloff: 3.6, poolEdgeStart: .45, poolFlickerHz: .55, poolFlickerAmount: .1, // radial decay; normalized edge fade; Hz and local modulation.
  poolShadowKeep: .18, poolShadowSoft: .06, poolRayEpsilon: .0001, // retained glow behind a house; normalized penumbra; ray tolerance.
  pointGain: 18, pointRangeM: 65, pointNearM: 80, pointHeightM: 4, // intensity; m: reach, walking activation, height above ground.
  smokeMinM: 90, smokeMaxM: 160, smokeHeightVariation: .14, smokeBaseM: 5.2, smokeWidthVariation: .24, // m: column height/base radius; fractional source variation.
  smokeStrengthWidth: .4, smokeGrowth: 4.4, smokeWindMin: .34, smokeWindMax: .54, smokeSway: .14, smokeSwayHz: .065, smokeTurns: 1.7, // fractional strength width; top/base radius; drift/height; sway/height; Hz; waves/column.
  smokeDensity: .9, smokeFadeStart: .55, smokeBaseFade: .025, smokeDark: '#141210', smokeMidMix: .03, smokeSkyMix: .14, smokeLitMix: .07, // opacity / normalized height; soot mixed with sky or flame for three colour bands.
  smokeLitEnd: .22, smokeTopStart: .4, smokeRootHeight: .035, smokeNoiseScale: 2.1, smokeRise: .028, smokeEdge: .65, smokeEdgeSoft: .34, // normalized colour/root heights; noise frequency; column cycles/s; torn edge size/softness.
  smokeAspect: 1.1, smokeOverlap: 1.8, smokeSpacingJitter: .65, smokePuffVariation: .18, smokeDetailKeep: .72, // puff height/width; vertical overlap; spacing/size variation; minimum internal density.
  emberMin: 20, emberMax: 60, emberSizeM: .18, emberHeightM: 24, emberSpeed: .14, emberWind: .3, // count; m: point diameter/rise; cycles/s; wind drift/rise.
  emberRoofInset: .42, emberRoofLiftM: .08, emberRoofSlope: .35, emberSwirlM: 2.6, emberTurns: 2.3, // roof half-extent ratio; m clearance; ridge rise/short side; m swirl radius; turns/life.
  emberSpeedVariation: .6, emberHeightVariation: .35, emberTwinkleHz: .8, emberTwinkleAmount: .35, // fractional speed/rise variation; Hz and local brightness modulation.
  dayGain: .4, fogKeep: .55, fogReachM: 650, // daytime additive gain; minimum glow retained through fog; fallback fog reach.
  debugFlame: '#ff3300', debugGlow: '#ffff00', debugSmoke: '#aa33ff', debugEmber: '#00ffff', debugPool: '#ff0088', // category colours only for inspection.
  houseFactors: Object.freeze([1,1,.5,.2]), tongueCaps: Object.freeze([7,5,3,3]), // quality steps: house fraction and tongue cap.
  smokeCounts: Object.freeze([32,24,16,8]), emberFactors: Object.freeze([1,.65,.35,.12]), // quality steps: puffs and ember fraction.
});
export const FIRE_EVENING = Object.freeze(['evening','dusk']);
export const fireEnabled = search => new URLSearchParams(search).get('fire') !== '0';
export const fireDayGain = time => FIRE_EVENING.includes(time) ? 1 : FIRE.dayGain;
const clamp = (v,a,b) => Math.max(a,Math.min(b,v));
const mix = (a,b,t) => a+(b-a)*t;
const strengthUnit = v => (v-FIRE.strengthMin)/(FIRE.strengthMax-FIRE.strengthMin);
// Integer hash: stable independent streams, never a lattice or a shared random clock.
export function fireRandom(seed, channel=0) {
  let n=(seed^Math.imul(channel+1,0x9e3779b9))>>>0;
  n=Math.imul(n^(n>>>16),0x21f0aaad);n=Math.imul(n^(n>>>15),0x735a2d97);
  return ((n^(n>>>15))>>>0)/4294967296;
}
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
    const seed=fireRandom(i+1,0);
    sources.push({index:i,x:f.x,z:-f.y,y:groundY,radius:f.radius_m,strength:f.strength,houses,seed,
      smokeHeight:mix(FIRE.smokeMinM,FIRE.smokeMaxM,strengthUnit(f.strength)*(1-FIRE.smokeHeightVariation+FIRE.smokeHeightVariation*seed))});
  }
  return {sources,work};
}
export function fireCounts(prepared, quality='standard', step=0) {
  const tier=clamp(Math.floor(step)+(quality==='light'?1:0),0,3), sources=[];
  let fixed=0, baseline=0;
  for(const source of prepared.sources) {
    const houses=Math.max(1,Math.ceil(source.houses.length*FIRE.houseFactors[tier]));
    const desired=Math.round(mix(FIRE.tonguesMin,FIRE.tonguesMax,strengthUnit(source.strength)));
    // Reserve dense smoke and at least 20 embers in the worst eight-source scene.
    const budget=Math.floor(FIRE.maxBoards/prepared.sources.length), reserve=source.houses.length+1+FIRE.smokeCounts[0]+FIRE.poolSegments**2+FIRE.emberMin;
    const budgetTongues=Math.max(FIRE.tonguesMin,Math.min(desired,Math.floor((budget-reserve)/source.houses.length)));
    const tongues=Math.min(FIRE.tongueCaps[tier],budgetTongues);
    const flames=houses*tongues, glows=houses+1, smoke=FIRE.smokeCounts[tier], pools=FIRE.poolSegments**2;
    const embers=Math.max(1,Math.round(mix(FIRE.emberMin,FIRE.emberMax,strengthUnit(source.strength))*FIRE.emberFactors[tier]));
    sources.push({houses,tongues,flames,glows,smoke,pools,embers});fixed+=flames+glows+smoke+pools;
    baseline+=source.houses.length*(budgetTongues+1)+1+FIRE.smokeCounts[0]+pools;
  }
  const emberCap=Math.floor((FIRE.maxBoards-baseline)/sources.length);
  let boards=fixed;
  for(const s of sources){s.embers=Math.min(s.embers,Math.max(1,Math.round(emberCap*FIRE.emberFactors[tier])));boards+=s.embers;}
  return {tier,sources,boards};
}
export function smokeProfile(t,height,windX=0,windZ=0,out={},seed=0,time=0,strength=1) {
  t=clamp(t,0,1);const f=clamp((t-FIRE.smokeFadeStart)/(1-FIRE.smokeFadeStart),0,1);
  const norm=Math.max(Math.hypot(windX,windZ),FIRE.poolRayEpsilon),wx=windX/norm,wz=windZ/norm;
  const base=FIRE.smokeBaseM*(1+FIRE.smokeWidthVariation*seed)*(1+FIRE.smokeStrengthWidth*strengthUnit(strength)),lean=mix(FIRE.smokeWindMin,FIRE.smokeWindMax,seed);
  const phase=t*FIRE.smokeTurns*2*Math.PI-time*FIRE.smokeSwayHz*2*Math.PI+seed*2*Math.PI;
  const sway=height*FIRE.smokeSway*t*(1-t)*Math.sin(phase), drift=height*lean*t*t;
  out.radius=base*(1+(FIRE.smokeGrowth-1)*t);
  out.x=wx*drift-wz*sway;out.z=wz*drift+wx*sway;
  const root=clamp(t/FIRE.smokeBaseFade,0,1);
  out.opacity=(1-f*f*(3-2*f))*FIRE.smokeDensity*root*root*(3-2*root);
  return out;
}
const gl=n=>Number(n).toFixed(8);
export const FIRE_SMOKE_GLSL=`
vec4 fireSmokeProfile(float t,float height,vec2 wind,float seed,float time,float strength){
  t=clamp(t,0.0,1.0);
  float f=clamp((t-${gl(FIRE.smokeFadeStart)})/${gl(1-FIRE.smokeFadeStart)},0.0,1.0);
  float norm=max(length(wind),${gl(FIRE.poolRayEpsilon)}),wx=wind.x/norm,wz=wind.y/norm;
  float base=${gl(FIRE.smokeBaseM)}*(1.0+${gl(FIRE.smokeWidthVariation)}*seed)*(1.0+${gl(FIRE.smokeStrengthWidth)}*(strength-${gl(FIRE.strengthMin)})/${gl(FIRE.strengthMax-FIRE.strengthMin)});
  float lean=${gl(FIRE.smokeWindMin)}+${gl(FIRE.smokeWindMax-FIRE.smokeWindMin)}*seed;
  float phase=t*${gl(FIRE.smokeTurns*2*Math.PI)}-time*${gl(FIRE.smokeSwayHz*2*Math.PI)}+seed*${gl(2*Math.PI)};
  float sway=height*${gl(FIRE.smokeSway)}*t*(1.0-t)*sin(phase),drift=height*lean*t*t;
  float radius=base*(1.0+${gl(FIRE.smokeGrowth-1)}*t);
  float x=wx*drift-wz*sway,z=wz*drift+wx*sway;
  float root=clamp(t/${gl(FIRE.smokeBaseFade)},0.0,1.0);
  return vec4(radius,x,z,(1.0-f*f*(3.0-2.0*f))*${gl(FIRE.smokeDensity)}*root*root*(3.0-2.0*root));
}`;

export function emberOrigin(source, index, out={}) {
  const h=source.houses[index%source.houses.length],key=(source.index+1)*4099+index;
  const dx=(fireRandom(key,1)*2-1)*h.w*FIRE.emberRoofInset,dz=(fireRandom(key,2)*2-1)*h.d*FIRE.emberRoofInset;
  const cross=h.w<=h.d?dx:dz;
  out.x=h.x+Math.cos(h.rotY)*dx+Math.sin(h.rotY)*dz;out.z=h.z-Math.sin(h.rotY)*dx+Math.cos(h.rotY)*dz;
  // Box height is the ridge. Approximate a pitched roof inside that envelope.
  out.y=h.y+(h.ground?0:h.height-FIRE.emberRoofSlope*Math.abs(cross))+FIRE.emberRoofLiftM;
  out.phase=fireRandom(key,3);out.variation=fireRandom(key,4);return out;
}

// Smooth radial light; a ray passing through a rotated house loses most of its ground glow.
export function poolOcclusion(u,v,blocks) {
  let keep=1;
  for(const b of blocks){
    const x=b.cos*u-b.sin*v,z=b.sin*u+b.cos*v,cx=b.cos*b.x-b.sin*b.z,cz=b.sin*b.x+b.cos*b.z;
    if(Math.abs(cx)<=b.w&&Math.abs(cz)<=b.d)continue;
    const dx=Math.abs(x)<FIRE.poolRayEpsilon?FIRE.poolRayEpsilon:x,dz=Math.abs(z)<FIRE.poolRayEpsilon?FIRE.poolRayEpsilon:z;
    const ax=(cx-b.w)/dx,bx=(cx+b.w)/dx,az=(cz-b.d)/dz,bz=(cz+b.d)/dz;
    const enter=Math.max(Math.min(ax,bx),Math.min(az,bz),0),exit=Math.min(Math.max(ax,bx),Math.max(az,bz));
    const t=clamp((Math.min(1,exit)-enter)/FIRE.poolShadowSoft,0,1);
    keep=Math.min(keep,1-(1-FIRE.poolShadowKeep)*t*t*(3-2*t));
  }
  return keep;
}
