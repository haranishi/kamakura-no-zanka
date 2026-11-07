// W2c-9g: deterministic house surface rules/data; no renderer, DOM, clock or random state.
export const HOUSE_SURFACE = Object.freeze({ base: .5, roof: .35, wood: .65, near: 80, far: 250, brightness: .10, broad: .20, detail: 1.15, hue: Math.PI / 60 });
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
// W2c-9g2: shared linear RGB palette; retain 22% of the kit's color as its family tint.
export const HOUSE_PALETTE = Object.freeze({
  roof: [.32,.235,.105], oldRoof: [.235,.215,.17], wood: [.39,.365,.32],
  plaster: [.70,.665,.545], stone: [.10,.13,.16], tile: [.075,.09,.105], post: [.09,.065,.045]
});
export function houseRoleColor(base, role, age = .5, brightness = 1) {
  const p = role === 'roof' ? HOUSE_PALETTE.roof.map((v,i)=>v*(1-age)+HOUSE_PALETTE.oldRoof[i]*age) : HOUSE_PALETTE[role];
  return base.map((v,i)=>(v*.22+p[i]*.78)*brightness);
}
export function houseBroad(x,y,z) {
  return HOUSE_SURFACE.broad * (.65*Math.sin(x*2.1+Math.sin(z*1.7)+y*.9)+.35*Math.sin(y*3.1+z*2.3));
}
// Material names are optional hints. Unknown facility parts are plaster, sloping faces tile.
export function facilityMaterialRole(name = '') {
  if (/tile|roof|瓦|屋根/i.test(name)) return 4;
  if (/post|pillar|beam|柱|貫/i.test(name)) return 5;
  if (/wood|board|板/i.test(name)) return 1;
  if (/stone|石/i.test(name)) return 3;
  return 2;
}
// RGBA is a packed atlas: straw, boards, plaster, stone. Each channel has mean .5.
// Integer harmonics and duplicated borders make every mip's source tile periodic.
export function* houseTextureRows(size = 512, seed = 9173) {
  const data = new Uint8Array(size * size * 4), sums = [0, 0, 0, 0], tau = Math.PI * 2;
  const phase = houseHash(seed, 1) * tau, wave = (x, n) => Math.sin(tau * x * n + phase);
  for (let y = 0; y < size; y++) {
    const v = y / (size - 1);
    for (let x = 0; x < size; x++) {
      const u = x / (size - 1), grain = wave(u + .006 * wave(v, 3), 47);
      const seam = Math.pow(.5 + .5 * wave(u, 8), 20);
      const row = Math.floor(v * 8 + .000001), cell = fract(u * 7 + .26 * Math.sin(row * 2.7 + phase));
      const mortar = Math.min(cell, 1 - cell, fract(v * 8), 1 - fract(v * 8));
      const values = [
        .5 + .17 * wave(u + .008 * wave(v, 4), 61) + .10 * wave(u, 13) + .06 * wave(v, 7),
        .5 + .09 * grain + .13 * wave(u, 8) - .33 * seam + .035 * wave(v + .03 * wave(u, 5), 19),
        .5 + .12 * wave(u + .03 * wave(v, 3), 3) * wave(v, 4) - .10 * Math.pow(.5 + .5 * wave(u + .06 * wave(v, 5), 13), 24),
        .56 + .09 * wave(u, 7) * wave(v, 8) - .36 * (1 - Math.min(1, mortar / .06))
      ];
      const i = (y * size + x) * 4;
      for (let c = 0; c < 4; c++) { data[i + c] = Math.round(values[c] * 255); sums[c] += data[i + c]; }
    }
    if (y % 8 === 7) yield null;
  }
  const shifts = sums.map(s => 127.5 - s / (size * size));
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) for (let c = 0; c < 4; c++) {
      const i = (y * size + x) * 4 + c;
      // Duplicate the periodic edges exactly, including row-jittered stone joints.
      const source = ((y === size - 1 ? 0 : y) * size + (x === size - 1 ? 0 : x)) * 4 + c;
      if (source !== i) data[i] = data[source];
      else data[i] = Math.max(0, Math.min(255, Math.round(data[i] + shifts[c])));
    }
    if (y % 32 === 31) yield null;
  }
  return data;
}
export function houseTextureData(size = 512, seed = 9173) {
  const rows = houseTextureRows(size, seed); let result;
  do { result = rows.next(); } while (!result.done);
  return result.value;
}
