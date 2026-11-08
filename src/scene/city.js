import * as THREE from 'three';
import { flattenToGeometry, loadModel } from '../core/assetLoader.js';
import { buildInstances } from '../core/instancing.js';
import {
  BUILDINGS, CITY_LAYOUT, CITY_MODEL_IDS, CITY_Y, GREEN, GROUND, ROADS, TILE, cityModelPath,
} from '../config/cityCatalog.js';

/**
 * Turns the country circuit into a street circuit.
 *
 * The whole city is laid out on a grid of 1x1 Kenney tiles scaled to `TILE` metres.
 * For every cell we ask the track's centre line how far away it is and classify it:
 *
 *   on the racing surface   -> leave empty (the track mesh is already there)
 *   just alongside          -> sidewalk
 *   further out             -> city block: street, building, or green space
 *   inside the oval         -> park with a fountain, so the infield stays open
 *
 * Streets are auto-tiled: each road cell looks at its four neighbours and picks
 * straight / corner / T / crossroads with the right rotation, so the grid closes up
 * properly where it runs into the circuit.
 */

// Direction bits: N = -Z, E = +X, S = +Z, W = -X
const N = 1, E = 2, S = 4, W = 8;

/** rotY(+90°) maps N->W, E->N, S->E, W->S. */
function rotateMask(mask, quarterTurns) {
  let out = mask;
  for (let i = 0; i < ((quarterTurns % 4) + 4) % 4; i++) {
    let next = 0;
    if (out & N) next |= W;
    if (out & E) next |= N;
    if (out & S) next |= E;
    if (out & W) next |= S;
    out = next;
  }
  return out;
}

const ROAD_BASE = [
  { kind: 'intersection', mask: N | E | S | W },
  { kind: 'split', mask: W | E | S },
  { kind: 'corner', mask: W | S },
  { kind: 'straight', mask: N | S },
];

/** mask -> { kind, quarterTurns }, precomputed for all 16 neighbour combinations. */
const ROAD_LOOKUP = (() => {
  const table = new Map();
  for (const { kind, mask } of ROAD_BASE) {
    for (let turns = 0; turns < 4; turns++) {
      const rotated = rotateMask(mask, turns);
      if (!table.has(rotated)) table.set(rotated, { kind, quarterTurns: turns });
    }
  }
  return table;
})();

function roadPieceFor(mask) {
  const exact = ROAD_LOOKUP.get(mask);
  if (exact) return exact;
  // Dead ends and lone cells: fall back to a straight along whichever axis is open.
  if (mask & (E | W)) return { kind: 'straight', quarterTurns: 1 };
  return { kind: 'straight', quarterTurns: 0 };
}

/** Deterministic hash so the city looks the same on every reload. */
function hash2(x, y) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function pickWeighted(list, roll) {
  const total = list.reduce((sum, item) => sum + item.weight, 0);
  let acc = roll * total;
  for (const item of list) {
    acc -= item.weight;
    if (acc <= 0) return item;
  }
  return list[list.length - 1];
}

/**
 * @param {THREE.Scene} scene
 * @param {object|null} centerPath  track centre line, or null for free roam
 * @param {object} options          layout overrides
 */
