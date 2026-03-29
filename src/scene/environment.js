import * as THREE from 'three';

export function addGroundAndTerrain(scene) {
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x5f7b4d, roughness: 0.95 });
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(180, 180), groundMat);
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.receiveShadow = true;
  scene.add(ground);

  const hillMat = new THREE.MeshStandardMaterial({ color: 0x6a8556, roughness: 0.9 });
  const hill1 = new THREE.Mesh(new THREE.SphereGeometry(15, 24, 18), hillMat);
  hill1.scale.set(1.2, 0.25, 1.0);
  hill1.position.set(38, 2.8, 30);
  hill1.receiveShadow = true;
  scene.add(hill1);

  const hill2 = hill1.clone();
  hill2.position.set(-34, 2.4, -28);
  hill2.scale.set(1.0, 0.22, 1.3);
  scene.add(hill2);
}

export function addBackgroundTrees(scene) {
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5a3e2a, roughness: 0.9 });
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x3f6a37, roughness: 0.9 });

  for (let i = 0; i < 70; i++) {
    const ang = (i / 70) * Math.PI * 2;
    const r = 46 + (i % 5) * 2;
    const x = Math.cos(ang) * r;
    const z = Math.sin(ang) * r + 10;

    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.22, 1.8, 8), trunkMat);
    trunk.position.set(x, 0.9, z);
    trunk.castShadow = true;
    scene.add(trunk);

    const crown = new THREE.Mesh(new THREE.SphereGeometry(0.9 + (i % 3) * 0.12, 10, 10), leafMat);
    crown.position.set(x, 2.2, z);
    crown.castShadow = true;
    crown.receiveShadow = true;
    scene.add(crown);
  }
}

