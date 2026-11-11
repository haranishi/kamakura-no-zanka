import { routeDefinitions, routeTerrain, routeNear } from './designed-route.mjs';
import { PLAN as P } from '../worlds/kamakura-return.mjs';
export const clamp=(v,a=0,b=1)=>Math.max(a,Math.min(b,v));
export const mix=(a,b,t)=>a+(b-a)*t;
export const smooth=(a,b,v)=>{const t=clamp((v-a)/(b-a));return t*t*(3-2*t);};
export function hash(x,y,salt=0) {let n=Math.imul(x|0,0x9e3779b1)^Math.imul(y|0,0x85ebca77)^salt^P.seed;n=Math.imul(n^n>>>16,0x7feb352d);n=Math.imul(n^n>>>15,0x846ca68b);return ((n^n>>>16)>>>0)/4294967296;}
export function noise(x,y) {const a=Math.floor(x),b=Math.floor(y),u=smooth(0,1,x-a),v=smooth(0,1,y-b);return mix(mix(hash(a,b),hash(a+1,b),u),mix(hash(a,b+1),hash(a+1,b+1),u),v)*2-1;}
export const northOffset=(P.grid.north+P.grid.south)/2;
export const gameNorth=y=>y-northOffset;
export const gameZ=y=>northOffset-y;
export const shoreAt=x=>P.shore.crest-P.shore.amplitude*clamp((x-P.shore.centre)/P.shore.halfWidth,-1,1)**2;
export function seaBedAt(offshore) {const a=P.shore.seaProfile;let i=1;while(i<a.length-1&&a[i][0]<offshore)i++;return mix(a[i-1][1],a[i][1],clamp((offshore-a[i-1][0])/(a[i][0]-a[i-1][0])));}
export const plainAt=(x,y)=>P.town.base+(y-P.town.south)*P.town.grade+P.town.ripple*Math.sin(x/P.town.rippleWave)*Math.sin((y-P.town.south)/P.town.rippleWave);
export const rectangleDistance=(x,y,r)=>Math.hypot(Math.max(r[0]-x,0,x-r[1]),Math.max(r[2]-y,0,y-r[3]));
export const inRect=(x,y,r)=>x>=r[0]&&x<=r[1]&&y>=r[2]&&y<=r[3];
const nose=(v,centre,width)=>Math.abs(v-centre)<width/2?(1+Math.cos((v-centre)*Math.PI*2/width))/2:0;
export const townWestAt=y=>mix(P.town.westSouth,P.town.west,smooth(P.town.south,P.town.westShoulder,y))+P.town.edgeCurve*Math.sin((y-P.town.south)/P.town.edgeWave)+P.edge.westRidges.reduce((a,[v,w,d])=>a+d*nose(y,v,w),0)-P.edge.westMouths.reduce((a,[v,w,d])=>a+d*nose(y,v,w),0);
export const townEastAt=y=>{const a=P.town.eastNodes;let i=1;while(i<a.length-1&&a[i][0]<y)i++;return mix(a[i-1][1],a[i][1],clamp((y-a[i-1][0])/(a[i][0]-a[i-1][0])))-P.town.edgeCurve*Math.sin((y-P.town.south)/P.town.edgeWave);};
// Signed distance to an authored ellipse; the northern shore has no artificial wall.
export function harborAt(x,y) {
  const h=P.harbor,rx=h.radius-h.width/2,ry=h.radiusY-h.width/2,a=Math.atan2((x-h.x)/rx,(y-h.y)/ry);
  const px=h.x+rx*Math.sin(a),py=h.y+ry*Math.cos(a),inside=((x-h.x)/rx)**2+((y-h.y)/ry)**2<1;
  const distance=Math.hypot(x-px,y-py)*(inside?-1:1),bearing=(a*180/Math.PI+360)%360;
  return {distance,inside,bearing,ring:(!h.northOpen||y<h.y)&&Math.abs((bearing-h.mouth+540)%360-180)>=h.opening/2};
}
export const quayAt=(x,y)=>{const h=P.harbor,q=h.quay,w=h.quayWobble*Math.sin((x-q[0])/h.quayWave);return x>=q[0]&&x<=q[1]&&y>=q[2]&&y<=q[3]+w;};
export const outcropAt=(x,y,margin=0)=>P.outcrops.find(c=>Math.abs(x-c.x)<=c.width/2+margin&&Math.abs(y-c.y)<=c.height/Math.tan(c.angle*Math.PI/180)/2+margin);
export const eastBankAt=y=>{const c=P.river;return mix(c.valleyWidth,c.eastBank[2],smooth(c.eastBank[0]-c.flatFade,c.eastBank[0],y)*(1-smooth(c.eastBank[1],c.eastBank[1]+c.flatFade,y)));};
export const townNorthAt=x=>P.town.north+P.town.edgeCurve*(1+Math.sin(x/P.town.edgeWave))/2-P.edge.northNoses.reduce((a,[v,w,d])=>a+d*nose(x,v,w),0);
// Relief lowers the shoulders between authored peak envelopes, rather than adding a flat summit.
export function ridgeAt(x,y) {
  const c=P.hill,a=(x-c.peakEast+(c.ridgeTilt*(y-c.peakNorth)))*Math.PI*2/c.wave,b=(y-c.peakNorth)*Math.PI*2/c.ridgeWave;
  const broad=(Math.cos(a)+Math.cos(b))/2,pointed=1-Math.abs(Math.sin((a+b)/2));
  return (1-c.ridgeWeight)*(broad+1)/2+c.ridgeWeight*pointed;
}
const riseEnvelope=(distance,slope,run)=>Math.tan(slope*Math.PI/180)*(distance-run*(1-Math.exp(-distance/run)));
// Rounded, slope-limited fill/cut envelopes reach the surrounding hills well beyond the local shoulder.
function terraceEarthwork(h,x,y,rect,blend,rearSlope=P.hill.rearSlope) {
  const dx=Math.max(rect[0]-x,0,x-rect[1]),front=Math.max(rect[2]-y,0),rear=Math.max(y-rect[3],0);
  const rearScale=Math.tan(rearSlope*Math.PI/180)/Math.tan(P.hill.frontSlope*Math.PI/180);
  const d=Math.hypot(dx,front,rear*rearScale),envelope=riseEnvelope(d,P.hill.terraceSlope,blend)+(Math.tan(P.hill.frontSlope*Math.PI/180)-Math.tan(P.hill.terraceSlope*Math.PI/180))*Math.max(0,d-P.hill.terraceShoulder);
  return clamp(h,rect[4]-envelope,rect[4]+envelope);
}
export function riverX(y) {
  const a=P.river.points;let i=0;while(i<a.length-2&&a[i+1][1]>y)i++;
  const p=a[i],q=a[i+1],prev=a[Math.max(0,i-1)],next=a[Math.min(a.length-1,i+2)],dy=q[1]-p[1],t=clamp((y-p[1])/dy);
  const m0=(q[0]-prev[0])/(q[1]-prev[1]),m1=(next[0]-p[0])/(next[1]-p[1]);
  return (2*t**3-3*t*t+1)*p[0]+(t**3-2*t*t+t)*dy*m0+(-2*t**3+3*t*t)*q[0]+(t**3-t*t)*dy*m1;
}
export function riverWidth(y) {const c=P.river,[a,b,d,e]=c.widthBreaks;return y>e?c.widthUpper:y>d?c.widthMiddle:y>b?mix(c.widthLower,c.widthMiddle,(y-b)/(d-b)):y>a?c.widthLower:mix(c.widthMouth,c.widthLower,smooth(c.points.at(-1)[1],a,y));}

