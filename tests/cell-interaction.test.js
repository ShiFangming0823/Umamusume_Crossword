import test from 'node:test';
import assert from 'node:assert/strict';
import { bindCellActivation } from '../src/cell-interaction.js';

function fixture(initiallyActive = false) {
  const input = new EventTarget(), calls = [];
  let active = initiallyActive, direction = 'across', focused = false;
  bindCellActivation(input, {
    isActive: () => active,
    select(toggle, focus) {
      calls.push({toggle,focus}); active = true;
      if (toggle) direction = direction === 'across' ? 'down' : 'across';
      if (focus && !focused) { focused = true; input.dispatchEvent(new Event('focus')); }
    },
  });
  return { calls, get direction(){return direction;},
    fire(type, properties = {}) { const event = new Event(type); Object.assign(event, {button:0,isPrimary:true}, properties); input.dispatchEvent(event); },
  };
}

test('a cell tap synchronously requests input focus without waiting for native focus',()=>{
  const f=fixture();f.fire('pointerdown');assert.deepEqual(f.calls,[]);
  f.fire('click');assert.deepEqual(f.calls,[{toggle:false,focus:true}]);
});

test('native focus before click selects a new crossing without toggling its direction',()=>{
  const f=fixture();f.fire('pointerdown');f.fire('focus');f.fire('click');
  assert.deepEqual(f.calls,[{toggle:false,focus:false},{toggle:false,focus:true}]);
  assert.equal(f.direction,'across');
  f.fire('pointerdown');f.fire('click');assert.equal(f.direction,'down');
});

test('tapping an already selected cell requests focus again and toggles only once',()=>{
  const f=fixture(true);f.fire('pointerdown');f.fire('focus');f.fire('click');
  assert.deepEqual(f.calls,[{toggle:true,focus:true}]);assert.equal(f.direction,'down');
});

test('cancelled touch gestures do not select or request a keyboard',()=>{
  const f=fixture(true);f.fire('pointerdown');f.fire('pointercancel');
  assert.deepEqual(f.calls,[]);
  f.fire('click');assert.deepEqual(f.calls,[{toggle:false,focus:true}]);
});

test('focus-only navigation and assistive clicks work without a pointer event',()=>{
  const f=fixture();f.fire('focus');f.fire('click');
  assert.deepEqual(f.calls,[{toggle:false,focus:false},{toggle:false,focus:true}]);
});
