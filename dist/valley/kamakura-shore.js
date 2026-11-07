// W2c-9a: silent sea → shared, pure shore-distance field (metres, 3–4 chamfer).
export const SHORE_LIMIT_M = 3000;
const clamp = (v, hi) => Math.max(0, Math.min(hi, v));
export function createShoreField(terrain, { cell = 16 } = {}) {
  if (!Number.isFinite(cell) || cell <= 0) throw new RangeError('Invalid shore cell');
  const b = terrain.bounds, x0 = b.minX, z0 = b.minZ;
  const w = Math.ceil((b.maxX - x0) / cell) + 1, h = Math.ceil((b.maxZ - z0) / cell) + 1;
  const data = new Float32Array(w * h);
  const straight = cell, diagonal = cell * 4 / 3;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) data[j * w + i] = terrain.isSea(x0 + i * cell, z0 + j * cell) ? 0 : Infinity;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i;
    if (i) data[k] = Math.min(data[k], data[k - 1] + straight);
    if (j) data[k] = Math.min(data[k], data[k - w] + straight,
      i ? data[k - w - 1] + diagonal : Infinity, i + 1 < w ? data[k - w + 1] + diagonal : Infinity);
  }
  for (let j = h - 1; j >= 0; j--) for (let i = w - 1; i >= 0; i--) {
    const k = j * w + i;
    if (i + 1 < w) data[k] = Math.min(data[k], data[k + 1] + straight);
    if (j + 1 < h) data[k] = Math.min(data[k], data[k + w] + straight,
      i ? data[k + w - 1] + diagonal : Infinity, i + 1 < w ? data[k + w + 1] + diagonal : Infinity);
  }
  // A finite sentinel keeps interpolation near the cap free of Infinity * 0 / NaN.
  for (let k = 0; k < data.length; k++) data[k] = Math.min(SHORE_LIMIT_M, data[k]);
  function seaDistanceAt(x, z) {
    const gx = clamp((Math.max(b.minX, Math.min(b.maxX, x)) - x0) / cell, w - 1);
    const gz = clamp((Math.max(b.minZ, Math.min(b.maxZ, z)) - z0) / cell, h - 1);
    // Clamp before testing sea so outside queries really use the nearest field edge.
    if (terrain.isSea(Math.min(b.maxX, x0 + gx * cell), Math.min(b.maxZ, z0 + gz * cell))) return 0;
    const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j;
    const k = j * w + i, right = Math.min(i + 1, w - 1) - i, down = Math.min(j + 1, h - 1) * w + i;
    const d = (data[k] * (1 - u) + data[k + right] * u) * (1 - v) + (data[down] * (1 - u) + data[down + right] * u) * v;
    return d >= SHORE_LIMIT_M ? Infinity : d;
  }
  return { cell, x0, z0, w, h, data, seaDistanceAt };
}

