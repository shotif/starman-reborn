import { describe, expect, it } from 'vitest';
import {
  GamepadInput,
  PAD_ACTIONS,
  PAD_BUTTON,
  PAD_FOR,
  PAD_HOLDS,
  PAD_TAP_HOLD,
  padLabel,
  padStyle,
  type PadButton,
  type PadState,
} from '../../src/flight/input/GamepadInput.ts';
import { SchemeTracker } from '../../src/flight/input/scheme.ts';
import { AIM_REACH, emptyInput, type FlightAction, type FlightInput } from '../../src/flight/input/types.ts';

const XBOX_ID = 'Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b13)';

/** A fake standard-layout pad: the test pushes its sticks and presses its buttons directly. */
class FakePad implements PadState {
  readonly id: string;
  readonly index: number;
  readonly mapping: string;
  connected = true;
  axes = [0, 0, 0, 0];
  buttons = Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));

  constructor(index = 0, id = XBOX_ID, mapping = 'standard') {
    this.index = index;
    this.id = id;
    this.mapping = mapping;
  }

  press(button: PadButton, value = 1): void {
    this.buttons[PAD_BUTTON[button]] = { pressed: value > 0.1, value };
  }

  release(button: PadButton): void {
    this.press(button, 0);
  }

  /** Stick position as the Gamepad API reports it: +x right, +y down. */
  stick(which: 'left' | 'right', x: number, y: number): void {
    const i = which === 'left' ? 0 : 2;
    this.axes[i] = x;
    this.axes[i + 1] = y;
  }
}

/** A GamepadInput reading a list of fake pads, with a log of what it reported. */
function rig(...initial: FakePad[]) {
  const pads: FakePad[] = [...initial];
  const input = new GamepadInput(() => pads);
  const log: string[] = [];
  input.onActivity = () => log.push('used');
  input.onConnected = (supported) => log.push(supported ? 'connected' : 'unsupported');
  input.onDisconnected = (anyLeft) => log.push(anyLeft ? 'disconnected, one left' : 'disconnected');
  /** One frame: read the pads, then merge them into a fresh input. */
  const frame = (drive = true, dt = 1 / 60): FlightInput => {
    input.update();
    const out = emptyInput();
    input.poll(dt, out, drive);
    return out;
  };
  return { input, pads, log, frame };
}

describe('gamepad mapping', () => {
  it('gives every button one job and names it on Xbox and PlayStation pads', () => {
    const actions = Object.values(PAD_ACTIONS);
    expect(new Set(actions).size).toBe(actions.length);
    for (const held of Object.values(PAD_HOLDS)) expect(held in PAD_ACTIONS, held).toBe(false);
    for (const [button, action] of Object.entries(PAD_ACTIONS)) expect(PAD_FOR[action], action).toBe(button);
    expect(PAD_FOR.interact).toBe('a');
    expect(PAD_FOR.pause).toBe('start');
    expect(PAD_FOR.map).toBe('back');
    expect(padLabel('a')).toBe('A');
    expect(padLabel('rt')).toBe('RT');
    expect(padLabel('a', 'playstation')).toBe('✕');
    expect(padLabel('rt', 'playstation')).toBe('R2');
    expect(padLabel('left', 'playstation')).toBe(padLabel('left', 'xbox'));
    expect(padStyle('DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)')).toBe('playstation');
    expect(padStyle('054c-09cc-Wireless Controller')).toBe('playstation');
    expect(padStyle(XBOX_ID)).toBe('xbox');
    expect(padStyle('Generic USB Gamepad')).toBe('xbox');
  });

  it('takes the button names of the connected pad', () => {
    const { input, frame, pads } = rig();
    expect(input.style).toBe('xbox');
    pads.push(new FakePad(0, 'DualSense Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 0ce6)'));
    frame();
    expect(input.style).toBe('playstation');
    pads.length = 0;
    frame();
    expect(input.style).toBe('xbox');
  });
});

describe('gamepad dialogs', () => {
  it('reads a press for a dialog once: the D-pad to move, A to press, B to close', () => {
    const pad = new FakePad();
    const { input, frame } = rig(pad);
    frame();
    expect(input.menu()).toBeNull();
    pad.press('down');
    frame();
    expect(input.menu()).toBe('down');
    frame();
    expect(input.menu()).toBeNull();
    pad.release('down');
    pad.press('up');
    frame();
    expect(input.menu()).toBe('up');
    pad.release('up');
    pad.press('a');
    frame();
    expect(input.menu()).toBe('confirm');
    pad.release('a');
    pad.press('b');
    frame();
    expect(input.menu()).toBe('back');
  });
});

