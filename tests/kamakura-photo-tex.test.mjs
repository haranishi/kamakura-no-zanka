import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { THREE, source } from './helpers/tree-modules.mjs';
import { PHOTO_TEX_DATA, PHOTO_PACK, PHOTO_GLSL, PHOTO_FADE_MS, photoOptions, photoStrength, photoAnisotropy,
  photoSampler, photoBlendUniform, photoBlend, photoHexWeights, startPhoto, photoUrl } from '../dist/valley/kamakura-photo-tex.js';

const root = new URL('../', import.meta.url);
const provenance = JSON.parse(await readFile(new URL('provenance/kamakura-photo-textures.json', root), 'utf8'));

// Minimal JPEG header reader: size and chroma sampling decide whether packed channels survive (4:2:0 would smear them).
function jpegInfo(bytes) {
  assert.equal(bytes[0], 0xff); assert.equal(bytes[1], 0xd8, 'JPEG SOI');
  for (let i = 2; i < bytes.length - 9;) {
    assert.equal(bytes[i], 0xff, 'marker');
    const marker = bytes[i + 1], length = bytes.readUInt16BE(i + 2);
    if (marker >= 0xc0 && marker <= 0xc2) {
      const components = bytes[i + 9];
      const sampling = []; for (let c = 0; c < components; c++) sampling.push(bytes[i + 11 + c * 3]);
      return { height: bytes.readUInt16BE(i + 5), width: bytes.readUInt16BE(i + 7), components, sampling };
    }
    i += 2 + length;
  }
  throw new Error('no SOF marker');
}

