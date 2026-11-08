import * as THREE from 'three';
import { loadModel, flattenToGeometry } from '../core/assetLoader.js';
import { buildInstances, setInstance } from '../core/instancing.js';
import { modelPath, PROP_KINDS } from '../config/carCatalog.js';

/**
 * Trackside props built from the kit's own cone/box/debris models.
 *
 * `addTrackObstacles()` used to be a stub returning `[]` — the cones had been deleted
 * because they blocked the racing line. They are back, but placed *outside* the line
 * the AI drives, instanced into one draw call per kind, and knockable: hitting one
 * costs momentum and leaves it lying on the tarmac instead of hard-stopping the car.
 */

const layout = [
  // Chicane cones down the two long straights, alternating sides.
  { kind: 'cone', u: 0.08, offset: 2.5 }, { kind: 'cone', u: 0.1, offset: -2.5 },
  { kind: 'cone', u: 0.12, offset: 2.5 }, { kind: 'cone', u: 0.14, offset: -2.5 },
  { kind: 'cone', u: 0.56, offset: 2.5 }, { kind: 'cone', u: 0.58, offset: -2.5 },
  { kind: 'cone', u: 0.6, offset: 2.5 }, { kind: 'cone', u: 0.62, offset: -2.5 },
  // Corner-exit markers just off the apex.
  { kind: 'coneFlat', u: 0.23, offset: 2.9 }, { kind: 'coneFlat', u: 0.26, offset: 2.9 },
  { kind: 'coneFlat', u: 0.73, offset: 2.9 }, { kind: 'coneFlat', u: 0.76, offset: 2.9 },
  { kind: 'coneFlat', u: 0.48, offset: -2.9 }, { kind: 'coneFlat', u: 0.98, offset: -2.9 },
  // Debris scattered on the run-off, one car-width outside the rail line.
  { kind: 'tire', u: 0.3, offset: -4.1 }, { kind: 'tire', u: 0.82, offset: 4.1 },
  { kind: 'box', u: 0.42, offset: 4.2 }, { kind: 'box', u: 0.9, offset: -4.2 },
  { kind: 'bumper', u: 0.35, offset: 4.0 }, { kind: 'bumper', u: 0.68, offset: -4.0 },
  { kind: 'spoiler', u: 0.19, offset: -4.0 }, { kind: 'spoiler', u: 0.88, offset: 4.0 },
];

export async function addTrackObstacles(scene, curve, roadWidth) {
  const usedKinds = [...new Set(layout.map((entry) => entry.kind))];

  const templates = await Promise.all(
    usedKinds.map(async (kind) => {
      const def = PROP_KINDS[kind];
      try {
        const model = await loadModel(modelPath(def.id));
        return [kind, flattenToGeometry(model)];
      } catch (err) {
        console.warn(`[obstacles] skipping ${def.id}`, err);
        return [kind, null];
      }
    })
  );
  const geometryByKind = new Map(templates);

  const group = new THREE.Group();
  group.name = 'props';
  const propGroups = [];
  const tangent = new THREE.Vector3();

  for (const kind of usedKinds) {
    const asset = geometryByKind.get(kind);
    if (!asset) continue;
    const def = PROP_KINDS[kind];
    const entries = layout.filter((entry) => entry.kind === kind);

    const placements = [];
    const items = [];
    for (const entry of entries) {
      const p = curve.getPointAt(entry.u);
      curve.getTangentAt(entry.u, tangent);
      const nx = -tangent.z;
      const nz = tangent.x;
      const x = p.x + nx * entry.offset;
      const z = p.z + nz * entry.offset;
      const rotationY = Math.atan2(tangent.x, tangent.z) + (Math.random() - 0.5) * 0.6;

      placements.push({ x, y: 0, z, rotationY, scale: def.scale });
      items.push({
        x, y: 0, z,
        baseY: 0,
        rotX: 0, rotY: rotationY, rotZ: 0,
        vx: 0, vy: 0, vz: 0,
        spinX: 0, spinZ: 0,
        radius: def.radius,
        mass: def.mass,
        active: false,
        resting: false,
      });
    }

    const mesh = buildInstances(asset.geometry, asset.material, placements, {
      name: `prop-${def.id}`,
      castShadow: true,
      dynamic: true,
    });
    group.add(mesh);

    propGroups.push({
      kind,
      mesh,
      items,
      dirty: false,
      write(index, item) {
        setInstance(mesh, index, {
          x: item.x,
          y: item.y,
          z: item.z,
          rotationX: item.rotX,
          rotationY: item.rotY,
          rotationZ: item.rotZ,
          scale: def.scale,
        });
      },
      flush() {
        mesh.instanceMatrix.needsUpdate = true;
      },
      reset() {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const original = placements[i];
          Object.assign(item, {
            x: original.x, y: 0, z: original.z,
            rotX: 0, rotZ: 0, rotY: original.rotationY,
            vx: 0, vy: 0, vz: 0, spinX: 0, spinZ: 0,
            active: false, resting: false,
          });
          this.write(i, item);
        }
        this.flush();
      },
    });
  }

  scene.add(group);
  return { group, propGroups, roadWidth };
}
