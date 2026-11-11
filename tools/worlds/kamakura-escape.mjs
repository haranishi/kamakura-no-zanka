// Original authored east / design-north / height in metres. Shared by both scenes.
const freeze=v=>{if(v&&typeof v==='object'){Object.values(v).forEach(freeze);Object.freeze(v);}return v;};
export const ESCAPE=freeze({
  // Optional emitted camera and solar disc, now supported by the scene decoder.
  emit:{vista:true,disc:true},
  camera:{east:-112,north:410,height:55,bearing:156,pitch:21.4,fov:50},
  spawn:[-112,410],sun:{turn_deg:-68,lift_deg:0},disc:1.5,air:{haze:9,mist:7},
  fires:[[24,152,12,1],[24,92,11,.9],[-20,133,10,.8],[-36,79,10,.7],[-70,100,8,.5]],
  lights:{rate:.7},flight:{road:'pass',groups:7,size:[2,4],speed:.9},
  pass:[[-40,227,8.2],[-46,255,12.5],[-44,285,16.5],[-36,306,15.5],[-38,326,19],[-48,340,22.5],[-56,347,24],[-66,355,25.5],[-80,364,28.8],[-92,370,31.5],[-100,379,34],[-106,383,35.4],[-113,387,37],[-119,391,38.5],[-139,399,42.3],[-155,409,45.5],[-156,422,48],[-143,430,50.5],[-127,434,53.5],[-112,441,56.3],[-111,451,58.2],[-126,459,61.4]],
  lookout:[[-156,422,48],[-146,414,49.4],[-130,413,50],[-112,410,50]],
  branch:[[-106,383,35.4],[-112,368,32.5],[-114,353,29.5],[-110,342,27],[-98,330,25],[-99,314,26.5],[-100,297,27]],
  kenchoji:[[-44,285,16.5],[-64,280,20],[-64,294,22.5],[-82,299,23.6],[-100,299,27],[-110,300,29],[-126,310,33],[-129,294,36.5],[-135,248,40.8],[-163,248,42],[-163,262,42]],
  // Metres: shelf width, shoulder rounding, transition extent, half-metre terrain detail.
  width:3,branchWidth:2,shelfPad:.65,shoulder:6,earthSlope:.62,influence:38,patchRange:8,patchCore:4,patchFade:6,
  // Metres / slope: flat meadow, valley floor and rounded rock summit.
  meadow:[-89,385,27.5],meadowRadius:10.8,meadowOffset:[5,5],meadowBlend:8,meadowSlope:.035,
  valley:[[-92,388,28],[-84,376,27],[-74,366,26.3],[-66,355,25.5]],valleyWidth:4,valleySlope:.66,
  summit:[-112,410,50],summitRadius:3.5,summitSlope:1.55,summitBlend:3,summitRockRadius:18,
  // Metres: cut walls measured from the shelf edge; wall runs round off at both ends.
  cut:[[-48,340,22.5],[-56,347,24],[-66,355,25.5]],cutWidth:3.5,wallNE:12.5,wallSW:9,wallSlope:3.73,
  // Metres: overlapping flat-topped masses [along-cut centre, length, height, depth].
  wallBlocks:{ne:[[3.5,8,11.4,4.5],[9,8,13.8,5],[14.5,8,12.4,4.5],[19,7,11.6,4]],sw:[[2.5,7,7.6,3.5],[6,7,8.8,3.5],[10.5,8,7.4,3.5]]},
  // Degrees / metres: approved rock cuts, maximum grading band and safety margin.
  wallShelf:.35,gradeWidth:12,gradePasses:96,
  // Degrees / metres / screen fractions: clear town fan, canopy envelope and framing.
  townFan:[132,182],treeMin:4,treeMargin:1,treeEndpoint:6,nearTree:42,frameRight:.14,nearRight:1.02,skyBand:[.55,.95,.12],
  townGrid:{west:-100,east:100,south:50,north:210,step:20},seaTargets:[[-60,-40,0],[0,-40,0],[60,-40,0],[120,-40,0]],
  // Radians / degrees: the meadow trunk stays fixed while its crown leans away from the road sightlines.
  meadowTreeLean:.425,meadowTreeYaw:185,crownBase:.55,crownSamples:32,roofClearance:1.2,
  // Existing cliff palette modulation: brighter broad faces and dark vertical seams.
  cliffLight:1.14,cliffDark:.72,cliffWave:3,
  homes:[[-30,300],[-28,314],[-44,312],[-47,297]],homeHeight:16.5,homeRadius:5,homeBlend:7,
  huts:[[-93,381,27.5],[-108,330,25]],hutRadius:5,
  trees:[[-96.2,407.2,13,2],[-86,384,12,4.5]], // x,north,height,crown radius: frame tree and meadow broadleaf
  hamletTrees:[[-21,300],[-20,317],[-53,317],[-55,297]],hamletTreeHeight:9,hamletCrown:2.5,
  // Degrees / metres: near clear fan and the clearance around tested sightlines.
  fan:[120,200],fanRange:80,rayClearance:2,crownClearance:1,rayStep:.5,fireLift:6,
  rocks:{count:72,size:[.6,2.4],width:.6,topSize:[.6,1.2],topRate:1/3,toeOffset:4.3,topOffset:6.5},fenceHeight:1.1,
  fences:[
    [[-90.8,371.6],[-98.8,380.6],[-104.9,384.6],[-111.9,388.6]],
    [[-64.9,356.6],[-78.9,365.6]],
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
    fires:c.fires.map(([x,y,radius_m,strength])=>({x,y:y-northOffset,radius_m,strength})),lights:c.lights,flight:c.flight,
    town_fill:{...plan.townFill,houseRate:plan.townFill.houseRate+plan.townFill.burntRate+plan.townFill.repairRate,burntRate:0,repairRate:0}};
}
