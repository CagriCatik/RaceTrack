import * as THREE from 'three';

export function addWeatherEffects(scene, config = {}) {
  const particleCount = config.particleCount ?? 120;
  const area = config.area ?? 70;
  const baseZ = config.baseZ ?? 10;
  const maxHeight = config.maxHeight ?? 5;
  const darkColor = config.darkColor ?? config.color ?? 0xffd090;
  const darkOpacity = config.darkOpacity ?? config.opacity ?? 0.25;
  const lightColor = config.lightColor ?? 0xffffff;
  const lightOpacity = config.lightOpacity ?? Math.min(0.08, darkOpacity * 0.4);

  const pos = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount; i++) {
    pos[i * 3] = (Math.random() - 0.5) * area;
    pos[i * 3 + 1] = Math.random() * maxHeight;
    pos[i * 3 + 2] = baseZ + (Math.random() - 0.5) * area;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));

  const material = new THREE.PointsMaterial({
    color: darkColor,
    size: 0.05,
    transparent: true,
    opacity: darkOpacity,
    depthWrite: false,
  });

  const particles = new THREE.Points(geometry, material);
  scene.add(particles);

  let time = 0;
  let darkMode = true;

  function setDarkMode(nextDarkMode) {
    darkMode = !!nextDarkMode;
    if (darkMode) {
      material.color.setHex(darkColor);
      material.opacity = darkOpacity;
    } else {
      material.color.setHex(lightColor);
      material.opacity = lightOpacity;
    }
  }

  function update(dt) {
    time += dt;
    const p = geometry.attributes.position.array;
    for (let i = 0; i < particleCount; i++) {
      p[i * 3 + 1] += darkMode ? 0.002 : 0.0012;
      p[i * 3] += Math.sin(time * 0.2 + i * 0.5) * 0.0008;
      if (p[i * 3 + 1] > maxHeight) p[i * 3 + 1] = 0;
    }
    geometry.attributes.position.needsUpdate = true;
  }

  return { update, setDarkMode, isDarkMode: () => darkMode };
}
