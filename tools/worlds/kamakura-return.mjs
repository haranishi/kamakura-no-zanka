import { ESCAPE } from './kamakura-escape.mjs';
// Original authored plan, metres east/north/up. No surveyed geography or kit dimensions.
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
export const PLAN = freeze({
  id: 'kamakura-return', seed: 1935,
  emit: { polish:true, steps: true, sea: true, light: true, ...ESCAPE.emit }, // compatibility switches; enable after the runtime accepts these fields
  // sun: the concept is lit from the front left by a sun higher than the game's late afternoon, so every time's sun is turned
  // 28 degrees clockwise and lifted 13. air: the presets' haze suits a map kilometres across; here the hills 500 m behind the
  // town must already be pale (haze x11), while the low mist stays thin (x4: at x16 the whole town plain washed out).
  atmosphere: { mist:{gain:.9,floor_m:30}, backdrop:{gain:1.4}, swellFrom:185, surfScale:.1, sun:{turn_deg:28,lift_deg:13}, air:{haze:11,mist:4} },
  grid: { west: -440, east: 440, south: -170, north: 710, cell: 2, minHeight: -16, maxHeight: 200, inset: 40, walk: [-330,330,-24,600] },
  shore: { crest:10, amplitude:10, centre:-38, halfWidth:72, beach:16, beachTop:2.2, wet:3, bermRun:2, bermHeight:.4, step:.2, stepRun:2, seaDepth:12, seaRun:60, seaProfile:[[0,0],[6,-1.5],[20,-5],[60,-12]], dropDepth:1.1, dropRun:4 },
  town: { west:-112, east:143, south:26, north:227, base:2.4, grade:5.8/201, ripple:.08, rippleWave:35, edgeRun:145, edgeCurve:2, edgeWave:18, westShoulder:70, westSouth:-95, eastNodes:[[26,85],[110,91],[150,122],[190,135],[227,143]] },
  // metres: three wooded noses, two western settlement mouths; all curves remain continuous.
  edge: { westRidges:[[112,26,19],[174,28,17]], westMouths:[[88,30,23],[145,32,22]], eastRidges:[], northNoses:[[-70,28,21],[72,26,19]], mouthHouses:2, mouthAttempts:2000, ridgeHeight:15 },
  buddha: { pathWidth:4, grassWidth:3, groundBlend:2, trees:8, attempts:2000, treeHeight:[5,7], treeCrown:1.3, clear:24, cliffHeight:7, cliffAngle:55, cliffBlend:3, cliffInset:4 },
  sanctuary: { axisWidth:12, square:[-10,10,220,232], treeTarget:68, attempts:18000, height:[18,26], crown:2.6, axisGap:12, buildingGap:6, lowHeight:5, lowCrown:1.6 },
  burns: { plots:[[60,72,112,129],[76,88,133,150]] },
  shrine: { lower:[-27,27,190,232,7.8], upper:[-26,26,252,322], stair:[0,242], stairSouth:232, stairNorth:252, approach:[190,196], edgeRun:12, rearSlope:40, forecourtLevel:196 },
  outcrops: [{x:190,y:217,width:18,height:10,angle:60},{x:238,y:230,width:18,height:12,angle:60}], // metres/degrees: two pale rock faces toward town
  patch: { south:100, north:140 }, // metres: detailed avenue sample strip
  terraces: [
      { id:'buddha', rect:[-162,-118,56,98,7], blend:10 },
      { id:'kenchoji', rect:[-189,-137,259,303,42], blend:18 },
      { id:'jochiji', rect:[-112,-72,256,290,22], blend:12 },
      { id:'toshoji', rect:[128,180,84,116,4.5], blend:10 },
  ],
  cape: { east:-112, south:-20, north:55, x:-138, y:0, radius:22, min:18, range:4, cliff:16, join:[40,100], neck:14, shoulder:25 },
  eastCape: { x:170, y:-14, radius:26, height:9, cliff:20 },
  stairs: { width:10, rise:.18, totalRise:7.5, ear:.4, earLift:.25, bankWidth:4, bankBlend:9, edgeDark:.88, embed:1.5, inset:.22, entryInset:.26, colour:[192,186,174], variation:.08, triangles:1200, tones:5, landing:1, nativeInset:.05, footInset:.06 }, // landing: metres of level slab at the top (to the first cell of the upper terrace); footInset: metres the ground lies under the first tread
  // Metres / degrees: authored ridge envelopes and rounded earthworks; building sizes stay unchanged.
  hill: { northPeak:132, westPeak:84, eastPeak:76, relief:10, wave:165, ridgeWave:135, ridgeWeight:.27, ridgeTilt:.35, peakNorth:575, peakEast:-10, frontNorth:385, frontPeak:62, frontRun:48, frontVariation:.12, frontWidth:50, frontBlend:40, shoulderX:[45,90], shoulderNorth:370, shoulderHeight:40, shoulderSpread:40, middleNorth:470, middlePeak:94, middleRun:48, sideLimitX:[310,420], sideLimitY:[430,555], cornerPeak:112, cornerRelief:10, cornerSouth:430, cornerNorth:575, cornerX:[300,420], cornerY:[510,600], valleyFade:[370,470], valleyMouthFade:[65,90], valleyCut:1.5, northRun:300, shrineFoot:322, shrineWidth:65, coastRun:75, edgeHeight:60, edgeRun:60, coastEdgeRun:20, rockyCoast:[-160,200], edgeEase:1, rockSlope:43, frontSlope:40, rearSlope:40, smoothRun:10, terraceShoulder:18, terraceSlope:29, valleyRearGrade:.18 },
  // Authored valley axes point from town-facing mouths through each platform into the hillside.
  grading: { slope:39.2, iterations:8, epsilon:.0001, triangleSlope:43.5, trianglePasses:12, finishPasses:12, finishSlope:42 }, // degrees / offline sweep budget / metres: remove unintended steep joins
  relief: { heightGain:.13,tintGain:.2 }, // fraction: taller/darker valley trees, lower/brighter ridge trees; species quotas stay unchanged
  reliefCheck:{columns:96,rows:80,bottom:.26,step:2,far:1400,jump:30,min:.6}, // screen fraction / metres: fixed mountain sampling band
  housePolicy:{full_m:700,swap_m:760,cap:260},
  sideRidges: { west:[[-285,86,110],[-400,108,100]], east:[[290,76,105],[400,103,100]], valleyDepth:16, south:25, full:100 },
  valleys: [
      { id:'buddha', centre:[-140,77], toward:[.94,-.34], halfWidth:15.75, sideRun:70, grade:.07 },
      { id:'kenchoji', centre:[-163,281], toward:[.65,-.76], halfWidth:17.5, sideRun:70, grade:.07 },
      { id:'jochiji', centre:[-92,273], toward:[.72,-.69], halfWidth:15.75, sideRun:70, grade:.074 },
      { id:'toshoji', centre:[158,100], toward:[-.5,-.8660254], halfWidth:15.75, sideRun:105, grade:.02 },
  ],
  river: { id:'namerigawa', points:[[300,710],[285,600],[262,480],[240,390],[215,310],[190,250],[165,200],[146,164],[134,150],[117,119],[104,100],[105,72],[102,54],[107,34],[116,21],[124,6],[128,-12]],
      step:4, fineStep:.5, widthUpper:9, widthMiddle:14, widthLower:20, widthMouth:26, widthBreaks:[20,100,110,250], bankMin:6, bankMax:14, bankRun:4, eastBank:[60,130,40], bedDepth:1.6, waterDepth:.9, lowerDepth:[1.2,1.6], gravel:1.5, valleyWidth:14, valleyNorth:250, valleySideRun:80, headBed:105, mouthBed:-1.3, mouthGrade:.03, mouthBlendNorth:85,
      bridgeBank:2.5, bridgeBedGrade:.35, bridgeWallRun:2, bridgeApron:6, bridgeWidthPad:2, bridgeExtra:8, flatFade:15, barGap:[30,80], barWidth:[.15,.3], barLength:6, barLift:.08, riffleGap:[40,90], riffleRise:[.3,.6], riffleRamp:12, riffleDrop:4, mouthSandRun:20, rapidSouth:24, rapidNorth:100, rapidDensity:2.5 },
  harbor: { x:66, y:-3, radius:33.3, radiusY:13, width:7, height:2, mouth:90, mouthWidth:9, opening:2*Math.asin(9/(2*(13-7/2)))*180/Math.PI, innerDepth:-3, slope:2, quay:[50,88,2,8,1.4], island:[36,-8,4], islandRadius:8, connection:[50,88,8,12,1.4], northOpen:true, quayWobble:3, quayWave:6 },
  roads: [
      { id:'avenue', name:'若宮大路', kind:'local_road', width:16, points:[[0,26],[0,232]] },
      { id:'east-upper', name:'上の橋への道', kind:'local_road', width:5, points:[[0,102],[60,101],[92,100],[117,100],[140,100]] },
      { id:'east-lower', name:'下の橋への道', kind:'local_road', width:5, points:[[60,34],[92,22],[112,17],[134,16],[158,22]] },
      { id:'harbor', name:'港への道', kind:'local_road', width:5, points:[[78,28],[84,14],[90,6]] },
      { id:'west', name:'大仏への道', kind:'local_road', width:5, points:[[0,84],[-60,82],[-112,78],[-124,74]] },
      { id:'beach', name:'浜の道', kind:'local_road', width:3, points:[[-92,28],[80,28]] },
      { id:'pass', name:'北西の切通', kind:'kaido', width:ESCAPE.width, points:ESCAPE.pass },
      { id:'kenchoji-trail', name:'建長寺への坂', kind:'trail', width:3, points:ESCAPE.kenchoji },
      { id:'jochiji-trail', name:'浄智寺への坂', kind:'trail', width:3, points:[[-70,222],[-82,238],[-92,252]] },
  ],
  road: { earthworkRun:6, step:4, shoulder:22, pavedShoulder:3, valleySlope:6, northeastOffset:18 },
  facilities: [
    ['tsurugaoka','torii','鳥居',0,196], ['tsurugaoka','hall','舞殿',0,212], ['tsurugaoka','stairs','石段',0,242],
    ['tsurugaoka','romon','楼門',0,262], ['tsurugaoka','hall','拝殿',0,284], ['tsurugaoka','hall','本殿',0,306],
    ['great_buddha','buddha','大仏',-140,77], ['daibutsuden','hall','大仏殿',-140,77], ['daibutsuden','gate','中門',-140,59],
    ['kenchoji','hall','仏殿',-163,286], ['kenchoji','romon','三門',-163,266],
    ['jochiji','hall','仏殿',-92,277], ['jochiji','gate','山門',-92,259], ['toshoji','gate','山門',132,100], ['toshoji','hall','焼けた堂',158,100],
  ],
  houses: { beach:8, port:3, avenue:0, estates:[[-84,205],[96,205]], beachFirst:-94, beachPitch:14, beachY:39, beachDepth:2, showcaseWest:-110, showcasePitch:16, showcaseSouth:42, showcaseRows:2, showcaseRun:1000, portFirst:48, portPitch:16, portY:16, avenueX:22, avenueFirst:34, avenuePitch:19, gap:1.2, estateInset:4, estatePad:3 },
  // Names/types only; all fallback dimensions are invented in designed-kits.mjs.
  kinds: [ ['0_家_町屋','machiya'],['1_家_屋敷の母屋','yashiki'],['2_家_小家','koya'],['3_家_蔵','kura'],['4_家_番屋・舟小屋','banya'],
    ['5_家_屋敷の塀（直線）','fence'],['6_家_屋敷の門','gate'],['k05_家_町屋B','machiya_b'],['k06_家_町屋C','machiya_c'],['k07_家_町屋D','machiya_d'],
    ['k08_家_小家B','koya_b'],['k09_家_小家C','koya_c'],['k10_家_小家D','koya_d'],['k11_家_屋敷B','yashiki_b'],['k12_家_蔵B','kura_b'],['k13_家_番屋B','banya_b'],['k14_家_長屋門','nagayamon'] ],
  // metres / fractions: sequential random inhibition; no lattice or forest stands.
  veg: { pitch:6, attempts:360000, farRadius:450, farPitch:6.8, farCrown:1.3, forestCentre:[0,130], steepWeight:.5, spacing:.7, densityVariation:.35, densityWave:55, speciesWave:20, evergreen:.22, cedar:.07, pine:.13, deciduous:.58, cedarTile:48, cedarRadius:13, heightVariation:.25, heightMin:12, heightMax:22, crownMin:2.5, crownMax:3.4, templeHeight:25, templePitch:12, bankGap:[30,90], bankCluster:[3,7], bankSpread:12, bankOffset:6, gardenEvery:3, gardenDeciduous:.7, townTreesMin:112, townTreesMax:148, gardenAttempts:20000, gardenHeight:4, gardenHeightRange:3, gardenCrown:1.3, coastPitch:14, coastNorth:24, pathGap:2, boxGap:2, tint:.6, range:1200, far:20000 },
  // Metres / fractions: narrow wavy ecotone, grouped farms and small roadside homes.
  belt: { width:12, variation:4, waves:[36,55], grass:.5, farms:.3, woods:.2, forestGap:8, farmWidth:6, farmDepth:8, group:[3,6], groupPitch:40, cluster:[4,12], treeHeight:[5,9], treeCrown:2, clusterRadius:20, clusterSpread:8, houseTarget:6, houseSearch:2500, treeAttempts:12000, cliffSlope:38, townFade:4 },
  townFill: { yaw:9,groupYaw:8,shift:1.4,setbackMin:1,setbackMax:4.5,bend:3,bendWave:70,annexRate:.55,edgeFray:.8,yardRate:.6,roadPlots:1,infillRate:.8,frontageMin:10,frontageMax:11,depth:20,laneFirst:25,laneEvery:43.2,crossEvery:300,reach:150,start:4,shoreGap:2,coastSmall:0,houseRate:.94,gardenRate:.03,burntRate:.02,repairRate:.01,outerStart:145 },
  targets: { addedHouses:[60,200], totalHouses:100, townTrees:[90,160], trees:[12000,20000], beachWidth:[12,16], bankFlat:14, platformSlope:42, plainEdge:12, plainEdgeSlope:8, beltWidth:[8,16], farms:8 },
  // All count and composition targets come from the authored layout, never from private kits.
  overlook: { back:228,height:98,pitch:28.5,fov:50 },
  ground: { variation:.06, blendCells:1, laneWidth:3.6, burntGain:.7, riverBlend:.35, wave:40, stripeWidth:1.2, repairMix:.25, burntCover:.7, ash:[92,86,78], charcoal:[58,54,50], cliff:[176,166,140], footWidth:1.5, seaSandDepth:1.5, seaMidDepth:4, seaDeepDepth:8, vergeInset:.6, vergeWidth:1.2, // fraction / cells / metres: sRGB authored colour, smooth variation and boundary mixing
    terrace:[168,142,104], soil:[172,146,106], lane:[198,170,128], avenue:[204,178,138], crop:[112,124,70], chips:[224,208,172], sand:[224,208,172], wet:[182,166,134], seaMid:[96,104,92], grass:[118,128,72], forest:[66,64,44], rock:[128,120,96], gravel:[146,140,126], riverbed:[70,78,60] },
  works: { rootCount:14, rootSize:[1.2,2.8], rootWidth:6, rootLine:[[20,-4],[26,-6],[31,-9]], ringWidth:7, ringCount:180, ringSize:[1.6,4.2], ringStep:6, islandCount:26, islandSize:[1.2,5], westCount:55, westSize:[1.5,6], westLine:[[-154,0],[-150,-16],[-136,-22],[-116,-12]], westWidth:6, eastCount:30, eastSize:[1.2,4.5], eastLine:[[150,-20],[158,-32],[174,-36],[190,-24]], eastWidth:5, rapidCount:28, rapidSize:[.8,2.2], rapidRange:[30,100], pier:[[80,4],[80,-10]], pierWidth:2.4, deck:1.4, moorings:[[49,-1,90,'boat'],[60,-1,90,'boat'],[70,-4,90,'boat'],[88,-1,0,'sail']] },
  composition: { rayColumns:256, rayRows:144, rayStep:1, rayFar:1400, townSouth:30, townNorth:225, roofMin:.34 }, // screen samples / metres / fraction: projected town roof-box coverage
  preview: { seaAbsorption:.8, perspectiveWidth:1280, perspectiveHeight:720, meshStride:1, scale:2, contour:5, light:[-.857,.354,.375], shadeAmbient:.36, shadeGain:.64, verticalScale:1.7, treeOpacity:.65, sectionWidth:1200, sectionHeight:1740 },
  places: [ ['tsurugaoka','鶴岡八幡宮',0,284],['wakamiya_oji','若宮大路',0,130],['yuigahama','由比ヶ浜',0,18],['great_buddha','長谷の大仏',-140,77],['daibutsuden','大仏殿跡',-140,77],['wakaejima','和賀江島',66,-3],['namerigawa','滑川',104,100],['kenchoji','建長寺',-163,286],['jochiji','浄智寺',-92,277],['toshoji','東勝寺跡',158,100] ],
  spawn: [0,34],
});
export default PLAN;
