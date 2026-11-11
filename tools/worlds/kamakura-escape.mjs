// Original authored east / design-north / height in metres. Shared by both scenes.
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const ESCAPE=freeze({
  // Optional emitted camera and solar disc, now supported by the scene decoder.
  emit:{vista:true,disc:true,horizon:true},
  camera:{east:-112,north:410,height:55,bearing:156,pitch:21.4,fov:50},
  spawn:[-113.2202,412.7406],sun:{turn_deg:-68,lift_deg:0},disc:1.5,air:{haze:4,mist:7},
  fires:[[24,152,14,1],[-20,122,10,.75],[58,96,8,.5],[-52,82,6,.35]],
  lights:{rate:.7},flight:{road:'pass',groups:18,size:[2,4],speed:.9},
  fields:{density:.28}, // multiplier: wild flowers along the verges, thinned so that white lilies do not read as noise at dusk
  // East / design north / radius / thickness / strength: thin mist pooled in hollows off the road (never on the meadow or the path:
  // there it read as a white lake). wispLift = metres from the ground at the centre to the underside.
  wisps:[[-40,318,30,3,.35],[-68,322,28,3,.3],[-100,297,30,3,.35],[0,215,40,2.5,.3]],wispLift:1,
  pass:[[-40,227,8.2],[-46,255,12.5],[-44,285,16.5],[-36,306,15.5],[-38,326,19],[-48,340,22.5],[-56,347,24],[-66,355,25.5],[-80,364,28.8],[-92,370,31.5],[-100,379,34],[-106,383,35.4],[-113,387,37],[-119,391,38.5],[-139,399,42.3],[-155,409,45.5],[-156,422,48],[-143,430,50.5],[-127,434,53.5],[-112,441,56.3],[-111,451,58.2],[-126,459,61.4]],
  lookout:[[-156,422,48],[-146,414,49.4],[-130,413,50],[-112,410,50]],
  branch:[[-106,383,35.4],[-112,368,32.5],[-114,353,29.5],[-110,342,27],[-98,330,25],[-99,314,26.5],[-100,297,27]],
  kenchoji:[[-44,285,16.5],[-64,280,20],[-64,294,22.5],[-82,299,23.6],[-100,299,27],[-110,300,29],[-126,310,33],[-129,294,36.5],[-135,248,40.8],[-163,248,42],[-163,262,42]],
  // Metres: shelf width, shoulder rounding, transition extent, half-metre terrain detail.
  width:3,branchWidth:2,shelfPad:.65,shoulder:6,earthSlope:.62,influence:38,patchRange:8,patchCore:4,patchFade:6,
  // Metres / slope: flat meadow, valley floor and rounded rock summit.
  meadow:[-89,385,27.5],meadowRadius:10.8,meadowOffset:[5,5],meadowBlend:8,meadowSlope:.035,
  valley:[[-92,388,28],[-84,376,27],[-74,366,26.3],[-66,355,25.5]],valleyWidth:4,valleySlope:.66,
  summit:[-112,410,50],summitRadius:5.6,summitTurf:7.4,summitSlope:1.55,summitBlend:3,summitRockRadius:18,
  // Metres: cut walls measured from the shelf edge; wall runs round off at both ends.
  cut:[[-48,340,22.5],[-56,347,24],[-66,355,25.5]],cutWidth:3.5,cutDetail:18,cutSlopeMax:85,wallNE:12.5,wallSW:9,wallSlope:3.73,
  // Metres: overlapping flat-topped masses [along-cut centre, length, height, depth].
  wallBlocks:{ne:[[3.5,8,11.4,4.5],[9,8,13.8,5],[14.5,8,12.4,4.5],[19,7,11.6,4]],sw:[[2.5,7,7.6,3.5],[6,7,8.8,3.5],[10.5,8,7.4,3.5]]},
  // Degrees / metres: approved rock cuts, maximum grading band and safety margin.
  wallShelf:.35,
  gradeWidth:12,gradePasses:96,
  // Degrees / metres / screen fractions: clear town fan, canopy envelope and framing.
  townFan:[132,182],treeMin:4,treeMargin:1,treeEndpoint:6,treeSafety:.1,nearTree:14,frameRight:.14,nearRight:1.02,skyBand:[.55,.95,.12],
  townGrid:{west:-100,east:100,south:50,north:210,step:20},seaTargets:[[-60,-40,0],[0,-40,0],[60,-40,0],[120,-40,0]],
  // Radians / degrees: the meadow trunk stays fixed while its crown leans away from the road sightlines.
  meadowTreeLean:.425,meadowTreeYaw:185,crownBase:.55,crownSamples:32,roofClearance:1.2,
  // Existing cliff palette modulation: brighter broad faces and dark vertical seams.
  cliffLight:1.14,cliffDark:.72,cliffWave:3,
  homes:[[-32,280],[-30,294],[-29,308],[-52,321]],homeHeight:18,homeRadius:8,homeBlend:7,
  huts:[[-81,390,27.5],[-108,330,25]],hutRadius:5,hutClear:6,meadowHutScale:.55,
  trees:[[-89.05,402.98,13,2],[-86,384,12,4.5]], // x,north,height,crown radius: frame tree and meadow broadleaf
  hamletTrees:[[-21,300],[-20,317],[-53,317],[-55,297]],hamletTreeHeight:9,hamletCrown:2.5,
  // Degrees / metres: near clear fan and the clearance around tested sightlines.
  rayClearance:2,crownClearance:1,rayStep:.5,rayStart:9,hutLifts:[2,6],fireLift:6,
  // Degrees / metres / counts: dense broadleaf slope, protected path verge and camera foot.
  // Seen beside the picture, equal round crowns of one green read as rows of broccoli, and crowns over the verges hid the road.
  // Heights / crown as a share of height / rates: most trees are middling broadleaves; some stand tall, some stay small; cedars and
  // a few pines and evergreens break the outline; tint = extra brightness difference from tree to tree. pathGap = bare verge (m).
  forest:{bearing:[165,215],distance:[14,140],height:[7.5,12],crownRatio:[.24,.34],tall:[13,17],tallRate:.18,small:[5,7],smallRate:.2,
    cedar:.1,cedarHeight:[11,18],cedarCrown:.15,pine:.05,evergreen:.15,tint:.16,attempts:16000,pathGap:5.5},
  // Road samples the overlook must see: pass points from..to, every step metres, lift metres above the road (a walker's chest);
  // min = share of them with no crown in the way. colour / edge = pale dry earth of the retreat roads at dusk, and its overlap (m).
  roadView:{from:7,to:12,step:2,lift:1.3,min:.85},pathPaint:{colour:[226,208,172],edge:.4},verge:9, // verge = metres of grass on each side of a retreat road
  // Counts / metres: woodland on the camera-facing sides of the temple, above the lower white walls.
  templeGrove:{count:14,attempts:2500,height:[9,14],crown:2.5,gap:3,spread:24},
  // Degrees: distant silhouettes drawn by the scene renderer (emit.horizon).
  horizon:[{bearing_deg:112,width_deg:30,height_deg:2.4,kind:'range'},{bearing_deg:140,width_deg:22,height_deg:1.5,kind:'range'},{bearing_deg:171,width_deg:8,height_deg:.9,kind:'headland'},{bearing_deg:190,width_deg:2.2,height_deg:.5,kind:'island'},{bearing_deg:197,width_deg:1.2,height_deg:.35,kind:'island'},{bearing_deg:212,width_deg:26,height_deg:2,kind:'range'}],
  // Fractions / counts / metres: first-hit canopy survey and house facade samples.
  survey:{left:.55,right:1,top:.34,bottom:1,columns:48,rows:48,step:.5,far:700,forestMin:.35,facadeLift:.5,padding:.003,hutMax:.06,hutInset:.96},
  foreground:{trees:12,rocks:20,bearing:[201,215],distance:[14,45],height:[1.5,3],crown:.6,size:[.5,1.6],attempts:3000}, // degrees/metres/counts: low near-right slope dressing
  // Metres: rock masses drawn over both cut walls. inner = distance of their road-side edge from the cut axis (close enough to
  // cover the saw-toothed foot of the height-field wall); along = range along the axis; depth = reach away from the road.
  crags:{inner:1.45,ne:{along:[-2,24],depth:9.55},sw:{along:[-2.5,16],depth:7.05},cell:1.9,step:1.1,lift:.45},
  // Counts / metres: fallen stones round the ends of the two walls (none on the walls: the rock masses stand there). start/reach =
  // run of each heap beyond a wall end; base/spread = its distance from the road-side edge; push = step outwards until clear of the road.
  talus:{count:9,size:[.6,2.2],width:2.2,start:.6,reach:3.6,base:1,spread:3.4,push:.5,pushMax:6,clear:.3},fenceHeight:1.1,
  fences:[
    [[-90.8,371.6],[-98.8,380.6],[-104.9,384.6],[-111.9,388.6]],
    [[-64.5,357.2],[-78.9,365.6]],
    [[-103,376],[-103,388],[-96,393]],
    [[-96,393],[-82,393],[-78,385],[-80,378]],
    [[-22,296],[-22,307],[-23,323]],
    [[-53,290],[-54,301],[-53,319]],
    [[-33,291],[-25,291],[-22,296]],
    [[-123,323],[-123,337],[-120,339]],
  ],
});
export function sceneMetadata(scene,plan,northOffset,emit=ESCAPE.emit) {
  if(!['return','escape'].includes(scene))throw Error('Unknown scene: '+scene);
  if(scene==='return')return {};
  const c=ESCAPE;
  return {world:'kamakura-escape',time:'dusk',sun:{...c.sun,...(emit.disc?{disc_deg:c.disc}:{})},air:{...c.air},buddha:'hall',
    ...(emit.vista?{overlook:{...c.camera,north:c.camera.north-northOffset}}:{}),
    ...(emit.horizon?{horizon:c.horizon}:{}),
    fires:c.fires.map(([x,y,radius_m,strength])=>({x,y:y-northOffset,radius_m,strength})),lights:c.lights,flight:c.flight,fields:{...c.fields},
    wisps:c.wisps.map(([x,y,radius_m,height_m,strength])=>({x,y:y-northOffset,radius_m,height_m,lift_m:c.wispLift,strength})),
    town_fill:{...plan.townFill,houseRate:plan.townFill.houseRate+plan.townFill.burntRate+plan.townFill.repairRate,burntRate:0,repairRate:0}};
}
