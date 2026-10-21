import assert from 'node:assert/strict';
import {sanitizeSettings,DEFAULT_SETTINGS} from '../dist/ui.js';
const tests=[];const test=(name,fn)=>{fn();tests.push({name,passed:true});};
test('Default settings preserve walking camera',()=>assert.deepEqual(sanitizeSettings(),DEFAULT_SETTINGS));
test('Settings clamp sensitivity and field of view',()=>{const s=sanitizeSettings({sensitivity:999,fov:-1});assert.equal(s.sensitivity,2);assert.equal(s.fov,55);});
test('Invalid quality and empty values safely reset',()=>{const s=sanitizeSettings({quality:'unknown',fov:'bad',sensitivity:'bad'});assert.equal(s.quality,'light');assert.equal(s.fov,65);assert.equal(s.sensitivity,1);});
test('Boolean settings remain explicit',()=>{const s=sanitizeSettings({invert:true,hud:false,hints:false});assert.equal(s.invert,true);assert.equal(s.hud,false);assert.equal(s.hints,false);});
test('Null storage does not break loading',()=>assert.deepEqual(sanitizeSettings(null),DEFAULT_SETTINGS));
console.log(JSON.stringify({passed:tests.length,failed:0,tests},null,2));
