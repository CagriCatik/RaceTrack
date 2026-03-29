import * as THREE from 'three';

export function createCollisionSystem(car, obstacles = []) {
  const boxA = new THREE.Box3();
  const boxB = new THREE.Box3();

  function intersects(a, b) {
    boxA.setFromObject(a);
    boxB.setFromObject(b);
    return boxA.intersectsBox(boxB);
  }

  function update() {
    for (const obstacle of obstacles) {
      if (intersects(car.group, obstacle)) {
        car.speed = 0;
        return true;
      }
    }
    return false;
  }

  return { update };
}

