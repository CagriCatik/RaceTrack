import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { wasPressed } from '../input.js';

const MODES = ['chase', 'hood', 'orbit'];
const MODE_LABEL = { chase: 'CHASE', hood: 'HAUBE', orbit: 'ORBIT' };

/**
 * Three camera modes on `C`. Orbit keeps the old free-look behaviour; chase and hood
 * are driven directly, so OrbitControls is detached while they are active (it used to
 * run its damping update every frame regardless of the mode in use).
 *
 * The hood view sits just above the measured body shell rather than inside it — the
 * car-kit models are hollow outer surfaces with no interior to sit in.
 */
export function createCameraController(camera, domElement, car) {
  const controls = new OrbitControls(camera, domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = 3;
  controls.maxDistance = 60;
  controls.minPolarAngle = 0.1;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enabled = false;

  const target = car.group;
  let modeIndex = 0;

  const desiredPos = new THREE.Vector3();
  const lookAt = new THREE.Vector3();
  const offset = new THREE.Vector3();
  const smoothed = new THREE.Vector3().copy(target.position);

  function applyOrbitMode(active) {
    controls.enabled = active;
    if (active) {
      controls.target.copy(target.position).setY(target.position.y + 1.2);
      controls.update();
    }
  }

  function update(dt) {
    if (wasPressed('KeyC')) {
      modeIndex = (modeIndex + 1) % MODES.length;
      applyOrbitMode(MODES[modeIndex] === 'orbit');
    }

    const mode = MODES[modeIndex];
    const speedNorm = Math.min(Math.abs(car.speed) / Math.max(car.maxSpeed, 1), 1);

    if (mode === 'orbit') {
      // Follow the car while keeping the user's orbit offset.
      offset.copy(camera.position).sub(controls.target);
      lookAt.copy(target.position).setY(target.position.y + 1.2);
      const follow = 1 - Math.pow(0.001, dt);
      controls.target.lerp(lookAt, follow);
      desiredPos.copy(controls.target).add(offset);
      camera.position.lerp(desiredPos, follow);
      controls.update();
      return;
    }

    const heading = car.heading;
    const sin = Math.sin(heading);
    const cos = Math.cos(heading);

    if (mode === 'hood') {
      const forward = car.bodyFront * 0.62;
      const height = car.bodyTop + 0.22;
      desiredPos.set(
        target.position.x + sin * forward,
        target.position.y + height,
        target.position.z + cos * forward
      );
      camera.position.lerp(desiredPos, 1 - Math.pow(0.000001, dt));
      lookAt.set(
        target.position.x + sin * 16,
        target.position.y + height * 0.72,
        target.position.z + cos * 16
      );
      camera.lookAt(lookAt);
      const targetFov = 72 + speedNorm * 6;
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.pow(0.01, dt));
      camera.updateProjectionMatrix();
      return;
    }

    // Chase: pulls back and lowers as speed rises for a sense of acceleration.
    const distance = 7.2 + speedNorm * 2.6 + car.bodyLength * 0.25;
    const height = 3.1 + speedNorm * 0.5;
    smoothed.lerp(target.position, 1 - Math.pow(0.0002, dt));
    desiredPos.set(
      smoothed.x - sin * distance,
      smoothed.y + height,
      smoothed.z - cos * distance
    );
    camera.position.lerp(desiredPos, 1 - Math.pow(0.0005, dt));
    lookAt.set(
      target.position.x + sin * 6,
      target.position.y + 1.35,
      target.position.z + cos * 6
    );
    camera.lookAt(lookAt);
    const targetFov = 64 + speedNorm * 8;
    if (Math.abs(camera.fov - targetFov) > 0.05) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, 1 - Math.pow(0.01, dt));
      camera.updateProjectionMatrix();
    }
  }

  return {
    controls,
    update,
    mode: () => MODES[modeIndex],
    modeLabel: () => MODE_LABEL[MODES[modeIndex]],
  };
}
