// 棚田の見た目専用の配置。地形・道・当たりの値は変更しない。
import { cellRand } from './scatter.js';
import { createTerrain } from './terrain-height.js';

export const PADDY = Object.freeze({
  sampleStep: .5, lineStep: 1.2, maskMin: .90, edgeNoise: .025, // m／比：段の標本・折れ線間隔・栽培域と外縁の揺れ。
  bundEdgeFraction: .02, edgeFrequencyX: .71, edgeFrequencyZ: .83, // 段内比／rad/m：畦の余白と外縁の雑音。
  splitJitter: .6, splitPeriod: 11, flatTolerance: .025, // m：南北畦の蛇行・波長・踏み面の許容高低差。
  stoneBandWidth: 1.4, rowJitter: .35, rowSpacing: 1.05, // m／比：法面の帯幅・条内の株の揺れ・遠景の条間。
  edgeAmplitude: 4, edgePeriods: [18, 23], edgeDetail: .18, edgeMaskFloor: .3, // m／比：外縁の変位・波長・細部・栽培域の下限。
  maxPlotArea: 500, splitAreaTarget: 390, harvestCluster: 3, harvestNorthBias: .65, // ㎡／枚／比：区画上限と分割余裕・刈田の塊・北への偏り。
  edgeStonePitch: 4, edgeStoneChance: .35, // m／比：外縁の崩れた石の間隔と採用率。
  propStepX: 1, propStepZ: .4, // m：狭い踏み面で稲架と藁束の置き場を探す刻み。
  standing: .60, harvested: .25, partial: .15, // 枚数比。端数は最も近い整数へ。
  bundWidth: .65, bundHeight: .19, // m：草の畦の幅と田面からの高さ。
  variation: .08, // 色・丈の区画差の最大比率。
  nearStart: 60, nearEnd: 95, farEnd: 300, // m：近遠混合帯と標準の最遠距離。
  farStep: 1.15, lightDensity: .15, lightEnd: 200, // m／比率：遠景株の条内間隔・軽量密度・軽量距離。
  adaptDensity: .22, adaptDistance: 20, // 段階ごとの密度比の減少・距離短縮m。
  stoneMin: .3, stoneMax: .7, stonePitch: 1.2, stoneLayers: 2, // m／段：野面石の寸法・間隔・層数。
  rackCount: 8, rackMinLength: 4, rackMaxLength: 7, rackHeight: 1.8, // 台／m：稲架の数・長さ・高さ。
  strawCount: 28, strawHeight: 1.2, propClearance: 3, // 個／m：藁束の数・高さ・道とゾーンからの余白。
  stoneDepthMin: .25, stoneDepthMax: .45, stoneNear: 40, // m：石の厚みと個別の石から帯へ切り替える距離。
  stoneTilt: 12, stoneHeightMin: .18, shallowDrop: .25, // 度／m：最大傾斜・一段積みへ切り替える落差。
  bundSegments: 6, lightBundSegments: 4, bundSpaceX: .73, bundSpaceZ: .61, // 点数-1／mの逆数：畦の断面分割・起伏の空間位相。
  bundJitter: .10, bundHeightJitter: .02, bundGrassDensity: 4, grassMin: .15, grassMax: .4, // m／株毎m：畦の起伏・草密度・草丈。
  stubbleStep: .3, stubblePitch: .26, stubbleHeight: .11, stubbleDiameter: .10, stubbleStems: 5, // m／本：条間・株間・丈・径・茎数。
  grassRadius: .075, grassBladeWidth: .018, stubbleBladeWidth: .008, // m：草の房の開き・草葉と藁茎の幅。
  detailEnd: 40, lightDetailEnd: 18, detailAdapt: 5, // m：草・切り株の形の距離（品質段階で短縮）。
  detailFade: 2, // m：近景の草・切り株が消える直前に縮む帯。
  triangleBudget: 120000, lightTriangleBudget: 50000, updateStep: .5, // 三角形／m：品質上限と位置更新間隔。

});
export const PADDY_LOOK = Object.freeze({
  tintA: '#b8963c', tintB: '#d6b658', // 既存の稲のインスタンス色（sRGB）。
  tip: [.84, .64, .27], groundGain: 1.10, // 既存の穂の頂点色と、地面・刈田の明るさ倍率。
  grass: '#65803d', rock: '#d2d2c8', wood: '#bfae92', // 既存の高草・里の薄い岩・木材の色。
  soil: '#967850', soilGain: .42, cutRiceMix: .65, cutGain: 1.38, cutPatch: .15, patchGain: 1.25, // 土は既存地図の土色(150,120,80)。刈田は稲を65%混色、15%に落ち藁。
  riceGreen: .18, rootEnd: 40, rootStart: 22, waveShade: .08, // 緑の残る黄・根元の暗土から地色への距離m・条と風の明暗比。
  rockGain: .66, rockVariation: .12, rockSoil: .5, rockGrass: .10, // 既存岩色の明度・石ごとの差・上段の土と草色の混合。
  bundSoil: .25, bundCrownGain: 1.25, strawWhite: .35, // 比：畦の土の混色率・壁上の畦の明度倍率・藁束の白木色混合率。
  phaseRange: 256, phaseOffset: 128, // m：条の座標テクスチャの符号化範囲と原点。
  rowGradient: .1, rowPeriod: 1.05, rowStrength: .06, cutRowStrength: .10, // m/m／m／比：条の高さ方向換算・周期・立稲と刈田の筋。
  groundWaveDirection: [Math.SQRT1_2, Math.SQRT1_2], // 単位方向：地色を渡る風。波長を斜め方向でもm単位に保つ。
  groundWavePeriod: 16, groundWaveStrength: .08, groundWaveSpeed: .18, // m／比／rad/s：地色の風の波長・明暗・速度。
  debugHueStep: 1/7, debugSaturation: .85, debugTreadLightness: .6, debugRiserLightness: .35, // 確認色：段の色相間隔・彩度・踏み面と法面の明度。
  farGain: .88, farDesaturate: .12, farWarmth: .90, farHueVariation: .006, // 比／色相：既存の稲色から遠景を暗く・低彩度・橙へ、区画の熟れ差。
  farRootGain: .94, farTipMix: .24, farShadowTint: [1.06, .97, .86], // 比：根元の明度・穂先の混色・日陰の橙茶。
  // 遠景の色は線形RGBで計算する。
  farShadeFloor: .66, stoneShadow: .42, stoneShadowWidth: .5, stoneGrassEdge: .16, // 比／m：房の日陰・石帯下端の影・影幅・上端の草混色。
  mapStep: .5, farWidth: .85, farHeight: .24, // m：地色格子、遠景の房の幅・丈。
  windSpaceX: .37, windSpaceZ: .21, windSlow: 1.15, windFast: 2.4, // 既存稲と同じ風の空間位相・角速度。
  windPhase: 1.7, windAmplitude: .045, windX: .5, windZ: .28, // 風の位相倍率・振幅・方向成分。
  flutter: .03, flutterX: 3.6, flutterZ: 3.1, flutterHeight: 1.9, flutterWidth: 1.7, // 既存稲の小揺れ。
  detailsLift: .025, rackRadius: .065, sheafRadius: .14, // m：接地の余白・丸太半径・干した稲束の半径。
});
export const PADDY_DEBUG = Object.freeze({ standing: '#ffff00', harvested: '#804020', partial: '#ff8000', bund: '#00ff00', stone: '#aaaaaa', rack: '#ff0000' });

