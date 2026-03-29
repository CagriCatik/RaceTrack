import * as THREE from 'three';
import { OrbitControls } from 'OrbitControls';

export function createCameraController(camera, domElement, targetObject) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.enableZoom = true;
  controls.minDistance = 3;
  controls.maxDistance = 60;

  if (targetObject) controls.target.copy(targetObject.position);

  const tmpOffset = new THREE.Vector3();
  const desiredTarget = new THREE.Vector3();
  const desiredCameraPos = new THREE.Vector3();

  function update(dt) {
    if (!targetObject) return;

    tmpOffset.copy(camera.position).sub(controls.target);
    desiredTarget.copy(targetObject.position).setY(targetObject.position.y + 1.5);
    desiredCameraPos.copy(desiredTarget).add(tmpOffset);

    const followLerp = 1 - Math.pow(0.001, dt);
    controls.target.lerp(desiredTarget, followLerp);
    camera.position.lerp(desiredCameraPos, followLerp);
    controls.update();
  }

  return { controls, update };
}

