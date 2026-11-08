import { createPathDriver } from './pathDriver.js';
import { createResult } from './trackPath.js';

/** Distinct lanes so the field does not drive in single file. */
const LANES = [1.5, -1.5, 0.6, -0.6];

/**
 * Drives every rival with the shared pure-pursuit driver, plus a one-dimensional
 * "car ahead" check: rivals have no mutual collision, so without it they converge on
 * the same racing line and stack into one another at the first corner.
 */
export function createAIRivalsController(rivals, path, playerCar = null) {
  let enabled = true;

  const states = rivals.map((rival, i) => ({
    rival,
    lane: rival.laneOffset ?? LANES[i % LANES.length],
    driver: createPathDriver(rival, path, {
      pace: rival.pace ?? 0.68 + i * 0.03,
      laneOffset: rival.laneOffset ?? LANES[i % LANES.length],
      steerDeadbandDeg: 1.1,
      lookAheadBase: 3.6,
      lookAheadPerSpeed: 0.38,
      lookAheadMax: 10.8,
    }),
    s: 0,
  }));

  const playerResult = createResult();
  let playerHint = -1;
  const half = path.totalLength * 0.5;

  /** Signed gap from a to b along the lap, in [-half, +half]. */
  function gapAhead(from, to) {
    let delta = to - from;
    if (delta > half) delta -= path.totalLength;
    if (delta < -half) delta += path.totalLength;
    return delta;
  }

  function update(dt) {
    if (!enabled) return;

    let playerS = null;
    if (playerCar) {
      const pos = playerCar.group.position;
      const nearest = path.nearest(pos.x, pos.z, playerHint, playerResult);
      playerHint = nearest.segment;
      playerS = nearest.s;
    }

    for (const state of states) {
      const keys = state.driver.update();
      state.s = state.driver.arcLength();

      // Lift off / brake when something sits just ahead in the same lane.
      let blocked = false;
      for (const other of states) {
        if (other === state) continue;
        const gap = gapAhead(state.s, other.s);
        if (gap > 0 && gap < 5 && Math.abs(other.lane - state.lane) < 1.1) { blocked = true; break; }
      }
      if (!blocked && playerS !== null) {
        const gap = gapAhead(state.s, playerS);
        if (gap > 0 && gap < 4.5) blocked = true;
      }
      if (blocked) {
        keys.delete('ArrowUp');
        if (Math.abs(state.rival.speed) > 3) keys.add('ArrowDown');
      }

      state.rival.update(dt, keys);
    }
  }

  function updateVisuals(frameDt) {
    if (!enabled) return;
    for (const state of states) state.rival.updateVisuals(frameDt);
  }

  return {
    update,
    updateVisuals,
    isEnabled: () => enabled,
    setEnabled(next) {
      enabled = !!next;
      for (const state of states) {
        state.rival.group.visible = enabled;
        if (enabled) state.driver.resetHint();
        else state.rival.speed = 0;
      }
    },
    rivals: states.map((s) => s.rival),
    trackErrors: () => states.map((s) => s.driver.trackError()),
  };
}
