import { createKamakuraLamps } from './kamakura-lamps-view.js';
import { createKamakuraWorks } from './kamakura-works-view.js';
import { createKamakuraCrag } from './kamakura-crag-view.js';
// kamakura-layers.js — W2c-16: one seam for the Kamakura-only add-on layers (things carried by the wind, wildlife, props, the hero's small
// motions, the soundscape). Each layer lives in its own file and is built here from a fixed list, so parallel work never has to edit
// world-kamakura.js. Why a list instead of calls in the boot file: five rounds of polish all touched the same boot lines and collided.
//
// A factory gets one context object and returns null (inactive: switched off by its URL flag, or not written yet) or an object with any of
//   beforeHero(dt)   called in walking mode right before the hero's locomotion and pose (undo last frame's bone offsets, read keys here)
//   update(frame)    called once per drawn frame before the render; frame is reused, do not keep it
//   setAdapt(step)   automatic quality step 0–3 (3 = cheapest)
//   setPaused(on)    pause, blur and hidden tab
//   debugText()      short text for the ?debug=1 line ('' for none)
//   dispose()        release everything it created, exactly once
// A layer that fails to build, or throws while running, is switched off and reported once; the walk goes on without it.
// &layers=0 skips every layer (the pre-W2c-16 world).
import { createKamakuraHorizon } from './kamakura-horizon-view.js';
import { createKamakuraBackdrop } from './kamakura-backdrop-view.js';
import { createKamakuraDrift } from './kamakura-drift-view.js';
import { createKamakuraFauna } from './kamakura-fauna-view.js';
import { createKamakuraHarbor } from './kamakura-harbor-view.js';
import { createKamakuraFields } from './kamakura-fields-view.js';
import { createKamakuraPeople } from './kamakura-people-view.js';
import { createKamakuraCrowd } from './kamakura-crowd-view.js';
import { createKamakuraFire } from './kamakura-fire-view.js';
import { createKamakuraAvenue } from './kamakura-avenue-view.js';
import { createKamakuraRuinHall } from './kamakura-ruin-hall-view.js';
import { createKamakuraRiverlife } from './kamakura-riverlife-view.js';
import { createKamakuraTownDress } from './kamakura-town-dress-view.js';
import { createKamakuraProps } from './kamakura-props-view.js';
import { createKamakuraHeroLife } from './kamakura-hero-life-view.js';
import { createKamakuraSoundscape } from './kamakura-soundscape-view.js';

export const KAMAKURA_LAYERS = Object.freeze([
  ['backdrop', createKamakuraBackdrop],
  ['horizon', createKamakuraHorizon],
  ['drift', createKamakuraDrift],
  ['fauna', createKamakuraFauna],
  ['riverlife', createKamakuraRiverlife],
  ['props', createKamakuraProps],
  ['works', createKamakuraWorks],
  ['townDress', createKamakuraTownDress],
  ['lamps', createKamakuraLamps],
  ['ruinHall', createKamakuraRuinHall],
  ['avenue', createKamakuraAvenue],
  ['harbor', createKamakuraHarbor],
  ['fields', createKamakuraFields],
  ['people', createKamakuraPeople],
  ['crowd', createKamakuraCrowd],
  ['fire', createKamakuraFire],
  ['heroLife', createKamakuraHeroLife],
  ['soundscape', createKamakuraSoundscape],
]);

export function layersEnabled(search = '') { return new URLSearchParams(search).get('layers') !== '0'; }

// factories is injectable for tests. report(name, error) is called once per failed layer.
export async function createKamakuraLayers(context, { factories = KAMAKURA_LAYERS, report = defaultReport } = {}) {
  // Keep the base registry stable for worlds without optional outcrops and for injected factories.
  const activeFactories = factories === KAMAKURA_LAYERS && context?.data?.works?.crags?.length
    ? factories.flatMap(entry => entry[0] === 'works' ? [entry, ['crag', createKamakuraCrag]] : [entry]) : factories;
  const layers = [];
  let disposed = false;
  const fail = (entry, error) => {
    if (entry.dead) return;
    entry.dead = true;
    try { entry.layer.dispose?.(); } catch { /* a broken layer must not stop the others from closing */ }
    report(entry.name, error);
  };
  if (layersEnabled(context?.search)) {
    for (const [name, make] of activeFactories) {
      try {
        const layer = await make(context);
        if (layer) layers.push({ name, layer, dead: false });
      } catch (error) { report(name, error); }
    }
  }
  const each = (method, argument) => {
    for (const entry of layers) {
      if (entry.dead || typeof entry.layer[method] !== 'function') continue;
      try { entry.layer[method](argument); } catch (error) { fail(entry, error); }
    }
  };
  return {
    get names() { return layers.filter(entry => !entry.dead).map(entry => entry.name); },
    beforeHero(dt) { if (!disposed) each('beforeHero', dt); },
    update(frame) { if (!disposed) each('update', frame); },
    setAdapt(step) { if (!disposed) each('setAdapt', step); },
    setPaused(on) { if (!disposed) each('setPaused', !!on); },
    debugText() {
      if (disposed) return '';
      let text = '';
      for (const entry of layers) {
        if (entry.dead || typeof entry.layer.debugText !== 'function') continue;
        let part = '';
        try { part = entry.layer.debugText() || ''; } catch (error) { fail(entry, error); }
        if (part) text += '・' + part;
      }
      return text;
    },
    dispose() {
      if (disposed) return; disposed = true;
      for (let i = layers.length - 1; i >= 0; i--) {
        const entry = layers[i];
        if (entry.dead) continue;
        entry.dead = true;
        try { entry.layer.dispose?.(); } catch (error) { report(entry.name, error); }
      }
    },
  };
}

function defaultReport(name, error) {
  // One console error per failed layer: visible to the GL smoke check, harmless to the walk.
  console.error(`Kamakura layer "${name}" was switched off:`, error);
}