describe('gamepad sticks', () => {
  it('steer with the left stick past a dead zone, up lifting the nose', () => {
    const p = new FakePad();
    const { frame } = rig(p);
    frame();
    p.stick('left', 0.12, -0.1);
    let out = frame();
    expect(out.steerX).toBe(0);
    expect(out.steerY).toBe(0);
    expect(out.manualOverride).toBe(false);

    p.stick('left', 1, 0);
    out = frame();
    expect(out.steerX).toBeCloseTo(1, 6);
    expect(out.steerY).toBe(0);
    // A real push takes over from the autopilot.
    expect(out.manualOverride).toBe(true);

    p.stick('left', 0, -1);
    expect(frame().steerY).toBeCloseTo(1, 6);
    p.stick('left', -1, 0);
    expect(frame().steerX).toBeCloseTo(-1, 6);

    // Part way, the response curve eases in.
    p.stick('left', 0.6, 0);
    const part = frame().steerX;
    expect(part).toBeGreaterThan(0);
    expect(part).toBeLessThan(0.6);

    // A diagonal past a square gate is capped at full deflection; pulling back dips the nose.
    p.stick('left', 0.9, 0.9);
    out = frame();
    expect(Math.hypot(out.steerX, out.steerY)).toBeCloseTo(1, 6);
    expect(out.steerX).toBeCloseTo(-out.steerY, 6);
    expect(out.steerY).toBeLessThan(0);
  });

  it('follow the Invert pitch setting', () => {
    const p = new FakePad();
    const { input, frame } = rig(p);
    frame();
    input.invertY = true;
    p.stick('left', 0, -1);
    expect(frame().steerY).toBeCloseTo(-1, 6);
    p.stick('left', 1, 0);
    expect(frame().steerY).toBe(0);
  });

  it('aim the reticle with the right stick, which springs back to the centre', () => {
    const p = new FakePad();
    const { frame } = rig(p);
    frame();
    p.stick('right', 0.1, 0.1);
    expect(frame().aimActive).toBe(false);
    p.stick('right', 1, 0);
    let out = frame();
    expect(out.aimActive).toBe(true);
    expect(out.aimX).toBeCloseTo(AIM_REACH.x, 6);
    expect(out.aimY).toBe(0);
    p.stick('right', 0, -1);
    out = frame();
    expect(out.aimY).toBeCloseTo(AIM_REACH.y, 6);
    // Aiming alone never cancels the autopilot or fires.
    expect(out.manualOverride).toBe(false);
    expect(out.fire).toBe(false);
    p.stick('right', 0, 0);
    expect(frame().aimActive).toBe(false);
  });

  it('own steering and aim only while the pad is the device in use', () => {
    const p = new FakePad();
    const { input } = rig(p);
    input.update();
    p.stick('left', 1, 0);
    p.stick('right', 1, 0);
    input.update();
    // Not in use: the mouse's steering and aim stand.
    const mouse = emptyInput();
    mouse.steerX = 0.4;
    mouse.aimActive = true;
    mouse.aimX = 0.3;
    input.poll(1 / 60, mouse, false);
    expect(mouse.steerX).toBe(0.4);
    expect(mouse.aimX).toBe(0.3);
    // In use and at rest: a mouse left off-centre neither steers nor holds the reticle.
    p.stick('left', 0, 0);
    p.stick('right', 0, 0);
    input.update();
    const resting = emptyInput();
    resting.steerX = 0.4;
    resting.steerY = -0.2;
    resting.aimActive = true;
    input.poll(1 / 60, resting, true);
    expect(resting.steerX).toBe(0);
    expect(resting.steerY).toBe(0);
    expect(resting.aimActive).toBe(false);
  });
});

