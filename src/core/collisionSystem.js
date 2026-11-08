import { createResult } from './trackPath.js';

/**
 * Two kinds of contact, both allocation-free:
 *
 *  1. Trackside props (cones, boxes, debris) — a squared-distance test against the
 *     instanced prop list, with a knock-away impulse on hit.
 *  2. The guardrails — the car is kept inside a corridor around the centre line.
 *
 * The old system looped `Box3.setFromObject()` over an obstacle array that
 * `addTrackObstacles()` always returned empty, so nothing could ever collide.
 */
export function createCollisionSystem(car, {
  propGroups = [],
  path = null,
  roadWidth = 7,
  cityCollider = null,
} = {}) {
  // Inner face of the guardrail minus half a car; see addGuardrails() for the offset.
  const corridor = roadWidth * 0.5 + 1.1;
  const nearestResult = createResult();
  let hint = -1;

  const listeners = { prop: [], wall: [] };
  const emit = (type, payload) => { for (const fn of listeners[type]) fn(payload); };

  const carRadius = () => car.collisionRadius * 0.62;

  function hitProps() {
    const pos = car.group.position;
    const px = pos.x;
    const pz = pos.z;
    const reach = carRadius();

    for (const group of propGroups) {
      for (const item of group.items) {
        // `active` props are mid-flight and `resting` ones are already knocked over.
        // Without this guard the same cone is re-hit on every physics step while the
        // car overlaps it, scrubbing ~10% of the speed 60 times a second.
        if (item.resting || item.active) continue;

        const dx = px - item.x;
        const dz = pz - item.z;
        const limit = reach + item.radius;
        if (dx * dx + dz * dz > limit * limit) continue;

        // Push it *away* from the car, along the contact normal.
        const dist = Math.max(Math.hypot(dx, dz), 1e-4);
        const impact = Math.max(Math.abs(car.speed), 1.5);
        const push = Math.min((impact * 1.2) / (0.4 + item.mass), 16);
        item.vx = (-dx / dist) * push;
        item.vz = (-dz / dist) * push;
        item.vy = 1.2 + Math.min(impact * 0.1, 2.6);
        item.spinX = (Math.random() - 0.5) * 10;
        item.spinZ = (Math.random() - 0.5) * 10;
        item.active = true;
        group.dirty = true;

        // Hitting a cone should cost momentum, not end the run.
        car.speed *= 1 - Math.min(0.42, item.mass * 0.5);
        emit('prop', { kind: group.kind, item, impact });
      }
    }
  }

  function containInCorridor() {
    if (!path) return;
    const pos = car.group.position;
    const nearest = path.nearest(pos.x, pos.z, hint, nearestResult);
    hint = nearest.segment;

    const limit = corridor - carRadius() * 0.5;
    const over = nearest.distance - limit;
    if (over <= 0) return;

    const inv = 1 / Math.max(nearest.distance, 1e-6);
    const nx = (pos.x - nearest.x) * inv;
    const nz = (pos.z - nearest.z) * inv;

    // Push back onto the track.
    pos.x -= nx * over;
    pos.z -= nz * over;

    // How square-on was the impact? Glancing blows barely cost speed.
    const sinH = Math.sin(car.heading);
    const cosH = Math.cos(car.heading);
    const normalDot = Math.abs(sinH * nx + cosH * nz);
    const absSpeed = Math.abs(car.speed);
    car.speed *= 1 - Math.min(0.55, normalDot * 0.6);

    // Steer the nose back along the rail instead of grinding into it.
    const tangentHeading = Math.atan2(nearest.tangentX, nearest.tangentZ);
    const blend = Math.min(0.35, normalDot * 0.5);
    car.heading += shortestAngle(car.heading, tangentHeading) * blend;

    if (absSpeed > 3 && normalDot > 0.15) emit('wall', { speed: absSpeed, normalDot });
  }

  /** Advances knocked props. Visual only, so it runs per rendered frame. */
  function updateProps(frameDt) {
    const dt = Math.min(frameDt, 0.05);
    for (const group of propGroups) {
      if (!group.dirty) continue;
      let anyActive = false;
      for (let i = 0; i < group.items.length; i++) {
        const item = group.items[i];
        if (!item.active) continue;

        item.vy -= 14 * dt;
        item.x += item.vx * dt;
        item.y += item.vy * dt;
        item.z += item.vz * dt;
        item.rotX += item.spinX * dt;
        item.rotZ += item.spinZ * dt;

        if (item.y <= 0) {
          item.y = 0;
          item.vy *= -0.28;
          item.vx *= 0.6;
          item.vz *= 0.6;
          item.spinX *= 0.5;
          item.spinZ *= 0.5;
          if (Math.hypot(item.vx, item.vz) < 0.25 && Math.abs(item.vy) < 0.6) {
            item.active = false;
            item.resting = true;       // knocked over: no longer collidable
            item.rotX = Math.PI * 0.5; // lying on its side
          }
        }
        if (item.active) anyActive = true;
        group.write(i, item);
      }
      group.flush();
      group.dirty = anyActive;
    }
  }

  /**
   * Free roam has no corridor, so the buildings are what stop the car. The collider
   * pushes it back out of any footprint it has entered and reports how deep the
   * contact was, which scales the speed penalty.
   */
  function hitBuildings() {
    const depth = cityCollider.resolve(car.group.position, carRadius());
    if (depth <= 0) return;
    const absSpeed = Math.abs(car.speed);
    car.speed *= 1 - Math.min(0.7, 0.25 + depth);
    if (absSpeed > 3) emit('wall', { speed: absSpeed, normalDot: Math.min(1, depth * 2) });
  }

  function update() {
    if (propGroups.length) hitProps();
    if (cityCollider) hitBuildings();
    if (path) containInCorridor();
  }

  return {
    update,
    updateProps,
    on(type, fn) { listeners[type]?.push(fn); return () => {
      const list = listeners[type];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    }; },
    trackDistance: () => nearestResult.distance,
  };
}

function shortestAngle(from, to) {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
