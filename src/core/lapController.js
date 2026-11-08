import * as THREE from 'three';
import { createResult } from './trackPath.js';

const STORAGE_KEY = 'racetrack.lap-times.v2';
const CHECKPOINTS = 4;

export function formatLapTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--.--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const whole = Math.floor(secs);
  const centi = Math.floor((secs - whole) * 100);
  return `${String(mins).padStart(2, '0')}:${String(whole).padStart(2, '0')}.${String(centi).padStart(2, '0')}`;
}

function loadStoredTimes() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b).slice(0, 5);
  } catch {
    return [];
  }
}

function saveStoredTimes(times) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(times.slice(0, 5)));
  } catch { /* quota / private mode */ }
}

/**
 * Lap timing, validity and ghost sampling.
 *
 * Progress and the off-track check now ride on the shared `trackPath` (a windowed
 * search against the *centre line*) instead of a full O(n) scan over the weaving
 * racing line on every physics step.
 */
export function createLapController(car, finishLine, path, options = {}) {
  const trackWidth = Math.max(2.5, options.trackWidth || 7);
  const offTrackCut = trackWidth * 0.62;

  const gateCenter = finishLine.center.clone();
  const gateTangent = finishLine.tangent.clone().setY(0).normalize();
  const gateNormal = finishLine.normal.clone().setY(0).normalize();
  const gateHalfWidth = Math.max(0.5, finishLine.halfWidth || 3.5);

  const nearestResult = createResult();
  const rel = new THREE.Vector3();
  let hint = -1;

  let lapCount = 0;
  let currentLapTime = 0;
  let lastLapTime = 0;
  let bestLapTime = Infinity;
  let lapArmed = false;
  let lapValid = true;
  let penaltyCount = 0;
  let prevAlong = 0;
  let progress = 0;
  let trackDistance = 0;
  let sampleAccumulator = 0;
  let samples = [];
  const events = [];
  const visited = new Set();

  let topTimes = loadStoredTimes();
  if (topTimes.length) bestLapTime = topTimes[0];

  rel.copy(car.group.position).sub(gateCenter);
  prevAlong = rel.dot(gateTangent);

  function update(dt) {
    currentLapTime += dt;

    const pos = car.group.position;
    const nearest = path.nearest(pos.x, pos.z, hint, nearestResult);
    hint = nearest.segment;
    trackDistance = nearest.distance;
    progress = nearest.s / path.totalLength;

    if (trackDistance > offTrackCut) lapValid = false;

    // Sector checkpoints: you must pass through all of them for a lap to count.
    visited.add(Math.min(CHECKPOINTS - 1, Math.floor(progress * CHECKPOINTS)));

    sampleAccumulator += dt;
    if (sampleAccumulator >= 1 / 30) {
      sampleAccumulator = 0;
      samples.push({
        t: currentLapTime,
        x: pos.x,
        y: pos.y,
        z: pos.z,
        heading: car.heading,
      });
    }

    rel.copy(pos).sub(gateCenter);
    const along = rel.dot(gateTangent);
    const side = Math.abs(rel.dot(gateNormal));
    const insideGate = side <= gateHalfWidth + 0.85;

    if (!lapArmed && Math.abs(along) > 2.2) lapArmed = true;

    // Plain sign change, not a ±0.2 m band: at 38 km/h a 60 Hz step advances ~0.18 m,
    // so the car stepped straight over the old window and a lap was never registered.
    const delta = along - prevAlong;
    const crossed = insideGate
      && prevAlong < 0 && along >= 0
      && delta > 0.005 && delta < 5   // delta < 5 rejects a teleport/reset
      && car.speed > 0.8;
    if (lapArmed && crossed && currentLapTime >= 5) finishLap();

    prevAlong = along;
  }

  function finishLap() {
    const checkpointsOk = visited.size >= CHECKPOINTS;
    const isValid = lapValid && checkpointsOk;
    const time = currentLapTime;
    let isBest = false;

    if (isValid) {
      lapCount += 1;
      lastLapTime = time;
      isBest = time < bestLapTime;
      topTimes = [...topTimes, time].sort((a, b) => a - b).slice(0, 5);
      saveStoredTimes(topTimes);
      bestLapTime = topTimes[0];
    } else {
      penaltyCount += 1;
    }

    events.push({
      type: 'lap-finished',
      valid: isValid,
      best: isBest,
      time,
      checkpointsOk,
      samples: isValid ? samples : [],
    });
    while (events.length > 6) events.shift();

    currentLapTime = 0;
    lapArmed = false;
    lapValid = true;
    visited.clear();
    samples = [];
    sampleAccumulator = 0;
  }

  /** Called after a manual reset so the in-flight lap is not scored. */
  function invalidateLap() {
    lapValid = false;
  }

  function restartLap() {
    currentLapTime = 0;
    lapValid = true;
    lapArmed = false;
    visited.clear();
    samples = [];
    hint = -1;
    rel.copy(car.group.position).sub(gateCenter);
    prevAlong = rel.dot(gateTangent);
  }

  return {
    update,
    invalidateLap,
    restartLap,
    consumeEvents() {
      const out = events.slice();
      events.length = 0;
      return out;
    },
    lapCount: () => lapCount,
    progress: () => progress,
    trackDistance: () => trackDistance,
    currentLapTime: () => currentLapTime,
    lastLapTime: () => lastLapTime,
    bestLapTime: () => bestLapTime,
    topTimes: () => topTimes.slice(),
    isCurrentLapValid: () => lapValid,
    penaltyCount: () => penaltyCount,
    currentTimeText: () => formatLapTime(currentLapTime),
    bestTimeText: () => formatLapTime(bestLapTime),
  };
}