// W2c-9e: inverse (water -> land) and river fields; bounded work supplied by caller.
export const SEA_VIS = Object.freeze({ reach: 8, foamWidth: .9, tide: 11.5, tideWidth: 2.5 });
export const shoreWetness = (d, wave) => Math.max(0, Math.min(1, (2 + (SEA_VIS.reach - 2) * wave - d) / 2));
export const shoreFoam = (d, wave) => Math.max(0, 1 - Math.abs(d - (1 + 5 * (1 - wave))) / SEA_VIS.foamWidth);
export function riverWetness(d){const u=Math.max(0,Math.min(1,(d-.6)/1.4));return 1-u*u*(3-2*u);}
export const tideLine = d => Math.max(0, 1 - Math.abs(d - SEA_VIS.tide) / SEA_VIS.tideWidth);
export function createDistanceJob(terrain, { river = false, cell = river ? 8 : 16, limit = river ? 12 : SHORE_LIMIT_M } = {}) {
  if (!(cell > 0) || !Number.isFinite(cell) || !(limit > 0) || !Number.isFinite(limit)) throw new RangeError('Invalid distance grid');
  const b = terrain.bounds, x0 = b.minX, z0 = b.minZ;
  const w = Math.ceil((b.maxX-x0)/cell)+1, h = Math.ceil((b.maxZ-z0)/cell)+1;
  const data = new Float32Array(w*h); let phase = 0, cursor = 0;
  const field = {x0,z0,w,h,cell,data,maxX:b.maxX,maxZ:b.maxZ};
  function step(budget = 256) {
    for (let n=0;n<budget && phase<3;n++) {
      const k = phase===2 ? data.length-1-cursor : cursor, i=k%w, j=Math.floor(k/w);
      if (!phase) {
        const x=Math.min(b.maxX,x0+i*cell), z=Math.min(b.maxZ,z0+j*cell);
        data[k]=river ? Math.min(limit,terrain.riverDistanceAt(x,z,limit)) : terrain.isSea(x,z) ? limit : 0;
      } else if (phase===1) {
        if(i)data[k]=Math.min(data[k],data[k-1]+cell);
        if(j)data[k]=Math.min(data[k],data[k-w]+cell,i?data[k-w-1]+cell*4/3:limit,i+1<w?data[k-w+1]+cell*4/3:limit);
      } else {
        if(i+1<w)data[k]=Math.min(data[k],data[k+1]+cell);
        if(j+1<h)data[k]=Math.min(data[k],data[k+w]+cell,i?data[k+w-1]+cell*4/3:limit,i+1<w?data[k+w+1]+cell*4/3:limit);
      }
      if(++cursor===data.length){cursor=0;phase=river?3:phase+1;}
    }
    return phase===3;
  }
  return {field,step,get done(){return phase===3;}};
}
export function sampleDistance(field,x,z) {
  const gx=clamp((Math.min(x,field.maxX??Infinity)-field.x0)/field.cell,field.w-1), gz=clamp((Math.min(z,field.maxZ??Infinity)-field.z0)/field.cell,field.h-1);
  const i=Math.floor(gx),j=Math.floor(gz),u=gx-i,v=gz-j,k=j*field.w+i;
  const r=Math.min(i+1,field.w-1)-i, down=Math.min(j+1,field.h-1)*field.w+i;
  return (field.data[k]*(1-u)+field.data[k+r]*u)*(1-v)+(field.data[down]*(1-u)+field.data[down+r]*u)*v;
}
// Data identity shares view uniforms without modifying terrain or chunk ownership.
const shoreViews=new WeakMap();
export const shoreViewFor=data=>shoreViews.get(data);
export const registerShoreView=(data,view)=>shoreViews.set(data,view);
export const unregisterShoreView=data=>shoreViews.delete(data);
export function shorePropAt(terrain,codeAt,x,z) {
  const code=codeAt(x,z), d=terrain.seaDistanceAt(x,z);
  return (code===0||code===1)&&d>=2&&d<=14&&!terrain.isSea(x,z)&&terrain.riverDistanceAt(x,z,2)>2;
}
export function shoreHash(x,z,salt=0) {
  let n=Math.imul(x|0,73856093)^Math.imul(z|0,19349663)^salt;
  n=Math.imul(n^(n>>>16),0x45d9f3b);return ((n^(n>>>16))>>>0)/4294967296;
}
// Shared JS/GLSL constants and algebra: wave is evaluated once on the audio clock.
export const SHORE_GLSL=`
float shoreWet(float d,float wave){return clamp((2.0+${(SEA_VIS.reach-2).toFixed(1)}*wave-d)/2.0,0.0,1.0);}
float shoreFoam(float d,float wave){return max(0.0,1.0-abs(d-(1.0+5.0*(1.0-wave)))/${SEA_VIS.foamWidth.toFixed(1)});}
float tideLine(float d){return max(0.0,1.0-abs(d-${SEA_VIS.tide.toFixed(1)})/${SEA_VIS.tideWidth.toFixed(1)});}
`;
