// Real bundled loader and Three in Node. This does not exercise GPU rendering.
import fs from 'node:fs';
export * as THREE from '../../dist/vendor/three.module.min.js';
const three = new URL('../../dist/vendor/three.module.min.js', import.meta.url).href;
const url = s => 'data:text/javascript;base64,' + Buffer.from(s).toString('base64');
const read = p => fs.readFileSync(new URL(p, import.meta.url), 'utf8').replace(/from 'three'/g, `from '${three}'`);
const utils = url(read('../../dist/vendor/utils/BufferGeometryUtils.js'));
const materials = url(read('../../dist/valley/kamakura-house-materials.js').replace("from './kamakura-house-texture.js'", `from '${new URL('../../dist/valley/kamakura-house-texture.js', import.meta.url).href}'`));
const loader = url(read('../../dist/vendor/loaders/GLTFLoader.js').replace("from '../utils/BufferGeometryUtils.js'", `from '${utils}'`));
export const loadFacilityView = () => import(url(read('../../dist/valley/kamakura-facility-view.js')
  .replace("from './kamakura-house-materials.js'", `from '${materials}'`)
  .replace("from './kamakura-house-texture.js'", `from '${new URL('../../dist/valley/kamakura-house-texture.js', import.meta.url).href}'`)
  .replace("from 'three/addons/loaders/GLTFLoader.js'", `from '${loader}'`)
  .replace("from './kamakura-facilities.js'", `from '${new URL('../../dist/valley/kamakura-facilities.js', import.meta.url).href}'`)));
