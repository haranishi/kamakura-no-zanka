// W2c-16: the single seam for the Kamakura add-on layers (kamakura-layers.js) and its wiring in world-kamakura.js.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createKamakuraLayers, layersEnabled, KAMAKURA_LAYERS } from '../dist/valley/kamakura-layers.js';

const source = name => fs.readFileSync(new URL(`../dist/valley/${name}`, import.meta.url), 'utf8');
function recorder() {
  const log = [];
  const layer = (name, extra = {}) => ({
    beforeHero: dt => log.push(`${name}.beforeHero:${dt}`), update: frame => log.push(`${name}.update:${frame.dt}`),
    setAdapt: step => log.push(`${name}.setAdapt:${step}`), setPaused: on => log.push(`${name}.setPaused:${on}`),
    debugText: () => `${name}!`, dispose: () => log.push(`${name}.dispose`), ...extra,
  });
  return { log, layer };
}

test('the default list names five distinct layers, each with a factory', () => {
  const names = KAMAKURA_LAYERS.map(([name]) => name);
  assert.deepEqual(names, ['drift', 'fauna', 'props', 'heroLife', 'soundscape']);
  assert.equal(new Set(names).size, names.length);
  for (const [, make] of KAMAKURA_LAYERS) assert.equal(typeof make, 'function');
  assert(Object.isFrozen(KAMAKURA_LAYERS));
});

test('factories run in order with the same context; null means inactive', async () => {
  const { log, layer } = recorder(), context = { search: '?world=kamakura' }, seen = [];
  const layers = await createKamakuraLayers(context, { factories: [
    ['a', c => { seen.push(c); return layer('a'); }],
    ['b', () => null],
    ['c', async c => { seen.push(c); return layer('c'); }],
  ], report: () => assert.fail('no failure expected') });
  assert.deepEqual(layers.names, ['a', 'c']);
  assert(seen.every(c => c === context));
  layers.beforeHero(.016); layers.update({ dt: .02 }); layers.setAdapt(2); layers.setPaused(1);
  assert.deepEqual(log, ['a.beforeHero:0.016', 'c.beforeHero:0.016', 'a.update:0.02', 'c.update:0.02', 'a.setAdapt:2', 'c.setAdapt:2', 'a.setPaused:true', 'c.setPaused:true']);
  assert.equal(layers.debugText(), '・a!・c!');
});

test('&layers=0 builds nothing; the hooks stay callable', async () => {
  assert.equal(layersEnabled('?world=kamakura&layers=0'), false);
  assert.equal(layersEnabled('?world=kamakura'), true);
  assert.equal(layersEnabled(), true);
  const layers = await createKamakuraLayers({ search: '?layers=0' }, { factories: [['a', () => assert.fail('must not build')]] });
  assert.deepEqual(layers.names, []);
  layers.beforeHero(.01); layers.update({ dt: .01 }); layers.setAdapt(3); layers.setPaused(true);
  assert.equal(layers.debugText(), ''); layers.dispose();
});

test('a factory that throws is reported once and the others still run', async () => {
  const { log, layer } = recorder(), reports = [];
  const layers = await createKamakuraLayers({ search: '' }, { factories: [
    ['bad', () => { throw new Error('boom'); }],
    ['slow', async () => { throw new Error('later'); }],
    ['good', () => layer('good')],
  ], report: (name, error) => reports.push(`${name}:${error.message}`) });
  assert.deepEqual(reports, ['bad:boom', 'slow:later']);
  assert.deepEqual(layers.names, ['good']);
  layers.update({ dt: 1 }); assert.deepEqual(log, ['good.update:1']);
});

test('a layer that throws while running is closed, reported once and never called again', async () => {
  const { log, layer } = recorder(), reports = [];
  let fail = false;
  const layers = await createKamakuraLayers({ search: '' }, { factories: [
    ['a', () => layer('a', { update: () => { if (fail) throw new Error('frame'); log.push('a.update'); } })],
    ['b', () => layer('b')],
  ], report: (name, error) => reports.push(`${name}:${error.message}`) });
  layers.update({ dt: 1 }); fail = true; layers.update({ dt: 2 }); layers.update({ dt: 3 }); layers.beforeHero(.1);
  assert.deepEqual(reports, ['a:frame']);
  assert.deepEqual(log, ['a.update', 'b.update:1', 'a.dispose', 'b.update:2', 'b.update:3', 'b.beforeHero:0.1']);
  assert.deepEqual(layers.names, ['b']);
  assert.equal(layers.debugText(), '・b!');
  layers.dispose(); assert.equal(log.filter(x => x === 'a.dispose').length, 1);
});

