export const vehicleConfig = {
  model: {
    path: 'assets/kenney_car-kit/Models/GLB format/sedan.glb',
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
    rollingDrag: 0.28,
    maxSteerDeg: 32,
    steerSpeed: 3.5,
    steerReturnHalfLife: 0.10,
    gripLimit: 12,
    slipFactor: 0.18,
  },
  suspension: {
    spring: 28,
    dampingHalfLife: 0.12,
    travel: 0.08,
  },
  lights: {
    tuning: {
      frontX: 0,
      frontY: 0,
      frontZ: 0,
      rearX: 0,
      rearY: 0,
      rearZ: 0,
    },
  },
};

export function mergeVehicleConfig(base, override = {}) {
  return {
    model: { ...base.model, ...(override.model || {}) },
    geometry: { ...base.geometry, ...(override.geometry || {}) },
    dynamics: { ...base.dynamics, ...(override.dynamics || {}) },
    suspension: { ...base.suspension, ...(override.suspension || {}) },
    lights: {
      ...base.lights,
      ...(override.lights || {}),
      tuning: {
        ...(base.lights?.tuning || {}),
        ...(override.lights?.tuning || {}),
      },
    },
  };
}