function riverFloorAt(y) {
  const c=P.river,base=plainAt(riverX(c.valleyNorth),c.valleyNorth);
  return y<=c.valleyNorth?plainAt(riverX(y),y):mix(base,c.headBed+c.bedDepth,smooth(c.valleyNorth,P.grid.north,y));
}
export function createDesignedTerrain(stairRise, gateBounds=null,emit=P.emit) {
  const gate=P.facilities.find(p=>p[0]==='daibutsuden'&&p[1]==='gate'),pad=gateBounds?[gate[3]+gateBounds.bbox_min[0]-P.grid.cell,gate[3]+gateBounds.bbox_max[0]+P.grid.cell,gate[4]-gateBounds.bbox_max[2]-P.grid.cell,gate[4]-gateBounds.bbox_min[2]+P.grid.cell,P.terraces[0].rect[4]]:null;
  const upper=P.shrine.lower[4]+stairRise;
  function frontLimit(h,x,y){
    // A short gentle shoulder behind the sanctuary, then the steeper forested mountain.
    // The bound is continuous and never creates a flat summit.
    if(y>P.shrine.upper[3]) {
      const d=Math.hypot(Math.max(0,Math.abs(x)-P.shrine.upper[1]),y-P.shrine.upper[3]);
      const limit=upper+riseEnvelope(d,P.hill.rearSlope,P.shrine.edgeRun);
      h=Math.min(h,limit);
    }
    return h;
  }

  function base(x,y) {
    const d=y-shoreAt(x), c=P.shore;
    let h=d<0?seaBedAt(-d):d<c.beach?d<c.bermRun?c.bermHeight*d/c.bermRun:c.bermHeight+(c.beachTop-c.bermHeight)*(d-c.bermRun)/(c.beach-c.bermRun):d<c.beach+c.stepRun?mix(c.beachTop,plainAt(x,shoreAt(x)+c.beach+c.stepRun),smooth(c.beach,c.beach+c.stepRun,d)):plainAt(x,y);
    // Wet sand only in the strip around the waterline. Seen in real Chrome: with the whole seabed as wet sand and a 3% shelf,
    // forty metres of water under a metre deep stayed transparent, and the dark wet bed read as a brown band along the beach.
    let code=d<-c.wet?0:d<c.wet?1:d<c.beach?0:4;
    const rx=riverX(y),townEast=Math.min(townEastAt(y),rx+P.river.valleyWidth);
    if(d>=c.beach) {
      const hc=P.hill,west=townWestAt(y),north=townNorthAt(x);
      const shrineStart=north;
      const dw=Math.max(0,west-x),de=Math.max(0,x-townEast),dn=Math.max(0,y-shrineStart);
      const relief=hc.relief*(1-ridgeAt(x,y));
      const northAmount=smooth(0,hc.northRun,dn),sideAmount=smooth(0,P.town.edgeRun,Math.max(dw,de));
      const side=P.sideRidges, ridges=x<0?side.west:side.east;
      let sideHeight=0;
      for(const [cx,peak,spread] of ridges)sideHeight=Math.max(sideHeight,(peak-relief*.45)*Math.exp(-(((x-cx)/spread)**2)));
      sideHeight=Math.max(sideHeight,P.hill.edgeHeight);
      sideHeight*=smooth(side.south,side.full,y);
      h=Math.max(h,mix(plainAt(x,clamp(y,P.town.south,P.town.north)),sideHeight,sideAmount));
      if(dn>0){
        // The main ridge begins behind the middle ridge; a town-relative rise
        // swallowed both shoulder saddles when this smaller layout was introduced.
        h=Math.max(h,mix(plainAt(x,P.town.north),hc.northPeak-relief,smooth(hc.middleNorth-hc.frontRun,hc.peakNorth,y)));
      }
      if(y>P.shrine.upper[3]){
        const shoulder=(1-smooth(hc.shoulderX[0],hc.shoulderX[1],Math.abs(x)))*hc.frontPeak+smooth(hc.shoulderX[0],hc.shoulderX[1],Math.abs(x))*hc.shoulderHeight;
        const front=shoulder*Math.exp(-(((y-hc.frontNorth)/hc.frontRun)**2));
        const middle=hc.middlePeak*Math.exp(-(((y-hc.middleNorth)/hc.middleRun)**2))*(1-.04*(1-ridgeAt(x,y)));
        h=Math.max(h,front,middle);
      }
      // The southern hillside also comes out of the beach over a full foothill run.
      const coastHeight=d<c.beach+c.stepRun?mix(c.beachTop,plainAt(x,shoreAt(x)+c.beach+c.stepRun),smooth(c.beach,c.beach+c.stepRun,d)):plainAt(x,y);
      h=mix(coastHeight,h,smooth(c.beach,c.beach+hc.coastRun,d));
      if(Math.max(dw,de,dn)>P.grid.cell)code=3;
      for(const v of P.valleys) {
        const rect=P.terraces.find(t=>t.id===v.id).rect,dx=x-v.centre[0],dy=y-v.centre[1],along=-(dx*v.toward[0]+dy*v.toward[1]);
        const across=Math.abs(dx*v.toward[1]-dy*v.toward[0]),side=Math.max(0,across-v.halfWidth);
        const floor=rect[4]+along*(along>0?P.hill.valleyRearGrade:v.grade);
        const valley=floor+riseEnvelope(side,P.hill.frontSlope,v.sideRun/6);
        const fade=Math.max(smooth(...P.hill.valleyFade,y),smooth(v.sideRun,v.sideRun*2,along),smooth(v.sideRun,v.sideRun*2,-along));
        h=mix(Math.min(h,Math.max(plainAt(x,clamp(y,P.town.south,P.town.north))-(v.id==='toshoji'?P.hill.valleyCut:0),valley)),h,fade);
      }
      // A broad, gently graded river valley precedes the bank and river-bed carve.
      const floor=y>P.river.valleyNorth?riverFloorAt(y):plainAt(x,y);
      const outside=Math.max(0,Math.abs(x-rx)-(x>rx?eastBankAt(y):P.river.valleyWidth));
      h=Math.min(h,floor+riseEnvelope(outside,P.hill.frontSlope,P.river.valleySideRun/6));

    }
    for(const cape of [P.cape,P.eastCape]) {const r=Math.hypot(x-cape.x,y-cape.y),w=1-smooth(0,cape.radius,r);if(w>0){h=mix(h,cape.height??(P.cape.min+P.cape.range*(noise(x/60,y/60)*.5+.5)),w);code=5;}}
    if(y>=P.cape.y-P.cape.radius&&y<=P.cape.join[1]){
      const weight=smooth(P.cape.y-P.cape.radius,P.cape.y+P.cape.cliff,y)*(1-smooth(P.cape.neck,P.cape.shoulder,Math.abs(x-P.cape.x))),target=P.cape.min*(1-smooth(...P.cape.join,y));
      if(weight>0){h=mix(h,Math.max(h,target),weight);if(weight>.2)code=5;}
    }
    for(const t of P.terraces) {h=terraceEarthwork(h,x,y,t.rect,t.blend);if(inRect(x,y,t.rect))code=4;}
    if(pad){h=terraceEarthwork(h,x,y,pad,P.terraces[0].blend);if(inRect(x,y,pad))code=6;}
    const l=P.shrine.lower,u=P.shrine.upper;
    // Separate platforms, with a continuous stair apron; rear slope remains at most thirty degrees.
    const stair=clamp((y-P.shrine.stairSouth)/(P.shrine.stairNorth-P.shrine.stairSouth));
    const site=[mix(l[0],u[0],stair),mix(l[1],u[1],stair),l[2],u[3],mix(l[4],upper,stair)];
    h=terraceEarthwork(h,x,y,site,P.shrine.edgeRun,P.shrine.rearSlope);
    if(inRect(x,y,site))code=6;
    if(Math.abs(x)<=l[1]&&y>=P.shrine.approach[0]&&y<l[2]) {h=mix(plainAt(x,P.shrine.approach[0]),l[4],smooth(P.shrine.approach[0],l[2],y));code=6;}
    const hc=P.harbor,harbor=harborAt(x,y);
    if(harbor.inside||Math.abs(x-hc.x)<hc.radius-hc.width&&y>=hc.y&&y<hc.quay[2]){h=hc.innerDepth;code=1;}
    if(harbor.ring){const w=1-smooth(hc.width/2,hc.width/2+hc.slope,Math.abs(harbor.distance));h=mix(h,hc.height,w);if(w>.2)code=5;}
    if(quayAt(x,y)){h=hc.quay[4];code=0;}
    else if(inRect(x,y,hc.connection)){h=hc.connection[4];code=0;}
    const island=Math.hypot(x-hc.island[0],y-hc.island[1]),iw=1-smooth(0,hc.islandRadius,island);
    if(iw>0) {h=Math.max(h,mix(hc.innerDepth,hc.island[2],iw));code=5;}
    // No frame embankment: the authored hills continue to the land edge; all southern edges are sea.
    const edge=Math.min(x-P.grid.west,P.grid.east-x,P.grid.north-y);
    const rocky=x<P.hill.rockyCoast[0]||x>P.hill.rockyCoast[1];
    const land=smooth(shoreAt(x),shoreAt(x)+(rocky?P.hill.coastEdgeRun:P.hill.coastRun),y);
    const ew=1-smooth(0,P.hill.edgeRun,edge);
    if(ew>0&&land>0){h=Math.max(h,P.hill.edgeHeight*land*ew);if(rocky)code=5;}
    if(y<P.grid.south+P.grid.cell){h=-P.shore.seaDepth;code=1;}

    h=frontLimit(h,x,y);
    const corner=P.hill.cornerPeak-P.hill.cornerRelief*(1-ridgeAt(x,y)),cornerWeight=smooth(...P.hill.cornerX,Math.abs(x))*smooth(...P.hill.cornerY,y);
    h=Math.min(h,mix(P.grid.maxHeight,corner,cornerWeight));
    return {h,code};
  }
  // Fixed arc-length resampling of a C1 curve, including both endpoints.
  const fine=[],a=P.river.points[0][1],b=P.river.points.at(-1)[1];let length=0;
  for(let y=a;y>=b;y-=P.river.fineStep) {const x=riverX(y),prev=fine.at(-1);if(prev)length+=Math.hypot(x-prev.x,y-prev.y);fine.push({x,y,s:length});}
  const river=[];let cursor=1;
  for(let s=0;s<length;s+=P.river.step) {while(cursor<fine.length-1&&fine[cursor].s<s)cursor++;const p=fine[cursor-1],q=fine[cursor],t=(s-p.s)/(q.s-p.s);river.push({x:mix(p.x,q.x,t),y:mix(p.y,q.y,t),s});}
  river.push({...fine.at(-1)});
  const roads=P.roads.filter(p=>!routeDefinitions.some(r=>r.id===p.id)).map(p=>({...p,points:p.points.map(([x,y])=>[x,y,base(x,y).h])}));
  const avenue=roads.find(r=>r.id==='avenue');avenue.points=[];
  for(let y=P.roads[0].points[0][1];y<P.roads[0].points[1][1];y+=P.road.step)avenue.points.push([0,y,base(0,y).h]);
  avenue.points.push([0,P.roads[0].points[1][1],base(0,P.roads[0].points[1][1]).h]);
  const bankRoad=[];
  for(let y=P.roads.find(r=>r.id==='east-upper').points.at(-1)[1]+P.road.step;y<=P.grid.north;y+=P.road.step)bankRoad.push([riverX(y)+P.road.northeastOffset,y,base(riverX(y)+P.road.northeastOffset,y).h]);
  const bankStart=P.roads.find(r=>r.id==='east-upper').points.at(-1);bankRoad.unshift([...bankStart,base(...bankStart).h]);roads.push({id:'river-road',name:'滑川沿いの道',kind:'kaido',width:3,points:bankRoad});
  for(const road of roads) {
    if(['jochiji-trail'].includes(road.id)) {
      const dense=[];
      for(let i=1;i<road.points.length;i++) {
        const a=road.points[i-1],b=road.points[i],count=Math.ceil(Math.hypot(b[0]-a[0],b[1]-a[1])/P.road.step);
        for(let j=0;j<count;j++){const t=j/count,x=mix(a[0],b[0],t),y=mix(a[1],b[1],t);dense.push([x,y,base(x,y).h]);}
      }
      const end=road.points.at(-1);dense.push([end[0],end[1],base(end[0],end[1]).h]);road.points=dense;
    }
    if(road.id==='east-upper') {
      const start=road.points[0][2],end=P.terraces.find(t=>t.id==='toshoji').rect[4],lengths=[0];
      for(let i=1;i<road.points.length;i++)lengths.push(lengths.at(-1)+Math.hypot(road.points[i][0]-road.points[i-1][0],road.points[i][1]-road.points[i-1][1]));
      const approach=road.points[1],level=plainAt(approach[0],approach[1]);
      road.points.forEach(p=>{p[2]=p[0]<=approach[0]?plainAt(p[0],p[1]):mix(level,end,clamp((p[0]-approach[0])/(road.points.at(-1)[0]-approach[0])));});
    }
    if(road.id==='east-lower')road.points.forEach(p=>{p[2]=p[0]<=riverX(p[1])+P.river.valleyWidth?plainAt(p[0],p[1]):base(p[0],p[1]).h;});
  }

  const crossings=[];
  for(const id of ['east-upper','east-lower']) {
    const road=roads.find(p=>p.id===id);let hit;
    for(let i=1;i<road.points.length&&!hit;i++) {const a=road.points[i-1],b=road.points[i],dx=b[0]-a[0],dy=b[1]-a[1];
      if(a[0]-riverX(a[1])<=0&&b[0]-riverX(b[1])>=-1e-8) {
        let lo=0,hi=1;for(let n=0;n<40;n++){const t=(lo+hi)/2;if(mix(a[0],b[0],t)<riverX(mix(a[1],b[1],t)))lo=t;else hi=t;}
        const t=(lo+hi)/2,y=mix(a[1],b[1],t);hit={x:riverX(y),y,bearing:Math.atan2(dx,dy)*180/Math.PI,width:road.width,road:id,level:mix(a[2],b[2],t)};
      }
    }
    if(!hit)throw Error('Road does not cross river');crossings.push(hit);
  }
  let last=Infinity;
  for(const p of river) {
    const c=P.river;
    let bank=plainAt(p.x,p.y);
    if(p.y>c.valleyNorth)bank=riverFloorAt(p.y);
    let bed=bank-c.bedDepth;
    for(const q of crossings)bed=Math.min(bed,q.level-c.bridgeBank+Math.max(0,p.y-q.y)*c.bridgeBedGrade);
    if(p.y<c.mouthBlendNorth)bed=Math.min(bed,c.mouthBed+Math.max(0,p.y-P.river.points.at(-1)[1])*c.mouthGrade);
    p.bed=Math.min(last,bed);last=p.bed;p.water=p.bed+c.waterDepth;p.width=riverWidth(p.y);
  }
  const riffles=[],bars=[];
  for(let i=0,arc=P.river.riffleRamp;arc<length;arc+=(P.river.riffleGap[0]+hash(i++,0,130)*(P.river.riffleGap[1]-P.river.riffleGap[0]))/((river.find(p=>p.s>=arc)?.y??0)<=P.river.rapidNorth?P.river.rapidDensity:1)) {
    const p=river.find(p=>p.s>=arc);if(!p||p.y<=P.town.south||crossings.some(q=>Math.abs(q.y-p.y)<q.width/2+P.grid.cell))continue;
    riffles.push({s:arc,x:p.x,y:p.y,rise:mix(...P.river.riffleRise,hash(i,0,131))});
  }
  const riffleAt=s=>{let lift=0;for(const r of riffles){const d=s-r.s;if(d>=-P.river.riffleRamp&&d<=P.river.riffleDrop)lift=Math.max(lift,r.rise*(d<0?1+d/P.river.riffleRamp:1-d/P.river.riffleDrop));}return lift;};
  last=Infinity;
  for(const p of river){const depth=mix(...P.river.lowerDepth,1-smooth(P.river.rapidSouth,P.river.rapidNorth,p.y));p.bed=Math.min(last,p.bed+riffleAt(p.s),p.y<=P.river.rapidNorth?p.water-depth:Infinity);last=p.bed;}
  for(let i=0,arc=P.river.barGap[1];arc<length-P.river.barLength;arc+=(P.river.barGap[0]+hash(i++,0,132)*(P.river.barGap[1]-P.river.barGap[0]))/((river.find(p=>p.s>=arc)?.y??0)<=P.river.rapidNorth?P.river.rapidDensity:1)) {
    const index=river.findIndex(p=>p.s>=arc),p=river[index];if(!p||p.y<P.town.south||crossings.some(q=>Math.abs(q.y-p.y)<q.width/2+P.grid.cell))continue;
    const a=river[Math.max(0,index-2)],b=river[Math.min(river.length-1,index+2)],curve=(b.x-p.x)*(p.y-a.y)-(b.y-p.y)*(p.x-a.x),side=curve<=0?1:-1,width=p.width*mix(...P.river.barWidth,hash(i,0,133));
    bars.push({x:p.x+side*(p.width/2-width/2),y:p.y,width,length:P.river.barLength,side,water:p.water});
  }
  function riverNear(x,y) {
    let lo=0,hi=river.length-1;while(lo<hi){const mid=(lo+hi)>>>1;if(river[mid].y>y)lo=mid+1;else hi=mid;}
    let best=null,dist=Infinity;const span=Math.abs(x-riverX(y))<P.river.bankMax*2?Math.ceil((P.river.bankMax+P.river.widthMouth)/P.river.step):4;
    for(let i=Math.max(1,lo-span);i<=Math.min(river.length-1,lo+span);i++){const a=river[i-1],b=river[i],dx=b.x-a.x,dy=b.y-a.y,t=clamp(((x-a.x)*dx+(y-a.y)*dy)/(dx*dx+dy*dy)),d=Math.hypot(x-a.x-t*dx,y-a.y-t*dy);if(d<dist){dist=d;best={distance:d,bed:mix(a.bed,b.bed,t),water:mix(a.water,b.water,t),width:mix(a.width,b.width,t),s:mix(a.s,b.s,t),x:mix(a.x,b.x,t),y:mix(a.y,b.y,t)};}}
    return best;
  }
  // Small segment index bounds offline terrain carving without a world-size per-cell route scan.
  const roadBins=new Map(),bin=32;
  for(const road of roads)for(let i=1;i<road.points.length;i++){const a=road.points[i-1],b=road.points[i],r=road.width/2+P.grid.maxHeight/Math.tan(P.hill.frontSlope*Math.PI/180)+P.hill.smoothRun,seg={a,b,road,levelA:a[2],levelB:b[2]};for(let c=Math.floor((Math.min(a[0],b[0])-r)/bin);c<=Math.floor((Math.max(a[0],b[0])+r)/bin);c++)for(let j=Math.floor((Math.min(a[1],b[1])-r)/bin);j<=Math.floor((Math.max(a[1],b[1])+r)/bin);j++){const k=c+','+j;if(!roadBins.has(k))roadBins.set(k,[]);roadBins.get(k).push(seg);}}
  function roadNear(x,y) {let best=null,dist=Infinity;for(const {a,b,road} of roadBins.get(Math.floor(x/bin)+','+Math.floor(y/bin))||[]){const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy)),d=Math.hypot(x-a[0]-dx*t,y-a[1]-dy*t);if(d<dist){dist=d;best={distance:d,h:mix(a[2],b[2],t),road};}}const r=routeNear(x,y);return !best||r.distance<best.distance?r:best;}
  function sample(x,y) {
    let {h,code}=base(x,y);const ungraded=h;let lo=-Infinity,hi=Infinity,roadDistance=Infinity,nearest=null;
    const valleyDistance=Math.abs(x-riverX(y)),angle=mix(P.road.valleySlope,P.hill.frontSlope,smooth(P.river.valleyWidth,P.river.valleyWidth+P.road.shoulder,valleyDistance));
    for(const {a,b,road,levelA,levelB} of roadBins.get(Math.floor(x/bin)+','+Math.floor(y/bin))||[]) {
      const dx=b[0]-a[0],dy=b[1]-a[1],t=clamp(((x-a[0])*dx+(y-a[1])*dy)/(dx*dx+dy*dy));
      const distance=Math.hypot(x-a[0]-t*dx,y-a[1]-t*dy),d=Math.max(0,distance-road.width/2);
      const envelope=riseEnvelope(d,mix(angle,P.hill.frontSlope,smooth(P.road.shoulder,P.road.shoulder*2,d)),P.road.earthworkRun);
      const target=mix(levelA,levelB,t);
      lo=Math.max(lo,target-envelope);hi=Math.min(hi,target+envelope);
      if(distance<roadDistance){roadDistance=distance;nearest=road;}
    }
    // All nearby segments contribute continuous bounds, avoiding walls on nearest-road Voronoi borders.
    if(lo<=hi)h=clamp(h,lo,hi);
    else h=(lo+hi)/2;
    h=mix(ungraded,h,smooth(shoreAt(x)+P.shore.beach-P.road.shoulder,shoreAt(x)+P.shore.beach+P.road.shoulder,y));
    if(nearest&&roadDistance<nearest.width/2+P.road.pavedShoulder/4&&y-shoreAt(x)>=P.shore.beach)code=4;
    for(const terrace of P.terraces){h=terraceEarthwork(h,x,y,terrace.rect,terrace.blend);if(inRect(x,y,terrace.rect))code=4;}
    if(pad){h=terraceEarthwork(h,x,y,pad,P.terraces[0].blend);if(inRect(x,y,pad))code=6;}
    const l=P.shrine.lower,u=P.shrine.upper,t=clamp((y-P.shrine.stairSouth)/(P.shrine.stairNorth-P.shrine.stairSouth));
    h=terraceEarthwork(h,x,y,[mix(l[0],u[0],t),mix(l[1],u[1],t),l[2],u[3],mix(l[4],upper,t)],P.shrine.edgeRun,P.shrine.rearSlope);
    if(y>=P.town.south-P.river.flatFade&&y<=P.river.valleyNorth+P.river.flatFade){
      const rx=riverX(y),d=Math.max(0,Math.abs(x-rx)-(x>rx?eastBankAt(y):P.river.valleyWidth)),envelope=riseEnvelope(d,P.hill.frontSlope,P.river.valleySideRun/6),floor=plainAt(x,y);
      const weight=smooth(P.town.south-P.river.flatFade,P.town.south,y)*(1-smooth(P.river.valleyNorth,P.river.valleyNorth+P.river.flatFade,y));h=mix(h,clamp(h,floor-envelope,floor+envelope),weight);if(x>rx&&d===0)code=2;
      // The small lower temple platform lies outside the flat floodplain.
      for(const terrace of P.terraces)if(terrace.id==='toshoji')h=terraceEarthwork(h,x,y,terrace.rect,terrace.blend);
    }
    // Restore the authored northward grade; the forest earthworks remain outside its curved edge.
    const westEdge=townWestAt(y),eastEdge=townEastAt(y),plainSouth=shoreAt(x)+P.shore.beach+P.shore.stepRun;
    if(y>=Math.max(P.town.south,plainSouth)&&y<=townNorthAt(x)&&x>=westEdge&&x<=eastEdge){
      h=plainAt(x,y);
      if(x>=westEdge+P.grid.cell&&x<=eastEdge-P.grid.cell&&code!==6)code=4;
    }
    if(inRect(x,y,l))h=mix(plainAt(x,l[2]),l[4],smooth(l[2],P.shrine.forecourtLevel,y));
    const q=riverNear(x,y),c=P.river;
    if(q&&q.distance<q.width/2+c.bankMax) {
      const bank=clamp((h-q.bed)*c.bankRun,c.bankMin,x<q.x?c.bankMin:eastBankAt(y)),edge=q.width/2,weight=smooth(edge,edge+bank,q.distance);
      const bed=mix(q.bed,q.water-c.waterDepth,smooth(edge-c.gravel,edge+c.gravel,q.distance));h=mix(bed,h,weight);code=q.distance<edge?7:q.distance<edge+c.gravel?6:2;
      if(y>c.valleyNorth&&hash(Math.floor(x/7),Math.floor(y/7),1)>.65)code=5;
    }
    // A road shoulder must not steepen the narrow natural east floodplain.
    if(y>=P.town.south-c.flatFade&&y<=c.valleyNorth+c.flatFade&&x>q.x&&q.distance<q.width/2+eastBankAt(y)&&!P.terraces.some(t=>inRect(x,y,t.rect))){
      const weight=smooth(P.town.south-c.flatFade,P.town.south,y)*(1-smooth(c.valleyNorth,c.valleyNorth+c.flatFade,y));h=mix(h,mix(q.bed,y>c.valleyNorth?riverFloorAt(y):plainAt(x,y),smooth(q.width/2,q.width/2+eastBankAt(y),q.distance)),weight);
    }
    for(const bar of bars) {
      const d=Math.hypot((x-bar.x)/(bar.width/2),(y-bar.y)/(bar.length/2));
      if(d<1){h=mix(h,bar.water+P.river.barLift,1-smooth(0,1,d));code=6;}
    }
    for(const hit of crossings) {
      const angle=hit.bearing*Math.PI/180,dx=x-hit.x,dy=y-hit.y,u=dx*Math.sin(angle)+dy*Math.cos(angle),v=dx*Math.cos(angle)-dy*Math.sin(angle),half=riverWidth(hit.y)/2;
      if(Math.abs(v)<(hit.width+c.bridgeWidthPad)/2+c.bridgeApron&&Math.abs(u)<half+c.bridgeExtra/2+c.bridgeApron+P.grid.cell){
        const top=smooth(half,half+c.bridgeWallRun,Math.abs(u)),weight=(1-smooth((hit.width+c.bridgeWidthPad)/2,(hit.width+c.bridgeWidthPad)/2+c.bridgeApron,Math.abs(v)))*(1-smooth(half+c.bridgeExtra/2,half+c.bridgeExtra/2+c.bridgeApron,Math.abs(u)));h=mix(h,mix(Math.min(hit.level-c.bridgeBank,q.bed),hit.level,top),weight);code=6;
      }
    }
    if(emit.steps) {
      // Built stairs: the ground is hollowed only under the treads, below the line of their inner corners. The terraces at both
      // ends keep their height. Seen in real Chrome: with the hollow carried one cell past each end, a notch 0.6 m deep
      // lay across the foot of the stairs and a ridge stood behind the landing.
      if(Math.abs(x)<=P.stairs.width/2+P.stairs.ear&&y>=P.shrine.stairSouth&&y<=P.shrine.stairNorth) {
        const riser=stairRise/Math.ceil(stairRise/P.stairs.rise),t=(y-P.shrine.stairSouth)/(P.shrine.stairNorth-P.shrine.stairSouth);
        h=P.shrine.lower[4]+stairRise*t-riser-P.stairs.nativeInset;
        // The first row of cells lies behind the first riser: it stays under the first tread, which is level with the terrace.
        if(y<P.shrine.stairSouth+P.grid.cell)h=Math.min(h,P.shrine.lower[4]-P.stairs.footInset);
        code=6;
      }
    } else if(Math.abs(x)<=P.stairs.width/2+P.stairs.ear&&y>=P.shrine.stairSouth-P.grid.cell&&y<=P.shrine.stairNorth) {
      const t=clamp((y-P.shrine.stairSouth)/(P.shrine.stairNorth-P.shrine.stairSouth));
      h=P.shrine.lower[4]+stairRise*t-(y<P.shrine.stairSouth?P.stairs.entryInset:P.stairs.inset);code=6;
    }
    if(y<shoreAt(x)&&(x<P.hill.rockyCoast[0]||x>P.hill.rockyCoast[1])){h=seaBedAt(shoreAt(x)-y);code=0;}
    if(y<P.grid.south+P.grid.cell){h=-P.shore.seaDepth;code=1;}
    h=frontLimit(h,x,y);
    const corner=P.hill.cornerPeak-P.hill.cornerRelief*(1-ridgeAt(x,y)),cornerWeight=smooth(...P.hill.cornerX,Math.abs(x))*smooth(...P.hill.cornerY,y);
    h=Math.min(h,mix(P.grid.maxHeight,corner,cornerWeight));
    const avenue=P.roads[0],verge=Math.abs(Math.abs(x)-(avenue.width/2-P.ground.vergeInset))<=P.ground.vergeWidth/2;
    if(verge&&y>=avenue.points[0][1]&&y<=avenue.points[1][1]&&(!nearest||nearest.id==='avenue'||roadDistance>nearest.width/2+P.road.pavedShoulder/4))code=2;
    if(y<plainSouth+P.grid.cell*3&&code===4)code=y-shoreAt(x)<P.shore.wet?1:0;
    // Shrine grass, narrow axial gravel and rock retaining faces share the existing platform geometry.
    if(quayAt(x,y))code=0;
    if(inRect(x,y,l))code=Math.abs(x)<=P.sanctuary.axisWidth/2||inRect(x,y,P.sanctuary.square)?6:2;
    if(y>=P.shrine.stairSouth&&y<=P.shrine.stairNorth&&Math.abs(x)>P.stairs.width/2+P.stairs.ear&&Math.abs(x)<=l[1]+P.shrine.edgeRun)code=2;
    if(inRect(x,y,u)&&Math.abs(x)>P.sanctuary.axisWidth/2)code=2;
    // Pale exposed south/west faces of the Buddha platform. No earthwork is applied to the entrance path.
    const b=P.terraces[0].rect,bc=P.buddha,run=bc.cliffHeight/Math.tan(bc.cliffAngle*Math.PI/180);
    const south=x>b[0]+bc.cliffInset&&x<b[1]-bc.cliffInset&&y<b[2]&&y>b[2]-run-bc.cliffBlend;
    const west=y>b[2]+bc.cliffInset&&y<b[3]-bc.cliffInset&&x<b[0]&&x>b[0]-run-bc.cliffBlend;
    const entrance=nearest?.id==='west'&&roadDistance<P.road.pavedShoulder+nearest.width/2;
    if((south||west)&&!entrance)code=5;
    const harbor=P.harbor,hp=harborAt(x,y);
    if(hp.inside||Math.abs(x-harbor.x)<harbor.radius-harbor.width&&y>=harbor.y&&y<harbor.quay[2]){h=harbor.innerDepth;code=1;}
    if(hp.ring){const w=1-smooth(harbor.width/2,harbor.width/2+harbor.slope,Math.abs(hp.distance));h=mix(h,harbor.height,w);if(w>.2)code=5;}
    if(quayAt(x,y)){h=harbor.quay[4];code=0;}
    else if(inRect(x,y,harbor.connection)){h=harbor.connection[4];code=0;}
    const island=Math.hypot(x-harbor.island[0],y-harbor.island[1]),iw=1-smooth(0,harbor.islandRadius,island);
    if(iw>0){h=Math.max(h,mix(harbor.innerDepth,harbor.island[2],iw));code=5;}
    for(const terrace of P.terraces){if(terrace.id==='buddha'&&rectangleDistance(x,y,terrace.rect)<terrace.blend)h=terraceEarthwork(h,x,y,terrace.rect,terrace.blend);if(inRect(x,y,terrace.rect)){h=terrace.rect[4];code=4;}}
    const exposure=outcropAt(x,y);
    if(exposure){h+=Math.tan(exposure.angle*Math.PI/180)*(y-exposure.y);code=5;}
    const routed=routeTerrain(x,y,{h,code});
    if(emit.polish&&y>=P.shrine.stairSouth&&y<=P.shrine.stairNorth){
      const c=P.stairs,d=Math.abs(x)-c.width/2-c.ear;
      if(d>=0&&d<c.bankWidth+c.bankBlend){
        const nose=l[4]+stairRise*(y-P.shrine.stairSouth)/(P.shrine.stairNorth-P.shrine.stairSouth);
        routed.h=mix(routed.h,nose,1-smooth(c.bankWidth,c.bankWidth+c.bankBlend,d));routed.code=2;
      }
    }
    return routed;
  }
  roads.push(...routeDefinitions.map(r=>({...r,points:r.points.map(p=>[...p])})));
  function habitat(x,y,heightSample=base) {
    let valley=1-smooth(P.river.valleyWidth,P.river.valleyWidth+P.river.valleySideRun,Math.abs(x-riverX(y)));
    for(const v of P.valleys){const across=Math.abs((x-v.centre[0])*v.toward[1]-(y-v.centre[1])*v.toward[0]);valley=Math.max(valley,1-smooth(v.halfWidth,v.halfWidth+v.sideRun,across));}
    const cell=P.grid.cell,gradient=Math.hypot(heightSample(x+cell,y).h-heightSample(x-cell,y).h,heightSample(x,y+cell).h-heightSample(x,y-cell).h)/(2*cell);
    return {valley,ridge:ridgeAt(x,y),steep:clamp(gradient/Math.tan(P.hill.frontSlope*Math.PI/180))};
  }
  return {base,sample,habitat,riverNear,roadNear,river,riverX,roads,crossings,stairRise,upper,bars,riffles,riffleAt};
}
