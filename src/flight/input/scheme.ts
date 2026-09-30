import type { InputScheme } from './types.ts';

/**
 * The last-used-device rule. Whichever device the player used last drives the HUD: its layout,
 * where the reticle comes from, and which keys or buttons the hints name. Plugging in a gamepad
 * changes nothing until it is used; on a phone the touch sticks hide while the gamepad is in use.
 * When the gamepad goes away, the HUD returns to the device used before it.
 */
export class SchemeTracker {
  private current: InputScheme;
  /** The mouse-and-keyboard or touch scheme to return to when the gamepad is lost. */
  private beforePad: Exclude<InputScheme, 'gamepad'>;

  constructor(initial: Exclude<InputScheme, 'gamepad'>) {
    this.current = initial;
    this.beforePad = initial;
  }

  get scheme(): InputScheme {
    return this.current;
  }

  /** A device was just used. Returns whether the scheme changed. */
  use(scheme: InputScheme): boolean {
    if (scheme !== 'gamepad') this.beforePad = scheme;
    if (scheme === this.current) return false;
    this.current = scheme;
    return true;
  }

  /** The last usable gamepad went away. Returns whether the scheme changed (it was driving). */
  gamepadLost(): boolean {
    if (this.current !== 'gamepad') return false;
    this.current = this.beforePad;
    return true;
  }
}
