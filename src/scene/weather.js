import * as THREE from 'three';

/**
 * Drifting dust / light snow.
 *
 * The old update advanced particles by a fixed 0.002 per call, so the drift speed
 * silently depended on frame rate (and on the physics step count). Everything here is
 * scaled by `dt`, and the buffer is marked dynamic.
 */
export function addWeatherEffects(scene, config = {}) {
  const particleCount = config.particleCount ?? 140;
  const area = config.area ?? 80;
  const baseZ = config.baseZ ?? 10;
  const maxHeight = config.maxHeight ?? 6;
  const darkColor = config.darkColor ?? 0xaec3de;
  const darkOpacity = config.darkOpacity ?? 0.2;
  const lightColor = config.lightColor ?? 0xffffff;
  const lightOpacity = config.lightOpacity ?? 0.05;

  const positions = new Float32Array(particleCount * 3);
  const phases = new Float32Array(particleCount);
  for (let i = 0; i < particleCount; i++) {
    positions[i * 3] = (Math.random() - 0.5) * area;
    positions[i * 3 + 1] = Math.random() * maxHeight;
    positions[i * 3 + 2] = baseZ + (Math.random() - 0.5) * area;
    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage)
  );

  const material = new THREE.PointsMaterial({
    color: darkColor,
    size: 0.055,
    transparent: true,
    opacity: darkOpacity,
    depthWrite: false,
  });

  const particles = new THREE.Points(geometry, material);
  particles.name = 'weather';
  particles.frustumCulled = false;
  scene.add(particles);

  let time = 0;
  let darkMode = true;

  function setDarkMode(next) {
    darkMode = !!next;
    material.color.setHex(darkMode ? darkColor : lightColor);
    material.opacity = darkMode ? darkOpacity : lightOpacity;
  }

  function update(dt) {
    time += dt;
    const rise = darkMode ? 0.12 : 0.07;
    const sway = darkMode ? 0.05 : 0.03;
    for (let i = 0; i < particleCount; i++) {
      const i3 = i * 3;
      positions[i3 + 1] += rise * dt;
      positions[i3] += Math.sin(time * 0.6 + phases[i]) * sway * dt;
      if (positions[i3 + 1] > maxHeight) positions[i3 + 1] = 0;
    }
    geometry.attributes.position.needsUpdate = true;
  }

  function dispose() {
    geometry.dispose();
    material.dispose();
    particles.removeFromParent();
  }

  return { update, setDarkMode, isDarkMode: () => darkMode, dispose };
}
