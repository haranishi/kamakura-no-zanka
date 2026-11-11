// Deterministic fire placement and shared smoke arithmetic; coordinates here are east/up/south.
export const FIRE = Object.freeze({
  maxSources: 8, maxBoards: 900, // counts: hard bounds for the entire layer.
  radiusMinM: 4, radiusMaxM: 30, strengthMin: .2, strengthMax: 1, // accepted map data.
  housesMin: 2, housesMax: 6, tonguesMin: 3, tonguesMax: 7, // counts per source / burning house.
  flameMinM: 4, flameMaxM: 9, flameScaleMin: .8, flameScaleMax: 1.6, // m / house height: tongue height.
  flameWidth: .65, roofEmbed: .3, eaveHeight: .62, roofInset: .38, // ratios: width, buried base, eave height, roof spread.
  flamePlanes: 3, flamePlanesMin: 2, flameCrossRad: Math.PI, // boards/tongue; radians: spread over a half turn (60° or 90° between boards).
  flameSizeMin: .62, flameSizeRange: .38, flamePeakEvery: 3, // height ratios; tongue interval: occasional tall ridge flare.
  flameTipStart: .72, flameSideStart: .7, // normalized board coordinates: soften tips and lateral edges to zero.
  coalGain: .8, coalHotMix: .62, coalCoolGain: .34, // linear gain; flame-colour blend; minimum patch brightness.
  coalHz: .42, coalPulse: .28, coalNoiseScale: 3.4, coalEdgeStart: .75, // Hz; flicker fraction; patch frequency; normalized edge fade start.
  roofSlope: .35, surfaceLiftM: .06, roofCoverage: .94, // rise/run; m; roof coverage ratio: fitted additive coal faces.
  openingGain: 1.7, openingWallLiftM: .035, openingBaseM: .12, openingEdgeM: .12, // gain; m: front face offset, floor and soft opening edge.
  doorWidthM: .9, doorHeightM: 1.7, windowWidthM: .7, windowHeightM: .5, windowYM: 1.45, windowOffset: .3, // m except horizontal window offset/house width: existing lamp layout.
  twoWindowsM: 5, openingEmbedM: .08, openingFlameScale: .82, // m: two-window facade threshold, buried flame plane; opening flame/roof height.
  flameWind: .22, flickerHz: .9, flickerAmount: .06, // drift/height; Hz and fractional local brightness modulation.
  flameLow: Object.freeze([.55,.06,.01]), flameMid: Object.freeze([1,.3,.04]), flameCore: Object.freeze([1,.62,.26]), // linear RGB from opening-fire's three flame bands.
  glowColor: Object.freeze([1,.4,.13]), glowGain: .5, glowRadiusMin: 1.2, glowRadiusMax: 1.8, houseGlowRadius: 1.15, // opening-fire RGB; gain; source radius ratios; house radius/height.
  poolGain: .48, poolMinM: 20, poolMaxM: 35, poolLiftM: .12, poolSegments: 2, // gain; m: terrain glow radius and clearance; grid divisions.
  poolFalloff: 3.6, poolEdgeStart: .45, poolFlickerHz: .55, poolFlickerAmount: .1, // radial decay; normalized edge fade; Hz and local modulation.
  poolShadowKeep: .18, poolShadowSoft: .06, poolRayEpsilon: .0001, // retained glow behind a house; normalized penumbra; ray tolerance.
  pointGain: 18, pointRangeM: 65, pointNearM: 80, pointHeightM: 4, // intensity; m: reach, walking activation, height above ground.
  smokeMinM: 60, smokeMaxM: 160, smokeHeightVariation: .08, smokeHeightPower: .9, // m: height endpoints; fractional source variation; normalized strength exponent.
  smokeBaseM: 5.2, smokeWidthVariation: .12, smokeWidthPower: .87, // m: base radius; fractional source variation; strength exponent for radius.
  smokeGrowth: 3.4, smokeTopSpread: 1, smokeTopSpreadStart: .6, // radius/base ratios: linear growth and extra upper spread; normalized tail start.
  smokeWindMin: .34, smokeWindMax: .54, smokeSway: .14, smokeSwayHz: .065, smokeTurns: 1.7, // drift/height; sway/height; Hz; waves/column.
  smokeDensity: .9, smokeFadeStart: .55, smokeBaseFade: .025, smokeDark: '#141210', smokeMidMix: .03, smokeSkyMix: .14, smokeLitMix: .65, // opacity / normalized height; soot mixed with sky or flame for three colour bands.
  smokeLitEnd: .25, smokeTopStart: .4, smokeRootHeight: .035, smokeNoiseScale: 2.1, smokeRise: .028, smokeEdge: .65, smokeEdgeSoft: .34, // normalized colour/root heights; noise frequency; column cycles/s; torn edge size/softness.
  smokeAspect: 1.1, smokeTopAspect: .28, smokeCapHeight: .94, smokeSwayMin: .65, // puff height/width at base/top; normalized cap height; minimum sway multiplier.
  smokeOverlap: 2.4, smokeSpacingJitter: .65, smokePuffVariation: .18, smokeDetailKeep: .72, // vertical overlap; spacing/size variation; minimum internal density.
  emberMin: 20, emberMax: 60, emberSizeM: .18, emberHeightM: 24, emberSpeed: .14, emberWind: .3, // count; m: point diameter/rise; cycles/s; wind drift/rise.
  emberRoofInset: .42, emberRoofLiftM: .08, emberRoofSlope: .35, emberSwirlM: 2.6, emberTurns: 2.3, // roof half-extent ratio; m clearance; ridge rise/short side; m swirl radius; turns/life.
  emberSpeedVariation: .6, emberHeightVariation: .35, emberTwinkleHz: .8, emberTwinkleAmount: .35, // fractional speed/rise variation; Hz and local brightness modulation.
  dayGain: .4, fogKeep: .55, fogReachM: 650, // daytime additive gain; minimum glow retained through fog; fallback fog reach.
  debugFlame: '#ff3300', debugGlow: '#ffff00', debugSmoke: '#aa33ff', debugEmber: '#00ffff', debugPool: '#ff0088', debugCoal: '#ff8800', debugOpening: '#33ff66', // category colours only for inspection.
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
      smokeHeight:mix(FIRE.smokeMinM,FIRE.smokeMaxM,strengthUnit(f.strength)**FIRE.smokeHeightPower)*(1-FIRE.smokeHeightVariation+FIRE.smokeHeightVariation*seed)});
  }
  return {sources,work};
}
export function fireCounts(prepared, quality='standard', step=0) {
  const tier=clamp(Math.floor(step)+(quality==='light'?1:0),0,3), sources=[];
  let boards=0;
  for(const source of prepared.sources) {
    const full=source.houses.length, budget=Math.floor(FIRE.maxBoards/prepared.sources.length), pools=FIRE.poolSegments**2;
    // Two roof faces and one masked facade (door + windows) share the additive batch.
    const surfaces=source.houses[0].ground?0:3, fixed=full*(surfaces+1)+1+pools;
    const cross=budget-fixed-FIRE.smokeCounts[1]-FIRE.emberMin>=full*FIRE.tonguesMin*FIRE.flamePlanes?FIRE.flamePlanes:FIRE.flamePlanesMin;
    const smokeBase=Math.min(FIRE.smokeCounts[0],budget-fixed-FIRE.emberMin-full*FIRE.tonguesMin*cross);
    const desired=Math.round(mix(FIRE.tonguesMin,FIRE.tonguesMax,strengthUnit(source.strength)));
    const tongueBase=Math.min(desired,Math.floor((budget-fixed-smokeBase-FIRE.emberMin)/(full*cross)));
    const houses=Math.max(1,Math.ceil(full*FIRE.houseFactors[tier]));
    const tongues=Math.min(FIRE.tongueCaps[tier],tongueBase), planes=tier===0?cross:FIRE.flamePlanesMin;
    const flames=houses*tongues*planes, glows=houses+1, coals=surfaces?houses*2:0, openings=surfaces?houses:0;
    const smoke=Math.min(smokeBase,FIRE.smokeCounts[tier]);
    const emberCap=budget-fixed-smokeBase-full*tongueBase*cross;
    const embers=Math.max(1,Math.round(Math.min(emberCap,mix(FIRE.emberMin,FIRE.emberMax,strengthUnit(source.strength)))*FIRE.emberFactors[tier]));
    sources.push({houses,tongues,planes,flames,coals,openings,glows,smoke,pools,embers});
    boards+=flames+coals+openings+glows+smoke+pools+embers;
  }
  return {tier,sources,boards};
}
// Roof/facade positions use the same box convention as the household lamps (+z is the front).
export function fireHouseLayout(house) {
  const h=house,c=Math.cos(h.rotY),s=Math.sin(h.rotY),alongX=h.w>=h.d;
  const half=(alongX?h.d:h.w)*FIRE.roofCoverage/2, run=(alongX?h.w:h.d)*FIRE.roofCoverage;
  const at=(x,y,z)=>({x:h.x+c*x+s*z,y:h.y+y,z:h.z-s*x+c*z});
  const ridge=h.height,roofY=cross=>ridge-FIRE.roofSlope*Math.abs(cross);
  const direction=(x,y,z)=>[c*x+s*z,y,-s*x+c*z];
  const roofs=[-1,1].map(side=>({
    ...at(alongX?0:side*half/2,roofY(half/2)+FIRE.surfaceLiftM,alongX?side*half/2:0),
    w:run,h:half*Math.hypot(1,FIRE.roofSlope),right:direction(alongX?1:0,0,alongX?0:1),
    up:direction(alongX?0:side/Math.hypot(1,FIRE.roofSlope),-FIRE.roofSlope/Math.hypot(1,FIRE.roofSlope),alongX?side/Math.hypot(1,FIRE.roofSlope):0),
  }));
  const wallHeight=Math.max(FIRE.doorHeightM+FIRE.openingBaseM,h.height*FIRE.eaveHeight);
  const facade={...at(0,wallHeight/2,h.d/2+FIRE.openingWallLiftM),w:h.w,h:wallHeight,right:direction(1,0,0),up:[0,1,0]};
  const openings=[{...at(0,FIRE.openingBaseM+FIRE.doorHeightM/2,h.d/2),w:FIRE.doorWidthM,h:FIRE.doorHeightM,kind:'door'}];
  for(const side of h.w>=FIRE.twoWindowsM?[-1,1]:[1])openings.push({...at(side*h.w*FIRE.windowOffset,FIRE.windowYM,h.d/2),w:FIRE.windowWidthM,h:FIRE.windowHeightM,kind:'window'});
  return {roofs,facade,openings,alongX};
}
export function flameTongue(source,house,index,count,out={}) {
  const key=(source.index+1)*4099+index+Math.imul(Math.round(house.x*100),31)+Math.imul(Math.round(house.z*100),131),alongX=house.w>=house.d;
  const fromOpening=!house.ground&&index===count-1,roofCount=house.ground?count:count-1;
  let dx=0,dz=0,base=0;
  const maxHeight=clamp(house.height*mix(FIRE.flameScaleMin,FIRE.flameScaleMax,source.strength),FIRE.flameMinM,FIRE.flameMaxM);
  const variation=index%FIRE.flamePeakEvery===0?1:FIRE.flameSizeMin+FIRE.flameSizeRange*fireRandom(key,7);
  out.height=clamp(maxHeight*variation*(fromOpening?FIRE.openingFlameScale:1),FIRE.flameMinM,FIRE.flameMaxM);
  if(fromOpening){
    const door=index%2===0;dx=door?0:house.w*FIRE.windowOffset;
    dz=house.d/2-FIRE.openingEmbedM;base=door?FIRE.openingBaseM+FIRE.doorHeightM:FIRE.windowYM+FIRE.windowHeightM/2;
  }else if(!house.ground){
    const along=(index/Math.max(1,roofCount-1)*2-1)*(alongX?house.w:house.d)*FIRE.roofInset;
    if(alongX)dx=along;else dz=along;
    base=house.height;
  }
  const c=Math.cos(house.rotY),s=Math.sin(house.rotY);
  out.x=house.x+c*dx+s*dz;out.z=house.z-s*dx+c*dz;out.y=house.y+base-out.height*FIRE.roofEmbed;
  out.angle=house.rotY+(alongX?0:Math.PI/2);out.opening=fromOpening;out.seed=fireRandom(key,8);return out;
}
export function smokeLight(t,day=1) {
  const u=clamp(t/FIRE.smokeLitEnd,0,1);
  return FIRE.smokeLitMix*day*(1-u*u*(3-2*u));
}
export function smokeProfile(t,height,windX=0,windZ=0,out={},seed=0,time=0,strength=1) {
  t=clamp(t,0,1);const f=clamp((t-FIRE.smokeFadeStart)/(1-FIRE.smokeFadeStart),0,1);
  const norm=Math.max(Math.hypot(windX,windZ),FIRE.poolRayEpsilon),wx=windX/norm,wz=windZ/norm;
  const base=FIRE.smokeBaseM*(1+FIRE.smokeWidthVariation*seed)*strength**FIRE.smokeWidthPower,lean=mix(FIRE.smokeWindMin,FIRE.smokeWindMax,seed);
  const phase=t*FIRE.smokeTurns*2*Math.PI-time*FIRE.smokeSwayHz*2*Math.PI+seed*2*Math.PI;
  const sway=height*FIRE.smokeSway*(FIRE.smokeSwayMin+(1-FIRE.smokeSwayMin)*seed)*t*(1-t)*Math.sin(phase), drift=height*lean*t*t;
  const top=clamp((t-FIRE.smokeTopSpreadStart)/(1-FIRE.smokeTopSpreadStart),0,1);
  out.radius=base*(1+(FIRE.smokeGrowth-1)*t+FIRE.smokeTopSpread*top*top*(3-2*top));
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
  float base=${gl(FIRE.smokeBaseM)}*(1.0+${gl(FIRE.smokeWidthVariation)}*seed)*pow(strength,${gl(FIRE.smokeWidthPower)});
  float lean=${gl(FIRE.smokeWindMin)}+${gl(FIRE.smokeWindMax-FIRE.smokeWindMin)}*seed;
  float phase=t*${gl(FIRE.smokeTurns*2*Math.PI)}-time*${gl(FIRE.smokeSwayHz*2*Math.PI)}+seed*${gl(2*Math.PI)};
  float sway=height*${gl(FIRE.smokeSway)}*(${gl(FIRE.smokeSwayMin)}+${gl(1-FIRE.smokeSwayMin)}*seed)*t*(1.0-t)*sin(phase),drift=height*lean*t*t;
  float top=clamp((t-${gl(FIRE.smokeTopSpreadStart)})/${gl(1-FIRE.smokeTopSpreadStart)},0.0,1.0);
  float radius=base*(1.0+${gl(FIRE.smokeGrowth-1)}*t+${gl(FIRE.smokeTopSpread)}*top*top*(3.0-2.0*top));
  float x=wx*drift-wz*sway,z=wz*drift+wx*sway;
  float root=clamp(t/${gl(FIRE.smokeBaseFade)},0.0,1.0);
  return vec4(radius,x,z,(1.0-f*f*(3.0-2.0*f))*${gl(FIRE.smokeDensity)}*root*root*(3.0-2.0*root));
}`;

export const FIRE_SMOKE_LIGHT_GLSL=`
float fireSmokeLight(float t,float day){
  float u=clamp(t/${gl(FIRE.smokeLitEnd)},0.0,1.0);
  return ${gl(FIRE.smokeLitMix)}*day*(1.0-u*u*(3.0-2.0*u));
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
