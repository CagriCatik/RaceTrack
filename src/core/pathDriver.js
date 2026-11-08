import * as THREE from 'three';
import { createResult } from './trackPath.js';

/**
 * Pure-pursuit driver shared by the player's autopilot and every AI rival.
 *
 * `autopilotController` and `aiRivalsController` previously carried two copies of this
 * algorithm plus their own copies of the path maths — ~250 duplicated lines that drifted
 * apart over time. One implementation, parameterised by `pace`, now serves both.
 */
export function createPathDriver(car, path, options = {}) {
  const {
    pace = 0.78,            // fraction of max speed targeted on a straight
    cornerCaution = 0.58,   // speed given up in the tightest corner
    steerDeadbandDeg = 1.0,
    lookAheadBase = 3.8,
    lookAheadPerSpeed = 0.45,
    lookAheadMax = 11.5,
    laneOffset = 0,         // metres left(+)/right(-) of the centre line
  } = options;

  const keys = new Set();
  const nearestResult = createResult();
  const aheadResult = createResult();
  const deadband = THREE.MathUtils.degToRad(steerDeadbandDeg);

  let hint = -1;
  let trackError = 0;
  let arcLength = 0;
  let lateral = 0;

  function update() {
    keys.clear();
    if (!path) return keys;

    const pos = car.group.position;
    const nearest = path.nearest(pos.x, pos.z, hint, nearestResult);
    hint = nearest.segment;
    trackError = nearest.distance;
    arcLength = nearest.s;
    lateral = nearest.side;

    const speed = Math.abs(car.speed);
    const lookAhead = Math.min(lookAheadBase + speed * lookAheadPerSpeed, lookAheadMax);
    const ahead = path.sample(nearest.s + lookAhead, aheadResult);

    // Optional racing-line offset, perpendicular to the local tangent.
    const targetX = ahead.x - nearest.tangentZ * laneOffset;
    const targetZ = ahead.z + nearest.tangentX * laneOffset;

    // World delta → car-local (+x = left, +z = forward), matching the heading convention.
    const dx = targetX - pos.x;
    const dz = targetZ - pos.z;
    const c = Math.cos(car.heading);
    const s = Math.sin(car.heading);
    const localX = dx * c - dz * s;
    const localZ = dx * s + dz * c;
    const ld2 = Math.max(localX * localX + localZ * localZ, 1e-4);

    const desiredSteer = Math.atan2(2 * car.wheelBase * localX, ld2);
    const steerNorm = Math.min(Math.abs(desiredSteer) / Math.max(car.maxSteer, 1e-4), 1);
    const severity = path.curvature(nearest.s + lookAhead, lookAhead * 0.45);

    const speedFactor = pace
      - severity * cornerCaution
      - steerNorm * 0.28
      - Math.min(trackError * 0.05, 0.2);
    const desiredSpeed = THREE.MathUtils.clamp(car.maxSpeed * speedFactor, 2.6, car.maxSpeed * pace);

    if (desiredSteer > deadband) keys.add('ArrowLeft');
    else if (desiredSteer < -deadband) keys.add('ArrowRight');

    if (car.speed < desiredSpeed - 0.35) keys.add('ArrowUp');
    else if (car.speed > desiredSpeed + 0.9 && car.speed > 1) keys.add('ArrowDown');

    if (steerNorm > 0.62 && speed > 4.6) keys.add('ArrowDown');
    if (trackError > 2.0 && speed > 3.2) keys.add('ArrowDown');
    if (speed < 0.8) { keys.delete('ArrowDown'); keys.add('ArrowUp'); }

    return keys;
  }

  return {
    update,
    keys,
    trackError: () => trackError,
    arcLength: () => arcLength,
    lateral: () => lateral,
    segment: () => hint,
    resetHint: () => { hint = -1; },
  };
}
