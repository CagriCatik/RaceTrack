import * as THREE from 'three';
import { buildInstances } from '../core/instancing.js';

/**
 * Street lighting on a fixed light budget.
 *
 * 16 poles are drawn as 2 InstancedMesh, and the bulbs glow via emissive material —
 * but only `POOL_SIZE` real PointLights exist, and they hop to whichever bulbs are
 * nearest the player. Every light in a WebGL forward renderer costs shader work in
 * *every* lit fragment, so 16 permanent point lights was the scene's single most
 * expensive decision.
 */
const POOL_SIZE = 4;
const REASSIGN_INTERVAL = 0.2; // seconds

/**
 * A handful of real PointLights that hop to whichever of `positions` are nearest the
 * player. Used by both the circuit (16 poles) and free roam (every lamp-post road
 * tile), because the cost of a light is per-fragment and does not care how many
 * lamp posts are modelled.
 */
export function createPointLightPool(scene, positions, options = {}) {
  const {
    size = POOL_SIZE,
    color = 0xffefcf,
    intensity = 1.6,
    distance = 18,
    range = 46,
  } = options;

  const lights = [];
  for (let i = 0; i < size; i++) {
    const light = new THREE.PointLight(color, 0, distance, 2);
    light.castShadow = false;
    scene.add(light);
    lights.push(light);
  }

  let enabled = true;
  let timer = REASSIGN_INTERVAL;
  const ranked = positions.map((position, index) => ({ position, index, distSq: 0 }));

  function setEnabled(next) {
    enabled = !!next;
    for (const light of lights) light.visible = enabled;
  }

  function update(frameDt, focus) {
    if (!enabled || !focus || !ranked.length) return;
    timer += frameDt;
    if (timer < REASSIGN_INTERVAL) return;
    timer = 0;

    for (const entry of ranked) {
      const dx = entry.position.x - focus.x;
      const dz = entry.position.z - focus.z;
      entry.distSq = dx * dx + dz * dz;
    }
    ranked.sort((a, b) => a.distSq - b.distSq);

    for (let i = 0; i < lights.length; i++) {
      const entry = ranked[i];
      if (!entry) { lights[i].intensity = 0; continue; }
      lights[i].position.copy(entry.position);
      lights[i].intensity = intensity * Math.max(0, 1 - entry.distSq / (range * range));
    }
  }

  return { setEnabled, isEnabled: () => enabled, update, lights };
}

export function addStreetLights(scene, curve, roadWidth, materials, count = 16) {
  const group = new THREE.Group();
  group.name = 'street-lights';

  const polePlacements = [];
  const bulbPlacements = [];
  const bulbPositions = [];
  const tangent = new THREE.Vector3();

  for (let i = 0; i < count; i++) {
    const u = i / count;
    const p = curve.getPointAt(u);
    curve.getTangentAt(u, tangent);
    const nx = -tangent.z;
    const nz = tangent.x;
    const side = i % 2 === 0 ? 1 : -1;
    const x = p.x + nx * side * (roadWidth * 0.9);
    const z = p.z + nz * side * (roadWidth * 0.9);

    polePlacements.push({ x, y: 1.7, z });
    bulbPlacements.push({ x, y: 3.45, z });
    bulbPositions.push(new THREE.Vector3(x, 3.45, z));
  }

  group.add(buildInstances(
    new THREE.CylinderGeometry(0.08, 0.1, 3.4, 6),
    materials.pole,
    polePlacements,
    { name: 'light-poles' }
  ));
  group.add(buildInstances(
    new THREE.SphereGeometry(0.17, 8, 6),
    materials.bulb,
    bulbPlacements,
    { name: 'light-bulbs' }
  ));

  const pool = [];
  for (let i = 0; i < POOL_SIZE; i++) {
    const light = new THREE.PointLight(0xffefcf, 1.6, 17, 2);
    light.castShadow = false;
    group.add(light);
    pool.push(light);
  }

  scene.add(group);

  let enabled = true;
  let timer = REASSIGN_INTERVAL;
  const ranked = bulbPositions.map((position, index) => ({ position, index, distSq: 0 }));

  function setEnabled(next) {
    enabled = !!next;
    materials.bulb.emissiveIntensity = enabled ? 2.6 : 0.12;
    for (const light of pool) light.visible = enabled;
  }

  /** Moves the pool onto the nearest bulbs; cheap enough to call every frame. */
  function update(frameDt, focus) {
    if (!enabled || !focus) return;
    timer += frameDt;
    if (timer < REASSIGN_INTERVAL) return;
    timer = 0;

    for (const entry of ranked) {
      const dx = entry.position.x - focus.x;
      const dz = entry.position.z - focus.z;
      entry.distSq = dx * dx + dz * dz;
    }
    ranked.sort((a, b) => a.distSq - b.distSq);

    for (let i = 0; i < pool.length; i++) {
      const entry = ranked[i];
      pool[i].position.copy(entry.position);
      // Fade out rather than pop when a bulb is swapped out at the edge of range.
      pool[i].intensity = 1.6 * Math.max(0, 1 - entry.distSq / (46 * 46));
    }
  }

  return { setEnabled, isEnabled: () => enabled, update, group, poolSize: POOL_SIZE };
}
