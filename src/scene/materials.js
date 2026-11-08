import * as THREE from 'three';

/**
 * One shared material per surface type.
 *
 * Previously every loop body did `new THREE.MeshStandardMaterial(...)` or at least a
 * fresh geometry, so the renderer saw hundreds of unique material/geometry pairs and
 * could not batch anything. Creating them once here also gives the day/night switch a
 * single place to retune surface response.
 */
export function createSceneMaterials() {
  const materials = {
    road: new THREE.MeshStandardMaterial({ color: 0x252528, roughness: 0.62, metalness: 0.04 }),
    dash: new THREE.MeshStandardMaterial({ color: 0xe0b01c, roughness: 0.4 }),
    kerbRed: new THREE.MeshStandardMaterial({ color: 0xc8392f, roughness: 0.55 }),
    kerbWhite: new THREE.MeshStandardMaterial({ color: 0xe8e8e8, roughness: 0.55 }),
    finishLight: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.4 }),
    finishDark: new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.4 }),
    grassInfield: new THREE.MeshStandardMaterial({ color: 0x45663a, roughness: 0.95 }),
    grassOuter: new THREE.MeshStandardMaterial({ color: 0x3f5a35, roughness: 0.95 }),
    cityGround: new THREE.MeshStandardMaterial({ color: 0x3a3d42, roughness: 0.9 }),
    hill: new THREE.MeshStandardMaterial({ color: 0x47633c, roughness: 0.92 }),
    rail: new THREE.MeshStandardMaterial({ color: 0x79808a, roughness: 0.5, metalness: 0.45 }),
    post: new THREE.MeshStandardMaterial({ color: 0x565b62, roughness: 0.65, metalness: 0.2 }),
    pole: new THREE.MeshStandardMaterial({ color: 0x5b6068, roughness: 0.55, metalness: 0.35 }),
    bulb: new THREE.MeshStandardMaterial({
      color: 0xf6eed8, emissive: 0xf6eed8, emissiveIntensity: 2.6, roughness: 0.15,
    }),
    trunk: new THREE.MeshStandardMaterial({ color: 0x4e3524, roughness: 0.9 }),
    leaf: new THREE.MeshStandardMaterial({ color: 0x33602f, roughness: 0.9 }),
    leafAlt: new THREE.MeshStandardMaterial({ color: 0x3d6b33, roughness: 0.9 }),
    marker: new THREE.MeshStandardMaterial({
      color: 0x6dd4ff, emissive: 0x2a7ab0, emissiveIntensity: 2, roughness: 0.3,
    }),
  };

  /** Night/day tweaks that can't be done with lighting alone. */
  function setDarkMode(dark) {
    materials.road.color.setHex(dark ? 0x202024 : 0x3a3a3f);
    materials.grassInfield.color.setHex(dark ? 0x45663a : 0x5d8a4c);
    materials.grassOuter.color.setHex(dark ? 0x3f5a35 : 0x587f46);
    materials.hill.color.setHex(dark ? 0x47633c : 0x628a50);
    materials.cityGround.color.setHex(dark ? 0x2b2e34 : 0x4e525a);
    materials.bulb.emissiveIntensity = dark ? 2.6 : 0.3;
  }

  function dispose() {
    for (const material of Object.values(materials)) material.dispose();
  }

  return { materials, setDarkMode, dispose };
}
