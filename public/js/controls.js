// controls.js - one input vocabulary shared by phones, laptops, gamepads and the big screen.
// Logical buttons: up down left right block lp hp lk hk start back skip

export const BUTTONS = ['up', 'down', 'left', 'right', 'block', 'lp', 'hp', 'lk', 'hk', 'start', 'back', 'skip'];

// OpenMortal's default bindings (see OpenMortal.exe.ini): Player0 = left fighter, Player1 = right fighter.
// Values are KeyboardEvent.code strings the Boxedwine bridge knows how to inject.
export const SLOT_KEYS = {
  p1: { up: 'ArrowUp', down: 'ArrowDown', left: 'ArrowLeft', right: 'ArrowRight', block: 'PageDown', lp: 'Delete', hp: 'Insert', lk: 'End', hk: 'Home' },
  p2: { up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD', block: 'KeyX', lp: 'KeyF', hp: 'KeyR', lk: 'KeyG', hk: 'KeyT' },
};
// shared cabinet buttons
export const SYSTEM_KEYS = { start: 'Enter', back: 'Escape', skip: 'F1' };

export function keyFor(slot, button) {
  return SYSTEM_KEYS[button] || (SLOT_KEYS[slot] && SLOT_KEYS[slot][button]) || null;
}

// Physical keyboard on the big-screen machine -> logical (slot, button), for "classic" one-keyboard play
// and for players who prefer arcade-stick encoders that emulate a keyboard.
export const KEYBOARD_MAP = (() => {
  const m = {};
  for (const [slot, map] of Object.entries(SLOT_KEYS)) for (const [b, code] of Object.entries(map)) m[code] = [slot, b];
  // friendlier extra layout for P1 on laptops without Insert/Home/End: J K L U I
  Object.assign(m, { KeyJ: ['p1', 'lp'], KeyU: ['p1', 'hp'], KeyK: ['p1', 'lk'], KeyI: ['p1', 'hk'], KeyL: ['p1', 'block'] });
  m.Enter = [null, 'start']; m.Escape = [null, 'back']; m.F1 = [null, 'skip'];
  return m;
})();

// Standard Gamepad API mapping (Xbox / PlayStation / Switch Pro in "standard" layout)
// Face: X/Square = low punch, Y/Triangle = high punch, A/Cross = low kick, B/Circle = high kick.
export const PAD_BUTTONS = {
  0: 'lk', 1: 'hk', 2: 'lp', 3: 'hp', 4: 'block', 5: 'block', 6: 'skip', 7: 'block',
  8: 'back', 9: 'start', 12: 'up', 13: 'down', 14: 'left', 15: 'right',
};

/**
 * Polls navigator.getGamepads() and reports logical button changes.
 * onChange(padIndex, button, down, gamepad)
 */
export class GamepadPoller {
  constructor(onChange, { deadzone = 0.5 } = {}) {
    this.onChange = onChange; this.deadzone = deadzone; this.state = new Map(); this.raf = 0;
    this.tick = this.tick.bind(this);
  }
  start() { if (!this.raf) this.raf = requestAnimationFrame(this.tick); return this; }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }
  tick() {
    this.raf = requestAnimationFrame(this.tick);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const gp of pads) {
      if (!gp || !gp.connected) continue;
      const now = new Set();
      gp.buttons.forEach((b, i) => { if ((b.pressed || b.value > 0.5) && PAD_BUTTONS[i]) now.add(PAD_BUTTONS[i]); });
      const [ax = 0, ay = 0] = gp.axes;
      if (ax < -this.deadzone) now.add('left'); if (ax > this.deadzone) now.add('right');
      if (ay < -this.deadzone) now.add('up'); if (ay > this.deadzone) now.add('down');
      const prev = this.state.get(gp.index) || new Set();
      for (const b of now) if (!prev.has(b)) this.onChange(gp.index, b, true, gp);
      for (const b of prev) if (!now.has(b)) this.onChange(gp.index, b, false, gp);
      this.state.set(gp.index, now);
    }
  }
}

export function pulse(gp, ms = 60, strong = 0.6) {
  try { gp && gp.vibrationActuator && gp.vibrationActuator.playEffect('dual-rumble', { duration: ms, strongMagnitude: strong, weakMagnitude: strong / 2 }); } catch {}
}