test('a broken debug text or dispose does not stop the others', async () => {
  const { log, layer } = recorder(), reports = [];
  const layers = await createKamakuraLayers({ search: '' }, { factories: [
    ['a', () => layer('a', { debugText: () => { throw new Error('text'); } })],
    ['b', () => layer('b', { dispose: () => { throw new Error('close'); } })],
    ['c', () => layer('c', { debugText: () => '' })],
  ], report: (name, error) => reports.push(`${name}:${error.message}`) });
  assert.equal(layers.debugText(), '・b!');
  assert.deepEqual(reports, ['a:text']);
  layers.dispose();
  assert.deepEqual(reports, ['a:text', 'b:close']);
  assert.deepEqual(log, ['a.dispose', 'c.dispose']);
});

test('dispose closes in reverse order, once, and silences every hook', async () => {
  const { log, layer } = recorder();
  const layers = await createKamakuraLayers({ search: '' }, { factories: [['a', () => layer('a')], ['b', () => layer('b')], ['c', () => ({})]] });
  layers.dispose(); layers.dispose();
  assert.deepEqual(log, ['b.dispose', 'a.dispose']);
  layers.beforeHero(1); layers.update({ dt: 1 }); layers.setAdapt(1); layers.setPaused(true);
  assert.equal(layers.debugText(), ''); assert.deepEqual(layers.names, []);
  assert.deepEqual(log, ['b.dispose', 'a.dispose']);
});

test('the default report writes one console error per failed layer', async () => {
  const saved = console.error, seen = [];
  console.error = (...args) => seen.push(args);
  try { await createKamakuraLayers({ search: '' }, { factories: [['bad', () => { throw new Error('boom'); }]] }); }
  finally { console.error = saved; }
  assert.equal(seen.length, 1); assert.match(String(seen[0][0]), /"bad"/); assert.equal(seen[0][1].message, 'boom');
});

test('world-kamakura.js builds, drives and closes the layers at the right places', () => {
  const s = source('world-kamakura.js');
  const at = text => { const i = s.indexOf(text); assert(i >= 0, `missing: ${text}`); return i; };
  assert(at('bindKamakuraFlight({ flight, input, hud') < at('layers = await createKamakuraLayers({'));
  assert(at('layers = await createKamakuraLayers({') < at('renderer.setAnimationLoop(now'));
  // The hook runs before the hero's locomotion and pose; the frame update runs before the draws.
  assert(at('layers?.beforeHero(dt);') < at('hero.updateLocomotion(dt,'));
  assert(at('renderer.setAnimationLoop(now') < at('layers?.beforeHero(dt);'));
  assert(at('layers?.update(layerFrame);') < at('renderer.info.reset();'));
  // The frame carries the viewer's heading, and the audio view hears the same frame first.
  assert(at('layerFrame.yaw = flight.yaw;') < at('audioView.listen?.(layerFrame);'));
  assert(at('audioView.listen?.(layerFrame);') < at('layers?.update(layerFrame);'));
  assert(at('layers?.update(layerFrame);') < at('post.render(scene, camera)'));
  // Closed before the hero and the scene resources go away; paused and adapted with the rest.
  assert(at('layers?.dispose(); layers = null;') < at('hero?.remove();'));
  at('layers?.setPaused(on);'); at('layers?.setAdapt(adapt.step);'); at("audioView.debugText() + (layers?.debugText() || '')");
  for (const key of ['scene', 'camera', 'renderer', 'search', 'quality', 'data', 'terrain: t', 'game: g', 'colliders: g.col', 'hero', 'rig', 'input', 'keys: base', 'wind', 'sunDir: atmosphere.sunDir', 'atmosphere', 'post', 'audioView', 'houses', 'facilities', 'trees', 'stands', 'water', 'sea', 'grass', 'fx', 'flight', 'hud', 'habitat: createHabitat({ terrain: t, meta, surface: data.surface, housePoints: houseExclusions })']) {
    const call = s.slice(at('layers = await createKamakuraLayers({'), at('if (disposed) { layers.dispose(); layers = null; }'));
    assert(call.includes(key), `context lacks ${key}`);
  }
});

test('every layer file exports the factory the list imports', () => {
  for (const [file, name] of [['kamakura-drift-view.js', 'createKamakuraDrift'], ['kamakura-fauna-view.js', 'createKamakuraFauna'], ['kamakura-props-view.js', 'createKamakuraProps'], ['kamakura-hero-life-view.js', 'createKamakuraHeroLife'], ['kamakura-soundscape-view.js', 'createKamakuraSoundscape']]) {
    assert.match(source(file), new RegExp(`export (?:async )?function ${name}\\(`), `${file} must export ${name}`);
  }
});