describe('gamepad buttons', () => {
  it('fire each action exactly once per press', () => {
    const p = new FakePad();
    const { frame } = rig(p);
    frame();
    for (const [button, action] of Object.entries(PAD_ACTIONS) as [PadButton, FlightAction][]) {
      if (button in PAD_TAP_HOLD) continue;
      p.press(button);
      expect([...frame().actions], button).toEqual([action]);
      for (let i = 0; i < 5; i++) expect(frame().actions.size, `${button} held`).toBe(0);
      p.release(button);
      expect(frame().actions.size, `${button} released`).toBe(0);
      p.press(button);
      expect([...frame().actions], `${button} again`).toEqual([action]);
      p.release(button);
      frame();
    }
  });

  it('open the map on a tap of Back as it lets go, and the wing’s orders on a hold, once', () => {
    const p = new FakePad();
    const { input } = rig(p);
    let now = 1_000;
    const frame = (ms = 16): FlightAction[] => {
      now += ms;
      input.update(now);
      const out = emptyInput();
      input.poll(1 / 60, out, true);
      return [...out.actions];
    };
    frame();
    // A tap: nothing as it goes down, the map as it lets go.
    p.press('back');
    expect(frame()).toEqual([]);
    expect(frame(100)).toEqual([]);
    p.release('back');
    expect(frame()).toEqual(['map']);
    expect(frame()).toEqual([]);
    // A hold: the order card once it has been held long enough, once, and nothing as it lets go.
    p.press('back');
    expect(frame()).toEqual([]);
    expect(frame(PAD_TAP_HOLD.back.after * 1_000 - 50)).toEqual([]);
    expect(frame(60)).toEqual(['wing-order']);
    for (let i = 0; i < 20; i++) expect(frame(100)).toEqual([]);
    p.release('back');
    expect(frame()).toEqual([]);
    // Held when the pad connects: it must be let go before it acts.
    const q = new FakePad(1);
    q.press('back');
    const other = rig(q);
    other.input.update(5_000);
    other.input.update(6_000);
    q.release('back');
    other.input.update(6_016);
    const out = emptyInput();
    other.input.poll(1 / 60, out, true);
    expect(out.actions.size).toBe(0);
  });

  it('count presses from any pad, and presses on the same frame all act', () => {
    const first = new FakePad(0);
    const second = new FakePad(1, 'Wireless Controller (STANDARD GAMEPAD Vendor: 054c Product: 09cc)');
    const { frame } = rig(first, second);
    frame();
    first.press('x');
    second.press('lb');
    expect(new Set(frame().actions)).toEqual(new Set<FlightAction>(['missile', 'decoy']));
    // Each stick follows whichever pad pushes it further.
    first.stick('left', 0.1, 0);
    second.stick('left', 1, 0);
    expect(frame().steerX).toBeCloseTo(1, 6);
  });

  it('keep firing, boosting and moving the throttle while held', () => {
    const p = new FakePad();
    const { frame } = rig(p);
    frame();
    p.press('rt');
    for (let i = 0; i < 30; i++) {
      const out = frame();
      expect(out.fire).toBe(true);
      expect(out.actions.size).toBe(0);
    }
    // Held buttons count even while the mouse or touch drives.
    expect(frame(false).fire).toBe(true);
    p.release('rt');
    expect(frame().fire).toBe(false);
    // A finger resting on the trigger is not a pull.
    p.press('rt', 0.15);
    expect(frame().fire).toBe(false);
    p.release('rt');

    p.press('lt');
    const boost = frame();
    expect(boost.boost).toBe(true);
    expect(boost.manualOverride).toBe(true);
    p.release('lt');
    expect(frame().boost).toBe(false);

    // One second on the D-pad moves the throttle as far as the W and S keys do.
    let total = 0;
    p.press('up');
    for (let i = 0; i < 60; i++) total += frame(true, 1 / 60).throttleDelta;
    expect(total).toBeCloseTo(0.9, 6);
    p.release('up');
    p.press('down');
    const down = frame(true, 0.5);
    expect(down.throttleDelta).toBeCloseTo(-0.45, 6);
    expect(down.manualOverride).toBe(true);
  });

  it('let the pause menu and star map hear Start and Back', () => {
    const p = new FakePad();
    const { input } = rig(p);
    input.update();
    p.press('start');
    input.update();
    expect(input.pressed('pause')).toBe(true);
    expect(input.pressed('map')).toBe(false);
    input.update();
    expect(input.pressed('pause')).toBe(false);
  });

  it('make a button held while the pad connects wait for a fresh press', () => {
    const p = new FakePad();
    p.press('a');
    p.press('start');
    const { frame, log } = rig(p);
    expect(frame().actions.size).toBe(0);
    expect(frame().actions.size).toBe(0);
    // Connecting is not using: the HUD stays with the last device.
    expect(log).toEqual(['connected']);
    p.release('a');
    frame();
    p.press('a');
    expect([...frame().actions]).toEqual(['interact']);
  });
});

