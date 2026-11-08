/**
 * Base vehicle definition. Every car in the catalog is a shallow override of this,
 * merged via `mergeVehicleConfig`.
 *
 * Geometry note: `wheelBase`, `trackWidth` and `wheelRadius` are *fallbacks*. When a
 * GLB loads successfully the real values are measured from its wheel nodes and written
 * back onto the vehicle, so handling always matches what you see on screen.
 */
export const vehicleConfig = {
  model: {
    /** GLB id inside the Kenney car kit (without extension). */
    id: 'sedan',
    /** Target bumper-to-bumper length in metres; the model is scaled to match. */
    bodyLength: 4.0,
  },
  geometry: {
    wheelBase: 2.0,
    trackWidth: 1.5,
    wheelRadius: 0.36,
    wheelWidth: 0.24,
    cgHeight: 0.52,
  },
  dynamics: {
    maxSpeed: 18,
    reverseSpeed: 7,
    accelRate: 11,
    engineBrake: 3.5,
    brakeRate: 18,
    handbrakeRate: 26,
    rollingDrag: 0.28,
    maxSteerDeg: 32,
    steerSpeed: 3.5,
    steerReturnHalfLife: 0.1,
    gripLimit: 12,
    slipFactor: 0.18,
  },
  suspension: {
    spring: 28,
    dampingHalfLife: 0.12,
    travel: 0.08,
  },
  lights: {
    /** Real-time lights (spots/points) — expensive, reserved for the player car. */
    realtime: true,
    /** Emissive lamp meshes — cheap, every car gets them. */
    lamps: true,
    tuning: { frontX: 0, frontY: 0, frontZ: 0, rearX: 0, rearY: 0, rearZ: 0 },
  },
  effects: {
    /** Exhaust particle count; 0 disables the system entirely. */
    exhaustParticles: 48,
  },
};

const mergeGroup = (base, override) => ({ ...base, ...(override || {}) });

export function mergeVehicleConfig(base, override = {}) {
  return {
    model: mergeGroup(base.model, override.model),
    geometry: mergeGroup(base.geometry, override.geometry),
    dynamics: mergeGroup(base.dynamics, override.dynamics),
    suspension: mergeGroup(base.suspension, override.suspension),
    lights: {
      ...mergeGroup(base.lights, override.lights),
      tuning: mergeGroup(base.lights?.tuning, override.lights?.tuning),
    },
    effects: mergeGroup(base.effects, override.effects),
  };
}
