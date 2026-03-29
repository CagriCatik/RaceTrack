import * as THREE from 'three';

function wrapDistance(d, totalLength) {
  if (totalLength <= 0) return 0;
  let value = d % totalLength;
  if (value < 0) value += totalLength;
  return value;
}

function buildPath(waypoints) {
  const points = waypoints.map((wp) => new THREE.Vector3(wp.x, 0, wp.z));
  const cumulative = [0];
  for (let i = 0; i < points.length; i++) {
    const next = points[(i + 1) % points.length];
    cumulative.push(cumulative[cumulative.length - 1] + points[i].distanceTo(next));
  }
  return {
    points,
    cumulative,
    totalLength: cumulative[cumulative.length - 1],
  };
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

function nearestPointOnPath(path, pos) {
  const { points, cumulative } = path;
  const segmentCount = points.length;
  let best = { segment: 0, s: 0, distSq: Infinity };
  for (let i = 0; i < segmentCount; i++) {
    const a = points[i];
    const b = points[(i + 1) % segmentCount];
    const ab = new THREE.Vector3().subVectors(b, a);
    const ap = new THREE.Vector3().subVectors(pos, a);
    const t = THREE.MathUtils.clamp(ap.dot(ab) / Math.max(ab.lengthSq(), 1e-6), 0, 1);
    const closest = a.clone().addScaledVector(ab, t);
    const dSq = closest.distanceToSquared(pos);
    if (dSq < best.distSq) {
      best = {
        segment: i,
        s: cumulative[i] + ab.length() * t,
        distSq: dSq,
      };
    }
  }
  return best;
}

function localTarget(vehiclePos, vehicleHeading, worldTarget) {
  const dx = worldTarget.x - vehiclePos.x;
  const dz = worldTarget.z - vehiclePos.z;
  const c = Math.cos(vehicleHeading);
  const s = Math.sin(vehicleHeading);
  return {
    x: dx * c - dz * s,
    z: dx * s + dz * c,
  };
}

export function createAIRivalsController(rivals, waypoints = []) {
  const path = waypoints.length >= 3 ? buildPath(waypoints) : null;
  let enabled = true;

  const rivalStates = rivals.map((rival, i) => ({
    rival,
    pace: THREE.MathUtils.clamp(rival.pace ?? (0.66 + i * 0.07), 0.55, 0.92),
    keys: new Set(),
    trackError: 0,
  }));

  function update(dt) {
    if (!enabled || !path) return;
    for (const state of rivalStates) {
      const { rival, keys, pace } = state;
      const pos = rival.group.position;
      const nearest = nearestPointOnPath(path, pos);
      state.trackError = Math.sqrt(nearest.distSq);

      const speed = Math.abs(rival.speed);
      const lookAheadDist = THREE.MathUtils.clamp(3.6 + speed * 0.38, 3.6, 10.8);
      const lookAhead = samplePath(path, nearest.s + lookAheadDist).point;
      const targetLocal = localTarget(pos, rival.heading, lookAhead);
      const ld2 = Math.max(targetLocal.x * targetLocal.x + targetLocal.z * targetLocal.z, 1e-4);
      const desiredSteer = Math.atan2(2 * rival.wheelBase * targetLocal.x, ld2);
      const steerNorm = THREE.MathUtils.clamp(Math.abs(desiredSteer) / Math.max(rival.maxSteer, 1e-4), 0, 1);

      const desiredSpeed = THREE.MathUtils.clamp(
        rival.maxSpeed * (pace - steerNorm * 0.30 - Math.min(state.trackError * 0.04, 0.2)),
        2.6,
        rival.maxSpeed * pace
      );

      keys.clear();
      if (desiredSteer > THREE.MathUtils.degToRad(1.1)) keys.add('ArrowLeft');
      if (desiredSteer < -THREE.MathUtils.degToRad(1.1)) keys.add('ArrowRight');
      if (rival.speed < desiredSpeed - 0.3) keys.add('ArrowUp');
      else if (rival.speed > desiredSpeed + 0.8 && rival.speed > 1.0) keys.add('ArrowDown');
      if (steerNorm > 0.65 && speed > 4.5) keys.add('ArrowDown');
      if (state.trackError > 2.2 && speed > 3.0) keys.add('ArrowDown');
      if (speed < 0.8) keys.add('ArrowUp');

      rival.update(dt, keys);
    }
  }

  return {
    update,
    isEnabled: () => enabled,
    setEnabled: (next) => { enabled = !!next; },
    rivals: rivalStates.map((s) => s.rival),
  };
}
