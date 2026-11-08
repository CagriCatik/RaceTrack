import { createPathDriver } from './pathDriver.js';

/**
 * Player-car autopilot: a `pathDriver` behind a toggle.
 *
 * The toggle is driven from the render step (see `main.js`), not from here: this
 * `update` runs inside the fixed physics step, and on a 144 Hz display a frame often
 * runs zero physics steps — a key tapped in such a frame would be cleared by
 * `endFrame()` before any step ever saw it.
 */
export function createAutopilotController(car, path) {
  const driver = path ? createPathDriver(car, path, { pace: 0.82 }) : null;
  let enabled = false;

  function update(_dt, manualKeys) {
    if (!enabled || !driver) return manualKeys;
    return driver.update();
  }

  return {
    update,
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = !!next;
      if (enabled) driver?.resetHint();
    },
    toggle() {
      this.setEnabled(!enabled);
      return enabled;
    },
    currentWaypointIndex: () => driver?.segment() ?? 0,
    lateralError: () => driver?.trackError() ?? 0,
  };
}
