/**
 * City assets: Kenney "Starter Kit: City Builder" (CC0).
 * https://github.com/KenneyNL/Starter-Kit-City-Builder
 *
 * Every model is a 1x1 unit tile that already carries its own base plate, so the
 * pieces butt up against each other without seams. `TILE` scales one of those units
 * to metres — at 8 m a four-storey building ends up ~14 m tall next to a 4 m car.
 */
const CITY_DIR = 'assets/kenney_city-kit/Models';

export const cityModelPath = (id) => `${CITY_DIR}/${id}.glb`;

/** One grid cell in metres. */
export const TILE = 8;

/**
 * The kit's tiles are base plates: a road surface sits 0.05 units up, a pavement or
 * grass plate 0.06. At TILE = 8 that is a 40 cm step, so the whole city is dropped by
 * the road height. Road surfaces then land at y = 0 (drivable), and pavements end up
 * 8 cm proud — which reads as a real kerb you can bump over.
 */
export const ROAD_PLATE = 0.05;
export const CITY_Y = -ROAD_PLATE * TILE;

/** Buildings, with the weight used when picking one for a block cell. */
export const BUILDINGS = [
  { id: 'building-small-a', weight: 3, height: 0.95 },
  { id: 'building-small-b', weight: 3, height: 1.63 },
  { id: 'building-small-c', weight: 2, height: 1.75 },
  { id: 'building-small-d', weight: 3, height: 1.0 },
  { id: 'building-garage', weight: 1, height: 0.55 },
];

export const GREEN = [
  { id: 'grass', weight: 2 },
  { id: 'grass-trees', weight: 3 },
  { id: 'grass-trees-tall', weight: 2 },
];

export const GROUND = {
  pavement: 'pavement',
  fountain: 'pavement-fountain',
  grass: 'grass',
};

/**
 * Road tiles and which cell edges they connect, in the model's own orientation.
 * Directions: N = -Z, E = +X, S = +Z, W = -X.
 *
 * Verified by rendering each tile top-down:
 *   straight      connects N+S (the dashes run along Z)
 *   corner        connects W+S
 *   split (T)     connects W+E+S, i.e. the open side missing is N
 *   intersection  connects all four
 */
export const ROADS = {
  straight: 'road-straight',
  straightLights: 'road-straight-lightposts',
  corner: 'road-corner',
  split: 'road-split',
  intersection: 'road-intersection',
};

/** Every id the city scenario needs loaded up front. */
export const CITY_MODEL_IDS = [
  ...BUILDINGS.map((b) => b.id),
  ...GREEN.map((g) => g.id),
  ...Object.values(GROUND),
  ...Object.values(ROADS),
];

/**
 * Clearances are measured from the *centre line* to a cell's centre, so they have to
 * allow for the tile's half-diagonal, not its half-width: an 8 m square reaches
 * 5.66 m from its centre at the corners. Every tile also stands ~0.48 m proud of the
 * ground (the kit's base plates), so a tile overlapping the tarmac would put a step
 * on the racing line.
 *
 *   track half-width 3.5 + half-diagonal 5.66  ->  trackClear must exceed ~9.2
 *   guardrail 4.85  + building half-diagonal   ->  blocks must start past ~12
 */
/**
 * Free roam: no circuit at all, so the grid fills the whole area and the clearances
 * that keep tiles off the racing line are irrelevant.
 */
export const FREEROAM_LAYOUT = {
  radiusX: 112,
  radiusZ: 112,
  centerZ: 0,
  trackClear: 0,
  sidewalk: 0,
  streetEvery: 4,
  greenChance: 0.18,
  falloffStart: 999,
  /** Blocks this far out are parkland instead of buildings, to open up the horizon. */
  parkRing: 86,
  /** Share of straight road tiles that carry lamp posts. */
  lampChance: 0.6,
};

export const CITY_LAYOUT = {
  /** Half-extent of the built-up area in metres, measured from the track centre. */
  radiusX: 76,
  radiusZ: 68,
  /** Centre of the city grid (matches the track centre). */
  centerZ: 10,
  /** Nothing at all within this distance of the centre line. */
  trackClear: 10.5,
  /** Pavement ring between `trackClear` and here; blocks start beyond it. */
  sidewalk: 15,
  /** Every n-th grid line is a street. A value of 5 gives 4x4-cell blocks. */
  streetEvery: 5,
  /** Chance a non-street block cell becomes green space instead of a building. */
  greenChance: 0.24,
  /** Cells further than this from the track are thinned out to save triangles. */
  falloffStart: 50,
};