describe('gamepad connections', () => {
  it('return neutral input once the pad is gone, and report it once', () => {
    const p = new FakePad();
    const { frame, pads, log } = rig(p);
    frame();
    p.press('rt');
    p.press('lt');
    p.press('down');
    p.stick('left', 1, 0);
    p.stick('right', 0, -1);
    const busy = frame();
    expect(busy.fire).toBe(true);
    expect(busy.steerX).toBeGreaterThan(0.9);
    pads.length = 0;
    expect(frame()).toEqual(emptyInput());
    expect(frame()).toEqual(emptyInput());
    expect(log.filter((e) => e.startsWith('disconnected'))).toEqual(['disconnected']);
  });

  it('go neutral when the browser marks the pad disconnected', () => {
    const p = new FakePad();
    const { input, frame } = rig(p);
    frame();
    p.press('rt');
    expect(frame().fire).toBe(true);
    p.connected = false;
    expect(frame()).toEqual(emptyInput());
    expect(input.connected).toBe(false);
  });

  it('report each connection once, from the browser event, the pad list, or both', () => {
    const p = new FakePad();
    const { input, pads, log, frame } = rig();
    const target = new EventTarget();
    const stop = input.listen(target);
    pads.push(p);
    target.dispatchEvent(Object.assign(new Event('gamepadconnected'), { gamepad: p }));
    frame();
    frame();
    expect(log).toEqual(['connected']);
    expect(input.connected).toBe(true);
    pads.length = 0;
    target.dispatchEvent(Object.assign(new Event('gamepaddisconnected'), { gamepad: p }));
    frame();
    expect(log).toEqual(['connected', 'disconnected']);
    stop();
  });

  it('say whether a usable pad is left when one of two goes', () => {
    const first = new FakePad(0);
    const second = new FakePad(1);
    const { pads, log, frame } = rig(first, second);
    frame();
    pads.splice(1, 1);
    frame();
    expect(log).toEqual(['connected', 'connected', 'disconnected, one left']);
  });

  it('announce a pad without the standard layout but never read it', () => {
    const odd = new FakePad(0, 'Generic USB Joystick', '');
    const { input, frame, log } = rig(odd);
    frame();
    odd.press('a');
    odd.press('rt');
    odd.stick('left', 1, 0);
    expect(frame()).toEqual(emptyInput());
    expect(log).toEqual(['unsupported']);
    expect(input.connected).toBe(false);
  });
});

describe('last-used device', () => {
  /** A pad wired to the rule the way the game wires it. */
  function wired(schemes: SchemeTracker) {
    const r = rig();
    r.input.onActivity = () => schemes.use('gamepad');
    r.input.onDisconnected = (anyLeft) => {
      if (!anyLeft) schemes.gamepadLost();
    };
    return r;
  }

  it('on a desktop, the pad takes the HUD only once used, and the mouse takes it back', () => {
    const schemes = new SchemeTracker('desktop');
    const p = new FakePad();
    const { pads, frame } = wired(schemes);
    pads.push(p);
    frame();
    frame();
    // Connected but unused: nothing changes (and the touch overlay never appears).
    expect(schemes.scheme).toBe('desktop');
    p.press('a');
    frame();
    expect(schemes.scheme).toBe('gamepad');
    // The mouse moves.
    expect(schemes.use('desktop')).toBe(true);
    // A button still held, or a stick resting where it was, is not new use.
    frame();
    expect(schemes.scheme).toBe('desktop');
    p.stick('left', 0.8, 0);
    frame();
    expect(schemes.scheme).toBe('gamepad');
    // The mouse takes over with the stick still pushed: letting the stick go is not use...
    schemes.use('desktop');
    p.stick('left', 0, 0);
    frame();
    expect(schemes.scheme).toBe('desktop');
    // ...pushing it again is.
    p.stick('left', 0, -0.9);
    frame();
    expect(schemes.scheme).toBe('gamepad');
    // Unplugged: back to the mouse and keyboard.
    pads.length = 0;
    frame();
    expect(schemes.scheme).toBe('desktop');
  });

  it('on a phone, the touch sticks hide while the pad is in use and return when it goes', () => {
    const schemes = new SchemeTracker('touch');
    const p = new FakePad();
    const { pads, frame } = wired(schemes);
    pads.push(p);
    frame();
    expect(schemes.scheme).toBe('touch');
    p.stick('right', 0, -1);
    frame();
    expect(schemes.scheme).toBe('gamepad');
    // A thumb on the screen brings the touch controls back; the pad takes over again when used.
    schemes.use('touch');
    expect(schemes.scheme).toBe('touch');
    p.press('rt');
    frame();
    expect(schemes.scheme).toBe('gamepad');
    pads.length = 0;
    frame();
    expect(schemes.scheme).toBe('touch');
  });

  it('ignores a drifting stick', () => {
    const schemes = new SchemeTracker('desktop');
    const p = new FakePad();
    p.stick('left', 0.26, 0.05);
    const { pads, frame } = wired(schemes);
    pads.push(p);
    frame();
    for (let i = 0; i < 30; i++) {
      p.stick('left', 0.24 + (i % 3) * 0.02, 0.05);
      frame(false);
    }
    expect(schemes.scheme).toBe('desktop');
  });

  it('keeps the HUD when a pad goes while another device drives', () => {
    const schemes = new SchemeTracker('desktop');
    expect(schemes.gamepadLost()).toBe(false);
    expect(schemes.scheme).toBe('desktop');
    // Returning to the scheme already in use is not a change.
    expect(schemes.use('desktop')).toBe(false);
  });
});
