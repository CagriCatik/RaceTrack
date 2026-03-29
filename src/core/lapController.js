import * as THREE from 'three';

const STORAGE_KEY = 'car-game.lap-times.v1';

function formatLapTime(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '--:--.--';
  const mins = Math.floor(seconds / 60);
  const secs = seconds - mins * 60;
  const secWhole = Math.floor(secs);
  const centi = Math.floor((secs - secWhole) * 100);
  return `${String(mins).padStart(2, '0')}:${String(secWhole).padStart(2, '0')}.${String(centi).padStart(2, '0')}`;
}

function loadStoredTimes() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((t) => Number.isFinite(t) && t > 0).sort((a, b) => a - b).slice(0, 5);
  } catch {
    return [];
  }
}

function saveStoredTimes(times) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(times.slice(0, 5)));
  } catch {
    // Ignore storage errors (private mode / quota).
  }
}

function checkpointIndices(waypoints) {
  if (!waypoints.length) return [];
  return [
    Math.floor(waypoints.length * 0.2),
    Math.floor(waypoints.length * 0.45),
    Math.floor(waypoints.length * 0.7),
    Math.floor(waypoints.length * 0.9),
  ];
}

export function createLapController(car, finishLine, waypoints = [], options = {}) {
  const hasGate = !!finishLine?.center && !!finishLine?.tangent && !!finishLine?.normal;
  const gateCenter = hasGate ? finishLine.center.clone() : new THREE.Vector3();
  const gateTangent = hasGate ? finishLine.tangent.clone().setY(0).normalize() : new THREE.Vector3(0, 0, 1);
  const gateNormal = hasGate ? finishLine.normal.clone().setY(0).normalize() : new THREE.Vector3(1, 0, 0);
  const gateHalfWidth = hasGate ? Math.max(0.5, finishLine.halfWidth || 3.5) : 3.5;
  const trackWidth = Math.max(2.5, options.trackWidth || 7);
  const offTrackCutDist = trackWidth * 0.64;
  const cps = checkpointIndices(waypoints);

  let lapCount = 0;
  let currentLapTime = 0;
  let lastLapTime = 0;
  let bestLapTime = Infinity;
  let lapArmed = false;
  let lapValid = true;
  let penaltyCount = 0;
  let prevAlong = 0;
  let progress = 0;
  let nearestDist = 0;
  let sampleAccumulator = 0;
  let currentLapSamples = [];
  const lapEvents = [];
  let checkpointVisited = new Set();
  let topTimes = loadStoredTimes();
  if (topTimes.length) bestLapTime = topTimes[0];

  const rel = new THREE.Vector3();
  if (hasGate) {
    rel.copy(car.group.position).sub(gateCenter);
    prevAlong = rel.dot(gateTangent);
  }

  function pushLapEvent(event) {
    lapEvents.push(event);
    while (lapEvents.length > 6) lapEvents.shift();
  }

  function nearestWaypointInfo() {
    if (!waypoints.length) return { index: 0, dist: 0 };
    let bestIdx = 0;
    let bestDistSq = Infinity;
    const pos = car.group.position;
    for (let i = 0; i < waypoints.length; i++) {
      const dSq = pos.distanceToSquared(waypoints[i]);
      if (dSq < bestDistSq) {
        bestDistSq = dSq;
        bestIdx = i;
      }
    }
    return { index: bestIdx, dist: Math.sqrt(bestDistSq) };
  }

  function update(dt) {
    currentLapTime += dt;

    const nearest = nearestWaypointInfo();
    progress = waypoints.length ? nearest.index / waypoints.length : 0;
    nearestDist = nearest.dist;

    if (waypoints.length && nearestDist > offTrackCutDist) {
      lapValid = false;
    }

    for (const idx of cps) {
      if (Math.abs(nearest.index - idx) <= 2 || Math.abs(nearest.index - idx) >= waypoints.length - 2) {
        checkpointVisited.add(idx);
      }
    }

    sampleAccumulator += dt;
    if (sampleAccumulator >= 1 / 30) {
      sampleAccumulator = 0;
      currentLapSamples.push({
        t: currentLapTime,
        x: car.group.position.x,
        y: car.group.position.y,
        z: car.group.position.z,
        heading: car.heading,
      });
    }

    if (!hasGate) return;

    rel.copy(car.group.position).sub(gateCenter);
    const along = rel.dot(gateTangent);
    const side = Math.abs(rel.dot(gateNormal));
    const insideGate = side <= gateHalfWidth + 0.85;

    if (!lapArmed && Math.abs(along) > 2.2) {
      lapArmed = true;
    }

    const crossedForward = insideGate && prevAlong < -0.2 && along >= 0.2 && car.speed > 0.8;
    if (lapArmed && crossedForward && currentLapTime >= 5) {
      const checkpointsOk = checkpointVisited.size >= cps.length;
      const isValidLap = lapValid && checkpointsOk;
      const finishedLapTime = currentLapTime;

      if (isValidLap) {
        lapCount += 1;
        lastLapTime = finishedLapTime;
        topTimes = [...topTimes, finishedLapTime].sort((a, b) => a - b).slice(0, 5);
        saveStoredTimes(topTimes);
        bestLapTime = topTimes[0] ?? bestLapTime;
      } else {
        penaltyCount += 1;
      }

      pushLapEvent({
        type: 'lap-finished',
        valid: isValidLap,
        time: finishedLapTime,
        checkpointsOk,
        best: isValidLap && Math.abs(finishedLapTime - bestLapTime) < 1e-6,
        samples: isValidLap ? currentLapSamples.slice() : [],
      });

      currentLapTime = 0;
      lapArmed = false;
      lapValid = true;
      checkpointVisited = new Set();
      currentLapSamples = [];
      sampleAccumulator = 0;
    }

    prevAlong = along;
  }

  function consumeEvents() {
    const out = lapEvents.slice();
    lapEvents.length = 0;
    return out;
  }

  return {
    update,
    consumeEvents,
    lapCount: () => lapCount,
    progress: () => progress,
    nearestDistance: () => nearestDist,
    currentLapTime: () => currentLapTime,
    lastLapTime: () => lastLapTime,
    bestLapTime: () => bestLapTime,
    topTimes: () => topTimes.slice(),
    isCurrentLapValid: () => lapValid && (cps.length === 0 || checkpointVisited.size >= cps.length),
    penaltyCount: () => penaltyCount,
    hudText: () => {
      const validState = lapValid ? 'VALID' : 'CUT';
      return `Lap ${lapCount} | ${validState} | Time ${formatLapTime(currentLapTime)} | Best ${formatLapTime(bestLapTime)} | Pen ${penaltyCount}`;
    },
    topTimesText: () => {
      if (!topTimes.length) return 'Best: --';
      return topTimes.map((t, i) => `${i + 1}.${formatLapTime(t)}`).join(' ');
    },
  };
}
