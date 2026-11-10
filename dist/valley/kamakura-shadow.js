import { FLIGHT_SHADOW } from './kamakura-flight-shadow.js';
// W2c-12 light7: fixed ~2cm PCFSoft edge -> contact-hardening 1.6–14cm filter.
// Three r180 PCFSoft ignores radius; this owned chunk uses radius=2 as its enable bit.
// Camera span/depth are the existing Kamakura sun's 92m / (260-1)m.
export function softShadowEnabled(search = '', quality = 'standard', policy = {}, span = 92) {
  return new URLSearchParams(search).get('light7') !== '0' && quality !== 'light' &&
    span <= FLIGHT_SHADOW.softLimit && (policy.scale ?? 1) > .7 && policy.shadows !== false;
}
// Parent tuning (real Chrome): the first values (cap .15 m radius) blurred the leaf-gap dapple away; the sun's angular size gives ~9 cm at a 10 m caster, so cap at .07 m.
export function shadowRadiusMeters(gap) { return Math.min(.07, .008 + Math.max(0, gap)*.0065); }
const disk = Array.from({length:16}, (_,i) => {
  const angle = i*2.399963229728653, radius = Math.sqrt((i+.5)/16);
  return [Math.cos(angle)*radius, Math.sin(angle)*radius].map(v=>v.toFixed(6));
});
const vec = pair => `vec2(${pair.join(',')})`;
// Eight blocker reads + sixteen filter reads = 24, versus the bundled PCFSoft's 16.
const blockerReads = disk.filter((_,i)=>i%2===0).map(p=>`{
  vec2 kzOffset=${vec(p)}*(.15/92.);
  float kzReceiver=shadowCoord.z+dot(kzSlope,kzOffset);
  float kzDepth=unpackRGBAToDepth(texture2D(shadowMap,shadowCoord.xy+kzOffset));
  if(kzDepth<kzReceiver){kzGap+=kzReceiver-kzDepth;kzBlockers+=1.;}
}`).join('\n');
const filterReads = disk.map(p=>`{
  vec2 kzOffset=${vec(p)}*kzWidth;
  kzVisibility+=texture2DCompare(shadowMap,shadowCoord.xy+kzOffset,shadowCoord.z+dot(kzSlope,kzOffset));
}`).join('\n');
const marker = '// W2c-12 contact-hardening begin';
export function contactShadowChunk(chunk) {
  if (chunk.includes(marker)) return chunk;
  const branch = '#elif defined( SHADOWMAP_TYPE_PCF_SOFT )';
  const end = '#elif defined( SHADOWMAP_TYPE_VSM )';
  const start = chunk.indexOf(branch), finish = chunk.indexOf(end,start);
  if(start<0 || finish<0 || !chunk.includes('shadowCoord.z += shadowBias;')) throw Error('Three PCFSoft shadow boundary missing');
  // Derivatives before the frustum branch. Receiver-plane correction keeps sloping
  // ground from shadowing itself when the footprint widens; no extra normal bias.
  const prefix = `
  ${marker}
  vec3 kzDx=dFdx(shadowCoord.xyz), kzDy=dFdy(shadowCoord.xyz);
  float kzDet=kzDx.x*kzDy.y-kzDx.y*kzDy.x;
  vec2 kzSlope=vec2(0.);
  if(abs(kzDet)>1.e-10) kzSlope=vec2(kzDy.y*kzDx.z-kzDx.y*kzDy.z,kzDx.x*kzDy.z-kzDy.x*kzDx.z)/kzDet;
`;
  const body = `
  if(shadowRadius>1.5){
    float kzGap=0., kzBlockers=0.;
    ${blockerReads}
    float kzDistance=kzGap/max(1.,kzBlockers)*259.;
    float kzWidth=min(.07,.008+kzDistance*.0065)/92.;
    float kzVisibility=0.;
    ${filterReads}
    shadow=kzVisibility/16.;
  } else {
`;
  const replaced = chunk.slice(0,start+branch.length)+body+chunk.slice(start+branch.length,finish)+'}\n\t\t'+chunk.slice(finish);
  return replaced.replace('shadowCoord.z += shadowBias;', 'shadowCoord.z += shadowBias;'+prefix);
}
