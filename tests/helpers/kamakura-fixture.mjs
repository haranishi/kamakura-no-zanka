// Entirely synthetic grid, unrelated to private geographical data.
export function fixture({ width = 145, height = 145, cell = 1, slope = 0, water = false } = {}) {
  const meta = { schema: 'kz-world-web/0.1', grid: { width, height, cell_m: cell, row0: 'north', col0: 'west', sample_position: 'cell_center', x_axis: 'east', y_axis: 'north', z_axis: 'up' },
    height: { file: 'height_u16.bin', encoding: 'uint16-le', min_m: 0, max_m: 65535, step_m: 1 },
    walk: { file: 'walk_u8.bin', polygon_m: [[-10000, -10000], [10000, -10000], [10000, 10000], [-10000, 10000]] },
    spawn: { x: 0, y: 0, z: 10, yaw_deg_clockwise_from_north: 0 }, places: [] };
  const heights = new Uint16Array(width * height), walk = new Uint8Array(width * height).fill(water ? 2 : 1);
  for (let j = 0; j < height; j++) for (let i = 0; i < width; i++) heights[j * width + i] = 1000 + slope * i * cell;
  return { meta, heights, walk };
}
