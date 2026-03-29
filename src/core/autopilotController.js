import * as THREE from 'three';

function normalizeAngle(a) {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

function wrapDistance(d, totalLength) {
  if (totalLength <= 0) return 0;
  let value = d % totalLength;
  if (value < 0) value += totalLength;
  return value;
}

function buildClosedPath(waypoints) {
  const points = waypoints.map((wp) => new THREE.Vector3(wp.x, 0, wp.z));
  const cumulative = [0];
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    const len = points[i].distanceTo(next);
    cumulative.push(cumulative[cumulative.length - 1] + len);
  }
  return {
    points,
    cumulative,
    totalLength: cumulative[cumulative.length - 1],
  };
}

function findClosestOnPath(path, pos) {
  const { points, cumulative } = path;
  const segmentCount = points.length;
  if (segmentCount < 2) return null;

  const start = 0;
  const end = segmentCount - 1;

  let best = {
    segment: 0,
    t: 0,
    point: new THREE.Vector3(),
    distSq: Infinity,
    s: 0,
  };

  for (let i = start; i <= end; i++) {
    const a = points[i];
    const b = points[(i + 1) % segmentCount];
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(pos, a);
    const denom = Math.max(ab.lengthSq(), 1e-6);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / denom, 0, 1);
    const point = a.clone().addScaledVector(ab, t);
    const distSq = point.distanceToSquared(pos);
    if (distSq < best.distSq) {
      best = {
        segment: i,
        t,
        point,
        distSq,
        s: cumulative[i] + ab.length() * t,
      };
    }
  }

  return best;
}

function samplePath(path, distanceAlongPath) {
  const { points, cumulative, totalLength } = path;
  const segmentCount = points.length;
  const s = wrapDistance(distanceAlongPath, totalLength);
  let i = 0;
  while (i < segmentCount - 1 && cumulative[i + 1] < s) i += 1;
  const segStart = cumulative[i];
  const segEnd = cumulative[i + 1];
  const segLen = Math.max(segEnd - segStart, 1e-6);
  const t = THREE.MathUtils.clamp((s - segStart) / segLen, 0, 1);
  const a = points[i];
  const b = points[(i + 1) % segmentCount];
  return {
    segment: i,
    point: a.clone().lerp(b, t),
  };
}

function localTarget(vehiclePos, vehicleHeading, worldTarget) {
  const dx = worldTarget.x - vehiclePos.x;
  const dz = worldTarget.z - vehiclePos.z;
  const c = Math.cos(vehicleHeading);
  const s = Math.sin(vehicleHeading);
  return {
    x: dx * c - dz * s, // +right
    z: dx * s + dz * c, // +forward
  };
}

function cornerSeverity(path, s, lookAheadDist) {
  const sampleSpan = Math.max(2.5, lookAheadDist * 0.45);
  const p0 = samplePath(path, s + lookAheadDist - sampleSpan).point;
  const p1 = samplePath(path, s + lookAheadDist).point;
  const p2 = samplePath(path, s + lookAheadDist + sampleSpan).point;
  const a = new THREE.Vector3().subVectors(p1, p0).normalize();
  const b = new THREE.Vector3().subVectors(p2, p1).normalize();
  const dot = THREE.MathUtils.clamp(a.dot(b), -1, 1);
  const angle = Math.acos(dot);
  return THREE.MathUtils.clamp(angle / (Math.PI * 0.6), 0, 1);
}

export function createAutopilotController(car, waypoints = []) {
  const controlKeys = new Set();
  const hasPath = Array.isArray(waypoints) && waypoints.length >= 3;
  const path = hasPath ? buildClosedPath(waypoints) : null;

  let enabled = false;
  let toggleHeld = false;
  let currentSegment = 0;
  let currentWaypoint = 0;
  let lastTrackError = 0;

  function update(_dt, manualKeys) {
    const togglePressed = manualKeys.has('KeyP');
    if (togglePressed && !toggleHeld) enabled = !enabled;
    toggleHeld = togglePressed;

    if (!enabled || !path) return manualKeys;

    const pos = car.group.position;
    const nearest = findClosestOnPath(path, pos);
    if (!nearest) return manualKeys;

    currentSegment = nearest.segment;
    currentWaypoint = nearest.segment;
    lastTrackError = Math.sqrt(nearest.distSq);

    const speed = Math.abs(car.speed);
    const lookAheadDist = THREE.MathUtils.clamp(3.8 + speed * 0.45, 3.8, 11.5);
    const lookAheadSample = samplePath(path, nearest.s + lookAheadDist);
    const targetLocal = localTarget(pos, car.heading, lookAheadSample.point);
    const ld2 = Math.max(targetLocal.x * targetLocal.x + targetLocal.z * targetLocal.z, 1e-4);

    // Vehicle keyboard steering is inverted (left key yields positive steer angle), so keep pure-pursuit sign direct.
    const desiredSteer = Math.atan2(2 * car.wheelBase * targetLocal.x, ld2);
    const steerNorm = THREE.MathUtils.clamp(Math.abs(desiredSteer) / Math.max(car.maxSteer, 1e-4), 0, 1);
    const curveSeverity = cornerSeverity(path, nearest.s, lookAheadDist);

    const desiredSpeed = THREE.MathUtils.clamp(
      car.maxSpeed * (0.82 - curveSeverity * 0.58 - steerNorm * 0.28 - Math.min(lastTrackError * 0.05, 0.20)),
      2.8,
      car.maxSpeed * 0.78
    );

    controlKeys.clear();
    const steerDeadband = THREE.MathUtils.degToRad(1.0);
    if (desiredSteer > steerDeadband) controlKeys.add('ArrowLeft');
    if (desiredSteer < -steerDeadband) controlKeys.add('ArrowRight');

    if (car.speed < desiredSpeed - 0.35) {
      controlKeys.add('ArrowUp');
    } else if (car.speed > desiredSpeed + 0.9 && car.speed > 1.0) {
      controlKeys.add('ArrowDown');
    }

    if (steerNorm > 0.62 && speed > 4.6) controlKeys.add('ArrowDown');
    if (lastTrackError > 2.0 && speed > 3.2) controlKeys.add('ArrowDown');
    if (speed < 0.8) controlKeys.add('ArrowUp');

    return controlKeys;
  }

  return {
    update,
    isEnabled: () => enabled,
    currentWaypointIndex: () => currentWaypoint,
    lateralError: () => lastTrackError,
  };
}
