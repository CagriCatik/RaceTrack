/**
 * Single source of truth for which Kenney car-kit assets the game uses.
 *
 * The kit ships three model formats; only `GLB format` is loaded at runtime
 * (FBX/OBJ are kept in the repo as source material but never fetched).
 * `Previews/<id>.png` are the thumbnails rendered on the start screen.
 */
const GLB_DIR = 'assets/kenney_car-kit/Models/GLB format';
const PREVIEW_DIR = 'assets/kenney_car-kit/Previews';

export const modelPath = (id) => `${GLB_DIR}/${id}.glb`;
export const previewPath = (id) => `${PREVIEW_DIR}/${id}.png`;

/** Cars the player can pick on the start screen. */
export const PLAYABLE_CARS = [
  {
    id: 'sedan',
    name: 'Sedan',
    klass: 'Straße',
    bodyLength: 4.0,
    dynamics: { maxSpeed: 18, accelRate: 11, gripLimit: 12, maxSteerDeg: 32 },
  },
  {
    id: 'sedan-sports',
    name: 'Sedan Sport',
    klass: 'Sport',
    bodyLength: 4.1,
    dynamics: { maxSpeed: 21, accelRate: 13, gripLimit: 13.5, maxSteerDeg: 31 },
  },
  {
    id: 'hatchback-sports',
    name: 'Hot Hatch',
    klass: 'Sport',
    bodyLength: 3.7,
    dynamics: { maxSpeed: 20, accelRate: 13.5, gripLimit: 13, maxSteerDeg: 34 },
  },
  {
    id: 'race',
    name: 'GT Racer',
    klass: 'Rennen',
    bodyLength: 4.3,
    dynamics: { maxSpeed: 26, accelRate: 16, gripLimit: 16, maxSteerDeg: 30, slipFactor: 0.22 },
    suspension: { spring: 36, travel: 0.05 },
  },
  {
    id: 'race-future',
    name: 'Concept X',
    klass: 'Rennen',
    bodyLength: 4.4,
    dynamics: { maxSpeed: 28, accelRate: 17.5, gripLimit: 17, maxSteerDeg: 28, slipFactor: 0.14 },
    suspension: { spring: 40, travel: 0.04 },
  },
  {
    id: 'kart-oozi',
    name: 'Kart',
    klass: 'Kart',
    bodyLength: 2.3,
    dynamics: { maxSpeed: 15, accelRate: 15, gripLimit: 15, maxSteerDeg: 40, slipFactor: 0.26 },
    suspension: { spring: 44, travel: 0.03 },
  },
  {
    id: 'police',
    name: 'Police',
    klass: 'Einsatz',
    bodyLength: 4.2,
    dynamics: { maxSpeed: 20, accelRate: 12, gripLimit: 12.5, maxSteerDeg: 31 },
  },
  {
    id: 'taxi',
    name: 'Taxi',
    klass: 'Straße',
    bodyLength: 4.1,
    dynamics: { maxSpeed: 17, accelRate: 10, gripLimit: 11.5, maxSteerDeg: 32 },
  },
  {
    id: 'suv',
    name: 'SUV',
    klass: 'Offroad',
    bodyLength: 4.4,
    dynamics: { maxSpeed: 17, accelRate: 10, gripLimit: 10, maxSteerDeg: 33 },
    suspension: { spring: 22, travel: 0.12 },
  },
  {
    id: 'suv-luxury',
    name: 'SUV Luxury',
    klass: 'Offroad',
    bodyLength: 4.6,
    dynamics: { maxSpeed: 18.5, accelRate: 11, gripLimit: 10.5, maxSteerDeg: 32 },
    suspension: { spring: 24, travel: 0.11 },
  },
  {
    id: 'van',
    name: 'Van',
    klass: 'Nutzfahrzeug',
    bodyLength: 4.5,
    dynamics: { maxSpeed: 15.5, accelRate: 8.5, gripLimit: 9, maxSteerDeg: 30 },
    suspension: { spring: 20, travel: 0.13 },
  },
  {
    id: 'truck',
    name: 'Truck',
    klass: 'Nutzfahrzeug',
    bodyLength: 5.2,
    dynamics: { maxSpeed: 14, accelRate: 7.5, gripLimit: 8.5, maxSteerDeg: 28 },
    suspension: { spring: 18, travel: 0.14 },
  },
  {
    id: 'firetruck',
    name: 'Firetruck',
    klass: 'Einsatz',
    bodyLength: 5.6,
    dynamics: { maxSpeed: 13.5, accelRate: 7, gripLimit: 8, maxSteerDeg: 27 },
    suspension: { spring: 18, travel: 0.14 },
  },
  {
    id: 'tractor',
    name: 'Tractor',
    klass: 'Spaß',
    bodyLength: 3.6,
    dynamics: { maxSpeed: 9, accelRate: 6, gripLimit: 8, maxSteerDeg: 38 },
    suspension: { spring: 16, travel: 0.16 },
  },
];

/** AI opponents. `pace` is the fraction of their own top speed they aim for. */
export const RIVAL_CARS = [
  { id: 'police', name: 'Police', pace: 0.74, dynamics: { maxSpeed: 19.5 } },
  { id: 'race', name: 'GT Racer', pace: 0.7, dynamics: { maxSpeed: 22 } },
  { id: 'taxi', name: 'Taxi', pace: 0.68, dynamics: { maxSpeed: 17.5 } },
  { id: 'delivery', name: 'Delivery', pace: 0.64, dynamics: { maxSpeed: 16 } },
];

/** Trackside props, also from the kit. `radius` drives collision. */
export const PROP_KINDS = {
  cone: { id: 'cone', scale: 1.0, radius: 0.34, knockable: true, mass: 0.2 },
  coneFlat: { id: 'cone-flat', scale: 1.0, radius: 0.3, knockable: true, mass: 0.15 },
  box: { id: 'box', scale: 1.0, radius: 0.46, knockable: true, mass: 0.6 },
  tire: { id: 'debris-tire', scale: 1.0, radius: 0.36, knockable: true, mass: 0.4 },
  bumper: { id: 'debris-bumper', scale: 1.0, radius: 0.4, knockable: true, mass: 0.3 },
  spoiler: { id: 'debris-spoiler-a', scale: 1.0, radius: 0.34, knockable: true, mass: 0.25 },
};

export const DEFAULT_CAR_ID = 'sedan';

export function findPlayableCar(id) {
  return PLAYABLE_CARS.find((c) => c.id === id) ?? PLAYABLE_CARS[0];
}

/** Turns a catalog entry into a `mergeVehicleConfig` override object. */
export function carConfigOverride(entry, extra = {}) {
  return {
    model: { id: entry.id, bodyLength: entry.bodyLength ?? 4.0 },
    dynamics: { ...(entry.dynamics || {}), ...(extra.dynamics || {}) },
    suspension: { ...(entry.suspension || {}), ...(extra.suspension || {}) },
    lights: { ...(entry.lights || {}), ...(extra.lights || {}) },
    effects: { ...(entry.effects || {}), ...(extra.effects || {}) },
  };
}
