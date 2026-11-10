// W2c-16: the time-of-day button keeps the place and the heading and only changes the time.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TIME_ORDER, TIME_LABEL, currentTime, nextTime, timeButtonText, timeSwitchSearch } from '../dist/valley/kamakura-time-switch.js';
import { KAMAKURA_TIMES, DEFAULT_TIME } from '../dist/valley/kamakura-atmosphere.js';

const source = name => fs.readFileSync(new URL(`../dist/valley/${name}`, import.meta.url), 'utf8');

test('the order covers every time preset once and each has a label', () => {
  assert.deepEqual([...TIME_ORDER].sort(), Object.keys(KAMAKURA_TIMES).sort());
  assert.deepEqual([...TIME_ORDER], ['morning', 'noon', 'golden', 'evening']);
  for (const name of TIME_ORDER) assert.equal(typeof TIME_LABEL[name], 'string');
  let time = 'noon'; const seen = [];
  for (let i = 0; i < TIME_ORDER.length; i++) { time = nextTime(time); seen.push(time); }
  assert.deepEqual(seen, ['golden', 'evening', 'morning', 'noon']);
});

test('an unknown or missing time counts as the default (golden hour), as the atmosphere reads it', () => {
  assert.equal(DEFAULT_TIME, 'golden');   // chosen by the owner after the blind comparison with noon (2026-11-10)
  assert.equal(currentTime(''), DEFAULT_TIME); assert.equal(currentTime('?time=bad'), DEFAULT_TIME); assert.equal(currentTime('?time=evening'), 'evening');
  assert.equal(timeButtonText('?world=kamakura'), '時刻：' + TIME_LABEL[DEFAULT_TIME]); assert.equal(timeButtonText('?time=noon'), '時刻：昼'); assert.equal(timeButtonText('?time=golden'), '時刻：夕方前');
});

test('the next query keeps every other parameter, the place and the heading', () => {
  const next = timeSwitchSearch('?world=kamakura&debug=1&drift=2', { x: -60.04, y: 10.8, z: 840.26 }, -Math.PI / 2);
  const q = new URLSearchParams(next);
  assert.equal(q.get('world'), 'kamakura'); assert.equal(q.get('debug'), '1'); assert.equal(q.get('drift'), '2');
  assert.equal(q.get('time'), nextTime(DEFAULT_TIME));   // no time in the address: the button moves on from the default
  assert.equal(q.get('pos'), '-60.0,-840.3');   // east, north (north is -z)
  assert.equal(q.get('yaw'), '90');             // degrees clockwise from north; the internal heading is its negative
  assert(next.startsWith('?') && next.includes('pos=-60.0,-840.3'), next);
  // Going round returns to the first time, and an old pos/yaw is replaced, not repeated.
  let search = '?world=kamakura&time=evening&pos=1,2&yaw=10';
  search = timeSwitchSearch(search, { x: 5, z: -7 }, Math.PI);
  assert.equal(new URLSearchParams(search).get('time'), 'morning');
  assert.equal(new URLSearchParams(search).getAll('pos').length, 1); assert.equal(new URLSearchParams(search).get('pos'), '5.0,7.0');
  assert.equal(new URLSearchParams(search).get('yaw'), '180');
});

test('a missing place or heading leaves those parameters alone', () => {
  const q = new URLSearchParams(timeSwitchSearch('?world=kamakura&pos=3,4&yaw=20', null, NaN));
  assert.equal(q.get('pos'), '3,4'); assert.equal(q.get('yaw'), '20'); assert.equal(q.get('time'), nextTime(DEFAULT_TIME));
  assert.equal(new URLSearchParams(timeSwitchSearch('', { x: 0, z: 0 }, 0)).get('pos'), '0.0,0.0', 'never a negative zero');
});

test('the screen has the button and the boot file wires it to the reload', () => {
  assert.match(source('hud-kamakura.js'), /<button class="kz-time" type="button"/);
  assert.match(source('hud-kamakura.js'), /time: root\.querySelector\('\.kz-time'\)/);
  const world = source('world-kamakura.js');
  assert.match(world, /hud\.time\.textContent = timeButtonText\(search\);/);
  assert.match(world, /location\.search = timeSwitchSearch\(search, flight\.pos, flight\.yaw\);/);
});
