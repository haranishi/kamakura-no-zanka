import {localGrassR7Metrics} from './lib/grass-r7-metrics.mjs';
console.log(JSON.stringify({kind:'synthetic leaf linear radiance; not framebuffer sRGB',extentMetres:[30,12],samples:[.15,.35,.55].flatMap(scale=>[1,.1].map(sunY=>localGrassR7Metrics(scale,sunY)))},null,2));