export async function addCity(scene, centerPath, options = {}) {
  const layout = { ...CITY_LAYOUT, ...options };
  const freeRoam = !centerPath;

  // ── Load every tile once and flatten it for instancing
  const assets = new Map();
  await Promise.all(CITY_MODEL_IDS.map(async (id) => {
    try {
      const model = await loadModel(cityModelPath(id));
      const flat = flattenToGeometry(model);
      if (flat) assets.set(id, flat);
    } catch (err) {
      console.warn(`[city] could not load ${id}`, err);
    }
  }));

  if (!assets.size) {
    console.warn('[city] no city models available, skipping city build');
    return { group: new THREE.Group(), stats: { cells: 0 } };
  }

  const cols = Math.floor(layout.radiusX / TILE);
  const rows = Math.floor(layout.radiusZ / TILE);
  const centerZ = layout.centerZ;

  // ── Pass 1: classify every cell
  const cells = new Map();
  const key = (gx, gz) => `${gx},${gz}`;

  for (let gx = -cols; gx <= cols; gx++) {
    for (let gz = -rows; gz <= rows; gz++) {
      const x = gx * TILE;
      const z = centerZ + gz * TILE;

      let distance = Infinity;
      let inside = false;

      if (!freeRoam) {
        const near = centerPath.nearest(x, z, -1);
        distance = near.distance;
        if (distance < layout.trackClear) continue; // racing surface

        // Inside the oval? Compare the radius of the point and of its centre-line hit
        // against the track centroid — exact enough for a star-shaped circuit.
        inside = Math.hypot(x, z - centerZ) < Math.hypot(near.x, near.z - centerZ);

        // Thin out the far edges so the skyline fades instead of ending in a wall.
        if (distance > layout.falloffStart) {
          const fade = (distance - layout.falloffStart) / 26;
          if (hash2(gx + 101, gz - 57) < fade) continue;
        }
      }

      cells.set(key(gx, gz), { gx, gz, x, z, distance, inside, type: 'block' });
    }
  }

  // ── Pass 2: assign roles
  // Order matters: the infield is never more than ~12 m from the centre line, so a
  // sidewalk test placed first would swallow the whole park.
  for (const cell of cells.values()) {
    const onStreet = cell.gx % layout.streetEvery === 0 || cell.gz % layout.streetEvery === 0;

    if (freeRoam) {
      // Open parkland past `parkRing` keeps the skyline from ending in a wall of
      // facades, and gives the free-roam map somewhere to actually go.
      const radius = Math.hypot(cell.x, cell.z - centerZ);
      if (onStreet) cell.type = 'street';
      else if (layout.parkRing && radius > layout.parkRing) cell.type = 'park';
      else cell.type = 'block';
      continue;
    }

    if (cell.inside) {
      cell.type = 'park';
      continue;
    }
    if (cell.distance < layout.sidewalk) {
      cell.type = 'sidewalk';
      continue;
    }
    cell.type = onStreet ? 'street' : 'block';
  }

  // A single fountain marks the middle: the circuit infield, or the town square.
  let fountainCell = null;
  let bestR = Infinity;
  for (const cell of cells.values()) {
    if (freeRoam ? cell.type !== 'block' : cell.type !== 'park') continue;
    const r = Math.hypot(cell.x, cell.z - centerZ);
    if (r < bestR) { bestR = r; fountainCell = cell; }
  }
  if (fountainCell) fountainCell.type = 'fountain';

  // ── Pass 3: emit placements
  const placements = new Map(); // model id -> placement[]
  const push = (id, placement) => {
    if (!assets.has(id)) return;
    if (!placements.has(id)) placements.set(id, []);
    placements.get(id).push(placement);
  };

  const isStreet = (gx, gz) => cells.get(key(gx, gz))?.type === 'street';
  const stats = { street: 0, building: 0, green: 0, sidewalk: 0, park: 0 };

  const solids = [];      // building footprints, for free-roam collision
  const lampPosts = [];   // road tiles that carry lamp posts, for the night light pool

  for (const cell of cells.values()) {
    const base = { x: cell.x, y: CITY_Y, z: cell.z, scale: TILE };

    if (cell.type === 'sidewalk') {
      push(GROUND.pavement, base);
      stats.sidewalk++;
      continue;
    }

    if (cell.type === 'fountain') {
      push(GROUND.fountain, base);
      stats.park++;
      continue;
    }

    if (cell.type === 'park') {
      const pick = pickWeighted(GREEN, hash2(cell.gx * 7, cell.gz * 13));
      push(pick.id, { ...base, rotationY: Math.floor(hash2(cell.gx, cell.gz) * 4) * Math.PI * 0.5 });
      stats.park++;
      continue;
    }

    if (cell.type === 'street') {
      let mask = 0;
      if (isStreet(cell.gx, cell.gz - 1)) mask |= N;
      if (isStreet(cell.gx + 1, cell.gz)) mask |= E;
      if (isStreet(cell.gx, cell.gz + 1)) mask |= S;
      if (isStreet(cell.gx - 1, cell.gz)) mask |= W;

      const piece = roadPieceFor(mask);
      // Lamp posts on the straights, for night-time street lighting. Free roam has no
      // circuit floodlighting to fall back on, so it needs them much denser.
      const lampChance = layout.lampChance ?? 0.3;
      const useLights = piece.kind === 'straight' && hash2(cell.gx * 3, cell.gz * 5) < lampChance;
      const id = useLights ? ROADS.straightLights : ROADS[piece.kind];
      push(id, { ...base, rotationY: piece.quarterTurns * Math.PI * 0.5 });
      if (useLights) lampPosts.push(new THREE.Vector3(cell.x, CITY_Y + TILE * 0.42, cell.z));
      stats.street++;
      continue;
    }

    // Regular block cell: building or green space.
    const roll = hash2(cell.gx * 31, cell.gz * 17);
    if (roll < CITY_LAYOUT.greenChance) {
      const pick = pickWeighted(GREEN, hash2(cell.gx + 3, cell.gz + 11));
      push(pick.id, { ...base, rotationY: Math.floor(hash2(cell.gz, cell.gx) * 4) * Math.PI * 0.5 });
      stats.green++;
      continue;
    }

    const pick = pickWeighted(BUILDINGS, hash2(cell.gx - 5, cell.gz + 7));
    // Buildings face the nearest street; a quarter turn is enough to break up the grid.
    const turn = Math.floor(hash2(cell.gx * 13, cell.gz * 29) * 4) * Math.PI * 0.5;
    // Slight size variation, uniform so the proportions stay right.
    const variation = 0.88 + hash2(cell.gx * 19, cell.gz * 23) * 0.34;
    push(pick.id, { ...base, rotationY: turn, scale: TILE * variation });
    // Collide against the base plate, which is the full tile regardless of variation.
    solids.push({ x: cell.x, z: cell.z, half: TILE * Math.min(variation, 1) * 0.5 });
    stats.building++;
  }

  // ── Build one InstancedMesh per model id
  const group = new THREE.Group();
  group.name = 'city';
  for (const [id, list] of placements) {
    const asset = assets.get(id);
    group.add(buildInstances(asset.geometry, asset.material, list, {
      name: `city-${id}`,
      castShadow: !id.startsWith('road') && !id.startsWith('pavement') && id !== 'grass',
      receiveShadow: true,
    }));
  }
  scene.add(group);

  stats.cells = cells.size;
  stats.draws = placements.size;

  const streetCells = [...cells.values()].filter((c) => c.type === 'street');

  return {
    group,
    stats,
    cells,
    streetCells,
    lampPosts,
    collider: createCityCollider(solids),
    tile: TILE,
    centerZ,
  };
}

