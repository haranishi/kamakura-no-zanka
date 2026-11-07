// W2c-9g: deterministic house surface rules/data; no renderer, DOM, clock or random state.
export const HOUSE_SURFACE = Object.freeze({ base: .5, roof: .35, wood: .85, near: 40, far: 120, brightness: .12, broad: .20, detail: 1.15, hue: Math.PI / 60 });
const fract = x => x - Math.floor(x);
export const houseHash = (x, z) => fract(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453);
export function houseVariation(x, z) {
  const a = houseHash(x, z), b = houseHash(x + 19, z + 7), c = houseHash(x - 11, z + 31);
  return { brightness: 1 + (a * 2 - 1) * HOUSE_SURFACE.brightness, hue: (b * 2 - 1) * HOUSE_SURFACE.hue,
    offset: [b * 17, c * 17], wall: c < HOUSE_SURFACE.wood ? 'wood' : 'plaster', age: a };
}
export function houseSurface(ny, y) { return y <= HOUSE_SURFACE.base ? 'stone' : ny >= HOUSE_SURFACE.roof ? 'roof' : 'wall'; }
export function houseAmplitude(distance) {
  const t = Math.min(1, Math.max(0, (distance - HOUSE_SURFACE.near) / (HOUSE_SURFACE.far - HOUSE_SURFACE.near)));
  return 1 - t * t * (3 - 2 * t);
}
// W2c-9g3: sRGB art targets converted once; warm stone, ochre earth and aged plaster.
const linear = hex => hex.match(/../g).map(v => { const c=parseInt(v,16)/255; return c<=.04045?c/12.92:((c+.055)/1.055)**2.4; });
export const HOUSE_PALETTE = Object.freeze(Object.fromEntries(Object.entries({
  roof:'a38752', oldRoof:'6b5f4b', wood:'6f6254', oldWood:'4c4035',
  earth:'a8906a', oldEarth:'8d7655', plaster:'b3ab94', stone:'6d675e', oldStone:'58524a', tile:'3b3a3a', post:'382b20'
}).map(([k,v])=>[k,linear(v)])));
export function housePreserveColor(base, role) {
  const max=Math.max(...base), min=Math.min(...base);
  return role===0 || max-min>max*.35 || max<.025;
}
export function houseRoleColor(base, role, age = .5, brightness = 1) {
  if(housePreserveColor(base,role))return [...base];
  const old={roof:'oldRoof',wood:'oldWood',earth:'oldEarth',stone:'oldStone'}[role];
  const p=HOUSE_PALETTE[role].map((v,i)=>old?v*(1-age)+HOUSE_PALETTE[old][i]*age:v);
  return base.map((v,i)=>Math.min(.45,(v*.35+p[i]*.65)*brightness));
}
export const HOUSE_DIMENSIONS = Object.freeze({tile:8, boardMin:.18, boardMax:.30, seam:.015, strawMin:.30, strawMax:.45});
// Equal-width cells with independently jittered boundaries, shared by JS sampling tests.
export const houseBoardBoundary = i => i*.24 + (houseHash(i,9)-.5)*.06;
export function houseBroad(x,y,z) {
  return HOUSE_SURFACE.broad * (.65*Math.sin(x*2.1+Math.sin(z*1.7)+y*.9)+.35*Math.sin(y*3.1+z*2.3));
}
// Material names are optional hints. Unknown facility parts retain their source color, sloping faces tile.
export function facilityMaterialRole(name = '') {
  if (/tile|roof|瓦|屋根/i.test(name)) return 4;
  if (/post|pillar|beam|柱|貫/i.test(name)) return 5;
  if (/wood|board|板/i.test(name)) return 1;
  if (/stone|石/i.test(name)) return 3;
  if (/wall|plaster|漆喰|塀/i.test(name)) return 2;
  return 0;
}
// W2c-9g3: 8m packed stochastic atlas; no diagonal harmonics or brick rows.
function noise(x,y,seed) {
  const ix=Math.floor(x), iy=Math.floor(y), fx=x-ix, fy=y-iy;
  const sx=fx*fx*(3-2*fx), sy=fy*fy*(3-2*fy);
  const h=(a,b)=>houseHash(((a%64)+64)%64+seed,((b%64)+64)%64);
  return (h(ix,iy)*(1-sx)+h(ix+1,iy)*sx)*(1-sy)+(h(ix,iy+1)*(1-sx)+h(ix+1,iy+1)*sx)*sy;
}
export function* houseTextureRows(size = 512, seed = 9173) {
  const data=new Uint8Array(size*size*4), sums=[0,0,0,0];
  for(let y=0;y<size;y++) {
    const v=y/(size-1)*8;
    for(let x=0;x<size;x++) {
      const u=x/(size-1)*8, n=noise(u*.7,v*.7,seed);
      let board=Math.floor(u/.24);
      while(u<houseBoardBoundary(board))board--;
      while(u>=houseBoardBoundary(board+1))board++;
      const seam=Math.min(u-houseBoardBoundary(board),houseBoardBoundary(board+1)-u);
      const length=1.8+houseHash(board,seed+5)*1.5;
      const joint=fract((v+houseHash(board,seed+6)*length)/length)*length;
      const strawY=v + (noise(u*1.4,v*.4,seed+2)-.5)*.18;
      const row=Math.floor(strawY/.375), edge=strawY/.375-row;
      let first=10,second=10,stone=0;
      const gx=Math.floor(u/.30),gy=Math.floor(v/.30);
      for(let j=-1;j<=1;j++)for(let i=-1;i<=1;i++) {
        const cx=gx+i,cy=gy+j,dx=u/.30-cx-houseHash(cx+seed,cy),dy=v/.30-cy-houseHash(cx,cy+seed);
        const d=dx*dx+dy*dy;
        if(d<first){second=first;first=d;stone=houseHash(cx+seed,cy+7);}else if(d<second)second=d;
      }
      const values=[
        .48+.17*(noise(u*8,strawY*.6,seed)-.5)+.14*(noise(u*3,row,seed)-.5)-.16*Math.max(0,1-edge/.12),
        .5+.22*(houseHash(board,seed)-.5)+.10*(noise(u*35,v*.7,seed)-.5)-.28*Math.max(0,1-seam/.015)-.15*Math.max(0,1-joint/.012),
        .5+.26*(n-.5)-.12*Math.max(0,1-Math.abs(noise(u*2,v*2,seed+4)-.5)/.012),
        .54+.18*(stone-.5)-.30*Math.max(0,1-(Math.sqrt(second)-Math.sqrt(first))/.065)
      ];
      for(let c=0;c<4;c++){const idx=(y*size+x)*4+c;data[idx]=Math.round(values[c]*255);sums[c]+=data[idx];}
    }
    if(y%8===7)yield null;
  }
  const shifts=sums.map(s=>127.5-s/(size*size));
  for(let i=0;i<data.length;i++)data[i]=Math.max(0,Math.min(255,Math.round(data[i]+shifts[i%4])));
  // Repeat boundary is eight metres away; world warp removes the remaining tile repetition.
  for(let i=0;i<size;i++)for(let c=0;c<4;c++){
    data[(i*size+size-1)*4+c]=data[i*size*4+c];
    data[((size-1)*size+i)*4+c]=data[i*4+c];
  }
  return data;
}
export function houseTextureData(size = 512, seed = 9173) {
  const rows = houseTextureRows(size, seed); let result;
  do { result = rows.next(); } while (!result.done);
  return result.value;
}
