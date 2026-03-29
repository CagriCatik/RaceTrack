import * as THREE from 'three';

const STORAGE_KEY = 'car-game.ghost.v1';

function createGhostVisualFrom(sourceGroup) {
  const ghost = sourceGroup.clone(true);
  ghost.traverse((obj) => {
    if (obj.isLight || obj.isPoints) {
      obj.visible = false;
      return;
    }
    if (!obj.isMesh || !obj.material) return;
    obj.material = obj.material.clone();
    obj.material.transparent = true;
    obj.material.opacity = 0.25;
    obj.material.depthWrite = false;
    if ('emissive' in obj.material) {
      obj.material.emissive = new THREE.Color(0x66ccff);
      obj.material.emissiveIntensity = 0.5;
    }
    if ('color' in obj.material) {
      obj.material.color.offsetHSL(0.05, 0.0, 0.08);
    }
  });
  return ghost;
}

function readStoredGhost() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!Array.isArray(data?.samples) || !Number.isFinite(data?.lapTime)) return null;
    return data;
  } catch {
    return null;
  }
}

function writeStoredGhost(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Ignore storage errors.
  }
}

export function createGhostReplayController(scene, sourceVehicle) {
  let visible = true;
  let enabled = true;
  let playbackTime = 0;
  let lapTime = 0;
  let samples = [];
  let ghostObject = null;
  let ghostIndex = 0;

  const stored = readStoredGhost();
  if (stored) {
    lapTime = stored.lapTime;
    samples = stored.samples;
  }

  function ensureGhostObject() {
    if (ghostObject || !sourceVehicle?.group) return;
    ghostObject = createGhostVisualFrom(sourceVehicle.group);
    ghostObject.visible = visible;
    scene.add(ghostObject);
  }

  function setVisible(nextVisible) {
    visible = !!nextVisible;
    if (ghostObject) ghostObject.visible = visible;
  }

  function setEnabled(nextEnabled) {
    enabled = !!nextEnabled;
  }

  function registerLapEvent(event) {
    if (event.type !== 'lap-finished' || !event.valid || !event.samples?.length) return;
    if (!Number.isFinite(event.time) || event.time <= 0) return;
    if (lapTime > 0 && event.time >= lapTime) return;

    lapTime = event.time;
    samples = event.samples.map((s) => ({
      t: s.t,
      x: s.x,
      y: s.y,
      z: s.z,
      heading: s.heading,
    }));
    ghostIndex = 0;
    playbackTime = 0;
    writeStoredGhost({ lapTime, samples });
  }

  function update(dt) {
    if (!enabled || !visible || !samples.length || !Number.isFinite(lapTime) || lapTime <= 0) return;
    ensureGhostObject();
    if (!ghostObject) return;

    playbackTime += dt;
    if (playbackTime >= lapTime) {
      playbackTime %= lapTime;
      ghostIndex = 0;
    }

    while (ghostIndex < samples.length - 2 && samples[ghostIndex + 1].t < playbackTime) {
      ghostIndex += 1;
    }

    const a = samples[ghostIndex];
    const b = samples[Math.min(samples.length - 1, ghostIndex + 1)];
    const span = Math.max(1e-6, b.t - a.t);
    const alpha = THREE.MathUtils.clamp((playbackTime - a.t) / span, 0, 1);

    ghostObject.position.set(
      THREE.MathUtils.lerp(a.x, b.x, alpha),
      THREE.MathUtils.lerp(a.y, b.y, alpha),
      THREE.MathUtils.lerp(a.z, b.z, alpha)
    );
    ghostObject.rotation.y = THREE.MathUtils.lerp(a.heading, b.heading, alpha);
  }

  return {
    update,
    registerLapEvent,
    setVisible,
    isVisible: () => visible,
    setEnabled,
    isEnabled: () => enabled,
    hasGhost: () => samples.length > 1 && lapTime > 0,
    bestGhostTime: () => lapTime,
  };
}
