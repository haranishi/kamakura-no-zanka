// Use the real shipped Three/GLTFLoader in Node, with no DOM, GPU, network or extra dependency.
import fs from 'node:fs';
export * as THREE from '../../dist/vendor/three.module.min.js';
const three = new URL('../../dist/vendor/three.module.min.js', import.meta.url).href;
const moduleURL = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/from 'three'/g, `from '${three}'`);
const utils = moduleURL(read('../../dist/vendor/utils/BufferGeometryUtils.js'));
const loader = moduleURL(read('../../dist/vendor/loaders/GLTFLoader.js').replace("from '../utils/BufferGeometryUtils.js'", `from '${utils}'`));
const view = read('../../dist/valley/kamakura-house-view.js')
  .replace("from 'three/addons/loaders/GLTFLoader.js'", `from '${loader}'`)
  .replace("from './kamakura-houses.js'", `from '${new URL('../../dist/valley/kamakura-houses.js', import.meta.url).href}'`);
export const loadHouseView = () => import(moduleURL(view));