test('shipped detail textures match their provenance: files, hashes, sizes, 4:4:4, CC0 and a bounded total', async () => {
  assert.equal(provenance.license, 'CC0-1.0');
  assert.equal(provenance.materials.length, Object.keys(PHOTO_TEX_DATA).length);
  let total = 0;
  for (const m of provenance.materials) {
    const bytes = await readFile(new URL(`dist/assets/kamakura/photo/${m.file}`, root));
    total += bytes.length;
    assert.equal(createHash('sha256').update(bytes).digest('hex'), m.output.sha256, `${m.key} sha256`);
    assert.equal(bytes.length, m.output.bytes, `${m.key} bytes`);
    const info = jpegInfo(bytes);
    assert.deepEqual([info.width, info.height], [m.size, m.size], `${m.key} size`);
    assert.deepEqual(info.sampling, [0x11, 0x11, 0x11], `${m.key} must be 4:4:4 (unrelated channels)`);
    assert(bytes.length < 1.1 * 1048576, `${m.key} too large`);
    assert.equal(m.license, 'CC0-1.0'); assert.match(m.page, /^https:\/\/polyhaven\.com\/a\//);
    for (const s of m.sources) { assert.match(s.md5, /^[0-9a-f]{32}$/); assert.match(s.sha256, /^[0-9a-f]{64}$/); assert.match(s.url, /^https:\/\/dl\.polyhaven\.org\//); }
    const row = PHOTO_TEX_DATA[m.key];
    assert(row, `${m.key} is in the data table`);
    assert.deepEqual([row.file, row.size, row.meters, row.oriented], [m.file, m.size, m.meters, m.oriented], `${m.key} table row`);
    assert.deepEqual(row.meanLinearRgb, m.stats.meanLinearRgb);
    assert(m.stats.seam < 1.6, `${m.key} tile seam ${m.stats.seam}`);
    assert(Math.abs(m.stats.ratioP50 - 1) < .3, `${m.key} median ratio`);
  }
  assert.equal(total, provenance.totalBytes);
  assert(total < 5 * 1048576, `total ${total} bytes`); // requirement 7.5: under 5 MiB
  assert.equal(PHOTO_PACK.ratioCap, 3);
});

test('every source scan is credited in NOTICE.md and the bundle is declared CC0', async () => {
  const notice = await readFile(new URL('NOTICE.md', root), 'utf8');
  for (const m of provenance.materials) assert(notice.includes(m.polyhaven), `${m.polyhaven} credited`);
  assert(notice.includes('provenance/kamakura-photo-textures.json'));
});

test('photo options, strength and anisotropy are pure and conservative', () => {
  assert.equal(photoOptions('').enabled, true);
  assert.equal(photoOptions('?photo=0').enabled, false);
  assert.deepEqual([0, 1, 2, 3].map(step => photoStrength('standard', step)), [1, 1, .6, 0]);
  assert.equal(photoStrength('light', 0), .8);
  assert.equal(photoStrength('standard', 99), 0);
  assert.equal(photoAnisotropy('standard', 16), 8); assert.equal(photoAnisotropy('light', 16), 2); assert.equal(photoAnisotropy('standard', 0), 1);
  assert.throws(() => photoSampler('nope'), RangeError);
  assert.equal(photoSampler('wallWoodA'), photoSampler('wallWoodA'), 'one shared uniform per key');
  assert.match(photoUrl('x.jpg', 'https://example.test/valley/a.js'), /^https:\/\/example\.test\/assets\/kamakura\/photo\/x\.jpg$/);
});

test('stochastic tiling weights are L2-normalised, so blended independent patches keep their contrast', () => {
  // Deterministic independent unit-variance samples.
  let seed = 12345; const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
  const gauss = () => Math.sqrt(-2 * Math.log(rnd() + 1e-12)) * Math.cos(2 * Math.PI * rnd());
  for (const d2 of [[.05, .2, .3], [.1, .1, .1], [.3, .04, .25], [.49, .3, .02]]) {
    const w = photoHexWeights(d2);
    assert(Math.abs(Math.hypot(...w) - 1) < 1e-9, 'unit L2 norm');
    const n = 20000; let keep = 0, plain = 0, ratio = 0;
    const sum = w.reduce((a, b) => a + b, 0);
    for (let i = 0; i < n; i++) {
      const pick = () => ({ nx: gauss(), ny: 0, ratio: 1 + gauss() * .2 });
      const s = [pick(), pick(), pick()], mixed = photoBlend(s, w);
      keep += mixed.nx * mixed.nx; ratio += (mixed.ratio - 1) ** 2;
      plain += (s[0].nx * w[0] + s[1].nx * w[1] + s[2].nx * w[2]) ** 2 / (sum * sum);
    }
    assert(Math.abs(keep / n - 1) < .06, `blended variance ${keep / n} for ${d2}`);
    assert(Math.abs(ratio / n - .04) < .01, `ratio variance ${ratio / n}`);
    assert(plain / n < keep / n + 1e-9, 'a plain weighted mean never has more contrast');
  }
  const near = photoHexWeights([.0, .49, .49]);
  assert(near[0] > .99, 'at a lattice vertex only that vertex counts');
  assert.deepEqual(photoHexWeights([.6, .7, .9]), [0, 0, 0], 'outside every kernel nothing is blended');
  assert(photoBlend([{ nx: 0, ny: 0, ratio: .01 }], [1]).ratio >= .05, 'ratio never goes black');
});

function balanced(text) {
  const clean = text.replace(/\/\/[^\n]*/g, ''), stack = [], pairs = { ')': '(', ']': '[', '}': '{' };
  for (const c of clean) {
    if ('([{'.includes(c)) stack.push(c); else if (')]}'.includes(c)) assert.equal(stack.pop(), pairs[c], `mismatched ${c}`);
  }
  assert.equal(stack.length, 0, 'unclosed bracket');
}
test('shared GLSL helpers are balanced, avoid reserved words and keep the packing contract', () => {
  balanced(PHOTO_GLSL);
  for (const word of ['patch', 'sample', 'input', 'output', 'filter', 'common', 'active', 'partition', 'resource', 'texture', 'layout', 'precise']) {
    assert(!new RegExp(`\\b(?:float|vec[234]|mat3|sampler2D)\\s+${word}\\b`).test(PHOTO_GLSL), `reserved word ${word} used as a name`);
  }
  for (const name of ['kzPhoto', 'kzPhotoGrad', 'kzPhotoUnpack', 'kzPhotoHex', 'kzPhotoHexGrad', 'kzPerturbNormal']) assert(PHOTO_GLSL.includes(`${name}(`), name);
  // Decoding must mirror the build tool: B = sqrt(ratio / 3).
  assert(PHOTO_GLSL.includes('3.*s.b*s.b') && PHOTO_GLSL.includes('s.rg*2.-1.'));
  assert(/function photoBlend/.test(source('kamakura-photo-tex.js')));
  // Only the thin wrappers and the normal helper may take screen derivatives; the Grad variants must stay branch-safe.
  const body = name => { const i = PHOTO_GLSL.indexOf(`vec3 ${name}(`); assert(i >= 0, name); let depth = 0, j = PHOTO_GLSL.indexOf('{', i); const start = j; for (; j < PHOTO_GLSL.length; j++) { if (PHOTO_GLSL[j] === '{') depth++; else if (PHOTO_GLSL[j] === '}' && --depth === 0) break; } return PHOTO_GLSL.slice(start, j + 1); };
  for (const name of ['kzPhotoGrad', 'kzPhotoHexGrad']) assert(!/dFd[xy]/.test(body(name)), `${name} must not use implicit derivatives`);
  assert(/dFdx\(uv\)/.test(body('kzPhotoHex')), 'the wrapper supplies the derivatives');
});

const fakeLoader = (log, fail = new Set()) => async url => {
  log.push(url);
  const file = url.split('/').pop();
  if (fail.has(file)) throw new Error('404');
  const texture = new THREE.DataTexture(new Uint8Array([128, 128, 147, 255]), 1, 1, THREE.RGBAFormat); texture.disposeCalls = 0;
  const dispose = texture.dispose.bind(texture); texture.dispose = () => { texture.disposeCalls++; dispose(); };
  return texture;
};

test('startPhoto loads every texture once, swaps them in together, fades the shared blend and disposes each once', async () => {
  const log = [], keys = Object.keys(PHOTO_TEX_DATA);
  const handle = startPhoto(THREE, { search: '', quality: 'standard', maxAnisotropy: 16, loadTexture: fakeLoader(log), baseUrl: 'https://example.test/valley/x.js' });
  const neutral = photoSampler(keys[0]).value;
  assert(neutral?.isTexture, 'a neutral texture is bound before anything has loaded');
  assert.equal(photoBlendUniform.value, 0);
  handle.step(1); assert.equal(photoBlendUniform.value, 0, 'no fade before the swap');
  assert.equal(await handle.ready, true);
  assert.equal(log.length, keys.length); assert.equal(new Set(log).size, keys.length);
  assert(log.every(url => url.startsWith('https://example.test/assets/kamakura/photo/')));
  for (const key of keys) {
    const t = photoSampler(key).value;
    assert.notEqual(t, neutral, `${key} swapped`);
    assert.equal(t.wrapS, THREE.RepeatWrapping); assert.equal(t.minFilter, THREE.LinearMipmapLinearFilter);
    assert.equal(t.anisotropy, 8); assert.equal(t.colorSpace, THREE.NoColorSpace); assert.equal(t.generateMipmaps, true);
  }
  assert.equal(photoBlendUniform.value, 0, 'the blend starts at zero after the swap');
  handle.step(PHOTO_FADE_MS / 2000); assert(Math.abs(photoBlendUniform.value - .5) < 1e-9);
  handle.step(5); assert.equal(photoBlendUniform.value, 1);
  handle.setAdapt(2); handle.step(5); assert.equal(photoBlendUniform.value, .6);
  handle.setAdapt(3); handle.step(5); assert.equal(photoBlendUniform.value, 0, 'adapt step 3 switches the detail off');
  const textures = keys.map(key => photoSampler(key).value);
  handle.dispose(); handle.dispose();
  for (const t of textures) assert.equal(t.disposeCalls, 1);
  assert.equal(photoSampler(keys[0]).value, null); assert.equal(photoBlendUniform.value, 0);
});

test('photo=0 loads nothing, and a failed load keeps the procedural look without throwing', async () => {
  const log = [];
  const off = startPhoto(THREE, { search: '?photo=0', loadTexture: fakeLoader(log) });
  assert.equal(await off.ready, false); assert.equal(log.length, 0); assert.equal(off.stats.enabled, false);
  off.step(10); assert.equal(photoBlendUniform.value, 0); off.dispose();
  const failing = startPhoto(THREE, { loadTexture: fakeLoader(log, new Set(['roofTile.jpg'])) });
  assert.equal(await failing.ready, false); assert.equal(failing.stats.failed, 1);
  failing.step(10); assert.equal(photoBlendUniform.value, 0, 'no partial detail');
  for (const key of Object.keys(PHOTO_TEX_DATA)) assert.equal(photoSampler(key).value.image.width, 1, `${key} stays neutral`);
  failing.dispose();
});

test('the boot wires the loader once: start, per-frame fade, adapt step and disposal', () => {
  const boot = source('world-kamakura.js');
  assert.equal((boot.match(/startPhoto\(/g) || []).length, 1);
  assert(/photo\.step\(paused \? 0 : dt\)/.test(boot)); assert(/photo\.setAdapt\(adapt\.step\)/.test(boot)); assert(/photo\?\.dispose\(\)/.test(boot));
});
