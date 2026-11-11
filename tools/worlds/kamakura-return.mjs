// Original authored plan, metres east/north/up. No surveyed geography or kit dimensions.
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const PLAN = freeze({
  id: 'kamakura-return', seed: 1935,
  emit: { steps: true, sea: true }, // compatibility switches; enable after the runtime accepts these fields
  atmosphere: { mist:{gain:.9,floor_m:30}, backdrop:{gain:1.4}, swellFrom:185, surfScale:.4 },
  grid: { west: -800, east: 800, south: -420, north: 1400, cell: 2, minHeight: -16, maxHeight: 340, inset: 40, walk: [-520,520,-40,1080] },
  shore: { crest:34, amplitude: 34, centre: -72.5, halfWidth: 187.5, beach: 62, beachTop: 2.4, wet: 4, bermRun:6, bermHeight:.6, step: .8, stepRun: 8, seaDepth: 12, seaRun: 400, dropDepth: 1.1, dropRun: 4 }, // dropDepth/dropRun: metres the bed falls just off the waterline, and the distance over which it does
  town: { west: -175, east:165, south: 70, north: 520, base: 3.2, grade: .021, ripple: .15, rippleWave: 70, edgeRun: 310, edgeCurve: 8, edgeWave: 170 },
  // metres: three wooded noses, two western settlement mouths; all curves remain continuous.
  edge: { westRidges:[[192,42,54],[355,42,51]], westMouths:[[270,44,66],[457,44,60]], eastRidges:[[335,45,51]], northNoses:[[-112,65,42],[112,70,38]], mouthHouses:10, mouthAttempts:2000, ridgeHeight:15 },
  buddha: { clear:45, cliffHeight:10, cliffAngle:60, cliffBlend:4, cliffInset:5 }, // metres/degrees: open southeast sector and pale south/west escarpments
  sanctuary: { axisWidth:22, square:[-17,17,614,640], treeTarget:132, attempts:18000, height:[18,26], crown:2.6, axisGap:16, buildingGap:6, lowHeight:5, lowCrown:1.6 }, // metres/count: grass court, shrine grove and low retaining-wall trees
  burns: { plots:[[128,152,220,248],[130,154,252,280],[132,156,284,312]] }, // metres: grouped river-side ash plots; grass class prevents runtime houses
  shrine: { lower: [-60, 60, 540, 640, 13.5], upper: [-45, 45, 660, 730], stair: [0, 648], stairSouth: 640, stairNorth: 660, approach: [520, 540], edgeRun: 16, rearSlope: 40, },
  terraces: [
    { id: 'buddha', rect: [-275, -195, 105, 190, 12], blend: 16 },
    { id: 'kenchoji', rect: [-230, -165, 610, 670, 40], blend: 16 },
    { id: 'jochiji', rect: [-300, -240, 440, 495, 30], blend: 16 },
    { id: 'toshoji', rect: [245, 335, 400, 470, 9], blend: 16 },
  ],
  cape: { east: -250, south: -65, north: 120, x:-295, y:0, radius:35, min: 35, range: 8, cliff: 20, join:[100,240], neck:20, shoulder:35 },
  eastCape: { x:330, y:-50, radius:55, height:20, cliff:40 },
  stairs: { width:10, rise:.18, totalRise:7.5, ear:.5, earLift:.25, embed:1.5, inset:.22, entryInset:.26, colour:[128,124,116], variation:.06, triangles:1200, tones:5, landing:1, nativeInset:.05, footInset:.06 }, // landing: metres of level slab at the top (to the first cell of the upper terrace); footInset: metres the ground lies under the first tread
  // metres / degrees: foothill run, peak envelopes, 250–400m relief and smoothed earthworks.
  hill: { northPeak: 300, westPeak: 180, eastPeak: 165, relief: 20, wave: 330, ridgeWave: 270, ridgeWeight: .27, ridgeTilt: .35, peakNorth: 1130, peakEast:-60, frontNorth:835, frontPeak:175, frontRun:105, frontVariation:.12, frontWidth:120, frontBlend:100, sideLimitX:[550,750], sideLimitY:[850,1100], cornerPeak:245, cornerRelief:15, cornerSouth:850, cornerNorth:1130, cornerX:[550,750], cornerY:[1000,1200], valleyFade:[800,950], valleyMouthFade:[130,180], valleyCut:3, northRun: 430, shrineFoot: 720, shrineWidth: 130, coastRun: 200, edgeHeight: 62, edgeRun: 120, coastEdgeRun: 120, edgeEase: 1, rockSlope: 43, frontSlope: 40, rearSlope: 40, smoothRun: 16, terraceShoulder:30, terraceSlope:29, valleyRearGrade:.18 },
  // Authored valley axes point from town-facing mouths through each platform into the hillside.
  grading: { slope:39.2, iterations:8, epsilon:.0001, triangleSlope:43.5, trianglePasses:12, finishPasses:12, finishSlope:42 }, // degrees / offline sweep budget / metres: remove unintended steep joins
  sideRidges: { west:[[-415,180,225],[-700,225,215]], east:[[440,160,215],[700,215,205]], valleyDepth:32, south:50, full:300 }, // [east, peak height, half-width] and northward coastal taper
  valleys: [
    { id:'buddha', centre:[-235,150], toward:[.94,-.34], halfWidth:31.5, sideRun:140, grade:.07 },
    { id:'kenchoji', centre:[-198,640], toward:[.45,-.89], halfWidth:35, sideRun:140, grade:.07 },
    { id:'jochiji', centre:[-270,470], toward:[.72,-.69], halfWidth:31.5, sideRun:140, grade:.074 },
    { id:'toshoji', centre:[290,435], toward:[-.5,-.8660254], halfWidth:31.5, sideRun:210, grade:.02 },
  ],
  river: { id: 'namerigawa', points: [[300,1400],[270,1150],[235,950],[205,760],[212,600],[205,430],[200,300],[212,200],[232,110],[250,40],[262,-30]],
    step: 4, fineStep: .5, widthUpper: 8, widthMiddle: 11, widthLower: 14, widthMouth: 22, bankMin: 30, bankMax: 45, bankRun: 25, bedDepth: 1.6, waterDepth: .9, gravel: 1.5, valleyWidth: 45, valleyNorth: 600, valleySideRun: 160, headBed: 305, mouthBed: -1.3, mouthGrade: .03, mouthBlendNorth: 180,
    bridgeBank: 2.5, bridgeBedGrade: .35, bridgeWallRun: 5, bridgeApron: 6, bridgeWidthPad: 2, bridgeExtra: 8, flatFade:30, barGap:[30,80], barWidth:[.15,.3], barLength:14, barLift:.08, riffleGap:[40,90], riffleRise:[.3,.6], riffleRamp:32, riffleDrop:4, mouthSandRun:20 },
  harbor: { x: 146, y: -14, radius: 34, width: 8, height: 1.8, mouth: 95, opening: 30, innerDepth: -2.5, slope: 5, quay: [116,142,16,26,1.6], island: [110,-42,5], islandRadius: 10, connection:[116,142,26,68,1.6] },
  roads: [
    { id:'avenue', name:'若宮大路', kind:'local_road', width:18, points:[[0,62],[0,520]] },
    { id:'east-upper', name:'上の橋への道', kind:'local_road', width:5, points:[[0,430],[150,430],[205,432],[250,435]] },
    { id:'east-lower', name:'下の橋への道', kind:'local_road', width:5, points:[[0,110],[150,95],[205,88],[255,85],[300,80]] },
    { id:'harbor', name:'港への道', kind:'local_road', width:5, points:[[150,95],[143,45],[129,26]] },
    { id:'west', name:'大仏への道', kind:'local_road', width:5, points:[[0,150],[-150,140],[-235,100],[-235,120]] },
    { id:'beach', name:'浜の道', kind:'local_road', width:4, points:[[-250,68],[150,68]] },
    { id:'pass', name:'北西の切通', kind:'kaido', width:4, points:[[-80,520],[-130,700],[-170,900],[-200,1100]] },
    { id:'kenchoji-trail', name:'建長寺への坂', kind:'trail', width:3, points:[[-100,450],[-140,520],[-170,570],[-198,615],[-198,630]] },
    { id:'jochiji-trail', name:'浄智寺への坂', kind:'trail', width:3, points:[[-110,240],[-180,320],[-240,400],[-270,446],[-270,460]] },
  ],
  road: { earthworkRun:10, step: 4, shoulder: 45, pavedShoulder: 5, valleySlope: 6, passCut: 10, passWidth: 7, passWallRun: .5, passTaper: 20, passSouth: 820, passNorth: 930, northeastOffset: 30 },
  facilities: [
    ['tsurugaoka','torii','鳥居',0,548], ['tsurugaoka','hall','舞殿',0,590], ['tsurugaoka','stairs','石段',0,648],
    ['tsurugaoka','romon','楼門',0,668], ['tsurugaoka','hall','拝殿',0,692], ['tsurugaoka','hall','本殿',0,712],
    ['great_buddha','buddha','大仏',-235,150], ['daibutsuden','hall','大仏殿',-235,150], ['daibutsuden','gate','中門',-235,100],
    ['kenchoji','hall','仏殿',-198,648], ['kenchoji','romon','三門',-198,615],
    ['jochiji','hall','仏殿',-270,478], ['jochiji','gate','山門',-270,446], ['toshoji','gate','山門',250,435], ['toshoji','hall','焼けた堂',292,435],
  ],
  houses: { beach: 18, port: 10, avenue: 12, estates: [[-34,505],[34,505]], beachFirst: -156, beachPitch: 24, beachY: 87, showcaseWest:-250, showcasePitch:24, showcaseSouth:84, showcaseRows:3, showcaseRun:1000, portFirst: 108, portPitch: 14, portY: 40, avenueX: 27, avenueFirst: 77, avenuePitch: 19, gap: 2, estateInset: 4, estatePad: 8 },
  // Names/types only; all fallback dimensions are invented in designed-kits.mjs.
  kinds: [ ['0_家_町屋','machiya'],['1_家_屋敷の母屋','yashiki'],['2_家_小家','koya'],['3_家_蔵','kura'],['4_家_番屋・舟小屋','banya'],
    ['5_家_屋敷の塀（直線）','fence'],['6_家_屋敷の門','gate'],['k05_家_町屋B','machiya_b'],['k06_家_町屋C','machiya_c'],['k07_家_町屋D','machiya_d'],
    ['k08_家_小家B','koya_b'],['k09_家_小家C','koya_c'],['k10_家_小家D','koya_d'],['k11_家_屋敷B','yashiki_b'],['k12_家_蔵B','kura_b'],['k13_家_番屋B','banya_b'],['k14_家_長屋門','nagayamon'] ],
  // metres / fractions: sequential random inhibition; no lattice or forest stands.
  veg: { pitch: 6, attempts: 1100000, farRadius:900, farPitch:6.8, farCrown:1.3, forestCentre:[0,300], steepWeight: .5, spacing: .7, densityVariation: .35, densityWave: 55, speciesWave: 20, evergreen: .50, cedar: .07, pine: .13, deciduous: .30, cedarTile:48, cedarRadius:13, heightVariation:.25, heightMin: 12, heightMax: 22, crownMin: 2.5, crownMax: 3.4, templeHeight: 25, templePitch: 12, bankGap:[30,90], bankCluster:[3,7], bankSpread:16, bankOffset: 6, gardenEvery: 3, townTreesMin:290, townTreesMax:420, gardenAttempts:80000, gardenHeight: 7, gardenHeightRange:5, gardenCrown:2.5, coastPitch: 26, coastNorth: 90, pathGap: 2, boxGap: 2, tint: .6, range:2000, far:50000 },
  // metres/fractions: wavy 30–70m ecotone; short-strip farms, small roadside homes and 5–9m tree clusters.
  belt: { width:28, variation:12, waves:[72,110], grass:.5, farms:.3, woods:.2, forestGap:16, farmWidth:10, farmDepth:20, group:[3,8], groupPitch:76, cluster:[4,12], treeHeight:[5,9], treeCrown:2, clusterRadius:44, clusterSpread:18, houseTarget:18, houseSearch:2500, treeAttempts:12000, cliffSlope:38, townFade:22 },
  townFill: { frontageMin:10,frontageMax:14,depth:18,laneFirst:22,laneEvery:38,crossEvery:68,reach:175,start:10,shoreGap:20,coastSmall:90,houseRate:.82,gardenRate:.09,burntRate:.05,repairRate:.04,outerStart:120 },
  targets: { addedHouses:[110,420], townTrees:[280,420], beachWidth:[45,62], bankFlat:30, platformSlope:40, plainEdge:30, plainEdgeSlope:8, beltWidth:[16,40], farms:30 }, // accepted ranges. addedHouses: the aim is 240 or more, but the game's town fill reaches about 120 on this narrow plain today
  // (of 480 candidate plots most are refused: no model fits, a road or an older house is near). The floor follows what it reaches. metres, degrees and counts
  overlook: { back:532,height:150,pitch:19.9,fov:50 },
  ground: { variation:.06, blendCells:1, laneWidth:3.6, burntGain:.7, riverBlend:.35, wave:40, stripeWidth:1.2, repairMix:.25, burntCover:.7, ash:[92,86,78], charcoal:[58,54,50], cliff:[176,166,140], footWidth:1.5, seaSandDepth:1.5, seaMidDepth:4, seaDeepDepth:8, vergeInset:.6, vergeWidth:3, // fraction / cells / metres: sRGB authored colour, smooth variation and boundary mixing
    soil:[172,146,106], lane:[198,170,128], avenue:[204,178,138], crop:[112,124,70], chips:[224,208,172], sand:[224,208,172], wet:[182,166,134], seaMid:[96,104,92], grass:[118,128,72], forest:[66,64,44], rock:[128,120,96], gravel:[146,140,126], riverbed:[70,78,60] },
  works: { rootCount:26, rootSize:[1.2,2.8], rootWidth:7, rootLine:[[116,25],[119,18],[125,14]], ringWidth:14, ringCount:220, ringSize:[1.8,4.4], islandCount:34, islandSize:[1.2,5], westCount:70, westSize:[1.5,6], westLine:[[-324,0],[-315,-28],[-291,-38],[-270,-24]], westWidth:6, eastCount:40, eastSize:[1.2,4.5], eastLine:[[286,-72],[314,-98],[341,-102],[370,-88]], eastWidth:5, pier:[[128,16],[128,-8]], pierWidth:2.6, deck:1.8, moorings:[[137,-6,0,'boat'],[151,-12,90,'boat'],[133,-25,20,'boat'],[156,-29,100,'sail']] },
  preview: { perspectiveWidth:1280, perspectiveHeight:720, meshStride:3, scale:1, contour:5, light:[-.857,-.354,.375], shadeAmbient:.36, shadeGain:.64, verticalScale:1.7, treeOpacity:.65, sectionWidth:1200, sectionHeight:1740 },
  places: [ ['tsurugaoka','鶴岡八幡宮',0,700],['wakamiya_oji','若宮大路',0,300],['yuigahama','由比ヶ浜',0,30],['great_buddha','長谷の大仏',-235,150],['daibutsuden','大仏殿跡',-235,150],['wakaejima','和賀江島',146,-14],['namerigawa','滑川',200,300],['kenchoji','建長寺',-198,640],['jochiji','浄智寺',-270,470],['toshoji','東勝寺跡',292,435] ],
  spawn: [0,90],
});
export default PLAN;
