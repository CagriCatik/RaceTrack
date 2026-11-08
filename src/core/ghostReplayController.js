import * as THREE from 'three';

const STORAGE_KEY = 'racetrack.ghost.v2';
const MAX_SAMPLES = 1200;

/**
 * Replays the best lap as a translucent car.
 *
 * The ghost used to be a deep clone of the whole vehicle — lights, exhaust points,
 * and (before this refactor) 48 procedural wheel meshes, with a cloned material per
 * mesh. It now clones only the visible body/wheel meshes and gives them one shared
 * ghost material, so the ghost costs a handful of draws instead of ~70.
 */
function buildGhost(sourceVehicle) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x7fd8ff,
    transparent: true,
    opacity: 0.3, // see FADE_NEAR/FADE_FAR: scaled down near the camera
    depthWrite: false,
    side: THREE.FrontSide,
  });

  const ghost = new THREE.Group();
  ghost.name = 'ghost';
  ghost.renderOrder = 3;

  const bodyPivot = new THREE.Group();
  ghost.add(bodyPivot);

  sourceVehicle.group.traverse((node) => {
    if (!node.isMesh || !node.visible || node.isPoints) return;
    // Lamp meshes are tiny and emissive; skipping them keeps the ghost readable.
    if (node.geometry?.type === 'BoxGeometry' && node.geometry.parameters?.width <= 0.65) return;
    const clone = new THREE.Mesh(node.geometry, material);
    node.updateWorldMatrix(true, false);
    clone.matrixAutoUpdate = false;
    clone.matrix.copy(sourceVehicle.group.matrixWorld).invert().multiply(node.matrixWorld);
    clone.castShadow = false;
    clone.receiveShadow = false;
    bodyPivot.add(clone);
  });

  return { ghost, material };
}

function readStored() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
    if (!Array.isArray(data?.samples) || !Number.isFinite(data?.lapTime)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeStored(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch { /* quota */ }
}

export function createGhostReplayController(scene, sourceVehicle, camera = null) {
  let visible = true;
  let playbackTime = 0;
  let lapTime = 0;
  let samples = [];
  let ghostObject = null;
  let ghostMaterial = null;
  let index = 0;

  const BASE_OPACITY = 0.3;
  const FADE_NEAR = 2.5;
  const FADE_FAR = 7;

  const stored = readStored();
  if (stored) {
    lapTime = stored.lapTime;
    samples = stored.samples;
  }

  function ensureGhost() {
    if (ghostObject) return;
    const built = buildGhost(sourceVehicle);
    ghostObject = built.ghost;
    ghostMaterial = built.material;
    ghostObject.visible = visible;
    scene.add(ghostObject);
  }

  function registerLapEvent(event) {
    if (event.type !== 'lap-finished' || !event.valid || !event.samples?.length) return;
    if (!Number.isFinite(event.time) || event.time <= 0) return;
    if (lapTime > 0 && event.time >= lapTime) return;

    lapTime = event.time;
    samples = event.samples.slice(-MAX_SAMPLES).map((s) => ({
      t: +s.t.toFixed(3),
      x: +s.x.toFixed(2),
      y: +s.y.toFixed(2),
      z: +s.z.toFixed(2),
      heading: +s.heading.toFixed(3),
    }));
    index = 0;
    playbackTime = 0;
    writeStored({ lapTime, samples });
  }

  function update(frameDt) {
    if (!visible || samples.length < 2 || lapTime <= 0) return;
    ensureGhost();
    if (!ghostObject) return;

    playbackTime += frameDt;
    if (playbackTime >= lapTime) {
      playbackTime %= lapTime;
      index = 0;
    }
    while (index < samples.length - 2 && samples[index + 1].t < playbackTime) index += 1;

    const a = samples[index];
    const b = samples[Math.min(samples.length - 1, index + 1)];
    const span = Math.max(1e-6, b.t - a.t);
    const alpha = Math.min(1, Math.max(0, (playbackTime - a.t) / span));

    ghostObject.position.set(
      a.x + (b.x - a.x) * alpha,
      a.y + (b.y - a.y) * alpha,
      a.z + (b.z - a.z) * alpha
    );
    // Shortest-arc interpolation, otherwise the ghost spins at the ±π seam.
    let delta = (b.heading - a.heading) % (Math.PI * 2);
    if (delta > Math.PI) delta -= Math.PI * 2;
    if (delta < -Math.PI) delta += Math.PI * 2;
    ghostObject.rotation.y = a.heading + delta * alpha;

    // Fade out when the chase camera drives through the ghost, otherwise it fills
    // the screen with a translucent wall at exactly the moment you need to see.
    if (camera && ghostMaterial) {
      const dx = ghostObject.position.x - camera.position.x;
      const dy = ghostObject.position.y - camera.position.y;
      const dz = ghostObject.position.z - camera.position.z;
      const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
      const t = Math.min(1, Math.max(0, (dist - FADE_NEAR) / (FADE_FAR - FADE_NEAR)));
      ghostMaterial.opacity = BASE_OPACITY * t;
      ghostObject.visible = t > 0.02;
    }
  }

  return {
    update,
    registerLapEvent,
    setVisible(next) {
      visible = !!next;
      if (ghostObject) ghostObject.visible = visible;
    },
    toggle() {
      visible = !visible;
      if (ghostObject) ghostObject.visible = visible;
      return visible;
    },
    isVisible: () => visible,
    hasGhost: () => samples.length > 1 && lapTime > 0,
    bestGhostTime: () => lapTime,
    dispose() {
      ghostMaterial?.dispose();
      ghostObject?.removeFromParent();
    },
  };
}
