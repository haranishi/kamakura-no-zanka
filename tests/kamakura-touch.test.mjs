import test from 'node:test';
import assert from 'node:assert/strict';
import { TouchInput } from '../dist/valley/touch-input.js';
class Target {
  constructor() { this.handlers = new Map(); this.style = {}; }
  addEventListener(type, fn) { const list = this.handlers.get(type) || []; list.push(fn); this.handlers.set(type, list); }
  emit(type, event = {}) { for (const fn of this.handlers.get(type) || []) fn({ preventDefault() {}, ...event }); }
  getBoundingClientRect() { return { left: 0, width: 800 }; }
  setPointerCapture() {}
}
test('touch adapter keeps keyboard axis/look, independent fingers, sprint edges and pause clearing', () => {
  const oldDocument = globalThis.document, oldAdd = globalThis.addEventListener;
  const page = new Target(), window = new Target(); globalThis.document = page; globalThis.addEventListener = window.addEventListener.bind(window);
  try {
    const element = new Target(), run = new Target();
    const base = { enabled: true, wheel: 0, keys: new Set(), clear() { this.keys.clear(); }, setEnabled(on) { this.enabled = on; if (!on) this.clear(); },
      down(key) { return this.keys.has(key); }, wasPressed() { return false; }, mouseDown() { return false; }, mouseWasPressed() { return false; },
      axis() { return { forward: this.down('KeyW') ? 1 : 0, right: 0 }; }, look() { return { dx: 2, dy: 3 }; }, endFrame() {} };
    const input = new TouchInput(base, element, run);
    const finger = (id, x, y = 100) => ({ pointerId: id, pointerType: 'touch', clientX: x, clientY: y });
    element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 160, 40));
    assert(Math.abs(Math.hypot(input.axis().forward, input.axis().right) - 1) < 1e-9);
    element.emit('pointerdown', finger(2, 600)); element.emit('pointermove', finger(2, 620, 110));
    assert.deepEqual(input.look(0.016), { dx: 22, dy: 13 }); assert.deepEqual(input.look(0.016), { dx: 2, dy: 3 });
    run.emit('pointerdown', finger(3, 700)); assert(input.down('ShiftLeft')); assert(input.wasPressed('ShiftLeft'));
    input.endFrame(); assert(!input.wasPressed('ShiftLeft')); assert(input.down('ShiftLeft'));
    element.emit('pointerup', finger(1, 160, 40)); assert(!input.axis().active); assert(input.down('ShiftLeft'));
    run.emit('lostpointercapture', finger(3, 700)); assert(!input.down('ShiftLeft'));
    base.keys.add('KeyW'); assert(input.axis().active); input.setEnabled(false); assert(!input.axis().active); assert.equal(input.pointers.size, 0);
    input.setEnabled(true); element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 100, 40));
    window.emit('blur'); assert(!input.axis().active);
    element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 100, 40)); page.emit('visibilitychange'); assert(!input.axis().active);
    element.emit('pointerdown', { ...finger(1, 100), pointerType: 'mouse' }); assert.equal(input.pointers.size, 0);
    element.emit('pointerdown', finger(1, 100)); element.emit('pointermove', finger(1, 100, 40)); element.emit('pointercancel', finger(1, 100)); assert(!input.axis().active);
  } finally { globalThis.document = oldDocument; globalThis.addEventListener = oldAdd; }
});

test('optional abort signal releases keyboard, mouse and touch listeners on teardown', async () => {
  const { Input } = await import('../dist/valley/input.js');
  const oldDocument=globalThis.document, oldAdd=globalThis.addEventListener;
  const page=new EventTarget(), window=new EventTarget(), element=new EventTarget(), run=new EventTarget();
  element.style={};run.style={};element.getBoundingClientRect=()=>({left:0,width:800});
  globalThis.document=page;globalThis.addEventListener=window.addEventListener.bind(window);
  const emit=(target,type,values={})=>target.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),values));
  try {
    const events=new AbortController(),base=new Input(element,{signal:events.signal}),input=new TouchInput(base,element,run,{signal:events.signal});
    input.setEnabled(true);emit(window,'keydown',{code:'KeyW',repeat:false});assert(base.down('KeyW'));
    emit(run,'pointerdown',{pointerType:'touch',pointerId:1});assert(input.down('ShiftLeft'));
    events.abort(); input.clear();
    emit(window,'keydown',{code:'KeyW',repeat:false});emit(run,'pointerdown',{pointerType:'touch',pointerId:2});
    assert(!base.down('KeyW'));assert(!input.down('ShiftLeft'));assert.equal(input.pointers.size,0);
    // TouchInput must not retain its captured base through blur or page listeners.
    let calls=0;base.clear=()=>calls++;emit(window,'blur');emit(page,'visibilitychange');assert.equal(calls,0);
  } finally {globalThis.document=oldDocument;globalThis.addEventListener=oldAdd;}
});

test('flight touch/keyboard axes, arrow look and hold buttons clear on cancel, pause and abort',async()=>{
  const { Input }=await import('../dist/valley/input.js');
  const oldDocument=globalThis.document,oldAdd=globalThis.addEventListener;
  const page=new EventTarget(),window=new EventTarget();globalThis.document=page;globalThis.addEventListener=window.addEventListener.bind(window);
  const element=new EventTarget(),run=new EventTarget(),up=new EventTarget(),down=new EventTarget();
  for(const t of [element,run,up,down])t.style={};element.getBoundingClientRect=()=>({left:0,width:800});
  const emit=(target,type,values={})=>target.dispatchEvent(Object.assign(new Event(type,{cancelable:true}),values));
  try {
    const events=new AbortController(),base=new Input(element,{signal:events.signal}),input=new TouchInput(base,element,run,{signal:events.signal,upButton:up,downButton:down});input.setEnabled(true);
    emit(window,'keydown',{code:'ArrowUp'});assert.equal(input.flightAxis().forward,0);assert(input.flightLook(1).dy<0);emit(window,'keyup',{code:'ArrowUp'});
    for(const [key,axis,value]of [['KeyW','forward',1],['KeyA','right',-1],['KeyE','up',1],['KeyQ','up',-1],['Space','up',1],['KeyC','up',-1]]){
      emit(window,'keydown',{code:key});assert.equal(input.flightAxis()[axis],value);emit(window,'keyup',{code:key});
    }
    emit(up,'pointerdown',{pointerType:'touch',pointerId:1});assert.equal(input.flightAxis().up,1);
    emit(down,'pointerdown',{pointerType:'touch',pointerId:2});assert.equal(input.flightAxis().up,0);
    emit(up,'lostpointercapture',{pointerId:1});assert.equal(input.flightAxis().up,-1);
    emit(down,'pointercancel',{pointerId:2});assert.equal(input.flightAxis().up,0);
    emit(run,'pointerdown',{pointerType:'touch',pointerId:3});assert(input.flightAxis().boost);
    emit(up,'pointerdown',{pointerType:'touch',pointerId:4});input.setEnabled(false);assert.equal(input.flightAxis().up,0);assert(!input.flightAxis().boost);
    input.setEnabled(true);emit(up,'pointerdown',{pointerType:'touch',pointerId:5});emit(window,'blur');assert.equal(input.flightAxis().up,0);
    events.abort();input.clear();emit(up,'pointerdown',{pointerType:'touch',pointerId:6});assert.equal(input.flightAxis().up,0);
  }finally{globalThis.document=oldDocument;globalThis.addEventListener=oldAdd;}
});