const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const hash = (seed, x, z) => cellRand(seed + 2303, Math.round(x * 100), Math.round(z * 100))();
export function paddyOptions(search = '') {
  const q = new URLSearchParams(search);
  return { enabled: q.get('paddy') !== '0', debug: q.get('paddydebug') === '1' };
}
export function paddyQuality(quality = 'standard', level = 0) {
  const n = clamp(Math.floor(level), 0, 3), light = quality === 'light';
  return { density: (light ? PADDY.lightDensity : 1) * (1 - n * PADDY.adaptDensity),
    distance: (light ? PADDY.lightEnd : PADDY.farEnd) - n * PADDY.adaptDistance };
}
export function paddyWeights(distance, quality = 'standard', level = 0) {
  const far = smooth(PADDY.nearStart, PADDY.nearEnd, distance);
  const end = paddyQuality(quality, level).distance;
  return { near: 1 - far, far: far * (1 - smooth(end - PADDY.adaptDistance, end, distance)) };
}
// 0.5m標本の連続する段番号。以後の配置はこの格子を共有し、高価な地形評価を繰り返さない。
function terraceField(world, terrain) {
  const T = world.terraces, step = PADDY.sampleStep;
  const nx = Math.round((T.x1-T.x0)/step)+1, nz = Math.round((T.z1-T.z0)/step)+1;
  const values = new Float64Array(nx*nz), masks = new Float64Array(nx*nz), heights = new Float64Array(nx*nz);
  for (let j=0;j<nz;j++) for(let i=0;i<nx;i++) {
    const x=T.x0+i*step,z=T.z0+j*step,t=terrain.terraceAt(x,z),k=j*nx+i;
    values[k]=t.level+t.frac; masks[k]=t.mask; heights[k]=terrain.heightAt(x,z);
  }
  const sample=(data,x,z)=> {
    const u=clamp((x-T.x0)/step,0,nx-1),v=clamp((z-T.z0)/step,0,nz-1),i=Math.min(nx-2,Math.floor(u)),j=Math.min(nz-2,Math.floor(v)),a=u-i,b=v-j,k=j*nx+i;
    return (data[k]*(1-a)+data[k+1]*a)*(1-b)+(data[k+nx]*(1-a)+data[k+nx+1]*a)*b;
  };
  return { nx,nz,step,values,masks,edge:1-T.riser/(T.drop*14),
    exactHeight:terrain.heightAt, exactTerrace:terrain.terraceAt, value:(x,z)=>sample(values,x,z), mask:(x,z)=>sample(masks,x,z), height:(x,z)=>sample(heights,x,z) };
}
// 二つの波長を重ねて直線の外縁を崩す。角は元のmaskの積で丸くつながる。
export function paddyEdgeMask(field,x,z) {
  const [a,b]=PADDY.edgePeriods, wave=t=>PADDY.edgeAmplitude*(Math.sin(t/a*2*Math.PI)+PADDY.edgeDetail*Math.sin(t/b*2*Math.PI))/(1+PADDY.edgeDetail);
  return Math.min(field.mask(x,z)/PADDY.edgeMaskFloor, field.mask(x+wave(z),z+wave(x)));
}
const splitX=(p,z,right=false)=> (right?p.x1:p.x0) + ((right?p.outerRight:p.outerLeft)?0:PADDY.splitJitter*Math.sin(z/PADDY.splitPeriod*2*Math.PI+p.level));
export function createPaddyPlots(world, terrain = createTerrain(world)) {
  // 一部の描画試験は平面の代用品を渡す。段の定義自体は必ず実地形から取る。
  const source=terrain.terraceAt?terrain:createTerrain(world), field=terraceField(world,source), T=world.terraces, levels=new Map(), plots=[];
  for(let j=0;j<field.nz;j++) for(let i=0;i<field.nx;i++) {
    const k=j*field.nx+i;if(paddyEdgeMask(field,T.x0+i*field.step,T.z0+j*field.step)<PADDY.maskMin)continue;
    const level=Math.floor(field.values[k]),x=T.x0+i*field.step,z=T.z0+j*field.step;
    if(!levels.has(level))levels.set(level,{level,x0:x,x1:x,z0:z,z1:z,area:0});
    const b=levels.get(level);b.area+=field.step**2;b.x0=Math.min(b.x0,x);b.x1=Math.max(b.x1,x);b.z0=Math.min(b.z0,z);b.z1=Math.max(b.z1,z);
  }
  const bands=[...levels.values()].filter(b=>b.x1-b.x0>2 && b.z1-b.z0>1).sort((a,b)=>a.z0-b.z0 || b.level-a.level);
  for(const [row,b] of bands.entries()) {
    const count=Math.min(3,Math.max(1+Math.floor(hash(world.seed,b.level,0)*3),Math.ceil(b.area/Math.min(PADDY.splitAreaTarget,PADDY.maxPlotArea))));
    for(let i=0;i<count;i++) plots.push({id:plots.length,row,level:b.level,x0:b.x0+(b.x1-b.x0)*i/count,x1:b.x0+(b.x1-b.x0)*(i+1)/count,z0:b.z0,z1:b.z1,
      outerLeft:i===0,outerRight:i===count-1,hue:(hash(world.seed+20,b.level,i)*2-1)*PADDY_LOOK.farHueVariation,tint:1+(hash(world.seed,b.level,i)*2-1)*PADDY.variation,height:1+(hash(world.seed+1,b.level,i)*2-1)*PADDY.variation});
  }
  plots.forEach(p=>{p.area=0;});
  Object.defineProperties(plots,{field:{value:field},world:{value:world},bands:{value:bands}});
  for(let z=T.z0+field.step/2;z<T.z1;z+=field.step)for(let x=T.x0+field.step/2;x<T.x1;x+=field.step){const s=paddyAt(plots,x,z);if(s?.cultivated)s.plot.area+=field.step**2;}
  // 面積0の細い法面だけの切れ端は田に数えない。田面がある帯と区画だけを残す。
  for(let i=plots.length-1;i>=0;i--)if(!plots[i].area)plots.splice(i,1);
  for(let i=bands.length-1;i>=0;i--)if(!plots.some(p=>p.level===bands[i].level))bands.splice(i,1);
  plots.forEach((p,id)=>{p.id=id;p.row=bands.findIndex(b=>b.level===p.level);});
  const total=PADDY.standing+PADDY.harvested+PADDY.partial, cut=Math.round(plots.length*PADDY.harvested/total),partial=Math.round(plots.length*PADDY.partial/total);
  plots.forEach(p=>{p.kind='standing';});
  // 各南北区間に2〜4枚の連続した塊を置く。窓の中だけ北寄りにし、南の刈田も残す。
  const clusters=Math.max(1,Math.round(cut/PADDY.harvestCluster));
  for(let c=0;c<clusters;c++) {
    const first=Math.floor(c*plots.length/clusters),last=Math.floor((c+1)*plots.length/clusters),size=Math.floor(cut/clusters)+(c<cut%clusters?1:0);
    const offset=Math.floor(hash(world.seed+2,c,0)*(last-first-size)*PADDY.harvestNorthBias);
    for(let i=0;i<size;i++)plots[first+offset+i].kind='harvested';
  }
  plots.filter(p=>p.kind==='standing').sort((a,b)=>hash(world.seed+21,a.level,a.x0)-hash(world.seed+21,b.level,b.x0)).slice(0,partial).forEach(p=>{p.kind='partial';});
  return plots;
}
export function paddyAt(plots,x,z) {
  const T=plots.world.terraces;if(x<T.x0||x>=T.x1||z<T.z0||z>=T.z1)return null;
  const field=plots.field,mask=paddyEdgeMask(field,x,z),threshold=PADDY.maskMin+PADDY.edgeNoise*Math.sin(x*PADDY.edgeFrequencyX+Math.sin(z*PADDY.edgeFrequencyZ));
  if(mask<threshold)return null;
  const f=field.value(x,z),terrace=field.exactTerrace(x,z),level=terrace.level,frac=terrace.frac;
  const p=plots.find(p=>p.level===level&&x>=splitX(p,z)&&x<splitX(p,z,true));if(!p)return null;
  const hasDrop=Math.max(0,(level+1)*T.drop)-Math.max(0,level*T.drop)>=PADDY.shallowDrop;
  const riser=hasDrop&&frac>=field.edge;
  const target=Math.max(0,level*T.drop);
  const flat=Math.abs(field.exactHeight(x,z)-target)<=PADDY.flatTolerance;
  const flatBoundary=Math.min(frac,1-frac)*T.drop/PADDY_LOOK.rowGradient<PADDY.bundWidth/2;
  const bund=(!hasDrop&&flatBoundary)||(!p.outerLeft&&x-splitX(p,z)<PADDY.bundWidth/2)||(!p.outerRight&&splitX(p,z,true)-x<PADDY.bundWidth/2)||(hasDrop&&(frac<PADDY.bundEdgeFraction||frac>field.edge-PADDY.bundEdgeFraction));
  return {plot:p,bund:bund||riser||!flat,riser,frac,mask,cultivated:flat&&!riser,
    rowPhase:f*T.drop/PADDY_LOOK.rowGradient,cut:p.kind==='harvested'||(p.kind==='partial'&&frac<field.edge/2)};
}
// Marching squares：各セルの辺の交点を繋ぐ。位置ハッシュによる配置と同じく再現可能。
function terraceLines(plots) {
  const {field,world}=plots,T=world.terraces,lines=[],step=field.step;
  const key=p=>`${p.x.toFixed(5)},${p.z.toFixed(5)}`;
  for(const band of plots.bands) {
    const iso=band.level+(band.level>=0?(1+field.edge)/2:1),segments=[],nodes=new Map();
    for(let j=0;j<field.nz-1;j++)for(let i=0;i<field.nx-1;i++) {
      const k=j*field.nx+i, ids=[k,k+1,k+field.nx+1,k+field.nx],xy=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]],hits=[];
      for(let e=0;e<4;e++) {const n=(e+1)%4,a=field.values[ids[e]],b=field.values[ids[n]];
        if((a<iso)===(b<iso))continue;const t=(iso-a)/(b-a);
        hits.push({x:T.x0+(xy[e][0]+t*(xy[n][0]-xy[e][0]))*step,z:T.z0+(xy[e][1]+t*(xy[n][1]-xy[e][1]))*step});
      }
      for(let e=0;e+1<hits.length;e+=2) {const a=hits[e],b=hits[e+1],id=segments.length;segments.push([a,b]);for(const p of [a,b]){const k=key(p);if(!nodes.has(k))nodes.set(k,[]);nodes.get(k).push(id);}}
    }
    const used=new Set();
    const walk=(id,start)=>{const points=[start];let p=start;
      while(id!==undefined&&!used.has(id)){used.add(id);const s=segments[id];p=key(p)===key(s[0])?s[1]:s[0];points.push(p);id=nodes.get(key(p)).find(n=>!used.has(n));}
      return points;
    };
    const paths=[];
    for(const s of segments)for(const p of s)if(nodes.get(key(p)).length===1){const id=nodes.get(key(p))[0];if(!used.has(id))paths.push(walk(id,p));}
    segments.forEach((s,id)=>{if(!used.has(id))paths.push(walk(id,s[0]));});
    for(const path of paths) {
      let carry=0,points=[path[0]];
      for(let i=1;i<path.length;i++){const a=path[i-1],b=path[i],len=Math.hypot(b.x-a.x,b.z-a.z);let d=PADDY.lineStep-carry;
        while(d<=len){points.push({x:a.x+(b.x-a.x)*d/len,z:a.z+(b.z-a.z)*d/len});d+=PADDY.lineStep;}carry=len-(d-PADDY.lineStep);
      }
      points.push(path.at(-1));if(points.length>2)lines.push({level:band.level,row:plots.find(p=>p.level===band.level).row,points});
    }
  }
  return lines;
}
const clearRoad = (terrain, x, z, margin = 0) => { const road = terrain.roadInfo(x, z); return !road || road.dist > margin; };
export function paddyPropClear(world, terrain, x, z, radius) {
  return clearRoad(terrain, x, z, PADDY.propClearance + radius)
    && Object.values(world.zones).every(p => Math.hypot(x - p.x, z - p.z) >= p.r + PADDY.propClearance + radius)
    && Object.values(world.spawns).flat().filter(p => p.kind && (p.patrol || p.route)).every(p => (p.patrol || p.route).every(([px, pz], i, path) => {
      if (!i) return true;
      const [ax, az] = path[i - 1], dx = px - ax, dz = pz - az;
      const t = clamp(((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
      return Math.hypot(x - ax - t * dx, z - az - t * dz) >= PADDY.propClearance + radius;
    }));
}
// 地形メッシュと同じ1m格子の三角形で高さを補間（被せる草畦・切り株の沈みを防ぐ）。
export function paddyGroundHeight(terrain, x, z) {
  const ix = Math.floor(x), iz = Math.floor(z), u = x - ix, v = z - iz;
  const a = terrain.heightAt(ix, iz), b = terrain.heightAt(ix + 1, iz), c = terrain.heightAt(ix, iz + 1), d = terrain.heightAt(ix + 1, iz + 1);
  return u + v <= 1 ? a + u * (b - a) + v * (c - a) : d + (1 - u) * (c - d) + (1 - v) * (b - d);
}
export function createPaddyLayout(world, terrain) {
  const T=world.terraces,plots=createPaddyPlots(world,terrain),field=plots.field,lines=terraceLines(plots);
  const stones=[],bunds=[],far=[],stubble=[],grass=[],walls=[],racks=[],straw=[];
  const boundaries=new Map();
  const direction=(x,z)=>{const e=field.step,dx=field.value(x+e,z)-field.value(x-e,z),dz=field.value(x,z+e)-field.value(x,z-e),l=Math.hypot(dx,dz)||1;return {x:dx/l,z:dz/l};};
  const addBund=(a,b,row,flat=false,outer=false,crown=false)=>{
    const length=Math.hypot(b.x-a.x,b.z-a.z),x=(a.x+b.x)/2,z=(a.z+b.z)/2;
    if(length<.01||!clearRoad(terrain,x,z,length/2+PADDY.bundWidth/2))return;
    bunds.push({flat,outer,crown,x,z,y:paddyGroundHeight(terrain,x,z),y0:paddyGroundHeight(terrain,a.x,a.z),y1:paddyGroundHeight(terrain,b.x,b.z),a,b,row,sx:length,sz:PADDY.bundWidth,alongX:true,jitter:PADDY.bundJitter});
  };
  let stoneLength=0,contourLength=0;
  for(const line of lines)for(let i=1;i<line.points.length;i++) {
    const a=line.points[i-1],b=line.points[i],x=(a.x+b.x)/2,z=(a.z+b.z)/2,length=Math.hypot(b.x-a.x,b.z-a.z);
    if(paddyEdgeMask(field,x,z)<PADDY.maskMin+PADDY.edgeNoise*Math.sin(x*PADDY.edgeFrequencyX+Math.sin(z*PADDY.edgeFrequencyZ))||!clearRoad(terrain,x,z,length/2+PADDY.stoneBandWidth))continue;
    contourLength+=length;
    const n=direction(x,z),half=PADDY.stoneBandWidth/2;
    const realDrop=Math.abs(field.height(x+n.x*half,z+n.z*half)-field.height(x-n.x*half,z-n.z*half));
    if(line.level<0||realDrop<PADDY.shallowDrop) {
      addBund(a,b,line.row,line.level<0);if(!boundaries.has(line.level))boundaries.set(line.level,false);continue;
    }
    boundaries.set(line.level,true);
    const edge=p=>{const n=direction(p.x,p.z),half=PADDY.stoneBandWidth/2;
      return [ {x:p.x+n.x*half,z:p.z+n.z*half}, {x:p.x-n.x*half,z:p.z-n.z*half} ];};
    const [aTop,aBottom]=edge(a),[bTop,bBottom]=edge(b);
    for(const p of [aTop,aBottom,bTop,bBottom])p.y=clamp(paddyGroundHeight(terrain,p.x,p.z)+PADDY_LOOK.detailsLift,Math.max(0,line.level*T.drop),(line.level+1)*T.drop);
    const top=Math.max(aTop.y,bTop.y,aBottom.y,bBottom.y),bottom=Math.min(aTop.y,bTop.y,aBottom.y,bBottom.y);
    const shadow=p=>{const n=direction(p.x,p.z),x=p.x-n.x*PADDY_LOOK.stoneShadowWidth,z=p.z-n.z*PADDY_LOOK.stoneShadowWidth;return {x,z,y:paddyGroundHeight(terrain,x,z)+PADDY_LOOK.detailsLift};};
    walls.push({aShadow:shadow(aBottom),bShadow:shadow(bBottom),realDrop,row:line.row,level:line.level,x,z,top,bottom,drop:top-bottom,width:length,aTop,aBottom,bTop,bBottom});stoneLength+=length;
    addBund(aTop,bTop,line.row,false,false,true);
    const layers=top-bottom<PADDY.shallowDrop?1:PADDY.stoneLayers;
    for(let layer=0;layer<layers;layer++) {
      const t=(layer+.5)/layers,ax=aBottom.x+(aTop.x-aBottom.x)*t,az=aBottom.z+(aTop.z-aBottom.z)*t,bx=bBottom.x+(bTop.x-bBottom.x)*t,bz=bBottom.z+(bTop.z-bBottom.z)*t;
      const sx=ax+(bx-ax)*(layer?.65:.3),sz=az+(bz-az)*(layer?.65:.3),y=paddyGroundHeight(terrain,sx,sz);
      stones.push({row:line.row,layer,layers,x:sx,z:sz,y,top:Math.max(top,y),bottom:Math.min(bottom,y),drop:top-bottom,followsContour:true,
        width:PADDY.stoneMin+hash(world.seed+layer,x,z)*(PADDY.stoneMax-PADDY.stoneMin),height:Math.max(PADDY.stoneHeightMin,(top-bottom)/layers),depth:PADDY.stoneDepthMin+hash(world.seed+8,x,layer)*(PADDY.stoneDepthMax-PADDY.stoneDepthMin),tilt:(hash(world.seed+9,x,layer)*2-1)*PADDY.stoneTilt,turn:hash(world.seed+10,x,layer)*Math.PI*2,shade:1+(hash(world.seed+11,x,layer)*2-1)*PADDY_LOOK.rockVariation});
    }
  }
  // 稲をやめる縁の外に草の土手とまばらな崩れ石。長い直線を追加しない。
  for(const side of ['east','west','south','north']) {
    const alongX=side==='south'||side==='north', high=side==='east'||side==='south';let previous=null;
    const from=alongX?T.x0:T.z0,to=alongX?T.x1:T.z1;
    for(let u=from;u<to;u+=PADDY.lineStep) {
      let point=null;
      for(let v=high?(alongX?T.z1:T.x1):(alongX?T.z0:T.x0);high?v>(alongX?T.z0:T.x0):v<(alongX?T.z1:T.x1);v+=high?-field.step:field.step) {
        const x=alongX?u:v,z=alongX?v:u;
        if(paddyAt(plots,x,z)){point={x,z};break;}
      }
      if(point&&previous&&Math.hypot(point.x-previous.x,point.z-previous.z)<PADDY.edgeStonePitch)addBund(previous,point,-1,false,true);
      if(point&&hash(world.seed+22,u,from)<PADDY.edgeStoneChance&&Math.round((u-from)/PADDY.lineStep)%Math.ceil(PADDY.edgeStonePitch/PADDY.lineStep)===0&&paddyPropClear(world,terrain,point.x,point.z,.5)) {
        const y=paddyGroundHeight(terrain,point.x,point.z),height=PADDY.stoneHeightMin;
        stones.push({x:point.x,z:point.z,y,top:y+height/2,bottom:y-height/2,height,width:PADDY.stoneMin,depth:PADDY.stoneDepthMin,tilt:0,turn:hash(world.seed+23,u,from)*Math.PI,shade:1,layer:0,layers:1,outer:true});
      }
      previous=point;
    }
  }
  // 南北の短い仕切り。外縁を長方形の畦で囲まない。
  for(const p of plots)if(!p.outerLeft)for(let z=p.z0;z<p.z1;z+=1){const a={x:splitX(p,z),z},b={x:splitX(p,z+1),z:z+1},s=paddyAt(plots,a.x+.01,a.z);if(s?.cultivated)addBund(a,b,p.row);}
  // 等高線の座標（連続した段番号）に沿う条を、x方向に追う。
  const fillRows=(spacing,pitch,jitter,visit)=>{
    for(let x=T.x0+pitch/2;x<T.x1;x+=pitch) {
      const crossings=[];
      for(let z=T.z0;z<T.z1;z+=field.step){const a=field.value(x,z)*T.drop,b=field.value(x,z+field.step)*T.drop;
        const lo=Math.min(a,b),hi=Math.max(a,b);for(let row=Math.ceil(lo/spacing);row*spacing<hi;row++) {
          const t=(row*spacing-a)/(b-a),jx=x+(hash(world.seed+16,x,row)*2-1)*pitch*jitter,jz=z+t*field.step;
          if(crossings.some(c=>Math.abs(c-jz)<field.step/2))continue;crossings.push(jz);
          const s=paddyAt(plots,jx,jz);if(s&&!s.bund&&clearRoad(terrain,jx,jz,PADDY.bundWidth/2))visit(jx,jz,s,row);
        }
      }
    }
  };
  // 平均的な勾配 .1m/m を使い、見た目の条間を約1mにする。段の中では同じ位相を共有。
  fillRows(PADDY.rowSpacing*PADDY_LOOK.rowGradient,PADDY.farStep,PADDY.rowJitter,(x,z,s,row)=>{if(!s.cut)far.push({x,z,y:paddyGroundHeight(terrain,x,z),plot:s.plot.id,row,rank:hash(world.seed+3,x,z),height:s.plot.height});});
  fillRows(PADDY.stubbleStep*PADDY_LOOK.rowGradient,PADDY.stubblePitch,0,(x,z,s,row)=>{if(s.cut)stubble.push({x,z,y:paddyGroundHeight(terrain,x,z),plot:s.plot.id,row,alongX:true,height:PADDY.stubbleHeight*(.8+.4*hash(world.seed+12,x,z))});});
  for(const b of bunds)for(let i=0,count=Math.ceil(b.sx*PADDY.bundGrassDensity);i<count;i++) {
    const t=(i+.5)/count,x=b.a.x+(b.b.x-b.a.x)*t,z=b.a.z+(b.b.z-b.a.z)*t;
    grass.push({x,z,y:b.y0+t*(b.y1-b.y0)+PADDY.bundHeight+paddyBundLift(x,z),height:PADDY.grassMin+(PADDY.grassMax-PADDY.grassMin)*hash(world.seed+13,x,z)});
  }
  const rackQuota=Math.ceil(PADDY.rackCount/plots.filter(p=>p.kind==='harvested').length);
  // 小物の全ての足が同じ踏み面に収まることを確認。道・任務・巡回の余白は元の判定を使う。
  for(let z=T.z0;z<T.z1;z+=PADDY.propStepZ)for(let x=T.x0;x<T.x1;x+=PADDY.propStepX) {
    const s=paddyAt(plots,x,z);if(!s||s.bund||s.plot.kind!=='harvested')continue;
    const n=direction(x,z),turn=Math.atan2(n.x,n.z),dx=n.z,dz=-n.x;
    const length=PADDY.rackMinLength+hash(world.seed+4,x,z)*(PADDY.rackMaxLength-PADDY.rackMinLength),radius=Math.hypot(length/2,.8);
    const foot=(along,across)=>paddyAt(plots,x+dx*along+n.x*across,z+dz*along+n.z*across);
    if(racks.filter(r=>r.plot===s.plot.id).length<rackQuota&&racks.length<PADDY.rackCount && paddyPropClear(world,terrain,x,z,radius)&&[-1,1].every(a=>[-.8,.8].every(b=>{const q=foot(a*length/2,b);return q&&!q.bund&&q.plot.id===s.plot.id;})) && racks.every(r=>Math.hypot(x-r.x,z-r.z)>radius+r.radius+1))racks.push({x,z,y:paddyGroundHeight(terrain,x,z),turn,length,height:PADDY.rackHeight,radius,plot:s.plot.id});
    if(straw.filter(r=>r.plot===s.plot.id).length>=4||straw.length>=PADDY.strawCount||racks.some(r=>Math.hypot(x-r.x,z-r.z)<r.radius+1.5)||straw.some(r=>Math.hypot(x-r.x,z-r.z)<3))continue;
    const cluster=[];
    for(let k=0;k<4;k++){const sx=x+dx*(k%2)*.8+n.x*Math.floor(k/2)*.8,sz=z+dz*(k%2)*.8+n.z*Math.floor(k/2)*.8,q=paddyAt(plots,sx,sz);
      if(!q||q.bund||q.plot.id!==s.plot.id||!paddyPropClear(world,terrain,sx,sz,.5)||racks.some(r=>Math.hypot(sx-r.x,sz-r.z)<r.radius+.7))break;
      cluster.push({x:sx,z:sz,y:paddyGroundHeight(terrain,sx,sz),height:PADDY.strawHeight*(.9+.2*hash(world.seed+5,sx,sz)),plot:s.plot.id});}
    if(cluster.length===4)straw.push(...cluster);
  }
  far.sort((a,b)=>a.rank-b.rank);
  return {bounds:T,plots,lines,stones,walls,bunds,far,stubble,grass,racks,straw,stoneLength,contourLength,terraces:plots.bands.length,raisedBoundaries:[...boundaries.values()].filter(Boolean).length,flatBoundaries:[...boundaries.values()].filter(v=>!v).length,maxPlotArea:Math.max(...plots.map(p=>p.area)),stoneBandVertices:walls.length*18};
}
export function paddyNearRice(data, plots) {
  const out = { x: [], y: [], z: [], s: [], rot: [], tint: [] }, plotKinds = [];
  for (let i = 0; i < data.x.length; i++) {
    const state = paddyAt(plots, data.x[i], data.z[i]);
    if (!state || state.bund || state.cut) continue;
    plotKinds.push(state.plot.kind);
    for (const key of Object.keys(out)) out[key].push(key === 's' ? data.s[i] * state.plot.height : key === 'tint' ? clamp(data.tint[i] + state.plot.tint - 1, 0, 1) : data[key][i]);
  }
  return { ...out, plotKinds };
}

// 連続した位置関数なので1mの畦の継ぎ目でも高さが揃う。
export const paddyBundLift = (x, z) => PADDY.bundHeightJitter * Math.sin(x * PADDY.bundSpaceX + z * PADDY.bundSpaceZ);
export function paddyBundSection(t, x, z) {
  return Math.sin(Math.PI * t) * (PADDY.bundHeight + paddyBundLift(x, z));
}
