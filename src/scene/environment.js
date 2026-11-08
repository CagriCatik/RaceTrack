import * as THREE from 'three';
import { buildInstances } from '../core/instancing.js';

/**
 * Ground, hills and the tree ring.
 *
 * The tree loop used to create 140 meshes with 140 geometries. Two InstancedMesh
 * draws now cover the whole horizon, including their shadows.
 */
export function addGroundAndTerrain(scene, materials, { city = false } = {}) {
  const group = new THREE.Group();
  group.name = 'terrain';

  // In the city the ground is the base layer under the tile grid, so it is paved;
  // in the country scenario it is the grass the track sits on.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(400, 400, 1, 1),
    city ? materials.cityGround : materials.grassOuter
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  ground.matrixAutoUpdate = false;
  ground.updateMatrix();
  group.add(ground);

  // Rolling hills only make sense outside town.
  if (!city) {
    const hillGeom = new THREE.SphereGeometry(15, 16, 12);
    group.add(buildInstances(hillGeom, materials.hill, [
      { x: 38, y: 2.8, z: 30, scale: { x: 1.2, y: 0.25, z: 1.0 } },
      { x: -34, y: 2.4, z: -28, scale: { x: 1.0, y: 0.22, z: 1.3 } },
      { x: 6, y: 2.0, z: -46, scale: { x: 1.5, y: 0.18, z: 0.9 } },
    ], { name: 'hills' }));
  }

  scene.add(group);
  return group;
}

export function addBackgroundTrees(scene, materials, count = 84) {
  const trunks = [];
  const crownsA = [];
  const crownsB = [];

  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (i % 3) * 0.04;
    const radius = 46 + (i % 5) * 2.4;
    const x = Math.cos(angle) * radius;
    const z = Math.sin(angle) * radius + 10;
    const scale = 0.85 + ((i * 37) % 11) / 20;

    trunks.push({ x, y: 0.9 * scale, z, scale: { x: scale, y: scale, z: scale }, rotationY: i });
    const crown = { x, y: 2.2 * scale, z, scale: scale * (0.9 + (i % 3) * 0.12) };
    (i % 2 === 0 ? crownsA : crownsB).push(crown);
  }

  const group = new THREE.Group();
  group.name = 'trees';
  group.add(buildInstances(
    new THREE.CylinderGeometry(0.18, 0.24, 1.8, 6),
    materials.trunk,
    trunks,
    { name: 'tree-trunks', castShadow: true }
  ));
  const crownGeom = new THREE.IcosahedronGeometry(0.95, 0);
  group.add(buildInstances(crownGeom, materials.leaf, crownsA, { name: 'tree-crowns-a', castShadow: true }));
  group.add(buildInstances(crownGeom, materials.leafAlt, crownsB, { name: 'tree-crowns-b', castShadow: true }));
  scene.add(group);
  return group;
}