/**
 * Grid-bucketed box collision against the building footprints.
 *
 * Free roam has no track corridor to keep the car honest, so the buildings have to
 * stop it. Buckets are the city grid itself, so a check only ever looks at the nine
 * cells around the car no matter how large the city is.
 */
export function createCityCollider(solids) {
  const buckets = new Map();
  const bucketKey = (bx, bz) => `${bx},${bz}`;

  for (const solid of solids) {
    const bx = Math.round(solid.x / TILE);
    const bz = Math.round(solid.z / TILE);
    const k = bucketKey(bx, bz);
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(solid);
  }

  /**
   * Pushes `position` out of any building it overlaps.
   * @returns {number} impact speed factor 0..1 (0 = no contact)
   */
  function resolve(position, radius) {
    const bx = Math.round(position.x / TILE);
    const bz = Math.round(position.z / TILE);
    let hit = 0;

    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = buckets.get(bucketKey(bx + ox, bz + oz));
        if (!list) continue;

        for (const solid of list) {
          const dx = position.x - solid.x;
          const dz = position.z - solid.z;
          const overlapX = solid.half + radius - Math.abs(dx);
          const overlapZ = solid.half + radius - Math.abs(dz);
          if (overlapX <= 0 || overlapZ <= 0) continue;

          // Push out along the shallower axis — that is the face we actually hit.
          if (overlapX < overlapZ) {
            position.x += Math.sign(dx || 1) * overlapX;
            hit = Math.max(hit, overlapX / (radius * 2));
          } else {
            position.z += Math.sign(dz || 1) * overlapZ;
            hit = Math.max(hit, overlapZ / (radius * 2));
          }
        }
      }
    }
    return hit;
  }

  return { resolve, count: solids.length };
}
